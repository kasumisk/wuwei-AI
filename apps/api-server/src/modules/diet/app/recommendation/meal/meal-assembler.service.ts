import { Injectable, Logger } from '@nestjs/common';
import { FoodLibrary } from '../../../../food/food.types';
import {
  ScoredFood,
  MealTarget,
  MealRecommendation,
  FoodFeedbackStats,
} from '../types/recommendation.types';
import { ScoredRecipe } from '../../../../recipe/recipe.types';
import { AssemblyPolicyConfig } from '../../../../strategy/strategy.types';
import { t } from '../utils/i18n-messages';
import { ExplanationGeneratorService } from '../explanation/explanation-generator.service';
import { PreferenceProfileService } from '../profile/preference-profile.service';
import { ScoringConfigService } from '../context/scoring-config.service';

/** V7.8 P2-B: food_form 排序优先级（数值越大越优先） */
const FOOD_FORM_PRIORITY: Record<string, number> = {
  dish: 2,
  semi_prepared: 1,
  ingredient: 0,
};

@Injectable()
export class MealAssemblerService {
  private readonly logger = new Logger(MealAssemblerService.name);

  constructor(
    private readonly explanationGenerator: ExplanationGeneratorService,
    private readonly preferenceProfileService: PreferenceProfileService,
    private readonly scoringConfigService: ScoringConfigService,
  ) {}

  /**
   * 多维多样性控制
   * - 排除最近吃过的食物名
   * - 限制同一 category 最多2个
   * - 限制同一 mainIngredient 最多1个（避免"鸡胸沙拉"+"白切鸡"同时出现）
   * - 限制同一 foodGroup 最多2个（确保食物组均衡）
   *
   * V7.8 P2-B: dish 优先 — 输入按 food_form 优先级预排序，
   * 同等约束条件下优先选择 dish > semi_prepared > ingredient
   */
  diversify(
    foods: ScoredFood[],
    recentFoodNames: string[],
    limit: number = 3,
  ): ScoredFood[] {
    // V7.8 P2-B: 按 food_form 优先级 + 原始分数排序
    const sorted = [...foods].sort((a, b) => {
      const formA = FOOD_FORM_PRIORITY[a.food.foodForm ?? 'ingredient'] ?? 0;
      const formB = FOOD_FORM_PRIORITY[b.food.foodForm ?? 'ingredient'] ?? 0;
      if (formA !== formB) return formB - formA; // dish 优先
      return b.score - a.score;
    });
    const result: ScoredFood[] = [];
    const usedCategories = new Set<string>();
    const usedIngredients = new Set<string>();
    const usedFoodGroups = new Map<string, number>();

    for (const sf of sorted) {
      if (result.length >= limit) break;
      if (recentFoodNames.includes(sf.food.name)) continue;

      // category 级别：同分类最多2个
      if (
        usedCategories.has(sf.food.category) &&
        result.filter((r) => r.food.category === sf.food.category).length >= 2
      )
        continue;

      // mainIngredient 级别：同主料最多1个
      const ingredient = sf.food.mainIngredient || '';
      if (ingredient && usedIngredients.has(ingredient)) continue;

      // foodGroup 级别：同食物组最多2个
      const group = sf.food.foodGroup || '';
      if (group && (usedFoodGroups.get(group) || 0) >= 2) continue;

      result.push(sf);
      usedCategories.add(sf.food.category);
      if (ingredient) usedIngredients.add(ingredient);
      if (group)
        usedFoodGroups.set(group, (usedFoodGroups.get(group) || 0) + 1);
    }

    // 兜底：如果约束太严导致选不够，放宽约束补足
    if (result.length < limit) {
      for (const sf of sorted) {
        if (result.length >= limit) break;
        if (!result.includes(sf)) result.push(sf);
      }
    }

    return result;
  }

  /** 相似度惩罚多样化（用于每日计划） */
  diversifyWithPenalty(
    scored: ScoredFood[],
    excludeNames: string[],
    limit: number = 3,
  ): ScoredFood[] {
    const candidates = scored.filter(
      (sf) => !excludeNames.includes(sf.food.name),
    );
    const result: ScoredFood[] = [];

    const remaining = [...candidates];
    while (result.length < limit && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;

      remaining.forEach((item, i) => {
        let penalty = 0;
        for (const selected of result) {
          penalty +=
            this.similarity(item.food, selected.food) *
            this.scoringConfigService.getTuning().diversitySimilarityPenalty;
        }
        const finalScore = item.score - penalty;
        if (finalScore > bestScore) {
          bestScore = finalScore;
          bestIdx = i;
        }
      });

      result.push(remaining[bestIdx]);
      remaining.splice(bestIdx, 1);
    }

    return result;
  }

