/**
 * V6 Phase 2.1 — 推荐策略 Entity
 *
 * 存储推荐策略的完整配置。策略由管理后台创建/编辑，
 * 通过 StrategyResolver 在推荐时动态选择。
 *
 * JSONB 存储策略配置，支持:
 * - 全局默认策略
 * - 按目标类型的策略
 * - A/B 实验组绑定的策略
 * - 用户级个性化策略
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import {
  StrategyConfig,
  StrategyStatus,
  StrategyScope,
} from '../strategy.types';

@Entity('strategy')
@Index('idx_strategy_scope_status', ['scope', 'status'])
@Index('idx_strategy_scope_target', ['scope', 'scopeTarget', 'status'])
export class Strategy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 策略名称（人类可读，如 "减脂高蛋白策略 v2"） */
  @Column({ type: 'varchar', length: 128 })
  name: string;

  /** 策略描述（可选） */
  @Column({ type: 'text', nullable: true })
  description: string | null;

  /** 策略适用范围 */
  @Column({
    type: 'varchar',
    length: 32,
    default: StrategyScope.GLOBAL,
  })
  scope: StrategyScope;

  /**
   * 策略范围目标（与 scope 配合）
   * - scope=GLOBAL: null
   * - scope=GOAL_TYPE: 'fat_loss' / 'muscle_gain' / 'health' / 'habit'
   * - scope=EXPERIMENT: 实验 ID
   * - scope=USER: 用户 ID
   */
  @Column({
    type: 'varchar',
    length: 128,
    nullable: true,
    name: 'scope_target',
  })
  scopeTarget: string | null;

  /** 策略配置（核心 JSONB 字段） */
  @Column({ type: 'jsonb', default: {} })
  config: StrategyConfig;

  /** 策略状态 */
  @Column({
    type: 'varchar',
    length: 16,
    default: StrategyStatus.DRAFT,
  })
  status: StrategyStatus;

  /** 版本号（每次编辑递增，用于缓存失效） */
  @Column({ type: 'int', default: 1 })
  version: number;

  /** 优先级（同 scope + status=active 时，数值越高优先级越高） */
  @Column({ type: 'int', default: 0 })
  priority: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
