import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../entities/food-library.entity';
import { FoodRecord } from '../../entities/food-record.entity';
import { RecommendationFeedback } from '../../entities/recommendation-feedback.entity';
import { GoalType } from './nutrition-score.service';

// ==================== 类型 ====================

export interface MealTarget {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
}

export interface Constraint {
  includeTags: string[];
  excludeTags: string[];
  maxCalories: number;
  minProtein: number;
}

export interface ScoredFood {
  food: FoodLibrary;
  score: number;
  /** 按标准份量计算的营养 */
  servingCalories: number;
  servingProtein: number;
  servingFat: number;
  servingCarbs: number;
}

export interface MealRecommendation {
  foods: ScoredFood[];
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  displayText: string;
  tip: string;
}

// ==================== 评分权重 ====================

const SCORE_WEIGHTS: Record<GoalType, number[]> = {
  //                    [cal,  protein, carbs, fat,  quality, satiety]
  fat_loss:            [0.30, 0.25,    0.15,  0.10, 0.10,   0.10],
  muscle_gain:         [0.25, 0.30,    0.20,  0.10, 0.10,   0.05],
  health:              [0.15, 0.10,    0.10,  0.10, 0.30,   0.25],
  habit:               [0.20, 0.15,    0.10,  0.10, 0.25,   0.20],
};

// ==================== 食物品质/饱腹分推导（对齐 FoodCategory 英文枚举） ====================

const CATEGORY_QUALITY: Record<string, number> = {
  veggie: 8, fruit: 7, dairy: 7, protein: 6,
  grain: 5, composite: 4, snack: 2, beverage: 3,
  fat: 3, condiment: 3,
};

const CATEGORY_SATIETY: Record<string, number> = {
  protein: 7, grain: 7, dairy: 6, veggie: 5,
  composite: 5, fruit: 3, snack: 2, beverage: 2,
  fat: 3, condiment: 1,
};

// ==================== 餐次偏好策略（对齐 FoodLibrary.tags 英文标签） ====================

const MEAL_PREFERENCES: Record<string, { includeTags: string[]; excludeTags: string[] }> = {
  breakfast: {
    includeTags: ['breakfast', 'high_carb', 'easy_digest'],
    excludeTags: ['fried', 'heavy_flavor'],
  },
  lunch: {
    includeTags: ['balanced'],
    excludeTags: [],
  },
  dinner: {
    includeTags: ['low_carb', 'high_protein', 'light'],
    excludeTags: ['high_carb', 'dessert'],
  },
  snack: {
    includeTags: ['low_calorie', 'snack', 'fruit'],
    excludeTags: ['fried', 'high_fat'],
  },
};

// ==================== 角色模板（结构化选菜，对齐 FoodCategory 英文枚举） ====================

const MEAL_ROLES: Record<string, string[]> = {
  breakfast: ['carb', 'protein', 'side'],
  lunch:     ['carb', 'protein', 'veggie'],
  dinner:    ['protein', 'veggie', 'side'],
  snack:     ['snack1', 'snack2'],
};

const ROLE_CATEGORIES: Record<string, string[]> = {
  carb:    ['grain', 'composite'],
  protein: ['protein', 'dairy'],
  veggie:  ['veggie'],
  side:    ['veggie', 'dairy', 'beverage', 'fruit'],
  snack1:  ['fruit', 'snack'],
  snack2:  ['beverage', 'snack', 'fruit'],
};

@Injectable()
export class RecommendationEngineService {
  private readonly logger = new Logger(RecommendationEngineService.name);

  constructor(
    @InjectRepository(FoodLibrary)
    private readonly foodLibraryRepo: Repository<FoodLibrary>,
    @InjectRepository(FoodRecord)
    private readonly foodRecordRepo: Repository<FoodRecord>,
    @InjectRepository(RecommendationFeedback)
    private readonly feedbackRepo: Repository<RecommendationFeedback>,
  ) {}

