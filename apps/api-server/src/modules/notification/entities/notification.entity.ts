/**
 * V6 Phase 1.11 — 站内信 Entity
 *
 * 存储系统发送给用户的通知/站内信。
 * 每条通知有类型、标题、正文、已读状态。
 * 支持按用户查询未读列表 + 标记已读。
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/** 通知类型枚举 */
export type NotificationType =
  | 'meal_reminder' // 餐次提醒
  | 'streak_risk' // 连续性风险
  | 'goal_progress' // 目标进展
  | 'weekly_report' // 周报就绪
  | 'coach_nudge' // 教练提醒
  | 'precomputed_ready' // 推荐就绪
  | 'system'; // 系统通知

@Entity('notification')
@Index('idx_notification_user_unread', ['userId', 'isRead'])
@Index('idx_notification_user_created', ['userId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** 通知类型 */
  @Column({ name: 'type', type: 'varchar', length: 30 })
  type: NotificationType;

  /** 通知标题 */
  @Column({ name: 'title', type: 'varchar', length: 200 })
  title: string;

  /** 通知正文 */
  @Column({ name: 'body', type: 'text' })
  body: string;

  /** 附加数据（JSON，可存跳转链接等） */
  @Column({ name: 'data', type: 'jsonb', nullable: true })
  data: Record<string, unknown> | null;

  /** 是否已读 */
  @Column({ name: 'is_read', type: 'boolean', default: false })
  isRead: boolean;

  /** 已读时间 */
  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt: Date | null;

  /** 是否已推送到设备 */
  @Column({ name: 'is_pushed', type: 'boolean', default: false })
  isPushed: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
