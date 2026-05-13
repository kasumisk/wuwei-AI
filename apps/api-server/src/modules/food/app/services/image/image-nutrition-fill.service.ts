/**
 * ImageNutritionFillService
 *
 * Phase 2 nutrition fill for foods NOT matched in the food library.
 *
 * After Phase 1 Vision identifies foods (name/quantity/weight/category/confidence)
 * and the library matcher fills nutrition for DB hits, this service fills the gaps for
 * unmatched foods using a cheap text AI runtime (no image, no vision cost).
 *
 * Text models are ~10x cheaper and ~5x faster than vision models for this task,
 * making the two-phase approach significantly faster for multi-food images.
 *
 * Token estimate: ~100 tokens/food (request) + ~200 tokens/food (response) = ~300 tokens/food
 * vs Vision full schema: ~400 tokens/food (response alone).
 */
import { Injectable, Logger } from '@nestjs/common';
import { AnalyzedFoodItem } from '../../../../decision/types/analysis-result.types';
import { AiRuntimeService } from '../../../../../core/ai-runtime/ai-runtime.service';
import { AiRuntimeFeature } from '../../../../../core/ai-runtime/ai-runtime.types';
import { I18nService, I18nLocale } from '../../../../../core/i18n';
import type { Locale } from '../../../../diet/app/recommendation/utils/i18n-messages';
import { RegionAiModelRoutingService } from '../../../../../core/region';

const TEXT_MAX_TOKENS = 5000; // each food item ~300 tokens; 10 items = 3000
const TEXT_TEMPERATURE = 0.2;
// nutrition fill 属于图片链路，超时放宽到 30s，与 AiRuntimeService 默认值一致
const TEXT_TIMEOUT_MS = 30_000;

// Nutrition fill schema is now stored in i18n files under:
//   decision.prompt.nutritionFill.system  (system prompt with schema)
//   decision.prompt.nutritionFill.user    (user message prefix)
// This enables multilingual support for zh-CN / en-US / ja-JP.

@Injectable()
export class ImageNutritionFillService {
  private readonly logger = new Logger(ImageNutritionFillService.name);

  constructor(
    private readonly aiRuntime: AiRuntimeService,
    private readonly i18n: I18nService,
    private readonly aiModelRouting: RegionAiModelRoutingService,
  ) {}

  /**
   * Fill nutrition for all foods that don't have a foodLibraryId (library miss).
   * Foods with foodLibraryId already have nutrition from the DB — skip them.
   * Condiments/spices with tiny estimated weight are skipped (negligible nutrition).
   */
  async fillMissing(
    foods: AnalyzedFoodItem[],
    userId: string,
    locale?: Locale,
  ): Promise<void> {
    const unmatched = foods.filter(
      (f) => !f.foodLibraryId && !this.isNegligible(f),
    );
    // Apply default zero-ish nutrition for negligible condiments
    foods
      .filter((f) => !f.foodLibraryId && this.isNegligible(f))
      .forEach((f) => this.applyCondimentDefaults(f));

    if (unmatched.length === 0) return;

    try {
      const filled = await this.callTextAiRuntime(unmatched, userId, locale);
      this.applyFillResults(unmatched, filled);
    } catch (err) {
      // Non-fatal: unmatched foods will have minimal nutrition data from Phase 1
      this.logger.warn(
        `nutritionFill failed (${(err as Error).message}), using Phase 1 estimates`,
      );
    }
  }

