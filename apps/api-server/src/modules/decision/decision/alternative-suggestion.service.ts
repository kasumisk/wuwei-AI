/**
 * V1.6 Phase 2 — 替代食物建议服务
 *
 * 从 FoodDecisionService 提取的替代食物生成逻辑。
 *
 * 职责:
 * - generateAlternatives: 推荐引擎优先 + 静态 fallback
 * - explainAlternative: 人类可读的对比说明
 *
 * 设计原则:
 * - 只读引用推荐系统（SubstitutionService）
 * - 与 FoodDecisionService 解耦，可独立测试
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  FoodAlternative,
  AlternativeComparison,
  NutritionTotals,
  DietIssue,
  UnifiedUserContext,
  NutritionIssue,
} from '../types/analysis-result.types';
import { NutritionScoreBreakdown } from '../../diet/app/services/nutrition-score.service';
import {
  AlternativeRule,
  CATEGORY_ALTERNATIVE_RULES,
  GOAL_ALTERNATIVE_RULES,
} from '../config/alternative-food-rules';
import { SubstitutionService } from '../../diet/app/recommendation/filter/substitution.service';
import type {
  UserProfileConstraints,
  UserPreferenceProfile,
} from '../../diet/app/recommendation/types/recommendation.types';
import { FoodLibraryService } from '../../food/app/services/food-library.service';
import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { cl } from '../i18n/decision-labels';
import { DecisionFoodItem } from './food-decision.service';
import { RecommendationEngineService } from '../../diet/app/services/recommendation-engine.service';
import { MealRecommendation } from '../../diet/app/recommendation/types/recommendation.types';
import { ContextualAnalysis } from '../types/analysis-result.types';
import {
  TIME_BOUNDARIES,
  ALTERNATIVE_PARAMS,
} from '../config/decision-thresholds';

// ==================== 输入类型 ====================

/** V2.2: 替代方案约束（从问题维度提取） */
export interface AlternativeConstraints {
  preferHighProtein?: boolean;
  preferLowFat?: boolean;
  preferLowCarb?: boolean;
  preferLowCalorie?: boolean;
  maxCalories?: number;
  excludeAllergens?: string[];
  excludeCategories?: string[];
  /** V3.5: 低升糖指数优先（diabetes / glycemic_risk） */
  preferLowGlycemic?: boolean;
  /** V3.5: 低钠优先（hypertension / sodium_risk） */
  preferLowSodium?: boolean;
}

export interface AlternativeInput {
  foods: DecisionFoodItem[];
  totals: NutritionTotals;
  userContext: UnifiedUserContext;
  scoreBreakdown?: NutritionScoreBreakdown;
  locale?: Locale;
  userId?: string;
  replacementPatterns?: Record<string, number>;
  /** V1.9: 用户安全约束（过敏原/饮食限制等） */
  userConstraints?: UserProfileConstraints;
  /** V1.9: 用户偏好画像（loves/avoids/频率权重等） */
  preferenceProfile?: UserPreferenceProfile;
  /** V2.2: 结构化问题列表（用于提取替代方案约束） */
  issues?: DietIssue[];
  /** V3.3: 营养问题列表（来自上下文分析，更细粒度的问题识别） */
  nutritionIssues?: NutritionIssue[];
  /** V3.6 P2.1: 上下文分析（含 macroProgress.remaining，用于动态目标参数） */
  contextualAnalysis?: ContextualAnalysis;
}

@Injectable()
export class AlternativeSuggestionService {
  private readonly logger = new Logger(AlternativeSuggestionService.name);

  constructor(
    private readonly recommendationEngineService: RecommendationEngineService,
    private readonly substitutionService: SubstitutionService,
    private readonly foodLibraryService: FoodLibraryService,
  ) {}

  // ==================== 主入口 ====================

