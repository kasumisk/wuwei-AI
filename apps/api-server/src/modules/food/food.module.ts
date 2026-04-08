import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FoodLibrary } from './entities/food-library.entity';
import { FoodTranslation } from './entities/food-translation.entity';
import { FoodSource } from './entities/food-source.entity';
import { FoodChangeLog } from './entities/food-change-log.entity';
import { FoodConflict } from './entities/food-conflict.entity';
import { FoodRegionalInfo } from './entities/food-regional-info.entity';
import { FoodService } from './services/food.service';
import { FoodController } from './controllers/food.controller';
import { AdminFoodController } from './controllers/admin-food.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FoodLibrary,
      FoodTranslation,
      FoodSource,
      FoodChangeLog,
      FoodConflict,
      FoodRegionalInfo,
    ]),
  ],
  controllers: [FoodController, AdminFoodController],
  providers: [FoodService],
  exports: [FoodService, TypeOrmModule],
})
export class FoodModule {}
