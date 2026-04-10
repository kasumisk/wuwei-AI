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
import { TypeOrmModule } from '@nestjs/typeorm';
import { SubscriptionPlan } from './entities/subscription-plan.entity';
import { Subscription } from './entities/subscription.entity';
import { PaymentRecord } from './entities/payment-record.entity';
import { UsageQuota } from './entities/usage-quota.entity';
// V6.1: 付费墙触发日志
import { SubscriptionTriggerLog } from './entities/subscription-trigger-log.entity';
import { SubscriptionService } from './app/subscription.service';
import { SubscriptionGuard } from './app/subscription.guard';
import { QuotaService } from './app/quota.service';
import { PlanEntitlementResolver } from './app/plan-entitlement-resolver.service';
import { QuotaGateService } from './app/quota-gate.service';
import { ResultEntitlementService } from './app/result-entitlement.service';
// V6.1: 付费墙触发策略
import { PaywallTriggerService } from './app/paywall-trigger.service';
import { AppleIapService } from './app/apple-iap.service';
import { AppleIapController } from './app/apple-iap.controller';
import { WechatPayService } from './app/wechat-pay.service';
import { WechatPayController } from './app/wechat-pay.controller';
// Phase 1: 订阅管理后台
import { AppUser } from '../user/entities/app-user.entity';
import { SubscriptionManagementController } from './admin/subscription-management.controller';
import { SubscriptionManagementService } from './admin/subscription-management.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      SubscriptionPlan,
      Subscription,
      PaymentRecord,
      UsageQuota,
      SubscriptionTriggerLog, // V6.1: 付费墙触发日志
      AppUser, // Phase 1: 订阅管理后台需要查询用户信息
    ]),
  ],
  controllers: [
    AppleIapController,
    WechatPayController,
    SubscriptionManagementController,
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
  ],
})
export class SubscriptionModule {}
