import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FoodRecord } from './entities/food-record.entity';
import { DailySummary } from './entities/daily-summary.entity';
import { NutritionService } from './services/nutrition.service';
import { NutritionScoringService } from './services/nutrition-scoring.service';
import { NutritionController } from './controllers/nutrition.controller';

@Module({
  imports: [TypeOrmModule.forFeature([FoodRecord, DailySummary])],
  controllers: [NutritionController],
  providers: [NutritionService, NutritionScoringService],
  exports: [NutritionService, NutritionScoringService, TypeOrmModule],
})
export class NutritionModule {}
