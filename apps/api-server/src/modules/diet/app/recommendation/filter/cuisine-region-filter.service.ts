/**
 * Final-fix P0-1：跨 region cuisine 硬过滤
 *
 * 背景：
 *   稳定性/质量报告显示 US/JP 用户的推荐结果中频繁出现纯中餐
 *   ("西红柿炒鸡蛋", "麻婆豆腐" 等)。根因是 RegionalCandidateFilter
 *   只剔除 RARE/LIMITED/forbidden 的食物，没有 food_regional_info 行
 *   的食物默认放行，跨 region 污染没有任何拦截。
 *
 * 修复策略（基于 cuisine ↔ countryCode 映射的硬过滤）：
 *   1. 计算用户允许的 country 集合：
 *      allowed = {user.countryCode} ∪ cuisineToCountryCodes(cuisinePreferences)
 *   2. 对每个候选食物：
 *      - food.cuisine == null/empty       → 放行（米饭/鸡蛋等中性食材）
 *      - cuisineToCountryCodes(food.cuisine) == []  → 放行
 *        （fast_food / other / 无映射的 cuisine，视为全球通用）
 *      - 映射 country ∩ allowed ≠ ∅       → 放行
 *      - 否则                              → 剔除
 *   3. 过滤后候选 < MIN_CANDIDATES 时回滚为原列表（与 RegionalCandidateFilter 对齐）
 *
 * 设计原则：
 *   - 与 RegionalCandidateFilter 解耦：那里管 availability/forbidden
 *     （行为基于 food_regional_info 行），这里管 cuisine 归属
 *     （行为基于 food.cuisine free-text 字段 + cuisinePreferences 声明画像）。
 *   - 复用 common/utils/cuisine.util 的 normalize / 国家映射，
 *     不在本文件再造 cuisine 归集表。
 */
import { Injectable, Logger } from '@nestjs/common';
import { FoodLibrary } from '../../../../food/food.types';
import {
  cuisineToCountryCodes,
  getCuisinePreferenceCountries,
} from '../../../../../common/utils/cuisine.util';

/** 与 RegionalCandidateFilter 对齐的最小候选保护 */
const MIN_CANDIDATES = 5;

@Injectable()
export class CuisineRegionFilterService {
  private readonly logger = new Logger(CuisineRegionFilterService.name);

  /**
   * 跨 region cuisine 硬过滤
   *
   * @param candidates           召回 + RealisticFilter + RegionalCandidateFilter 之后的候选
   * @param regionCode           用户区域码（如 'US' / 'US-CA' / 'CN-BJ'，仅取首段当 country）
   * @param cuisinePreferences   用户声明的菜系偏好（任意大小写/中文别名/英文）
   * @returns 过滤后的候选列表（不足 MIN_CANDIDATES 时返回原列表）
   */
  filter(
    candidates: FoodLibrary[],
    regionCode: string | null | undefined,
    cuisinePreferences: readonly string[] | null | undefined,
  ): FoodLibrary[] {
    this.logger.debug(
      `[CuisineRegionFilter] called: candidates=${candidates.length} ` +
        `regionCode=${regionCode ?? 'null'} ` +
        `cuisinePrefs=${cuisinePreferences ? JSON.stringify(cuisinePreferences) : 'null'}`,
    );
    if (!candidates.length) return candidates;

    // 解析用户的 country code（regionCode 可能是 'US' 或 'US-CA' 形式）
    const userCountryCode =
      regionCode && regionCode.length > 0
        ? regionCode.split('-')[0].toUpperCase()
        : null;

    // 构建允许的 country 集合：user country + 所有 cuisinePreferences 映射出的 country
    const allowedCountries = new Set<string>();
    if (userCountryCode) {
      allowedCountries.add(userCountryCode);
    }
    // getCuisinePreferenceCountries 内部已 normalize + 去重；excludeCountryCode 为 null
    // 时不排除任何国家（我们这里要的是并集，不是补集）
    const cuisineCountries = getCuisinePreferenceCountries(
      cuisinePreferences,
      null,
    );
    for (const cc of cuisineCountries) {
      allowedCountries.add(cc.toUpperCase());
    }

    // 用户没有任何 region/cuisine 信息 → 不过滤（避免误杀全部候选）
    if (allowedCountries.size === 0) {
      this.logger.debug(
        `[CuisineRegionFilter] no region/cuisine info, skipping filter`,
      );
      return candidates;
    }

    let neutralCount = 0;
    let unmappedCount = 0;
    let allowedCount = 0;
    let removedCount = 0;
    const removedSamples: string[] = [];

    const filtered = candidates.filter((food) => {
      const cuisine = food.cuisine;
      // 中性食材：无 cuisine 字段 → 放行
      if (!cuisine || cuisine.trim().length === 0) {
        neutralCount++;
        return true;
      }
      const foodCountries = cuisineToCountryCodes(cuisine);
      // 无国家映射（fast_food / other / 未知 cuisine） → 放行（视为全球通用）
      if (foodCountries.length === 0) {
        unmappedCount++;
        return true;
      }
      // 交集判断
      for (const cc of foodCountries) {
        if (allowedCountries.has(cc.toUpperCase())) {
          allowedCount++;
          return true;
        }
      }
      removedCount++;
      if (removedSamples.length < 5) removedSamples.push(food.name);
      return false;
    });

    // 兜底：过滤后不足最小候选数时放弃过滤
    if (filtered.length < MIN_CANDIDATES) {
      this.logger.debug(
        `[CuisineRegionFilter] allowed=${[...allowedCountries].join(',')}: ` +
          `filtered=${filtered.length} < MIN(${MIN_CANDIDATES}), skipping filter`,
      );
      return candidates;
    }

    if (removedCount > 0) {
      this.logger.log(
        `[CuisineRegionFilter] allowed=${[...allowedCountries].join(',')} ` +
          `removed=${removedCount} (samples=${removedSamples.join('|')}) ` +
          `kept=${filtered.length} (neutral=${neutralCount}, unmapped=${unmappedCount}, allowed=${allowedCount})`,
      );
    } else {
      this.logger.log(
        `[CuisineRegionFilter] allowed=${[...allowedCountries].join(',')} ` +
          `removed=0 kept=${filtered.length} ` +
          `(neutral=${neutralCount}, unmapped=${unmappedCount}, allowed=${allowedCount})`,
      );
    }

    return filtered;
  }
}