  async generateAlternatives(
    input: AlternativeInput,
  ): Promise<FoodAlternative[]> {
    const {
      foods,
      userContext: ctx,
      userId,
      locale,
      replacementPatterns,
      userConstraints,
      preferenceProfile,
      issues,
      nutritionIssues,
      contextualAnalysis,
    } = input;

    // V2.2: 从问题列表提取替代方案约束
    const constraints = this.extractConstraintsFromIssues(
      issues,
      ctx,
      nutritionIssues,
    );

    let results: FoodAlternative[] = [];

    // 1. 推荐引擎优先（V2.5：从整餐推荐候选池生成替代，不再只依赖替换规则）
    if (userId) {
      try {
        const engineAlternatives = await this.getEngineAlternatives(
          foods,
          userId,
          ctx,
          userConstraints,
          preferenceProfile,
          constraints,
          contextualAnalysis,
          locale,
        );
        if (engineAlternatives.length > 0) {
          results = engineAlternatives.slice(0, 5);
        }
      } catch (err) {
        this.logger.warn(
          `Engine alternatives fetch failed, falling back to secondary path: ${(err as Error).message}`,
        );
      }
    }

    // 2. SubstitutionService 二级路径
    if (results.length === 0 && userId) {
      try {
        const substitutionAlternatives = await this.getSubstitutionAlternatives(
          foods,
          userId,
          ctx,
          userConstraints,
          preferenceProfile,
          constraints,
          locale,
        );
        if (substitutionAlternatives.length > 0) {
          results = substitutionAlternatives.slice(0, 5);
        }
      } catch (err) {
        this.logger.warn(
          `SubstitutionService alternatives fetch failed, falling back to static rules: ${(err as Error).message}`,
        );
      }
    }

    // 3. 静态规则 fallback
    if (results.length === 0) {
      results = await this.generateStaticAlternatives(foods, ctx, locale);
    }

    // 4. 添加 comparison 字段（定量对比）
    const avgCalories =
      foods.length > 0
        ? foods.reduce((s, f) => s + f.calories, 0) / foods.length
        : 0;
    const avgProtein =
      foods.length > 0
        ? foods.reduce((s, f) => s + f.protein, 0) / foods.length
        : 0;
    for (const alt of results) {
      if (!alt.comparison) {
        alt.comparison = this.buildComparison(alt, avgCalories, avgProtein);
      }
    }

    // 5. replacementPatterns 驱动排序提升
    if (replacementPatterns && Object.keys(replacementPatterns).length > 0) {
      const foodNames = foods.map((f) => f.name);
      for (const alt of results) {
        for (const foodName of foodNames) {
          const key = `${foodName}→${alt.name}`;
          const count = replacementPatterns[key];
          if (count && count > 0) {
            alt.score = (alt.score || 0) + count * 0.1;
          }
        }
      }
      results.sort((a, b) => (b.score || 0) - (a.score || 0));
    }

    return results.slice(0, 5);
  }

  // ==================== 定量对比构建 ====================

  /**
   * V4.2: 构建替代方案与原始食物的定量对比
   * 对引擎替代方案使用真实数据，对静态替代方案提供估算值
   */
  private buildComparison(
    alt: FoodAlternative,
    avgCalories: number,
    _avgProtein: number,
  ): AlternativeComparison | undefined {
    // 引擎替代方案已有 comparison（在 getEngineAlternatives 中构建）
    if (alt.comparison) return alt.comparison;

    // V4.2: 静态替代方案 — 估算热量差（静态替代通常是更健康的选择，假设降低约 30%）
    if (alt.source === 'static' && avgCalories > 0) {
      return {
        caloriesDiff: Math.round(-avgCalories * 0.3),
        proteinDiff: 0, // 未知，用 0 表示
        scoreDiff: undefined,
      };
    }

    return undefined;
  }

  // ==================== 推荐引擎替代 ====================

