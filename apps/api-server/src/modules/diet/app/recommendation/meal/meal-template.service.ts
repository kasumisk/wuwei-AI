// ═══════════════════════════════════════════════════════════════════
// V7.3 Phase 1-D: 餐食模板服务
//
// 职责：
// 1. 根据场景和餐次匹配最佳模板
// 2. 用候选食物填充模板槽位
// 3. 支持自定义模板注册
// ═══════════════════════════════════════════════════════════════════

import { Injectable, Logger } from '@nestjs/common';
import { FoodLibrary } from '../../../../food/food.types';
import { SceneType, ScoredFood } from '../types/recommendation.types';
import {
  BUILT_IN_MEAL_TEMPLATES,
  FilledSlot,
  MealTemplate,
  MealTemplateSlot,
  TemplateFilledResult,
} from '../types/meal-template.types';

@Injectable()
export class MealTemplateService {
  private readonly logger = new Logger(MealTemplateService.name);
  private templates: MealTemplate[] = [...BUILT_IN_MEAL_TEMPLATES];

  // ─── 模板匹配 ───

  /**
   * 根据场景和餐次匹配最佳模板
   *
   * 匹配规则：
   * 1. 模板的 applicableScenes 包含当前场景
   * 2. 模板的 applicableMealTypes 包含当前餐次
   * 3. 满足以上条件的模板按 priority 降序取第一个
   *
   * @returns 匹配的模板，无匹配时返回 null（降级到原有 MealAssembler 逻辑）
   */
  matchTemplate(sceneType: SceneType, mealType: string): MealTemplate | null {
    const matched = this.templates
      .filter(
        (t) =>
          t.applicableScenes.includes(sceneType) &&
          t.applicableMealTypes.includes(mealType),
      )
      .sort((a, b) => b.priority - a.priority);

    if (matched.length === 0) {
      this.logger.debug(
        `No template matched for scene=${sceneType}, mealType=${mealType}`,
      );
      return null;
    }

    this.logger.debug(
      `Template matched: ${matched[0].id} (priority=${matched[0].priority}) for scene=${sceneType}, mealType=${mealType}`,
    );
    return matched[0];
  }

  /**
   * 获取所有候选模板（按优先级排序）
   * 用于调试/管理接口
   */
  matchAllTemplates(sceneType: SceneType, mealType: string): MealTemplate[] {
    return this.templates
      .filter(
        (t) =>
          t.applicableScenes.includes(sceneType) &&
          t.applicableMealTypes.includes(mealType),
      )
      .sort((a, b) => b.priority - a.priority);
  }

  // ─── 模板填充 ───

  /**
   * 用候选食物填充模板槽位
   *
   * 算法：
   * 1. 按槽位顺序（非可选优先）逐个填充
   * 2. 每个槽位从候选池中选择最佳匹配（考虑类别约束 + foodForm偏好 + 评分）
   * 3. 已选食物不再用于后续槽位（去重）
   * 4. 热量按比例分配，在 calorieRatioRange 范围内
   * 5. 可选槽位在无合适候选时跳过
   *
   * @param template - 要填充的模板
   * @param candidates - 候选食物列表（已评分排序）
   * @param totalCalories - 本餐总热量目标
   */
  fillTemplate(
    template: MealTemplate,
    candidates: ScoredFood[],
    totalCalories: number,
  ): TemplateFilledResult {
    const filledSlots: FilledSlot[] = [];
    const usedFoodIds = new Set<string>();

    // 按必选优先排序槽位（必选在前，可选在后）
    const sortedSlots = [...template.slots].sort((a, b) => {
      if (a.optional && !b.optional) return 1;
      if (!a.optional && b.optional) return -1;
      return 0;
    });

    for (const slot of sortedSlots) {
      const bestMatch = this.findBestCandidate(slot, candidates, usedFoodIds);

      if (!bestMatch) {
        if (!slot.optional) {
          this.logger.debug(
            `Required slot '${slot.role}' unfilled in template ${template.id}`,
          );
        }
        continue;
      }

      const midRatio =
        (slot.calorieRatioRange[0] + slot.calorieRatioRange[1]) / 2;
      const allocatedCalories = Math.round(totalCalories * midRatio);

      filledSlots.push({
        role: slot.role,
        food: bestMatch,
        allocatedCalories,
      });
      usedFoodIds.add(bestMatch.food.id);
    }

    // 计算覆盖度
    const requiredSlots = template.slots.filter((s) => !s.optional);
    const filledRequiredCount = requiredSlots.filter((rs) =>
      filledSlots.some((fs) => fs.role === rs.role),
    ).length;
    const coverageScore =
      requiredSlots.length > 0 ? filledRequiredCount / requiredSlots.length : 1;

    // 计算模板匹配度
    const templateMatchScore = this.computeMatchScore(
      template,
      filledSlots,
      candidates,
    );

    const result: TemplateFilledResult = {
      templateId: template.id,
      filledSlots,
      totalCalories: filledSlots.reduce(
        (sum, s) => sum + s.allocatedCalories,
        0,
      ),
      coverageScore,
      templateMatchScore,
    };

    this.logger.debug(
      `Template ${template.id} filled: ${filledSlots.length}/${template.slots.length} slots, ` +
        `coverage=${coverageScore.toFixed(2)}, match=${templateMatchScore.toFixed(2)}`,
    );

    return result;
  }

