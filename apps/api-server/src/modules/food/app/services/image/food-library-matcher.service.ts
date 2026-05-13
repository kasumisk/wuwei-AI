/**
 * 图片链路 Post-analysis 食物库匹配
 *
 * 职责：用 name 查 food_library，命中阈值之上时把
 *      foodLibraryId + 校准后的营养/品质数据回写到 AnalyzedFoodItem。
 *
 * 数据契约：
 *  - 入参 foods 上的营养字段已是 per-serving（ImageResultParser 已缩放）
 *  - food_library 命中记录是 per-100g
 *  - 因此覆盖时必须按 ratio = estimatedWeightGrams / 100 缩放
 *
 * 失败策略：单条命中失败不影响整体（catch + 静默降级）。
 */
import { Injectable } from '@nestjs/common';
import { AnalyzedFoodItem } from '../../../../decision/types/analysis-result.types';
import { FoodLibraryService } from '../food-library.service';

const MATCH_THRESHOLD = 0.5;

const round1 = (v: number) => Math.round(v * 10) / 10;

@Injectable()
export class FoodLibraryMatcher {
  constructor(private readonly foodLibraryService: FoodLibraryService) {}

  /**
   * 并发匹配多条 foods。已带 foodLibraryId 的会跳过。
   */
  async matchAll(foods: AnalyzedFoodItem[], locale?: string): Promise<void> {
    await Promise.all(foods.map((food) => this.matchOne(food, locale)));
  }

  private async matchOne(food: AnalyzedFoodItem, locale?: string): Promise<void> {
    if (food.foodLibraryId) return;

    try {
      if (!food.name) return;
      const hit = await this.search(food.name, locale);
      if (hit) this.applyMatch(food, hit);
    } catch {
      // 单条搜索失败不影响整批
    }
  }

  private async search(name: string, locale?: string): Promise<any | null> {
    const results = (await this.foodLibraryService.search(name, 1, locale)) as any[];
    const top = results?.[0];
    if (!top || top.sim_score < MATCH_THRESHOLD) return null;
    return top;
  }

  private applyMatch(food: AnalyzedFoodItem, match: any): void {
    food.foodLibraryId = match.id;

    const grams = food.estimatedWeightGrams || food.standardServingG || 100;
    const ratio = grams / 100;

    // 库值比 Vision 估算更准确 — 命中时始终用库值覆盖基础宏量（per-100g → per-serving）
    if (match.calories != null)
      food.calories = Math.round(Number(match.calories) * ratio);
    if (match.protein != null)
      food.protein = round1(Number(match.protein) * ratio);
    if (match.fat != null) food.fat = round1(Number(match.fat) * ratio);
    if (match.carbs != null) food.carbs = round1(Number(match.carbs) * ratio);
    if (match.fiber != null) food.fiber = round1(Number(match.fiber) * ratio);
    if (match.sodium != null)
      food.sodium = Math.round(Number(match.sodium) * ratio);

    // 扩展营养（比例缩放）— 不论置信度，始终用库值覆盖（库比 Vision 准确）
    if (match.sugar != null) food.sugar = round1(Number(match.sugar) * ratio);
    if (match.saturated_fat != null)
      food.saturatedFat = round1(Number(match.saturated_fat) * ratio);
    if (match.trans_fat != null)
      food.transFat = round1(Number(match.trans_fat) * ratio);
    if (match.cholesterol != null)
      food.cholesterol = Math.round(Number(match.cholesterol) * ratio);
    if (match.purine != null)
      food.purine = round1(Number(match.purine) * ratio);

    // 指数型字段 — 不按份量缩放，直接使用库值
    if (match.glycemic_load != null)
      food.glycemicLoad = Number(match.glycemic_load);
    if (match.processing_level != null)
      food.processingLevel = match.processing_level;
    if (match.fodmap_level != null) food.fodmapLevel = match.fodmap_level;
    if (match.oxalate_level != null) food.oxalateLevel = match.oxalate_level;

    // 分类 / 标签 / 过敏原
    if (match.allergens) food.allergens = match.allergens;
    if (match.tags) food.tags = match.tags;
    if (match.food_group && !food.foodGroup) food.foodGroup = match.food_group;
    if (match.category && !food.category) food.category = match.category;
    if (match.standard_serving_g != null && !food.standardServingG)
      food.standardServingG = Number(match.standard_serving_g);

    // 品质 / 饱腹度 / 风味 / 兼容性 — 与份量无关，直接覆盖
    if (match.qualityScore != null)
      food.qualityScore = Number(match.qualityScore);
    if (match.satietyScore != null)
      food.satietyScore = Number(match.satietyScore);
    if (match.foodForm && !food.foodForm) food.foodForm = match.foodForm;
    if (match.flavorProfile) food.flavorProfile = match.flavorProfile;
    if (match.compatibility) food.compatibility = match.compatibility;
  }
}