  // ─── 1. 约束生成（含用户档案融合） ───

  generateConstraints(
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    mealType?: string,
    userProfile?: {
      dietaryRestrictions?: string[];
      weakTimeSlots?: string[];
      discipline?: string;
      allergens?: string[];
      healthConditions?: string[];
    },
  ): Constraint {
    const includeTags: string[] = [];
    const excludeTags: string[] = [];

    // 目标驱动
    if (goalType === 'fat_loss') {
      includeTags.push('high_protein');
    } else if (goalType === 'muscle_gain') {
      includeTags.push('high_protein');
    } else if (goalType === 'health') {
      // health 不强制 tags，保持多样
    }

    // 状态驱动
    const proteinGap = dailyTarget.protein - consumed.protein;
    const calorieGap = dailyTarget.calories - consumed.calories;

    if (proteinGap > 30) includeTags.push('high_protein');
    if (calorieGap < 300) includeTags.push('low_calorie');
    if (calorieGap < 0) {
      includeTags.push('ultra_low_calorie');
      excludeTags.push('high_fat');
    }

    // 餐次偏好策略
    if (mealType) {
      const mealPref = MEAL_PREFERENCES[mealType];
      if (mealPref) {
        includeTags.push(...mealPref.includeTags);
        excludeTags.push(...mealPref.excludeTags);
      }
    }

    // 用户档案约束融合
    if (userProfile) {
      // ⚠️ 过敏原 → 硬约束排除（安全性优先，不可被探索覆盖）
      if (userProfile.allergens?.length) {
        for (const allergen of userProfile.allergens) {
          excludeTags.push(`allergen_${allergen}`);
        }
      }

      // 健康状况 → 动态约束注入
      if (userProfile.healthConditions?.length) {
        for (const condition of userProfile.healthConditions) {
          if (condition === 'diabetes_type2') {
            excludeTags.push('high_sugar', 'high_gi');
            includeTags.push('low_gi');
          } else if (condition === 'hypertension') {
            excludeTags.push('high_sodium');
            includeTags.push('low_sodium');
          } else if (condition === 'high_cholesterol') {
            excludeTags.push('high_cholesterol');
          } else if (condition === 'gout') {
            excludeTags.push('high_purine');
          } else if (condition === 'kidney_disease') {
            excludeTags.push('high_potassium', 'high_phosphorus');
          } else if (condition === 'fatty_liver') {
            excludeTags.push('high_fat', 'high_sugar');
          }
        }
      }

      // 饮食限制 → 排除标签
      if (userProfile.dietaryRestrictions?.length) {
        for (const restriction of userProfile.dietaryRestrictions) {
          if (restriction === 'vegetarian') excludeTags.push('meat');
          else if (restriction === 'no_spicy') excludeTags.push('heavy_flavor');
          else if (restriction === 'no_fried') excludeTags.push('fried');
          else if (restriction === 'low_sodium') excludeTags.push('high_sodium');
          else excludeTags.push(restriction);
        }
      }

      // 薄弱时段 → 更严格约束
      const hour = new Date().getHours();
      const isWeakSlot = userProfile.weakTimeSlots?.some(slot => {
        if (slot === 'afternoon' && hour >= 14 && hour < 17) return true;
        if (slot === 'evening' && hour >= 18 && hour < 21) return true;
        if (slot === 'midnight' && (hour >= 21 || hour < 5)) return true;
        return false;
      });
      if (isWeakSlot) {
        excludeTags.push('high_fat', 'high_carb', 'dessert');
        includeTags.push('low_calorie');
      }

      // 自律程度 → 约束松紧度
      if (userProfile.discipline === 'low') {
        // 低自律：更宽松，避免过度限制导致放弃
      } else if (userProfile.discipline === 'high') {
        // 高自律：可以更严格
        if (goalType === 'fat_loss') excludeTags.push('processed');
      }
    }

    return {
      includeTags: [...new Set(includeTags)],
      excludeTags: [...new Set(excludeTags)],
      maxCalories: target.calories * 1.15,
      minProtein: target.protein * 0.5,
    };
  }

