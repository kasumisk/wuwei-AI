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
import { BehaviorService } from '../../diet/app/services/behavior.service';
import { FoodService } from '../../diet/app/services/food.service';
import { DietIssue } from '../types/analysis-result.types';
import { t, Locale } from '../../diet/app/recommendation/utils/i18n-messages';
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

  constructor(
    private readonly behaviorService: BehaviorService,
    private readonly foodService: FoodService,
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
    },
    mealCalories: number,
    locale?: Locale,
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
        message: t(
          'decision.context.overBudget',
          { amount: String(Math.round(projectedTotal - ctx.goalCalories)) },
          locale,
        ),
      });
      result.additionalReasons.push(
        t(
          'decision.modifier.cumulativeSaturation',
          { percent: String(excessPct) },
          locale,
        ) || `今日总摄入已超标${excessPct}%`,
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
          message:
            (t('decision.modifier.lateNightRisk', {}, locale) ||
              '深夜进食可能影响睡眠和代谢') + lateCalSuffix,
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
          result.additionalIssues.push({
            category: 'multi_day_excess',
            severity: consecutiveExcess >= 5 ? 'critical' : 'warning',
            message:
              t(
                'decision.modifier.multiDayExcess',
                { days: String(consecutiveExcess) },
                locale,
              ) || `连续${consecutiveExcess}天超标`,
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
            t(
              'decision.modifier.healthyStreak',
              { days: String(healthyDays) },
              locale,
            ) || `连续${healthyDays}天健康饮食，适度放宽`,
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
            message:
              t(
                'decision.modifier.bingeRisk',
                { count: String(mealCount) },
                locale,
              ) || `今日已记录${mealCount}餐，注意暴食风险`,
          });
          result.additionalReasons.push(
            t(
              'decision.modifier.bingeRisk',
              { count: String(mealCount) },
              locale,
            ) || `今日已记录${mealCount}餐，请关注进食节奏`,
          );
        }
      }
    } catch (err) {
      this.logger.warn(
        `获取行为数据失败，跳过多日趋势分析: ${(err as Error).message}`,
      );
    }

    // 确保乘数在合理范围
    result.scoreMultiplier = Math.max(
      MODIFIER_PARAMS.multiplierMin,
      Math.min(MODIFIER_PARAMS.multiplierMax, result.scoreMultiplier),
    );

    return result;
  }
}
