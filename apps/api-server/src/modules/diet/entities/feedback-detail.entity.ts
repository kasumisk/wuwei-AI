import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { RecommendationFeedback } from './recommendation-feedback.entity';

/**
 * V6 2.19: 多维反馈详情实体
 *
 * 在原有 accepted/replaced/skipped 单维度反馈基础上，
 * 增加口味（taste）、份量（portion）、价格（price）、时间适合度（timing）四个独立评分维度。
 * 每条记录关联一条 RecommendationFeedback。
 *
 * 评分范围: 1-5 星（整数），null = 用户未评价该维度
 */
@Entity('feedback_details')
@Index(['feedbackId'])
@Index(['userId', 'createdAt'])
export class FeedbackDetail {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 关联的反馈记录 ID */
  @Column({ name: 'feedback_id', type: 'uuid' })
  feedbackId: string;

  @ManyToOne(() => RecommendationFeedback, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'feedback_id' })
  feedback: RecommendationFeedback;

  /** 冗余用户 ID（方便按用户维度查询聚合） */
  @Column({ name: 'user_id', type: 'uuid' })
  @Index()
  userId: string;

  /** 冗余食物名称（方便按食物维度查询聚合） */
  @Column({ name: 'food_name', length: 100 })
  foodName: string;

  /** 冗余餐次类型 */
  @Column({ name: 'meal_type', length: 20 })
  mealType: string;

  // ─── 多维评分（1-5 星，null = 未评价） ───

  /** 口味满意度: 1=非常不满意, 5=非常满意 */
  @Column({ name: 'taste_rating', type: 'smallint', nullable: true })
  tasteRating: number | null;

  /** 份量满意度: 1=太少, 3=刚好, 5=太多 */
  @Column({ name: 'portion_rating', type: 'smallint', nullable: true })
  portionRating: number | null;

  /** 价格满意度: 1=太贵, 3=合理, 5=很划算 */
  @Column({ name: 'price_rating', type: 'smallint', nullable: true })
  priceRating: number | null;

  /** 时间适合度: 1=完全不适合当前时段, 5=非常适合 */
  @Column({ name: 'timing_rating', type: 'smallint', nullable: true })
  timingRating: number | null;

  /** 用户文字备注（可选，自由文本反馈） */
  @Column({ type: 'text', nullable: true })
  comment: string | null;

  /** 隐式信号: 用户在推荐卡片上的停留时间（毫秒，前端上报） */
  @Column({ name: 'dwell_time_ms', type: 'int', nullable: true })
  dwellTimeMs: number | null;

  /** 隐式信号: 用户是否点击了详情展开 */
  @Column({ name: 'detail_expanded', type: 'boolean', nullable: true })
  detailExpanded: boolean | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
