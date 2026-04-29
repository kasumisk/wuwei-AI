import { Injectable } from '@nestjs/common';
import {
  ContextualAnalysis,
  NutritionIssue,
  StructuredDecision,
  UnifiedUserContext,
} from '../types/analysis-result.types';
import type { ConflictReport } from '../types/decision.types';
import type { AnalyzedFoodItem } from '../types/food-item.types';
import { ci, toCoachLocale, CoachLocale } from './coach-i18n';
import { cl } from '../i18n/decision-labels';
import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

// ==================== V4.7 P3.1: 模块级常量 ====================

/** V4.8 P3.1: Factor-type config — threshold + severity + synthetic issue type */
interface FactorTypeConfig {
  /** Synthetic issue type for coach enrichment */
  issueType: string;
  /** Score threshold below which the factor is considered a problem */
  threshold: number;
  /** Score below this is high severity, above is medium */
  highSeverityThreshold: number;
}

const FACTOR_TYPE_CONFIG: Record<string, FactorTypeConfig> = {
  nutritionAlignment: {
    issueType: 'nutrition_alignment',
    threshold: 50,
    highSeverityThreshold: 30,
  },
  macroBalance: {
    issueType: 'macro_balance',
    threshold: 50,
    highSeverityThreshold: 30,
  },
  healthConstraint: {
    issueType: 'health_constraint',
    threshold: 50,
    highSeverityThreshold: 30,
  },
  timeliness: {
    issueType: 'timeliness',
    threshold: 50,
    highSeverityThreshold: 30,
  },
};

/** CoachLocale → BCP-47 Locale（供 cl() 使用） */
const COACH_LOCALE_TO_BCP47: Record<CoachLocale, Locale> = {
  zh: 'zh-CN',
  en: 'en-US',
  ja: 'ja-JP',
};

/**
 * V3.3 Phase 3 — DecisionCoachService（迁移自 analyze/decision-coach.service.ts）
 *
 * 变更：
 * - 迁移至 decision/coach/ 独立目录
 * - 全面 i18n 化（zh / en / ja）
 * - 新增 structuredDecision 融合：当传入 StructuredDecision 时，
 *   用四维因素增强 issueExplanations，用 rationale 丰富 guidance
 */
@Injectable()
export class DecisionCoachService {
  constructor() {}

