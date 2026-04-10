import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
  Index,
} from 'typeorm';
import { AppUser } from './app-user.entity';

/**
 * 提醒关闭记录表
 *
 * V5 Phase 3.9: 记录用户已关闭的提醒类型，实现提醒去重。
 * 同一用户 + 同一 reminderType 只存一条记录（UNIQUE 约束），
 * dismissedAt 记录最近一次关闭时间，用于判断是否超过冷却期。
 */
@Entity('reminder_dismissals')
@Unique('uq_reminder_user_type', ['userId', 'reminderType'])
export class ReminderDismissal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  @ManyToOne(() => AppUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

  @Column({
    name: 'reminder_type',
    type: 'varchar',
    length: 50,
    comment: '提醒类型，对应 CollectionReminder.field',
  })
  reminderType: string;

  @CreateDateColumn({
    name: 'dismissed_at',
    comment: '最近一次关闭时间',
  })
  dismissedAt: Date;
}
