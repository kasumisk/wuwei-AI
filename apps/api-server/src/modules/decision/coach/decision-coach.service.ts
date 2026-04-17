import { Injectable } from '@nestjs/common';
import {
  ContextualAnalysis,
  NutritionIssue,
  StructuredDecision,
} from '../types/analysis-result.types';
import { ci, toCoachLocale, CoachLocale } from './coach-i18n';
import { cl } from '../i18n/decision-labels';

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
  ): CoachingExplanation {
    const lang = toCoachLocale(locale);
    const headline = this.generateHeadline(analysis, lang);
    const summary = this.generateSummary(analysis, lang);
    const issueExplanations = this.generateIssueExplanations(
      analysis,
      structuredDecision,
      lang,
    );
    const guidance = this.generateGuidance(analysis, structuredDecision, lang);
    const educationPoints = this.generateEducationPoints(analysis, lang);

    return {
      headline,
      summary,
      issues: issueExplanations,
      guidance,
      educationPoints,
    };
  }

  // ==================== 私有方法 ====================

  private generateHeadline(
    analysis: ContextualAnalysis,
    lang: CoachLocale,
  ): string {
    if (!analysis.identifiedIssues || analysis.identifiedIssues.length === 0) {
      return ci('headline.balanced', lang);
    }

    const highSeverityIssues = analysis.identifiedIssues.filter(
      (issue) => issue.severity === 'high',
    );

    if (highSeverityIssues.length === 0) {
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
   * V3.3: 用 StructuredDecision.factors 中低分维度补充 IssueExplanation
   * 只补充 NutritionIssue 未覆盖的维度
   */
  private enrichWithStructuredFactors(
    base: IssueExplanation[],
    sd: StructuredDecision,
    lang: CoachLocale,
  ): IssueExplanation[] {
    const FACTOR_TO_TYPE: Record<string, string> = {
      nutritionAlignment: 'nutrition_alignment',
      macroBalance: 'macro_balance',
      healthConstraint: 'health_constraint',
      timeliness: 'timeliness',
    };

    const LOCALE_MAP: Record<CoachLocale, string> = {
      zh: 'zh-CN',
      en: 'en-US',
      ja: 'ja-JP',
    };

    const existingTypes = new Set(base.map((b) => b.type));

    for (const [key, factor] of Object.entries(sd.factors)) {
      if (factor.score < 50) {
        const syntheticType = FACTOR_TO_TYPE[key] || key;
        if (!existingTypes.has(syntheticType)) {
          existingTypes.add(syntheticType);
          const label = cl(`factorLabel.${key}`, LOCALE_MAP[lang] as any);
          base.push({
            type: syntheticType,
            severity: factor.score < 30 ? 'high' : 'medium',
            explanation: `${label}: ${factor.rationale}`,
            actionable:
              sd.rationale?.contextual || sd.rationale?.goalAlignment || '',
          });
        }
      }
    }

    return base;
  }

  private generateGuidance(
    analysis: ContextualAnalysis,
    structuredDecision: StructuredDecision | undefined,
    lang: CoachLocale,
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

    guidance += ci('guidance.close', lang);
    return guidance;
  }

  private generateEducationPoints(
    analysis: ContextualAnalysis,
    lang: CoachLocale,
  ): EducationPoint[] {
    const points: EducationPoint[] = [];

    if (analysis.identifiedIssues?.some((i) => i.type === 'protein_deficit')) {
      points.push({
        topic: ci('edu.protein.topic', lang),
        why: ci('edu.protein.why', lang),
        howToFix: ci('edu.protein.fix', lang),
      });
    }

    if (analysis.identifiedIssues?.some((i) => i.type === 'fiber_deficit')) {
      points.push({
        topic: ci('edu.fiber.topic', lang),
        why: ci('edu.fiber.why', lang),
        howToFix: ci('edu.fiber.fix', lang),
      });
    }

    if (analysis.identifiedIssues?.some((i) => i.type === 'sugar_excess')) {
      points.push({
        topic: ci('edu.sugar.topic', lang),
        why: ci('edu.sugar.why', lang),
        howToFix: ci('edu.sugar.fix', lang),
      });
    }

    if (!points.length) {
      points.push({
        topic: ci('edu.balanced.topic', lang),
        why: ci('edu.balanced.why', lang),
        howToFix: ci('edu.balanced.fix', lang),
      });
    }

    return points;
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