  // ─── 2. 食物筛选（宽松匹配: 命中任一 includeTag 即可 + 结构化 mealType 过滤） ───

  filterFoods(foods: FoodLibrary[], constraint: Constraint, mealType?: string, userAllergens?: string[]): FoodLibrary[] {
    return foods.filter(food => {
      const tags = food.tags || [];

      // mealType 结构化过滤：食物有 mealTypes 字段时优先使用
      if (mealType) {
        const foodMealTypes: string[] = food.mealTypes || [];
        if (foodMealTypes.length > 0 && !foodMealTypes.includes(mealType)) return false;
      }

      // ⚠️ 过敏原直接匹配：基于食物自身 allergens 字段排除（安全优先）
      if (userAllergens?.length) {
        const foodAllergens: string[] = food.allergens || [];
        if (userAllergens.some(a => foodAllergens.includes(a))) return false;
      }

      // includeTag: 至少命中一个（宽松）
      if (constraint.includeTags.length > 0) {
        const hasAny = constraint.includeTags.some(tag => tags.includes(tag));
        if (!hasAny) return false;
      }

      // excludeTag: 任一命中则排除
      if (constraint.excludeTags.length > 0) {
        const hasExcluded = constraint.excludeTags.some(tag => tags.includes(tag));
        if (hasExcluded) return false;
      }

      // 热量上限（按标准份量）
      const servingCal = (food.calories * food.standardServingG) / 100;
      if (servingCal > constraint.maxCalories) return false;

      // 蛋白质下限
      if (constraint.minProtein > 0 && food.protein) {
        const servingProtein = (food.protein * food.standardServingG) / 100;
        if (servingProtein < constraint.minProtein) return false;
      }

      return true;
    });
  }

  // ─── 3. 食物评分（非线性多维评分，带惩罚/加分项） ───

  scoreFood(food: FoodLibrary, goalType: string, target?: MealTarget): number {
    const servingCal = (food.calories * food.standardServingG) / 100;
    const servingProtein = ((food.protein || 0) * food.standardServingG) / 100;
    const servingCarbs = ((food.carbs || 0) * food.standardServingG) / 100;
    const servingFat = ((food.fat || 0) * food.standardServingG) / 100;

    // 食物级别分数优先，分类级别兜底
    const quality = food.qualityScore || CATEGORY_QUALITY[food.category] || 5;
    const satiety = food.satietyScore || CATEGORY_SATIETY[food.category] || 4;

    // ── 热量评分：钟形函数（替代线性递减）──
    const targetCal = target?.calories || 400;
    const caloriesScore = this.calcEnergyScore(servingCal, targetCal, goalType);

    // ── 蛋白质评分：分段函数（有达标区间）──
    const proteinScore = this.calcProteinScore(servingProtein, servingCal, goalType);

    // ── 碳水/脂肪：保持区间评分 ──
    const carbsScore = servingCal > 0
      ? this.rangeScore((servingCarbs * 4) / servingCal, 0.40, 0.55)
      : 0.5;
    const fatScore = servingCal > 0
      ? this.rangeScore((servingFat * 9) / servingCal, 0.20, 0.35)
      : 0.5;

    const qualityScore = quality / 10;
    const satietyScore = satiety / 10;

    const weights = SCORE_WEIGHTS[goalType as GoalType] || SCORE_WEIGHTS.health;
    const scores = [caloriesScore, proteinScore, carbsScore, fatScore, qualityScore, satietyScore];

    // 置信度加权
    const confidence = Number(food.confidence) || 0.5;
    let rawScore = scores.reduce((sum, s, i) => sum + s * weights[i], 0);

    // 加工食品/油炸惩罚
    if (food.isProcessed) rawScore -= 0.06;
    if (food.isFried)     rawScore -= 0.08;

    // NOVA-4 超加工额外惩罚
    if (food.processingLevel === 4) rawScore -= 0.05;

    // 高纤维加分（每100g 纤维 >3g 加 0.03）
    const fiber = food.fiber || 0;
    if (fiber >= 3) rawScore += 0.03;

    // 高钠惩罚（每100g 钠 >600mg 扣 0.03）
    const sodium = food.sodium || 0;
    if (sodium > 600) rawScore -= 0.03;

    // 反式脂肪惩罚
    const transFat = food.transFat || 0;
    if (transFat > 0.5) rawScore -= 0.05;

    // 低GI加分（减脂/健康目标下 GI<55 加 0.02）
    const gi = food.glycemicIndex || 0;
    if (gi > 0 && gi < 55 && (goalType === 'fat_loss' || goalType === 'health')) {
      rawScore += 0.02;
    }

    return Math.max(0, rawScore * (0.7 + 0.3 * confidence));
  }

