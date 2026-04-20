/**
 * 基于功能权益的访问门控装饰器
 *
 * 与 @RequireSubscription（基于订阅等级）不同，
 * @RequireFeature 直接检查用户当前计划的 entitlements 中对应功能是否开启。
 *
 * 优势: 管理后台修改 subscription_plan.entitlements 后立即生效，
 * 无需修改代码或重新部署，适合需要灵活配置的功能开关。
 *
 * 用法:
 *   @RequireFeature(GatedFeature.FULL_DAY_PLAN)
 */
import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { GatedFeature } from '../../subscription.types';
import { FeatureGuard } from '../guards/feature.guard';

/** 元数据 key */
export const REQUIRED_FEATURE_KEY = 'requiredFeature';

/**
 * 仅设置元数据（需要手动组合 @UseGuards(FeatureGuard)）
 */
export const RequireFeatureKey = (feature: GatedFeature) =>
  SetMetadata(REQUIRED_FEATURE_KEY, feature);

/**
 * 组合装饰器（推荐）— 自动包含 FeatureGuard
 */
export const RequireFeature = (feature: GatedFeature) =>
  applyDecorators(
    SetMetadata(REQUIRED_FEATURE_KEY, feature),
    UseGuards(FeatureGuard),
    ApiForbiddenResponse({ description: '功能未开启，请升级套餐' }),
  );
