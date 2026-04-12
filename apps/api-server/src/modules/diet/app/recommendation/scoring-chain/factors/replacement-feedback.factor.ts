/**
 * V7.2 P2-B: 替换反馈因子
 *
 * 对应原 rankCandidates 中的 replacementBoost。
 * 从 ctx.replacementWeightMap 读取替换反馈乘数。
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type { PipelineContext } from '../../recommendation.types';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

export class ReplacementFeedbackFactor implements ScoringFactor {
  readonly name = 'replacement-feedback';
  readonly order = 55;

  private weightMap: Map<string, number> | null = null;

  isApplicable(ctx: PipelineContext): boolean {
    return !!ctx.replacementWeightMap && ctx.replacementWeightMap.size > 0;
  }

  init(ctx: PipelineContext): void {
    this.weightMap = ctx.replacementWeightMap ?? null;
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    const boost = this.weightMap?.get(food.id) ?? 1.0;
    if (boost === 1.0) return null;

    return {
      factorName: this.name,
      multiplier: boost,
      additive: 0,
      explanationKey: 'replacementBoost',
      reason: `replacement×${boost.toFixed(3)}`,
    };
  }
}