  private async getEngineAlternatives(
    foods: DecisionFoodItem[],
    userId: string,
    ctx: UnifiedUserContext,
    userConstraints?: UserProfileConstraints,
    _preferenceProfile?: UserPreferenceProfile,
    constraints?: AlternativeConstraints,
    contextualAnalysis?: ContextualAnalysis,
    locale?: Locale,
  ): Promise<FoodAlternative[]> {
    const currentMealCalories = foods.reduce(
      (sum, food) => sum + food.calories,
      0,
    );
    const currentMealProtein = foods.reduce(
      (sum, food) => sum + food.protein,
      0,
    );

    // V3.9 P2.1: 从 macroProgress.remaining 提取营养缺口，动态约束替代方案目标
    const remaining = contextualAnalysis?.macroProgress?.remaining;

    const scenarioRecommendations =
      await this.recommendationEngineService.recommendByScenario(
        userId,
        ctx.mealType || 'snack',
        ctx.goalType || 'health',
        {
          calories: Math.max(0, ctx.todayCalories || 0),
          protein: Math.max(0, ctx.todayProtein || 0),
        },
        {
          calories: (() => {
            if (remaining?.calories !== undefined && remaining.calories > 0) {
              const dynamicTarget = Math.round(remaining.calories * 0.4);
              return constraints?.preferLowCalorie
                ? Math.min(dynamicTarget, currentMealCalories * 0.7)
                : Math.max(dynamicTarget, 150);
            }
            return (
              constraints?.maxCalories || Math.max(currentMealCalories, 150)
            );
          })(),
          protein: (() => {
            if (remaining?.protein !== undefined && remaining.protein > 0) {
              const dynamicTarget = Math.round(remaining.protein * 0.4);
              return constraints?.preferHighProtein
                ? Math.max(dynamicTarget, 20)
                : Math.max(dynamicTarget, 12);
            }
            return constraints?.preferHighProtein
              ? Math.max(currentMealProtein + 8, 20)
              : Math.max(currentMealProtein, 12);
          })(),
          fat: (() => {
            if (remaining?.fat !== undefined && remaining.fat > 0) {
              const dynamicTarget = Math.round(remaining.fat * 0.3);
              return constraints?.preferLowFat
                ? Math.min(dynamicTarget, 10)
                : Math.max(dynamicTarget, 8);
            }
            return constraints?.preferLowFat
              ? Math.min(currentMealCalories * 0.2, 12)
              : Math.max(
                  10,
                  foods.reduce((sum, food) => sum + food.fat, 0),
                );
          })(),
          carbs: (() => {
            // V3.6 P2.1: 用剩余碳水动态计算，替代写死的 20g/15g
            const remainingCarbs = remaining?.carbs;
            if (remainingCarbs !== undefined && remainingCarbs > 0) {
              // 建议摄入 30% 的剩余碳水量（当前餐分配）
              const dynamicTarget = Math.round(remainingCarbs * 0.3);
              if (constraints?.preferLowCarb)
                return Math.min(dynamicTarget, 20);
              if (constraints?.preferLowGlycemic)
                return Math.min(dynamicTarget, 25);
              return Math.max(dynamicTarget, 10);
            }
            return constraints?.preferLowCarb
              ? 20
              : constraints?.preferLowGlycemic
                ? 15
                : Math.max(
                    20,
                    foods.reduce((sum, food) => sum + food.carbs, 0),
                  );
          })(),
        },
        {
          calories: Math.max(ctx.goalCalories || 0, currentMealCalories),
          protein: Math.max(ctx.goalProtein || 0, currentMealProtein),
          fat: Math.max(ctx.goalFat || 0, 0),
          carbs: Math.max(ctx.goalCarbs || 0, 0),
        },
        userConstraints || {
          allergens: ctx.allergens,
          dietaryRestrictions: ctx.dietaryRestrictions,
          healthConditions: ctx.healthConditions,
        },
      );

    const scenarioMap: Array<
      ['takeout' | 'convenience' | 'homeCook', MealRecommendation]
    > = [
      ['takeout', scenarioRecommendations.takeout],
      ['convenience', scenarioRecommendations.convenience],
      ['homeCook', scenarioRecommendations.homeCook],
    ];

    const seenNames = new Set<string>();
    const alternatives: FoodAlternative[] = [];

    for (const [scenarioType, recommendation] of scenarioMap) {
      for (const candidate of recommendation.foods || []) {
        const name = candidate.food?.name;
        if (!name || seenNames.has(name)) {
          continue;
        }

        seenNames.add(name);
        alternatives.push({
          name,
          foodLibraryId: candidate.food?.id,
          source: 'engine',
          score: candidate.score,
          reason: this.explainEngineCandidate(
            candidate,
            currentMealCalories,
            currentMealProtein,
            constraints,
            scenarioType,
            locale,
          ),
          comparison: {
            caloriesDiff: Math.round(
              candidate.servingCalories - currentMealCalories,
            ),
            proteinDiff: Math.round(
              candidate.servingProtein - currentMealProtein,
            ),
            scoreDiff:
              typeof candidate.score === 'number'
                ? Math.round(candidate.score * 100)
                : undefined,
          },
          scenarioType,
        });
      }
    }

    return this.attachRankScores(
      alternatives.slice(0, 5),
      ctx,
      locale,
      foods.map((f) => f.foodForm).filter(Boolean) as string[],
      foods.map((f) => f.flavorProfile).filter(Boolean) as string[],
    );
  }

