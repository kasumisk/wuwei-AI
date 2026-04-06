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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
