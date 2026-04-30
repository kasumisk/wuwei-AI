/**
 * V8.0 Food Enrichment Service
 *
 * 使用 DeepSeek AI 对 foods 及其关联表中缺失字段进行补全。
 *
 * ── 核心约束 ──
 *  1. 只补全 null / undefined / 空数组 字段，不覆盖已有数据
 *  2. 支持 staging 模式：AI 结果先写入 food_change_logs (action=ai_enrichment_staged)
 *     人工审核后通过 approveStaged / rejectStaged 决定是否落库
 *  3. 直接入库模式：AI 结果直接写入 foods（action=ai_enrichment）
 *  4. 支持关联表补全：food_translations（翻译补全）、food_regional_info（地区信息）
 *  5. 所有补全必须携带 confidence，低于阈值自动进入 staged 等待人工确认
 *
 * ── V7.9 新增能力 ──
 *  6. 分阶段补全（5阶段）：核心营养素 → 微量营养素 → 健康属性 → 使用属性 → 扩展属性
 *  7. 每阶段独立 Prompt、独立验证、独立入库，前阶段结果作为后阶段上下文
 *  8. Fallback 降级机制：AI 失败时使用同类食物均值 / 规则推断
 *  9. 交叉验证增强：宏量营养素一致性自动修正
 * 10. 数据完整度评分：per food 加权计算
 * 11. scanMissingFields 单次 SQL 聚合优化
 *
 * ── V8.0 新增能力 ──
 * 12. 补全字段扩展至 64 个（新增 6 个 V7.9 营养素 + 14 个 V7.1/7.3/7.4 属性字段）
 * 13. 第 5 阶段"扩展属性"补全（烹饪细节、可获得性、搭配关系等）
 * 14. 补全元数据持久化：field_sources / field_confidence / data_completeness / enrichment_status
 * 15. 单条立即补全 API：enrichFoodNow
 */

import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// ─── 步骤 1-3 拆分：常量 / 类型 / Prompt / SQL helper / AI 客户端已迁移至 ./enrichment/ ─────
// 此文件仅作为 facade 重新导出，外部 import 路径保持不变。

import { EnrichmentCompletenessService } from './enrichment/services/enrichment-completeness.service';
import { EnrichmentScanService } from './enrichment/services/enrichment-scan.service';
import {
  EnrichmentStagingService,
  ENRICHMENT_APPLY_SERVICE,
  type IEnrichmentApplyService,
} from './enrichment/services/enrichment-staging.service';
import { EnrichmentStageService } from './enrichment/services/enrichment-stage.service';
import { EnrichmentApplyService } from './enrichment/services/enrichment-apply.service';
import { EnrichmentStatsService } from './enrichment/services/enrichment-stats.service';
import { EnrichmentI18nService } from './enrichment/services/enrichment-i18n.service';
import { EnrichmentDirectService } from './enrichment/services/enrichment-direct.service';
import { EnrichmentNowService } from './enrichment/services/enrichment-now.service';
import { EnrichmentReEnqueueService } from './enrichment/services/enrichment-reenqueue.service';

import {
  snakeToCamel,
  camelToSnake,
  ENRICHABLE_FIELDS,
  type EnrichableField,
  type EnrichmentTarget,
  JSON_ARRAY_FIELDS,
  JSON_OBJECT_FIELDS,
  ENRICHABLE_STRING_FIELDS,
  AI_OVERRIDABLE_FIELDS,
} from './enrichment/constants/enrichable-fields';
import {
  type EnrichmentStage,
  ENRICHMENT_STAGES,
  type StageEnrichmentResult,
  type MultiStageEnrichmentResult,
} from './enrichment/constants/enrichment-stages';
import {
  NUTRIENT_RANGES,
  COMPLETENESS_PARTIAL_THRESHOLD,
  COMPLETENESS_COMPLETE_THRESHOLD,
  CONFIDENCE_STAGING_THRESHOLD,
} from './enrichment/constants/nutrient-ranges';
import { FIELD_DESC } from './enrichment/constants/field-descriptions';
import {
  type EnrichmentResult,
  type MissingFieldStats,
  type EnrichmentJobData,
  type StagedEnrichment,
  type CompletenessScore,
  type EnrichmentProgress,
} from './enrichment/constants/enrichment.types';

