/**
 * V6 Phase 2.12 — 支付记录 Entity
 *
 * 记录每次支付事务的完整生命周期。
 * 用于对账、退款追踪和审计。
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { PaymentChannel, PaymentStatus } from '../subscription.types';

@Entity('payment_record')
@Index('idx_payment_user', ['userId'])
@Index('idx_payment_order', ['orderNo'], { unique: true })
@Index('idx_payment_status', ['status'])
@Index('idx_payment_channel_status', ['channel', 'status'])
export class PaymentRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 关联用户 ID */
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** 关联订阅 ID（可选，手动充值等场景无订阅） */
  @Column({ type: 'uuid', nullable: true, name: 'subscription_id' })
  subscriptionId: string | null;

  /** 系统订单号（唯一，用于防重放） */
  @Column({ type: 'varchar', length: 64, name: 'order_no' })
  orderNo: string;

  /** 支付渠道 */
  @Column({ type: 'varchar', length: 32 })
  channel: PaymentChannel;

  /** 支付金额（单位: 分） */
  @Column({ type: 'int', name: 'amount_cents' })
  amountCents: number;

  /** 货币代码 */
  @Column({ type: 'varchar', length: 8, default: 'CNY' })
  currency: string;

  /** 支付状态 */
  @Column({ type: 'varchar', length: 32, default: PaymentStatus.PENDING })
  status: PaymentStatus;

  /**
   * 平台交易 ID（Apple transaction_id / 微信 transaction_id）
   * 支付成功后由回调写入
   */
  @Column({
    type: 'varchar',
    length: 512,
    nullable: true,
    name: 'platform_transaction_id',
  })
  platformTransactionId: string | null;

  /**
   * 平台原始回调数据 JSONB
   * 用于审计和争议处理
   */
  @Column({ type: 'jsonb', nullable: true, name: 'callback_payload' })
  callbackPayload: Record<string, unknown> | null;

  /** 退款金额（单位: 分，0 = 未退款） */
  @Column({ type: 'int', default: 0, name: 'refund_amount_cents' })
  refundAmountCents: number;

  /** 支付完成时间 */
  @Column({ type: 'timestamptz', nullable: true, name: 'paid_at' })
  paidAt: Date | null;

  /** 退款时间 */
  @Column({ type: 'timestamptz', nullable: true, name: 'refunded_at' })
  refundedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
