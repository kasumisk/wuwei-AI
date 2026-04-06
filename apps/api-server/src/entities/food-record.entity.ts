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
import { AppUser } from './app-user.entity';

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
