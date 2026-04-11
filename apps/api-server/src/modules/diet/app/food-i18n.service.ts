/**
 * V6.6 Phase 3-B — FoodI18nService
 *
 * 推荐结果多语言服务。
 *
 * 功能：
 * - 按 locale 批量查 food_translations，生成 food_id → 翻译名 映射
 * - 将映射 apply 到 MealRecommendation.foods 中的 food.name
 * - 无翻译时回退到原始中文名（不修改原 food 对象，返回 displayName 覆盖字段）
 *
 * 设计原则：
 * - 不修改 FoodLibrary 核心对象（防止影响评分/过滤逻辑）
 * - 只在最终输出阶段（recommendMeal 返回前）注入 displayName
 * - 非 zh 语言才查库，zh 直接跳过（避免无谓 DB 往返）
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  MealRecommendation,
  ScoredFood,
} from './recommendation/recommendation.types';

/** 食物翻译映射：food_id → 目标语言名称 */
export type FoodTranslationMap = Map<string, string>;

@Injectable()
export class FoodI18nService {
  private readonly logger = new Logger(FoodI18nService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 批量加载指定语言的食物翻译。
   * 返回 food_id → translated_name 映射。
   * zh 语言时返回空 Map（调用方据此跳过覆盖）。
   */
  async loadTranslations(
    foodIds: string[],
    locale: string,
  ): Promise<FoodTranslationMap> {
    const map = new Map<string, string>();

    // zh 为原始语言，不需要翻译
    if (locale === 'zh' || foodIds.length === 0) {
      return map;
    }

    try {
      const rows = await this.prisma.food_translations.findMany({
        where: {
          food_id: { in: foodIds },
          locale,
        },
        select: {
          food_id: true,
          name: true,
        },
      });

      for (const row of rows) {
        map.set(row.food_id, row.name);
      }

      this.logger.debug(
        `FoodI18n: loaded ${map.size}/${foodIds.length} translations for locale=${locale}`,
      );
    } catch (err) {
      // 翻译查询失败不影响推荐结果，仅记录警告
      this.logger.warn(
        `FoodI18n: translation lookup failed for locale=${locale}: ${(err as Error).message}`,
      );
    }

    return map;
  }

  /**
   * 将翻译映射 apply 到 ScoredFood 列表。
   *
   * 实现：给每个 ScoredFood 的 food 对象添加 `displayName` 字段。
   * 原 food.name 保留不变，供内部逻辑继续使用。
   * 无翻译时 displayName 回退为 food.name（即中文名）。
   */
  applyToScoredFoods(
    foods: ScoredFood[],
    translationMap: FoodTranslationMap,
  ): ScoredFood[] {
    if (translationMap.size === 0) {
      return foods; // zh 语言或无翻译，直接返回原对象
    }

    return foods.map((sf) => {
      const translated = translationMap.get(sf.food.id);
      if (!translated) return sf;

      return {
        ...sf,
        food: {
          ...sf.food,
          // 覆盖 displayName（不影响 food.name，保持内部逻辑稳定）
          displayName: translated,
        } as any,
      };
    });
  }

  /**
   * 一步完成：批量查翻译 + apply 到 MealRecommendation。
   * 直接修改传入的 MealRecommendation（避免深拷贝开销）。
   */
  async applyToMealRecommendation(
    recommendation: MealRecommendation,
    locale: string,
  ): Promise<MealRecommendation> {
    // 收集所有需要翻译的 food_id
    const foodIds = recommendation.foods
      .map((sf) => sf.food.id)
      .filter(Boolean);

    if (foodIds.length === 0 || locale === 'zh') {
      return recommendation;
    }

    const translationMap = await this.loadTranslations(foodIds, locale);
    if (translationMap.size === 0) {
      return recommendation;
    }

    return {
      ...recommendation,
      foods: this.applyToScoredFoods(recommendation.foods, translationMap),
    };
  }
}
