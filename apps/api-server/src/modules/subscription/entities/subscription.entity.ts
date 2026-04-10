/**
 * V6 Phase 2.12 — 用户订阅记录 Entity
 *
 * 记录每个用户的当前和历史订阅状态。
 * 一个用户同一时间只有一条 ACTIVE 订阅（或无订阅 = Free）。
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { SubscriptionStatus, PaymentChannel } from '../subscription.types';
import { SubscriptionPlan } from './subscription-plan.entity';

@Entity('subscription')
@Index('idx_subscription_user', ['userId'])
@Index('idx_subscription_user_status', ['userId', 'status'])
@Index('idx_subscription_expires', ['expiresAt'])
export class Subscription {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 关联用户 ID（app_user 表） */
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** 关联订阅计划 */
  @ManyToOne(() => SubscriptionPlan, { eager: true })
  @JoinColumn({ name: 'plan_id' })
  plan: SubscriptionPlan;

  @Column({ type: 'uuid', name: 'plan_id' })
  planId: string;

  /** 订阅状态 */
  @Column({
    type: 'varchar',
    length: 32,
    default: SubscriptionStatus.ACTIVE,
  })
  status: SubscriptionStatus;

  /** 初始支付渠道 */
  @Column({
    type: 'varchar',
    length: 32,
    name: 'payment_channel',
  })
  paymentChannel: PaymentChannel;

  /** 订阅开始时间 */
  @Column({ type: 'timestamptz', name: 'starts_at' })
  startsAt: Date;

  /** 订阅到期时间 */
  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  /** 取消时间（用户主动取消时记录） */
  @Column({ type: 'timestamptz', nullable: true, name: 'cancelled_at' })
  cancelledAt: Date | null;

  /** 是否自动续费 */
  @Column({ type: 'boolean', default: true, name: 'auto_renew' })
  autoRenew: boolean;

  /**
   * 平台订阅 ID（Apple originalTransactionId / 微信 out_trade_no）
   * 用于支付回调匹配和续费追踪
   */
  @Column({
    type: 'varchar',
    length: 512,
    nullable: true,
    name: 'platform_subscription_id',
  })
  platformSubscriptionId: string | null;

  /** 宽限期结束时间（过期后仍允许短暂访问） */
  @Column({ type: 'timestamptz', nullable: true, name: 'grace_period_ends_at' })
  gracePeriodEndsAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
