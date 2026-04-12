/**
 * V7.2 P2-B: 热门食物因子
 *
 * 对应原 rankCandidates 中的 popularityBoost。
 * 冷启动用户的 popularity 加权（交互多时衰减为 0）。
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type { PipelineContext } from '../../recommendation.types';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

export class PopularityFactor implements ScoringFactor {
  readonly name = 'popularity';
  readonly order = 50;

  private enabled = false;
  private popularWeight = 0;
  private coldStartFactor = 1;
  /** V7.5: 人气归一化除数 */
  private popularityNormalizationDivisor = 100;

  isApplicable(ctx: PipelineContext): boolean {
    const recallConfig = ctx.resolvedStrategy?.config?.recall;
    const popularEnabled = recallConfig?.sources?.popular?.enabled;
    return !!popularEnabled;
  }

  init(ctx: PipelineContext): void {
    const recallConfig = ctx.resolvedStrategy?.config?.recall;
    this.enabled = !!recallConfig?.sources?.popular?.enabled;
    this.popularWeight = recallConfig?.sources?.popular?.weight ?? 0;

    if (!this.enabled || this.popularWeight <= 0) return;

    // V7.5: 从调参配置读取归一化除数
    this.popularityNormalizationDivisor =
      ctx.tuning?.popularityNormalizationDivisor ?? 100;

    // 计算冷启动因子
    const explorationConfig = ctx.resolvedStrategy?.config?.exploration;
    const matureThreshold = explorationConfig?.matureThreshold ?? 50;

    let totalInteractions = 0;
    if (ctx.feedbackStats) {
      for (const stats of Object.values(ctx.feedbackStats)) {
        totalInteractions += (stats.accepted ?? 0) + (stats.rejected ?? 0);
      }
    }
    const maturity = Math.min(1, totalInteractions / matureThreshold);
    this.coldStartFactor = 1 - maturity;
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    if (!this.enabled || this.popularWeight <= 0 || food.popularity <= 0) {
      return null;
    }

    const normalizedPop = Math.min(
      food.popularity / this.popularityNormalizationDivisor,
      1,
    );
    const boost = 1 + this.popularWeight * normalizedPop * this.coldStartFactor;

    if (boost === 1.0) return null;

    return {
      factorName: this.name,
      multiplier: boost,
      additive: 0,
      explanationKey: 'popularityBoost',
      reason: `pop×${boost.toFixed(3)}(cold=${this.coldStartFactor.toFixed(2)})`,
    };
  }
}