  private explainEngineCandidate(
    candidate: any,
    currentMealCalories: number,
    currentMealProtein: number,
    constraints?: AlternativeConstraints,
    scenarioType?: 'takeout' | 'convenience' | 'homeCook',
    locale?: Locale,
  ): string {
    if (
      constraints?.preferLowCalorie &&
      candidate.servingCalories < currentMealCalories
    ) {
      return cl('alt.lowerCal', locale, {
        newCal: Math.round(candidate.servingCalories),
        oldCal: Math.round(currentMealCalories),
      });
    }

    if (
      constraints?.preferLowGlycemic &&
      candidate.servingCarbs !== undefined &&
      candidate.servingCarbs < 15
    ) {
      return cl('alt.lowGlycemic', locale, {
        carbs: Math.round(candidate.servingCarbs),
      });
    }

    if (
      constraints?.preferHighProtein &&
      candidate.servingProtein > currentMealProtein
    ) {
      return cl('alt.higherProtein', locale, {
        newPro: Math.round(candidate.servingProtein),
        oldPro: Math.round(currentMealProtein),
      });
    }

    if (scenarioType === 'convenience') {
      return cl('alt.similar', locale);
    }

    return cl('alt.matchScore', locale, {
      score: Math.round((candidate.score || 0) * 100),
    });
  }

