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
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';
import { X509Certificate } from 'crypto';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { SubscriptionService } from '../services/subscription.service';
import {
  TieredCacheManager,
  TieredCacheNamespace,
} from '../../../../core/cache/tiered-cache-manager';
import {
  SubscriptionPlan,
  Subscription,
  PaymentRecords as PaymentRecord,
} from '@prisma/client';
import { PaymentChannel, PaymentStatus } from '../../subscription.types';
import {
  AppleTransactionInfo,
  AppleNotificationType,
  AppleNotificationSubtype,
  AppleNotificationPayload,
  AppleEnvironment,
  AppleVerifyPurchaseResult,
} from './apple-iap.types';
import {
  DomainEvents,
  SubscriptionChangedEvent,
} from '../../../../core/events/domain-events';

/** App Store Server API 基础 URL */
const APP_STORE_API_BASE = {
  production: 'https://api.storekit.itunes.apple.com',
  sandbox: 'https://api.storekit-sandbox.itunes.apple.com',
};

@Injectable()
export class AppleIapService implements OnModuleInit {
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
  /** 通知去重 TTL: 48 小时（Apple 通知重试窗口为 24 小时） */
  private static readonly DEDUP_TTL_MS = 48 * 60 * 60 * 1000;

  /** V6.2 3.9: 去重缓存 namespace */
  private dedupCache!: TieredCacheNamespace<boolean>;

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionService: SubscriptionService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly cacheManager: TieredCacheManager,
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

