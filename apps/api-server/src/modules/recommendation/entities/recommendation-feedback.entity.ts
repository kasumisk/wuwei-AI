import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('recommendation_feedbacks')
@Index(['userId', 'createdAt'])
export class RecommendationFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  @Column({ name: 'meal_type', length: 20 })
  mealType: string;

  @Column({ name: 'food_name', length: 100 })
  foodName: string;

  @Column({ name: 'food_id', nullable: true })
  foodId: string;

  @Column({ length: 20 })
  action: 'accepted' | 'replaced' | 'skipped';

  @Column({ name: 'replacement_food', length: 100, nullable: true })
  replacementFood: string;

  @Column({ name: 'recommendation_score', type: 'decimal', precision: 5, scale: 3, nullable: true })
  recommendationScore: number;

  @Column({ name: 'goal_type', length: 20, nullable: true })
  goalType: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
