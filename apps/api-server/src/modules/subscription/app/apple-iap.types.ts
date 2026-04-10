/**
 * V6 Phase 2.15 — Apple IAP 类型定义
 *
 * 对应 Apple App Store Server API v2 + StoreKit 2 的数据结构。
 * 参考: https://developer.apple.com/documentation/appstoreserverapi
 */

// ==================== App Store Server API v2 ====================

/**
 * App Store Server API 环境
 */
export enum AppleEnvironment {
  PRODUCTION = 'Production',
  SANDBOX = 'Sandbox',
}

/**
 * App Store 交易信息（从 JWS signedTransactionInfo 解码后）
 *
 * 参考: https://developer.apple.com/documentation/appstoreserverapi/jwstransactiondecodedpayload
 */
export interface AppleTransactionInfo {
  /** 交易 ID */
  transactionId: string;
  /** 原始交易 ID（首次购买的交易 ID，续费共享） */
  originalTransactionId: string;
  /** App 的 Bundle ID */
  bundleId: string;
  /** 产品 ID（对应 SubscriptionPlan.appleProductId） */
  productId: string;
  /** 购买日期（毫秒时间戳） */
  purchaseDate: number;
  /** 过期日期（毫秒时间戳，订阅类型专用） */
  expiresDate?: number;
  /** 交易类型 */
  type:
    | 'Auto-Renewable Subscription'
    | 'Non-Consumable'
    | 'Consumable'
    | 'Non-Renewing Subscription';
  /** 环境 */
  environment: AppleEnvironment;
  /** 价格（毫元） */
  price?: number;
  /** 货币代码 */
  currency?: string;
  /** 优惠类型 */
  offerType?: number;
  /** 订阅组 ID */
  subscriptionGroupIdentifier?: string;
}

/**
 * App Store 续订信息（从 JWS signedRenewalInfo 解码后）
 */
export interface AppleRenewalInfo {
  /** 原始交易 ID */
  originalTransactionId: string;
  /** 自动续订产品 ID */
  autoRenewProductId: string;
  /** 自动续订状态: 1 = 开启 */
  autoRenewStatus: number;
  /** 过期原因 */
  expirationIntent?: number;
  /** 是否在计费重试期 */
  isInBillingRetryPeriod?: boolean;
  /** 价格上涨同意状态 */
  priceIncreaseStatus?: number;
}

// ==================== Server-to-Server Notifications V2 ====================

/**
 * Apple S2S 通知类型
 *
 * 参考: https://developer.apple.com/documentation/appstoreservernotifications/notificationtype
 */
export enum AppleNotificationType {
  CONSUMPTION_REQUEST = 'CONSUMPTION_REQUEST',
  DID_CHANGE_RENEWAL_PREF = 'DID_CHANGE_RENEWAL_PREF',
  DID_CHANGE_RENEWAL_STATUS = 'DID_CHANGE_RENEWAL_STATUS',
  DID_FAIL_TO_RENEW = 'DID_FAIL_TO_RENEW',
  DID_RENEW = 'DID_RENEW',
  EXPIRED = 'EXPIRED',
  GRACE_PERIOD_EXPIRED = 'GRACE_PERIOD_EXPIRED',
  OFFER_REDEEMED = 'OFFER_REDEEMED',
  PRICE_INCREASE = 'PRICE_INCREASE',
  REFUND = 'REFUND',
  REFUND_DECLINED = 'REFUND_DECLINED',
  REFUND_REVERSED = 'REFUND_REVERSED',
  RENEWAL_EXTENDED = 'RENEWAL_EXTENDED',
  REVOKE = 'REVOKE',
  SUBSCRIBED = 'SUBSCRIBED',
  /** 测试通知 */
  TEST = 'TEST',
}

/**
 * Apple S2S 通知子类型
 */
export enum AppleNotificationSubtype {
  INITIAL_BUY = 'INITIAL_BUY',
  RESUBSCRIBE = 'RESUBSCRIBE',
  DOWNGRADE = 'DOWNGRADE',
  UPGRADE = 'UPGRADE',
  AUTO_RENEW_ENABLED = 'AUTO_RENEW_ENABLED',
  AUTO_RENEW_DISABLED = 'AUTO_RENEW_DISABLED',
  VOLUNTARY = 'VOLUNTARY',
  BILLING_RETRY_PERIOD = 'BILLING_RETRY_PERIOD',
  PRICE_INCREASE = 'PRICE_INCREASE',
  GRACE_PERIOD = 'GRACE_PERIOD',
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  BILLING_RECOVERY = 'BILLING_RECOVERY',
  FAILURE = 'FAILURE',
  SUMMARY = 'SUMMARY',
}

/**
 * Apple S2S 通知 V2 解码后的载荷
 */
export interface AppleNotificationPayload {
  notificationType: AppleNotificationType;
  subtype?: AppleNotificationSubtype;
  /** 通知 UUID */
  notificationUUID: string;
  /** 数据 */
  data: {
    /** App 的 Bundle ID */
    bundleId: string;
    /** 环境 */
    environment: AppleEnvironment;
    /** 签名的交易信息 JWS */
    signedTransactionInfo?: string;
    /** 签名的续订信息 JWS */
    signedRenewalInfo?: string;
  };
  /** 版本 */
  version: string;
  /** 签名日期 */
  signedDate: number;
}

// ==================== 客户端请求 ====================

/**
 * 客户端发送的购买验证请求
 *
 * iOS 客户端完成 StoreKit 2 购买后，将 JWS 格式的 transactionId 发送到服务端验证。
 */
export interface AppleVerifyPurchaseRequest {
  /** StoreKit 2 Transaction.id（原始交易 ID） */
  transactionId: string;
  /** 产品 ID */
  productId: string;
}

/**
 * 购买验证结果
 */
export interface AppleVerifyPurchaseResult {
  /** 是否验证成功 */
  valid: boolean;
  /** 交易信息（验证成功时） */
  transaction?: AppleTransactionInfo;
  /** 错误信息（验证失败时） */
  error?: string;
}
