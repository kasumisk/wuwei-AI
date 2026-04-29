import { Injectable } from '@nestjs/common';
import {
  ContextualAnalysis,
  StructuredDecision,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import { I18nService } from '../../../core/i18n';
import { ci, toCoachLocale } from './coach-i18n';
import { ActionPlan } from './decision-coach.service';

/**
 * V3.3 Phase 3 — CoachInsightService
 *
 * 职责：基于 ContextualAnalysis + StructuredDecision + UnifiedUserContext
 * 生成个性化教练洞察（Insight），供上游 coach.service.ts 或 prompt-builder 消费。
 *
 * 洞察类型：
 * - priorityInsight: 当前最需要关注的一句话核心建议
 * - trendInsight: 基于宏量槽位状态的趋势描述
 * - goalInsight: 与用户目标对齐的建议
 * - timingInsight: 时机相关的个性化建议（来自 structuredDecision.rationale）
 */
@Injectable()
export class CoachInsightService {
  constructor(private readonly i18n: I18nService) {}

  /**
   * 生成完整的教练洞察包
   */
  generateInsights(
    contextualAnalysis: ContextualAnalysis,
    userContext: UnifiedUserContext,
    structuredDecision?: StructuredDecision,
    locale?: string,
  ): CoachInsightPack {
    const lang = toCoachLocale(locale);

    const priorityInsight = this.buildPriorityInsight(
      contextualAnalysis,
      structuredDecision,
      lang,
    );
    const trendInsight = this.buildTrendInsight(contextualAnalysis, lang);
    const goalInsight = this.buildGoalInsight(
      userContext,
      contextualAnalysis,
      lang,
    );
    const timingInsight = this.buildTimingInsight(
      structuredDecision,
      userContext,
      lang,
    );
    const actionPlan = this.buildActionPlan(
      userContext,
      structuredDecision,
      lang,
    );

    return {
      priorityInsight,
      trendInsight,
      goalInsight,
      timingInsight,
      actionPlan,
    };
  }

  // ==================== 私有方法 ====================

  /**
   * 优先级洞察：取最高严重度问题或 StructuredDecision 最低分维度
   */
  private buildPriorityInsight(
    analysis: ContextualAnalysis,
    sd: StructuredDecision | undefined,
    lang: ReturnType<typeof toCoachLocale>,
  ): string {
    // V3.6 P3.2: 健康风险类型优先 — 带 implication 量化数据
    const HEALTH_RISK_TYPES = new Set([
      'glycemic_risk',
      'cardiovascular_risk',
      'sodium_risk',
      'purine_risk',
      'kidney_stress',
    ]);
    const highHealthRisk = analysis.identifiedIssues?.find(
      (i) => HEALTH_RISK_TYPES.has(i.type) && i.severity === 'high',
    );
    if (highHealthRisk && highHealthRisk.implication) {
      return (
        ci(this.i18n, 'insight.healthRiskPrefix', lang) +
        highHealthRisk.implication
      );
    }

    // 优先来自 ContextualAnalysis 高严重度问题
    const highIssue = analysis.identifiedIssues?.find(
      (i) => i.severity === 'high',
    );
    if (highIssue) {
      // 如果有量化 implication，优先使用
      if (highIssue.implication) return highIssue.implication;
      const key = `action.${highIssue.type}` as Parameters<typeof ci>[1];
      const text = ci(this.i18n, key, lang);
      if (text !== key) return text;
    }

    // 其次来自 StructuredDecision 最低分因素
    if (sd?.factors) {
      const entries = Object.entries(sd.factors) as Array<
        [string, { score: number; rationale: string }]
      >;
      const lowest = entries.sort((a, b) => a[1].score - b[1].score)[0];
      if (lowest && lowest[1].score < 60) {
        return lowest[1].rationale;
      }
    }

    // fallback
    return ci(this.i18n, 'guidance.close', lang);
  }

  /**
   * 趋势洞察：从宏量槽位状态描述当天整体趋势
   */
  private buildTrendInsight(
    analysis: ContextualAnalysis,
    lang: ReturnType<typeof toCoachLocale>,
  ): string {
    const slots = analysis.macroSlotStatus;
    if (!slots) return '';

    const SLOT_KEYS: Record<
      string,
      Record<string, keyof import('./coach-i18n').CoachI18nStrings>
    > = {
      protein: {
        deficit: 'insight.slot.protein.deficit',
        normal: 'insight.slot.protein.normal',
        excess: 'insight.slot.protein.excess',
      },
      carbs: {
        deficit: 'insight.slot.carbs.deficit',
        normal: 'insight.slot.carbs.normal',
        excess: 'insight.slot.carbs.excess',
      },
      fat: {
        deficit: 'insight.slot.fat.deficit',
        normal: 'insight.slot.fat.normal',
        excess: 'insight.slot.fat.excess',
      },
    };

    const proteinLabel =
      ci(
        this.i18n,
        SLOT_KEYS.protein[slots.protein] ??
          ('insight.slot.protein.normal' as any),
        lang,
      ) || slots.protein;
    const carbsLabel =
      ci(
        this.i18n,
        SLOT_KEYS.carbs[slots.carbs] ?? ('insight.slot.carbs.normal' as any),
        lang,
      ) || slots.carbs;
    const fatLabel =
      ci(
        this.i18n,
        SLOT_KEYS.fat[slots.fat] ?? ('insight.slot.fat.normal' as any),
        lang,
      ) || slots.fat;

    const prefix = ci(this.i18n, 'insight.trendPrefix', lang);

    return `${prefix}${proteinLabel}、${carbsLabel}、${fatLabel}`;
  }

  /**
   * 目标对齐洞察：基于用户目标类型 + StructuredDecision.rationale.goalAlignment
   */
  private buildGoalInsight(
    ctx: UnifiedUserContext,
    analysis: ContextualAnalysis,
    lang: ReturnType<typeof toCoachLocale>,
  ): string {
    // 优先使用 rationale 中的目标对齐说明（由调用方注入 sd）
    const goalType = ctx.goalType || 'health';

    const goalKey =
      `insight.goal.${goalType}` as keyof import('./coach-i18n').CoachI18nStrings;
    const fallbackKey =
      'insight.goal.health' as keyof import('./coach-i18n').CoachI18nStrings;
    return ci(this.i18n, goalKey, lang) || ci(this.i18n, fallbackKey, lang);
  }

  /**
   * 时机洞察：来自 StructuredDecision.rationale.timelinessNote 或根据时段生成
   */
  private buildTimingInsight(
    sd: StructuredDecision | undefined,
    ctx: UnifiedUserContext,
    lang: ReturnType<typeof toCoachLocale>,
  ): string | undefined {
    // 优先使用 StructuredDecision 中的时机说明
    if (sd?.rationale?.timelinessNote) {
      return sd.rationale.timelinessNote;
    }

    const hour = ctx.localHour ?? 12;

    let slot = 'lunch';
    if (hour >= 5 && hour < 10) slot = 'morning';
    else if (hour >= 10 && hour < 14) slot = 'lunch';
    else if (hour >= 14 && hour < 18) slot = 'afternoon';
    else if (hour >= 18 && hour < 21) slot = 'evening';
    else slot = 'late_night';

    const timingKey =
      `insight.timing.${slot}` as keyof import('./coach-i18n').CoachI18nStrings;
    return ci(this.i18n, timingKey, lang) || undefined;
  }

  /**
   * V4.5 P3.2: 三段式行动计划生成
   * V4.6: 消费 shortTermBehavior.intakeTrends + goalProgress.executionRate
   *
   * - immediate: 基于当前决策判定（avoid/caution/recommend）
   *              V4.6: 摄入上升趋势 → 更严格 immediate
   * - nextMeal:  基于用户目标类型
   * - longTerm:  基于用户目标类型的长期习惯建议
   *              V4.6: 执行率低 → 鼓励性 longTerm
   */
  private buildActionPlan(
    ctx: UnifiedUserContext,
    sd: StructuredDecision | undefined,
    lang: ReturnType<typeof toCoachLocale>,
  ): ActionPlan {
    const verdict = sd?.verdict ?? 'recommend';
    const goalType = ctx.goalType || 'health';

    // V4.6: 摄入趋势上升 → 替换 immediate 为更严格版本
    let immediate: string;
    if (ctx.shortTermBehavior?.intakeTrends === 'increasing') {
      immediate = ci(this.i18n, 'actionPlan.trendUp.immediate', lang);
    } else {
      const immediateKey =
        `actionPlan.immediate.${verdict}` as keyof import('./coach-i18n').CoachI18nStrings;
      immediate = ci(this.i18n, immediateKey, lang);
    }

    const goalNextKey =
      `actionPlan.nextMeal.${goalType}` as keyof import('./coach-i18n').CoachI18nStrings;
    const goalLongKey =
      `actionPlan.longTerm.${goalType}` as keyof import('./coach-i18n').CoachI18nStrings;

    const nextMeal =
      ci(this.i18n, goalNextKey, lang) ||
      ci(this.i18n, 'actionPlan.nextMeal.default' as any, lang);

    // V4.6: 执行率低 → 替换 longTerm 为鼓励性版本
    let longTerm: string;
    const execRate = ctx.goalProgress?.executionRate;
    if (execRate != null && execRate < 0.4) {
      longTerm = ci(this.i18n, 'actionPlan.lowExecution.longTerm', lang);
    } else {
      longTerm =
        ci(this.i18n, goalLongKey, lang) ||
        ci(this.i18n, 'actionPlan.longTerm.default' as any, lang);
    }

    return { immediate, nextMeal, longTerm };
  }
}

// ==================== 输出类型 ====================

export interface CoachInsightPack {
  /** 当前最需要关注的核心建议 */
  priorityInsight: string;
  /** 今日宏量趋势描述 */
  trendInsight: string;
  /** 与目标对齐的个性化建议 */
  goalInsight: string;
  /** 时机建议（可选） */
  timingInsight?: string;
  /** V4.5 P3.2: 三段式行动计划 */
  actionPlan: ActionPlan;
}