  private async callTextAiRuntime(
    foods: AnalyzedFoodItem[],
    userId: string,
    locale?: Locale,
  ): Promise<Record<string, any>[]> {
    const loc = (locale ?? this.i18n.currentLocale()) as I18nLocale;
    const foodList = foods.map((f) => ({
      name: f.name,
      category: f.category,
    }));

    const systemPrompt = this.i18n.t(
      'decision.prompt.nutritionFill.system',
      loc,
    );
    const userPrefix = this.i18n.t('decision.prompt.nutritionFill.user', loc);
    const userMessage = `${userPrefix}\n${JSON.stringify(foodList, null, 2)}`;
    const route = await this.aiModelRouting.resolveFoodTextAnalysis({ locale });

    if (!route.apiKey) {
      throw new Error(
        `AI runtime API not configured for provider=${route.provider}, region=${route.region}`,
      );
    }

    const result = await this.aiRuntime.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      // FoodImage 熔断器：与文本分析 (FoodText) 隔离，避免图片链路超时污染文本链路
      feature: AiRuntimeFeature.FoodImage,
      provider: route.provider,
      model: route.model,
      apiKey: route.apiKey,
      baseUrl: route.baseUrl,
      maxTokens: TEXT_MAX_TOKENS,
      temperature: TEXT_TEMPERATURE,
      timeoutMs: TEXT_TIMEOUT_MS,
    });

    const raw = result.content.trim();
    const jsonStr = raw.startsWith('```')
      ? raw
          .replace(/```(?:json)?\n?/g, '')
          .replace(/```$/g, '')
          .trim()
      : raw;

    const parsed = JSON.parse(jsonStr);
    return Array.isArray(parsed.foods) ? parsed.foods : [];
  }

  private applyFillResults(
    foods: AnalyzedFoodItem[],
    filled: Record<string, any>[],
  ): void {
    const byName = new Map(filled.map((f) => [f.name?.toLowerCase(), f]));

    for (const food of foods) {
      const key = food.name?.toLowerCase();
      // 先精确匹配，miss 时做 includes 模糊匹配（容忍 LLM 返回名与输入名微差）
      const fill =
        byName.get(key) ??
        [...byName.entries()].find(
          ([k]) => k && key && (k.includes(key) || key.includes(k)),
        )?.[1];
      if (!fill) continue;

      const grams = food.estimatedWeightGrams || 100;
      const ratio = grams / 100;
      const round1 = (v: number) => Math.round(v * 10) / 10;

      // Scale per-100g → per-serving
      if (fill.calories != null)
        food.calories = Math.round(Number(fill.calories) * ratio);
      if (fill.protein != null)
        food.protein = round1(Number(fill.protein) * ratio);
      if (fill.fat != null) food.fat = round1(Number(fill.fat) * ratio);
      if (fill.carbs != null) food.carbs = round1(Number(fill.carbs) * ratio);
      if (fill.fiber != null) food.fiber = round1(Number(fill.fiber) * ratio);
      if (fill.sodium != null)
        food.sodium = Math.round(Number(fill.sodium) * ratio);
      if (fill.sugar != null) food.sugar = round1(Number(fill.sugar) * ratio);
      if (fill.saturatedFat != null)
        food.saturatedFat = round1(Number(fill.saturatedFat) * ratio);
      if (fill.transFat != null)
        food.transFat = round1(Number(fill.transFat) * ratio);
      if (fill.cholesterol != null)
        food.cholesterol = Math.round(Number(fill.cholesterol) * ratio);
      if (fill.purine != null)
        food.purine = round1(Number(fill.purine) * ratio);

      // Non-scaled fields
      if (fill.glycemicLoad != null)
        food.glycemicLoad = Number(fill.glycemicLoad);
      if (fill.qualityScore != null)
        food.qualityScore = Number(fill.qualityScore);
      if (fill.satietyScore != null)
        food.satietyScore = Number(fill.satietyScore);
      if (fill.processingLevel != null)
        food.processingLevel = fill.processingLevel;
      if (fill.fodmapLevel != null) food.fodmapLevel = fill.fodmapLevel;
      if (fill.oxalateLevel != null) food.oxalateLevel = fill.oxalateLevel;
      if (fill.allergens) food.allergens = fill.allergens;
      if (fill.tags) food.tags = fill.tags;
      if (fill.standardServingG != null && !food.standardServingG)
        food.standardServingG = Number(fill.standardServingG);
    }
  }

  /** Condiment/spice with tiny estimated weight — nutrition is negligible */
  private isNegligible(food: AnalyzedFoodItem): boolean {
    const grams = food.estimatedWeightGrams || 100;
    const cat = food.category || '';
    return (
      (cat === 'condiment' && grams <= 20) || grams <= 5 // < 5g is always negligible
    );
  }

  /** Apply near-zero nutrition for negligible condiments */
  private applyCondimentDefaults(food: AnalyzedFoodItem): void {
    if (!food.calories) food.calories = 0;
    food.qualityScore = food.qualityScore ?? 4;
    food.satietyScore = food.satietyScore ?? 1;
    food.processingLevel = food.processingLevel ?? 2;
    food.allergens = food.allergens ?? [];
    food.tags = food.tags ?? [];
  }
}
