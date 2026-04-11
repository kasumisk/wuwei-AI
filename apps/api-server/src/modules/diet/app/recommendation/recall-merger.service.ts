import { Injectable } from '@nestjs/common';
import { FoodLibrary } from '../../../food/food.types';

/**
 * 单条语义召回结果
 */
export interface SemanticRecallItem {
  food: FoodLibrary;
  /** 向量相似度评分（0–1） */
  semanticScore: number;
}

/**
 * 双路召回合并后的候选项
 *
 * source:
 *   'rule'     — 仅来自规则召回（候选池过滤链）
 *   'semantic' — 仅来自语义召回（向量 ANN 补充）
 *   'both'     — 规则路与语义路同时命中
 *
 * ruleWeight:
 *   - 'rule' / 'both' → 1.0（全权重参与排名）
 *   - 'semantic'      → 0.7（语义补充路折扣，避免无召回约束的噪音食物排名过高）
 */
export interface MergedCandidate {
  food: FoodLibrary;
  source: 'rule' | 'semantic' | 'both';
  semanticScore: number;
  /** 用于 rankCandidates 阶段的权重折扣系数（应用于最终 score） */
  ruleWeight: number;
}

/**
 * V6.6 Phase 2-A: 双路召回去重合并服务
 *
 * 将规则召回（FoodPoolCache 过滤链输出）与语义召回（SemanticRecallService 输出）
 * 做 ID 去重 + 来源标记 + ruleWeight 设置，输出统一的 MergedCandidate 列表。
 *
 * 合并规则：
 * 1. 规则路所有食物全量加入，source='rule'，ruleWeight=1.0
 * 2. 语义路食物：
 *    - 规则路已包含 → 升级 source='both'，填入 semanticScore（ruleWeight 保持 1.0）
 *    - 规则路未包含 → 新增 source='semantic'，ruleWeight=0.7（权重折扣）
 */
@Injectable()
export class RecallMergerService {
  /** 语义补充路的评分折扣系数 */
  private static readonly SEMANTIC_ONLY_WEIGHT = 0.7;

  /**
   * 合并规则召回候选与语义召回候选
   *
   * @param ruleCandidates  规则召回输出的食物列表（已去重、已过滤）
   * @param semanticItems   语义召回结果（含 semanticScore）
   * @returns 去重合并后的 MergedCandidate 列表（顺序：规则路在前，语义补充路在后）
   */
  merge(
    ruleCandidates: FoodLibrary[],
    semanticItems: SemanticRecallItem[],
  ): MergedCandidate[] {
    const merged = new Map<string, MergedCandidate>();

    // 规则路全量加入
    for (const food of ruleCandidates) {
      merged.set(food.id, {
        food,
        source: 'rule',
        semanticScore: 0,
        ruleWeight: 1.0,
      });
    }

    // 语义路：已有 → 升级 source='both'；新增 → source='semantic'，折扣权重
    for (const item of semanticItems) {
      const existing = merged.get(item.food.id);
      if (existing) {
        existing.source = 'both';
        existing.semanticScore = item.semanticScore;
        // ruleWeight 保持 1.0（规则路已验证，不降权）
      } else {
        merged.set(item.food.id, {
          food: item.food,
          source: 'semantic',
          semanticScore: item.semanticScore,
          ruleWeight: RecallMergerService.SEMANTIC_ONLY_WEIGHT,
        });
      }
    }

    return Array.from(merged.values());
  }

  /**
   * 从 MergedCandidate 列表还原 FoodLibrary 列表，
   * 并在 food 对象上附加调试元数据（__recallSource / __semanticScore / __ruleWeight）
   *
   * 调用方（recommendation-engine）可直接使用此方法获取与旧接口兼容的 FoodLibrary[]，
   * 同时保留足够的归因信息供 rankCandidates 读取。
   */
  toFoodList(merged: MergedCandidate[]): FoodLibrary[] {
    return merged.map((c) => {
      const food = c.food as FoodLibrary & {
        __recallSource?: string;
        __semanticScore?: number;
        __ruleWeight?: number;
      };
      food.__recallSource = c.source;
      food.__semanticScore = c.semanticScore;
      food.__ruleWeight = c.ruleWeight;
      return food;
    });
  }
}