  /**
   * 生成完整教练说明
   *
   * @param analysis - Phase 1 输出的上下文分析
   * @param structuredDecision - V3.3 结构化决策（可选，用于增强教练内容）
   * @param userId - 用户 ID（预留个性化扩展）
   * @param locale - 语言偏好
   */
  generateCoachingExplanation(
    analysis: ContextualAnalysis,
    structuredDecision?: StructuredDecision,
    userId?: string,
    locale?: string,
    /** V4.0: 用户上下文，用于生成行为洞察和连续天数激励 */
    userContext?: UnifiedUserContext,
    /** V4.2 P3.1: 语气 key，来自 DecisionToneResolverService */
    toneKey?: 'control' | 'encourage' | 'neutral' | 'urgent' | 'affirm',
    /** V4.6: 冲突报告，用于生成健康风险教育内容 */
    conflictReport?: ConflictReport,
    /** V5.0 P3.5: 分析食物列表，用于 flavor/compatibility 教练丰富 */
    foods?: AnalyzedFoodItem[],
  ): CoachingExplanation {
    const lang = toCoachLocale(locale);
    const toneVariant = this.resolveToneVariant(toneKey);
    const headline = this.generateHeadline(
      analysis,
      lang,
      toneVariant,
      conflictReport,
    );
    const summary = this.generateSummary(analysis, lang);
    const issueExplanations = this.generateIssueExplanations(
      analysis,
      structuredDecision,
      lang,
    );
    const guidance = this.generateGuidance(
      analysis,
      structuredDecision,
      lang,
      toneVariant,
    );
    const educationPoints = this.generateEducationPoints(
      analysis,
      lang,
      conflictReport,
    );

    // V4.0: 行为洞察 + 连续天数激励
    const behaviorInsight = this.generateBehaviorInsight(userContext, lang);
    const streakContext = this.generateStreakContext(userContext, lang);

    // V4.1: 决策理由 + 置信度说明
    const decisionRationale = structuredDecision?.rationale
      ? {
          baseline: structuredDecision.rationale.baseline,
          contextual: structuredDecision.rationale.contextual,
          goalAlignment: structuredDecision.rationale.goalAlignment,
          healthRisk: structuredDecision.rationale.healthRisk ?? undefined,
          timelinessNote:
            structuredDecision.rationale.timelinessNote ?? undefined,
        }
      : undefined;

    const confidenceNote =
      structuredDecision && structuredDecision.finalScore < 40
        ? ci('modifier.lowConfidence', lang)
        : undefined;

    // V5.0 P3.1: conflict explanations from StructuredDecision low-score dimensions
    const conflictExplanations = this.buildConflictExplanations(
      structuredDecision,
      lang,
    );

    // V5.0 P3.5: flavor/compatibility enrichment from library-matched foods
    const flavorCompatibilityTips = this.buildFlavorCompatibilityTips(
      foods,
      lang,
    );

    return {
      headline,
      summary,
      issues: issueExplanations,
      guidance,
      educationPoints,
      behaviorInsight,
      streakContext,
      decisionRationale,
      confidenceNote,
      ...(conflictExplanations.length > 0 ? { conflictExplanations } : {}),
      ...(flavorCompatibilityTips ? { flavorCompatibilityTips } : {}),
    };
  }

  // ==================== 私有方法 ====================

  /**
   * V4.2 P3.1: 将 toneKey 映射为 i18n 后缀变体
   */
  private resolveToneVariant(
    toneKey?: string,
  ): 'strict' | 'encouraging' | undefined {
    if (toneKey === 'urgent' || toneKey === 'control') return 'strict';
    if (toneKey === 'encourage' || toneKey === 'affirm') return 'encouraging';
    return undefined;
  }

  private generateHeadline(
    analysis: ContextualAnalysis,
    lang: CoachLocale,
    toneVariant?: 'strict' | 'encouraging',
    conflictReport?: ConflictReport,
  ): string {
    // V4.6: 如果有 critical 健康冲突，优先使用健康风险标题
    if (conflictReport?.hasConflict) {
      const hasCritical = conflictReport.items.some(
        (c) => c.severity === 'critical' && c.type === 'health_condition',
      );
      if (hasCritical) return ci('headline.health_risk', lang);
    }

    if (!analysis.identifiedIssues || analysis.identifiedIssues.length === 0) {
      // V4.2: 语气变体
      if (toneVariant) {
        const variantKey = `headline.balanced.${toneVariant}` as Parameters<
          typeof ci
        >[0];
        const variantText = ci(variantKey, lang);
        if (variantText !== variantKey) return variantText;
      }
      return ci('headline.balanced', lang);
    }

    const highSeverityIssues = analysis.identifiedIssues.filter(
      (issue) => issue.severity === 'high',
    );

    if (highSeverityIssues.length === 0) {
      // V4.2: 语气变体
      if (toneVariant) {
        const variantKey = `headline.minor_adjust.${toneVariant}` as Parameters<
          typeof ci
        >[0];
        const variantText = ci(variantKey, lang);
        if (variantText !== variantKey) return variantText;
      }
      return ci('headline.minor_adjust', lang);
    }

    const mainIssue = highSeverityIssues[0];
    const key = `headline.${mainIssue.type}` as Parameters<typeof ci>[0];
    const text = ci(key, lang);
    // 若 key 不在字典中会返回 key 本身，此时回退到 generic
    return text === key ? ci('headline.generic', lang) : text;
  }

