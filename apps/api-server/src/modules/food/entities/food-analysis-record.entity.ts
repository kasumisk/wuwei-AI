/**
 * V6.1 Phase 1.5 — 食物分析记录 Entity
 *
 * 用于保存文本/图片分析过程记录，不与 food_records（饮食记录）混淆。
 * 每次分析请求生成一条记录，记录输入、中间结果、最终结果和入库状态。
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * 分析记录状态
 */
export enum AnalysisRecordStatus {
  /** 分析完成 */
  COMPLETED = 'completed',
  /** 分析失败 */
  FAILED = 'failed',
  /** 部分成功（图片分析中部分食物识别成功） */
  PARTIAL = 'partial',
}

/**
 * 入库状态
 */
export enum PersistStatus {
  /** 已关联到标准食物 */
  LINKED = 'linked',
  /** 已创建候选食物 */
  CANDIDATE_CREATED = 'candidate_created',
  /** 忽略（质量不足，不入库） */
  IGNORED = 'ignored',
  /** 待处理 */
  PENDING = 'pending',
}

@Entity('food_analysis_record')
@Index('idx_food_analysis_record_user_id', ['userId'])
@Index('idx_food_analysis_record_user_created', ['userId', 'createdAt'])
@Index('idx_food_analysis_record_input_type', ['inputType'])
@Index('idx_food_analysis_record_status', ['status'])
export class FoodAnalysisRecord {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 用户 ID */
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string;

  /** 输入类型: text / image */
  @Column({ type: 'varchar', length: 10, name: 'input_type' })
  inputType: 'text' | 'image';

  /** 文本原始输入 */
  @Column({ type: 'text', nullable: true, name: 'raw_text' })
  rawText: string | null;

  /** 图片地址 */
  @Column({ type: 'varchar', length: 500, nullable: true, name: 'image_url' })
  imageUrl: string | null;

  /** 餐次 */
  @Column({ type: 'varchar', length: 20, nullable: true, name: 'meal_type' })
  mealType: string | null;

  /** 分析状态 */
  @Column({
    type: 'varchar',
    length: 20,
    default: AnalysisRecordStatus.COMPLETED,
  })
  status: AnalysisRecordStatus;

  /**
   * 识别出的食物原始结构
   * 文本链路: 解析出的食物名称列表和数量
   * 图片链路: AI 识别出的食物候选
   */
  @Column({ type: 'jsonb', nullable: true, name: 'recognized_payload' })
  recognizedPayload: Record<string, unknown> | null;

  /**
   * 标准化后的结构
   * 经过 FoodNormalizationService 处理后的标准化食物列表
   */
  @Column({ type: 'jsonb', nullable: true, name: 'normalized_payload' })
  normalizedPayload: Record<string, unknown> | null;

  /**
   * 统一营养结果
   * NutritionEstimationService 估算的营养数据
   */
  @Column({ type: 'jsonb', nullable: true, name: 'nutrition_payload' })
  nutritionPayload: Record<string, unknown> | null;

  /**
   * 决策结果
   * FoodDecisionService 输出的建议
   */
  @Column({ type: 'jsonb', nullable: true, name: 'decision_payload' })
  decisionPayload: Record<string, unknown> | null;

  /** 总置信度（0-100） */
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    name: 'confidence_score',
  })
  confidenceScore: number | null;

  /** 数据质量分（0-100） */
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    nullable: true,
    name: 'quality_score',
  })
  qualityScore: number | null;

  /** 命中标准食物数量 */
  @Column({ type: 'int', default: 0, name: 'matched_food_count' })
  matchedFoodCount: number;

  /** 新候选数量 */
  @Column({ type: 'int', default: 0, name: 'candidate_food_count' })
  candidateFoodCount: number;

  /** 入库状态 */
  @Column({
    type: 'varchar',
    length: 20,
    default: PersistStatus.PENDING,
    name: 'persist_status',
  })
  persistStatus: PersistStatus;

  /** 图片异步分析 requestId（用于关联异步队列结果） */
  @Column({
    type: 'varchar',
    length: 64,
    nullable: true,
    name: 'source_request_id',
  })
  sourceRequestId: string | null;

  /** 人工审核状态 */
  @Column({
    type: 'varchar',
    length: 20,
    default: 'pending',
    name: 'review_status',
  })
  reviewStatus: 'pending' | 'accurate' | 'inaccurate';

  /** 审核人 ID */
  @Column({ type: 'uuid', nullable: true, name: 'reviewed_by' })
  reviewedBy: string | null;

  /** 审核时间 */
  @Column({ type: 'timestamptz', nullable: true, name: 'reviewed_at' })
  reviewedAt: Date | null;

  /** 审核备注 */
  @Column({ type: 'text', nullable: true, name: 'review_note' })
  reviewNote: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
