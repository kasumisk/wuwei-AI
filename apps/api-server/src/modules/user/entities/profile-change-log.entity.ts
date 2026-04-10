/**
 * V6 Phase 2.17 — 画像变更日志 Entity
 *
 * 记录用户画像每次变更的前后快照、变更原因和触发来源。
 * 用于:
 * - 画像回溯: 查看用户画像在某个时间点的状态
 * - 变更审计: 追踪画像为何变化、由哪个事件触发
 * - 调试: 推荐结果异常时回溯画像变化链路
 * - 版本化: 每次变更自动递增版本号
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 画像变更类型
 */
export type ProfileChangeType =
  | 'preference_weights' // 偏好权重变更
  | 'behavior' // 行为画像变更
  | 'inferred' // 推断画像变更
  | 'declared' // 用户声明信息变更（手动修改目标/过敏原等）
  | 'short_term' // 短期画像变更
  | 'segment'; // 用户细分变更

/**
 * 变更来源
 */
export type ProfileChangeSource =
  | 'feedback' // 用户反馈触发
  | 'meal_record' // 饮食记录触发
  | 'cron' // 定时任务触发
  | 'manual' // 用户手动修改
  | 'event' // 域事件触发
  | 'migration' // 数据迁移
  | 'admin'; // 管理员操作

@Entity('profile_change_log')
@Index('idx_profile_change_log_user', ['userId'])
@Index('idx_profile_change_log_user_type', ['userId', 'changeType'])
@Index('idx_profile_change_log_user_version', ['userId', 'version'])
@Index('idx_profile_change_log_created', ['createdAt'])
export class ProfileChangeLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 关联用户 ID */
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** 画像版本号（每次变更自动递增） */
  @Column({ type: 'int' })
  version: number;

  /** 变更类型 */
  @Column({ type: 'varchar', length: 32, name: 'change_type' })
  changeType: ProfileChangeType;

  /** 变更来源 */
  @Column({ type: 'varchar', length: 32 })
  source: ProfileChangeSource;

  /** 变更的字段列表 */
  @Column({ type: 'jsonb', name: 'changed_fields' })
  changedFields: string[];

  /**
   * 变更前的值（仅记录变更字段的前值）
   * 例: { "preferenceWeights": { "health": 0.3, "taste": 0.7 } }
   */
  @Column({ type: 'jsonb', name: 'before_values' })
  beforeValues: Record<string, unknown>;

  /**
   * 变更后的值（仅记录变更字段的后值）
   * 例: { "preferenceWeights": { "health": 0.5, "taste": 0.5 } }
   */
  @Column({ type: 'jsonb', name: 'after_values' })
  afterValues: Record<string, unknown>;

  /**
   * 触发事件名称（如 'user.feedback.submitted'）
   * 可为空（如手动修改无对应事件）
   */
  @Column({
    type: 'varchar',
    length: 128,
    nullable: true,
    name: 'trigger_event',
  })
  triggerEvent: string | null;

  /**
   * 变更原因描述（人类可读）
   * 例: "用户连续 3 天拒绝辣味食物，降低辣味偏好权重"
   */
  @Column({ type: 'text', nullable: true })
  reason: string | null;

  /**
   * 额外元数据（灵活扩展）
   * 例: { "feedbackId": "xxx", "cronJobName": "weekly-inference" }
   */
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
