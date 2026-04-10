/**
 * V6 Phase 2.1 — 策略分配 Entity
 *
 * 记录用户→策略的映射关系。
 * 支持 A/B 实验分配、管理后台手动分配、画像段自动分配。
 *
 * 分配优先级: MANUAL > EXPERIMENT > SEGMENT > GLOBAL默认
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { AssignmentType } from '../strategy.types';

@Entity('strategy_assignment')
@Index('idx_strategy_assignment_user', ['userId'])
@Index('idx_strategy_assignment_user_type', ['userId', 'assignmentType'])
@Index('idx_strategy_assignment_strategy', ['strategyId'])
export class StrategyAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 用户 ID */
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** 关联的策略 ID */
  @Column({ type: 'uuid', name: 'strategy_id' })
  strategyId: string;

  /** 分配类型 */
  @Column({
    type: 'varchar',
    length: 32,
    name: 'assignment_type',
    default: AssignmentType.MANUAL,
  })
  assignmentType: AssignmentType;

  /**
   * 分配来源标识
   * - EXPERIMENT: 实验 ID
   * - SEGMENT: 段落名称
   * - MANUAL: 操作人员 ID
   */
  @Column({ type: 'varchar', length: 128, nullable: true })
  source: string | null;

  /** 分配是否生效 */
  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  /** 生效开始时间（可选，用于定时策略） */
  @Column({ type: 'timestamptz', nullable: true, name: 'active_from' })
  activeFrom: Date | null;

  /** 生效结束时间（可选，用于限时策略） */
  @Column({ type: 'timestamptz', nullable: true, name: 'active_until' })
  activeUntil: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
