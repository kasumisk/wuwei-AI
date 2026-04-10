import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
// 本模块实体
import { FoodRecord } from './entities/food-record.entity';
import { DailySummary } from './entities/daily-summary.entity';
import { DailyPlan } from './entities/daily-plan.entity';
import { AiDecisionLog } from './entities/ai-decision-log.entity';
import { RecommendationFeedback } from './entities/recommendation-feedback.entity';
import { FeedbackDetail } from './entities/feedback-detail.entity';
import { ABExperiment } from './entities/ab-experiment.entity';
import { PrecomputedRecommendation } from './entities/precomputed-recommendation.entity';
// 跨模块实体
import { UserBehaviorProfile } from '../user/entities/user-behavior-profile.entity';
import { UserInferredProfile } from '../user/entities/user-inferred-profile.entity';
import { FoodLibrary } from '../food/entities/food-library.entity';
import { FoodRegionalInfo } from '../food/entities/food-regional-info.entity';
// ContentManagement 所需实体 (跨模块)
import { Achievement } from '../gamification/entities/achievement.entity';
import { UserAchievement } from '../gamification/entities/user-achievement.entity';
import { Challenge } from '../gamification/entities/challenge.entity';
import { UserChallenge } from '../gamification/entities/user-challenge.entity';
import { CoachConversation } from '../coach/entities/coach-conversation.entity';
import { CoachMessage } from '../coach/entities/coach-message.entity';
// 依赖模块
import { UserModule } from '../user/user.module';
import { FoodModule } from '../food/food.module';
// App 端控制器
import { FoodRecordController } from './app/food-record.controller';
import { FoodSummaryController } from './app/food-summary.controller';
import { FoodPlanController } from './app/food-plan.controller';
import { FoodBehaviorController } from './app/food-behavior.controller';
import { FoodNutritionController } from './app/food-nutrition.controller';
// App 端服务
import { FoodService } from './app/food.service';
import { FoodRecordService } from './app/food-record.service';
import { DailySummaryService } from './app/daily-summary.service';
import { DailyPlanService } from './app/daily-plan.service';
import { NutritionScoreService } from './app/nutrition-score.service';
import { BehaviorService } from './app/behavior.service';
import { RecommendationEngineService } from './app/recommendation-engine.service';
import { ConstraintGeneratorService } from './app/recommendation/constraint-generator.service';
import { FoodFilterService } from './app/recommendation/food-filter.service';
import { FoodScorerService } from './app/recommendation/food-scorer.service';
import { MealAssemblerService } from './app/recommendation/meal-assembler.service';
import { HealthModifierEngineService } from './app/recommendation/health-modifier-engine.service';
import { FoodPoolCacheService } from './app/recommendation/food-pool-cache.service';
import { RecommendationFeedbackService } from './app/recommendation/feedback.service';
import { PreferenceProfileService } from './app/recommendation/preference-profile.service';
import { SubstitutionService } from './app/recommendation/substitution.service';
import { PreferenceUpdaterService } from './app/recommendation/preference-updater.service';
import { ABTestingService } from './app/recommendation/ab-testing.service';
import { CollaborativeFilteringService } from './app/recommendation/collaborative-filtering.service';
import { VectorSearchService } from './app/recommendation/vector-search.service';
import { ExplanationGeneratorService } from './app/recommendation/explanation-generator.service';
import { WeightLearnerService } from './app/recommendation/weight-learner.service';
import { WeeklyPlanService } from './app/weekly-plan.service';
import { PrecomputeService } from './app/precompute.service';
import { PrecomputeProcessor } from './app/precompute.processor';
// Admin 端
import { ContentManagementController } from './admin/content-management.controller';
import { ContentManagementService } from './admin/content-management.service';
import { RecommendationQualityService } from './admin/recommendation-quality.service';
import { AppDataQueryService } from './admin/app-data-query.service';
import { ABExperimentManagementController } from './admin/ab-experiment-management.controller';
import { ABExperimentManagementService } from './admin/ab-experiment-management.service';
import { RecommendationDebugController } from './admin/recommendation-debug.controller';
import { RecommendationDebugService } from './admin/recommendation-debug.service';

@Module({
  imports: [
    ConfigModule,
    UserModule,
    forwardRef(() => FoodModule),
    TypeOrmModule.forFeature([
      FoodRecord,
      DailySummary,
      DailyPlan,
      AiDecisionLog,
      RecommendationFeedback,
      FeedbackDetail,
      ABExperiment,
      PrecomputedRecommendation,
      UserBehaviorProfile,
      UserInferredProfile,
      FoodLibrary,
      FoodRegionalInfo,
      // ContentManagement 需要的实体
      Achievement,
      UserAchievement,
      Challenge,
      UserChallenge,
      CoachConversation,
      CoachMessage,
    ]),
  ],
  controllers: [
    FoodRecordController,
    FoodSummaryController,
    FoodPlanController,
    FoodBehaviorController,
    FoodNutritionController,
    ContentManagementController,
    ABExperimentManagementController,
    RecommendationDebugController,
  ],
  providers: [
    FoodService,
    FoodRecordService,
    DailySummaryService,
    DailyPlanService,
    NutritionScoreService,
    BehaviorService,
    RecommendationEngineService,
    ConstraintGeneratorService,
    FoodFilterService,
    FoodScorerService,
    MealAssemblerService,
    HealthModifierEngineService,
    FoodPoolCacheService,
    RecommendationFeedbackService,
    PreferenceProfileService,
    SubstitutionService,
    PreferenceUpdaterService,
    ABTestingService,
    CollaborativeFilteringService,
    VectorSearchService,
    ExplanationGeneratorService,
    WeightLearnerService,
    WeeklyPlanService,
    PrecomputeService,
    PrecomputeProcessor,
    ContentManagementService,
    RecommendationQualityService,
    AppDataQueryService,
    ABExperimentManagementService,
    RecommendationDebugService,
  ],
  exports: [
    FoodService,
    FoodRecordService,
    DailySummaryService,
    BehaviorService,
    NutritionScoreService,
    RecommendationEngineService,
    ContentManagementService,
    PrecomputeService,
  ],
})
export class DietModule {}
