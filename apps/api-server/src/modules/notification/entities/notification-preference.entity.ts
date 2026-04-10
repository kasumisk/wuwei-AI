/**
 * V6 Phase 1.11 — 用户通知偏好 Entity
 *
 * 用户可配置接收哪些类型的通知、设置免打扰时段。
 * 每个用户一条记录，不存在则使用默认全开。
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('notification_preference')
@Index('idx_notification_pref_user', ['userId'], { unique: true })
export class NotificationPreference {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  /** 是否启用推送通知（全局开关） */
  @Column({ name: 'push_enabled', type: 'boolean', default: true })
  pushEnabled: boolean;

  /** 允许接收的通知类型列表，空数组 = 全部接收 */
  @Column({ name: 'enabled_types', type: 'jsonb', default: '[]' })
  enabledTypes: string[];

  /** 免打扰开始时间（用户本地时间 HH:mm，如 '22:00'） */
  @Column({ name: 'quiet_start', type: 'varchar', length: 5, nullable: true })
  quietStart: string | null;

  /** 免打扰结束时间（用户本地时间 HH:mm，如 '08:00'） */
  @Column({ name: 'quiet_end', type: 'varchar', length: 5, nullable: true })
  quietEnd: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
