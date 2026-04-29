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
import { PrismaService } from '../../../../core/prisma/prisma.service';
import {
  MealRecommendation,
  ScoredFood,
} from '../recommendation/types/recommendation.types';

/** 食物翻译映射：food_id → 目标语言名称 */
export type FoodTranslationMap = Map<string, string>;

export interface FoodLocalization {
  name: string;
  servingDesc?: string | null;
}

export type FoodLocalizationMap = Map<string, FoodLocalization>;

@Injectable()
export class FoodI18nService {
  private readonly logger = new Logger(FoodI18nService.name);

  constructor(private readonly prisma: PrismaService) {}

  private isDefaultLocale(locale: string): boolean {
    return /^zh(?:[-_]|$)/i.test(locale);
  }

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
    const localizedMap = await this.loadLocalizedDetails(foodIds, locale);

    for (const [foodId, localized] of localizedMap) {
      map.set(foodId, localized.name);
    }

    return map;
  }

  async loadLocalizedDetails(
    foodIds: string[],
    locale: string,
  ): Promise<FoodLocalizationMap> {
    const map = new Map<string, FoodLocalization>();

    if (this.isDefaultLocale(locale) || foodIds.length === 0) {
      return map;
    }

    try {
      const rows = await this.prisma.foodTranslations.findMany({
        where: {
          foodId: { in: foodIds },
          locale,
        },
        select: {
          foodId: true,
          name: true,
          servingDesc: true,
        },
      });

      for (const row of rows) {
        map.set(row.foodId, {
          name: row.name,
          servingDesc: row.servingDesc,
        });
      }

      this.logger.debug(
        `FoodI18n: loaded ${map.size}/${foodIds.length} localizations for locale=${locale}`,
      );
    } catch (err) {
      this.logger.warn(
        `FoodI18n: localization lookup failed for locale=${locale}: ${(err as Error).message}`,
      );
    }

    return map;
  }

  /**
   * 按食物中文名批量查翻译。
   *
   * 适用场景：调用方只有食物名字符串（无 food_id），需要翻译为目标语言。
   * 实现：一次 JOIN 查询 foods + food_translations，按 foods.name 精确匹配。
   *
   * 返回 originalName → translatedName 映射。
   * zh 语言时返回空 Map。
   */
  async loadTranslationsByFoodNames(
    foodNames: string[],
    locale: string,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    if (this.isDefaultLocale(locale) || foodNames.length === 0) {
      return map;
    }

    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ original_name: string; translated_name: string }>
      >(
        `SELECT f.name AS original_name, ft.name AS translated_name
         FROM foods f
         JOIN food_translations ft ON ft.food_id = f.id
         WHERE f.name = ANY($1::text[])
           AND ft.locale = $2`,
        foodNames,
        locale,
      );

      for (const row of rows) {
        map.set(row.original_name, row.translated_name);
      }

      this.logger.debug(
        `FoodI18n: loadTranslationsByFoodNames — resolved ${map.size}/${foodNames.length} names for locale=${locale}`,
      );
    } catch (err) {
      this.logger.warn(
        `FoodI18n: loadTranslationsByFoodNames failed for locale=${locale}: ${(err as Error).message}`,
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
    localizationMap: FoodLocalizationMap,
  ): ScoredFood[] {
    if (localizationMap.size === 0) {
      return foods; // zh 语言或无翻译，直接返回原对象
    }

    return foods.map((sf) => {
      const localized = localizationMap.get(sf.food.id);
      if (!localized) return sf;

      return {
        ...sf,
        food: {
          ...sf.food,
          // 覆盖 displayName（不影响 food.name，保持内部逻辑稳定）
          displayName: localized.name,
          displayServingDesc:
            localized.servingDesc || sf.food.standardServingDesc,
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
    if (!recommendation.foods?.length || this.isDefaultLocale(locale)) {
      return recommendation;
    }

    const foodIds = recommendation.foods
      .map((sf) => sf.food.id)
      .filter(Boolean);

    if (foodIds.length === 0) {
      return recommendation;
    }

    const localizationMap = await this.loadLocalizedDetails(foodIds, locale);
    if (localizationMap.size === 0) {
      return recommendation;
    }

    // 直接 mutate foods 数组，确保调用方无需接收返回值也能生效
    recommendation.foods = this.applyToScoredFoods(
      recommendation.foods,
      localizationMap,
    );

    return recommendation;
  }
}
