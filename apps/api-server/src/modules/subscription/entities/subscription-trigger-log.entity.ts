/**
 * V6.1 Phase 1.7 — 订阅付费墙触发日志 Entity
 *
 * 记录每次付费墙触发事件，用于转化漏斗分析和 A/B 实验。
 * 设计文档参考: Section 6.5 subscription_trigger_log
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 触发场景枚举
 *
 * analysis_limit: 配额耗尽触发
 * advanced_result: 高级结果被裁剪触发
 * history_view: 历史记录查看限制触发
 * precision_upgrade: 精准度/深度升级触发
 */
export enum TriggerScene {
  ANALYSIS_LIMIT = 'analysis_limit',
  ADVANCED_RESULT = 'advanced_result',
  HISTORY_VIEW = 'history_view',
  PRECISION_UPGRADE = 'precision_upgrade',
}

@Entity('subscription_trigger_log')
@Index('idx_trigger_log_user_id', ['userId'])
@Index('idx_trigger_log_user_created', ['userId', 'createdAt'])
@Index('idx_trigger_log_scene', ['triggerScene'])
@Index('idx_trigger_log_converted', ['converted'])
export class SubscriptionTriggerLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 用户 ID */
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** 触发场景 */
  @Column({ type: 'varchar', length: 30, name: 'trigger_scene' })
  triggerScene: string;

  /** 对应的功能标识（如 ai_text_analysis、deep_nutrition） */
  @Column({ type: 'varchar', length: 50 })
  feature: string;

  /** 触发时的订阅等级 */
  @Column({ type: 'varchar', length: 20, name: 'current_tier' })
  currentTier: string;

  /** 推荐升级到的档位 */
  @Column({ type: 'varchar', length: 20, name: 'recommended_plan' })
  recommendedPlan: string;

  /** A/B 实验桶（可选，用于实验分组） */
  @Column({ type: 'varchar', length: 20, nullable: true, name: 'ab_bucket' })
  abBucket: string | null;

  /** 是否已转化（后续订阅成功时回写） */
  @Column({ type: 'boolean', default: false })
  converted: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
