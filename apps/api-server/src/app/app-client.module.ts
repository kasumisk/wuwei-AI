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
// 服务
import { AppAuthService } from './services/app-auth.service';
import { AppUpdateService } from './services/app-update.service';
import { SmsService } from './services/sms.service';
import { WechatAuthService } from './services/wechat-auth.service';
import { AnalyzeService } from './services/analyze.service';
import { FoodService } from './services/food.service';
import { UserProfileService } from './services/user-profile.service';
import { CoachService } from './services/coach.service';
import { FoodLibraryService } from './services/food-library.service';
import { DailyPlanService } from './services/daily-plan.service';
import { BehaviorService } from './services/behavior.service';
import { GamificationService } from './services/gamification.service';
import { NutritionScoreService } from './services/nutrition-score.service';
import { RecommendationEngineService } from './services/recommendation-engine.service';
// 控制器
import { AppAuthController } from './app.controller';
import { AppFileController } from './controllers/file.controller';
import { AppUpdateController } from './controllers/update.controller';
import { FoodController } from './controllers/food.controller';
import { CoachController } from './controllers/coach.controller';
import { FoodLibraryController } from './controllers/food-library.controller';
import { GamificationController } from './controllers/gamification.controller';
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
    FoodService,
    UserProfileService,
    CoachService,
    FoodLibraryService,
    DailyPlanService,
    BehaviorService,
    GamificationService,
    NutritionScoreService,
    RecommendationEngineService,
    // 守卫和策略
    AppJwtStrategy,
    AppJwtAuthGuard,
  ],
  controllers: [
    AppAuthController,
    AppFileController,
    AppUpdateController,
    FoodController,
    CoachController,
    FoodLibraryController,
    GamificationController,
  ],
  exports: [
    AppAuthService,
    AppUpdateService,
    AppJwtAuthGuard,
    FoodService,
    UserProfileService,
    CoachService,
    FoodLibraryService,
    DailyPlanService,
    BehaviorService,
    GamificationService,
    NutritionScoreService,
    RecommendationEngineService,
  ],
})
export class AppClientModule {}
