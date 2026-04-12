/**
 * V7.2 P2-B: 短期画像因子
 *
 * 对应原 rankCandidates 中的 shortTermBoost。
 * 基于近 7 天行为（接受率 + 拒绝惩罚）调整。
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type { PipelineContext } from '../../recommendation.types';
import type { ShortTermProfile } from '../../../../../user/app/realtime-profile.service';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

export class ShortTermProfileFactor implements ScoringFactor {
  readonly name = 'short-term-profile';
  readonly order = 25;

  private shortTermProfile: ShortTermProfile | null = null;
  private mealType = '';
  private boostRange: [number, number] = [0.9, 1.1];
  private singleRejectPenalty = 0.85;

  isApplicable(ctx: PipelineContext): boolean {
    return !!ctx.shortTermProfile?.categoryPreferences;
  }

  init(ctx: PipelineContext): void {
    this.shortTermProfile = ctx.shortTermProfile ?? null;
    this.mealType = ctx.mealType;
    const boostConfig = ctx.resolvedStrategy?.config?.boost as any;
    this.boostRange = boostConfig?.shortTerm?.boostRange ?? [0.9, 1.1];
    this.singleRejectPenalty =
      boostConfig?.shortTerm?.singleRejectPenalty ?? 0.85;
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    if (!this.shortTermProfile) return null;

    let boost = 1.0;
    const mealPref = this.shortTermProfile.categoryPreferences?.[this.mealType];
    if (mealPref) {
      const total = mealPref.accepted + mealPref.rejected + mealPref.replaced;
      if (total >= 3) {
        const acceptRate = mealPref.accepted / total;
        const [minBoost, maxBoost] = this.boostRange;
        boost = minBoost + acceptRate * (maxBoost - minBoost);
      }
    }

    const rejCount = this.shortTermProfile.rejectedFoods?.[food.name] || 0;
    if (rejCount === 1) {
      boost *= this.singleRejectPenalty;
    }

    if (boost === 1.0) return null;

    return {
      factorName: this.name,
      multiplier: boost,
      additive: 0,
      explanationKey: 'shortTermBoost',
      reason: `short_term×${boost.toFixed(3)}`,
    };
  }
}