  /**
   * Thompson Sampling 探索（V6 2.6: 自适应探索范围）
   *
   * V7.2 P2-G: 采样逻辑委托给 PreferenceProfileService.sampleBeta()，
   * 消除了与 PreferenceProfileService 之间的代码重复。
   * Phase 3 (P3-A) ScoringChain 集成后此方法可完全移除。
   *
   * 每个食物从 Beta(α, β) 分布中采样一个探索系数 ∈ [0, 1]，
   * 映射到 [minMult, maxMult] 后乘以原始分数，再排序。
   *
   * @param scored 已评分的食物列表
   * @param feedbackStats 每个食物名的反馈统计 {accepted, rejected}
   * @param explorationRange 探索系数映射范围 [min, max]（默认 [0.5, 1.5]）
   */
  addExploration(
    scored: ScoredFood[],
    feedbackStats?: Record<string, FoodFeedbackStats>,
    explorationRange?: [number, number],
  ): ScoredFood[] {
    const [minMult, maxMult] = explorationRange ?? [0.5, 1.5];
    return scored
      .map((sf) => {
        const stats = feedbackStats?.[sf.food.name];
        // Beta 先验: α = accepted + 1, β = rejected + 1
        const alpha = (stats?.accepted ?? 0) + 1;
        const beta = (stats?.rejected ?? 0) + 1;
        // 委托给 PreferenceProfileService 的采样实现
        const sample = this.preferenceProfileService.sampleBeta(alpha, beta);
        const explorationMultiplier = minMult + sample * (maxMult - minMult);
        return {
          ...sf,
          score: sf.score * explorationMultiplier,
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * 份量调整：缩放到目标预算，支持边界裁剪 + 步进量化
   *
   * @param portionTendency V6.2 Phase 2.14: 用户份量倾向（'small'|'normal'|'large'），
   *                        来自行为画像 user_behavior_profiles.portion_tendency。
   *                        'small' → 份量系数 ×0.9（偏小 10%）
   *                        'large' → 份量系数 ×1.1（偏大 10%）
   *                        'normal' / undefined → 不调整
   */
  adjustPortions(
    picks: ScoredFood[],
    budget: number,
    portionTendency?: string | null,
  ): ScoredFood[] {
    const totalCal = picks.reduce((s, p) => s + p.servingCalories, 0);
    if (totalCal <= 0) return picks;

    let globalRatio = budget / totalCal;

    // V6.2 Phase 2.14: 根据用户份量倾向微调缩放比
    if (portionTendency === 'small') {
      globalRatio *= 0.9;
    } else if (portionTendency === 'large') {
      globalRatio *= 1.1;
    }

    if (Math.abs(globalRatio - 1) < 0.05) return picks;

    // 第一轮: 逐个食物计算最佳缩放比，受边界约束
    const adjusted = picks.map((p) => {
      const portions = p.food.commonPortions || [];
      let minRatio = 0.5;
      let maxRatio = 2.0;

      if (portions.length > 0) {
        const standardG = p.food.standardServingG || 100;
        const portionGrams = portions.map((pt) => pt.grams);
        const minG = Math.min(...portionGrams);
        const maxG = Math.max(...portionGrams);
        minRatio = Math.max(0.5, minG / standardG);
        maxRatio = Math.min(2.0, maxG / standardG);
      }

      // 裁剪到边界范围
      const clampedRatio = Math.max(minRatio, Math.min(maxRatio, globalRatio));
      // 步进量化到 0.25 步长（对应"半份、3/4份、1份、1.25份..."）
      const quantizedRatio = Math.round(clampedRatio * 4) / 4;
      // 量化后再裁剪一次确保不越界
      const finalRatio = Math.max(minRatio, Math.min(maxRatio, quantizedRatio));

      return {
        ...p,
        servingCalories: Math.round(p.servingCalories * finalRatio),
        servingProtein: Math.round(p.servingProtein * finalRatio),
        servingFat: Math.round(p.servingFat * finalRatio),
        servingCarbs: Math.round(p.servingCarbs * finalRatio),
      };
    });

    // 第二轮: 如果总热量偏差 >15%，找余量最大的食物微调
    const adjustedTotal = adjusted.reduce((s, p) => s + p.servingCalories, 0);
    const deviation = (adjustedTotal - budget) / budget;

    if (Math.abs(deviation) > 0.15 && adjusted.length > 1) {
      // 找到可调整幅度最大的食物进行二次微调
      let bestIdx = 0;
      let bestSlack = 0;

      for (let i = 0; i < adjusted.length; i++) {
        const original = picks[i].servingCalories;
        const current = adjusted[i].servingCalories;
        const portions = picks[i].food.commonPortions || [];
        const standardG = picks[i].food.standardServingG || 100;

        let maxR = 2.0;
        let minR = 0.5;
        if (portions.length > 0) {
          const portionGrams = portions.map((pt) => pt.grams);
          minR = Math.max(0.5, Math.min(...portionGrams) / standardG);
          maxR = Math.min(2.0, Math.max(...portionGrams) / standardG);
        }

        const slack =
          deviation > 0
            ? current - original * minR // 可减少的空间
            : original * maxR - current; // 可增加的空间

        if (slack > bestSlack) {
          bestSlack = slack;
          bestIdx = i;
        }
      }

      // 微调该食物的热量来补偿偏差
      const calDiff = adjustedTotal - budget;
      const maxAdj = Math.min(Math.abs(calDiff), bestSlack);
      const adj = calDiff > 0 ? -maxAdj : maxAdj;

      if (adjusted[bestIdx].servingCalories > 0) {
        const adjRatio =
          (adjusted[bestIdx].servingCalories + adj) /
          adjusted[bestIdx].servingCalories;
        adjusted[bestIdx] = {
          ...adjusted[bestIdx],
          servingCalories: Math.round(
            adjusted[bestIdx].servingCalories * adjRatio,
          ),
          servingProtein: Math.round(
            adjusted[bestIdx].servingProtein * adjRatio,
          ),
          servingFat: Math.round(adjusted[bestIdx].servingFat * adjRatio),
          servingCarbs: Math.round(adjusted[bestIdx].servingCarbs * adjRatio),
        };
      }
    }

    return adjusted;
  }

  /** 聚合推荐结果 */
  aggregateMealResult(
    picks: ScoredFood[],
    tip: string,
    goalType?: string,
    userProfile?:
      | import('../types/recommendation.types').UserProfileConstraints
      | null,
  ): MealRecommendation {
    const totalCalories = picks.reduce((s, p) => s + p.servingCalories, 0);
    const totalProtein = picks.reduce((s, p) => s + p.servingProtein, 0);
    const totalFat = picks.reduce((s, p) => s + p.servingFat, 0);
    const totalCarbs = picks.reduce((s, p) => s + p.servingCarbs, 0);
    const mealExplanation = this.explanationGenerator.explainMealComposition(
      picks,
      userProfile,
      goalType,
    );
    const displayText = picks
      .map((p) =>
        t('display.foodItem', {
          name: p.food.name,
          serving:
            p.food.standardServingDesc || `${p.food.standardServingG || 100}g`,
          calories: p.servingCalories,
        }),
      )
      .join(' + ');
    return {
      foods: picks,
      totalCalories,
      totalProtein,
      totalFat,
      totalCarbs,
      displayText,
      tip,
      mealExplanation: mealExplanation ?? undefined,
      // V7.9 P3-2: 整餐数据可信度（基于各食物 confidence 的热量加权平均）
      dataConfidence: this.computeMealDataConfidence(picks, totalCalories),
    };
  }

  // ─── V7.9 Phase 3-2: 整餐数据可信度 ───

  /**
   * 计算整餐的数据可信度
   *
   * 基于每道食物的 confidence 字段，按热量占比加权平均。
   * 热量占比高的食物对整餐可信度影响更大。
   * - confidence 来自食物库数据源优先级（USDA=100, AI=40 等）
   * - 归一化到 0-1 范围（原始值 0-100）
   *
   * @param picks 选中的食物列表
   * @param totalCalories 整餐总热量
   * @returns 0-1 之间的可信度值
   */
  private computeMealDataConfidence(
    picks: ScoredFood[],
    totalCalories: number,
  ): number {
    if (picks.length === 0 || totalCalories <= 0) return 0;

    let weightedSum = 0;
    let totalWeight = 0;

    for (const pick of picks) {
      // 热量占比作为权重
      const weight = Math.max(pick.servingCalories, 1);
      // confidence 原始值 0-100，归一化到 0-1
      const confidence = Math.min((pick.food.confidence ?? 50) / 100, 1);
      weightedSum += confidence * weight;
      totalWeight += weight;
    }

    return totalWeight > 0
      ? Math.round((weightedSum / totalWeight) * 100) / 100
      : 0;
  }

  // ==================== V6.3 P2-8: 菜谱组装模式 ====================

  /**
   * 菜谱优先组装
   *
   * 流程:
   * 1. 从 scoredRecipes 中选择评分最高的 1-2 道菜谱作为主菜
   * 2. 计算菜谱的总营养（热量、蛋白质、脂肪、碳水）
   * 3. 计算与目标的营养缺口
   * 4. 用单品食物候选池补充缺口（如需要额外蔬菜、主食）
   * 5. 降级: 如果没有可用菜谱或菜谱池为空，回退到原有食物组合模式
   *
   * @param scoredRecipes 已评分的菜谱（降序排列）
   * @param foodCandidates 单品食物候选池（已评分）
   * @param target 本餐营养目标
   * @param assembly 组装策略配置
   * @param portionTendency 用户份量倾向
   * @returns 组装后的 ScoredFood[] 或 null（表示应降级到原有模式）
   */
  assembleMealWithRecipes(
    scoredRecipes: ScoredRecipe[],
    foodCandidates: ScoredFood[],
    target: MealTarget,
    assembly?: AssemblyPolicyConfig,
    portionTendency?: string | null,
  ): ScoredFood[] | null {
    if (!assembly?.preferRecipe || scoredRecipes.length === 0) {
      return null; // 降级到原有食物组合模式
    }

    return this.assembleFromRecipes(
      scoredRecipes,
      foodCandidates,
      target,
      portionTendency,
    );
  }

  /**
   * 从菜谱构建餐次
   *
   * 选择 1-2 道主菜谱 → 将菜谱营养转为 ScoredFood 结构 →
   * 计算缺口 → 用单品食物补充 → 份量调整
   */
  private assembleFromRecipes(
    scoredRecipes: ScoredRecipe[],
    foodCandidates: ScoredFood[],
    target: MealTarget,
    portionTendency?: string | null,
  ): ScoredFood[] {
    const result: ScoredFood[] = [];
    let remainingCalories = target.calories;
    let remainingProtein = target.protein;

    // 选 1-2 道菜谱（贪心：依次选评分最高的，直到热量超 80% 目标或 2 道）
    const maxRecipes = 2;
    const usedRecipeIds = new Set<string>();

    for (const sr of scoredRecipes) {
      if (result.length >= maxRecipes) break;
      if (usedRecipeIds.has(sr.recipe.id)) continue;

      const recipeCal = sr.recipe.caloriesPerServing ?? 0;
      // 跳过热量为 0 或者单道菜谱就超出目标 120% 的
      if (recipeCal <= 0 || recipeCal > target.calories * 1.2) continue;

      // 如果加上这道菜谱会让热量超标太多（>110%），跳过
      const totalAfter = target.calories - remainingCalories + recipeCal;
      if (totalAfter > target.calories * 1.1 && result.length > 0) continue;

      // 将菜谱转为 ScoredFood 结构
      const recipeScoredFood = this.recipeToScoredFood(sr);
      result.push(recipeScoredFood);
      usedRecipeIds.add(sr.recipe.id);

      remainingCalories -= recipeCal;
      remainingProtein -= sr.recipe.proteinPerServing ?? 0;
    }

    // 如果没有选中任何菜谱，降级返回 null（但此方法被 assembleFromRecipes 内部调用，
    // 上层已检查，此处兜底用空数组 + 补充食物）
    if (result.length === 0) {
      // 直接从食物候选池选择
      return this.adjustPortions(
        this.diversify(foodCandidates, [], 3),
        target.calories,
        portionTendency,
      );
    }

    // 计算缺口：如果剩余热量 > 目标的 15%，用单品食物补充
    if (
      remainingCalories > target.calories * 0.15 &&
      foodCandidates.length > 0
    ) {
      // 从候选池中补充 1-2 个低热量食物（蔬菜/主食类）
      const maxSupplements = Math.min(2, Math.ceil(remainingCalories / 150));
      const supplements = this.selectSupplements(
        foodCandidates,
        remainingCalories,
        remainingProtein,
        maxSupplements,
      );
      result.push(...supplements);
    }

    return this.adjustPortions(result, target.calories, portionTendency);
  }

  /**
   * 将 ScoredRecipe 转换为 ScoredFood 结构
   *
   * 菜谱没有真实的 FoodLibrary 实体，这里构造一个虚拟的 FoodLibrary 对象，
   * 包含菜谱的基本信息和营养数据。只填充推荐流程需要的字段。
   */
  private recipeToScoredFood(sr: ScoredRecipe): ScoredFood {
    const recipe = sr.recipe;
    const virtualFood: FoodLibrary = {
      id: recipe.id,
      code: `recipe_${recipe.id.slice(0, 8)}`,
      name: recipe.name,
      status: 'active',
      category: recipe.cuisine || t('meal.recipe.categoryFallback'),
      calories: recipe.caloriesPerServing ?? 0,
      protein: recipe.proteinPerServing ?? 0,
      fat: recipe.fatPerServing ?? 0,
      carbs: recipe.carbsPerServing ?? 0,
      fiber: recipe.fiberPerServing ?? 0,
      isProcessed: false,
      isFried: false,
      processingLevel: 0,
      allergens: [],
      mealTypes: [],
      tags: recipe.tags ?? [],
      compatibility: {},
      standardServingG: 100,
      standardServingDesc: t('meal.recipe.servings', {
        servings: String(recipe.servings),
      }),
      commonPortions: [],
      primarySource: 'recipe',
      dataVersion: 1,
      confidence: 1,
      isVerified: false,
      searchWeight: 0,
      popularity: recipe.usageCount ?? 0,
      commonalityScore: 60, // 菜谱默认中等大众化
      createdAt: recipe.createdAt,
      updatedAt: recipe.updatedAt,
    };

    return {
      food: virtualFood,
      score: sr.score,
      servingCalories: recipe.caloriesPerServing ?? 0,
      servingProtein: recipe.proteinPerServing ?? 0,
      servingFat: recipe.fatPerServing ?? 0,
      servingCarbs: recipe.carbsPerServing ?? 0,
      servingFiber: recipe.fiberPerServing ?? 0,
      servingGL: 0,
    };
  }

  /**
   * 从候选池中选择补充食物（填补菜谱的营养缺口）
   *
   * 优先选择蔬菜类和主食类，避免与菜谱中食材重复
   * V7.8 P2-B: dish/semi_prepared 优先于 ingredient
   */
  private selectSupplements(
    candidates: ScoredFood[],
    remainingCal: number,
    remainingProtein: number,
    maxCount: number,
  ): ScoredFood[] {
    // 优先低热量的蔬菜/谷物类，V7.8: dish 形态优先
    const sorted = [...candidates].sort((a, b) => {
      // V7.8 P2-B: dish/semi_prepared 优先于 ingredient
      const formA = FOOD_FORM_PRIORITY[a.food.foodForm ?? 'ingredient'] ?? 0;
      const formB = FOOD_FORM_PRIORITY[b.food.foodForm ?? 'ingredient'] ?? 0;
      if (formA !== formB) return formB - formA;

      // 蔬菜类优先（热量缺口主要靠蔬菜/主食补充）
      const aIsVeg =
        a.food.category?.includes(t('meal.recipe.vegetable')) ||
        a.food.category?.includes('veggie')
          ? 1
          : 0;
      const bIsVeg =
        b.food.category?.includes(t('meal.recipe.vegetable')) ||
        b.food.category?.includes('veggie')
          ? 1
          : 0;
      if (aIsVeg !== bIsVeg) return bIsVeg - aIsVeg;

      // 然后按评分排序
      return b.score - a.score;
    });

    const result: ScoredFood[] = [];
    let calBudget = remainingCal;

    for (const sf of sorted) {
      if (result.length >= maxCount) break;
      if (sf.servingCalories <= 0) continue;
      if (sf.servingCalories > calBudget * 1.3) continue; // 单品不超过剩余预算的 130%

      result.push(sf);
      calBudget -= sf.servingCalories;
    }

    return result;
  }

  /** 构建推荐提示 (V4: i18n) */
  buildTip(
    mealType: string,
    goalType: string,
    target: MealTarget,
    actualCal: number,
  ): string {
    const tips: string[] = [];

    if (actualCal > target.calories * 1.1) {
      tips.push(t('tip.caloriesOver'));
    } else if (actualCal < target.calories * 0.7) {
      tips.push(t('tip.caloriesUnder'));
    }

    const goalTipKey = `tip.goal.${goalType}`;
    tips.push(
      t(goalTipKey) !== goalTipKey ? t(goalTipKey) : t('tip.goal.health'),
    );

    const mealTipKey = `tip.meal.${mealType}`;
    const mealTip = t(mealTipKey);
    if (mealTip !== mealTipKey) tips.push(mealTip);

    return tips.filter(Boolean).join('；');
  }

  /** 食物相似度计算 */
  similarity(a: FoodLibrary, b: FoodLibrary): number {
    const sw = this.scoringConfigService.getTuning().similarityWeights;
    let score = 0;
    if (a.category === b.category) score += sw.category ?? 0.3;

    const mainA = a.mainIngredient || '';
    const mainB = b.mainIngredient || '';
    if (mainA && mainB && mainA === mainB) score += sw.mainIngredient ?? 0.5;

    const subA = a.subCategory || '';
    const subB = b.subCategory || '';
    if (subA && subB && subA === subB) score += sw.subCategory ?? 0.2;

    const tagsA = a.tags || [];
    const tagsB = b.tags || [];
    score +=
      tagsA.filter((t) => tagsB.includes(t)).length * (sw.tagOverlap ?? 0.05);

    return Math.min(score, 1);
  }

  /**
   * V4 Phase 2.7 — 食物搭配关系加分/减分 (E5)
   *
   * 利用 FoodLibrary.compatibility 的 goodWith / badWith 数据，
   * 对候选食物与已选食物的搭配关系进行评分调整。
   *
   * 匹配逻辑：goodWith/badWith 中的字符串可以匹配食物名或食物分类。
   *
   * @param candidate  候选食物
   * @param picks      已选食物列表
   * @returns 搭配加分 (正=互补/推荐搭配, 负=不宜同食)
   *          典型范围: [-0.15, +0.15]
   */
  compatibilityBonus(candidate: FoodLibrary, picks: FoodLibrary[]): number {
    if (picks.length === 0) return 0;

    const tuning = this.scoringConfigService.getTuning();
    let bonus = 0;
    const candidateCompat = candidate.compatibility || {};
    const candidateGoodWith: string[] = candidateCompat['goodWith'] || [];
    const candidateBadWith: string[] = candidateCompat['badWith'] || [];

    for (const pick of picks) {
      const pickCompat = pick.compatibility || {};
      const pickGoodWith: string[] = pickCompat['goodWith'] || [];
      const pickBadWith: string[] = pickCompat['badWith'] || [];

      // 正向：候选的 goodWith 匹配已选的名字/分类
      if (
        candidateGoodWith.some(
          (g) =>
            g === pick.name || g === pick.category || g === pick.mainIngredient,
        )
      ) {
        bonus += tuning.compatibilityGoodBonus;
      }

      // 正向：已选的 goodWith 匹配候选的名字/分类
      if (
        pickGoodWith.some(
          (g) =>
            g === candidate.name ||
            g === candidate.category ||
            g === candidate.mainIngredient,
        )
      ) {
        bonus += tuning.compatibilityGoodBonus;
      }

      // 负向：候选的 badWith 匹配已选
      if (
        candidateBadWith.some(
          (b) =>
            b === pick.name || b === pick.category || b === pick.mainIngredient,
        )
      ) {
        bonus += tuning.compatibilityBadPenalty;
      }

      // 负向：已选的 badWith 匹配候选
      if (
        pickBadWith.some(
          (b) =>
            b === candidate.name ||
            b === candidate.category ||
            b === candidate.mainIngredient,
        )
      ) {
        bonus += tuning.compatibilityBadPenalty;
      }
    }

    // 裁剪到合理范围
    return Math.max(
      tuning.compatibilityClampMin,
      Math.min(tuning.compatibilityClampMax, bonus),
    );
  }
}
