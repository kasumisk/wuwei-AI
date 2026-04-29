/**
 * V61 ↔ Legacy AnalysisResult 互转
 *
 * 主链路在 V5+ 已统一用 FoodAnalysisResultV61，但 AnalyzeService.processAnalysis
 * 仍把 legacy AnalysisResult 写入 cache 供老订阅消费。本适配器是唯一互转入口。
 *
 * - toLegacyResult(v61): 给 cache / 旧订阅
 * - legacyFoodsToAnalyzed(legacy): 给 persistAnalysisRecord 反向重建 V61
 *
 * 不做枚举互转 → 委托给 decision.mapper.ts。
 * 不做 i18n 字符串拼装 → 由调用方注入翻译文案。
 */
import { Injectable } from '@nestjs/common';
import { I18nService } from '../../../../../../core/i18n';
import {
  AnalyzedFoodItem,
  FoodAnalysisResultV61,
} from '../../../../../decision/types/analysis-result.types';
import { AnalysisResult } from '../../analyze.service';
import {
  legacyToRecommendation,
  emojiToRiskLevel,
  recommendationToLegacy,
  riskLevelToEmoji,
} from '../decision.mapper';

@Injectable()
export class LegacyResultAdapter {
  constructor(private readonly i18n: I18nService) {}

  /**
   * V61 → legacy（用于 cache + 旧订阅）
   */
  toLegacyResult(result: FoodAnalysisResultV61): AnalysisResult {
    const foods = result.foods.map((food) => ({
      name: food.name,
      calories: food.calories,
      quantity: food.quantity,
      category: food.category,
      protein: food.protein,
      fat: food.fat,
      carbs: food.carbs,
      quality: food.qualityScore,
      satiety: food.satietyScore,
      fiber: food.fiber,
      sodium: food.sodium,
      saturatedFat: food.saturatedFat,
      addedSugar: food.addedSugar,
      vitaminA: food.vitaminA,
      vitaminC: food.vitaminC,
      calcium: food.calcium,
      iron: food.iron,
      estimated: food.estimated,
      confidence: food.confidence,
    }));

    const avg = (key: 'quality' | 'satiety') =>
      foods.length === 0
        ? 0
        : foods.map((f) => f[key] ?? 0).reduce((s, v) => s + v, 0) /
          foods.length;

    return {
      foods,
      totalCalories: result.totals.calories,
      totalProtein: result.totals.protein,
      totalFat: result.totals.fat,
      totalCarbs: result.totals.carbs,
      avgQuality: avg('quality'),
      avgSatiety: avg('satiety'),
      mealType: result.inputSnapshot.mealType || 'lunch',
      advice: result.explanation.summary,
      isHealthy: result.decision.shouldEat,
      imageUrl: result.inputSnapshot.imageUrl,
      decision: recommendationToLegacy(result.decision.recommendation),
      riskLevel: riskLevelToEmoji(result.decision.riskLevel),
      reason: result.decision.reason,
      suggestion: result.explanation.primaryReason || '',
      insteadOptions: result.alternatives.map((item) => item.name),
      compensation: {},
      contextComment: result.summary?.dynamicDecisionHint || '',
      encouragement: result.summary?.behaviorNote || '',
      nutritionScore: result.score.nutritionScore,
      scoreBreakdown: result.score.breakdown,
      highlights: result.summary?.topStrengths,
    };
  }

  /**
   * legacy.foods → AnalyzedFoodItem[]（给 persistAnalysisRecord 用）
   */
  legacyFoodsToAnalyzed(legacy: AnalysisResult): AnalyzedFoodItem[] {
    return legacy.foods.map((f: any) => ({
      name: f.name,
      quantity: f.quantity,
      estimatedWeightGrams: f.estimatedWeightGrams,
      category: f.category,
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.6,
      calories: f.calories || 0,
      protein: f.protein || 0,
      fat: f.fat || 0,
      carbs: f.carbs || 0,
      fiber: f.fiber,
      sodium: f.sodium,
      sugar: f.sugar,
      saturatedFat: f.saturatedFat,
      addedSugar: f.addedSugar,
      vitaminA: f.vitaminA,
      vitaminC: f.vitaminC,
      calcium: f.calcium,
      iron: f.iron,
      estimated: f.estimated,
      allergens:
        Array.isArray(f.allergens) && f.allergens.length
          ? f.allergens
          : undefined,
      tags: Array.isArray(f.tags) && f.tags.length ? f.tags : undefined,
      glycemicIndex: f.glycemicIndex,
      qualityScore: f.qualityScore ?? undefined,
      satietyScore: f.satietyScore ?? undefined,
      processingLevel: f.processingLevel,
      nameEn: f.nameEn,
      standardServingDesc: f.standardServingDesc,
      transFat: f.transFat,
      cholesterol: f.cholesterol,
      omega3: f.omega3,
      omega6: f.omega6,
      solubleFiber: f.solubleFiber,
      vitaminD: f.vitaminD,
      potassium: f.potassium,
      zinc: f.zinc,
      glycemicLoad: f.glycemicLoad,
      nutrientDensity: f.nutrientDensity,
      fodmapLevel: f.fodmapLevel,
      oxalateLevel: f.oxalateLevel,
      purine: f.purine,
      cookingMethods: Array.isArray(f.cookingMethods)
        ? f.cookingMethods
        : undefined,
      ingredientList: Array.isArray(f.ingredientList)
        ? f.ingredientList
        : undefined,
    }));
  }

  /**
   * legacy → V61 反向重建（仅用于 persistAnalysisRecord 持久化场景）
   */
  reconstructV61(
    legacy: AnalysisResult,
    analysisId: string,
    imageUrl: string,
    mealType?: string,
  ): FoodAnalysisResultV61 {
    const foods = this.legacyFoodsToAnalyzed(legacy);
    const avgConfidence =
      foods.length > 0
        ? foods.reduce((s, f) => s + f.confidence, 0) / foods.length
        : 0.5;

    return {
      analysisId,
      inputType: 'image',
      inputSnapshot: { imageUrl, mealType: mealType as any },
      foods,
      totals: {
        calories: legacy.totalCalories,
        protein: legacy.totalProtein,
        fat: legacy.totalFat,
        carbs: legacy.totalCarbs,
      },
      score: {
        healthScore: legacy.nutritionScore || 50,
        nutritionScore: legacy.nutritionScore || 50,
        confidenceScore: Math.round(avgConfidence * 100),
      },
      decision: {
        recommendation: legacyToRecommendation(legacy.decision),
        shouldEat: legacy.decision !== 'AVOID',
        reason: legacy.reason || legacy.advice,
        riskLevel: emojiToRiskLevel(legacy.riskLevel),
      },
      alternatives: (legacy.insteadOptions || []).map((name) => ({
        name,
        reason: this.i18n.t('food.betterForCurrentGoal'),
      })),
      explanation: {
        summary: legacy.advice || legacy.contextComment || '',
      },
      ingestion: {
        matchedExistingFoods: false,
        shouldPersistCandidate: avgConfidence >= 0.5 && foods.length > 0,
        reviewRequired: avgConfidence < 0.7,
      },
      entitlement: { tier: 'free' as any, fieldsHidden: [] },
    };
  }
}
