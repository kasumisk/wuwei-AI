/**
 * V6 Phase 2.12 — 用量配额 Entity
 *
 * 追踪每个用户每个受限功能的用量。
 * 配额按周期（日/周/月）重置。
 * 查询时对比 used vs limit 决定是否放行。
 *
 * 设计决策:
 * - limit 来自 SubscriptionPlan.entitlements，存储在此表以支持管理员个性化调整
 * - -1 表示无限制
 * - 每个 (userId, feature, cycle) 唯一
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { GatedFeature, QuotaCycle } from '../subscription.types';

@Entity('usage_quota')
@Index('idx_usage_quota_user_feature', ['userId', 'feature'], { unique: true })
@Index('idx_usage_quota_reset', ['resetAt'])
export class UsageQuota {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 关联用户 ID */
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** 受限功能标识 */
  @Column({ type: 'varchar', length: 64 })
  feature: GatedFeature;

  /** 当前已使用次数 */
  @Column({ type: 'int', default: 0 })
  used: number;

  /** 配额上限（-1 = 无限） */
  @Column({ type: 'int', name: 'quota_limit', default: 0 })
  quotaLimit: number;

  /** 重置周期 */
  @Column({
    type: 'varchar',
    length: 16,
    default: QuotaCycle.DAILY,
  })
  cycle: QuotaCycle;

  /** 下次重置时间 */
  @Column({ type: 'timestamptz', name: 'reset_at' })
  resetAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