  private generateSummary(
    analysis: ContextualAnalysis,
    lang: CoachLocale,
  ): string {
    const slots = analysis?.macroSlotStatus;
    if (!slots) return ci('summary.no_slots', lang);

    return ci('summary.template', lang, {
      protein: slots.protein,
      carbs: slots.carbs,
      fat: slots.fat,
      issueCount: analysis.identifiedIssues?.length ?? 0,
    });
  }

  private generateIssueExplanations(
    analysis: ContextualAnalysis,
    structuredDecision: StructuredDecision | undefined,
    lang: CoachLocale,
  ): IssueExplanation[] {
    if (!analysis.identifiedIssues) return [];

    const base = analysis.identifiedIssues
      .sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.severity] - order[b.severity];
      })
      .map((issue) => ({
        type: issue.type,
        severity: issue.severity as 'high' | 'medium' | 'low',
        explanation: this.explainIssue(issue, lang),
        actionable: this.generateAction(issue, lang),
      }));

    // V3.3: 用 StructuredDecision 四维因素补充低分维度
    if (structuredDecision) {
      return this.enrichWithStructuredFactors(base, structuredDecision, lang);
    }

    return base;
  }

  private explainIssue(issue: NutritionIssue, lang: CoachLocale): string {
    const key = `explain.${issue.type}` as Parameters<typeof ci>[0];
    const text = ci(key, lang, {
      metric: issue.metric,
      threshold: issue.threshold,
    });
    if (text === key) {
      // fallback: 直接用 implication
      return issue.implication;
    }
    return text;
  }

  private generateAction(issue: NutritionIssue, lang: CoachLocale): string {
    const key = `action.${issue.type}` as Parameters<typeof ci>[0];
    const text = ci(key, lang);
    if (text === key) {
      return ci('action.generic', lang, { type: issue.type });
    }
    return text;
  }

  /**
   * V4.8 P3.1: Enrich issue explanations with StructuredDecision low-score factors
   * Uses FACTOR_TYPE_CONFIG for threshold/severity instead of hardcoded values
   */
  private enrichWithStructuredFactors(
    base: IssueExplanation[],
    sd: StructuredDecision,
    lang: CoachLocale,
  ): IssueExplanation[] {
    const existingTypes = new Set(base.map((b) => b.type));

    for (const [key, factor] of Object.entries(sd.factors)) {
      const config = FACTOR_TYPE_CONFIG[key];
      const syntheticType = config?.issueType || key;
      const threshold = config?.threshold ?? 50;
      const highThreshold = config?.highSeverityThreshold ?? 30;

      if (factor.score < threshold && !existingTypes.has(syntheticType)) {
        existingTypes.add(syntheticType);
        const label = cl(
          `factorLabel.${key}`,
          COACH_LOCALE_TO_BCP47[lang] as any,
        );
        base.push({
          type: syntheticType,
          severity: factor.score < highThreshold ? 'high' : 'medium',
          explanation: `${label}: ${factor.rationale}`,
          actionable:
            sd.rationale?.contextual || sd.rationale?.goalAlignment || '',
        });
      }
    }

    return base;
  }

  /**
   * V5.0 P3.1: Build conflict explanations from StructuredDecision low-score dimensions.
   * Threshold: score < 40 triggers a conflict explanation.
   */
  private buildConflictExplanations(
    sd: StructuredDecision | undefined,
    lang: CoachLocale,
  ): ConflictExplanation[] {
    if (!sd) return [];

    const CONFLICT_THRESHOLD = 40;
    const results: ConflictExplanation[] = [];
    const factorKeys = [
      'nutritionAlignment',
      'macroBalance',
      'healthConstraint',
      'timeliness',
    ] as const;

    for (const key of factorKeys) {
      const factor = sd.factors[key];
      if (factor.score < CONFLICT_THRESHOLD) {
        results.push({
          dimension: key,
          score: factor.score,
          severity: factor.score < 20 ? 'critical' : 'warning',
          explanation: ci(`conflict.${key}` as any, lang),
          rationale: factor.rationale,
        });
      }
    }

    return results;
  }

  /**
   * V5.0 P3.5: Build flavor/compatibility tips from library-matched foods.
   * - "similar flavor" tags for alternatives
   * - compatibility.good[] for pairing suggestions
   * - compatibility.avoid[] for conflict tips
   */
  private buildFlavorCompatibilityTips(
    foods: AnalyzedFoodItem[] | undefined,
    lang: CoachLocale,
  ): FlavorCompatibilityTips | undefined {
    if (!foods?.length) return undefined;

    const libraryFoods = foods.filter(
      (f) => f.foodLibraryId && (f.flavorProfile || f.compatibility),
    );
    if (!libraryFoods.length) return undefined;

    const flavorTags: string[] = [];
    const pairingSuggestions: string[] = [];
    const avoidTips: string[] = [];

    for (const food of libraryFoods) {
      if (food.flavorProfile) {
        flavorTags.push(food.flavorProfile);
      }
      if (food.compatibility) {
        const good =
          food.compatibility['good'] || food.compatibility['recommended'];
        if (good?.length) {
          pairingSuggestions.push(...good.slice(0, 3));
        }
        const avoid =
          food.compatibility['avoid'] || food.compatibility['conflict'];
        if (avoid?.length) {
          avoidTips.push(...avoid.slice(0, 3));
        }
      }
    }

    if (!flavorTags.length && !pairingSuggestions.length && !avoidTips.length) {
      return undefined;
    }

    return {
      flavorTags: [...new Set(flavorTags)],
      pairingSuggestions: [...new Set(pairingSuggestions)].slice(0, 5),
      avoidTips: [...new Set(avoidTips)].slice(0, 5),
    };
  }

  private generateGuidance(
    analysis: ContextualAnalysis,
    structuredDecision: StructuredDecision | undefined,
    lang: CoachLocale,
    toneVariant?: 'strict' | 'encouraging',
  ): string {
    let guidance = ci('guidance.base', lang);

    const slots = analysis?.macroSlotStatus;
    if (!slots) {
      return guidance + ci('guidance.close', lang);
    }

    if (slots.protein === 'deficit') guidance += ci('guidance.protein', lang);
    if (slots.carbs === 'excess') guidance += ci('guidance.carbs', lang);
    if (slots.fat === 'excess') guidance += ci('guidance.fat', lang);

    // V3.3: 附加 StructuredDecision rationale 的时机建议
    if (structuredDecision?.rationale?.timelinessNote) {
      guidance += ' ' + structuredDecision.rationale.timelinessNote;
    }

    // V4.2: 语气变体 close
    if (toneVariant) {
      const variantKey = `guidance.close.${toneVariant}` as Parameters<
        typeof ci
      >[0];
      const variantText = ci(variantKey, lang);
      if (variantText !== variantKey) {
        guidance += variantText;
        return guidance;
      }
    }

    guidance += ci('guidance.close', lang);
    return guidance;
  }

  private generateEducationPoints(
    analysis: ContextualAnalysis,
    lang: CoachLocale,
    conflictReport?: ConflictReport,
  ): EducationPoint[] {
    const points: EducationPoint[] = [];
    const addedTopics = new Set<string>();

    // V4.6: Health condition education from ConflictReport
    if (conflictReport?.hasConflict) {
      const CONDITION_EDU_MAP: Record<string, string> = {
        gout: 'gout',
        ibs: 'ibs',
        kidney_stone: 'kidneyStone',
        kidney_disease: 'kidneyStone',
        hyperlipidemia: 'cholesterol',
        cardiovascular: 'cholesterol',
      };
      for (const item of conflictReport.items) {
        if (item.type !== 'health_condition') continue;
        const condition = (item.data?.condition as string) ?? '';
        const eduKey = CONDITION_EDU_MAP[condition];
        if (eduKey && !addedTopics.has(eduKey)) {
          addedTopics.add(eduKey);
          points.push({
            topic: ci(`edu.${eduKey}.topic` as any, lang),
            why: ci(`edu.${eduKey}.why` as any, lang),
            howToFix: ci(`edu.${eduKey}.fix` as any, lang),
          });
        }
      }
      const TAG_EDU_MAP: Record<string, string> = {
        trans_fat_risk: 'transFat',
        cholesterol_risk: 'cholesterol',
        glycemic_risk: 'glycemicLoad',
      };
      for (const item of conflictReport.items) {
        const tag = (item.data?.riskTag as string) ?? '';
        const eduKey = TAG_EDU_MAP[tag];
        if (eduKey && !addedTopics.has(eduKey)) {
          addedTopics.add(eduKey);
          points.push({
            topic: ci(`edu.${eduKey}.topic` as any, lang),
            why: ci(`edu.${eduKey}.why` as any, lang),
            howToFix: ci(`edu.${eduKey}.fix` as any, lang),
          });
        }
      }
    }

    // V5.0 P3.3: Dynamic education based on DietIssue.category via NutritionIssue.type
    // Maps issue types to coach.edu.{category}.* keys in labels-*.ts
    if (analysis.identifiedIssues?.length) {
      // Sort by severity (high first) and take distinct categories
      const sorted = [...analysis.identifiedIssues].sort((a, b) => {
        const order = { high: 0, medium: 1, low: 2 };
        return order[a.severity] - order[b.severity];
      });

      for (const issue of sorted) {
        const category = issue.type;
        if (addedTopics.has(category)) continue;

        // Try dynamic key; if topic resolves to itself it means no entry exists
        const topicKey = `edu.${category}.topic` as Parameters<typeof ci>[0];
        const topicText = ci(topicKey, lang);
        if (topicText === topicKey) {
          // No dynamic education entry for this category — try legacy static keys
          const LEGACY_MAP: Record<string, string> = {
            protein_deficit: 'protein',
            fiber_deficit: 'fiber',
            sugar_excess: 'sugar',
          };
          const legacyKey = LEGACY_MAP[category];
          if (legacyKey && !addedTopics.has(legacyKey)) {
            addedTopics.add(legacyKey);
            addedTopics.add(category);
            points.push({
              topic: ci(`edu.${legacyKey}.topic` as any, lang),
              why: ci(`edu.${legacyKey}.why` as any, lang),
              howToFix: ci(`edu.${legacyKey}.fix` as any, lang),
            });
          }
          continue;
        }

        addedTopics.add(category);
        const whyText = ci(`edu.${category}.why` as any, lang);
        let fixText = ci(`edu.${category}.fix` as any, lang);

        // Include .deep content for high-severity issues
        if (issue.severity === 'high') {
          const deepKey = `edu.${category}.deep` as Parameters<typeof ci>[0];
          const deepText = ci(deepKey, lang);
          if (deepText !== deepKey) {
            fixText += ' ' + deepText;
          }
        }

        points.push({
          topic: topicText,
          why: whyText,
          howToFix: fixText,
        });
      }
    }

    // Fallback: balanced education if no issues found
    if (!points.length) {
      points.push({
        topic: ci('edu.balanced.topic', lang),
        why: ci('edu.balanced.why', lang),
        howToFix: ci('edu.balanced.fix', lang),
      });
    }

    return points;
  }

  /**
   * V4.0 P3.1: 基于7天短期画像生成行为洞察
   */
  private generateBehaviorInsight(
    userContext?: UnifiedUserContext,
    lang?: CoachLocale,
  ): string | undefined {
    const stb = userContext?.shortTermBehavior;
    if (!stb) return undefined;

    const locale = lang ? COACH_LOCALE_TO_BCP47[lang] : undefined;
    const parts: string[] = [];

    if (stb.intakeTrends === 'increasing') {
      parts.push(cl('summary.trendIncreasing', locale));
    } else if (stb.intakeTrends === 'decreasing') {
      parts.push(cl('summary.trendDecreasing', locale));
    }

    const gp = userContext?.goalProgress;
    if (gp?.executionRate != null) {
      parts.push(
        cl('summary.executionNote', locale, { rate: Math.round(gp.executionRate * 100) }),
      );
    }

    return parts.length > 0
      ? parts.join(cl('summary.noteSep', locale))
      : undefined;
  }

  /**
   * V4.0 P3.1: 连续天数激励/提醒
   */
  private generateStreakContext(
    userContext?: UnifiedUserContext,
    lang?: CoachLocale,
  ): string | undefined {
    const gp = userContext?.goalProgress;
    if (!gp?.streakDays || gp.streakDays < 2) return undefined;

    const locale = lang ? COACH_LOCALE_TO_BCP47[lang] : undefined;
    return cl('summary.streakNote', locale, { days: gp.streakDays });
  }
}

