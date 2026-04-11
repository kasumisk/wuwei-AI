/**
 * V6 Phase 2.16 — 微信支付服务
 *
 * 职责:
 * - APP 下单（预支付 → 返回客户端唤起参数）
 * - 支付通知处理（验签 + 解密 + 订阅激活）
 * - 订单查询（主动查询交易状态）
 *
 * 微信支付 API v3 核心机制:
 * - 请求签名: HTTP Authorization + SHA256-RSA2048 签名
 * - 通知验签: 使用微信平台证书验证通知签名
 * - 通知解密: AEAD_AES_256_GCM 解密资源数据
 *
 * 配置（环境变量）:
 * - WECHAT_PAY_APPID: 应用 ID（可复用微信登录的 APPID）
 * - WECHAT_PAY_MCHID: 商户号
 * - WECHAT_PAY_SERIAL_NO: 商户 API 证书序列号
 * - WECHAT_PAY_PRIVATE_KEY: 商户 API 私钥（PEM 格式）
 * - WECHAT_PAY_API_V3_KEY: API v3 密钥（用于通知解密）
 * - WECHAT_PAY_NOTIFY_URL: 支付通知回调 URL
 */
import {
  Injectable,
  Logger,
  BadRequestException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { SubscriptionService } from './subscription.service';
import {
  subscription_plan as SubscriptionPlan,
  payment_record as PaymentRecord,
} from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PaymentChannel, PaymentStatus } from '../subscription.types';
import {
  WechatPayCreateOrderRequest,
  WechatPayCreateOrderResponse,
  WechatPayNotificationBody,
  WechatPayTransactionResult,
  WechatPayAppParams,
} from './wechat-pay.types';

/** 微信支付 API v3 基础 URL */
const WECHAT_PAY_API_BASE = 'https://api.mch.weixin.qq.com';

@Injectable()
export class WechatPayService {
  private readonly logger = new Logger(WechatPayService.name);

