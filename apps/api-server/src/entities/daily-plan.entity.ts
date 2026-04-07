import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export interface MealPlan {
  foods: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  tip: string;
}

export interface PlanAdjustment {
  time: string;
  reason: string;
  newPlan: Partial<Record<'morning' | 'lunch' | 'dinner' | 'snack', MealPlan>>;
}

@Entity('daily_plans')
export class DailyPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ name: 'morning_plan', type: 'jsonb', nullable: true })
  morningPlan: MealPlan | null;

  @Column({ name: 'lunch_plan', type: 'jsonb', nullable: true })
  lunchPlan: MealPlan | null;

  @Column({ name: 'dinner_plan', type: 'jsonb', nullable: true })
  dinnerPlan: MealPlan | null;

  @Column({ name: 'snack_plan', type: 'jsonb', nullable: true })
  snackPlan: MealPlan | null;

  @Column({ type: 'jsonb', default: '[]' })
  adjustments: PlanAdjustment[];

  @Column({ type: 'text', nullable: true })
  strategy: string;

  @Column({ name: 'total_budget', type: 'int', nullable: true })
  totalBudget: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
