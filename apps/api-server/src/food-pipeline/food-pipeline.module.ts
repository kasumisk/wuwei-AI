import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
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
import { CnFoodCompositionImporterService } from './services/cn-food-composition-importer.service';
// Controller
import { FoodPipelineController } from './food-pipeline.controller';

@Module({
  imports: [
    ConfigModule,
    HttpModule.register({ timeout: 30000 }),
    // V6.5 Phase 1J: ScheduleModule.forRoot() 已迁移到 AppModule（全局唯一注册）
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
    CnFoodCompositionImporterService,
  ],
  controllers: [FoodPipelineController],
  exports: [
    FoodRuleEngineService,
    FoodPipelineOrchestratorService,
    FoodImageRecognitionService,
    FoodQualityMonitorService,
    CnFoodCompositionImporterService,
  ],
})
export class FoodPipelineModule {}
