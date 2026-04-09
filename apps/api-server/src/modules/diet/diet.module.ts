import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
// 本模块实体
import { FoodRecord } from './entities/food-record.entity';
import { DailySummary } from './entities/daily-summary.entity';
import { DailyPlan } from './entities/daily-plan.entity';
import { AiDecisionLog } from './entities/ai-decision-log.entity';
import { RecommendationFeedback } from './entities/recommendation-feedback.entity';
// 跨模块实体
import { UserBehaviorProfile } from '../user/entities/user-behavior-profile.entity';
import { FoodLibrary } from '../food/entities/food-library.entity';
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
import { FoodController } from './app/food.controller';
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
// Admin 端
import { ContentManagementController } from './admin/content-management.controller';
import { ContentManagementService } from './admin/content-management.service';
import { AppDataQueryService } from './admin/app-data-query.service';

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
      UserBehaviorProfile,
      FoodLibrary,
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
    FoodController,
    FoodRecordController,
    FoodSummaryController,
    FoodPlanController,
    FoodBehaviorController,
    FoodNutritionController,
    ContentManagementController,
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
    ContentManagementService,
    AppDataQueryService,
  ],
  exports: [
    FoodService,
    FoodRecordService,
    DailySummaryService,
    BehaviorService,
    NutritionScoreService,
    RecommendationEngineService,
    ContentManagementService,
  ],
})
export class DietModule {}
