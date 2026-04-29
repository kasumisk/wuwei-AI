/**
 * AnalyzeResultHelperService
 *
 * Phase 7: 从 FoodAnalyzeController 提取的共享逻辑，供 4 个子控制器复用：
 * - localizeAnalysisResult   — 食物名/份量本地化 + headline 重建
 * - buildLocalizedHeadline   — 决策结果标题国际化
 * - reconstructAnalysisResult — 从 DB JSONB 重建 FoodAnalysisResultV61
 * - mapRecommendationToDecision / mapRiskLevel — 枚举映射
 * - 文本分析内存缓存（buildTextAnalysisCacheKey / get / set）
 */

import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import { I18nService } from '../../../../core/i18n';
import { FoodI18nService } from '../../../diet/app/services/food-i18n.service';
import { DecisionSummaryService } from '../../../decision/decision/decision-summary.service';
import { FoodAnalysisResultV61 } from '../../../decision/types/analysis-result.types';
import { DecisionOutput } from '../../../decision/decision/food-decision.service';
import { cl } from '../../../decision/i18n/decision-labels';

// ─── 文本分析缓存配置 ───
const TEXT_ANALYSIS_CACHE_TTL_MS = 10 * 60 * 1000; // 10 分钟
const TEXT_ANALYSIS_CACHE_MAX_SIZE = 200;

interface TextAnalysisCacheEntry {
  result: FoodAnalysisResultV61;
  createdAt: number;
}

@Injectable()
export class AnalyzeResultHelperService {
  private readonly textAnalysisCache = new Map<
    string,
    TextAnalysisCacheEntry
  >();

  constructor(
    private readonly i18n: I18nService,
    private readonly foodI18nService: FoodI18nService,
    private readonly decisionSummaryService: DecisionSummaryService,
  ) {}

  // ─── 本地化 ───

  async localizeAnalysisResult(
    result: Partial<FoodAnalysisResultV61>,
    locale: string,
  ): Promise<void> {
    const foods = result.foods;
    if (foods?.length) {
      const ids = foods
        .filter((food) => !!food.foodLibraryId)
        .map((food) => food.foodLibraryId as string);
      const localizedDetails = await this.foodI18nService.loadLocalizedDetails(
        ids,
        locale,
      );
      const translatedById = await this.foodI18nService.loadTranslations(
        ids,
        locale,
      );
      const unresolvedNames = foods
        .filter(
          (food) =>
            !food.foodLibraryId || !translatedById.get(food.foodLibraryId),
        )
        .map((food) => food.name)
        .filter(Boolean);
      const translatedByName =
        await this.foodI18nService.loadTranslationsByFoodNames(
          unresolvedNames,
          locale,
        );
      for (const food of foods) {
        const localizedDetail = food.foodLibraryId
          ? localizedDetails.get(food.foodLibraryId)
          : undefined;
        const originalServingDesc = food.standardServingDesc;
        const localizedName =
          (food.foodLibraryId
            ? translatedById.get(food.foodLibraryId)
            : undefined) ?? translatedByName.get(food.name);
        if (localizedName) {
          food.name = localizedName;
        }
        if (localizedDetail?.servingDesc) {
          food.standardServingDesc = localizedDetail.servingDesc;
          if (
            food.quantity &&
            originalServingDesc &&
            food.quantity === originalServingDesc
          ) {
            food.quantity = localizedDetail.servingDesc;
          }
        }
      }
    }

    const primaryFoodName = result.foods?.[0]?.name;
    const totalCalories = result.totals?.calories;

    if (result.summary && primaryFoodName && totalCalories != null) {
      result.summary.headline = this.buildLocalizedHeadline(
        result.decision?.recommendation,
        result.decision?.reason,
        primaryFoodName,
        totalCalories,
        locale,
      );
    }

    if (result.explanation && primaryFoodName && totalCalories != null) {
      result.explanation.summary = this.buildLocalizedHeadline(
        result.decision?.recommendation,
        result.decision?.reason,
        primaryFoodName,
        totalCalories,
        locale,
      );
    }

    if (result.summary && result.unifiedUserContext) {
      try {
        const rebuiltSummary = this.decisionSummaryService.summarize({
          decisionOutput: {
            decision: result.decision!,
            alternatives: result.alternatives ?? [],
            explanation: result.explanation!,
            decisionFactors: result.decision?.decisionFactors ?? [],
            optimalPortion: result.decision?.optimalPortion,
            nextMealAdvice: result.decision?.nextMealAdvice,
            decisionChain: result.decision?.decisionChain,
            breakdownExplanations: result.decision?.breakdownExplanations,
            issues: result.decision?.issues,
            mode: result.shouldEatAction?.mode,
          } as DecisionOutput,
          totals: result.totals!,
          userContext: result.unifiedUserContext,
          foodNames: result.foods?.map((food) => food.name) ?? [],
          structuredDecision: result.structuredDecision,
          nutritionIssues: result.contextualAnalysis?.identifiedIssues,
          decisionMode: result.shouldEatAction?.mode,
          locale: locale as Locale,
        });
        result.summary = {
          ...result.summary,
          ...rebuiltSummary,
          headline: result.summary.headline,
        };
      } catch {
        // Keep persisted summary when structured rebuild is unavailable.
      }
    }
  }

  buildLocalizedHeadline(
    recommendation: string | undefined,
    reason: string | undefined,
    foodName: string,
    calories: number,
    locale: string,
  ): string {
    const cal = `${Math.round(calories)}kcal`;
    switch (recommendation) {
      case 'recommend':
        return cl('summary.recommend.ok', locale as Locale, {
          food: foodName,
          cal,
        });
      case 'avoid':
        return cl('summary.avoid.generic', locale as Locale, {
          food: foodName,
          cal,
        });
      case 'caution':
      default:
        return cl('summary.caution.reason', locale as Locale, {
          food: foodName,
          cal,
          reason: reason || this.i18n.t('food.betterForCurrentGoal'),
        });
    }
  }

