/**
 * V1.9 Phase 2.1 — 上下文决策修正器
 *
 * 在基础决策之上叠加动态修正，引入需要异步数据的高级信号：
 * - 累积饱和度: 今日已超标时，对非必需食物降级
 * - 多日趋势: 连续超标天数 → 阈值上移（更严格）
 * - 暴食风险: 短时间大量记录 → 风险提示
 *
 * 设计原则:
 * - 输入: 基础决策 + 用户上下文 + 行为数据
 * - 输出: 修正后的分数调整量 + 额外 DietIssue
 * - 不修改原始决策对象，返回修正建议供调用方合并
 */
import { Injectable, Logger } from '@nestjs/common';
import { I18nService, I18nLocale } from '../../../core/i18n';
import { BehaviorService } from '../../diet/app/services/behavior.service';
import { FoodService } from '../../diet/app/services/food.service';
import { DietIssue } from '../types/analysis-result.types';
import { ci, toCoachLocale } from '../coach/coach-i18n';
import {
  MODIFIER_PARAMS,
  TIME_BOUNDARIES,
} from '../config/decision-thresholds';

// ==================== 输出类型 ====================

export interface ContextualModification {
  /** 分数乘数 (0-1)，1 表示不修正 */
  scoreMultiplier: number;
  /** 额外的饮食问题 */
  additionalIssues: DietIssue[];
  /** 额外的上下文原因（追加到 contextReasons） */
  additionalReasons: string[];
  /** 是否触发了暴食风险 */
  bingeRiskDetected: boolean;
  /** 连续超标天数 */
  consecutiveExcessDays: number;
}

@Injectable()
export class ContextualDecisionModifierService {
  private readonly logger = new Logger(ContextualDecisionModifierService.name);

