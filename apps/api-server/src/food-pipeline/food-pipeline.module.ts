import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { ScheduleModule } from '@nestjs/schedule';
import { FoodLibrary } from '../modules/food/entities/food-library.entity';
import { FoodTranslation } from '../modules/food/entities/food-translation.entity';
import { FoodSource } from '../modules/food/entities/food-source.entity';
import { FoodChangeLog } from '../modules/food/entities/food-change-log.entity';
import { FoodConflict } from '../modules/food/entities/food-conflict.entity';
import { FoodRegionalInfo } from '../modules/food/entities/food-regional-info.entity';
// Services
import { FoodRuleEngineService } from './services/food-rule-engine.service';
import { UsdaFetcherService } from './services/usda-fetcher.service';
import { OpenFoodFactsService } from './services/openfoodfacts.service';
import { FoodDataCleanerService } from './services/food-data-cleaner.service';
import { FoodDedupService } from './services/food-dedup.service';
import { FoodConflictResolverService } from './services/food-conflict-resolver.service';
import { FoodAiLabelService } from './services/food-ai-label.service';
import { FoodAiTranslateService } from './services/food-ai-translate.service';
import { FoodImageRecognitionService } from './services/food-image-recognition.service';
import { FoodPipelineOrchestratorService } from './services/food-pipeline-orchestrator.service';
import { FoodSyncSchedulerService } from './services/food-sync-scheduler.service';
import { FoodQualityMonitorService } from './services/food-quality-monitor.service';
// Controller
import { FoodPipelineController } from './food-pipeline.controller';

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
    ConfigModule,
    HttpModule.register({ timeout: 30000 }),
    ScheduleModule.forRoot(),
  ],
  providers: [
    FoodRuleEngineService,
    UsdaFetcherService,
    OpenFoodFactsService,
    FoodDataCleanerService,
    FoodDedupService,
    FoodConflictResolverService,
    FoodAiLabelService,
    FoodAiTranslateService,
    FoodImageRecognitionService,
    FoodPipelineOrchestratorService,
    FoodSyncSchedulerService,
    FoodQualityMonitorService,
  ],
  controllers: [FoodPipelineController],
  exports: [
    FoodRuleEngineService,
    FoodPipelineOrchestratorService,
    FoodImageRecognitionService,
    FoodQualityMonitorService,
  ],
})
export class FoodPipelineModule {}