  private async getSubstitutionAlternatives(
    foods: DecisionFoodItem[],
    userId: string,
    ctx: UnifiedUserContext,
    userConstraints?: UserProfileConstraints,
    preferenceProfile?: UserPreferenceProfile,
    constraints?: AlternativeConstraints,
    locale?: Locale,
  ): Promise<FoodAlternative[]> {
    const alternatives: FoodAlternative[] = [];
    const seenNames = new Set<string>();
    const startTime = Date.now();
    for (const food of foods) {
      let foodId = food.libraryMatch?.id;

      if (!foodId && food.name) {
        try {
          const fuzzyResults = (await this.foodLibraryService.search(
            food.name,
            1,
          )) as any[];
          if (
            fuzzyResults &&
            fuzzyResults.length > 0 &&
            fuzzyResults[0]?.sim_score > 0.3
          ) {
            foodId = fuzzyResults[0].id;
          }
        } catch {
          // 搜索失败跳过
        }
      }

      if (!foodId) continue;

      const candidates = await this.substitutionService.findSubstitutes(
        foodId,
        userId,
        undefined,
        3,
        [], // excludeNames
        // V1.9: 传递用户安全约束和偏好画像
        userConstraints || {
          allergens: ctx.allergens,
          dietaryRestrictions: ctx.dietaryRestrictions,
          healthConditions: ctx.healthConditions,
        },
        preferenceProfile,
      );

      for (const c of candidates) {
        const name = c.food?.name || c.food?.nameZh;
        if (!name || seenNames.has(name)) continue;
        seenNames.add(name);

        let reason: string;
        if (
          constraints?.preferLowCalorie &&
          c.servingCalories < food.calories * 0.8
        ) {
          reason = cl('alt.lowerCal', locale, {
            newCal: Math.round(c.servingCalories),
            oldCal: Math.round(food.calories),
          });
        } else if (
          constraints?.preferHighProtein &&
          c.servingProtein > food.protein * 1.1
        ) {
          reason = cl('alt.higherProtein', locale, {
            newPro: Math.round(c.servingProtein),
            oldPro: Math.round(food.protein),
          });
        } else if (
          ctx.goalType === 'fat_loss' &&
          c.servingCalories < food.calories * 0.7
        ) {
          reason = cl('alt.lowerCal', locale, {
            newCal: Math.round(c.servingCalories),
            oldCal: Math.round(food.calories),
          });
        } else if (
          ctx.goalType === 'muscle_gain' &&
          c.servingProtein > food.protein * 1.2
        ) {
          reason = cl('alt.higherProtein', locale, {
            newPro: Math.round(c.servingProtein),
            oldPro: Math.round(food.protein),
          });
        } else if (c.substituteScore > 0.7) {
          reason = cl('alt.matchScore', locale, {
            score: Math.round(c.substituteScore * 100),
          });
        } else {
          reason = cl('alt.similar', locale);
        }

        alternatives.push({
          name,
          reason,
          foodLibraryId: c.food?.id,
          score: c.substituteScore,
          source: 'engine',
          comparison: {
            caloriesDiff: Math.round(c.servingCalories - food.calories),
            proteinDiff: Math.round(c.servingProtein - food.protein),
            scoreDiff: undefined,
          },
        });
      }

      if (alternatives.length >= 5) break;
    }

    // V2.1: 推荐引擎调用指标日志
    const latencyMs = Date.now() - startTime;
    this.logger.debug(
      `Substitution alternatives: count=${alternatives.length}, latency=${latencyMs}ms, userId=${userId}`,
    );

    return this.attachRankScores(
      alternatives,
      ctx,
      locale,
      foods.map((f) => f.foodForm).filter(Boolean) as string[],
      foods.map((f) => f.flavorProfile).filter(Boolean) as string[],
    );
  }

  // ==================== V2.2: 问题约束提取 ====================

  /**
   * 从结构化问题列表中提取替代方案约束维度
   *
   * 映射关系：
   * - calorie_excess / cumulative_excess / multi_day_excess → preferLowCalorie + maxCalories
   * - protein_deficit → preferHighProtein
   * - fat_excess → preferLowFat
   * - carb_excess → preferLowCarb
   * - allergen → excludeAllergens
   * - restriction → excludeCategories
   */
  private extractConstraintsFromIssues(
    issues?: DietIssue[],
    ctx?: UnifiedUserContext,
    nutritionIssues?: NutritionIssue[],
  ): AlternativeConstraints {
    const constraints: AlternativeConstraints = {};

    if (!issues || issues.length === 0) {
      // V3.3: 即使没有 DietIssue，也从 NutritionIssue 中提取约束
      if (nutritionIssues && nutritionIssues.length > 0) {
        return this.extractConstraintsFromNutritionIssues(
          nutritionIssues,
          ctx,
          constraints,
        );
      }
      return constraints;
    }

    for (const issue of issues) {
      switch (issue.category) {
        case 'calorie_excess':
        case 'cumulative_excess':
        case 'multi_day_excess':
          constraints.preferLowCalorie = true;
          if (ctx && ctx.remainingCalories > 0 && !constraints.maxCalories) {
            constraints.maxCalories = ctx.remainingCalories;
          }
          break;
        case 'protein_deficit':
          constraints.preferHighProtein = true;
          break;
        case 'fat_excess':
          constraints.preferLowFat = true;
          break;
        case 'carb_excess':
          constraints.preferLowCarb = true;
          break;
        case 'allergen':
          if (ctx?.allergens && ctx.allergens.length > 0) {
            constraints.excludeAllergens = [...ctx.allergens];
          }
          break;
        case 'restriction':
          if (ctx?.dietaryRestrictions && ctx.dietaryRestrictions.length > 0) {
            constraints.excludeCategories = [...ctx.dietaryRestrictions];
          }
          break;
      }
    }

    // V3.3: 补充 NutritionIssue 中的约束（不覆盖已有）
    if (nutritionIssues && nutritionIssues.length > 0) {
      this.extractConstraintsFromNutritionIssues(
        nutritionIssues,
        ctx,
        constraints,
      );
    }

    return constraints;
  }

