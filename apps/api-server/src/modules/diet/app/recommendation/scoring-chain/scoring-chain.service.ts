/**
 * V7.2 P2-A: ScoringChainService — 链式评分管道服务
 *
 * 管理所有 ScoringFactor 实例，按 order 排序执行，
 * 将 PipelineBuilder.rankCandidates() 中 400+ 行的顺序 boost 逻辑
 * 拆解为可插拔的链式处理。
 *
 * 职责：
 * 1. 注册 / 排序 ScoringFactor 实例
 * 2. 对候选食物列表执行链式评分
 * 3. 收集调整记录（ScoringAdjustment），回写到 ScoringExplanation
 * 4. 支持通过 ScoringChainConfig 禁用特定因子 / 调试模式
 */
import { Injectable, Logger } from '@nestjs/common';
import type { FoodLibrary } from '../../../../food/food.types';
import type { PipelineContext } from '../types/recommendation.types';
import type { ScoringExplanation } from '../types/scoring-explanation.interface';
import {
  DEFAULT_SCORING_CHAIN_CONFIG,
  type ScoringAdjustment,
  type ScoringChainConfig,
  type ScoringChainResult,
  type ScoringFactor,
} from './scoring-factor.interface';

@Injectable()
export class ScoringChainService {
  private readonly logger = new Logger(ScoringChainService.name);

  /** 已注册的因子（按 order 排序） */
  private factors: ScoringFactor[] = [];

  /**
   * 注册评分因子
   *
   * 可在 DietModule 初始化时调用，也可动态追加。
   * 注册后自动按 order 排序。
   */
  registerFactors(factors: ScoringFactor[]): void {
    this.factors.push(...factors);
    this.factors.sort((a, b) => a.order - b.order);
    this.logger.log(
      `Registered ${factors.length} scoring factors, total=${this.factors.length}: ` +
        `[${this.factors.map((f) => `${f.name}(${f.order})`).join(', ')}]`,
    );
  }

  /**
   * 获取已注册因子列表（只读）
   */
  getFactors(): readonly ScoringFactor[] {
    return this.factors;
  }

  /**
   * 对候选食物列表执行链式评分
   *
   * @param candidates   候选食物列表（已有基础分）
   * @param baseScores   每个食物的基础分（与 candidates 一一对应）
   * @param ctx          管道上下文
   * @param config       链配置（可选）
   * @returns 链式评分结果列表
   */
  executeChain(
    candidates: FoodLibrary[],
    baseScores: number[],
    ctx: PipelineContext,
    config?: Partial<ScoringChainConfig>,
  ): ScoringChainResult[] {
    const resolvedConfig = {
      ...DEFAULT_SCORING_CHAIN_CONFIG,
      ...config,
    };

    const disabledSet = new Set(resolvedConfig.disabledFactors);

    // 筛选可用因子
    const activeFactors = this.factors.filter((f) => {
      if (disabledSet.has(f.name)) {
        if (resolvedConfig.verbose) {
          this.logger.debug(`Factor [${f.name}] disabled by config`);
        }
        return false;
      }
      if (!f.isApplicable(ctx)) {
        if (resolvedConfig.verbose) {
          this.logger.debug(
            `Factor [${f.name}] not applicable for current context`,
          );
        }
        return false;
      }
      return true;
    });

    // 批量初始化
    for (const factor of activeFactors) {
      factor.init(ctx);
    }

    if (resolvedConfig.verbose) {
      this.logger.debug(
        `ScoringChain executing ${activeFactors.length} factors on ${candidates.length} candidates`,
      );
    }

    // 对每个候选食物执行链式评分
    const results: ScoringChainResult[] = [];

    for (let i = 0; i < candidates.length; i++) {
      const food = candidates[i];
      const baseScore = baseScores[i];
      let currentScore = baseScore;
      const adjustments: ScoringAdjustment[] = [];
      const explanation: Partial<ScoringExplanation> = {};

      for (const factor of activeFactors) {
        const adjustment = factor.computeAdjustment(food, currentScore, ctx);
        if (!adjustment) continue;

        // V7.3 P3-E: 应用 FactorLearner 学习的强度乘数
        // factorAdjustments 是 Map<factorName, strengthMultiplier>
        // strength > 1 放大因子影响，< 1 缩小因子影响
        const factorStrength = ctx.factorAdjustments?.get(factor.name);
        let effectiveMultiplier = adjustment.multiplier;
        let effectiveAdditive = adjustment.additive;
        if (factorStrength != null && factorStrength !== 1.0) {
          // 将 multiplier 偏差放大/缩小: newMult = 1 + (mult - 1) * strength
          effectiveMultiplier =
            1 + (adjustment.multiplier - 1) * factorStrength;
          effectiveAdditive = adjustment.additive * factorStrength;
        }

        // 应用调整: score = score * multiplier + additive
        const prevScore = currentScore;
        currentScore = currentScore * effectiveMultiplier + effectiveAdditive;
        adjustments.push({
          ...adjustment,
          multiplier: effectiveMultiplier,
          additive: effectiveAdditive,
        });

        // 回写到 explanation
        if (adjustment.explanationKey) {
          (explanation as Record<string, number>)[adjustment.explanationKey] =
            effectiveMultiplier;
        }

        if (resolvedConfig.verbose) {
          const strengthNote =
            factorStrength != null && factorStrength !== 1.0
              ? ` [strength=${factorStrength.toFixed(3)}]`
              : '';
          this.logger.debug(
            `  [${factor.name}] food=${food.name}: ` +
              `${prevScore.toFixed(2)} × ${effectiveMultiplier.toFixed(3)} + ${effectiveAdditive.toFixed(3)} = ${currentScore.toFixed(2)} ` +
              `(${adjustment.reason})${strengthNote}`,
          );
        }
      }

      // 分数限幅
      currentScore = Math.max(
        resolvedConfig.scoreFloor,
        Math.min(resolvedConfig.scoreCeiling, currentScore),
      );

      explanation.finalScore = currentScore;

      results.push({
        food,
        baseScore,
        finalScore: currentScore,
        adjustments,
        explanation,
      });
    }

    return results;
  }

  /**
   * 单食物评分（测试 / 调试用）
   */
  scoreFood(
    food: FoodLibrary,
    baseScore: number,
    ctx: PipelineContext,
    config?: Partial<ScoringChainConfig>,
  ): ScoringChainResult {
    const results = this.executeChain([food], [baseScore], ctx, config);
    return results[0];
  }
}
