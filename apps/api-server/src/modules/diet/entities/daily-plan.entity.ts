import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Unique,
} from 'typeorm';
import {
  ExplanationV2,
  RadarChartData,
  ProgressBarData,
  ComparisonData,
} from '../app/recommendation/scoring-explanation.interface';
import { AppUser } from '../../user/entities/app-user.entity';

// 导出 V2 相关类型，方便其他模块使用
export type { ExplanationV2, RadarChartData, ProgressBarData, ComparisonData };

/**
 * 单个食物条目 — 保留在 MealPlan 中供替换定位
 */
export interface MealFoodItem {
  foodId: string;
  name: string;
  /** 份量描述，如 "100g" */
  servingDesc: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  category: string;
}

export interface MealPlan {
  /** 展示文本（向后兼容） */
  foods: string;
  /** 结构化食物列表 — 用于替换定位和反馈记录 */
  foodItems?: MealFoodItem[];
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  tip: string;
  /** V5 3.6: 每个食物的用户可读推荐解释（foodId → 解释） */
  explanations?: Record<string, MealFoodExplanation>;
}

/**
 * V5 3.6: 持久化在 MealPlan 中的食物解释（轻量版，仅存储文案不存储 ScoringExplanation）
 * V6 2.7: 新增可选 V2 可视化数据（radarChart, progressBars, comparisonCard）
 */
export interface MealFoodExplanation {
  primaryReason: string;
  nutritionHighlights: Array<{
    label: string;
    type: 'positive' | 'neutral';
    value: string;
  }>;
  healthTip?: string;
  scoreBreakdown: Array<{ dimension: string; score: number }>;
  /** V6 2.7: 完整 V2 可视化解释（可选，前端支持时使用） */
  v2?: ExplanationV2;
}

export interface PlanAdjustment {
  time: string;
  reason: string;
  newPlan: Partial<Record<'morning' | 'lunch' | 'dinner' | 'snack', MealPlan>>;
}

@Entity('daily_plans')
@Unique(['userId', 'date'])
export class DailyPlan {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => AppUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

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
