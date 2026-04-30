/**
 * 补全相关共享类型定义
 *
 * 拆分自 food-enrichment.service.ts（步骤 1）。
 * 仅包含跨服务共享的对外接口；阶段相关的接口集中在 enrichment-stages.ts。
 */

import type { EnrichableField, EnrichmentTarget } from './enrichable-fields';

// ─── AI 补全结果结构（主表）──────────────────────────────────────────────

export interface EnrichmentResult {
  [key: string]: any;
  confidence: number;
  reasoning?: string;
  /** V8.0: AI 返回的字段级置信度 */
  fieldConfidence?: Record<string, number>;
}

// ─── 缺失字段统计 ────────────────────────────────────────────────────────

export interface MissingFieldStats {
  total: number;
  fields: Record<EnrichableField, number>;
  translationsMissing: number;
  regionalMissing: number;
}

// ─── 单个补全任务（队列 Job 数据）────────────────────────────────────────

export interface EnrichmentJobData {
  foodId: string;
  fields?: EnrichableField[];
  target?: EnrichmentTarget;
  /** 是否 staging 模式（先暂存，不直接落库）*/
  staged?: boolean;
  /** 目标语言列表（translations 使用；regional 会由 locale 映射到对应国家/地区）*/
  locales?: string[];
  /** @deprecated regional 补全优先使用 locales → regions 映射 */
  region?: string;
  /** 目标地区列表（regional 补全时使用，由 locales 映射得到）*/
  regions?: string[];
  /** V7.9: 分阶段补全模式，指定阶段编号 1-5 */
  stages?: number[];
  /**
   * V2.1: 补全模式
   *  - 'staged_flow'  （默认）走完整 5 阶段分阶段流程
   *  - 'direct_fields' 跳过阶段路由，直接对指定 fields 发起一次性 AI 补全并写入
   */
  mode?: 'staged_flow' | 'direct_fields';
}

// ─── Staging 记录（从 food_change_logs 读取）─────────────────────────────

export interface StagedEnrichment {
  id: string;
  foodId: string;
  foodName?: string;
  action: string;
  changes: Record<string, any>;
  reason: string | null;
  operator: string | null;
  version: number;
  createdAt: Date;
  /** V8.3: 食物当前值（仅 proposedValues 涉及的字段），方便前端 diff */
  currentValues?: Record<string, any>;
}

// ─── 数据完整度评分 ──────────────────────────────────────────────────────

export interface CompletenessScore {
  /** 总分 0-100 */
  score: number;
  /** 核心营养素完整度 (权重 0.35) */
  coreNutrients: number;
  /** 微量营养素完整度 (权重 0.25) */
  microNutrients: number;
  /** 健康属性完整度 (权重 0.15) */
  healthAttributes: number;
  /** 使用属性完整度 (权重 0.15) */
  usageAttributes: number;
  /** 扩展属性完整度 (权重 0.10) */
  extendedAttributes: number;
  /** 缺失的关键字段 */
  missingCritical: string[];
}

// ─── 补全进度统计 ────────────────────────────────────────────────────────

export interface EnrichmentProgress {
  /** 总食物数 */
  totalFoods: number;
  /** 已完整补全的食物数 (completeness >= 80%) */
  fullyEnriched: number;
  /** 部分补全的食物数 (40% <= completeness < 80%) */
  partiallyEnriched: number;
  /** 未补全的食物数 (completeness < 40%) */
  notEnriched: number;
  /** 全库平均完整度 */
  avgCompleteness: number;
  /** 按阶段的补全覆盖率 */
  stagesCoverage: Array<{
    stage: number;
    name: string;
    /** 该阶段所有字段均非 NULL 的食物占比 */
    coverageRate: number;
  }>;
  /** V8.3: 按 enrichment_status 分布 */
  byStatus?: Record<string, number>;
}
