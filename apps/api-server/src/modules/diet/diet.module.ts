import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
  imports: [ConfigModule, UserModule, forwardRef(() => FoodModule)],
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
