import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecommendationFeedback } from './entities/recommendation-feedback.entity';
import { AiDecisionLog } from './entities/ai-decision-log.entity';
import { RecommendationService } from './services/recommendation.service';
import { RecommendationController } from './controllers/recommendation.controller';
import { FoodModule } from '../food/food.module';
import { NutritionModule } from '../nutrition/nutrition.module';
import { UserProfileModule } from '../user-profile/user-profile.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RecommendationFeedback, AiDecisionLog]),
    FoodModule,
    NutritionModule,
    UserProfileModule,
  ],
  controllers: [RecommendationController],
  providers: [RecommendationService],
  exports: [RecommendationService],
})
export class RecommendationModule {}
