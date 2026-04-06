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
import { AppUser } from './app-user.entity';

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

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
