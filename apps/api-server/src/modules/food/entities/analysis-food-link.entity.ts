/**
 * V6.1 Phase 2.3 — 分析-食物关联表 Entity
 *
 * 记录每次分析中识别出的食物与标准库/候选库的匹配关系。
 * 一条分析记录可关联多条 link（多食物拆解），
 * 每条 link 记录匹配类型和置信度。
 *
 * 用途:
 * - 追踪分析链路的食物匹配质量
 * - 统计标准食物的命中热度
 * - 候选食物的命中次数聚合
 * - 入库管道的去重和质量判断依据
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { FoodAnalysisRecord } from './food-analysis-record.entity';
import { FoodLibrary } from './food-library.entity';
import { FoodCandidate } from './food-candidate.entity';

/**
 * 匹配类型
 */
export enum MatchType {
  /** 精确匹配标准名 */
  EXACT = 'exact',
  /** 别名匹配 */
  ALIAS = 'alias',
  /** 语义匹配（文本链路 LLM 归一） */
  SEMANTIC = 'semantic',
  /** 视觉猜测（图片链路 AI 识别） */
  VISION_GUESS = 'vision_guess',
}

@Entity('analysis_food_link')
@Index('idx_analysis_food_link_analysis_id', ['analysisId'])
@Index('idx_analysis_food_link_food_library_id', ['foodLibraryId'])
@Index('idx_analysis_food_link_food_candidate_id', ['foodCandidateId'])
export class AnalysisFoodLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 对应分析记录 ID */
  @Column({ type: 'uuid', name: 'analysis_id' })
  analysisId: string;

  @ManyToOne(() => FoodAnalysisRecord, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'analysis_id' })
  analysisRecord: FoodAnalysisRecord;

  /** 命中的标准食物 ID（可空） */
  @Column({ type: 'uuid', nullable: true, name: 'food_library_id' })
  foodLibraryId: string | null;

  @ManyToOne(() => FoodLibrary, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'food_library_id' })
  foodLibrary: FoodLibrary | null;

  /** 命中的候选食物 ID（可空） */
  @Column({ type: 'uuid', nullable: true, name: 'food_candidate_id' })
  foodCandidateId: string | null;

  @ManyToOne(() => FoodCandidate, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'food_candidate_id' })
  foodCandidate: FoodCandidate | null;

  /** 食物名称（分析时识别出的原始名称） */
  @Column({
    type: 'varchar',
    length: 120,
    name: 'food_name',
    comment: '识别出的食物名称',
  })
  foodName: string;

  /** 匹配类型 */
  @Column({
    type: 'varchar',
    length: 20,
    name: 'match_type',
    comment: 'exact / alias / semantic / vision_guess',
  })
  matchType: MatchType;

  /** 本次匹配置信度（0-100） */
  @Column({
    type: 'decimal',
    precision: 5,
    scale: 2,
    default: 0,
    comment: '匹配置信度',
  })
  confidence: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
