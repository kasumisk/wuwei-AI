// ═══════════════════════════════════════════════════════════════════
// V7.3 Phase 1-C: 餐食模板系统 — 类型定义 + 内置模板
// ═══════════════════════════════════════════════════════════════════

import { FoodForm } from '../../../../food/food.types';
import { SceneType, ScoredFood } from './recommendation.types';

// ─── 模板槽位定义 ───

/** 模板槽位角色 */
export type MealSlotRole =
  | 'main'
  | 'side'
  | 'soup'
  | 'staple'
  | 'drink'
  | 'dessert'
  | 'snack';

/** 餐食模板槽位 — 定义一个"位置"需要什么样的食物 */
export interface MealTemplateSlot {
  /** 槽位角色 */
  role: MealSlotRole;
  /** 食物形态偏好（优先选择该形态的食物） */
  preferredFoodForm?: FoodForm;
  /** 该槽位占总热量百分比范围 [min, max] */
  calorieRatioRange: [number, number];
  /** 可选食物类别约束（FoodCategory code） */
  categoryConstraint?: string[];
  /** 是否可省略（热量不足或无匹配食物时跳过） */
  optional?: boolean;
}

// ─── 模板定义 ───

/** 餐食模板 — 定义一种经典餐食搭配模式 */
export interface MealTemplate {
  /** 模板唯一ID */
  id: string;
  /** 模板名称 (i18n key) */
  nameKey: string;
  /** 适用场景列表 */
  applicableScenes: SceneType[];
  /** 适用餐次 (breakfast/lunch/dinner/snack) */
  applicableMealTypes: string[];
  /** 槽位定义 */
  slots: MealTemplateSlot[];
  /** 模板优先级 (越高越优先匹配, 用于多模板候选排序) */
  priority: number;
}

// ─── 模板填充结果 ───

/** 已填充的单个槽位 */
export interface FilledSlot {
  /** 槽位角色 */
  role: MealSlotRole;
  /** 填入的食物（含评分） */
  food: ScoredFood;
  /** 分配到的热量（kcal） */
  allocatedCalories: number;
}

/** 模板填充结果 */
export interface TemplateFilledResult {
  /** 使用的模板ID */
  templateId: string;
  /** 已填充的槽位列表 */
  filledSlots: FilledSlot[];
  /** 总热量 */
  totalCalories: number;
  /** 槽位填充完整度 (0-1, 1=所有非可选槽位都已填充) */
  coverageScore: number;
  /** 候选食物与模板的匹配度 (0-1, 考虑食物形态/类别/热量比例) */
  templateMatchScore: number;
}

// ─── 内置模板 ───

/**
 * V7.3 内置餐食模板
 *
 * 设计原则：
 * 1. 每个模板对应一种日常生活中常见的饮食搭配模式
 * 2. 模板通过场景和餐次匹配，不同场景优先不同模板
 * 3. 模板只定义"框架"（什么角色+热量比例），具体食物由算法填充
 * 4. 可选槽位在热量/候选不足时自动跳过
 */
