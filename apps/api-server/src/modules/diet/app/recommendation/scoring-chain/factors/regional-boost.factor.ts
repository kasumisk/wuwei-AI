/**
 * V7.2 P2-B: 地区感知因子
 *
 * 对应原 rankCandidates 中的 regionalBoost。
 * 从 ctx.regionalBoostMap 读取食物 ID → 乘数映射。
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type { PipelineContext } from '../../recommendation.types';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

export class RegionalBoostFactor implements ScoringFactor {
  readonly name = 'regional-boost';
  readonly order = 15;

  private boostMap: Record<string, number> = {};

  isApplicable(ctx: PipelineContext): boolean {
    return !!ctx.regionalBoostMap;
  }

  init(ctx: PipelineContext): void {
    this.boostMap = ctx.regionalBoostMap ?? {};
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    const regionW = this.boostMap[food.id];
    if (regionW === undefined || regionW === 1.0) return null;

    return {
      factorName: this.name,
      multiplier: regionW,
      additive: 0,
      explanationKey: 'regionalBoost',
      reason: `region×${regionW.toFixed(3)}`,
    };
  }
}
