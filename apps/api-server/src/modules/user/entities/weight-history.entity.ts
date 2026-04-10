import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { AppUser } from './app-user.entity';

/**
 * 体重历史记录表
 *
 * V5 Phase 3.1: 记录用户每次体重变化，支撑 goalProgress 趋势分析。
 * 数据来源:
 *   - 'onboarding': 首次填写档案时自动插入
 *   - 'manual': 用户后续手动更新体重
 *   - 'device': 未来智能设备同步（预留）
 */
@Entity('weight_history')
@Index('idx_weight_history_user_recorded', ['userId', 'recordedAt'])
export class WeightHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => AppUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

  @Column({
    name: 'weight_kg',
    type: 'decimal',
    precision: 5,
    scale: 1,
    comment: '体重(kg)',
  })
  weightKg: number;

  @Column({
    name: 'body_fat_percent',
    type: 'decimal',
    precision: 4,
    scale: 1,
    nullable: true,
    comment: '体脂率(%)',
  })
  bodyFatPercent: number | null;

  @Column({
    name: 'source',
    type: 'varchar',
    length: 20,
    default: "'manual'",
    comment: '数据来源: manual | device | onboarding',
  })
  source: 'manual' | 'device' | 'onboarding';

  @CreateDateColumn({ name: 'recorded_at', comment: '记录时间' })
  recordedAt: Date;
}
