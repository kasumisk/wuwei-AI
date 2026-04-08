import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodLibrary } from '../../food/entities/food-library.entity';
import { FoodService } from '../../food/services/food.service';
import { NutritionScoringService } from '../../nutrition/services/nutrition-scoring.service';
import { NutritionService } from '../../nutrition/services/nutrition.service';
import { UserProfileService } from '../../user-profile/services/user-profile.service';
import { RecommendationFeedback } from '../entities/recommendation-feedback.entity';
import { AiDecisionLog } from '../entities/ai-decision-log.entity';
import { betaSample } from '../../../shared/utils/math.utils';
import { DECISION_THRESHOLDS } from '../../../shared/constants/nutrition.constants';
import { MEAL_PREFERENCES } from '../../../shared/constants/food.constants';
import { ScoredFood } from '../../../shared/interfaces/scored-food.interface';

@Injectable()
export class RecommendationService {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(
    private foodService: FoodService,
    private scoringService: NutritionScoringService,
    private nutritionService: NutritionService,
    private profileService: UserProfileService,
    @InjectRepository(RecommendationFeedback)
    private feedbackRepo: Repository<RecommendationFeedback>,
    @InjectRepository(AiDecisionLog)
    private decisionLogRepo: Repository<AiDecisionLog>,
  ) {}

  /**
   * 3阶段推荐管线: Recall → Ranking → Re-ranking
   */
  async recommend(userId: string, mealType: string, topN = 5): Promise<ScoredFood[]> {
    const profile = await this.profileService.getOrCreate(userId);
    const consumed = await this.nutritionService.getTodayConsumed(userId);
    const dailyCalorieGoal = profile.dailyCalorieGoal || 2000;
    const goal = profile.goal || 'health';

    // Stage 1: Recall — fetch candidates from food library
    const candidates = await this.recall(mealType, profile.dietaryRestrictions || []);

    // Stage 2: Ranking — score each candidate
    const scored = candidates.map((food) =>
      this.scoringService.scoreFoodForUser(food, goal, mealType, dailyCalorieGoal, consumed),
    );

    // Stage 3: Re-ranking with Thompson Sampling
    const reranked = await this.rerank(scored, userId, mealType);

    // Take top N
    const result = reranked.slice(0, topN);

    // Log decision
    await this.logDecision(userId, mealType, result);

    return result;
  }

  /**
   * Stage 1: Recall
   * Filter foods by meal type, dietary restrictions, and availability
   */
  private async recall(mealType: string, restrictions: string[]): Promise<FoodLibrary[]> {
    let candidates = await this.foodService.findActiveByMealType(mealType, 200);

    // Apply dietary restrictions
    if (restrictions.length > 0) {
      candidates = candidates.filter((food) => {
        const foodTags = food.tags || [];
        return !restrictions.some((r) => foodTags.includes(r));
      });
    }

    return candidates;
  }

  /**
   * Stage 3: Re-ranking with Thompson Sampling
   * Uses Beta distribution to balance exploitation (high score) vs exploration (uncertain)
   */
  private async rerank(
    scored: ScoredFood[],
    userId: string,
    mealType: string,
  ): Promise<ScoredFood[]> {
    // Get user's past feedback for Thompson Sampling parameters
    const feedbacks = await this.feedbackRepo.find({
      where: { userId, mealType },
      order: { createdAt: 'DESC' },
      take: 200,
    });

    // Build alpha/beta per food
    const feedbackMap = new Map<string, { alpha: number; beta: number }>();
    for (const fb of feedbacks) {
      const key = fb.foodName;
      if (!feedbackMap.has(key)) {
        feedbackMap.set(key, { alpha: 1, beta: 1 }); // Prior: Beta(1,1)
      }
      const params = feedbackMap.get(key)!;
      if (fb.action === 'accepted') {
        params.alpha += 1;
      } else {
        params.beta += 1;
      }
    }

    // Apply Thompson Sampling: sample from Beta distribution
    const withThompson = scored.map((item) => {
      const params = feedbackMap.get(item.food.name) || { alpha: 1, beta: 1 };
      const thompsonSample = betaSample(params.alpha, params.beta);
      // Combine: 70% nutrition score + 30% Thompson sample
      const combinedScore = 0.7 * (item.score / 100) + 0.3 * thompsonSample;
      return { ...item, thompsonScore: combinedScore };
    });

    // Sort by combined score
    withThompson.sort((a, b) => b.thompsonScore - a.thompsonScore);

    return withThompson;
  }

  /**
   * Record user feedback on a recommendation
   */
  async submitFeedback(
    userId: string,
    data: {
      mealType: string;
      foodName: string;
      foodId?: string;
      action: 'accepted' | 'replaced' | 'skipped';
      replacementFood?: string;
      recommendationScore?: number;
      goalType?: string;
    },
  ): Promise<RecommendationFeedback> {
    const feedback = this.feedbackRepo.create({
      userId,
      ...data,
    });
    return this.feedbackRepo.save(feedback);
  }

  private async logDecision(userId: string, mealType: string, result: ScoredFood[]): Promise<void> {
    const log = this.decisionLogRepo.create({
      userId,
      inputContext: { mealType, topFoods: result.slice(0, 3).map(r => r.food.name) },
      fullResponse: { result: result.map(r => ({ food: r.food.name, score: r.score })) },
    });
    await this.decisionLogRepo.save(log);
  }
}
