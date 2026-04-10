/**
 * V6 Phase 2.12 — 订阅计划 Entity
 *
 * 定义 Free / Pro / Premium 等订阅计划的价格、周期和功能列表。
 * 管理后台可动态创建/修改计划，支持 A/B 定价实验。
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import {
  SubscriptionTier,
  BillingCycle,
  FeatureEntitlements,
} from '../subscription.types';

@Entity('subscription_plan')
@Index('idx_subscription_plan_tier', ['tier'])
@Index('idx_subscription_plan_active', ['isActive'])
export class SubscriptionPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 计划名称（如 "Pro 月付"、"Premium 年付"） */
  @Column({ type: 'varchar', length: 128 })
  name: string;

  /** 计划描述 */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 订阅等级 */
  @Column({ type: 'varchar', length: 32 })
  tier: SubscriptionTier;

  /** 计费周期 */
  @Column({
    type: 'varchar',
    length: 32,
    name: 'billing_cycle',
  })
  billingCycle: BillingCycle;

  /** 价格（单位: 分，避免浮点精度问题） */
  @Column({ type: 'int', name: 'price_cents' })
  priceCents: number;

  /** 货币代码（ISO 4217，如 CNY / USD） */
  @Column({ type: 'varchar', length: 8, default: 'CNY' })
  currency: string;

  /**
   * 功能权益配置 JSONB
   * 记录该计划包含的所有功能和对应限额
   */
  @Column({ type: 'jsonb', name: 'entitlements' })
  entitlements: FeatureEntitlements;

  /** Apple IAP 产品 ID（用于 iOS 内购） */
  @Column({
    type: 'varchar',
    length: 256,
    nullable: true,
    name: 'apple_product_id',
  })
  appleProductId: string | null;

  /** 微信支付商品 ID */
  @Column({
    type: 'varchar',
    length: 256,
    nullable: true,
    name: 'wechat_product_id',
  })
  wechatProductId: string | null;

  /** 排序权重（前端展示用） */
  @Column({ type: 'int', default: 0, name: 'sort_order' })
  sortOrder: number;

  /** 是否上架 */
  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
