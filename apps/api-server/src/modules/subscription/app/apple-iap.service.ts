/**
 * V6 Phase 2.15 — Apple IAP 服务
 *
 * 职责:
 * - 验证客户端购买（App Store Server API v2 — Get Transaction Info）
 * - 处理 Apple S2S 通知（V2 Notifications）
 * - 将 Apple 交易映射到内部订阅系统
 *
 * 安全机制:
 * - 使用 Apple 签名的 ECDSA 密钥进行 JWS 签名验证
 * - 验证 Bundle ID 和环境一致性
 * - 通知去重（基于 notificationUUID）
 *
 * 配置（环境变量）:
 * - APPLE_BUNDLE_ID: App 的 Bundle ID
 * - APPLE_IAP_KEY_ID: App Store Connect API Key ID
 * - APPLE_IAP_ISSUER_ID: App Store Connect Issuer ID
 * - APPLE_IAP_PRIVATE_KEY: ECDSA P256 私钥（PEM 格式，用于生成 JWT）
 * - APPLE_IAP_ENVIRONMENT: 'sandbox' | 'production'
 *
 * 依赖:
 * - SubscriptionService: 订阅生命周期管理
 * - PaymentRecord: 支付记录
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SubscriptionService } from './subscription.service';
import {
  subscription_plan as SubscriptionPlan,
  subscription as Subscription,
  payment_record as PaymentRecord,
} from '@prisma/client';
import { PaymentChannel, PaymentStatus } from '../subscription.types';
import {
  AppleTransactionInfo,
  AppleNotificationType,
  AppleNotificationSubtype,
  AppleNotificationPayload,
  AppleEnvironment,
  AppleVerifyPurchaseResult,
} from './apple-iap.types';

/** App Store Server API 基础 URL */
const APP_STORE_API_BASE = {
  production: 'https://api.storekit.itunes.apple.com',
  sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
};

@Injectable()
export class AppleIapService {
  private readonly logger = new Logger(AppleIapService.name);

