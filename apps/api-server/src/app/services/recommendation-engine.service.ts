import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../entities/food-library.entity';
import { FoodRecord } from '../../entities/food-record.entity';

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

type GoalType = 'fat_loss' | 'muscle_gain' | 'health' | 'habit';

// ==================== 评分权重 ====================

const SCORE_WEIGHTS: Record<GoalType, number[]> = {
  //                    [cal,  protein, carbs, fat,  quality, satiety]
  fat_loss:            [0.30, 0.25,    0.15,  0.10, 0.10,   0.10],
  muscle_gain:         [0.25, 0.30,    0.20,  0.10, 0.10,   0.05],
  health:              [0.15, 0.10,    0.10,  0.10, 0.30,   0.25],
  habit:               [0.20, 0.15,    0.10,  0.10, 0.25,   0.20],
};

// ==================== 食物品质/饱腹分推导 ====================

const CATEGORY_QUALITY: Record<string, number> = {
  '蔬菜': 8, '水果': 7, '豆制品': 7, '汤类': 6,
  '肉类': 6, '主食': 5, '快餐': 3, '零食': 2, '饮品': 3,
};

const CATEGORY_SATIETY: Record<string, number> = {
  '肉类': 7, '主食': 7, '豆制品': 6, '蔬菜': 5,
  '汤类': 4, '水果': 3, '快餐': 5, '零食': 2, '饮品': 2,
};

// ==================== 餐次偏好策略 ====================

const MEAL_PREFERENCES: Record<string, { includeTags: string[]; excludeTags: string[] }> = {
  breakfast: {
    includeTags: ['早餐', '高碳水', '易消化'],
    excludeTags: ['油炸', '重口味'],
  },
  lunch: {
    includeTags: ['均衡'],
    excludeTags: [],
  },
  dinner: {
    includeTags: ['低碳水', '高蛋白', '清淡'],
    excludeTags: ['高碳水', '甜品'],
  },
  snack: {
    includeTags: ['低热量', '零食', '水果'],
    excludeTags: ['油炸', '高脂肪'],
  },
};

@Injectable()
export class RecommendationEngineService {
  private readonly logger = new Logger(RecommendationEngineService.name);

  constructor(
    @InjectRepository(FoodLibrary)
    private readonly foodLibraryRepo: Repository<FoodLibrary>,
    @InjectRepository(FoodRecord)
    private readonly foodRecordRepo: Repository<FoodRecord>,
  ) {}

  // ─── 1. 约束生成 ───

  generateConstraints(
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    mealType?: string,
  ): Constraint {
    const includeTags: string[] = [];
    const excludeTags: string[] = [];

    // 目标驱动
    if (goalType === 'fat_loss') {
      includeTags.push('高蛋白');
    } else if (goalType === 'muscle_gain') {
      includeTags.push('高蛋白');
    } else if (goalType === 'health') {
      // health 不强制 tags，保持多样
    }

    // 状态驱动
    const proteinGap = dailyTarget.protein - consumed.protein;
    const calorieGap = dailyTarget.calories - consumed.calories;

    if (proteinGap > 30) includeTags.push('高蛋白');
    if (calorieGap < 300) includeTags.push('低热量');
    if (calorieGap < 0) {
      includeTags.push('超低热量');
      excludeTags.push('高脂肪');
    }

    // 餐次偏好策略
    if (mealType) {
      const mealPref = MEAL_PREFERENCES[mealType];
      if (mealPref) {
        includeTags.push(...mealPref.includeTags);
        excludeTags.push(...mealPref.excludeTags);
      }
    }

    return {
      includeTags: [...new Set(includeTags)],
      excludeTags: [...new Set(excludeTags)],
      maxCalories: target.calories * 1.15,
      minProtein: target.protein * 0.5,
    };
  }

  // ─── 2. 食物筛选（宽松匹配: 命中任一 includeTag 即可） ───

  filterFoods(foods: FoodLibrary[], constraint: Constraint): FoodLibrary[] {
    return foods.filter(food => {
      const tags = food.tags || [];

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
      const servingCal = (food.caloriesPer100g * food.standardServingG) / 100;
      if (servingCal > constraint.maxCalories) return false;

      // 蛋白质下限
      if (constraint.minProtein > 0 && food.proteinPer100g) {
        const servingProtein = (food.proteinPer100g * food.standardServingG) / 100;
        if (servingProtein < constraint.minProtein) return false;
      }

      return true;
    });
  }

  // ─── 3. 食物评分 ───

