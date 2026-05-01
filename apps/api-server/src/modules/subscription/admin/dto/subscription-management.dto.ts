import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsEnum,
  IsInt,
  IsBoolean,
  IsObject,
  IsArray,
  ValidateNested,
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

export class SubscriptionStoreProductInputDto {
  @ApiProperty({ description: '支付/订阅 provider，例如 revenuecat / wechat_pay' })
  @IsString()
  provider: string;

  @ApiProperty({ description: '商店，例如 app_store / play_store / wechat' })
  @IsString()
  store: string;

  @ApiProperty({ description: '第三方商品 ID' })
  @IsString()
  productId: string;

  @ApiPropertyOptional({ description: 'RevenueCat offering ID' })
  @IsOptional()
  @IsString()
  offeringId?: string;

  @ApiPropertyOptional({ description: 'RevenueCat package ID' })
  @IsOptional()
  @IsString()
  packageId?: string;

  @ApiPropertyOptional({ description: '商品环境', default: 'production' })
  @IsOptional()
  @IsString()
  environment?: string;

  @ApiPropertyOptional({ description: '是否启用', default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isActive?: boolean;
}

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

  @ApiPropertyOptional({
    description: '第三方商品映射。付费海外套餐至少需要 revenuecat/app_store 与 revenuecat/play_store。',
    type: [SubscriptionStoreProductInputDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubscriptionStoreProductInputDto)
  storeProducts?: SubscriptionStoreProductInputDto[];

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

  @ApiPropertyOptional({
    description: '第三方商品映射。传入时按套餐整体替换。',
    type: [SubscriptionStoreProductInputDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubscriptionStoreProductInputDto)
  storeProducts?: SubscriptionStoreProductInputDto[];

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

  @ApiPropertyOptional({ description: '订阅等级', enum: SubscriptionTier })
  @IsOptional()
  @IsEnum(SubscriptionTier)
  tier?: SubscriptionTier;

  @ApiPropertyOptional({ description: '支付渠道', enum: PaymentChannel })
  @IsOptional()
  @IsEnum(PaymentChannel)
  paymentChannel?: PaymentChannel;

  @ApiPropertyOptional({ description: '关键词（用户ID / 昵称 / 邮箱）' })
  @IsOptional()
  @IsString()
  keyword?: string;

  @ApiPropertyOptional({ description: '平台订阅 ID' })
  @IsOptional()
  @IsString()
  platformSubscriptionId?: string;

  @ApiPropertyOptional({ description: 'RevenueCat / Store 商品 ID' })
  @IsOptional()
  @IsString()
  productId?: string;

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

  @ApiPropertyOptional({ description: '是否存在退款记录' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasRefundRecord?: boolean;

  @ApiPropertyOptional({ description: '是否存在手动权益' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasManualEntitlement?: boolean;

  @ApiPropertyOptional({ description: '是否存在 RevenueCat 信号' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  hasRevenueCatSignal?: boolean;

  @ApiPropertyOptional({ description: 'Webhook 处理状态，例如 failed / processed' })
  @IsOptional()
  @IsString()
  webhookProcessingStatus?: string;

  @ApiPropertyOptional({ description: '排序字段，例如 createdAt / expiresAt / latestTransactionAt / latestWebhookAt' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ description: '排序方向 asc / desc' })
  @IsOptional()
  @IsString()
  sortOrder?: string;
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

export class SubscriptionResyncDto {
  @ApiPropertyOptional({ description: '重同步原因说明' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class AdminSubscriptionActionDto {
  @ApiPropertyOptional({ description: '操作原因说明' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class GrantManualEntitlementDto {
  @ApiProperty({ description: '权益编码' })
  @IsString()
  entitlementCode: string;

  @ApiProperty({ description: '权益值，可为 boolean/number/string/json' })
  value: unknown;

  @ApiPropertyOptional({ description: '失效时间 ISO 字符串，不传表示长期有效' })
  @IsOptional()
  @IsString()
  effectiveTo?: string;

  @ApiPropertyOptional({ description: '授权原因说明' })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class RevokeManualEntitlementDto {
  @ApiProperty({ description: '用户权益记录 ID' })
  @IsUUID()
  userEntitlementId: string;

  @ApiPropertyOptional({ description: '撤销原因说明' })
  @IsOptional()
  @IsString()
  reason?: string;
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

export class GetSubscriptionTimelineQueryDto {
  @ApiPropertyOptional({ description: '限制返回条数', default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}

export class GetSubscriptionAnomaliesQueryDto {
  @ApiPropertyOptional({ description: '每类异常返回条数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class GetSubscriptionMaintenanceJobsQueryDto {
  @ApiPropertyOptional({ description: '返回任务数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class GetSubscriptionMaintenanceDlqQueryDto {
  @ApiPropertyOptional({ description: 'DLQ 状态 pending / retried / discarded' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ description: '返回任务数', default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