  // ─── 评分辅助函数 ───

  /**
   * 热量评分 — 高斯钟形函数
   * 以目标热量为中心，偏离越大分数越低。σ 根据目标类型动态调整。
   * 返回 0-1 范围的分数。
   */
  private calcEnergyScore(actual: number, target: number, goalType: string): number {
    if (target <= 0) return 0.8;
    const sigmaRatio: Record<string, number> = {
      fat_loss: 0.12, muscle_gain: 0.20, health: 0.15, habit: 0.25,
    };
    const sigma = target * (sigmaRatio[goalType] || 0.15);
    const diff = actual - target;
    let score = Math.exp(-(diff * diff) / (2 * sigma * sigma));

    // 非对称惩罚：减脂超标扣更重，增肌不足扣更重
    if (goalType === 'fat_loss' && diff > 0) {
      score *= 0.85;
    }
    if (goalType === 'muscle_gain' && diff < 0) {
      score *= 0.90;
    }
    return score;
  }

  /**
   * 蛋白质评分 — 分段函数
   * 不足区线性增长，达标区满分，超标区缓慢下降。返回 0-1 范围。
   */
  private calcProteinScore(protein: number, calories: number, goalType: string): number {
    if (calories <= 0) return 0.8;
    const ratio = (protein * 4) / calories;
    const ranges: Record<string, [number, number]> = {
      fat_loss:    [0.25, 0.35],
      muscle_gain: [0.25, 0.40],
      health:      [0.15, 0.25],
      habit:       [0.12, 0.30],
    };
    const [min, max] = ranges[goalType] || [0.15, 0.25];

    if (ratio >= min && ratio <= max) return 1.0;
    if (ratio < min) return Math.max(0, 0.3 + 0.7 * (ratio / min));
    // 超标区 — 蛋白质多一些问题不大，缓慢衰减
    return Math.max(0, 1.0 - 0.5 * ((ratio - max) / 0.15));
  }

  /**
   * 区间评分 — 在 [min, max] 范围内满分，偏离越远分数越低
   */
  private rangeScore(value: number, min: number, max: number): number {
    if (value >= min && value <= max) return 1.0;
    const diff = value < min ? min - value : value - max;
    return Math.max(0, 1.0 - diff * 2);
  }

  // ─── 4. 多样性控制 ───

  diversify(foods: ScoredFood[], recentFoodNames: string[], limit: number = 3): ScoredFood[] {
    const result: ScoredFood[] = [];
    const usedCategories = new Set<string>();

    for (const sf of foods) {
      if (result.length >= limit) break;

      // 跳过最近吃过的
      if (recentFoodNames.includes(sf.food.name)) continue;

      // 同分类最多放 2 个
      if (usedCategories.has(sf.food.category) && result.filter(r => r.food.category === sf.food.category).length >= 2) continue;

      result.push(sf);
      usedCategories.add(sf.food.category);
    }

    // 如果多样性筛选后不够，放开限制补齐
    if (result.length < limit) {
      for (const sf of foods) {
        if (result.length >= limit) break;
        if (!result.includes(sf)) result.push(sf);
      }
    }

    return result;
  }