  /**
   * V3.3: 从 NutritionIssue[] 中提取替代方案约束
   * NutritionIssue.type 对应: calorie_excess, protein_deficit, fat_excess, carb_excess,
   *   fiber_deficit, sugar_excess, sodium_excess 等
   */
  private extractConstraintsFromNutritionIssues(
    nutritionIssues: NutritionIssue[],
    ctx?: UnifiedUserContext,
    constraints: AlternativeConstraints = {},
  ): AlternativeConstraints {
    for (const ni of nutritionIssues) {
      switch (ni.type) {
        case 'calorie_excess':
          if (!constraints.preferLowCalorie) {
            constraints.preferLowCalorie = true;
            if (ctx && ctx.remainingCalories > 0 && !constraints.maxCalories) {
              constraints.maxCalories = ctx.remainingCalories;
            }
          }
          break;
        case 'protein_deficit':
          if (!constraints.preferHighProtein) {
            constraints.preferHighProtein = true;
          }
          break;
        case 'fat_excess':
          if (!constraints.preferLowFat) {
            constraints.preferLowFat = true;
          }
          break;
        case 'carb_excess':
          if (!constraints.preferLowCarb) {
            constraints.preferLowCarb = true;
          }
          break;
        // V3.5: V3.4 新增健康条件类型映射
        case 'glycemic_risk':
          if (!constraints.preferLowGlycemic) {
            constraints.preferLowGlycemic = true;
            if (!constraints.preferLowCarb) {
              constraints.preferLowCarb = true;
            }
          }
          break;
        case 'cardiovascular_risk':
          if (!constraints.preferLowFat) {
            constraints.preferLowFat = true;
          }
          break;
        case 'sodium_risk':
          if (!constraints.preferLowSodium) {
            constraints.preferLowSodium = true;
          }
          break;
        case 'purine_risk':
        case 'kidney_stress':
          // 嘌呤/肾脏应激：低蛋白 + 低脂肪方向
          if (!constraints.preferLowFat) {
            constraints.preferLowFat = true;
          }
          break;
        // sugar_excess 和 sodium_excess 暂不映射到 AlternativeConstraints
        // fiber_deficit 暂不映射（未来可扩展 preferHighFiber）
      }
    }
    return constraints;
  }

  // ==================== 静态规则替代 ====================

  /**
   * V5.0 P2.2: Constants now sourced from decision-thresholds.ts
   * @deprecated Use TIME_BOUNDARIES.lateNightStart / ALTERNATIVE_PARAMS.lateNightMinCalories
   */
  private static readonly LATE_NIGHT_HOUR = TIME_BOUNDARIES.lateNightStart;
  private static readonly LATE_NIGHT_MIN_CAL =
    ALTERNATIVE_PARAMS.lateNightMinCalories;
  private static readonly DEFAULT_GOAL_TYPE =
    ALTERNATIVE_PARAMS.defaultGoalType;