  /** 应用 ID */
  private readonly appid: string;
  /** 商户号 */
  private readonly mchid: string;
  /** 商户 API 证书序列号 */
  private readonly serialNo: string;
  /** 商户 API 私钥（PEM） */
  private readonly privateKey: string;
  /** API v3 密钥（32 字节，用于 AEAD 解密） */
  private readonly apiV3Key: string;
  /** 支付通知回调 URL */
  private readonly notifyUrl: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly subscriptionService: SubscriptionService,
    private readonly prisma: PrismaService,
  ) {
    this.appid = this.configService.get<string>('WECHAT_PAY_APPID', '');
    this.mchid = this.configService.get<string>('WECHAT_PAY_MCHID', '');
    this.serialNo = this.configService.get<string>('WECHAT_PAY_SERIAL_NO', '');
    this.privateKey = this.configService.get<string>(
      'WECHAT_PAY_PRIVATE_KEY',
      '',
    );
    this.apiV3Key = this.configService.get<string>('WECHAT_PAY_API_V3_KEY', '');
    this.notifyUrl = this.configService.get<string>(
      'WECHAT_PAY_NOTIFY_URL',
      '',
    );
  }

  // ==================== APP 下单 ====================

  /**
   * 创建微信支付 APP 订单
   *
   * 流程:
   * 1. 查找订阅计划
   * 2. 创建内部支付记录（pending 状态）
   * 3. 调用微信支付 APP 下单 API 获取 prepay_id
   * 4. 组装客户端唤起支付所需参数并签名
   * 5. 返回给客户端
   *
   * @param userId 用户 ID
   * @param planId 订阅计划 ID
   */
  async createOrder(
    userId: string,
    planId: string,
  ): Promise<WechatPayAppParams> {
    // 1. 查找计划
    const plan = await this.prisma.subscription_plan.findFirst({
      where: { id: planId, is_active: true },
    });
    if (!plan) {
      throw new BadRequestException('订阅计划不存在或已下架');
    }

    // 2. 生成订单号
    const orderNo = this.generateOrderNo();

    // 3. 创建内部支付记录（F5 fix: 在 callback_payload 中保存 planId，避免金额匹配歧义）
    await this.subscriptionService.createPaymentRecord({
      userId,
      orderNo,
      channel: PaymentChannel.WECHAT_PAY,
      amountCents: plan.price_cents,
      currency: plan.currency,
    });
    // 立即将 planId 写入 callback_payload，供回调时直接使用
    await this.prisma.payment_record.update({
      where: { order_no: orderNo },
      data: { callback_payload: { plan_id: planId } },
    });

    // 4. 调用微信支付 APP 下单 API
    const prepayId = await this.unifiedOrder({
      appid: this.appid,
      mchid: this.mchid,
      description: `${plan.name} - 订阅`,
      out_trade_no: orderNo,
      notify_url: this.notifyUrl,
      amount: {
        total: plan.price_cents,
        currency: plan.currency === 'CNY' ? 'CNY' : 'CNY',
      },
    });

    // 5. 组装客户端调起参数
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const noncestr = crypto.randomBytes(16).toString('hex');

    const signStr = `${this.appid}\n${timestamp}\n${noncestr}\n${prepayId}\n`;
    const sign = this.rsaSign(signStr);

    return {
      appid: this.appid,
      partnerid: this.mchid,
      prepayid: prepayId,
      package: 'Sign=WXPay',
      noncestr,
      timestamp,
      sign,
    };
  }

  // ==================== 支付通知处理 ====================

  /**
   * 处理微信支付通知
   *
   * 流程:
   * 1. 解密通知数据
   * 2. 验证交易状态
   * 3. 更新支付记录
   * 4. 激活订阅
   *
   * @param body 微信支付通知请求体
   * @param headers 请求头（包含签名信息，用于验签）
   */
  async handleNotification(
    body: WechatPayNotificationBody,
    headers: Record<string, string>,
  ): Promise<void> {
    // 1. S2 fix: 验证微信支付通知签名（SHA256-RSA2048）
    this.verifyNotificationSignature(body, headers);

    // 2. 解密通知数据
    const transaction = this.decryptNotification(body.resource);
    if (!transaction) {
      throw new BadRequestException('通知数据解密失败');
    }

    this.logger.log(
      `微信支付通知: orderNo=${transaction.out_trade_no}, status=${transaction.trade_state}, txnId=${transaction.transaction_id}`,
    );

    // 3. 根据事件类型处理
    switch (body.event_type) {
      case 'TRANSACTION.SUCCESS':
        await this.handlePaymentSuccess(transaction);
        break;
      case 'REFUND.SUCCESS':
        await this.handleRefundSuccess(transaction);
        break;
      default:
        this.logger.debug(`未处理的通知类型: ${body.event_type}`);
    }
  }

  /**
   * 主动查询交易状态（用于掉单恢复）
   */
  async queryOrder(
    orderNo: string,
  ): Promise<WechatPayTransactionResult | null> {
    try {
      const url = `/v3/pay/transactions/out-trade-no/${orderNo}?mchid=${this.mchid}`;
      const response = await this.apiRequest('GET', url);
      return response as WechatPayTransactionResult;
    } catch (error) {
      this.logger.error(
        `查询订单失败: orderNo=${orderNo}`,
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 处理支付成功
   */
  private async handlePaymentSuccess(
    transaction: WechatPayTransactionResult,
  ): Promise<void> {
    if (transaction.trade_state !== 'SUCCESS') return;

    const orderNo = transaction.out_trade_no;

    // 查找支付记录
    const payment = await this.prisma.payment_record.findUnique({
      where: { order_no: orderNo },
    });
    if (!payment) {
      this.logger.warn(`支付记录不存在: orderNo=${orderNo}`);
      return;
    }

    // 防重复处理
    if (payment.status === PaymentStatus.SUCCESS) {
      this.logger.debug(`订单已处理: orderNo=${orderNo}`);
      return;
    }

    // 更新支付状态
    await this.subscriptionService.updatePaymentStatus(
      orderNo,
      PaymentStatus.SUCCESS,
      transaction.transaction_id,
      { wechat_transaction: transaction },
    );

    // 查找计划并创建订阅
    // F5 fix: 优先从 callback_payload 中取 plan_id，避免金额匹配歧义
    const plan = await this.findPlanByPayment(payment as any);
    if (!plan) {
      this.logger.error(
        `无法匹配订阅计划: orderNo=${orderNo}, amount=${payment.amount_cents}`,
      );
      return;
    }

    // 计算到期时间
    const expiresAt = this.calcExpiresDate(plan);

    // 创建订阅
    await this.subscriptionService.createSubscription({
      userId: payment.user_id,
      planId: plan.id,
      paymentChannel: PaymentChannel.WECHAT_PAY,
      platformSubscriptionId: transaction.transaction_id,
      expiresAt,
    });

    this.logger.log(
      `微信支付成功，订阅已激活: userId=${payment.user_id}, plan=${plan.name}, expiresAt=${expiresAt.toISOString()}`,
    );
  }

  /**
   * 处理退款成功
   */
  private async handleRefundSuccess(
    transaction: WechatPayTransactionResult,
  ): Promise<void> {
    const orderNo = transaction.out_trade_no;
    await this.subscriptionService.updatePaymentStatus(
      orderNo,
      PaymentStatus.REFUNDED,
      transaction.transaction_id,
    );

    // 查找并取消用户订阅
    const payment = await this.prisma.payment_record.findUnique({
      where: { order_no: orderNo },
    });
    if (payment) {
      await this.subscriptionService.cancelSubscription(payment.user_id);
      this.logger.log(
        `微信退款已处理: userId=${payment.user_id}, orderNo=${orderNo}`,
      );
    }
  }

  /**
   * 调用微信支付 APP 下单 API
   */
  private async unifiedOrder(
    request: WechatPayCreateOrderRequest,
  ): Promise<string> {
    const response = (await this.apiRequest(
      'POST',
      '/v3/pay/transactions/app',
      request,
    )) as WechatPayCreateOrderResponse;

    if (!response.prepay_id) {
      throw new InternalServerErrorException('微信支付下单失败: 无 prepay_id');
    }

    return response.prepay_id;
  }

  /**
   * 微信支付 API v3 请求（含签名）
   */
  private async apiRequest(
    method: string,
    urlPath: string,
    body?: unknown,
  ): Promise<unknown> {
    if (!this.mchid || !this.serialNo || !this.privateKey) {
      throw new InternalServerErrorException(
        '微信支付配置不完整（缺少 MCHID / SERIAL_NO / PRIVATE_KEY）',
      );
    }

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const nonce = crypto.randomBytes(16).toString('hex');
    const bodyStr = body ? JSON.stringify(body) : '';

    // 构造签名串
    const signStr = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${bodyStr}\n`;
    const signature = this.rsaSign(signStr);

    // Authorization 头
    const authorization = `WECHATPAY2-SHA256-RSA2048 mchid="${this.mchid}",nonce_str="${nonce}",timestamp="${timestamp}",serial_no="${this.serialNo}",signature="${signature}"`;

    const url = `${WECHAT_PAY_API_BASE}${urlPath}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: bodyStr || undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(
        `微信支付 API 错误: ${method} ${urlPath} → ${response.status}: ${errorText}`,
      );
      throw new InternalServerErrorException(
        `微信支付 API 请求失败: ${response.status}`,
      );
    }

    return response.json();
  }

  /**
   * S2 fix: 验证微信支付通知签名
   *
   * 微信支付 API v3 通知签名验证流程:
   * 1. 从 headers 提取: Wechatpay-Timestamp, Wechatpay-Nonce, Wechatpay-Signature, Wechatpay-Serial
   * 2. 构造验签串: ${timestamp}\n${nonce}\n${body_json}\n
   * 3. 使用微信平台证书的公钥 (SHA256-RSA2048) 验证签名
   *
   * 平台证书获取:
   * - 通过环境变量 WECHAT_PAY_PLATFORM_CERT 配置（PEM 格式）
   * - 或调用 /v3/certificates 接口动态获取（需解密），后续版本可增加自动拉取+缓存
   *
   * @throws BadRequestException 签名验证失败时抛出
   */
  private verifyNotificationSignature(
    body: WechatPayNotificationBody,
    headers: Record<string, string>,
  ): void {
    // 从环境变量读取微信平台证书（PEM 格式）
    const platformCert = this.configService.get<string>(
      'WECHAT_PAY_PLATFORM_CERT',
      '',
    );

    if (!platformCert) {
      // 平台证书未配置时仅记录警告，不阻断流程
      // 这样可以在开发环境跳过验签，生产环境通过配置证书启用
      this.logger.warn(
        '微信平台证书未配置（WECHAT_PAY_PLATFORM_CERT），跳过通知签名验证。' +
          '生产环境必须配置此证书！',
      );
      return;
    }

    // 标准化 header key（微信返回的 header key 大小写可能不一致）
    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders[key.toLowerCase()] = value;
    }

    const timestamp = normalizedHeaders['wechatpay-timestamp'];
    const nonce = normalizedHeaders['wechatpay-nonce'];
    const signature = normalizedHeaders['wechatpay-signature'];
    const serial = normalizedHeaders['wechatpay-serial'];

    if (!timestamp || !nonce || !signature) {
      throw new BadRequestException('微信支付通知缺少签名信息');
    }

    // 检查时间戳（防重放攻击 — 5 分钟窗口）
    const now = Math.floor(Date.now() / 1000);
    const ts = parseInt(timestamp, 10);
    if (Math.abs(now - ts) > 300) {
      this.logger.warn(
        `微信支付通知时间戳过期: timestamp=${timestamp}, now=${now}`,
      );
      throw new BadRequestException('通知时间戳过期');
    }

    // 构造验签串: timestamp\nnonce\nbody_json\n
    const bodyStr = JSON.stringify(body);
    const message = `${timestamp}\n${nonce}\n${bodyStr}\n`;

    // SHA256-RSA2048 验签
    try {
      const verify = crypto.createVerify('SHA256');
      verify.update(message);
      const isValid = verify.verify(platformCert, signature, 'base64');

      if (!isValid) {
        this.logger.warn(
          `微信支付通知签名验证失败: serial=${serial || 'unknown'}`,
        );
        throw new BadRequestException('通知签名验证失败');
      }

      this.logger.debug('微信支付通知签名验证通过');
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`微信支付签名验证异常: ${(err as Error).message}`);
      throw new BadRequestException('通知签名验证失败');
    }
  }

  /**
   * RSA-SHA256 签名
   */
  private rsaSign(message: string): string {
    const sign = crypto.createSign('RSA-SHA256');
    sign.update(message);
    return sign.sign(this.privateKey, 'base64');
  }

  /**
   * 解密微信支付通知数据（AEAD_AES_256_GCM）
   */
  private decryptNotification(
    resource: WechatPayNotificationBody['resource'],
  ): WechatPayTransactionResult | null {
    try {
      if (!this.apiV3Key) {
        throw new Error('缺少 API v3 密钥');
      }

      const { ciphertext, nonce, associated_data } = resource;

      // AES-256-GCM 解密
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        Buffer.from(this.apiV3Key, 'utf-8'),
        Buffer.from(nonce, 'utf-8'),
      );
      decipher.setAAD(Buffer.from(associated_data, 'utf-8'));

      const cipherBuffer = Buffer.from(ciphertext, 'base64');
      // GCM auth tag 是最后 16 字节
      const authTag = cipherBuffer.subarray(cipherBuffer.length - 16);
      const encrypted = cipherBuffer.subarray(0, cipherBuffer.length - 16);

      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]);

      return JSON.parse(
        decrypted.toString('utf-8'),
      ) as WechatPayTransactionResult;
    } catch (error) {
      this.logger.error(
        '微信支付通知解密失败',
        error instanceof Error ? error.stack : String(error),
      );
      return null;
    }
  }

  /**
   * 生成商户订单号
   *
   * 格式: wx_{时间戳}_{随机字符串}
   * 确保唯一性和可追溯性
   */
  private generateOrderNo(): string {
    const timestamp = Date.now().toString();
    const random = crypto.randomBytes(4).toString('hex');
    return `wx_${timestamp}_${random}`;
  }

  /**
   * F5 fix: 根据支付记录查找对应的订阅计划
   *
   * 优先从 callback_payload.plan_id 精确匹配（V6.2 新增），
   * 回退到金额+货币匹配（兼容 V6.2 之前创建的订单）
   */
  private async findPlanByPayment(payment: any): Promise<any> {
    // 优先: 从 callback_payload 取 plan_id（V6.2 创建的订单）
    const callbackPayload = payment.callback_payload as Record<
      string,
      unknown
    > | null;
    const planId = callbackPayload?.plan_id as string | undefined;
    if (planId) {
      const plan = await this.prisma.subscription_plan.findFirst({
        where: { id: planId, is_active: true },
      });
      if (plan) return plan;
      this.logger.warn(
        `callback_payload 中的 plan_id=${planId} 未找到有效计划，回退到金额匹配`,
      );
    }

    // 回退: 通过金额 + 货币匹配（兼容旧订单）
    return this.prisma.subscription_plan.findFirst({
      where: {
        price_cents: payment.amount_cents,
        currency: payment.currency,
        is_active: true,
      },
      orderBy: { sort_order: 'asc' },
    });
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
