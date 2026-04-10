/**
 * V6 Phase 1.10 — 预计算推荐结果 Entity
 *
 * 存储离线预计算的每日推荐结果。
 * 凌晨 Cron 为活跃用户生成次日三餐推荐，
 * 用户请求时优先读取预计算结果（延迟 < 200ms），未命中则回退到实时计算。
 *
 * 唯一约束: (userId, date, mealType) — 每个用户每天每餐仅一条预计算
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('precomputed_recommendations')
@Index('idx_precomputed_lookup', ['userId', 'date', 'mealType'], {
  unique: true,
})
@Index('idx_precomputed_expires', ['expiresAt'])
export class PrecomputedRecommendation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  /** 日期 YYYY-MM-DD */
  @Column({ name: 'date', type: 'varchar', length: 10 })
  date: string;

  /** 餐次类型: breakfast / lunch / dinner / snack */
  @Column({ name: 'meal_type', type: 'varchar', length: 20 })
  mealType: string;

  /** 预计算推荐结果 JSON（MealRecommendation 结构） */
  @Column({ name: 'result', type: 'jsonb' })
  result: Record<string, unknown>;

  /** 场景化推荐结果 JSON（takeout/convenience/homeCook） */
  @Column({ name: 'scenario_results', type: 'jsonb', nullable: true })
  scenarioResults: Record<string, unknown> | null;

  /** 策略版本（用于失效判断，画像变更时版本递增） */
  @Column({ name: 'strategy_version', type: 'varchar', length: 50 })
  strategyVersion: string;

  /** 预计算时间 */
  @CreateDateColumn({ name: 'computed_at' })
  computedAt: Date;

  /** 过期时间（默认次日 23:59:59） */
  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  /** 用户是否实际使用了此预计算 */
  @Column({ name: 'is_used', type: 'boolean', default: false })
  isUsed: boolean;
}
