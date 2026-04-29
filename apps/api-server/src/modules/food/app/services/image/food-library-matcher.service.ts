/**
 * 图片链路 Post-analysis 食物库匹配
 *
 * 职责：用 nameEn（首选）和 name（兜底）查 food_library，
 *      命中阈值之上时把 foodLibraryId + 校准后的营养/品质数据回写到 AnalyzedFoodItem。
 *
 * 数据契约：
 *  - 入参 foods 上的营养字段已是 per-serving（ImageResultParser 已缩放）
 *  - food_library 命中记录是 per-100g
 *  - 因此覆盖时必须按 ratio = estimatedWeightGrams / 100 缩放
 *
 * 失败策略：单条命中失败不影响整体（catch + 静默降级）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { AnalyzedFoodItem } from '../../../../decision/types/analysis-result.types';
import { FoodLibraryService } from '../food-library.service';

const MATCH_THRESHOLD = 0.5;
const HIGH_CONFIDENCE = 0.8;

const round1 = (v: number) => Math.round(v * 10) / 10;

@Injectable()
export class FoodLibraryMatcher {
  private readonly logger = new Logger(FoodLibraryMatcher.name);

  constructor(private readonly foodLibraryService: FoodLibraryService) {}

  /**
   * 并发匹配多条 foods。已带 foodLibraryId 的会跳过。
   */
  async matchAll(foods: AnalyzedFoodItem[]): Promise<void> {
    await Promise.all(foods.map((food) => this.matchOne(food)));
  }

  private async matchOne(food: AnalyzedFoodItem): Promise<void> {
    if (food.foodLibraryId) return;

    try {
      const primary = food.nameEn || food.name;
      if (!primary) return;

      const hit = await this.search(primary);
      if (hit) {
        this.applyMatch(food, hit);
        return;
      }

      // nameEn 命中失败时回退到 name
      if (food.nameEn && food.name && food.nameEn !== food.name) {
        const fallback = await this.search(food.name);
        if (fallback) this.applyMatch(food, fallback);
      }
    } catch {
      // 单条搜索失败不影响整批
    }
  }

  private async search(name: string): Promise<any | null> {
    const results = (await this.foodLibraryService.search(name, 1)) as any[];
    const top = results?.[0];
    if (!top || top.sim_score < MATCH_THRESHOLD) return null;
    return top;
  }

  private applyMatch(food: AnalyzedFoodItem, match: any): void {
    food.foodLibraryId = match.id;

    // AI 置信度不高时用库值校准营养（per-100g → per-serving）
    if (food.confidence < HIGH_CONFIDENCE) {
      const grams = food.estimatedWeightGrams || food.standardServingG || 100;
      const ratio = grams / 100;

      if (match.calories != null)
        food.calories = Math.round(Number(match.calories) * ratio);
      if (match.protein != null)
        food.protein = round1(Number(match.protein) * ratio);
      if (match.fat != null) food.fat = round1(Number(match.fat) * ratio);
      if (match.carbs != null) food.carbs = round1(Number(match.carbs) * ratio);
      if (match.fiber != null) food.fiber = round1(Number(match.fiber) * ratio);
      if (match.sodium != null)
        food.sodium = Math.round(Number(match.sodium) * ratio);
    }

    // 品质 / 饱腹度 / 风味 / 兼容性 — 与份量无关，直接覆盖
    if (match.qualityScore != null)
      food.qualityScore = Number(match.qualityScore);
    if (match.satietyScore != null)
      food.satietyScore = Number(match.satietyScore);
    if (match.foodForm && !food.foodForm) food.foodForm = match.foodForm;
    if (match.flavorProfile) food.flavorProfile = match.flavorProfile;
    if (match.compatibility) food.compatibility = match.compatibility;

    this.logger.debug(
      `Image food library matched: "${food.name}" → id=${match.id}, sim=${match.sim_score}`,
    );
  }
}