// ==================== 输出类型 ====================

/** 教练说明完整输出 */
export interface CoachingExplanation {
  headline: string;
  summary: string;
  issues: IssueExplanation[];
  guidance: string;
  educationPoints: EducationPoint[];
  /** V4.0: 行为洞察 */
  behaviorInsight?: string;
  /** V4.0: 连续天数激励 */
  streakContext?: string;
  /** V4.1: 决策理由摘要（来自 StructuredDecision.rationale） */
  decisionRationale?: {
    baseline?: string;
    contextual?: string;
    goalAlignment?: string;
    healthRisk?: string;
    timelinessNote?: string;
  };
  /** V4.1: 置信度/准确度说明 */
  confidenceNote?: string;
  /** V4.5 P3.1: 三段式行动计划 */
  actionPlan?: ActionPlan;
  /** V5.0 P3.1: 冲突解释（StructuredDecision 低分维度） */
  conflictExplanations?: ConflictExplanation[];
  /** V5.0 P3.5: 风味/搭配提示（来自食物库匹配） */
  flavorCompatibilityTips?: FlavorCompatibilityTips;
}

/**
 * V4.5 P3.1: 三段式行动计划
 *
 * 结构：立即行动 → 下一餐重点 → 长期习惯
 * 每段为一句话可执行建议，通过 coach-insight.service 生成。
 */