  constructor(private readonly behaviorService: BehaviorService,
    private readonly foodService: FoodService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 计算上下文修正
   */
  async computeModification(
    userId: string | undefined,
    ctx: {
      todayCalories: number;
      goalCalories: number;
      localHour: number;
      goalType: string;
      /** V4.0: 短期行为画像 */
      shortTermBehavior?: {
        bingeRiskHours: number[];
        intakeTrends: 'increasing' | 'stable' | 'decreasing';
      };
    },
    mealCalories: number,
    locale?: I18nLocale,
  ): Promise<ContextualModification> {
    const result: ContextualModification = {
      scoreMultiplier: 1,
      additionalIssues: [],
      additionalReasons: [],
      bingeRiskDetected: false,
      consecutiveExcessDays: 0,
    };

    if (!userId) return result;

    // 1. 累积饱和度检查
    const projectedTotal = ctx.todayCalories + mealCalories;
    const saturationRatio =
      ctx.goalCalories > 0 ? projectedTotal / ctx.goalCalories : 0;

    if (saturationRatio > MODIFIER_PARAMS.saturationThreshold) {
      const excessPct = Math.round((saturationRatio - 1) * 100);
      result.scoreMultiplier *= MODIFIER_PARAMS.saturationMultiplier;
      result.additionalIssues.push({
        category: 'cumulative_excess',
        severity: excessPct > 30 ? 'critical' : 'warning',
        message: this.i18n.t('decision.context.overBudget', locale, { amount: Math.round(projectedTotal - ctx.goalCalories) }),
      });
      result.additionalReasons.push(
        this.i18n.t('decision.modifier.cumulativeSaturation', locale, { percent: excessPct }),
      );
    }

    // 2. 深夜时段额外修正（在基础时间逻辑之上叠加）
    if (
      ctx.localHour >= TIME_BOUNDARIES.modifierLateNightStart ||
      ctx.localHour < TIME_BOUNDARIES.modifierLateNightEnd
    ) {
      // 深夜进食热量门槛：动态基于日目标 10%（与 snackHighCalRatio 一致），回退 200
      const lateNightCalThreshold =
        ctx.goalCalories > 0 ? Math.round(ctx.goalCalories * 0.1) : 200;
      if (mealCalories > lateNightCalThreshold) {
        result.scoreMultiplier *= MODIFIER_PARAMS.lateNightMultiplier;
        // 量化：附带本餐实际热量，如 "深夜进食可能影响睡眠和代谢（350kcal）"
        const lateCalSuffix = ` (${Math.round(mealCalories)}kcal)`;
        result.additionalIssues.push({
          category: 'binge_risk',
          severity: 'warning',
          message: this.i18n.t('decision.modifier.lateNightRisk', locale) + lateCalSuffix,
        });
      }
    }

    // 3. 多日趋势 + 暴食风险（需要异步数据）
    try {
      const behaviorProfile = await this.behaviorService.getProfile(userId);
      if (behaviorProfile) {
        // 3a. 连续超标天数
        const streaks = behaviorProfile.streaks as {
          currentStreak?: number;
          excessDays?: number;
          healthyDays?: number;
        } | null;
        const consecutiveExcess = streaks?.excessDays || 0;
        result.consecutiveExcessDays = consecutiveExcess;

        if (consecutiveExcess >= MODIFIER_PARAMS.streakMinDays) {
          const strictnessPenalty = Math.min(
            consecutiveExcess * MODIFIER_PARAMS.excessDayStrictness,
            MODIFIER_PARAMS.maxStrictnessPenalty,
          );
          result.scoreMultiplier *= 1 - strictnessPenalty;

          // V3.6 P2.2: 连续超标时额外收紧
          if (consecutiveExcess >= MODIFIER_PARAMS.consecutiveExcessExtraDays) {
            result.scoreMultiplier *=
              MODIFIER_PARAMS.consecutiveExcessExtraPenalty;
          }

          result.additionalIssues.push({
            category: 'multi_day_excess',
            severity: consecutiveExcess >= 5 ? 'critical' : 'warning',
            message: this.i18n.t('decision.modifier.multiDayExcess', locale, { days: consecutiveExcess }),
          });
        }

        // V2.0: 正向反馈 — 连续健康饮食奖励
        const healthyDays = streaks?.healthyDays || 0;
        if (
          healthyDays >= MODIFIER_PARAMS.streakMinDays &&
          consecutiveExcess === 0
        ) {
          result.scoreMultiplier *= MODIFIER_PARAMS.healthyStreakBonus;
          result.additionalReasons.push(
            this.i18n.t('decision.modifier.healthyStreak', locale, { days: healthyDays }),
          );
        }

        // 3b. 暴食风险：当日餐数异常多
        const todaySummary = await this.foodService.getTodaySummary(userId);
        const mealCount = todaySummary?.mealCount || 0;
        if (mealCount >= MODIFIER_PARAMS.bingeMealThreshold) {
          result.bingeRiskDetected = true;
          result.additionalIssues.push({
            category: 'binge_risk',
            severity: 'critical',
            message: this.i18n.t('decision.modifier.bingeRisk', locale, { count: mealCount }),
          });
          result.additionalReasons.push(
            this.i18n.t('decision.modifier.bingeRiskReason', locale, { count: mealCount }),
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `Failed to fetch behavior data, skipping multi-day trend analysis: ${(err as Error).message}`,
      );
    }

    // V4.0: 暴食风险小时窗口感知（来自 shortTermBehavior）
    if (ctx.shortTermBehavior?.bingeRiskHours?.length) {
      if (ctx.shortTermBehavior.bingeRiskHours.includes(ctx.localHour)) {
        result.scoreMultiplier *= MODIFIER_PARAMS.bingeHourMultiplier;
        result.additionalReasons.push(
          ci('modifier.bingeRiskHour', toCoachLocale(locale), {
            hour: String(ctx.localHour),
          }),
        );
      }
    }

    // V4.0: 7天摄入趋势修正
    if (ctx.shortTermBehavior?.intakeTrends === 'increasing') {
      result.scoreMultiplier *= MODIFIER_PARAMS.trendIncreasingMultiplier;
      result.additionalReasons.push(
        ci('modifier.trendIncreasing', toCoachLocale(locale)),
      );
    } else if (ctx.shortTermBehavior?.intakeTrends === 'decreasing') {
      result.scoreMultiplier *= MODIFIER_PARAMS.trendDecreasingMultiplier;
    }

    // 确保乘数在合理范围
    result.scoreMultiplier = Math.max(
      MODIFIER_PARAMS.multiplierMin,
      Math.min(MODIFIER_PARAMS.multiplierMax, result.scoreMultiplier),
    );

    return result;
  }
}
