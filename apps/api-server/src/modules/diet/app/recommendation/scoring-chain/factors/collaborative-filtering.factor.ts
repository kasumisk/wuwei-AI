/**
 * V7.2 P2-B: 协同过滤因子
 *
 * 对应原 rankCandidates 中的 cfBoost。
 * 从 ctx.cfScores 读取食物 ID → 协同过滤分数。
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type { PipelineContext } from '../../types/recommendation.types';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

export class CollaborativeFilteringFactor implements ScoringFactor {
  readonly name = 'collaborative-filtering';
  // C3-fix: 原 order=20 与 PriceFitFactor 冲突，调整为 22 以确保执行顺序确定
  readonly order = 22;

  private cfScores: Record<string, number> = {};
  private cfBoostCap = 0.15;

  isApplicable(ctx: PipelineContext): boolean {
    return !!ctx.cfScores;
  }

  init(ctx: PipelineContext): void {
    this.cfScores = ctx.cfScores ?? {};
    this.cfBoostCap = ctx.resolvedStrategy?.config?.boost?.cfBoostCap ?? 0.15;
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    const cfScore = this.cfScores[food.id];
    if (!cfScore || cfScore <= 0) return null;

    const delta = cfScore * this.cfBoostCap;
    return {
      factorName: this.name,
      multiplier: 1 + delta,
      additive: 0,
      explanationKey: 'cfBoost',
      reason: `cf×${(1 + delta).toFixed(3)}`,
    };
  }
}
