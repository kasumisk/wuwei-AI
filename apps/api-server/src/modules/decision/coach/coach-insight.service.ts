import { Injectable } from '@nestjs/common';
import {
  ContextualAnalysis,
  StructuredDecision,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import { ci, toCoachLocale } from './coach-i18n';

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

    return {
      priorityInsight,
      trendInsight,
      goalInsight,
      timingInsight,
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
      return highHealthRisk.implication;
    }

    // 优先来自 ContextualAnalysis 高严重度问题
    const highIssue = analysis.identifiedIssues?.find(
      (i) => i.severity === 'high',
    );
    if (highIssue) {
      // 如果有量化 implication，优先使用
      if (highIssue.implication) return highIssue.implication;
      const key = `action.${highIssue.type}` as Parameters<typeof ci>[0];
      const text = ci(key, lang);
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
    return ci('guidance.close', lang);
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

    const SLOT_LABELS: Record<
      ReturnType<typeof toCoachLocale>,
      Record<string, Record<string, string>>
    > = {
      zh: {
        protein: {
          deficit: '蛋白质不足',
          normal: '蛋白质正常',
          excess: '蛋白质充足',
        },
        carbs: { deficit: '碳水偏低', normal: '碳水正常', excess: '碳水偏高' },
        fat: { deficit: '脂肪偏低', normal: '脂肪正常', excess: '脂肪偏高' },
      },
      en: {
        protein: {
          deficit: 'protein low',
          normal: 'protein normal',
          excess: 'protein sufficient',
        },
        carbs: {
          deficit: 'carbs low',
          normal: 'carbs normal',
          excess: 'carbs high',
        },
        fat: { deficit: 'fat low', normal: 'fat normal', excess: 'fat high' },
      },
      ja: {
        protein: {
          deficit: 'タンパク質不足',
          normal: 'タンパク質正常',
          excess: 'タンパク質充分',
        },
        carbs: {
          deficit: '炭水化物不足',
          normal: '炭水化物正常',
          excess: '炭水化物過多',
        },
        fat: { deficit: '脂肪不足', normal: '脂肪正常', excess: '脂肪過多' },
      },
    };

    const labels = SLOT_LABELS[lang];
    const proteinLabel = labels.protein[slots.protein] || slots.protein;
    const carbsLabel = labels.carbs[slots.carbs] || slots.carbs;
    const fatLabel = labels.fat[slots.fat] || slots.fat;

    const PREFIX: Record<ReturnType<typeof toCoachLocale>, string> = {
      zh: '今日状态：',
      en: "Today's status: ",
      ja: '今日の状態：',
    };

    return `${PREFIX[lang]}${proteinLabel}、${carbsLabel}、${fatLabel}`;
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

    const GOAL_HINTS: Record<
      ReturnType<typeof toCoachLocale>,
      Record<string, string>
    > = {
      zh: {
        fat_loss: '聚焦热量控制和蛋白质保留，当前优先减少热量密度高的食物。',
        muscle_gain: '聚焦蛋白质摄入和碳水时机，训练后及时补充。',
        maintenance: '维持宏量均衡，避免连续多日偏离目标。',
        health: '优先保证营养全面，关注膳食纤维和微量营养素。',
      },
      en: {
        fat_loss:
          'Focus on calorie control and protein retention. Prioritize lower-calorie-density foods.',
        muscle_gain:
          'Focus on protein intake and carb timing. Refuel promptly after training.',
        maintenance:
          'Maintain macro balance and avoid multi-day deviations from targets.',
        health:
          'Prioritize nutritional completeness, especially dietary fiber and micronutrients.',
      },
      ja: {
        fat_loss:
          'カロリーコントロールとタンパク質維持に集中しましょう。カロリー密度の高い食品を減らしてください。',
        muscle_gain:
          'タンパク質摂取と炭水化物のタイミングに集中してください。トレーニング後に速やかに補給しましょう。',
        maintenance:
          'マクロバランスを維持し、複数日にわたる目標からの逸脱を避けてください。',
        health: '栄養の完全性を優先し、食物繊維とミネラルに注意してください。',
      },
    };

    return GOAL_HINTS[lang]?.[goalType] || GOAL_HINTS[lang]?.['health'] || '';
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
    const TIMING: Record<
      ReturnType<typeof toCoachLocale>,
      Record<string, string>
    > = {
      zh: {
        morning: '早晨是补充蛋白质和复合碳水的好时机。',
        lunch: '午餐提供全天能量，均衡搭配蛋白质与碳水。',
        afternoon: '下午可适量补充轻食，避免能量下降。',
        evening: '晚餐建议以蛋白质和蔬菜为主，控制碳水量。',
        late_night: '夜间尽量避免高热量食物，选择易消化的轻食。',
      },
      en: {
        morning: 'Morning is a great time for protein and complex carbs.',
        lunch: 'Lunch provides all-day energy — balance protein and carbs.',
        afternoon: 'An afternoon snack can prevent energy dips.',
        evening:
          'Evening meals should focus on protein and veggies, limiting carbs.',
        late_night:
          'Late night — avoid high-calorie foods; choose light, easily digestible options.',
      },
      ja: {
        morning: '朝はタンパク質と複合炭水化物を補給する良い機会です。',
        lunch:
          '昼食は一日のエネルギーを提供します。タンパク質と炭水化物をバランスよく。',
        afternoon: '午後は軽食でエネルギー低下を防ぎましょう。',
        evening: '夕食はタンパク質と野菜中心に、炭水化物を控えめに。',
        late_night:
          '深夜は高カロリー食品を避け、消化しやすい軽食を選んでください。',
      },
    };

    let slot = 'lunch';
    if (hour >= 5 && hour < 10) slot = 'morning';
    else if (hour >= 10 && hour < 14) slot = 'lunch';
    else if (hour >= 14 && hour < 18) slot = 'afternoon';
    else if (hour >= 18 && hour < 21) slot = 'evening';
    else slot = 'late_night';

    return TIMING[lang]?.[slot];
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
}
