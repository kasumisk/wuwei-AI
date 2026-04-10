import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 实验状态
 */
export enum ExperimentStatus {
  DRAFT = 'draft',
  RUNNING = 'running',
  PAUSED = 'paused',
  COMPLETED = 'completed',
}

/**
 * 实验分组配置
 */
export interface ExperimentGroup {
  /** 分组名称，如 'control', 'variant_a', 'variant_b' */
  name: string;
  /** 流量占比 0-1，所有组之和应 = 1.0 */
  trafficRatio: number;
  /** 该组使用的评分权重覆盖（可选，null 表示使用默认权重） */
  scoreWeightOverrides?: Record<string, number[]> | null;
  /** 该组使用的餐次权重修正覆盖 */
  mealWeightOverrides?: Record<string, Record<string, number>> | null;
}

/**
 * A/B 实验实体
 * 支持评分权重按实验组动态加载
 *
 * 设计原则：
 * - 每个实验针对一个目标类型（如 fat_loss）或所有目标（goalType = '*'）
 * - 用户分组基于 userId 哈希，确保同一用户始终在同一组
 * - 权重覆盖只影响 SCORE_WEIGHTS，不影响 MEAL_WEIGHT_MODIFIERS / STATUS_WEIGHT_MODIFIERS
 */
@Entity('ab_experiments')
@Index(['status'])
export class ABExperiment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 实验名称（人类可读） */
  @Column({ length: 100 })
  name: string;

  /** 实验描述 */
  @Column({ type: 'text', nullable: true })
  description: string;

  /** 目标类型过滤：'*' 表示所有目标类型 */
  @Column({
    name: 'goal_type',
    length: 30,
    default: '*',
  })
  goalType: string;

  /** 实验状态 */
  @Column({
    type: 'enum',
    enum: ExperimentStatus,
    default: ExperimentStatus.DRAFT,
  })
  status: ExperimentStatus;

  /** 实验分组配置（JSON 数组） */
  @Column({ type: 'jsonb', default: '[]' })
  groups: ExperimentGroup[];

  /** 实验开始时间 */
  @Column({ name: 'start_date', type: 'timestamp', nullable: true })
  startDate: Date;

  /** 实验结束时间 */
  @Column({ name: 'end_date', type: 'timestamp', nullable: true })
  endDate: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
