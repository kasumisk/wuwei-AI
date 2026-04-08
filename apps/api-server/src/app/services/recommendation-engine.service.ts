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

// ==================== 角色模板（结构化选菜） ====================

const MEAL_ROLES: Record<string, string[]> = {
  breakfast: ['carb', 'protein', 'side'],
  lunch:     ['carb', 'protein', 'veggie'],
  dinner:    ['protein', 'veggie', 'side'],
  snack:     ['snack1', 'snack2'],
};

const ROLE_CATEGORIES: Record<string, string[]> = {
  carb:    ['主食'],
  protein: ['肉类', '豆制品'],
  veggie:  ['蔬菜'],
  side:    ['汤类', '蔬菜', '豆制品', '饮品'],
  snack1:  ['水果', '零食'],
  snack2:  ['饮品', '零食', '水果'],
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

  // ─── 1. 约束生成（含用户档案融合） ───

  generateConstraints(
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    mealType?: string,
    userProfile?: { dietaryRestrictions?: string[]; weakTimeSlots?: string[]; discipline?: string },
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

    // 用户档案约束融合
    if (userProfile) {
      // 饮食限制 → 排除标签
      if (userProfile.dietaryRestrictions?.length) {
        for (const restriction of userProfile.dietaryRestrictions) {
          if (restriction === 'vegetarian') excludeTags.push('肉类');
          else if (restriction === 'no_spicy') excludeTags.push('重口味');
          else if (restriction === 'no_fried') excludeTags.push('油炸');
          else if (restriction === 'low_sodium') excludeTags.push('高钠');
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
        excludeTags.push('高脂肪', '高碳水', '甜品');
        includeTags.push('低热量');
      }

      // 自律程度 → 约束松紧度
      if (userProfile.discipline === 'low') {
        // 低自律：更宽松，避免过度限制导致放弃
      } else if (userProfile.discipline === 'high') {
        // 高自律：可以更严格
        if (goalType === 'fat_loss') excludeTags.push('加工');
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

  filterFoods(foods: FoodLibrary[], constraint: Constraint, mealType?: string): FoodLibrary[] {
    return foods.filter(food => {
      const tags = food.tags || [];

      // mealType 结构化过滤：食物有 mealTypes 字段时优先使用
      if (mealType) {
        const foodMealTypes: string[] = (food as any).mealTypes || [];
        if (foodMealTypes.length > 0 && !foodMealTypes.includes(mealType)) return false;
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

  // ─── 3. 食物评分（使用食物级别 qualityScore/satietyScore，带惩罚/加分项） ───

  scoreFood(food: FoodLibrary, goalType: string): number {
    const normalize = (v: number, max: number) => Math.min(v / max, 1);

    const servingCal = (food.calories * food.standardServingG) / 100;
    const servingProtein = ((food.protein || 0) * food.standardServingG) / 100;
    const servingCarbs = ((food.carbs || 0) * food.standardServingG) / 100;
    const servingFat = ((food.fat || 0) * food.standardServingG) / 100;

    // 食物级别分数优先，分类级别兜底
    const quality = (food as any).qualityScore || CATEGORY_QUALITY[food.category] || 5;
    const satiety = (food as any).satietyScore || CATEGORY_SATIETY[food.category] || 4;

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
    let rawScore = scores.reduce((sum, s, i) => sum + s * weights[i], 0);

    // 加工食品/油炸惩罚
    if ((food as any).isProcessed) rawScore -= 0.06;
    if ((food as any).isFried)     rawScore -= 0.08;

    // 高纤维加分（每100g 纤维 >3g 加 0.03）
    const fiber = (food as any).fiber || 0;
    if (fiber >= 3) rawScore += 0.03;

    // 高钠惩罚（每100g 钠 >600mg 扣 0.03）
    const sodium = (food as any).sodium || 0;
    if (sodium > 600) rawScore -= 0.03;

    // 低GI加分（减脂/健康目标下 GI<55 加 0.02）
    const gi = (food as any).glycemicIndex || 0;
    if (gi > 0 && gi < 55 && (goalType === 'fat_loss' || goalType === 'health')) {
      rawScore += 0.02;
    }

    return Math.max(0, rawScore * (0.7 + 0.3 * confidence));
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
    const constraints = this.generateConstraints(goalType, consumed, target, dailyTarget, mealType);

    // 筛选（传递 mealType 进行结构化过滤）
    let candidates = this.filterFoods(allFoods, constraints, mealType);

    // 如果筛选太严没有候选，放宽 includeTags
    if (candidates.length < 5) {
      candidates = this.filterFoods(allFoods, { ...constraints, includeTags: [] }, mealType);
    }

    // 评分排序
    const scored: ScoredFood[] = candidates.map(food => {
      const servingCalories = Math.round((food.calories * food.standardServingG) / 100);
      const servingProtein = Math.round(((food.protein || 0) * food.standardServingG) / 100);
      const servingFat = Math.round(((food.fat || 0) * food.standardServingG) / 100);
      const servingCarbs = Math.round(((food.carbs || 0) * food.standardServingG) / 100);

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

      let candidates = this.filterFoods(allFoods, constraints, mealType);
      if (candidates.length < 3) {
        candidates = this.filterFoods(allFoods, { ...constraints, includeTags: scenarioTags }, mealType);
      }
      if (candidates.length < 3) {
        candidates = this.filterFoods(allFoods, { ...baseConstraints, includeTags: [] }, mealType);
      }

      const scored: ScoredFood[] = candidates.map(food => ({
        food,
        score: this.scoreFood(food, goalType),
        servingCalories: Math.round((food.calories * food.standardServingG) / 100),
        servingProtein: Math.round(((food.protein || 0) * food.standardServingG) / 100),
        servingFat: Math.round(((food.fat || 0) * food.standardServingG) / 100),
        servingCarbs: Math.round(((food.carbs || 0) * food.standardServingG) / 100),
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
    if (a.category === b.category) score += 0.3;

    // 主要食材相同 → 高相似度
    const mainA = (a as any).mainIngredient || '';
    const mainB = (b as any).mainIngredient || '';
    if (mainA && mainB && mainA === mainB) score += 0.5;

    // 子分类相同
    const subA = (a as any).subCategory || '';
    const subB = (b as any).subCategory || '';
    if (subA && subB && subA === subB) score += 0.2;

    // tag 重叠
    const tagsA = a.tags || [];
    const tagsB = b.tags || [];
    score += tagsA.filter(t => tagsB.includes(t)).length * 0.05;

    return Math.min(score, 1);
  }

  // ─── 7.1 份量调整（缩放到目标预算） ───

  private adjustPortions(picks: ScoredFood[], budget: number): ScoredFood[] {
    const totalCal = picks.reduce((s, p) => s + p.servingCalories, 0);
    if (totalCal <= 0) return picks;

    const ratio = Math.max(0.6, Math.min(1.5, budget / totalCal));
    if (Math.abs(ratio - 1) < 0.05) return picks; // 差距小于5%不调整

    return picks.map(p => ({
      ...p,
      servingCalories: Math.round(p.servingCalories * ratio),
      servingProtein: Math.round(p.servingProtein * ratio),
      servingFat: Math.round(p.servingFat * ratio),
      servingCarbs: Math.round(p.servingCarbs * ratio),
    }));
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
  ): MealRecommendation {
    // 约束生成（带餐次策略）
    const constraints = this.generateConstraints(goalType, consumed, target, dailyTarget, mealType);

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
        const foodMealTypes: string[] = (f as any).mealTypes || [];
        return foodMealTypes.length === 0 || foodMealTypes.includes(mealType);
      });

      // exclude tag 过滤
      if (constraints.excludeTags.length > 0) {
        roleCandidates = roleCandidates.filter(f => {
          const tags = f.tags || [];
          return !constraints.excludeTags.some(t => tags.includes(t));
        });
      }

      // 如果角色候选为空，放宽到所有未使用的食物
      if (roleCandidates.length === 0) {
        roleCandidates = allFoods.filter(f => !usedNames.has(f.name));
      }

      // 评分 + 偏好加权
      let scored: ScoredFood[] = roleCandidates.map(food => {
        let score = this.scoreFood(food, goalType);

        // 个性化偏好加权
        if (userPreferences) {
          const name = food.name;
          const mainIng = (food as any).mainIngredient || '';
          if (userPreferences.loves?.some(l => name.includes(l) || mainIng.includes(l))) {
            score *= 1.12;
          }
          if (userPreferences.avoids?.some(a => name.includes(a) || mainIng.includes(a))) {
            score *= 0.3;
          }
        }

        return {
          food,
          score,
          servingCalories: Math.round((food.calories * food.standardServingG) / 100),
          servingProtein: Math.round(((food.protein || 0) * food.standardServingG) / 100),
          servingFat: Math.round(((food.fat || 0) * food.standardServingG) / 100),
          servingCarbs: Math.round(((food.carbs || 0) * food.standardServingG) / 100),
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

    // 聚合
    const totalCalories = adjustedPicks.reduce((s, p) => s + p.servingCalories, 0);
    const totalProtein = adjustedPicks.reduce((s, p) => s + p.servingProtein, 0);
    const totalFat = adjustedPicks.reduce((s, p) => s + p.servingFat, 0);
    const totalCarbs = adjustedPicks.reduce((s, p) => s + p.servingCarbs, 0);

    const displayText = adjustedPicks
      .map(p => `${p.food.name}（${p.food.standardServingDesc}，${p.servingCalories}kcal）`)
      .join(' + ');

    const tip = this.buildTip(mealType, goalType, target, totalCalories);

    return { foods: adjustedPicks, totalCalories, totalProtein, totalFat, totalCarbs, displayText, tip };
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
