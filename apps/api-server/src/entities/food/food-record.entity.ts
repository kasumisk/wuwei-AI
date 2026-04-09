import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AppUser } from '../user/app-user.entity';

/**
 * 餐食类型枚举
 */
export enum MealType {
  BREAKFAST = 'breakfast',
  LUNCH = 'lunch',
  DINNER = 'dinner',
  SNACK = 'snack',
}

/**
 * 记录来源枚举
 */
export enum RecordSource {
  SCREENSHOT = 'screenshot',
  CAMERA = 'camera',
  MANUAL = 'manual',
}

/**
 * 食物条目（JSONB 中的单个食物）
 */
export interface FoodItem {
  name: string;
  calories: number;
  quantity?: string;
  category?: string;
  protein?: number;
  fat?: number;
  carbs?: number;
  quality?: number;
  satiety?: number;
}

/**
 * 饮食记录实体
 */
@Entity('food_records')
@Index(['userId', 'recordedAt'])
export class FoodRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => AppUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

  @Column({ type: 'varchar', length: 500, nullable: true, name: 'image_url' })
  imageUrl?: string;

  @Column({
    type: 'enum',
    enum: RecordSource,
    default: RecordSource.SCREENSHOT,
    comment: '记录来源',
  })
  source: RecordSource;

  @Column({ type: 'text', nullable: true, name: 'recognized_text' })
  recognizedText?: string;

  @Column({ type: 'jsonb', default: '[]', comment: '识别的食物列表' })
  foods: FoodItem[];

  @Column({
    type: 'int',
    default: 0,
    name: 'total_calories',
    comment: '总热量 kcal',
  })
  totalCalories: number;

  @Column({
    type: 'enum',
    enum: MealType,
    default: MealType.LUNCH,
    name: 'meal_type',
    comment: '餐食类型',
  })
  mealType: MealType;

  @Column({ type: 'text', nullable: true, comment: 'AI 饮食建议' })
  advice?: string;

  @Column({
    type: 'boolean',
    nullable: true,
    name: 'is_healthy',
    comment: '是否健康',
  })
  isHealthy?: boolean;

  // ─── V1: AI 决策字段 ───

  @Column({
    type: 'varchar',
    length: 10,
    default: 'SAFE',
    comment: 'SAFE|OK|LIMIT|AVOID',
  })
  decision: string;

  @Column({
    type: 'varchar',
    length: 5,
    nullable: true,
    name: 'risk_level',
    comment: '🟢🟡🟠🔴',
  })
  riskLevel?: string;

  @Column({ type: 'text', nullable: true, comment: '判断原因' })
  reason?: string;

  @Column({ type: 'text', nullable: true, comment: '可执行建议' })
  suggestion?: string;

  @Column({
    type: 'jsonb',
    default: '[]',
    name: 'instead_options',
    comment: '替代方案',
  })
  insteadOptions: string[];

  @Column({
    type: 'jsonb',
    nullable: true,
    comment: '补救策略 {diet, activity, nextMeal}',
  })
  compensation?: { diet?: string; activity?: string; nextMeal?: string };

  @Column({
    type: 'text',
    nullable: true,
    name: 'context_comment',
    comment: '基于今日状态的点评',
  })
  contextComment?: string;

  @Column({ type: 'text', nullable: true, comment: '鼓励语' })
  encouragement?: string;

  // ─── V6: 多维营养字段 ───

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 1,
    default: 0,
    name: 'total_protein',
    comment: '本餐总蛋白质 g',
  })
  totalProtein: number;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 1,
    default: 0,
    name: 'total_fat',
    comment: '本餐总脂肪 g',
  })
  totalFat: number;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 1,
    default: 0,
    name: 'total_carbs',
    comment: '本餐总碳水 g',
  })
  totalCarbs: number;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 1,
    default: 0,
    name: 'avg_quality',
    comment: '本餐食物平均质量分 1-10',
  })
  avgQuality: number;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 1,
    default: 0,
    name: 'avg_satiety',
    comment: '本餐食物平均饱腹感 1-10',
  })
  avgSatiety: number;

  @Column({
    type: 'int',
    default: 0,
    name: 'nutrition_score',
    comment: '本餐综合营养评分 0-100',
  })
  nutritionScore: number;

  @Column({
    type: 'timestamp',
    name: 'recorded_at',
    default: () => 'CURRENT_TIMESTAMP',
    comment: '记录时间',
  })
  recordedAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
