import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  IsBoolean,
  IsObject,
  Min,
  Max,
  IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  SubscriptionTier,
  BillingCycle,
  SubscriptionStatus,
  PaymentChannel,
  PaymentStatus,
  GatedFeature,
  FeatureEntitlements,
} from '../../subscription.types';

// ==================== 订阅计划 ====================

/**
 * 查询订阅计划列表
 */
export class GetSubscriptionPlansQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @ApiPropertyOptional({ enum: SubscriptionTier })
  @IsOptional()
  @IsEnum(SubscriptionTier)
  tier?: SubscriptionTier;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

/**
 * 创建订阅计划
 */
export class CreateSubscriptionPlanDto {
  @ApiProperty({ description: '计划名称' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: '计划描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '订阅等级', enum: SubscriptionTier })
  @IsEnum(SubscriptionTier)
  tier: SubscriptionTier;

  @ApiProperty({ description: '计费周期', enum: BillingCycle })
  @IsEnum(BillingCycle)
  billingCycle: BillingCycle;

  @ApiProperty({ description: '价格（单位: 分）' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents: number;

  @ApiPropertyOptional({ description: '货币代码', default: 'CNY' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiProperty({ description: '功能权益配置' })
  @IsObject()
  entitlements: FeatureEntitlements;

  @ApiPropertyOptional({ description: 'Apple IAP 产品 ID' })
  @IsOptional()
  @IsString()
  appleProductId?: string;

  @ApiPropertyOptional({ description: '微信支付商品 ID' })
  @IsOptional()
  @IsString()
  wechatProductId?: string;

  @ApiPropertyOptional({ description: '排序权重' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;
}

/**
 * 更新订阅计划（所有字段可选）
 */
export class UpdateSubscriptionPlanDto {
  @ApiPropertyOptional({ description: '计划名称' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: '计划描述' })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ description: '订阅等级', enum: SubscriptionTier })
  @IsOptional()
  @IsEnum(SubscriptionTier)
  tier?: SubscriptionTier;

  @ApiPropertyOptional({ description: '计费周期', enum: BillingCycle })
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  @ApiPropertyOptional({ description: '价格（单位: 分）' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  priceCents?: number;

  @ApiPropertyOptional({ description: '货币代码' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: '功能权益配置' })
  @IsOptional()
  @IsObject()
  entitlements?: FeatureEntitlements;

  @ApiPropertyOptional({ description: 'Apple IAP 产品 ID' })
  @IsOptional()
  @IsString()
  appleProductId?: string;

  @ApiPropertyOptional({ description: '微信支付商品 ID' })
  @IsOptional()
  @IsString()
  wechatProductId?: string;

  @ApiPropertyOptional({ description: '排序权重' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  sortOrder?: number;

  @ApiPropertyOptional({ description: '是否上架' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

// ==================== 用户订阅 ====================

/**
 * 查询用户订阅列表
 */
export class GetSubscriptionsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @ApiPropertyOptional({ description: '用户 ID' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: '订阅状态', enum: SubscriptionStatus })
  @IsOptional()
  @IsEnum(SubscriptionStatus)
  status?: SubscriptionStatus;

  @ApiPropertyOptional({ description: '支付渠道', enum: PaymentChannel })
  @IsOptional()
  @IsEnum(PaymentChannel)
  paymentChannel?: PaymentChannel;

  @ApiPropertyOptional({ description: '计划 ID' })
  @IsOptional()
  @IsUUID()
  planId?: string;

  @ApiPropertyOptional({ description: '开始日期（创建时间起始）' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期（创建时间截止）' })
  @IsOptional()
  @IsString()
  endDate?: string;
}

/**
 * 延长订阅
 */
export class ExtendSubscriptionDto {
  @ApiProperty({ description: '延长天数', minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  extendDays: number;
}

/**
 * 变更订阅计划
 */
export class ChangeSubscriptionPlanDto {
  @ApiProperty({ description: '新计划 ID' })
  @IsUUID()
  newPlanId: string;
}

// ==================== 支付记录 ====================

/**
 * 查询支付记录列表
 */
export class GetPaymentRecordsQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 10;

  @ApiPropertyOptional({ description: '用户 ID' })
  @IsOptional()
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({ description: '支付状态', enum: PaymentStatus })
  @IsOptional()
  @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ description: '支付渠道', enum: PaymentChannel })
  @IsOptional()
  @IsEnum(PaymentChannel)
  channel?: PaymentChannel;

  @ApiPropertyOptional({ description: '开始日期' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: '结束日期' })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiPropertyOptional({ description: '订单号' })
  @IsOptional()
  @IsString()
  orderNo?: string;
}

// ==================== 用量配额 ====================

/**
 * 查询用户用量配额
 */
export class GetUsageQuotasQueryDto {
  @ApiProperty({ description: '用户 ID' })
  @IsUUID()
  userId: string;

  @ApiPropertyOptional({ description: '功能标识', enum: GatedFeature })
  @IsOptional()
  @IsEnum(GatedFeature)
  feature?: GatedFeature;
}

// ==================== 付费墙触发统计 ====================

/**
 * 查询付费墙触发统计
 */
export class GetTriggerStatsQueryDto {
  @ApiPropertyOptional({ description: '统计天数', default: 30 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(365)
  days?: number = 30;

  @ApiPropertyOptional({ description: '功能标识' })
  @IsOptional()
  @IsString()
  feature?: string;

  @ApiPropertyOptional({ description: '触发场景' })
  @IsOptional()
  @IsString()
  triggerScene?: string;
}