  // ─── 模板注册 ───

  /**
   * 注册自定义模板（运行时扩展）
   * 新模板会与内置模板一起参与匹配
   */
  registerTemplate(template: MealTemplate): void {
    // 避免重复注册
    const existingIndex = this.templates.findIndex((t) => t.id === template.id);
    if (existingIndex >= 0) {
      this.templates[existingIndex] = template;
      this.logger.log(`Template '${template.id}' updated`);
    } else {
      this.templates.push(template);
      this.logger.log(`Template '${template.id}' registered`);
    }
  }

  /**
   * 获取所有已注册模板
   */
  getAllTemplates(): MealTemplate[] {
    return [...this.templates];
  }

  // ─── 内部方法 ───

  /**
   * 为槽位找到最佳候选食物
   *
   * 评分规则：
   * 1. 必须满足类别约束（如果有）
   * 2. foodForm 匹配加分（dish > semi_prepared > ingredient）
   * 3. dishPriority 加分（仅 dish/semi_prepared）
   * 4. 原始评分作为基础
   */
  private findBestCandidate(
    slot: MealTemplateSlot,
    candidates: ScoredFood[],
    usedFoodIds: Set<string>,
  ): ScoredFood | null {
    let bestCandidate: ScoredFood | null = null;
    let bestSlotScore = -Infinity;

    for (const candidate of candidates) {
      // 跳过已使用的食物
      if (usedFoodIds.has(candidate.food.id)) continue;

      // 类别约束检查
      if (
        slot.categoryConstraint &&
        slot.categoryConstraint.length > 0 &&
        !slot.categoryConstraint.includes(candidate.food.category)
      ) {
        continue;
      }

      // 计算槽位匹配分
      let slotScore = candidate.score;

      // foodForm 匹配加分
      const foodForm = (candidate.food as FoodLibrary).foodForm;
      if (slot.preferredFoodForm && foodForm) {
        if (foodForm === slot.preferredFoodForm) {
          slotScore *= 1.2; // 完全匹配 +20%
        } else if (foodForm === 'dish') {
          slotScore *= 1.1; // 成品菜通用加分 +10%
        }
      } else if (foodForm === 'dish') {
        // 即使没有偏好，成品菜也有轻微加分
        slotScore *= 1.05;
      }

      // dishPriority 加分
      const dishPriority = (candidate.food as FoodLibrary).dishPriority;
      if (dishPriority != null && dishPriority > 0) {
        slotScore *= 1 + dishPriority / 500; // 0-100 → 0-20% 加分
      }

      if (slotScore > bestSlotScore) {
        bestSlotScore = slotScore;
        bestCandidate = candidate;
      }
    }

    return bestCandidate;
  }

  /**
   * 计算模板填充的总体匹配度
   *
   * 综合评估：
   * 1. 覆盖度（填充了多少槽位）— 40%权重
   * 2. foodForm 匹配度（填充的食物形态是否匹配偏好）— 30%权重
   * 3. 候选质量（填充食物的平均评分）— 30%权重
   */
  private computeMatchScore(
    template: MealTemplate,
    filledSlots: FilledSlot[],
    _candidates: ScoredFood[],
  ): number {
    if (filledSlots.length === 0) return 0;

    // 1. 覆盖度
    const totalSlots = template.slots.length;
    const coverageRatio = filledSlots.length / totalSlots;

    // 2. foodForm 匹配度
    let formMatchCount = 0;
    let formCheckCount = 0;
    for (const slot of template.slots) {
      if (!slot.preferredFoodForm) continue;
      formCheckCount++;
      const filled = filledSlots.find((fs) => fs.role === slot.role);
      if (filled) {
        const foodForm = (filled.food.food as FoodLibrary).foodForm;
        if (foodForm === slot.preferredFoodForm) formMatchCount++;
      }
    }
    const formMatchRatio =
      formCheckCount > 0 ? formMatchCount / formCheckCount : 1;

    // 3. 平均评分（归一化到0-1）
    const avgScore =
      filledSlots.reduce((sum, s) => sum + s.food.score, 0) /
      filledSlots.length;
    const normalizedScore = Math.min(avgScore / 100, 1);

    return coverageRatio * 0.4 + formMatchRatio * 0.3 + normalizedScore * 0.3;
  }
}