  /**
   * V4.8 P2.2: Static rule fallback — hint-only, no food library search
   *
   * Engine and substitution paths handle real food lookup.
   * Static fallback provides category-level hints from substitutionConstraints.
   */
  private async generateStaticAlternatives(
    foods: DecisionFoodItem[],
    ctx: UnifiedUserContext,
    locale?: Locale,
  ): Promise<FoodAlternative[]> {
    const totalProtein = foods.reduce((s, f) => s + f.protein, 0);
    const totalCalories = foods.reduce((s, f) => s + f.calories, 0);
    const totalCarbs = foods.reduce((s, f) => s + f.carbs, 0);
    const totalFat = foods.reduce((s, f) => s + f.fat, 0);

    const matched: FoodAlternative[] = [];
    const seenNames = new Set<string>();

    // V4.8: Hint-only — no food library search (engine paths handle that)
    const addFromRule = (rule: AlternativeRule) => {
      if (matched.length >= 5) return;
      const hint = cl(rule.fallbackHint, locale);
      if (!hint || seenNames.has(hint)) return;

      seenNames.add(hint);
      matched.push({
        name: hint,
        reason: hint,
        source: 'static',
      });
    };

    for (const food of foods) {
      for (const rule of CATEGORY_ALTERNATIVE_RULES) {
        if (
          this.matchesAlternativeRule(
            rule,
            food,
            ctx,
            totalCalories,
            totalProtein,
            totalCarbs,
            totalFat,
          )
        ) {
          addFromRule(rule);
        }
      }
    }

    for (const rule of GOAL_ALTERNATIVE_RULES) {
      if (
        this.matchesGoalRule(
          rule,
          ctx,
          totalCalories,
          totalProtein,
          totalCarbs,
          totalFat,
        )
      ) {
        addFromRule(rule);
      }
    }

    // Late-night high-calorie hints
    const hour = ctx.localHour ?? 0;
    if (
      hour >= AlternativeSuggestionService.LATE_NIGHT_HOUR &&
      totalCalories > AlternativeSuggestionService.LATE_NIGHT_MIN_CAL
    ) {
      const lateHints: FoodAlternative[] = [
        {
          name: cl('alt.lateNightMilk', locale),
          reason: cl('alt.lateNightMilkReason', locale),
          source: 'static',
        },
        {
          name: cl('alt.lateNightFruit', locale),
          reason: cl('alt.lateNightFruitReason', locale),
          source: 'static',
        },
      ];
      for (const alt of lateHints) {
        if (!seenNames.has(alt.name)) {
          seenNames.add(alt.name);
          matched.push(alt);
        }
      }
    }

    return matched.slice(0, 5);
  }

  private matchesAlternativeRule(
    rule: AlternativeRule,
    food: DecisionFoodItem,
    ctx: UnifiedUserContext,
    _totalCalories: number,
    _totalProtein: number,
    _totalCarbs: number,
    _totalFat: number,
  ): boolean {
    const trigger = rule.trigger;
    if (
      trigger.categories?.length &&
      !trigger.categories.includes(food.category || '')
    )
      return false;
    if (
      trigger.goals?.length &&
      !trigger.goals.includes(
        ctx.goalType || AlternativeSuggestionService.DEFAULT_GOAL_TYPE,
      )
    )
      return false;
    if (trigger.minCalories != null && food.calories < trigger.minCalories)
      return false;
    if (trigger.minCarbs != null && food.carbs < trigger.minCarbs) return false;
    if (trigger.minFat != null && food.fat < trigger.minFat) return false;
    return true;
  }

  private matchesGoalRule(
    rule: AlternativeRule,
    ctx: UnifiedUserContext,
    totalCalories: number,
    totalProtein: number,
    totalCarbs: number,
    totalFat: number,
  ): boolean {
    const trigger = rule.trigger;
    if (
      trigger.goals?.length &&
      !trigger.goals.includes(
        ctx.goalType || AlternativeSuggestionService.DEFAULT_GOAL_TYPE,
      )
    )
      return false;
    if (trigger.minCalories != null && totalCalories < trigger.minCalories)
      return false;
    if (trigger.maxProtein != null && totalProtein > trigger.maxProtein)
      return false;
    if (trigger.minCarbs != null && totalCarbs < trigger.minCarbs) return false;
    if (trigger.minFat != null && totalFat < trigger.minFat) return false;
    return true;
  }