export interface ActionPlan {
  /** 当前这餐 / 今天立即可做的事 */
  immediate: string;
  /** 下一餐的营养重点 */
  nextMeal: string;
  /** 长期饮食习惯建议 */
  longTerm: string;
}

/** 单个问题说明 */
export interface IssueExplanation {
  type: string;
  severity: 'high' | 'medium' | 'low';
  explanation: string;
  actionable: string;
}

/** 教育内容点 */
export interface EducationPoint {
  topic: string;
  why: string;
  howToFix: string;
}

/**
 * V5.0 P3.1: 冲突解释
 * When a StructuredDecision dimension scores below threshold (40),
 * explain the conflict to the user.
 */
export interface ConflictExplanation {
  /** Which of the 4 decision dimensions */
  dimension:
    | 'nutritionAlignment'
    | 'macroBalance'
    | 'healthConstraint'
    | 'timeliness';
  /** The dimension score (0-100) */
  score: number;
  /** Severity derived from score */
  severity: 'warning' | 'critical';
  /** Localized explanation of the conflict */
  explanation: string;
  /** Raw rationale from the decision factor */
  rationale: string;
}

/**
 * V5.0 P3.5: Flavor & compatibility tips from food library.
 * Provides coaching enrichment when analyzed foods have library matches
 * with flavorProfile and compatibility data.
 */
export interface FlavorCompatibilityTips {
  /** Distinct flavor profiles of the analyzed foods (e.g. "savory", "spicy") */
  flavorTags: string[];
  /** Good pairings from compatibility.good[] (food names) */
  pairingSuggestions: string[];
  /** Foods to avoid combining from compatibility.avoid[] */
  avoidTips: string[];
}