  scoreFood(food: FoodLibrary, goalType: string): number {
    const normalize = (v: number, max: number) => Math.min(v / max, 1);

    const servingCal = (food.caloriesPer100g * food.standardServingG) / 100;
    const servingProtein = ((food.proteinPer100g || 0) * food.standardServingG) / 100;
    const servingCarbs = ((food.carbsPer100g || 0) * food.standardServingG) / 100;
    const servingFat = ((food.fatPer100g || 0) * food.standardServingG) / 100;

    const quality = CATEGORY_QUALITY[food.category] || 5;
    const satiety = CATEGORY_SATIETY[food.category] || 4;

    const caloriesScore = 1 - normalize(servingCal, 800);
    const proteinScore = normalize(servingProtein, 50);
    const carbsScore = 1 - normalize(servingCarbs, 100);
    const fatScore = 1 - normalize(servingFat, 50);
    const qualityScore = quality / 10;
    const satietyScore = satiety / 10;

    const weights = SCORE_WEIGHTS[goalType as GoalType] || SCORE_WEIGHTS.health;
    const scores = [caloriesScore, proteinScore, carbsScore, fatScore, qualityScore, satietyScore];

    // 置信度加权
    const confidence = Number(food.confidence) || 0.5;
    const rawScore = scores.reduce((sum, s, i) => sum + s * weights[i], 0);

    return rawScore * (0.7 + 0.3 * confidence); // 高置信度食物轻微加分
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

  // ─── 5. 核心推荐函数 ───

  async recommendMeal(
    userId: string,
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
  ): Promise<MealRecommendation> {
    // 从数据库获取所有食物
    const allFoods = await this.foodLibraryRepo.find({ where: { isVerified: true } });

    // 约束生成
    const constraints = this.generateConstraints(goalType, consumed, target, dailyTarget);

    // 筛选
    let candidates = this.filterFoods(allFoods, constraints);

    // 如果筛选太严没有候选，放宽 includeTags
    if (candidates.length < 5) {
      candidates = this.filterFoods(allFoods, { ...constraints, includeTags: [] });
    }

    // 评分排序
    const scored: ScoredFood[] = candidates.map(food => {
      const servingCalories = Math.round((food.caloriesPer100g * food.standardServingG) / 100);
      const servingProtein = Math.round(((food.proteinPer100g || 0) * food.standardServingG) / 100);
      const servingFat = Math.round(((food.fatPer100g || 0) * food.standardServingG) / 100);
      const servingCarbs = Math.round(((food.carbsPer100g || 0) * food.standardServingG) / 100);

      return {
        food,
        score: this.scoreFood(food, goalType),
        servingCalories,
        servingProtein,
        servingFat,
        servingCarbs,
      };
    }).sort((a, b) => b.score - a.score);

    // 获取最近吃过的食物名
    const recentFoodNames = await this.getRecentFoodNames(userId, 3);

    // 多样化
    const picks = this.diversify(scored, recentFoodNames, 3);

    // 聚合
    const totalCalories = picks.reduce((s, p) => s + p.servingCalories, 0);
    const totalProtein = picks.reduce((s, p) => s + p.servingProtein, 0);
    const totalFat = picks.reduce((s, p) => s + p.servingFat, 0);
    const totalCarbs = picks.reduce((s, p) => s + p.servingCarbs, 0);

    const displayText = picks
      .map(p => `${p.food.name}（${p.food.standardServingDesc}，${p.servingCalories}kcal）`)
      .join(' + ');

    const tip = this.buildTip(mealType, goalType, target, totalCalories);

    return {
      foods: picks,
      totalCalories,
      totalProtein,
      totalFat,
      totalCarbs,
      displayText,
      tip,
    };
  }

  // ─── 6. 场景化推荐（外卖/便利店/家里） ───

  async recommendByScenario(
    userId: string,
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
  ): Promise<{
    takeout: MealRecommendation;
    convenience: MealRecommendation;
    homeCook: MealRecommendation;
  }> {
    const allFoods = await this.foodLibraryRepo.find({ where: { isVerified: true } });
    const recentFoodNames = await this.getRecentFoodNames(userId, 3);
    const baseConstraints = this.generateConstraints(goalType, consumed, target, dailyTarget);

    const buildForScenario = (scenarioTags: string[], scenarioName: string): MealRecommendation => {
      const constraints: Constraint = {
        ...baseConstraints,
        includeTags: [...new Set([...baseConstraints.includeTags, ...scenarioTags])],
      };

      let candidates = this.filterFoods(allFoods, constraints);
      if (candidates.length < 3) {
        candidates = this.filterFoods(allFoods, { ...constraints, includeTags: scenarioTags });
      }
      if (candidates.length < 3) {
        candidates = this.filterFoods(allFoods, { ...baseConstraints, includeTags: [] });
      }

      const scored: ScoredFood[] = candidates.map(food => ({
        food,
        score: this.scoreFood(food, goalType),
        servingCalories: Math.round((food.caloriesPer100g * food.standardServingG) / 100),
        servingProtein: Math.round(((food.proteinPer100g || 0) * food.standardServingG) / 100),
        servingFat: Math.round(((food.fatPer100g || 0) * food.standardServingG) / 100),
        servingCarbs: Math.round(((food.carbsPer100g || 0) * food.standardServingG) / 100),
      })).sort((a, b) => b.score - a.score);

      const picks = this.diversify(scored, recentFoodNames, 2);
      const totalCalories = picks.reduce((s, p) => s + p.servingCalories, 0);
      const totalProtein = picks.reduce((s, p) => s + p.servingProtein, 0);
      const totalFat = picks.reduce((s, p) => s + p.servingFat, 0);
      const totalCarbs = picks.reduce((s, p) => s + p.servingCarbs, 0);

      return {
        foods: picks,
        totalCalories,
        totalProtein,
        totalFat,
        totalCarbs,
        displayText: picks.map(p => p.food.name).join(' + '),
        tip: `${scenarioName}推荐，约 ${totalCalories} kcal`,
      };
    };

    return {
      takeout: buildForScenario(['外卖', '快餐'], '外卖'),
      convenience: buildForScenario(['低热量', '零食', '饮品'], '便利店'),
      homeCook: buildForScenario(['天然', '蔬菜', '肉类'], '在家做'),
    };
  }

  // ─── 7. 相似度惩罚多样化（替代 diversify，用于每日计划） ───

  private similarity(a: FoodLibrary, b: FoodLibrary): number {
    let score = 0;
    if (a.category === b.category) score += 0.5;
    const tagsA = a.tags || [];
    const tagsB = b.tags || [];
    score += tagsA.filter(t => tagsB.includes(t)).length * 0.1;
    return score;
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

  // ─── 9. 从食物池推荐（供 DailyPlanService 串行调用，避免重复查库） ───

  recommendMealFromPool(
    allFoods: FoodLibrary[],
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    excludeNames: string[],
  ): MealRecommendation {
    // 约束生成（带餐次策略）
    const constraints = this.generateConstraints(goalType, consumed, target, dailyTarget, mealType);

    // 筛选
    let candidates = this.filterFoods(allFoods, constraints);
    if (candidates.length < 5) {
      candidates = this.filterFoods(allFoods, { ...constraints, includeTags: [] });
    }

    // 评分
    let scored: ScoredFood[] = candidates.map(food => ({
      food,
      score: this.scoreFood(food, goalType),
      servingCalories: Math.round((food.caloriesPer100g * food.standardServingG) / 100),
      servingProtein: Math.round(((food.proteinPer100g || 0) * food.standardServingG) / 100),
      servingFat: Math.round(((food.fatPer100g || 0) * food.standardServingG) / 100),
      servingCarbs: Math.round(((food.carbsPer100g || 0) * food.standardServingG) / 100),
    })).sort((a, b) => b.score - a.score);

    // 随机探索
    scored = this.addExploration(scored, 0.15);

    // 相似度惩罚 + 跨餐排除
    const picks = this.diversifyWithPenalty(scored, excludeNames, 3);

    // 聚合
    const totalCalories = picks.reduce((s, p) => s + p.servingCalories, 0);
    const totalProtein = picks.reduce((s, p) => s + p.servingProtein, 0);
    const totalFat = picks.reduce((s, p) => s + p.servingFat, 0);
    const totalCarbs = picks.reduce((s, p) => s + p.servingCarbs, 0);

    const displayText = picks
      .map(p => `${p.food.name}（${p.food.standardServingDesc}，${p.servingCalories}kcal）`)
      .join(' + ');

    const tip = this.buildTip(mealType, goalType, target, totalCalories);

    return { foods: picks, totalCalories, totalProtein, totalFat, totalCarbs, displayText, tip };
  }

  // ─── 10. 暴露食物库查询（供 DailyPlanService 一次性获取） ───

  async getAllFoods(): Promise<FoodLibrary[]> {
    return this.foodLibraryRepo.find({ where: { isVerified: true } });
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
