import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../../food/food.types';
import {
  RecallMetadata,
  CFRecallResult,
  ScoringConfigSnapshot,
} from '../types/recommendation.types';

/**
 * 单条语义召回结果
 */
export interface SemanticRecallItem {
  food: FoodLibrary;
  /** 向量相似度评分（0–1） */
  semanticScore: number;
}

/**
 * V6.7 Phase 2-B: 三路召回合并后的候选项
 *
 * source:
 *   'rule'     — 仅来自规则召回（候选池过滤链）
 *   'semantic' — 仅来自语义召回（向量 ANN 补充）
 *   'cf'       — 仅来自 CF 召回
 *   'both'     — 多路同时命中（向下兼容旧值）
 *
 * ruleWeight:
 *   - 规则路 → 1.0（全权重参与排名）
 *   - 语义 only → config.semanticOnlyWeight (默认 0.7)
 *   - CF only → config.cfOnlyWeight (默认 0.6)
 *   - 多路命中且包含规则路 → 1.0
 *   - 语义+CF（无规则路）→ min(1.0, 语义权重 + 0.1)
 */
export interface MergedCandidate {
  /** 食物对象。CF-only 候选为 null，需由 toFoodListWithAllFoods() 还原 */
  food: FoodLibrary | null;
  /** CF-only 候选的食物 ID（food 为 null 时使用） */
  foodId?: string;
  source: 'rule' | 'semantic' | 'cf' | 'both';
  semanticScore: number;
  cfScore: number;
  /** 用于 rankCandidates 阶段的权重折扣系数（应用于最终 score） */
  ruleWeight: number;
}

/**
 * V6.7 Phase 2-B: 三路召回去重合并服务
 *
 * 将规则召回、语义召回、CF 召回做 ID 去重 + 来源标记 + ruleWeight 设置，
 * 输出统一的 MergedCandidate 列表 + RecallMetadata 映射。
 *
 * V6.6 → V6.7 升级点：
 * 1. 新增 CF 召回第三路
 * 2. 输出 RecallMetadata 供下游精细化使用
 * 3. 品类限额：非规则路 only 的候选，每 category 最多 N 个
 * 4. 权重从硬编码常量改为从 ScoringConfigSnapshot 读取
 *
 * 合并规则：
 * 1. 规则路所有食物全量加入，source='rule'，ruleWeight=1.0
 * 2. 语义路食物：
 *    - 规则路已包含 → 升级 source='both'，填入 semanticScore
 *    - 规则路未包含 → 新增 source='semantic'，ruleWeight = config.semanticOnlyWeight
 * 3. CF 路食物：
 *    - 已存在 → 补充 cfScore，如果非规则路则略微提权 (+0.1, cap 1.0)
 *    - 未存在 → 新增 source='cf'，ruleWeight = config.cfOnlyWeight
 */
@Injectable()
export class RecallMergerService {
  /** 默认语义补充路的评分折扣系数（config 缺失时使用） */
  private static readonly DEFAULT_SEMANTIC_ONLY_WEIGHT = 0.7;
  /** 默认 CF 补充路的评分折扣系数（config 缺失时使用） */
  private static readonly DEFAULT_CF_ONLY_WEIGHT = 0.6;
  /** 默认非规则路品类候选上限 */
  private static readonly DEFAULT_MAX_PER_CATEGORY = 5;

