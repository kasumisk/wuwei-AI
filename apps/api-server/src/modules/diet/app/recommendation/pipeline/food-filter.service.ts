import { Injectable, Logger } from '@nestjs/common';
import { FoodLibrary } from '../../../../food/food.types';
import { Constraint } from '../types/recommendation.types';
import { hasAllergenConflict } from '../filter/allergen-filter.util';

/**
 * V6.8 Phase 3-A: FoodFilter 职责精简
 *
 * 仅保留硬约束过滤，移除与 Recall 阶段重叠的品类/mealType 过滤逻辑。
 *
 * 职责划分：
 * - Recall 阶段：负责"召回什么候选"（品类/语义/CF/mealType 选择、includeTags）
 * - FoodFilter 阶段：负责"硬约束过滤"（过敏原/健康禁忌/excludeTags/热量/蛋白质/渠道/技能）
 */
@Injectable()
export class FoodFilterService {
  private readonly logger = new Logger(FoodFilterService.name);

  filterFoods(
    foods: FoodLibrary[],
    constraint: Constraint,
    _mealType?: string, // V6.8: 保留参数签名兼容，但不再按 mealType 过滤（由 Recall 负责）
    userAllergens?: string[],
  ): FoodLibrary[] {
    return foods.filter((food) => {
      // 1. 过敏原检查（硬约束）
      if (userAllergens?.length && hasAllergenConflict(food, userAllergens)) {
        return false;
      }

      // 2. 健康禁忌检查（硬约束）
      if (
        constraint.healthConditions?.length &&
        this.hasHealthRestriction(food, constraint.healthConditions)
      ) {
        return false;
      }

      // 3. excludeTag: 任一命中则排除（硬约束）
      const tags = food.tags || [];
      if (constraint.excludeTags.length > 0) {
        const hasExcluded = constraint.excludeTags.some((tag) =>
          tags.includes(tag),
        );
        if (hasExcluded) return false;
      }

      // 4. 渠道可达性（硬约束）
      if (
        constraint.channel &&
        !this.isChannelAvailable(food, constraint.channel)
      ) {
        return false;
      }

      // 5. 技能可行性（硬约束）
      if (
        constraint.skillLevel != null &&
        !this.isSkillFeasible(food, constraint.skillLevel)
      ) {
        return false;
      }

      // 6. 热量上限（硬约束）
      const servingCal = (food.calories * food.standardServingG) / 100;
      if (servingCal > constraint.maxCalories) return false;

      // 7. 蛋白质下限（硬约束）
      if (constraint.minProtein > 0 && food.protein) {
        const servingProtein = (food.protein * food.standardServingG) / 100;
        if (servingProtein < constraint.minProtein) return false;
      }

      // 移除: mealType 过滤（已在 Recall 阶段完成）
      // 移除: includeTags 品类过滤（已在 Recall 阶段完成）

      return true;
    });
  }

  // ─── 健康禁忌匹配 ───

  /**
   * 基于用户健康状况检查食物是否有硬禁忌。
   * 例如：糖尿病不推荐高 GI 食物、痛风不推荐高嘌呤食物。
   */
  private hasHealthRestriction(
    food: FoodLibrary,
    healthConditions: string[],
  ): boolean {
    const tags = food.tags || [];
    for (const condition of healthConditions) {
      switch (condition) {
        case 'diabetes':
          // 极高 GI 食物硬排除
          if (food.glycemicIndex != null && food.glycemicIndex > 85)
            return true;
          break;
        case 'gout':
          // 高嘌呤食物硬排除
          if (tags.includes('high_purine')) return true;
          break;
        case 'kidney_disease':
          // 极高钾食物硬排除
          if (food.potassium != null && food.potassium > 500) return true;
          break;
        case 'celiac':
          // 含麸质食物硬排除
          if (
            food.allergens?.includes('gluten') ||
            food.allergens?.includes('wheat')
          )
            return true;
          break;
      }
    }
    return false;
  }

  // ─── 渠道可达性 ───

  /**
   * 检查食物是否在指定渠道可获取。
   * 当食物有 compatibility 字段时，按渠道匹配。
   */
  private isChannelAvailable(food: FoodLibrary, channel: string): boolean {
    const compat = food.compatibility;
    if (!compat || Object.keys(compat).length === 0) return true; // 无渠道信息时默认可用
    // compatibility 是 Record<string, string[]>，检查是否有对应渠道 key 且非空
    const channelValues = compat[channel];
    if (channelValues === undefined) {
      // 渠道未列出 — 如果食物有指定的可用渠道列表但不包含此渠道，则不可用
      // 但如果没有任何渠道限制信息，默认可用
      return Object.keys(compat).length === 0;
    }
    return true;
  }

  // ─── 技能可行性 ───

  /**
   * 检查食物的烹饪难度是否在用户技能范围内。
   * 当食物标记了 processingLevel (0-5)，用户技能等级需 >= 食物要求。
   */
  private isSkillFeasible(food: FoodLibrary, skillLevel: number): boolean {
    const difficulty = food.processingLevel ?? 0;
    // processingLevel 0-2 = 任何人可做，3+ 需要相应技能
    if (difficulty <= 2) return true;
    return skillLevel >= difficulty;
  }
}
