/**
 * V6.1 — 订阅模块
 *
 * 提供订阅计划管理、用户订阅生命周期、支付记录、用量配额、功能门控和支付集成能力。
 *
 * @Global 标记: 全局可注入，功能门控守卫和用量检查需要在各模块中使用。
 *
 * 数据模型（V6 2.12）:
 * - SubscriptionPlan, Subscription, PaymentRecord, UsageQuota
 *
 * 功能门控（V6 2.13）:
 * - SubscriptionGuard + @RequireSubscription() 装饰器
 *
 * 用量配额（V6 2.14）:
 * - QuotaService: check/increment/reset + Cron 重置
 *
 * 支付集成（V6 2.15 + 2.16）:
 * - AppleIapService: Apple IAP 验证 + S2S 通知
 * - WechatPayService: 微信支付下单 + 通知处理 + 订单查询
 *
 * V6.1 新增:
 * - PlanEntitlementResolver: 套餐能力解析（功能级+能力级双层控制，支持运行时可配置）
 * - PaywallTriggerService: 付费墙触发策略 + 转化漏斗记录
 */
import { Global, Module } from '@nestjs/common';
import { SubscriptionService } from './app/services/subscription.service';
import { SubscriptionGuard } from './app/guards/subscription.guard';
import { QuotaService } from './app/services/quota.service';
import { PlanEntitlementResolver } from './app/services/plan-entitlement-resolver.service';
import { QuotaGateService } from './app/services/quota-gate.service';
import { ResultEntitlementService } from './app/services/result-entitlement.service';
// V6.1: 付费墙触发策略
import { PaywallTriggerService } from './app/services/paywall-trigger.service';
import { AppleIapService } from './app/payment/apple-iap.service';
import { AppleIapController } from './app/controllers/apple-iap.controller';
import { WechatPayService } from './app/payment/wechat-pay.service';
import { WechatPayController } from './app/controllers/wechat-pay.controller';
// Phase 1: 订阅管理后台
import { SubscriptionManagementController } from './admin/subscription-management.controller';
import { SubscriptionManagementService } from './admin/subscription-management.service';
// App 端订阅计划查询
import { SubscriptionPlansController } from './app/controllers/subscription-plans.controller';
// V6.2: 订阅变更事件监听器
import { SubscriptionEventListener } from './app/listeners/subscription-event.listener';
// V6.2: 付费墙分析事件监听器
import { PaywallAnalyticsListener } from './app/listeners/paywall-analytics.listener';
// 基于功能权益的访问门控
import { FeatureGuard } from './app/guards/feature.guard';

@Global()
@Module({
  controllers: [
    AppleIapController,
    WechatPayController,
    SubscriptionManagementController,
    SubscriptionPlansController,
  ],
  providers: [
    PlanEntitlementResolver,
    SubscriptionService,
    SubscriptionGuard,
    QuotaService,
    QuotaGateService,
    ResultEntitlementService,
    PaywallTriggerService, // V6.1: 付费墙触发策略
    AppleIapService,
    WechatPayService,
    SubscriptionManagementService, // Phase 1: 订阅管理后台
    SubscriptionEventListener, // V6.2: 订阅变更事件监听器
    PaywallAnalyticsListener, // V6.2: 付费墙分析监听器
    FeatureGuard, // 基于功能权益的访问门控
  ],
  exports: [
    PlanEntitlementResolver,
    SubscriptionService,
    SubscriptionGuard,
    QuotaService,
    QuotaGateService,
    ResultEntitlementService,
    PaywallTriggerService, // V6.1: 付费墙触发策略
    AppleIapService,
    WechatPayService,
    FeatureGuard, // 基于功能权益的访问门控
  ],
})
export class SubscriptionModule {}
