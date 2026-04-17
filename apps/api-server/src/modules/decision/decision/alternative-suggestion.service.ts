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
} from '../types/analysis-result.types';
import { NutritionScoreBreakdown } from '../../diet/app/services/nutrition-score.service';
import {
  AlternativeRule,
  CATEGORY_ALTERNATIVE_RULES,
  GOAL_ALTERNATIVE_RULES,
  resolveAlternatives,
} from '../config/alternative-food-rules';
import { SubstitutionService } from '../../diet/app/recommendation/filter/substitution.service';
import type {
  UserProfileConstraints,
  UserPreferenceProfile,
} from '../../diet/app/recommendation/types/recommendation.types';
import { FoodLibraryService } from '../../food/app/services/food-library.service';
import { t, Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import { DecisionFoodItem, UserContext } from './food-decision.service';
import { RecommendationEngineService } from '../../diet/app/services/recommendation-engine.service';
import { MealRecommendation } from '../../diet/app/recommendation/types/recommendation.types';

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
}

export interface AlternativeInput {
  foods: DecisionFoodItem[];
  totals: NutritionTotals;
  userContext: UserContext;
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
    } = input;

    // V2.2: 从问题列表提取替代方案约束
    const constraints = this.extractConstraintsFromIssues(issues, ctx);

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
        );
        if (engineAlternatives.length > 0) {
          results = engineAlternatives.slice(0, 5);
        }
      } catch (err) {
        this.logger.warn(
          `推荐引擎替代方案获取失败，降级到二级替代路径: ${(err as Error).message}`,
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
        );
        if (substitutionAlternatives.length > 0) {
          results = substitutionAlternatives.slice(0, 5);
        }
      } catch (err) {
        this.logger.warn(
          `SubstitutionService 替代方案获取失败，降级静态规则: ${(err as Error).message}`,
        );
      }
    }

    // 3. 静态规则 fallback
    if (results.length === 0) {
      results = this.generateStaticAlternatives(foods, ctx, locale);
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
   * 构建替代方案与原始食物的定量对比
   * 当缺少替代食物的营养数据时返回 undefined
   */
  private buildComparison(
    _alt: FoodAlternative,
    _avgCalories: number,
    _avgProtein: number,
  ): AlternativeComparison | undefined {
    // 静态规则生成的替代方案没有真实营养数据，无法计算定量对比
    return undefined;
  }

  // ==================== 推荐引擎替代 ====================

  private async getEngineAlternatives(
    foods: DecisionFoodItem[],
    userId: string,
    ctx: UserContext,
    userConstraints?: UserProfileConstraints,
    _preferenceProfile?: UserPreferenceProfile,
    constraints?: AlternativeConstraints,
  ): Promise<FoodAlternative[]> {
    const currentMealCalories = foods.reduce((sum, food) => sum + food.calories, 0);
    const currentMealProtein = foods.reduce((sum, food) => sum + food.protein, 0);
    const scenarioRecommendations = await this.recommendationEngineService.recommendByScenario(
      userId,
      ctx.mealType || 'snack',
      ctx.goalType || 'health',
      {
        calories: Math.max(0, ctx.todayCalories || 0),
        protein: Math.max(0, ctx.todayProtein || 0),
      },
      {
        calories: constraints?.maxCalories || Math.max(currentMealCalories, 150),
        protein: constraints?.preferHighProtein
          ? Math.max(currentMealProtein + 8, 20)
          : Math.max(currentMealProtein, 12),
        fat: constraints?.preferLowFat ? Math.min(currentMealCalories * 0.2, 12) : Math.max(10, foods.reduce((sum, food) => sum + food.fat, 0)),
        carbs: constraints?.preferLowCarb ? 20 : Math.max(20, foods.reduce((sum, food) => sum + food.carbs, 0)),
      },
      {
        calories: Math.max(ctx.goalCalories || 0, currentMealCalories),
        protein: Math.max(ctx.goalProtein || 0, currentMealProtein),
      },
      userConstraints || {
        allergens: ctx.allergens,
        dietaryRestrictions: ctx.dietaryRestrictions,
        healthConditions: ctx.healthConditions,
      },
    );

    const scenarioMap: Array<['takeout' | 'convenience' | 'homeCook', MealRecommendation]> = [
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
          reason: this.explainEngineCandidate(candidate, currentMealCalories, currentMealProtein, constraints, scenarioType),
          comparison: {
            caloriesDiff: Math.round(candidate.servingCalories - currentMealCalories),
            proteinDiff: Math.round(candidate.servingProtein - currentMealProtein),
            scoreDiff: typeof candidate.score === 'number' ? Math.round(candidate.score * 100) : undefined,
          },
          scenarioType,
        });
      }
    }

    return this.attachRankScores(alternatives.slice(0, 5), ctx);
  }

  private explainEngineCandidate(
    candidate: any,
    currentMealCalories: number,
    currentMealProtein: number,
    constraints?: AlternativeConstraints,
    scenarioType?: 'takeout' | 'convenience' | 'homeCook',
  ): string {
    if (constraints?.preferLowCalorie && candidate.servingCalories < currentMealCalories) {
      return t('decision.alt.lowerCal', {
        newCal: String(Math.round(candidate.servingCalories)),
        oldCal: String(Math.round(currentMealCalories)),
      });
    }

    if (constraints?.preferHighProtein && candidate.servingProtein > currentMealProtein) {
      return t('decision.alt.higherProtein', {
        newPro: String(Math.round(candidate.servingProtein)),
        oldPro: String(Math.round(currentMealProtein)),
      });
    }

    if (scenarioType === 'convenience') {
      return t('decision.alt.similar');
    }

    return t('decision.alt.balanced', {
      score: String(Math.round((candidate.score || 0) * 100)),
    });
  }

  private async getSubstitutionAlternatives(
    foods: DecisionFoodItem[],
    userId: string,
    ctx: UserContext,
    userConstraints?: UserProfileConstraints,
    preferenceProfile?: UserPreferenceProfile,
    constraints?: AlternativeConstraints,
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
          reason = t('decision.alt.lowerCal', {
            newCal: String(Math.round(c.servingCalories)),
            oldCal: String(Math.round(food.calories)),
          });
        } else if (
          constraints?.preferHighProtein &&
          c.servingProtein > food.protein * 1.1
        ) {
          reason = t('decision.alt.higherProtein', {
            newPro: String(Math.round(c.servingProtein)),
            oldPro: String(Math.round(food.protein)),
          });
        } else if (
          ctx.goalType === 'fat_loss' &&
          c.servingCalories < food.calories * 0.7
        ) {
          reason = t('decision.alt.lowerCal', {
            newCal: String(Math.round(c.servingCalories)),
            oldCal: String(Math.round(food.calories)),
          });
        } else if (
          ctx.goalType === 'muscle_gain' &&
          c.servingProtein > food.protein * 1.2
        ) {
          reason = t('decision.alt.higherProtein', {
            newPro: String(Math.round(c.servingProtein)),
            oldPro: String(Math.round(food.protein)),
          });
        } else if (c.substituteScore > 0.7) {
          reason = t('decision.alt.balanced', {
            score: String(Math.round(c.substituteScore * 100)),
          });
        } else {
          reason = t('decision.alt.similar');
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
      `推荐引擎替代方案: count=${alternatives.length}, latency=${latencyMs}ms, userId=${userId}`,
    );

    return this.attachRankScores(alternatives, ctx);
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
    ctx?: UserContext,
  ): AlternativeConstraints {
    const constraints: AlternativeConstraints = {};

    if (!issues || issues.length === 0) return constraints;

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

    return constraints;
  }

  // ==================== 静态规则替代 ====================

  private generateStaticAlternatives(
    foods: DecisionFoodItem[],
    ctx: UserContext,
    locale?: Locale,
  ): FoodAlternative[] {
    const totalProtein = foods.reduce((s, f) => s + f.protein, 0);
    const totalCalories = foods.reduce((s, f) => s + f.calories, 0);
    const totalCarbs = foods.reduce((s, f) => s + f.carbs, 0);
    const totalFat = foods.reduce((s, f) => s + f.fat, 0);

    const matched: FoodAlternative[] = [];
    const seenNames = new Set<string>();

    const addAlternatives = (alts: FoodAlternative[]) => {
      for (const alt of alts) {
        if (!seenNames.has(alt.name)) {
          seenNames.add(alt.name);
          matched.push({ ...alt, source: alt.source || 'static' });
        }
      }
    };

    // V1.9: resolve i18n alternatives by locale
    const categoryRules = resolveAlternatives(
      CATEGORY_ALTERNATIVE_RULES,
      locale,
    );
    const goalRules = resolveAlternatives(GOAL_ALTERNATIVE_RULES, locale);

    for (const food of foods) {
      for (const rule of categoryRules) {
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
          addAlternatives(rule.alternatives);
        }
      }
    }

    for (const rule of goalRules) {
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
        addAlternatives(rule.alternatives);
      }
    }

    const remaining = ctx.remainingCalories - totalCalories;
    if (remaining < 0 && matched.length > 0) {
      matched[0] = {
        ...matched[0],
        reason: `${matched[0].reason}${t('decision.alt.saveBudget', { amount: String(Math.abs(Math.round(remaining))) })}`,
      };
    }

    const hour = ctx.localHour ?? 0;
    if (hour >= 21 && totalCalories > 200) {
      addAlternatives([
        {
          name: t('decision.alt.lateNightMilkName', {}, locale) || '温牛奶',
          reason: t('decision.alt.lateNightMilk', {}, locale),
        },
        {
          name: t('decision.alt.lateNightFruitName', {}, locale) || '小份水果',
          reason: t('decision.alt.lateNightFruit', {}, locale),
        },
      ]);
    }

    return matched.slice(0, 5);
  }

  private matchesAlternativeRule(
    rule: AlternativeRule,
    food: DecisionFoodItem,
    ctx: UserContext,
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
    if (trigger.goals?.length && !trigger.goals.includes(ctx.goalType || 'health'))
      return false;
    if (trigger.minCalories != null && food.calories < trigger.minCalories)
      return false;
    if (trigger.minCarbs != null && food.carbs < trigger.minCarbs) return false;
    if (trigger.minFat != null && food.fat < trigger.minFat) return false;
    return true;
  }

  private matchesGoalRule(
    rule: AlternativeRule,
    ctx: UserContext,
    totalCalories: number,
    totalProtein: number,
    totalCarbs: number,
    totalFat: number,
  ): boolean {
    const trigger = rule.trigger;
    if (trigger.goals?.length && !trigger.goals.includes(ctx.goalType || 'health'))
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
   *
   * rankScore 越高 → 越推荐
   * 评分维度:
   * - 热量差（越小/负越好，尤其 fat_loss/maintenance）
   * - 蛋白质差（越大越好，尤其 muscle_gain）
   * - substituteScore（来自引擎，直接加权）
   */
  private attachRankScores(
    alternatives: FoodAlternative[],
    ctx: UnifiedUserContext,
  ): FoodAlternative[] {
    if (!alternatives.length) return alternatives;

    return alternatives.map((alt) => {
      const comp = alt.comparison;
      const calDiff = comp?.caloriesDiff ?? 0;
      const prosDiff = comp?.proteinDiff ?? 0;
      const rawScore = typeof alt.score === 'number' ? alt.score : 0.5;

      const reasons: string[] = [];
      let score = rawScore * 0.4; // base 40% from engine score

      // 热量维度（最高 35%）
      const calScore = Math.max(-1, Math.min(1, -calDiff / 200)); // -200kcal diff = +1
      const calWeight = ctx.goalType === 'fat_loss' ? 0.35 : 0.15;
      score += calScore * calWeight;
      if (calDiff < -50) reasons.push(`热量少 ${Math.abs(calDiff)}kcal`);
      else if (calDiff > 50) reasons.push(`热量多 ${calDiff}kcal`);

      // 蛋白质维度（最高 25%）
      const prosScore = Math.max(-1, Math.min(1, prosDiff / 20)); // +20g = +1
      const prosWeight = ctx.goalType === 'muscle_gain' ? 0.25 : 0.10;
      score += prosScore * prosWeight;
      if (prosDiff > 5) reasons.push(`蛋白质+${prosDiff}g`);
      else if (prosDiff < -5) reasons.push(`蛋白质-${Math.abs(prosDiff)}g`);

      // 归一化到 [0, 1]
      const finalScore = Math.max(0, Math.min(1, score));
      if (reasons.length === 0) reasons.push('综合均衡');

      return {
        ...alt,
        rankScore: Math.round(finalScore * 100) / 100,
        rankReasons: reasons,
      };
    }).sort((a, b) => (b.rankScore ?? 0) - (a.rankScore ?? 0));
  }
}