  /**
   * V3.0: 为替代方案列表计算 rankScore 和 rankReasons
   * V5.0 P2.1: 新增 foodForm/flavorProfile 匹配加分
   * V5.0 P2.2: 权重/阈值从 ALTERNATIVE_PARAMS 读取
   *
   * rankScore 越高 → 越推荐
   */
  private attachRankScores(
    alternatives: FoodAlternative[],
    ctx: UnifiedUserContext,
    locale?: Locale,
    /** V5.0: 原始食物的 foodForm（用于匹配加分） */
    originalFoodForms?: string[],
    /** V5.0: 原始食物的 flavorProfile（用于匹配加分） */
    originalFlavorProfiles?: string[],
  ): FoodAlternative[] {
    if (!alternatives.length) return alternatives;

    const AP = ALTERNATIVE_PARAMS;

    return alternatives
      .map((alt) => {
        const comp = alt.comparison;
        const calDiff = comp?.caloriesDiff ?? 0;
        const prosDiff = comp?.proteinDiff ?? 0;
        const rawScore = typeof alt.score === 'number' ? alt.score : 0.5;

        const reasons: string[] = [];
        let score = rawScore * AP.rankBaseWeight;

        // 热量维度
        const calScore = Math.max(
          -1,
          Math.min(1, -calDiff / AP.rankCalNormDenom),
        );
        const calWeight =
          ctx.goalType === 'fat_loss'
            ? AP.rankCalWeightFatLoss
            : AP.rankCalWeightDefault;
        score += calScore * calWeight;
        if (calDiff < -AP.rankCalDiffThreshold)
          reasons.push(
            cl('alt.calLess', locale, { amount: Math.abs(calDiff) }),
          );
        else if (calDiff > AP.rankCalDiffThreshold)
          reasons.push(cl('alt.calMore', locale, { amount: calDiff }));

        // 蛋白质维度
        const prosScore = Math.max(
          -1,
          Math.min(1, prosDiff / AP.rankProteinNormDenom),
        );
        const prosWeight =
          ctx.goalType === 'muscle_gain'
            ? AP.rankProteinWeightMuscleGain
            : AP.rankProteinWeightDefault;
        score += prosScore * prosWeight;
        if (prosDiff > AP.rankProteinDiffThreshold)
          reasons.push(cl('alt.proteinMore', locale, { amount: prosDiff }));
        else if (prosDiff < -AP.rankProteinDiffThreshold)
          reasons.push(
            cl('alt.proteinLess', locale, { amount: Math.abs(prosDiff) }),
          );

        // V5.0 P2.1: foodForm match boost
        if (originalFoodForms?.length && (alt as any).foodForm) {
          if (originalFoodForms.includes((alt as any).foodForm)) {
            score += AP.foodFormMatchBoost;
            reasons.push(cl('alt.similarForm', locale));
          }
        }

        // V5.0 P2.1: flavorProfile match boost
        if (originalFlavorProfiles?.length && (alt as any).flavorProfile) {
          if (originalFlavorProfiles.includes((alt as any).flavorProfile)) {
            score += AP.flavorMatchBoost;
            reasons.push(cl('alt.similarFlavor', locale));
          }
        }

        // 归一化到 [0, 1]
        const finalScore = Math.max(0, Math.min(1, score));
        if (reasons.length === 0) reasons.push(cl('alt.balanced', locale));

        return {
          ...alt,
          rankScore: Math.round(finalScore * 100) / 100,
          rankReasons: reasons,
        };
      })
      .sort((a, b) => {
        // V5.0 P2.2: source priority from ALTERNATIVE_PARAMS
        const sourcePriority = (s?: string) =>
          s === 'engine'
            ? AP.sourcePriorityEngine
            : s === 'static'
              ? AP.sourcePriorityStatic
              : AP.sourcePrioritySubstitution;
        const srcDiff = sourcePriority(b.source) - sourcePriority(a.source);
        if (srcDiff !== 0) return srcDiff;
        return (b.rankScore ?? 0) - (a.rankScore ?? 0);
      });
  }
}
