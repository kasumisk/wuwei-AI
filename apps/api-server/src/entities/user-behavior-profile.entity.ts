import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_behavior_profiles')
export class UserBehaviorProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid', unique: true })
  userId: string;

  @Column({ name: 'food_preferences', type: 'jsonb', default: '{}' })
  foodPreferences: {
    loves?: string[];
    avoids?: string[];
    frequentFoods?: string[];
  };

  @Column({ name: 'binge_risk_hours', type: 'jsonb', default: '[]' })
  bingeRiskHours: number[];

  @Column({ name: 'failure_triggers', type: 'jsonb', default: '[]' })
  failureTriggers: string[];

  @Column({ name: 'avg_compliance_rate', type: 'decimal', precision: 3, scale: 2, default: 0 })
  avgComplianceRate: number;

  @Column({ name: 'coach_style', type: 'varchar', length: 20, default: 'friendly' })
  coachStyle: string;

  @Column({ name: 'total_records', type: 'int', default: 0 })
  totalRecords: number;

  @Column({ name: 'healthy_records', type: 'int', default: 0 })
  healthyRecords: number;

  @Column({ name: 'streak_days', type: 'int', default: 0 })
  streakDays: number;

  @Column({ name: 'longest_streak', type: 'int', default: 0 })
  longestStreak: number;

  @Column({ name: 'meal_timing_patterns', type: 'jsonb', default: '{}' })
  mealTimingPatterns: {
    breakfast?: string;
    lunch?: string;
    dinner?: string;
    snack?: string;
  };

  @Column({ name: 'portion_tendency', type: 'varchar', length: 10, default: 'normal' })
  portionTendency: string;

  @Column({ name: 'replacement_patterns', type: 'jsonb', default: '{}' })
  replacementPatterns: Record<string, number>;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
