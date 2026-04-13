/**
 * V7.2 P2-B: 分析画像因子
 *
 * 对应原 rankCandidates 中的 analysisBoost。
 * 基于近期分析品类兴趣加成 + 风险食物惩罚。
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type { PipelineContext } from '../../types/recommendation.types';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

interface AnalysisProfile {
  recentAnalyzedCategories: Record<string, number>;
  recentRiskFoods?: string[];
}

export class AnalysisProfileFactor implements ScoringFactor {
  readonly name = 'analysis-profile';
  readonly order = 35;

  private analysisProfile: AnalysisProfile | null = null;
  /** V7.5: 从调参配置读取 */
  private categoryInterestPerCount = 0.02;
  private categoryInterestCap = 0.08;
  private riskFoodPenalty = 0.7;

  isApplicable(ctx: PipelineContext): boolean {
    return !!ctx.analysisProfile;
  }

  init(ctx: PipelineContext): void {
    this.analysisProfile = (ctx.analysisProfile as AnalysisProfile) ?? null;
    // V7.5: 从调参配置读取阈值
    const tuning = ctx.tuning;
    if (tuning) {
      this.categoryInterestPerCount = tuning.categoryInterestPerCount;
      this.categoryInterestCap = tuning.categoryInterestCap;
      this.riskFoodPenalty = tuning.riskFoodPenalty;
    }
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    _ctx: PipelineContext,
  ): ScoringAdjustment | null {
    if (!this.analysisProfile) return null;

    let boost = 1.0;
    const parts: string[] = [];

    // 品类兴趣加成
    const categoryCount =
      this.analysisProfile.recentAnalyzedCategories[food.category] ?? 0;
    if (categoryCount > 0) {
      const categoryInterestBoost = Math.min(
        categoryCount * this.categoryInterestPerCount,
        this.categoryInterestCap,
      );
      boost *= 1 + categoryInterestBoost;
      parts.push(`cat_interest+${(categoryInterestBoost * 100).toFixed(0)}%`);
    }

    // 风险食物惩罚
    if (this.analysisProfile.recentRiskFoods?.includes(food.name)) {
      boost *= this.riskFoodPenalty;
      parts.push(`risk_food×${this.riskFoodPenalty}`);
    }

    if (boost === 1.0) return null;

    return {
      factorName: this.name,
      multiplier: boost,
      additive: 0,
      explanationKey: 'analysisBoost',
      reason: parts.join(', '),
    };
  }
}
