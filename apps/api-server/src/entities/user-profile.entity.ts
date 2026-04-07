import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { AppUser } from './app-user.entity';

/**
 * 活动等级枚举
 */
export enum ActivityLevel {
  SEDENTARY = 'sedentary',
  LIGHT = 'light',
  MODERATE = 'moderate',
  ACTIVE = 'active',
}

/**
 * 目标类型枚举
 */
export enum GoalType {
  FAT_LOSS = 'fat_loss',      // 减脂
  MUSCLE_GAIN = 'muscle_gain', // 增肌
  HEALTH = 'health',           // 保持健康
  HABIT = 'habit',             // 改善习惯
}

/**
 * 目标速度枚举
 */
export enum GoalSpeed {
  AGGRESSIVE = 'aggressive', // 快速（激进）
  STEADY = 'steady',         // 稳定（推荐）
  RELAXED = 'relaxed',       // 佛系（轻松）
}

/**
 * 自律程度枚举
 */
export enum Discipline {
  HIGH = 'high',     // 很强
  MEDIUM = 'medium', // 一般
  LOW = 'low',       // 容易放弃
}

/**
 * 用户健康档案
 */
@Entity('user_profiles')
export class UserProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'user_id', unique: true })
  userId: string;

  @OneToOne(() => AppUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: AppUser;

  @Column({ type: 'varchar', length: 10, nullable: true, comment: 'male | female' })
  gender?: string;

  @Column({ type: 'int', nullable: true, name: 'birth_year' })
  birthYear?: number;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 1,
    nullable: true,
    name: 'height_cm',
    comment: '身高 cm',
  })
  heightCm?: number;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 1,
    nullable: true,
    name: 'weight_kg',
    comment: '体重 kg',
  })
  weightKg?: number;

  @Column({
    type: 'decimal',
    precision: 5,
    scale: 1,
    nullable: true,
    name: 'target_weight_kg',
    comment: '目标体重 kg',
  })
  targetWeightKg?: number;

  @Column({
    type: 'enum',
    enum: ActivityLevel,
    default: ActivityLevel.LIGHT,
    name: 'activity_level',
    comment: '活动等级',
  })
  activityLevel: ActivityLevel;

  @Column({
    type: 'int',
    nullable: true,
    name: 'daily_calorie_goal',
    comment: '每日热量目标（可手动设置）',
  })
  dailyCalorieGoal?: number;

  // ==================== 目标信息 ====================

  @Column({
    type: 'varchar',
    length: 30,
    default: GoalType.HEALTH,
    name: 'goal',
    comment: '减脂/增肌/健康/习惯',
  })
  goal: GoalType;

  @Column({
    type: 'varchar',
    length: 20,
    default: GoalSpeed.STEADY,
    name: 'goal_speed',
    comment: '目标速度：激进/稳定/佛系',
  })
  goalSpeed: GoalSpeed;

  @Column({
    type: 'decimal',
    precision: 4,
    scale: 1,
    nullable: true,
    name: 'body_fat_percent',
    comment: '体脂率 %',
  })
  bodyFatPercent?: number;

  // ==================== 饮食习惯 ====================

  @Column({
    type: 'int',
    default: 3,
    name: 'meals_per_day',
    comment: '一天几餐',
  })
  mealsPerDay: number;

  @Column({
    type: 'varchar',
    length: 20,
    default: 'sometimes',
    name: 'takeout_frequency',
    comment: '外卖频率：never/sometimes/often',
  })
  takeoutFrequency: string;

  @Column({
    type: 'boolean',
    default: true,
    name: 'can_cook',
    comment: '是否会做饭',
  })
  canCook: boolean;

  @Column({
    type: 'jsonb',
    default: [],
    name: 'food_preferences',
    comment: '饮食偏好：sweet/fried/carbs/meat/spicy',
  })
  foodPreferences: string[];

  @Column({
    type: 'jsonb',
    default: [],
    name: 'dietary_restrictions',
    comment: '忌口：no_beef/vegetarian/lactose_free/halal',
  })
  dietaryRestrictions: string[];

  // ==================== 行为习惯 ====================

  @Column({
    type: 'jsonb',
    default: [],
    name: 'weak_time_slots',
    comment: '容易乱吃时段：afternoon/evening/midnight',
  })
  weakTimeSlots: string[];

  @Column({
    type: 'jsonb',
    default: [],
    name: 'binge_triggers',
    comment: '暴食触发：stress/boredom/social/emotion',
  })
  bingeTriggers: string[];

  @Column({
    type: 'varchar',
    length: 20,
    default: Discipline.MEDIUM,
    name: 'discipline',
    comment: '自律程度：high/medium/low',
  })
  discipline: Discipline;

  @Column({
    type: 'boolean',
    default: false,
    name: 'onboarding_completed',
    comment: '是否完成档案引导',
  })
  onboardingCompleted: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