export const BUILT_IN_MEAL_TEMPLATES: MealTemplate[] = [
  // ─── 中式标准餐（一主一副一汤） ───
  {
    id: 'chinese_standard',
    nameKey: 'template.chinese_standard',
    applicableScenes: ['home_cooking', 'family_dinner', 'canteen_meal'],
    applicableMealTypes: ['lunch', 'dinner'],
    priority: 100,
    slots: [
      {
        role: 'staple',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.25, 0.35],
        categoryConstraint: ['grain'],
      },
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.3, 0.45],
        categoryConstraint: ['protein', 'composite'],
      },
      {
        role: 'side',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.1, 0.2],
        categoryConstraint: ['veggie'],
      },
      {
        role: 'soup',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.05, 0.15],
        categoryConstraint: ['composite'],
        optional: true,
      },
    ],
  },

  // ─── 面食套餐（一碗面+小菜） ───
  {
    id: 'noodle_set',
    nameKey: 'template.noodle_set',
    applicableScenes: [
      'quick_breakfast',
      'office_lunch',
      'convenience_meal',
      'eating_out',
    ],
    applicableMealTypes: ['breakfast', 'lunch'],
    priority: 80,
    slots: [
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.7, 0.9],
        categoryConstraint: ['composite'],
      },
      {
        role: 'side',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.1, 0.3],
        categoryConstraint: ['veggie', 'protein'],
        optional: true,
      },
    ],
  },

  // ─── 快速早餐（主食+蛋白+饮品） ───
  {
    id: 'quick_breakfast',
    nameKey: 'template.quick_breakfast',
    applicableScenes: ['quick_breakfast', 'convenience_meal'],
    applicableMealTypes: ['breakfast'],
    priority: 90,
    slots: [
      {
        role: 'staple',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.4, 0.6],
        categoryConstraint: ['grain'],
      },
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.2, 0.4],
        categoryConstraint: ['protein', 'dairy'],
      },
      {
        role: 'drink',
        preferredFoodForm: 'semi_prepared',
        calorieRatioRange: [0.05, 0.2],
        categoryConstraint: ['beverage', 'dairy'],
        optional: true,
      },
    ],
  },

  // ─── 快餐组合（主菜+饮品+小食） ───
  {
    id: 'fast_food_combo',
    nameKey: 'template.fast_food_combo',
    applicableScenes: ['eating_out', 'convenience_meal'],
    applicableMealTypes: ['lunch', 'dinner'],
    priority: 70,
    slots: [
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.6, 0.8],
        categoryConstraint: ['composite'],
      },
      {
        role: 'drink',
        preferredFoodForm: 'semi_prepared',
        calorieRatioRange: [0.1, 0.25],
        categoryConstraint: ['beverage'],
        optional: true,
      },
      {
        role: 'dessert',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.05, 0.15],
        categoryConstraint: ['snack', 'fruit'],
        optional: true,
      },
    ],
  },

  // ─── 食堂托盘餐（主食+荤菜+素菜+可选素菜） ───
  {
    id: 'canteen_tray',
    nameKey: 'template.canteen_tray',
    applicableScenes: ['canteen_meal'],
    applicableMealTypes: ['lunch', 'dinner'],
    priority: 85,
    slots: [
      {
        role: 'staple',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.25, 0.35],
        categoryConstraint: ['grain'],
      },
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.3, 0.4],
        categoryConstraint: ['protein', 'composite'],
      },
      {
        role: 'side',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.15, 0.25],
        categoryConstraint: ['veggie'],
      },
      {
        role: 'side',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.05, 0.15],
        categoryConstraint: ['veggie'],
        optional: true,
      },
    ],
  },

  // ─── 运动后补给（蛋白+碳水+饮品） ───
  {
    id: 'post_workout_refuel',
    nameKey: 'template.post_workout',
    applicableScenes: ['post_workout'],
    applicableMealTypes: ['snack'],
    priority: 75,
    slots: [
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.5, 0.7],
        categoryConstraint: ['protein', 'dairy'],
      },
      {
        role: 'staple',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.2, 0.4],
        categoryConstraint: ['grain', 'fruit'],
      },
      {
        role: 'drink',
        preferredFoodForm: 'semi_prepared',
        calorieRatioRange: [0.05, 0.15],
        categoryConstraint: ['beverage'],
        optional: true,
      },
    ],
  },

  // ─── 悠闲早午餐（主菜+配菜+甜点+饮品） ───
  {
    id: 'leisurely_brunch',
    nameKey: 'template.leisurely_brunch',
    applicableScenes: ['leisurely_brunch'],
    applicableMealTypes: ['breakfast', 'lunch'],
    priority: 85,
    slots: [
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.35, 0.5],
        categoryConstraint: ['protein', 'composite'],
      },
      {
        role: 'staple',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.2, 0.35],
        categoryConstraint: ['grain'],
      },
      {
        role: 'side',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.1, 0.2],
        categoryConstraint: ['veggie', 'fruit'],
        optional: true,
      },
      {
        role: 'drink',
        preferredFoodForm: 'semi_prepared',
        calorieRatioRange: [0.05, 0.15],
        categoryConstraint: ['beverage'],
        optional: true,
      },
    ],
  },

  // ─── 深夜加餐（轻食） ───
  {
    id: 'late_night_light',
    nameKey: 'template.late_night_light',
    applicableScenes: ['late_night_snack'],
    applicableMealTypes: ['snack'],
    priority: 80,
    slots: [
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.6, 0.8],
        categoryConstraint: ['dairy', 'protein', 'fruit'],
      },
      {
        role: 'snack',
        preferredFoodForm: 'semi_prepared',
        calorieRatioRange: [0.2, 0.4],
        categoryConstraint: ['snack', 'grain'],
        optional: true,
      },
    ],
  },
];
