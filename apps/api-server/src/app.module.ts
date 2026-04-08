import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';

// Infrastructure
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { LoggerMiddleware } from './infrastructure/common/middlewares/logger.middleware';

// Domain Modules
import { AuthModule } from './modules/auth/auth.module';
import { FoodModule } from './modules/food/food.module';
import { UserProfileModule } from './modules/user-profile/user-profile.module';
import { NutritionModule } from './modules/nutrition/nutrition.module';
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { MealPlanModule } from './modules/meal-plan/meal-plan.module';
import { CoachModule } from './modules/coach/coach.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { AdminManagementModule } from './modules/admin/admin-management.module';

@Module({
  imports: [
    // Infrastructure (Config, DB, Storage, AiGateway, Health, Logger, Swagger)
    InfrastructureModule,

    // Domain Modules (DAG dependency order)
    AuthModule,
    FoodModule,
    UserProfileModule,
    NutritionModule,
    RecommendationModule,
    MealPlanModule,
    CoachModule,
    GamificationModule,
    AdminManagementModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