  // ─── 5. 核心推荐函数（供外部实时调用，内部委托 recommendMealFromPool） ───

  async recommendMeal(
    userId: string,
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    userProfile?: {
      dietaryRestrictions?: string[];
      weakTimeSlots?: string[];
      discipline?: string;
      allergens?: string[];
      healthConditions?: string[];
    },
  ): Promise<MealRecommendation> {
    const [allFoods, recentFoodNames, feedbackWeights] = await Promise.all([
      this.getAllFoods(),
      this.getRecentFoodNames(userId, 3),
      this.getUserFeedbackWeights(userId),
    ]);

    return this.recommendMealFromPool(
      allFoods,
      mealType,
      goalType,
      consumed,
      target,
      dailyTarget,
      recentFoodNames,
      undefined,
      feedbackWeights,
      userProfile,
    );
  }

  // ─── 6. 场景化推荐（外卖/便利店/家里） ───

  async recommendByScenario(
    userId: string,
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    userProfile?: {
      dietaryRestrictions?: string[];
      weakTimeSlots?: string[];
      discipline?: string;
      allergens?: string[];
      healthConditions?: string[];
    },
  ): Promise<{
    takeout: MealRecommendation;
    convenience: MealRecommendation;
    homeCook: MealRecommendation;
  }> {
    const allFoods = await this.getAllFoods();
    const recentFoodNames = await this.getRecentFoodNames(userId, 3);
    const baseConstraints = this.generateConstraints(goalType, consumed, target, dailyTarget, undefined, userProfile);

    const userAllergens = userProfile?.allergens;

    const buildForScenario = (scenarioTags: string[], scenarioName: string): MealRecommendation => {
      const constraints: Constraint = {
        ...baseConstraints,
        includeTags: [...new Set([...baseConstraints.includeTags, ...scenarioTags])],
      };

      let candidates = this.filterFoods(allFoods, constraints, mealType, userAllergens);
      if (candidates.length < 3) {
        candidates = this.filterFoods(allFoods, { ...constraints, includeTags: scenarioTags }, mealType, userAllergens);
      }
      if (candidates.length < 3) {
        candidates = this.filterFoods(allFoods, { ...baseConstraints, includeTags: [] }, mealType, userAllergens);
      }

      const scored = this.scoreFoodsWithServing(candidates, goalType, target);
      const picks = this.diversify(scored, recentFoodNames, 2);
      return this.aggregateMealResult(picks, `${scenarioName}推荐，约 ${picks.reduce((s, p) => s + p.servingCalories, 0)} kcal`);
    };

    return {
      takeout: buildForScenario(['takeout', 'fast_food'], '外卖'),
      convenience: buildForScenario(['low_calorie', 'snack', 'beverage'], '便利店'),
      homeCook: buildForScenario(['natural', 'veggie', 'protein'], '在家做'),
    };
  }

  // ─── 辅助：批量评分 + 按标准份量计算营养 ───

  private scoreFoodsWithServing(candidates: FoodLibrary[], goalType: string, target?: MealTarget): ScoredFood[] {
    return candidates.map(food => ({
      food,
      score: this.scoreFood(food, goalType, target),
      ...this.calcServingNutrition(food),
    })).sort((a, b) => b.score - a.score);
  }

  // ─── 辅助：聚合推荐结果 ───

  private aggregateMealResult(picks: ScoredFood[], tip: string): MealRecommendation {
    const totalCalories = picks.reduce((s, p) => s + p.servingCalories, 0);
    const totalProtein = picks.reduce((s, p) => s + p.servingProtein, 0);
    const totalFat = picks.reduce((s, p) => s + p.servingFat, 0);
    const totalCarbs = picks.reduce((s, p) => s + p.servingCarbs, 0);
    const displayText = picks
      .map(p => `${p.food.name}（${p.food.standardServingDesc}，${p.servingCalories}kcal）`)
      .join(' + ');
    return { foods: picks, totalCalories, totalProtein, totalFat, totalCarbs, displayText, tip };
  }

