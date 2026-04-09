import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
// 实体
import { FoodLibrary } from './entities/food-library.entity';
import { FoodTranslation } from './entities/food-translation.entity';
import { FoodSource } from './entities/food-source.entity';
import { FoodChangeLog } from './entities/food-change-log.entity';
import { FoodConflict } from './entities/food-conflict.entity';
import { FoodRegionalInfo } from './entities/food-regional-info.entity';
// App 端
import { FoodLibraryController } from './app/food-library.controller';
import { FoodLibraryService } from './app/food-library.service';
import { FoodAnalyzeController } from './app/food-analyze.controller';
import { AnalyzeService } from './app/analyze.service';
// Admin 端
import { FoodLibraryManagementController } from './admin/food-library-management.controller';
import { FoodLibraryManagementService } from './admin/food-library-management.service';
import { DietModule } from '../diet/diet.module';
import { UserModule } from '../user/user.module';

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
    forwardRef(() => DietModule),
    forwardRef(() => UserModule),
  ],
  controllers: [
    FoodLibraryController,
    FoodAnalyzeController,
    FoodLibraryManagementController,
  ],
  providers: [FoodLibraryService, AnalyzeService, FoodLibraryManagementService],
  exports: [FoodLibraryService, AnalyzeService, TypeOrmModule],
})
export class FoodModule {}
