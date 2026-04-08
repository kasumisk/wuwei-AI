import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DailyPlan } from './entities/daily-plan.entity';
import { MealPlanService } from './services/meal-plan.service';
import { MealPlanController } from './controllers/meal-plan.controller';
import { UserProfileModule } from '../user-profile/user-profile.module';
import { RecommendationModule } from '../recommendation/recommendation.module';
import { NutritionModule } from '../nutrition/nutrition.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([DailyPlan]),
    UserProfileModule,
    RecommendationModule,
    NutritionModule,
  ],
  controllers: [MealPlanController],
  providers: [MealPlanService],
  exports: [MealPlanService],
})
export class MealPlanModule {}
