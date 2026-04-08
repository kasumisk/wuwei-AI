import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 推荐反馈实体
 * 记录用户对推荐食物的反馈（接受/替换/跳过），用于持续优化推荐模型
 */
@Entity('recommendation_feedbacks')
@Index(['userId', 'createdAt'])
export class RecommendationFeedback {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'user_id' })
  @Index()
  userId: string;

  /** 推荐所属餐次 */
  @Column({ length: 20 })
  mealType: string;

  /** 推荐的食物名称 */
  @Column({ name: 'food_name', length: 100 })
  foodName: string;

  /** 食物库ID（可选，食物可能已删除） */
  @Column({ name: 'food_id', nullable: true })
  foodId: string;

  /** 反馈类型: accepted=接受推荐, replaced=替换为其他, skipped=跳过该餐 */
  @Column({ length: 20 })
  action: 'accepted' | 'replaced' | 'skipped';

  /** 替换后的食物名（仅 action=replaced 时有值） */
  @Column({ name: 'replacement_food', length: 100, nullable: true })
  replacementFood: string;

  /** 推荐时的评分 */
  @Column({ name: 'recommendation_score', type: 'decimal', precision: 5, scale: 3, nullable: true })
  recommendationScore: number;

  /** 用户目标类型（快照，方便分析） */
  @Column({ name: 'goal_type', length: 20, nullable: true })
  goalType: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
