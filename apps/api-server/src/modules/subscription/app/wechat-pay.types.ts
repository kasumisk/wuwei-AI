/**
 * V6 Phase 2.16 — 微信支付类型定义
 *
 * 对应微信支付 API v3 的数据结构。
 * 参考: https://pay.weixin.qq.com/docs/merchant/apis/in-app-payment/direct-jsons/app-prepay.html
 */

// ==================== 下单请求 ====================

/**
 * 微信支付 APP 下单请求
 */
export interface WechatPayCreateOrderRequest {
  /** 应用 ID */
  appid: string;
  /** 商户号 */
  mchid: string;
  /** 商品描述 */
  description: string;
  /** 商户订单号（对应我们的 orderNo） */
  out_trade_no: string;
  /** 通知 URL */
  notify_url: string;
  /** 订单金额 */
  amount: {
    /** 金额（单位: 分） */
    total: number;
    /** 货币代码 */
    currency: string;
  };
}

/**
 * 微信支付 APP 下单响应
 */
export interface WechatPayCreateOrderResponse {
  /** 预支付交易会话标识（用于客户端唤起支付） */
  prepay_id: string;
}

// ==================== 支付通知 ====================

/**
 * 微信支付通知 — 加密资源
 */
export interface WechatPayNotificationResource {
  /** 原始类型 */
  original_type: string;
  /** 加密算法 */
  algorithm: 'AEAD_AES_256_GCM';
  /** 密文 */
  ciphertext: string;
  /** 关联数据 */
  associated_data: string;
  /** 随机串 */
  nonce: string;
}

/**
 * 微信支付通知请求体
 */
export interface WechatPayNotificationBody {
  /** 通知 ID */
  id: string;
  /** 创建时间 */
  create_time: string;
  /** 资源类型 */
  resource_type: string;
  /** 通知类型 */
  event_type:
    | 'TRANSACTION.SUCCESS'
    | 'REFUND.SUCCESS'
    | 'REFUND.ABNORMAL'
    | 'REFUND.CLOSED';
  /** 概要 */
  summary: string;
  /** 加密资源 */
  resource: WechatPayNotificationResource;
}

/**
 * 微信支付通知解密后的交易结果
 */
export interface WechatPayTransactionResult {
  /** 应用 ID */
  appid: string;
  /** 商户号 */
  mchid: string;
  /** 商户订单号 */
  out_trade_no: string;
  /** 微信支付订单号 */
  transaction_id: string;
  /** 交易类型 */
  trade_type: 'APP' | 'JSAPI' | 'NATIVE' | 'MWEB';
  /** 交易状态 */
  trade_state:
    | 'SUCCESS'
    | 'REFUND'
    | 'NOTPAY'
    | 'CLOSED'
    | 'REVOKED'
    | 'USERPAYING'
    | 'PAYERROR';
  /** 交易状态描述 */
  trade_state_desc: string;
  /** 支付完成时间（RFC 3339） */
  success_time?: string;
  /** 付款者 */
  payer: {
    openid: string;
  };
  /** 订单金额 */
  amount: {
    total: number;
    payer_total: number;
    currency: string;
    payer_currency: string;
  };
}

// ==================== 客户端调起支付参数 ====================

/**
 * APP 调起微信支付所需参数
 *
 * 服务端预下单后返回给客户端，客户端使用这些参数调起微信支付 SDK。
 */
export interface WechatPayAppParams {
  /** 应用 ID */
  appid: string;
  /** 商户号 */
  partnerid: string;
  /** 预支付交易会话标识 */
  prepayid: string;
  /** 扩展字段（固定 "Sign=WXPay"） */
  package: string;
  /** 随机字符串 */
  noncestr: string;
  /** 时间戳（秒） */
  timestamp: string;
  /** 签名 */
  sign: string;
}