  // ─── DB 重建 ───

  reconstructAnalysisResult(
    record: any,
  ): Partial<FoodAnalysisResultV61> {
    const nutrition = record.nutritionPayload as Record<string, unknown> | null;
    const decision = record.decisionPayload as Record<string, unknown> | null;
    const recognized = record.recognizedPayload as Record<
      string,
      unknown
    > | null;

    let foods = (recognized?.foods ??
      (nutrition as any)?.foods ??
      []) as FoodAnalysisResultV61['foods'];

    if (
      (!foods || foods.length === 0) &&
      Array.isArray((recognized as any)?.terms) &&
      (recognized as any).terms.length > 0
    ) {
      const terms = (recognized as any).terms as Array<{
        name: string;
        quantity?: string;
        fromLibrary?: boolean;
      }>;
      const totals = (nutrition?.totals ?? {}) as {
        calories?: number;
        protein?: number;
        fat?: number;
        carbs?: number;
      };
      const count = terms.length;
      foods = terms.map((t) => ({
        name: t.name,
        quantity: t.quantity,
        category: 'unknown',
        calories: count > 0 ? Math.round((totals.calories ?? 0) / count) : 0,
        protein: count > 0 ? Math.round((totals.protein ?? 0) / count) : 0,
        fat: count > 0 ? Math.round((totals.fat ?? 0) / count) : 0,
        carbs: count > 0 ? Math.round((totals.carbs ?? 0) / count) : 0,
        confidence: 0.5,
      })) as FoodAnalysisResultV61['foods'];
    }

    return {
      foods,
      totals: (nutrition?.totals ?? {
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
      }) as FoodAnalysisResultV61['totals'],
      score: (nutrition?.score ?? {
        healthScore: 0,
        nutritionScore: 0,
        confidenceScore: 0,
      }) as FoodAnalysisResultV61['score'],
      decision: (decision?.decision ?? {
        recommendation: 'caution' as const,
        shouldEat: true,
        reason: '',
        riskLevel: 'low' as const,
      }) as FoodAnalysisResultV61['decision'],
      alternatives: (decision?.alternatives ??
        []) as FoodAnalysisResultV61['alternatives'],
      explanation: (decision?.explanation ?? {
        summary: '',
      }) as FoodAnalysisResultV61['explanation'],
      summary: (decision?.summary ??
        undefined) as FoodAnalysisResultV61['summary'],
      evidencePack: (decision?.evidencePack ??
        undefined) as FoodAnalysisResultV61['evidencePack'],
      shouldEatAction: (decision?.shouldEatAction ??
        undefined) as FoodAnalysisResultV61['shouldEatAction'],
      foodAnalysisPackage: (decision?.foodAnalysisPackage ??
        undefined) as FoodAnalysisResultV61['foodAnalysisPackage'],
      structuredDecision: (decision?.structuredDecision ??
        undefined) as FoodAnalysisResultV61['structuredDecision'],
      contextualAnalysis: (decision?.contextualAnalysis ??
        undefined) as FoodAnalysisResultV61['contextualAnalysis'],
      unifiedUserContext: (decision?.unifiedUserContext ??
        undefined) as FoodAnalysisResultV61['unifiedUserContext'],
      coachActionPlan: (decision?.coachActionPlan ??
        undefined) as FoodAnalysisResultV61['coachActionPlan'],
      analysisState: (nutrition?.analysisState ??
        undefined) as FoodAnalysisResultV61['analysisState'],
      confidenceDiagnostics: (nutrition?.confidenceDiagnostics ??
        undefined) as FoodAnalysisResultV61['confidenceDiagnostics'],
    };
  }

  // ─── 枚举映射 ───

  mapRecommendationToDecision(recommendation?: string): string {
    switch (recommendation) {
      case 'recommend':
        return 'SAFE';
      case 'caution':
        return 'LIMIT';
      case 'avoid':
        return 'AVOID';
      default:
        return 'OK';
    }
  }

  mapRiskLevel(riskLevel?: string): string {
    switch (riskLevel) {
      case 'low':
        return '🟢';
      case 'medium':
        return '🟡';
      case 'high':
        return '🔴';
      default:
        return '🟢';
    }
  }

  // ─── 文本分析缓存 ───

  buildTextAnalysisCacheKey(
    text: string,
    mealType: string | undefined,
    userId: string,
    locale?: string,
  ): string {
    const raw = `${userId}:${mealType || 'none'}:${locale || 'default'}:${text.trim().toLowerCase()}`;
    return createHash('sha256').update(raw).digest('hex').slice(0, 24);
  }

  getFromTextAnalysisCache(key: string): FoodAnalysisResultV61 | null {
    const entry = this.textAnalysisCache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > TEXT_ANALYSIS_CACHE_TTL_MS) {
      this.textAnalysisCache.delete(key);
      return null;
    }
    return entry.result;
  }

  setToTextAnalysisCache(key: string, result: FoodAnalysisResultV61): void {
    if (this.textAnalysisCache.size >= TEXT_ANALYSIS_CACHE_MAX_SIZE) {
      const entries = Array.from(this.textAnalysisCache.entries()).sort(
        (a, b) => a[1].createdAt - b[1].createdAt,
      );
      const deleteCount = Math.floor(TEXT_ANALYSIS_CACHE_MAX_SIZE / 2);
      for (let i = 0; i < deleteCount; i++) {
        this.textAnalysisCache.delete(entries[i][0]);
      }
    }
    this.textAnalysisCache.set(key, { result, createdAt: Date.now() });
  }
}
