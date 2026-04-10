/**
 * V6 Phase 2.13 — 订阅等级要求装饰器
 *
 * 用法:
 *   @RequireSubscription('pro')          — 要求至少 Pro 等级
 *   @RequireSubscription('premium')      — 要求 Premium 等级
 *
 * 配合 SubscriptionGuard 使用：
 *   方式一（自动组合）: @RequireSubscription('pro') 已内置 UseGuards
 *   方式二（手动组合）: @RequireSubscriptionTier('pro') + @UseGuards(SubscriptionGuard)
 *
 * 原理:
 *   通过 SetMetadata 将最低等级写入路由元数据，
 *   SubscriptionGuard 在请求时读取元数据并对比用户实际等级。
 */
import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { SubscriptionTier } from '../subscription.types';
import { SubscriptionGuard } from './subscription.guard';

/** 元数据 key */
export const SUBSCRIPTION_TIER_KEY = 'requiredSubscriptionTier';

/**
 * 仅设置元数据（需要手动组合 @UseGuards(SubscriptionGuard)）
 *
 * @param tier 最低订阅等级
 */
export const RequireSubscriptionTier = (tier: SubscriptionTier) =>
  SetMetadata(SUBSCRIPTION_TIER_KEY, tier);

/**
 * 组合装饰器（推荐使用）— 自动包含 SubscriptionGuard
 *
 * @param tier 最低订阅等级
 *
 * @example
 * ```ts
 * @Post('full-day-plan')
 * @RequireSubscription(SubscriptionTier.PREMIUM)
 * async createFullDayPlan(@CurrentAppUser() user: AppUserPayload) { ... }
 * ```
 */
export const RequireSubscription = (tier: SubscriptionTier) =>
  applyDecorators(
    SetMetadata(SUBSCRIPTION_TIER_KEY, tier),
    UseGuards(SubscriptionGuard),
    ApiForbiddenResponse({
      description: `需要 ${tier} 或更高等级订阅`,
    }),
  );