// 对外 re-export（保持向后兼容：外部从 food-enrichment.service 直接 import 这些符号）
export {
  snakeToCamel,
  camelToSnake,
  ENRICHABLE_FIELDS,
  ENRICHMENT_STAGES,
  JSON_ARRAY_FIELDS,
  JSON_OBJECT_FIELDS,
  ENRICHABLE_STRING_FIELDS,
  AI_OVERRIDABLE_FIELDS,
  NUTRIENT_RANGES,
  COMPLETENESS_PARTIAL_THRESHOLD,
  COMPLETENESS_COMPLETE_THRESHOLD,
  FIELD_DESC,
};
export type {
  EnrichableField,
  EnrichmentTarget,
  EnrichmentStage,
  StageEnrichmentResult,
  MultiStageEnrichmentResult,
  EnrichmentResult,
  MissingFieldStats,
  EnrichmentJobData,
  StagedEnrichment,
  CompletenessScore,
  EnrichmentProgress,
};

@Injectable()
export class FoodEnrichmentService {
  private readonly logger = new Logger(FoodEnrichmentService.name);
  private readonly apiKey: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly completenessService: EnrichmentCompletenessService,
    private readonly scanService: EnrichmentScanService,
    @Inject(forwardRef(() => EnrichmentStagingService))
    private readonly stagingService: EnrichmentStagingService,
    private readonly stageService: EnrichmentStageService,
    private readonly applyService: EnrichmentApplyService,
    private readonly statsService: EnrichmentStatsService,
    private readonly i18nService: EnrichmentI18nService,
    private readonly directService: EnrichmentDirectService,
    private readonly nowService: EnrichmentNowService,
    private readonly reEnqueueService: EnrichmentReEnqueueService,
  ) {
    this.apiKey = this.configService.get<string>('DEEPSEEK_API_KEY') || '';
  }

  // ─── V7.9: 分阶段补全（核心新增）────────────────────────────────────────

  /** @see EnrichmentStageService.enrichFoodByStage */
  async enrichFoodByStage(
    foodId: string,
    targetStages?: number[],
    fieldFilter?: EnrichableField[],
  ): Promise<MultiStageEnrichmentResult | null> {
    return this.stageService.enrichFoodByStage(
      foodId,
      targetStages,
      fieldFilter,
    );
  }

  // ─── V7.9: Fallback 降级机制（委托）───────────────────────────────────

  /** @see EnrichmentStageService.fallbackFromCategory */
  async fallbackFromCategory(
    food: any,
    missingFields: EnrichableField[],
  ): Promise<{ result: EnrichmentResult; source: string } | null> {
    return this.stageService.fallbackFromCategory(food, missingFields);
  }

  // ─── V8.0: 单条立即补全 ──────────────────────────────────────────────

  /** @see EnrichmentNowService.enrichFoodNow */
  async enrichFoodNow(
    foodId: string,
    options: {
      stages?: number[];
      fields?: EnrichableField[];
      staged?: boolean;
    } = {},
  ): Promise<{
    success: boolean;
    foodId: string;
    foodName: string;
    stageResults: StageEnrichmentResult[];
    totalEnriched: number;
    totalFailed: number;
    completeness: CompletenessScore;
    enrichmentStatus: string;
  }> {
    return this.nowService.enrichFoodNow(foodId, this.apiKey, options);
  }

  // ─── V8.3: 标记食物补全失败（委托）────────────────────────────────────

  /** @see EnrichmentStageService.markEnrichmentFailed */
  async markEnrichmentFailed(foodId: string, errorMsg?: string): Promise<void> {
    return this.stageService.markEnrichmentFailed(foodId, errorMsg);
  }

  // ─── V2.1: 直接字段补全（direct_fields 模式）─────────────────────────

  /**
   * 跳过 5 阶段流程，直接对指定 fields 发起一次性 AI 补全并写入。
   * 用于 re-enqueue 场景：字段已明确指定，无需走阶段路由。
   *
   * Prompt 质量与分阶段模式对齐：
   *  - System prompt 携带完整权威数据库声明 + direct_fields 专属角色说明
   *  - User prompt 携带食物所有已有字段值作为上下文 + FIELD_DESC 详细规范
   *  - 按字段类型（数值/字符串/数组/对象）注入专属约束规则
   *  - max_tokens 根据字段数量自适应
   *
   * @param foodId   食物 ID
   * @param fields   要补全的 snake_case 字段列表（来自 ENRICHABLE_FIELDS）
   * @param staged   是否暂存（默认 false：直接入库）
   * @param operator 操作人标识
   */
  async enrichFieldsDirect(
    foodId: string,
    fields: EnrichableField[],
    staged = false,
    operator = 'ai_enrichment_worker',
  ): Promise<{ updated: string[]; skipped: string[] } | null> {
    const result = await this.directService.enrichFieldsDirect(foodId, fields);
    if (!result) return null;

    if (staged || this.shouldStage(result, staged)) {
      const logId = await this.stageEnrichment(
        foodId,
        result,
        'foods',
        undefined,
        undefined,
        operator,
      );
      this.logger.log(
        `enrichFieldsDirect Staged: foodId=${foodId}, logId=${logId}`,
      );
      return { updated: [], skipped: fields };
    }

    const applied = await this.applyEnrichment(foodId, result, operator);
    this.logger.log(
      `enrichFieldsDirect Applied: foodId=${foodId}, updated=[${applied.updated.join(',')}]`,
    );
    return applied;
  }

  // ─── V8.3: 查询失败/被拒绝的食物列表 ─────────────────────────────────

  async getFailedFoods(
    limit: number,
    foodId?: string,
  ): Promise<Array<{ id: string; name: string }>> {
    return this.reEnqueueService.getFailedFoods(limit, foodId);
  }

  async resetEnrichmentStatus(foodId: string): Promise<void> {
    return this.reEnqueueService.resetEnrichmentStatus(foodId);
  }

  // ─── V8.9: 强制按指定字段重新入队 ─────────────────────────────────────────

  async getALLFoodsForReEnqueue(
    fields: EnrichableField[],
    options: { limit?: number; category?: string; primarySource?: string } = {},
  ): Promise<{ id: string; name: string }[]> {
    return this.reEnqueueService.getALLFoodsForReEnqueue(fields, options);
  }

  async clearFieldsForFoods(
    foodIds: string[],
    fields: EnrichableField[],
  ): Promise<{ cleared: number }> {
    return this.reEnqueueService.clearFieldsForFoods(foodIds, fields);
  }

  // ─── V8.3: 批量重算完整度 ──────────────────────────────────────────────

  async recalculateCompleteness(
    batchSize = 200,
  ): ReturnType<EnrichmentCompletenessService['recalculateCompleteness']> {
    return this.completenessService.recalculateCompleteness(batchSize);
  }

  // ─── V8.1: 单食物完整度查询 ─────────────────────────────────────────────

  async getCompletenessById(
    foodId: string,
  ): ReturnType<EnrichmentCompletenessService['getCompletenessById']> {
    return this.completenessService.getCompletenessById(foodId);
  }

  // ─── V7.9: 数据完整度评分 ─────────────────────────────────────────────

  computeCompletenessScore(
    food: any,
    successSourcePresence: Record<string, boolean> = {},
  ): CompletenessScore {
    return this.completenessService.computeCompletenessScore(
      food,
      successSourcePresence,
    );
  }

  // ─── V8.2: 历史统计 ──────────────────────────────────────────────────

  async getEnrichmentHistoricalStats(): ReturnType<
    EnrichmentCompletenessService['getEnrichmentHistoricalStats']
  > {
    return this.completenessService.getEnrichmentHistoricalStats();
  }

  async getEnrichmentProgress(): Promise<EnrichmentProgress> {
    return this.completenessService.getEnrichmentProgress();
  }

  async getCompletenessDistribution(): ReturnType<
    EnrichmentCompletenessService['getCompletenessDistribution']
  > {
    return this.completenessService.getCompletenessDistribution();
  }

  // ─── 扫描缺失字段统计（V7.9 优化：单次 SQL 聚合）───────────────────────

  async scanMissingFields(): Promise<MissingFieldStats> {
    return this.scanService.scanMissingFields();
  }

  // ─── 查询需要补全的食物列表 ────────────────────────────────────────────

  async getFoodsNeedingEnrichment(
    fields: EnrichableField[],
    limit = 50,
    offset = 0,
    maxCompleteness?: number,
    category?: string,
    primarySource?: string,
  ): Promise<{ id: string; name: string; missingFields: EnrichableField[] }[]> {
    return this.scanService.getFoodsNeedingEnrichment(
      fields,
      limit,
      offset,
      maxCompleteness,
      category,
      primarySource,
    );
  }

  // ─── V8.1: 查询需要关联表补全的食物 ──────────────────────────────────

  async getFoodsNeedingRelatedEnrichment(
    target: 'translations' | 'regional',
    limit: number,
    offset: number,
    locales?: string[],
    region?: string | string[],
  ): Promise<{ id: string; name: string; missingFields: EnrichableField[] }[]> {
    return this.scanService.getFoodsNeedingRelatedEnrichment(
      target,
      limit,
      offset,
      locales,
      region,
    );
  }

  // ─── 翻译补全（food_translations 表）─────────────────────────────────

  async enrichTranslations(
    foodId: string,
    locales: string[],
  ): Promise<Record<string, Record<string, any>>> {
    return this.i18nService.enrichTranslations(foodId, locales, this.apiKey);
  }

  // ─── 地区信息补全（food_regional_info 表）────────────────────────────

  async enrichRegional(
    foodId: string,
    region: string,
  ): Promise<Record<string, any> | null> {
    return this.i18nService.enrichRegional(foodId, region, this.apiKey);
  }

  // ─── 写入主表（直接模式）──────────────────────────────────────────────

  async applyEnrichment(
    foodId: string,
    result: EnrichmentResult,
    operator = 'ai_enrichment',
  ): Promise<{ updated: EnrichableField[]; skipped: EnrichableField[] }> {
    return this.applyService.applyEnrichment(foodId, result, operator);
  }

  // ─── 写入翻译关联表（批量模式，所有 locale 汇总成单条 changelog）────────

  /**
   * 批量写入多个 locale 的翻译补全结果，所有 locale 在单次事务内完成，
   * 最终只写入一条汇总 changelog（每个食物一条记录，而非每 locale 一条）。
   */
  async applyTranslationEnrichment(
    foodId: string,
    results: Record<string, Record<string, any>>,
    operator = 'ai_enrichment',
  ): Promise<{
    localesSummary: Record<
      string,
      { action: 'created' | 'updated' | 'skipped'; fields: string[] }
    >;
  }> {
    return this.applyService.applyTranslationEnrichment(
      foodId,
      results,
      operator,
    );
  }

  // ─── 写入地区信息关联表（直接模式）───────────────────────────────────

  async applyRegionalEnrichment(
    foodId: string,
    region: string,
    result: Record<string, any>,
    operator = 'ai_enrichment',
  ): Promise<{ action: 'created' | 'updated'; fields: string[] }> {
    return this.applyService.applyRegionalEnrichment(
      foodId,
      region,
      result,
      operator,
    );
  }

  async applyRegionalEnrichments(
    foodId: string,
    results: Record<string, Record<string, any>>,
    operator = 'ai_enrichment',
  ): Promise<{
    regionsSummary: Record<
      string,
      { action: 'created' | 'updated' | 'skipped'; fields: string[] }
    >;
  }> {
    return this.applyService.applyRegionalEnrichments(
      foodId,
      results,
      operator,
    );
  }

  // ─── Staging 模式：AI 结果写入 change_logs 待审核 ─────────────────────

  // ─── Staging 方法委托给 EnrichmentStagingService ──────────────────────

  async stageEnrichment(
    foodId: string,
    result: EnrichmentResult,
    target: EnrichmentTarget = 'foods',
    locales?: string[],
    region?: string,
    operator = 'ai_enrichment',
  ): Promise<string> {
    return this.stagingService.stageEnrichment(
      foodId,
      result,
      target,
      locales,
      region,
      operator,
    );
  }

  async getStagedEnrichments(params: {
    page?: number;
    pageSize?: number;
    foodId?: string;
    target?: EnrichmentTarget;
  }): Promise<{
    list: StagedEnrichment[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.stagingService.getStagedEnrichments(params);
  }

  async getEnrichmentPreview(
    logId: string,
  ): Promise<
    Awaited<ReturnType<EnrichmentStagingService['getEnrichmentPreview']>>
  > {
    return this.stagingService.getEnrichmentPreview(logId);
  }

  async getBatchEnrichmentPreview(
    logIds: string[],
  ): Promise<
    Awaited<ReturnType<EnrichmentStagingService['getBatchEnrichmentPreview']>>
  > {
    return this.stagingService.getBatchEnrichmentPreview(logIds);
  }

  async approveStaged(
    logId: string,
    operator = 'admin',
    selectedFields?: string[],
  ): Promise<{ applied: boolean; detail: string }> {
    return this.stagingService.approveStaged(logId, operator, selectedFields);
  }

  async rejectStaged(
    logId: string,
    reason: string,
    operator = 'admin',
  ): Promise<void> {
    return this.stagingService.rejectStaged(logId, reason, operator);
  }

  async batchApproveStaged(
    logIds: string[],
    operator = 'admin',
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    return this.stagingService.batchApproveStaged(logIds, operator);
  }

  async batchRejectStaged(
    logIds: string[],
    reason: string,
    operator = 'admin',
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    return this.stagingService.batchRejectStaged(logIds, reason, operator);
  }

  async getEnrichmentHistory(params: {
    foodId?: string;
    action?: string;
    page?: number;
    pageSize?: number;
  }): Promise<{
    list: StagedEnrichment[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.stagingService.getEnrichmentHistory(params);
  }

  // ─── V8.0: 回退补全（重置已补全字段为 null，使食物可重新补全）─────────

  async rollbackEnrichment(
    logId: string,
    operator = 'admin',
  ): Promise<{ rolledBack: boolean; detail: string }> {
    return this.applyService.rollbackEnrichment(logId, operator);
  }

  /**
   * 批量回退补全记录
   */
  async batchRollbackEnrichment(
    logIds: string[],
    operator = 'admin',
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    return this.applyService.batchRollbackEnrichment(logIds, operator);
  }

  // ─── 判断是否应该 staging（低置信度自动转暂存）───────────────────────

  shouldStage(result: EnrichmentResult, forceStagedMode: boolean): boolean {
    return forceStagedMode || result.confidence < CONFIDENCE_STAGING_THRESHOLD;
  }

  // ─── V7.9 Phase 2: 同类食物一致性校验（IQR 离群检测）─────────────────

  async validateCategoryConsistency(
    foodId: string,
  ): ReturnType<EnrichmentStatsService['validateCategoryConsistency']> {
    return this.statsService.validateCategoryConsistency(foodId);
  }

  // ─── V7.9 Phase 2: 补全结果统计 ──────────────────────────────────────

  async getEnrichmentStatistics(): ReturnType<
    EnrichmentStatsService['getEnrichmentStatistics']
  > {
    return this.statsService.getEnrichmentStatistics();
  }

  // ─── V8.1: 全局任务总览 ──────────────────────────────────────────────

  async getTaskOverview(): ReturnType<
    EnrichmentStatsService['getTaskOverview']
  > {
    return this.statsService.getTaskOverview();
  }

  // ─── V8.4: 聚合轮询端点 ──────────────────────────────────────────────

  async getDashboardPoll(
    queueSnapshot: Parameters<EnrichmentStatsService['getDashboardPoll']>[0],
  ): ReturnType<EnrichmentStatsService['getDashboardPoll']> {
    return this.statsService.getDashboardPoll(queueSnapshot);
  }

  // ─── V8.4: 历史 change_log 字段级对比 ────────────────────────────────

  async getHistoryLogDiff(
    logId: string,
  ): ReturnType<EnrichmentStatsService['getHistoryLogDiff']> {
    return this.statsService.getHistoryLogDiff(logId);
  }

  // ─── V8.4: 审核统计报表 ──────────────────────────────────────────────

  async getReviewStats(): ReturnType<EnrichmentStatsService['getReviewStats']> {
    return this.statsService.getReviewStats();
  }
}
