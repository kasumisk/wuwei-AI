import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AppUser } from './app-user.entity';

@Entity('user_inferred_profiles')
export class UserInferredProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @ManyToOne(() => AppUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

  @Column({ name: 'estimated_bmr', type: 'int', nullable: true })
  estimatedBMR: number;

  @Column({ name: 'estimated_tdee', type: 'int', nullable: true })
  estimatedTDEE: number;

  @Column({ name: 'recommended_calories', type: 'int', nullable: true })
  recommendedCalories: number;

  @Column({ name: 'macro_targets', type: 'jsonb', default: '{}' })
  macroTargets: { proteinG?: number; carbG?: number; fatG?: number };

  @Column({ name: 'user_segment', type: 'varchar', length: 30, nullable: true })
  userSegment: string;

  @Column({
    name: 'churn_risk',
    type: 'decimal',
    precision: 3,
    scale: 2,
    default: 0,
  })
  churnRisk: number;

  @Column({ name: 'optimal_meal_count', type: 'int', nullable: true })
  optimalMealCount: number;

  @Column({ name: 'taste_pref_vector', type: 'jsonb', default: '[]' })
  tastePrefVector: number[];

  @Column({ name: 'nutrition_gaps', type: 'jsonb', default: '[]' })
  nutritionGaps: string[];

  @Column({ name: 'goal_progress', type: 'jsonb', default: '{}' })
  goalProgress: {
    startWeight?: number;
    currentWeight?: number;
    targetWeight?: number;
    progressPercent?: number;
    trend?: 'losing' | 'gaining' | 'plateau' | 'fluctuating';
    estimatedWeeksLeft?: number;
    weeklyRateKg?: number;
  };

  @Column({ name: 'confidence_scores', type: 'jsonb', default: '{}' })
  confidenceScores: Record<string, number>;

  /**
   * V4 Phase 3.1: 增量偏好权重
   * 由 PreferenceUpdaterService 在每次反馈后即时更新
   * 结构: IncrementalPreferenceWeights (category/ingredient/foodGroup/foodName 权重)
   */
  @Column({ name: 'preference_weights', type: 'jsonb', nullable: true })
  preferenceWeights: Record<string, unknown> | null;

  @Column({ name: 'last_computed_at', type: 'timestamp', nullable: true })
  lastComputedAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
