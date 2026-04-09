import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../food/entities/food-library.entity';
import { FoodRecord } from '../entities/food-record.entity';
import { RecommendationFeedback } from '../entities/recommendation-feedback.entity';
import { GoalType } from './nutrition-score.service';
import { ConstraintGeneratorService } from './recommendation/constraint-generator.service';
import { FoodFilterService } from './recommendation/food-filter.service';
import { FoodScorerService } from './recommendation/food-scorer.service';
import { MealAssemblerService } from './recommendation/meal-assembler.service';
import {
  MealTarget,
  Constraint,
  ScoredFood,
  MealRecommendation,
  UserProfileConstraints,
  MEAL_ROLES,
  ROLE_CATEGORIES,
} from './recommendation/recommendation.types';

// 向后兼容：re-export 所有类型
export type {
  MealTarget,
  Constraint,
  ScoredFood,
  MealRecommendation,
} from './recommendation/recommendation.types';

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
    private readonly constraintGenerator: ConstraintGeneratorService,
    private readonly foodFilter: FoodFilterService,
    private readonly foodScorer: FoodScorerService,
    private readonly mealAssembler: MealAssemblerService,
  ) {}

  // ─── 向后兼容：委托到子服务 ───

  generateConstraints(
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    mealType?: string,
    userProfile?: UserProfileConstraints,
  ): Constraint {
    return this.constraintGenerator.generateConstraints(
      goalType,
      consumed,
      target,
      dailyTarget,
      mealType,
      userProfile,
    );
  }

  filterFoods(
    foods: FoodLibrary[],
    constraint: Constraint,
    mealType?: string,
    userAllergens?: string[],
  ): FoodLibrary[] {
    return this.foodFilter.filterFoods(
      foods,
      constraint,
      mealType,
      userAllergens,
    );
  }

  scoreFood(food: FoodLibrary, goalType: string, target?: MealTarget): number {
    return this.foodScorer.scoreFood(food, goalType, target);
  }

  diversify(
    foods: ScoredFood[],
    recentFoodNames: string[],
    limit: number = 3,
  ): ScoredFood[] {
    return this.mealAssembler.diversify(foods, recentFoodNames, limit);
  }

  diversifyWithPenalty(
    scored: ScoredFood[],
    excludeNames: string[],
    limit: number = 3,
  ): ScoredFood[] {
    return this.mealAssembler.diversifyWithPenalty(scored, excludeNames, limit);
  }

  // ─── 核心推荐函数 ───

  async recommendMeal(
    userId: string,
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    userProfile?: UserProfileConstraints,
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

  // ─── 场景化推荐 ───

  async recommendByScenario(
    userId: string,
    mealType: string,
    goalType: string,
    consumed: { calories: number; protein: number },
    target: MealTarget,
    dailyTarget: { calories: number; protein: number },
    userProfile?: UserProfileConstraints,
  ): Promise<{
    takeout: MealRecommendation;
    convenience: MealRecommendation;
    homeCook: MealRecommendation;
  }> {
    const allFoods = await this.getAllFoods();
    const recentFoodNames = await this.getRecentFoodNames(userId, 3);
    const baseConstraints = this.constraintGenerator.generateConstraints(
      goalType,
      consumed,
      target,
      dailyTarget,
      undefined,
      userProfile,
    );

    const userAllergens = userProfile?.allergens;

    const buildForScenario = (
      scenarioTags: string[],
      scenarioName: string,
    ): MealRecommendation => {
      const constraints: Constraint = {
        ...baseConstraints,
        includeTags: [
          ...new Set([...baseConstraints.includeTags, ...scenarioTags]),
        ],
      };

      let candidates = this.foodFilter.filterFoods(
        allFoods,
        constraints,
        mealType,
        userAllergens,
      );
      if (candidates.length < 3) {
        candidates = this.foodFilter.filterFoods(
          allFoods,
          { ...constraints, includeTags: scenarioTags },
          mealType,
          userAllergens,
        );
      }
      if (candidates.length < 3) {
        candidates = this.foodFilter.filterFoods(
          allFoods,
          { ...baseConstraints, includeTags: [] },
          mealType,
          userAllergens,
        );
      }

      const scored = this.foodScorer.scoreFoodsWithServing(
        candidates,
        goalType,
        target,
      );
      const picks = this.mealAssembler.diversify(scored, recentFoodNames, 2);
      return this.mealAssembler.aggregateMealResult(
        picks,
        `${scenarioName}推荐，约 ${picks.reduce((s, p) => s + p.servingCalories, 0)} kcal`,
      );
    };

    return {
      takeout: buildForScenario(['takeout', 'fast_food'], '外卖'),
      convenience: buildForScenario(
        ['low_calorie', 'snack', 'beverage'],
        '便利店',
      ),
      homeCook: buildForScenario(['natural', 'veggie', 'protein'], '在家做'),
    };
  }

  // ─── 从食物池推荐（角色模板 + 份量调整） ───

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
    userProfile?: UserProfileConstraints,
  ): MealRecommendation {
    const constraints = this.constraintGenerator.generateConstraints(
      goalType,
      consumed,
      target,
      dailyTarget,
      mealType,
      userProfile,
    );

    const roles = MEAL_ROLES[mealType] || ['carb', 'protein', 'veggie'];
    const picks: ScoredFood[] = [];
    const usedNames = new Set(excludeNames);

    for (const role of roles) {
      const roleCategories = ROLE_CATEGORIES[role] || [];
      let roleCandidates = allFoods.filter(
        (f) => roleCategories.includes(f.category) && !usedNames.has(f.name),
      );

      // mealType 过滤
      roleCandidates = roleCandidates.filter((f) => {
        const foodMealTypes: string[] = f.mealTypes || [];
        return foodMealTypes.length === 0 || foodMealTypes.includes(mealType);
      });

      // exclude tag 过滤
      if (constraints.excludeTags.length > 0) {
        roleCandidates = roleCandidates.filter((f) => {
          const tags = f.tags || [];
          return !constraints.excludeTags.some((t) => tags.includes(t));
        });
      }

      // 过敏原过滤
      if (userProfile?.allergens?.length) {
        roleCandidates = roleCandidates.filter((f) => {
          const foodAllergens: string[] = f.allergens || [];
          return !userProfile.allergens!.some((a) => foodAllergens.includes(a));
        });
      }

      if (roleCandidates.length === 0) {
        roleCandidates = allFoods.filter((f) => !usedNames.has(f.name));
      }

      // 评分 + 偏好加权
      let scored: ScoredFood[] = roleCandidates
        .map((food) => {
          let score = this.foodScorer.scoreFood(food, goalType, target);

          if (userPreferences) {
            const name = food.name;
            const mainIng = food.mainIngredient || '';
            if (
              userPreferences.loves?.some(
                (l) => name.includes(l) || mainIng.includes(l),
              )
            ) {
              score *= 1.12;
            }
            if (
              userPreferences.avoids?.some(
                (a) => name.includes(a) || mainIng.includes(a),
              )
            ) {
              score *= 0.3;
            }
          }

          if (feedbackWeights && feedbackWeights[food.name]) {
            score *= feedbackWeights[food.name];
          }

          return {
            food,
            score,
            ...this.foodScorer.calcServingNutrition(food),
          };
        })
        .sort((a, b) => b.score - a.score);

      scored = this.mealAssembler.addExploration(scored, 0.15);

      if (picks.length > 0) {
        scored = scored
          .map((sf) => {
            const penalty = picks.reduce(
              (sum, p) =>
                sum + this.mealAssembler.similarity(sf.food, p.food) * 0.3,
              0,
            );
            return { ...sf, score: sf.score - penalty };
          })
          .sort((a, b) => b.score - a.score);
      }

      if (scored.length > 0) {
        picks.push(scored[0]);
        usedNames.add(scored[0].food.name);
      }
    }

    const adjustedPicks = this.mealAssembler.adjustPortions(
      picks,
      target.calories,
    );
    const tip = this.mealAssembler.buildTip(
      mealType,
      goalType,
      target,
      adjustedPicks.reduce((s, p) => s + p.servingCalories, 0),
    );
    return this.mealAssembler.aggregateMealResult(adjustedPicks, tip);
  }

  // ─── 数据访问 ───

  async getAllFoods(): Promise<FoodLibrary[]> {
    return this.foodLibraryRepo.find({ where: { isVerified: true } });
  }

  async getUserFeedbackWeights(
    userId: string,
  ): Promise<Record<string, number>> {
    const weights: Record<string, number> = {};
    try {
      const since = new Date();
      since.setDate(since.getDate() - 30);

      const feedbacks = await this.feedbackRepo
        .createQueryBuilder('f')
        .where('f.user_id = :userId', { userId })
        .andWhere('f.created_at >= :since', { since })
        .getMany();

      const stats: Record<string, { accepted: number; rejected: number }> = {};
      for (const fb of feedbacks) {
        if (!stats[fb.foodName])
          stats[fb.foodName] = { accepted: 0, rejected: 0 };
        if (fb.action === 'accepted') {
          stats[fb.foodName].accepted++;
        } else {
          stats[fb.foodName].rejected++;
        }
      }

      for (const [name, s] of Object.entries(stats)) {
        const total = s.accepted + s.rejected;
        if (total < 2) continue;
        const acceptRate = s.accepted / total;
        weights[name] = 0.3 + acceptRate * 1.0;
      }
    } catch (err) {
      this.logger.warn(`获取反馈权重失败: ${err}`);
    }
    return weights;
  }

  async getRecentFoodNames(userId: string, days: number): Promise<string[]> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const records: Array<{ name: string }> = await this.foodRecordRepo.query(
        `SELECT DISTINCT food_item->>'name' AS name
         FROM food_records fr
         CROSS JOIN LATERAL jsonb_array_elements(fr.foods) AS food_item
         WHERE fr.user_id = $1
           AND fr.recorded_at >= $2`,
        [userId, since],
      );

      return records.map((r) => r.name);
    } catch {
      return [];
    }
  }
}