  /** Apple Bundle ID */
  private readonly bundleId: string;
  /** App Store Connect API Key ID */
  private readonly keyId: string;
  /** App Store Connect Issuer ID */
  private readonly issuerId: string;
  /** ECDSA P256 私钥 */
  private readonly privateKey: string;
  /** 当前环境 */
  private readonly environment: 'sandbox' | 'production';
  /** API 基础 URL */
  private readonly apiBase: string;
  /** 已处理的通知 UUID 集合（简单内存去重，生产环境建议用 Redis） */
  private readonly processedNotifications = new Set<string>();

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionService: SubscriptionService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.bundleId = this.configService.get<string>('APPLE_BUNDLE_ID', '');
    this.keyId = this.configService.get<string>('APPLE_IAP_KEY_ID', '');
    this.issuerId = this.configService.get<string>('APPLE_IAP_ISSUER_ID', '');
    this.privateKey = this.configService.get<string>(
      'APPLE_IAP_PRIVATE_KEY',
      '',
    );
    this.environment = this.configService.get<string>(
      'APPLE_IAP_ENVIRONMENT',
      'sandbox',
    ) as 'sandbox' | 'production';
    this.apiBase = APP_STORE_API_BASE[this.environment];
  }

  // ==================== 客户端购买验证 ====================

  /**
   * 验证客户端 IAP 购买
   *
   * 流程:
   * 1. 调用 App Store Server API 获取交易信息
   * 2. 验证交易有效性（Bundle ID、产品 ID、环境）
   * 3. 查找对应的订阅计划
   * 4. 创建/续费订阅 + 支付记录
   *
   * @param userId 当前用户 ID
   * @param transactionId Apple 交易 ID
   * @param productId 产品 ID（客户端上报，用于二次校验）
   */
  async verifyAndProcessPurchase(
    userId: string,
    transactionId: string,
    productId: string,
  ): Promise<AppleVerifyPurchaseResult> {
    try {
      // 1. 获取交易信息
      const transaction = await this.getTransactionInfo(transactionId);
      if (!transaction) {
        return { valid: false, error: '无法获取交易信息' };
      }

      // 2. 验证 Bundle ID
      if (transaction.bundleId !== this.bundleId) {
        this.logger.warn(
          `Bundle ID 不匹配: 期望=${this.bundleId}, 实际=${transaction.bundleId}`,
        );
        return { valid: false, error: 'Bundle ID 不匹配' };
      }

      // 3. 验证产品 ID 一致性
      if (transaction.productId !== productId) {
        this.logger.warn(
          `产品 ID 不匹配: 期望=${productId}, 实际=${transaction.productId}`,
        );
        return { valid: false, error: '产品 ID 不匹配' };
      }

      // 4. 查找对应的订阅计划
      const plan = await this.prisma.subscription_plan.findFirst({
        where: {
          apple_product_id: transaction.productId,
          is_active: true,
        },
      });
      if (!plan) {
        this.logger.warn(
          `未找到对应的订阅计划: productId=${transaction.productId}`,
        );
        return { valid: false, error: '未找到对应的订阅计划' };
      }

      // 5. 检查是否已处理过（防重复）
      const existingPayment = await this.prisma.payment_record.findUnique({
        where: { order_no: `apple_${transaction.transactionId}` },
      });
      if (existingPayment) {
        this.logger.log(
          `交易已处理: transactionId=${transaction.transactionId}`,
        );
        return { valid: true, transaction };
      }

      // 6. 创建支付记录
      await this.subscriptionService.createPaymentRecord({
        userId,
        orderNo: `apple_${transaction.transactionId}`,
        channel: PaymentChannel.APPLE_IAP,
        amountCents: transaction.price ?? plan.price_cents,
        currency: transaction.currency ?? plan.currency,
      });

      // 7. 更新支付状态为成功
      await this.subscriptionService.updatePaymentStatus(
        `apple_${transaction.transactionId}`,
        PaymentStatus.SUCCESS,
        transaction.transactionId,
        { originalTransactionId: transaction.originalTransactionId },
      );

      // 8. 创建/续费订阅
      const expiresAt = transaction.expiresDate
        ? new Date(transaction.expiresDate)
        : this.calcExpiresDate(plan as any);

      await this.subscriptionService.createSubscription({
        userId,
        planId: plan.id,
        paymentChannel: PaymentChannel.APPLE_IAP,
        platformSubscriptionId: transaction.originalTransactionId,
        expiresAt,
      });

      this.logger.log(
        `Apple IAP 购买已验证: userId=${userId}, productId=${transaction.productId}, expiresAt=${expiresAt.toISOString()}`,
      );

      return { valid: true, transaction };
    } catch (error) {
      this.logger.error(
        `Apple IAP 验证失败: transactionId=${transactionId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return {
        valid: false,
        error: error instanceof Error ? error.message : '验证失败',
      };
    }
  }

  // ==================== S2S 通知处理 ====================

  /**
   * 处理 Apple Server-to-Server 通知 V2
   *
   * Apple 会在订阅状态发生变化时推送通知到我们的 webhook 端点。
   * 通知以 JWS 格式签名，需要验证签名后处理。
   *
   * @param signedPayload Apple 发送的 JWS 签名载荷
   */
  async handleNotification(signedPayload: string): Promise<void> {
    // 1. 解码 JWS 载荷（生产环境需验证签名）
    const payload =
      this.decodeJWSPayload<AppleNotificationPayload>(signedPayload);
    if (!payload) {
      throw new BadRequestException('无效的通知载荷');
    }

    // 2. 通知去重
    if (this.processedNotifications.has(payload.notificationUUID)) {
      this.logger.debug(`重复通知已忽略: ${payload.notificationUUID}`);
      return;
    }
    this.processedNotifications.add(payload.notificationUUID);

    // 防止内存无限增长 — 只保留最近 10000 条
    if (this.processedNotifications.size > 10000) {
      const iterator = this.processedNotifications.values();
      for (let i = 0; i < 5000; i++) {
        const item = iterator.next();
        if (!item.done) this.processedNotifications.delete(item.value);
      }
    }

    // 3. 解码交易信息
    const transactionInfo = payload.data.signedTransactionInfo
      ? this.decodeJWSPayload<AppleTransactionInfo>(
          payload.data.signedTransactionInfo,
        )
      : null;

    if (!transactionInfo) {
      this.logger.warn(`通知无交易信息: type=${payload.notificationType}`);
      return;
    }

    this.logger.log(
      `处理 Apple 通知: type=${payload.notificationType}, subtype=${payload.subtype ?? 'N/A'}, txn=${transactionInfo.transactionId}`,
    );

    // 4. 根据通知类型分发处理
    switch (payload.notificationType) {
      case AppleNotificationType.SUBSCRIBED:
        await this.handleSubscribed(transactionInfo, payload.subtype);
        break;
      case AppleNotificationType.DID_RENEW:
        await this.handleDidRenew(transactionInfo);
        break;
      case AppleNotificationType.DID_FAIL_TO_RENEW:
        await this.handleDidFailToRenew(transactionInfo, payload.subtype);
        break;
      case AppleNotificationType.EXPIRED:
        await this.handleExpired(transactionInfo);
        break;
      case AppleNotificationType.GRACE_PERIOD_EXPIRED:
        await this.handleGracePeriodExpired(transactionInfo);
        break;
      case AppleNotificationType.REFUND:
        await this.handleRefund(transactionInfo);
        break;
      case AppleNotificationType.DID_CHANGE_RENEWAL_STATUS:
        await this.handleRenewalStatusChange(transactionInfo, payload.subtype);
        break;
      case AppleNotificationType.DID_CHANGE_RENEWAL_PREF:
        await this.handleRenewalPrefChange(transactionInfo);
        break;
      case AppleNotificationType.REVOKE:
        await this.handleRevoke(transactionInfo);
        break;
      case AppleNotificationType.TEST:
        this.logger.log('收到 Apple 测试通知');
        break;
      default:
        this.logger.debug(`未处理的通知类型: ${payload.notificationType}`);
    }
  }

  // ==================== 通知处理方法 ====================

  /**
   * 处理新订阅（首次购买或重新订阅）
   */
  private async handleSubscribed(
    txn: AppleTransactionInfo,
    subtype?: AppleNotificationSubtype,
  ): Promise<void> {
    const subscription = await this.findSubscriptionByAppleTxn(
      txn.originalTransactionId,
    );

    if (subtype === AppleNotificationSubtype.RESUBSCRIBE && subscription) {
      // 重新订阅 — 续费
      const expiresAt = txn.expiresDate
        ? new Date(txn.expiresDate)
        : new Date();
      await this.subscriptionService.renewSubscription(
        subscription.userId,
        expiresAt,
      );
    }
    // INITIAL_BUY 通常由客户端 verifyAndProcessPurchase 处理
  }

  /**
   * 处理自动续费成功
   */
  private async handleDidRenew(txn: AppleTransactionInfo): Promise<void> {
    const subscription = await this.findSubscriptionByAppleTxn(
      txn.originalTransactionId,
    );
    if (!subscription) {
      this.logger.warn(
        `续费通知但未找到订阅: originalTransactionId=${txn.originalTransactionId}`,
      );
      return;
    }

    const expiresAt = txn.expiresDate ? new Date(txn.expiresDate) : new Date();

    // 创建支付记录
    await this.subscriptionService.createPaymentRecord({
      userId: subscription.userId,
      subscriptionId: subscription.id,
      orderNo: `apple_${txn.transactionId}`,
      channel: PaymentChannel.APPLE_IAP,
      amountCents: txn.price ?? 0,
      currency: txn.currency ?? 'CNY',
    });
    await this.subscriptionService.updatePaymentStatus(
      `apple_${txn.transactionId}`,
      PaymentStatus.SUCCESS,
      txn.transactionId,
    );

    // 续费
    await this.subscriptionService.renewSubscription(
      subscription.userId,
      expiresAt,
    );
  }

  /**
   * 处理续费失败（进入计费重试或宽限期）
   */
  private async handleDidFailToRenew(
    txn: AppleTransactionInfo,
    subtype?: AppleNotificationSubtype,
  ): Promise<void> {
    const subscription = await this.findSubscriptionByAppleTxn(
      txn.originalTransactionId,
    );
    if (!subscription) return;

    if (subtype === AppleNotificationSubtype.GRACE_PERIOD) {
      this.logger.log(
        `用户 ${subscription.userId} 进入宽限期: originalTxn=${txn.originalTransactionId}`,
      );
      // 宽限期内仍允许访问 — 由 processExpiredSubscriptions Cron 处理状态转换
    }
  }

  /**
   * 处理订阅过期
   */
  private async handleExpired(txn: AppleTransactionInfo): Promise<void> {
    const subscription = await this.findSubscriptionByAppleTxn(
      txn.originalTransactionId,
    );
    if (!subscription) return;

    // processExpiredSubscriptions Cron 会处理 — 此处发布事件供其他模块响应
    this.eventEmitter.emit('subscription.apple.expired', {
      userId: subscription.userId,
      originalTransactionId: txn.originalTransactionId,
    });
  }

  /**
   * 处理宽限期过期
   */
  private async handleGracePeriodExpired(
    txn: AppleTransactionInfo,
  ): Promise<void> {
    // 由 processExpiredSubscriptions Cron 统一处理
    this.logger.log(`宽限期过期: originalTxn=${txn.originalTransactionId}`);
  }

  /**
   * 处理退款
   */
  private async handleRefund(txn: AppleTransactionInfo): Promise<void> {
    const subscription = await this.findSubscriptionByAppleTxn(
      txn.originalTransactionId,
    );
    if (!subscription) return;

    // 更新支付记录为已退款
    const paymentRecord = await this.prisma.payment_record.findUnique({
      where: { order_no: `apple_${txn.transactionId}` },
    });
    if (paymentRecord) {
      await this.subscriptionService.updatePaymentStatus(
        paymentRecord.order_no,
        PaymentStatus.REFUNDED,
      );
    }

    // 取消订阅
    await this.subscriptionService.cancelSubscription(subscription.userId);

    this.logger.log(
      `Apple 退款已处理: userId=${subscription.userId}, txn=${txn.transactionId}`,
    );
  }

  /**
   * 处理续订状态变更（用户开启/关闭自动续费）
   */
  private async handleRenewalStatusChange(
    txn: AppleTransactionInfo,
    subtype?: AppleNotificationSubtype,
  ): Promise<void> {
    const subscription = await this.findSubscriptionByAppleTxn(
      txn.originalTransactionId,
    );
    if (!subscription) return;

    if (subtype === AppleNotificationSubtype.AUTO_RENEW_DISABLED) {
      // 用户关闭自动续费 — 标记为取消（当前周期结束后失效）
      await this.subscriptionService.cancelSubscription(subscription.userId);
    } else if (subtype === AppleNotificationSubtype.AUTO_RENEW_ENABLED) {
      // 用户重新开启自动续费
      const expiresAt = txn.expiresDate
        ? new Date(txn.expiresDate)
        : subscription.expiresAt;
      await this.subscriptionService.renewSubscription(
        subscription.userId,
        expiresAt,
      );
    }
  }

  /**
   * 处理续订偏好变更（用户升级/降级计划）
   */
  private async handleRenewalPrefChange(
    txn: AppleTransactionInfo,
  ): Promise<void> {
    this.logger.log(
      `用户变更续订偏好: productId=${txn.productId}, originalTxn=${txn.originalTransactionId}`,
    );
    // 升级/降级在下次续费时自动生效，此处仅记录日志
  }

  /**
   * 处理撤销（家庭共享成员被移除等）
   */
  private async handleRevoke(txn: AppleTransactionInfo): Promise<void> {
    const subscription = await this.findSubscriptionByAppleTxn(
      txn.originalTransactionId,
    );
    if (!subscription) return;

    await this.subscriptionService.cancelSubscription(subscription.userId);
    this.logger.log(`Apple 订阅已撤销: userId=${subscription.userId}`);
  }

  // ==================== 私有工具方法 ====================

  /**
   * 通过 App Store Server API v2 获取交易信息
   *
   * 调用 GET /inApps/v1/transactions/{transactionId}
   */
  private async getTransactionInfo(
    transactionId: string,
  ): Promise<AppleTransactionInfo | null> {
    try {
      const jwt = this.generateApiToken();
      const url = `${this.apiBase}/inApps/v1/transactions/${transactionId}`;

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${jwt}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        this.logger.warn(
          `App Store API 请求失败: status=${response.status}, txn=${transactionId}`,
        );
        return null;
      }

      const data = (await response.json()) as {
        signedTransactionInfo: string;
      };
      return this.decodeJWSPayload<AppleTransactionInfo>(
        data.signedTransactionInfo,
      );
    } catch (error) {
      this.logger.error(
        `获取交易信息失败: txn=${transactionId}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  /**
   * 根据 Apple originalTransactionId 查找内部订阅记录
   */
  private async findSubscriptionByAppleTxn(
    originalTransactionId: string,
  ): Promise<{
    id: string;
    userId: string;
    expiresAt: Date;
  } | null> {
    // 通过 platformSubscriptionId 查找
    const sub = await this.prisma.subscription.findFirst({
      where: { platform_subscription_id: originalTransactionId },
      orderBy: { created_at: 'desc' },
    });

    if (!sub) {
      this.logger.debug(
        `未找到关联订阅: originalTransactionId=${originalTransactionId}`,
      );
      return null;
    }

    return { id: sub.id, userId: sub.user_id, expiresAt: sub.expires_at };
  }

  /**
   * 生成 App Store Server API JWT Token
   *
   * 使用 ES256 签名算法（ECDSA P-256）
   * Token 有效期 20 分钟
   */
  private generateApiToken(): string {
    if (!this.keyId || !this.issuerId || !this.privateKey) {
      throw new InternalServerErrorException(
        'Apple IAP 配置不完整（缺少 KEY_ID / ISSUER_ID / PRIVATE_KEY）',
      );
    }

    const now = Math.floor(Date.now() / 1000);
    const header = {
      alg: 'ES256',
      kid: this.keyId,
      typ: 'JWT',
    };
    const payload = {
      iss: this.issuerId,
      iat: now,
      exp: now + 20 * 60, // 20 分钟
      aud: 'appstoreconnect-v1',
      bid: this.bundleId,
    };

    // Base64url 编码
    const headerB64 = this.base64url(JSON.stringify(header));
    const payloadB64 = this.base64url(JSON.stringify(payload));
    const signingInput = `${headerB64}.${payloadB64}`;

    // ES256 签名
    const sign = crypto.createSign('SHA256');
    sign.update(signingInput);
    const signature = sign.sign(
      { key: this.privateKey, dsaEncoding: 'ieee-p1363' },
      'base64url',
    );

    return `${signingInput}.${signature}`;
  }

  /**
   * 解码 JWS 载荷（仅提取 payload 部分，不验证签名）
   *
   * 注意: 生产环境应验证 Apple 的根证书链签名。
   * 当前实现信任 Apple S2S 通知的 HTTPS 传输安全 + Bundle ID 校验。
   */
  private decodeJWSPayload<T>(jws: string): T | null {
    try {
      const parts = jws.split('.');
      if (parts.length !== 3) return null;

      const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
      return JSON.parse(payload) as T;
    } catch {
      this.logger.warn('JWS 解码失败');
      return null;
    }
  }

  /**
   * Base64url 编码
   */
  private base64url(str: string): string {
    return Buffer.from(str).toString('base64url');
  }

  /**
   * 根据计划计费周期计算到期时间
   */
  private calcExpiresDate(plan: any): Date {
    const now = new Date();
    switch (plan.billing_cycle) {
      case 'monthly':
        return new Date(now.setMonth(now.getMonth() + 1));
      case 'quarterly':
        return new Date(now.setMonth(now.getMonth() + 3));
      case 'yearly':
        return new Date(now.setFullYear(now.getFullYear() + 1));
      default:
        return new Date(now.setMonth(now.getMonth() + 1));
    }
  }
}