  /**
   * V6.7 Phase 2-B: 三路合并（带 RecallMetadata 输出）
   *
   * @param ruleCandidates     规则召回输出的食物列表（已去重、已过滤）
   * @param semanticItems      语义召回结果（含 semanticScore）
   * @param cfCandidates       CF 召回结果（V6.7 新增，可选）
   * @param config             评分参数快照（可选，缺失时使用默认值）
   * @returns 合并后的食物列表 + RecallMetadata 映射
   */
  mergeThreeWay(
    ruleCandidates: FoodLibrary[],
    semanticItems: SemanticRecallItem[],
    cfCandidates: CFRecallResult[],
    config?: ScoringConfigSnapshot | null,
  ): { merged: MergedCandidate[]; metadata: Map<string, RecallMetadata> } {
    const semanticOnlyWeight =
      config?.semanticOnlyWeight ??
      RecallMergerService.DEFAULT_SEMANTIC_ONLY_WEIGHT;
    const cfOnlyWeight =
      config?.cfOnlyWeight ?? RecallMergerService.DEFAULT_CF_ONLY_WEIGHT;
    const maxPerCategory =
      config?.maxCandidatesPerCategoryForNonRule ??
      RecallMergerService.DEFAULT_MAX_PER_CATEGORY;

    const candidateMap = new Map<string, MergedCandidate>();
    const metadata = new Map<string, RecallMetadata>();

    // 1. 规则路全量加入
    for (const food of ruleCandidates) {
      candidateMap.set(food.id, {
        food,
        source: 'rule',
        semanticScore: 0,
        cfScore: 0,
        ruleWeight: 1.0,
      });
      metadata.set(food.id, {
        foodId: food.id,
        sources: new Set(['rule']),
        semanticScore: 0,
        cfScore: 0,
        ruleWeight: 1.0,
      });
    }

    // 2. 语义路
    for (const item of semanticItems) {
      const existing = candidateMap.get(item.food.id);
      const existingMeta = metadata.get(item.food.id);

      if (existing && existingMeta) {
        // 规则路已包含 → 升级 source='both'
        existing.source = 'both';
        existing.semanticScore = item.semanticScore;
        existingMeta.sources.add('semantic');
        existingMeta.semanticScore = item.semanticScore;
        // ruleWeight 保持 1.0（规则路已验证，不降权）
      } else {
        // 语义路独占
        candidateMap.set(item.food.id, {
          food: item.food,
          source: 'semantic',
          semanticScore: item.semanticScore,
          cfScore: 0,
          ruleWeight: semanticOnlyWeight,
        });
        metadata.set(item.food.id, {
          foodId: item.food.id,
          sources: new Set(['semantic']),
          semanticScore: item.semanticScore,
          cfScore: 0,
          ruleWeight: semanticOnlyWeight,
        });
      }
    }

    // 3. CF 路
    for (const cf of cfCandidates) {
      const existing = candidateMap.get(cf.foodId);
      const existingMeta = metadata.get(cf.foodId);

      if (existing && existingMeta) {
        // 已有候选 → 补充 cfScore + 来源标记
        existing.cfScore = cf.cfScore;
        existingMeta.sources.add('cf');
        existingMeta.cfScore = cf.cfScore;

        // 非规则路 → 略微提权（CF 增强了候选可信度）
        if (!existingMeta.sources.has('rule')) {
          const newWeight = Math.min(1.0, existing.ruleWeight + 0.1);
          existing.ruleWeight = newWeight;
          existingMeta.ruleWeight = newWeight;
        }

        // 更新 source 标记
        if (existing.source !== 'rule') {
          existing.source = 'both';
        }
      } else {
        // CF-only 候选 — food 为 null，由 toFoodListWithAllFoods() 通过 foodId 还原
        candidateMap.set(cf.foodId, {
          food: null,
          foodId: cf.foodId,
          source: 'cf',
          semanticScore: 0,
          cfScore: cf.cfScore,
          ruleWeight: cfOnlyWeight,
        });
        metadata.set(cf.foodId, {
          foodId: cf.foodId,
          sources: new Set(['cf']),
          semanticScore: 0,
          cfScore: cf.cfScore,
          ruleWeight: cfOnlyWeight,
        });
      }
    }

    // 4. 品类限额：非规则路 only 的候选，每 category 最多 maxPerCategory 个
    const result = this.enforceCategoryLimit(
      Array.from(candidateMap.values()),
      metadata,
      maxPerCategory,
    );

    return { merged: result, metadata };
  }

  /**
   * V6.7 Phase 2-B: 从 MergedCandidate 列表还原 FoodLibrary 列表
   *
   * 使用 allFoods 补全 CF-only 候选缺失的 food 对象，
   * 附加调试元数据 (__recallSource / __semanticScore / __cfScore / __ruleWeight)
   */
  toFoodListWithAllFoods(
    merged: MergedCandidate[],
    allFoods: FoodLibrary[],
  ): FoodLibrary[] {
    const allFoodsMap = new Map<string, FoodLibrary>();
    for (const f of allFoods) {
      allFoodsMap.set(f.id, f);
    }

    return merged
      .map((c) => {
        // 还原 CF-only 候选的 food 对象
        let food = c.food;
        if (!food || !food.id) {
          const resolved = allFoodsMap.get(c.foodId ?? '');
          if (!resolved) return null; // 食物不在库中，跳过
          food = resolved;
        }

        const enriched = food as FoodLibrary & {
          __recallSource?: string;
          __semanticScore?: number;
          __cfScore?: number;
          __ruleWeight?: number;
        };
        enriched.__recallSource = c.source;
        enriched.__semanticScore = c.semanticScore;
        enriched.__cfScore = c.cfScore;
        enriched.__ruleWeight = c.ruleWeight;
        return enriched;
      })
      .filter((f): f is FoodLibrary => f !== null);
  }

  /**
   * V6.6 兼容：从 MergedCandidate 列表还原 FoodLibrary 列表（旧签名）
   *
   * 注意：无法还原 CF-only 候选，这些会被过滤掉
   */
  toFoodList(merged: MergedCandidate[]): FoodLibrary[] {
    return merged
      .filter(
        (c): c is MergedCandidate & { food: FoodLibrary } =>
          c.food !== null && !!c.food?.id,
      )
      .map((c) => {
        const food = c.food as FoodLibrary & {
          __recallSource?: string;
          __semanticScore?: number;
          __cfScore?: number;
          __ruleWeight?: number;
        };
        food.__recallSource = c.source;
        food.__semanticScore = c.semanticScore;
        food.__cfScore = c.cfScore;
        food.__ruleWeight = c.ruleWeight;
        return food;
      });
  }

  /**
   * 品类限额：非规则路 only 的候选，每 category 最多 maxPerCategory 个
   */
  private enforceCategoryLimit(
    candidates: MergedCandidate[],
    metadata: Map<string, RecallMetadata>,
    maxPerCategory: number,
  ): MergedCandidate[] {
    const categoryCount = new Map<string, number>();
    return candidates.filter((c) => {
      if (!c.food || !c.food.id) {
        // CF-only 候选暂时没有 food 对象，无法按品类限制
        // 保留，由 toFoodListWithAllFoods 阶段过滤
        return true;
      }
      const meta = metadata.get(c.food.id);
      if (!meta || meta.sources.has('rule')) return true; // 规则路不限制
      const cat = c.food.category ?? 'unknown';
      const count = categoryCount.get(cat) ?? 0;
      if (count >= maxPerCategory) return false;
      categoryCount.set(cat, count + 1);
      return true;
    });
  }
}