  // ─── 辅助：按标准份量计算食物营养 ───

  private calcServingNutrition(food: FoodLibrary): Pick<ScoredFood, 'servingCalories' | 'servingProtein' | 'servingFat' | 'servingCarbs'> {
    return {
      servingCalories: Math.round((food.calories * food.standardServingG) / 100),
      servingProtein: Math.round(((food.protein || 0) * food.standardServingG) / 100),
      servingFat: Math.round(((food.fat || 0) * food.standardServingG) / 100),
      servingCarbs: Math.round(((food.carbs || 0) * food.standardServingG) / 100),
    };
  }

  // ─── 7. 相似度惩罚多样化（替代 diversify，用于每日计划） ───

  private similarity(a: FoodLibrary, b: FoodLibrary): number {
    let score = 0;
    if (a.category === b.category) score += 0.3;

    // 主要食材相同 → 高相似度
    const mainA = a.mainIngredient || '';
    const mainB = b.mainIngredient || '';
    if (mainA && mainB && mainA === mainB) score += 0.5;

    // 子分类相同
    const subA = a.subCategory || '';
    const subB = b.subCategory || '';
    if (subA && subB && subA === subB) score += 0.2;

    // tag 重叠
    const tagsA = a.tags || [];
    const tagsB = b.tags || [];
    score += tagsA.filter(t => tagsB.includes(t)).length * 0.05;

    return Math.min(score, 1);
  }

  // ─── 7.1 份量调整（缩放到目标预算） ───

  /**
   * 份量调整 — 优先使用 commonPortions 约束，兜底线性缩放
   * 每个食物的缩放比例被 commonPortions 的最小/最大份量限制，避免不合理份量。
   */
  private adjustPortions(picks: ScoredFood[], budget: number): ScoredFood[] {
    const totalCal = picks.reduce((s, p) => s + p.servingCalories, 0);
    if (totalCal <= 0) return picks;

    const globalRatio = budget / totalCal;
    if (Math.abs(globalRatio - 1) < 0.05) return picks; // 差距小于5%不调整

    return picks.map(p => {
      // 确定该食物的合理缩放范围
      const portions = p.food.commonPortions || [];
      let minRatio = 0.6;
      let maxRatio = 1.5;

      if (portions.length > 0) {
        const standardG = p.food.standardServingG || 100;
        const portionGrams = portions.map(pt => pt.grams);
        const minG = Math.min(...portionGrams);
        const maxG = Math.max(...portionGrams);
        minRatio = Math.max(0.5, minG / standardG);
        maxRatio = Math.min(2.0, maxG / standardG);
      }

      const clampedRatio = Math.max(minRatio, Math.min(maxRatio, globalRatio));

      return {
        ...p,
        servingCalories: Math.round(p.servingCalories * clampedRatio),
        servingProtein: Math.round(p.servingProtein * clampedRatio),
        servingFat: Math.round(p.servingFat * clampedRatio),
        servingCarbs: Math.round(p.servingCarbs * clampedRatio),
      };
    });
  }

