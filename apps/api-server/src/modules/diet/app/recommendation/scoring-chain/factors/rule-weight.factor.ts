/**
 * V7.2 P2-B: 语义规则权重因子
 *
 * 对应原 rankCandidates 中的 ruleWeight 折扣。
 * 语义补充路召回的食物带有 __ruleWeight < 1.0 的折扣系数。
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type { PipelineContext } from '../../types/recommendation.types';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

export class RuleWeightFactor implements ScoringFactor {
  readonly name = 'rule-weight';
  readonly order = 60;

  isApplicable(_ctx: PipelineContext): boolean {
    return true;
  }

  init(_ctx: PipelineContext): void {
    // 无需预计算
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    const ruleWeight = (food as any).__ruleWeight as number | undefined;
    if (ruleWeight === undefined || ruleWeight >= 1.0) return null;

    return {
      factorName: this.name,
      multiplier: ruleWeight,
      additive: 0,
      explanationKey: null,
      reason: `rule_weight×${ruleWeight.toFixed(3)}`,
    };
  }
}
