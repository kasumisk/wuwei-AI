/**
 * V6.1 Phase 2.4 — 候选食物 Entity
 *
 * 从分析链路（文本/图片）中沉淀的候选食物。
 * 当分析识别到一种食物但标准库中没有时，创建候选记录。
 * 多次命中且质量达标后可推入审核队列，审核通过后合并入正式 FoodLibrary。
 *
 * 生命周期:
 *   pending → (审核) → approved → (合并) → merged
 *                    → rejected（低质量/重复/不合规）
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * 候选食物审核状态
 */
export enum CandidateReviewStatus {
  /** 等待审核 */
  PENDING = 'pending',
  /** 已通过 */
  APPROVED = 'approved',
  /** 已拒绝 */
  REJECTED = 'rejected',
  /** 已合并到正式食物库 */
  MERGED = 'merged',
}

/**
 * 候选食物来源类型
 */
export enum CandidateSourceType {
  TEXT_ANALYSIS = 'text_analysis',
  IMAGE_ANALYSIS = 'image_analysis',
}

/**
 * 候选食物营养估算结构（JSONB）
 */
export interface EstimatedNutrition {
  /** 每 100g 热量（千卡） */
  caloriesPer100g?: number;
  /** 每 100g 蛋白质（克） */
  proteinPer100g?: number;
  /** 每 100g 脂肪（克） */
  fatPer100g?: number;
  /** 每 100g 碳水化合物（克） */
  carbsPer100g?: number;
  /** 每 100g 膳食纤维（克） */
  fiberPer100g?: number;
  /** 每 100g 钠（毫克） */
  sodiumPer100g?: number;
}

@Entity('food_candidate')
@Index('idx_food_candidate_canonical_name', ['canonicalName'])
@Index('idx_food_candidate_review_status', ['reviewStatus'])
@Index('idx_food_candidate_source_type', ['sourceType'])
@Index('idx_food_candidate_source_count', ['sourceCount'])
export class FoodCandidate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 候选标准名（去重用） */
  @Column({
    type: 'varchar',
    length: 120,
    name: 'canonical_name',
    comment: '候选标准名',
  })
  canonicalName: string;

  /** 识别出的别名/同义词 */
  @Column({
    type: 'jsonb',
    default: '[]',
    comment: '别名列表',
  })
  aliases: string[];

  /** 食物分类 */
  @Column({
    type: 'varchar',
    length: 30,
    nullable: true,
    comment: '分类',
  })
  category: string | null;

  /** 营养估算（JSONB） */
  @Column({
    type: 'jsonb',
    nullable: true,
    name: 'estimated_nutrition',
    comment: '营养估算',
  })
  estimatedNutrition: EstimatedNutrition | null;

  /** 来源类型 */
  @Column({
    type: 'varchar',
    length: 20,
    name: 'source_type',
    comment: '来源: text_analysis / image_analysis',
  })
  sourceType: CandidateSourceType;

  /** 被分析链路命中的次数 */
  @Column({
    type: 'int',
    default: 1,
    name: 'source_count',
    comment: '命中次数',
  })
  sourceCount: number;

  /** 平均置信度（0-100） */
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
    name: 'avg_confidence',
    comment: '平均置信度',
  })
  avgConfidence: number;

  /** 质量分（0-100） */
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
    name: 'quality_score',
    comment: '质量分',
  })
  qualityScore: number;

  /** 审核状态 */
  @Column({
    type: 'varchar',
    length: 20,
    default: CandidateReviewStatus.PENDING,
    name: 'review_status',
    comment: '审核状态',
  })
  reviewStatus: CandidateReviewStatus;

  /** 合并到正式食物后的 ID */
  @Column({
    type: 'uuid',
    nullable: true,
    name: 'merged_food_id',
    comment: '合并到正式食物后的 ID',
  })
  mergedFoodId: string | null;

  /** 首次出现时间 */
  @CreateDateColumn({
    name: 'first_seen_at',
    type: 'timestamptz',
    comment: '首次出现',
  })
  firstSeenAt: Date;

  /** 最近出现时间 */
  @Column({
    type: 'timestamptz',
    name: 'last_seen_at',
    default: () => 'CURRENT_TIMESTAMP',
    comment: '最近出现',
  })
  lastSeenAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