  diversifyWithPenalty(
    scored: ScoredFood[],
    excludeNames: string[],
    limit: number = 3,
  ): ScoredFood[] {
    const candidates = scored.filter(sf => !excludeNames.includes(sf.food.name));
    const result: ScoredFood[] = [];

    const remaining = [...candidates];
    while (result.length < limit && remaining.length > 0) {
      let bestIdx = 0;
      let bestScore = -Infinity;

      remaining.forEach((item, i) => {
        let penalty = 0;
        for (const selected of result) {
          penalty += this.similarity(item.food, selected.food) * 0.3;
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

  // ─── 8. 随机探索（ε-greedy 扰动） ───

  private addExploration(scored: ScoredFood[], epsilon: number = 0.15): ScoredFood[] {
    return scored.map(sf => ({
      ...sf,
      score: sf.score * (1 + (Math.random() - 0.5) * epsilon),
    })).sort((a, b) => b.score - a.score);
  }

  // ─── 9. 从食物池推荐（角色模板 + 份量调整，供 DailyPlanService 调用） ───

  recommendMealFromPool(
    allFoods: FoodLibrary[],
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    excludeNames: string[],
    userPreferences?: { loves?: string[]; avoids?: string[] },
    feedbackWeights?: Record<string, number>,
    userProfile?: {
      dietaryRestrictions?: string[];
      weakTimeSlots?: string[];
      discipline?: string;
      allergens?: string[];
      healthConditions?: string[];
    },
  ): MealRecommendation {
    // 约束生成（带餐次策略 + 用户档案融合）
    const constraints = this.generateConstraints(goalType, consumed, target, dailyTarget, mealType, userProfile);

    // 获取当前餐次的角色模板
    const roles = MEAL_ROLES[mealType] || ['carb', 'protein', 'veggie'];
    const picks: ScoredFood[] = [];
    const usedNames = new Set(excludeNames);

    for (const role of roles) {
      // 按角色筛选对应分类
      const roleCategories = ROLE_CATEGORIES[role] || [];
      let roleCandidates = allFoods.filter(f =>
        roleCategories.includes(f.category) && !usedNames.has(f.name),
      );

      // 对角色候选做 mealType 过滤
      roleCandidates = roleCandidates.filter(f => {
        const foodMealTypes: string[] = f.mealTypes || [];
        return foodMealTypes.length === 0 || foodMealTypes.includes(mealType);
      });

      // exclude tag 过滤
      if (constraints.excludeTags.length > 0) {
        roleCandidates = roleCandidates.filter(f => {
          const tags = f.tags || [];
          return !constraints.excludeTags.some(t => tags.includes(t));
        });
      }

      // ⚠️ 过敏原直接匹配过滤（安全性：基于食物自身的 allergens 字段）
      if (userProfile?.allergens?.length) {
        roleCandidates = roleCandidates.filter(f => {
          const foodAllergens: string[] = f.allergens || [];
          return !userProfile.allergens!.some(a => foodAllergens.includes(a));
        });
      }

      // 如果角色候选为空，放宽到所有未使用的食物
      if (roleCandidates.length === 0) {
        roleCandidates = allFoods.filter(f => !usedNames.has(f.name));
      }

      // 评分 + 偏好加权
      let scored: ScoredFood[] = roleCandidates.map(food => {
        let score = this.scoreFood(food, goalType, target);

        // 个性化偏好加权
        if (userPreferences) {
          const name = food.name;
          const mainIng = food.mainIngredient || '';
          if (userPreferences.loves?.some(l => name.includes(l) || mainIng.includes(l))) {
            score *= 1.12;
          }
          if (userPreferences.avoids?.some(a => name.includes(a) || mainIng.includes(a))) {
            score *= 0.3;
          }
        }

        // 反馈学习权重：基于历史接受/跳过率调整
        if (feedbackWeights && feedbackWeights[food.name]) {
          score *= feedbackWeights[food.name];
        }

        return {
          food,
          score,
          ...this.calcServingNutrition(food),
        };
      }).sort((a, b) => b.score - a.score);

      // 随机探索
      scored = this.addExploration(scored, 0.15);

      // 相似度惩罚：与已选食物的相似度降权
      if (picks.length > 0) {
        scored = scored.map(sf => {
          const penalty = picks.reduce((sum, p) => sum + this.similarity(sf.food, p.food) * 0.3, 0);
          return { ...sf, score: sf.score - penalty };
        }).sort((a, b) => b.score - a.score);
      }

      // 选择该角色的最优食物
      if (scored.length > 0) {
        picks.push(scored[0]);
        usedNames.add(scored[0].food.name);
      }
    }

    // 份量调整：使总热量接近预算
    const adjustedPicks = this.adjustPortions(picks, target.calories);
    const tip = this.buildTip(mealType, goalType, target, adjustedPicks.reduce((s, p) => s + p.servingCalories, 0));
    return this.aggregateMealResult(adjustedPicks, tip);
  }

  // ─── 10. 暴露食物库查询（供 DailyPlanService 一次性获取） ───

  async getAllFoods(): Promise<FoodLibrary[]> {
    return this.foodLibraryRepo.find({ where: { isVerified: true } });
  }

  // ─── 11. 反馈学习 — 从 RecommendationFeedback 提取用户偏好 ───

  /**
   * 分析用户的推荐反馈，提取偏好权重。
   * - accepted 的食物加权（loves 候选）
   * - skipped/replaced 的食物降权（avoids 候选）
   * 返回食物名 → 权重系数的映射（默认 1.0，范围 0.3-1.3）
   */
  async getUserFeedbackWeights(userId: string): Promise<Record<string, number>> {
    const weights: Record<string, number> = {};
    try {
      const since = new Date();
      since.setDate(since.getDate() - 30); // 最近30天

      const feedbacks = await this.feedbackRepo
        .createQueryBuilder('f')
        .where('f.user_id = :userId', { userId })
        .andWhere('f.created_at >= :since', { since })
        .getMany();

      // 统计每个食物的接受/跳过次数
      const stats: Record<string, { accepted: number; rejected: number }> = {};
      for (const fb of feedbacks) {
        if (!stats[fb.foodName]) stats[fb.foodName] = { accepted: 0, rejected: 0 };
        if (fb.action === 'accepted') {
          stats[fb.foodName].accepted++;
        } else {
          stats[fb.foodName].rejected++;
        }
      }

      // 计算权重系数
      for (const [name, s] of Object.entries(stats)) {
        const total = s.accepted + s.rejected;
        if (total < 2) continue; // 数据不足跳过
        const acceptRate = s.accepted / total;
        // 映射到 0.3-1.3 范围: 50% 接受率 → 1.0, 100% → 1.3, 0% → 0.3
        weights[name] = 0.3 + acceptRate * 1.0;
      }
    } catch (err) {
      this.logger.warn(`获取反馈权重失败: ${err}`);
    }
    return weights;
  }

  // ─── 辅助 ───

  async getRecentFoodNames(userId: string, days: number): Promise<string[]> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const records = await this.foodRecordRepo
        .createQueryBuilder('fr')
        .select("food_item->>'name'", 'name')
        .from('food_records', 'fr')
        .innerJoin("jsonb_array_elements(fr.foods)", 'food_item', 'true')
        .where('fr.user_id = :userId', { userId })
        .andWhere('fr.recorded_at >= :since', { since })
        .groupBy("food_item->>'name'")
        .getRawMany();

      return records.map(r => r.name);
    } catch {
      return [];
    }
  }

  private buildTip(mealType: string, goalType: string, target: MealTarget, actualCal: number): string {
    const tips: string[] = [];

    if (actualCal > target.calories * 1.1) {
      tips.push('推荐总热量略超预算，可减少份量');
    } else if (actualCal < target.calories * 0.7) {
      tips.push('推荐量偏少，可适当加一份水果或酸奶');
    }

    const goalTip: Record<string, string> = {
      fat_loss: '减脂期优先高蛋白低脂食物',
      muscle_gain: '增肌期碳水蛋白并重',
      health: '均衡搭配，注意蔬果',
      habit: '保持规律即可',
    };
    tips.push(goalTip[goalType] || goalTip.health);

    const mealTip: Record<string, string> = {
      breakfast: '早餐注意蛋白质摄入',
      lunch: '午餐是一天的能量主力',
      dinner: '晚餐清淡为主',
      snack: '加餐控量，选择健康零食',
    };
    tips.push(mealTip[mealType] || '');

    return tips.filter(Boolean).join('；');
  }
}
