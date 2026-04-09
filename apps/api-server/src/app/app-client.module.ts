import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
// 实体
import { AppUser } from '../entities/app-user.entity';
import { AppVersion } from '../entities/app-version.entity';
import { AppVersionPackage } from '../entities/app-version-package.entity';
import { FoodRecord } from '../entities/food-record.entity';
import { DailySummary } from '../entities/daily-summary.entity';
import { UserProfile } from '../entities/user-profile.entity';
import { CoachConversation } from '../entities/coach-conversation.entity';
import { CoachMessage } from '../entities/coach-message.entity';
import { FoodLibrary } from '../entities/food-library.entity';
import { DailyPlan } from '../entities/daily-plan.entity';
import { UserBehaviorProfile } from '../entities/user-behavior-profile.entity';
import { AiDecisionLog } from '../entities/ai-decision-log.entity';
import { Achievement } from '../entities/achievement.entity';
import { UserAchievement } from '../entities/user-achievement.entity';
import { Challenge } from '../entities/challenge.entity';
import { UserChallenge } from '../entities/user-challenge.entity';
import { RecommendationFeedback } from '../entities/recommendation-feedback.entity';
import { UserInferredProfile } from '../entities/user-inferred-profile.entity';
import { ProfileSnapshot } from '../entities/profile-snapshot.entity';
// 服务
import { AppAuthService } from './services/app-auth.service';
import { AppUpdateService } from './services/app-update.service';
import { SmsService } from './services/sms.service';
import { WechatAuthService } from './services/wechat-auth.service';
import { AnalyzeService } from './services/analyze.service';
import { FoodService } from './services/food.service';
import { FoodRecordService } from './services/food-record.service';
import { DailySummaryService } from './services/daily-summary.service';
import { UserProfileService } from './services/user-profile.service';
import { CoachService } from './services/coach.service';
import { FoodLibraryService } from './services/food-library.service';
import { DailyPlanService } from './services/daily-plan.service';
import { BehaviorService } from './services/behavior.service';
import { GamificationService } from './services/gamification.service';
import { NutritionScoreService } from './services/nutrition-score.service';
import { RecommendationEngineService } from './services/recommendation-engine.service';
import { ConstraintGeneratorService } from './services/recommendation/constraint-generator.service';
import { FoodFilterService } from './services/recommendation/food-filter.service';
import { FoodScorerService } from './services/recommendation/food-scorer.service';
import { MealAssemblerService } from './services/recommendation/meal-assembler.service';
import { ProfileInferenceService } from './services/profile-inference.service';
import { ProfileCacheService } from './services/profile-cache.service';
import { ProfileCronService } from './services/profile-cron.service';
import { CollectionTriggerService } from './services/collection-trigger.service';
// 控制器
import { AppAuthController } from './app.controller';
import { AppFileController } from './controllers/file.controller';
import { AppUpdateController } from './controllers/update.controller';
import { FoodAnalyzeController } from './controllers/food-analyze.controller';
import { FoodRecordController } from './controllers/food-record.controller';
import { FoodSummaryController } from './controllers/food-summary.controller';
import { FoodPlanController } from './controllers/food-plan.controller';
import { FoodBehaviorController } from './controllers/food-behavior.controller';
import { FoodNutritionController } from './controllers/food-nutrition.controller';
import { CoachController } from './controllers/coach.controller';
import { FoodLibraryController } from './controllers/food-library.controller';
import { GamificationController } from './controllers/gamification.controller';
import { UserProfileController } from './controllers/user-profile.controller';
// 守卫和策略
import { AppJwtStrategy } from './strategies/app-jwt.strategy';
import { AppJwtAuthGuard } from './guards/app-jwt-auth.guard';
// 存储模块
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [
    ConfigModule,
    StorageModule,
    TypeOrmModule.forFeature([
      AppUser,
      AppVersion,
      AppVersionPackage,
      FoodRecord,
      DailySummary,
      UserProfile,
      CoachConversation,
      CoachMessage,
      FoodLibrary,
      DailyPlan,
      UserBehaviorProfile,
      AiDecisionLog,
      Achievement,
      UserAchievement,
      Challenge,
      UserChallenge,
      RecommendationFeedback,
      UserInferredProfile,
      ProfileSnapshot,
    ]),
    PassportModule.register({ defaultStrategy: 'app-jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      signOptions: {
        expiresIn: '30d', // App 用户 token 有效期更长
      },
    }),
  ],
  providers: [
    // 服务
    AppAuthService,
    AppUpdateService,
    SmsService,
    WechatAuthService,
    AnalyzeService,
    FoodRecordService,
    DailySummaryService,
    FoodService,
    UserProfileService,
    CoachService,
    FoodLibraryService,
    DailyPlanService,
    BehaviorService,
    GamificationService,
    NutritionScoreService,
    RecommendationEngineService,
    ConstraintGeneratorService,
    FoodFilterService,
    FoodScorerService,
    MealAssemblerService,
    ProfileInferenceService,
    ProfileCacheService,
    ProfileCronService,
    CollectionTriggerService,
    // 守卫和策略
    AppJwtStrategy,
    AppJwtAuthGuard,
  ],
  controllers: [
    AppAuthController,
    AppFileController,
    AppUpdateController,
    FoodAnalyzeController,
    FoodRecordController,
    FoodSummaryController,
    FoodPlanController,
    FoodBehaviorController,
    FoodNutritionController,
    CoachController,
    FoodLibraryController,
    GamificationController,
    UserProfileController,
  ],
  exports: [
    AppAuthService,
    AppUpdateService,
    AppJwtAuthGuard,
    FoodService,
    FoodRecordService,
    DailySummaryService,
    UserProfileService,
    CoachService,
    FoodLibraryService,
    DailyPlanService,
    BehaviorService,
    GamificationService,
    NutritionScoreService,
    RecommendationEngineService,
    ProfileInferenceService,
    ProfileCacheService,
    CollectionTriggerService,
  ],
})
export class AppClientModule {}
