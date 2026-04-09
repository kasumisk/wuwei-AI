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
import { AppUser } from '../../user/entities/app-user.entity';

/**
 * 每日饮食汇总
 */
@Entity('daily_summaries')
@Unique(['userId', 'date'])
export class DailySummary {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  @ManyToOne(() => AppUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

  @Column({ type: 'date', comment: '日期' })
  date: string;

  @Column({
    type: 'int',
    default: 0,
    name: 'total_calories',
    comment: '当日总摄入热量 kcal',
  })
  totalCalories: number;

  @Column({
    type: 'int',
    nullable: true,
    name: 'calorie_goal',
    comment: '当日热量目标',
  })
  calorieGoal?: number;

  @Column({
    type: 'int',
    default: 0,
    name: 'meal_count',
    comment: '当日记录餐数',
  })
  mealCount: number;

  // ─── V6: 多维营养字段 ───

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 1,
    default: 0,
    name: 'total_protein',
    comment: '今日总蛋白质 g',
  })
  totalProtein: number;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 1,
    default: 0,
    name: 'total_fat',
    comment: '今日总脂肪 g',
  })
  totalFat: number;

  @Column({
    type: 'decimal',
    precision: 7,
    scale: 1,
    default: 0,
    name: 'total_carbs',
    comment: '今日总碳水 g',
  })
  totalCarbs: number;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 1,
    default: 0,
    name: 'avg_quality',
    comment: '今日食物平均质量分',
  })
  avgQuality: number;

  @Column({
    type: 'decimal',
    precision: 3,
    scale: 1,
    default: 0,
    name: 'avg_satiety',
    comment: '今日食物平均饱腹感',
  })
  avgSatiety: number;

  @Column({
    type: 'int',
    default: 0,
    name: 'nutrition_score',
    comment: '今日综合营养评分 0-100',
  })
  nutritionScore: number;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 1,
    default: 0,
    name: 'protein_goal',
    comment: '今日蛋白质目标 g',
  })
  proteinGoal: number;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 1,
    default: 0,
    name: 'fat_goal',
    comment: '今日脂肪目标 g',
  })
  fatGoal: number;

  @Column({
    type: 'decimal',
    precision: 6,
    scale: 1,
    default: 0,
    name: 'carbs_goal',
    comment: '今日碳水目标 g',
  })
  carbsGoal: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