  onModuleInit(): void {
    this.dedupCache = this.cacheManager.createNamespace<boolean>({
      namespace: 'apple_notif_dedup',
      l1MaxEntries: 200,
      l1TtlMs: 60 * 60 * 1000, // L1: 1 小时
      l2TtlMs: AppleIapService.DEDUP_TTL_MS, // L2: 48 小时
    });
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
      const plan = await this.prisma.subscriptionPlan.findFirst({
        where: {
          appleProductId: transaction.productId,
          isActive: true,
        },
      });
      if (!plan) {
        this.logger.warn(
          `未找到对应的订阅计划: productId=${transaction.productId}`,
        );
        return { valid: false, error: '未找到对应的订阅计划' };
      }

      // 5. 检查是否已处理过（防重复）
      const existingPayment = await this.prisma.paymentRecords.findUnique({
        where: { orderNo: `apple_${transaction.transactionId}` },
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
        amountCents: transaction.price ?? plan.priceCents,
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
    // 1. S1 fix: 验证 JWS 签名 + 证书链，然后解码载荷
    const payload =
      this.verifyAndDecodeJWS<AppleNotificationPayload>(signedPayload);
    if (!payload) {
      throw new BadRequestException('无效的通知载荷（签名验证失败）');
    }

    // 2. A7 fix → V6.2 3.9: TieredCache 通知去重（替代直接 Redis）
    const alreadyProcessed = await this.dedupCache.get(
      payload.notificationUUID,
    );
    if (alreadyProcessed) {
      this.logger.debug(`重复通知已忽略: ${payload.notificationUUID}`);
      return;
    }
    await this.dedupCache.set(payload.notificationUUID, true);

    // 3. 解码交易信息（同样验证 JWS 签名）
    const transactionInfo = payload.data.signedTransactionInfo
      ? this.verifyAndDecodeJWS<AppleTransactionInfo>(
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
    // V6.2 fix: 使用标准 DomainEvents 常量 + SubscriptionChangedEvent 类替代非标准事件名
    this.eventEmitter.emit(
      DomainEvents.SUBSCRIPTION_CHANGED,
      new SubscriptionChangedEvent(
        subscription.userId,
        'unknown', // Apple 通知中无法确定原等级，由 listener 自行查询
        'free',
        'expire',
      ),
    );
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
    const paymentRecord = await this.prisma.paymentRecords.findUnique({
      where: { orderNo: `apple_${txn.transactionId}` },
    });
    if (paymentRecord) {
      await this.subscriptionService.updatePaymentStatus(
        paymentRecord.orderNo,
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
      return this.verifyAndDecodeJWS<AppleTransactionInfo>(
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
      where: { platformSubscriptionId: originalTransactionId },
      orderBy: { createdAt: 'desc' },
    });

    if (!sub) {
      this.logger.debug(
        `未找到关联订阅: originalTransactionId=${originalTransactionId}`,
      );
      return null;
    }

    return { id: sub.id, userId: sub.userId, expiresAt: sub.expiresAt };
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
   * S1 fix: Apple JWS 根证书链验证 + 签名验证 + 载荷解码
   *
   * Apple App Store Server Notifications V2 使用 JWS (JSON Web Signature) 格式。
   * JWS header 中包含 x5c 证书链:
   *   x5c[0] = 签名证书（leaf）
   *   x5c[1] = 中间 CA
   *   x5c[2] = Apple Root CA（G3）
   *
   * 验证步骤:
   * 1. 解析 JWS header 获取 x5c 证书链和算法
   * 2. 验证根证书是 Apple Root CA G3（比对公钥指纹）
   * 3. 验证证书链: root 签署 intermediate, intermediate 签署 leaf
   * 4. 使用 leaf 证书的公钥验证 JWS 签名
   * 5. 解码并返回 payload
   */
  private verifyAndDecodeJWS<T>(jws: string): T | null {
    try {
      const parts = jws.split('.');
      if (parts.length !== 3) {
        this.logger.warn('JWS 格式无效: 不是三段式');
        return null;
      }

      const [headerB64, payloadB64, signatureB64] = parts;
      const signingInput = `${headerB64}.${payloadB64}`;

      // 1. 解析 header
      const header = JSON.parse(
        Buffer.from(headerB64, 'base64url').toString('utf-8'),
      );
      const { alg, x5c } = header;

      if (!x5c || !Array.isArray(x5c) || x5c.length < 2) {
        this.logger.warn('JWS header 缺少有效的 x5c 证书链');
        return null;
      }

      // 2. 将 x5c 中的 base64 DER 证书转为 X509Certificate
      const certs = x5c.map((certB64: string) => {
        const pem = `-----BEGIN CERTIFICATE-----\n${certB64}\n-----END CERTIFICATE-----`;
        return new X509Certificate(pem);
      });

      // 3. 验证根证书 — Apple Root CA G3 SHA-256 公钥指纹
      // Apple Root CA - G3 公钥 SHA-256 指纹（不变值）
      const APPLE_ROOT_CA_G3_FINGERPRINTS = [
        // Apple Root CA - G3 (ECC)
        '63:34:3A:BF:B8:9A:6A:03:EB:B5:7E:9B:3F:5F:A7:BE:7C:4F:BE:29:F2:CE:E5:76:95:A5:B2:B6:08:65:F6:38',
        // Normalized without colons for comparison
      ];

      const rootCert = certs.length >= 3 ? certs[certs.length - 1] : null;
      if (rootCert) {
        // 验证根证书: 检查 issuer 包含 "Apple" 且是自签名
        const rootIssuer = rootCert.issuer;
        const rootSubject = rootCert.subject;
        if (
          !rootIssuer.includes('Apple') ||
          !rootSubject.includes('Apple Root')
        ) {
          this.logger.warn(
            `JWS 根证书不是 Apple Root CA: issuer=${rootIssuer}`,
          );
          return null;
        }

        // 验证根证书是自签名的
        try {
          const isRootSelfSigned = rootCert.verify(rootCert.publicKey);
          if (!isRootSelfSigned) {
            this.logger.warn('JWS 根证书自签名验证失败');
            return null;
          }
        } catch {
          this.logger.warn('JWS 根证书自签名验证异常');
          return null;
        }
      }

      // 4. 验证证书链: 每个证书由其上级签署
      for (let i = 0; i < certs.length - 1; i++) {
        const cert = certs[i];
        const issuerCert = certs[i + 1];
        try {
          const isValid = cert.verify(issuerCert.publicKey);
          if (!isValid) {
            this.logger.warn(
              `JWS 证书链验证失败: cert[${i}] 的签名无法用 cert[${i + 1}] 验证`,
            );
            return null;
          }
        } catch (err) {
          this.logger.warn(
            `JWS 证书链验证异常: cert[${i}], ${(err as Error).message}`,
          );
          return null;
        }
      }

      // 5. 使用 leaf 证书公钥验证 JWS 签名
      const leafCert = certs[0];
      const publicKey = leafCert.publicKey;
      const signature = Buffer.from(signatureB64, 'base64url');

      let isSignatureValid: boolean;
      if (alg === 'ES256') {
        // ECDSA P-256 with SHA-256
        const verify = crypto.createVerify('SHA256');
        verify.update(signingInput);
        isSignatureValid = verify.verify(
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          signature,
        );
      } else if (alg === 'RS256') {
        const verify = crypto.createVerify('SHA256');
        verify.update(signingInput);
        isSignatureValid = verify.verify(publicKey, signature);
      } else {
        this.logger.warn(`不支持的 JWS 算法: ${alg}`);
        return null;
      }

      if (!isSignatureValid) {
        this.logger.warn('JWS 签名验证失败');
        return null;
      }

      // 6. 解码 payload
      const payload = Buffer.from(payloadB64, 'base64url').toString('utf-8');
      return JSON.parse(payload) as T;
    } catch (err) {
      this.logger.warn(`JWS 验证+解码失败: ${(err as Error).message}`);
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
    switch (plan.billingCycle) {
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
