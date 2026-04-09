import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_inferred_profiles')
export class UserInferredProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

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

  @Column({ name: 'churn_risk', type: 'decimal', precision: 3, scale: 2, default: 0 })
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
    progressPercent?: number;
    estimatedWeeksLeft?: number;
    trend?: string;
  };

  @Column({ name: 'confidence_scores', type: 'jsonb', default: '{}' })
  confidenceScores: Record<string, number>;

  @Column({ name: 'last_computed_at', type: 'timestamp', nullable: true })
  lastComputedAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
