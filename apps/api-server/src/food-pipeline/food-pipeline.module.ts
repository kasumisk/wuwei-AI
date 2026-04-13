import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { BullModule } from '@nestjs/bullmq';
// Services
import { FoodRuleEngineService } from './services/processing/food-rule-engine.service';
import { UsdaFetcherService } from './services/fetchers/usda-fetcher.service';
import { OpenFoodFactsService } from './services/fetchers/openfoodfacts.service';
import { FoodDataCleanerService } from './services/processing/food-data-cleaner.service';
import { FoodDedupService } from './services/processing/food-dedup.service';
import { FoodConflictResolverService } from './services/processing/food-conflict-resolver.service';
import { FoodAiLabelService } from './services/ai/food-ai-label.service';
import { FoodAiTranslateService } from './services/ai/food-ai-translate.service';
import { FoodImageRecognitionService } from './services/ai/food-image-recognition.service';
import { FoodPipelineOrchestratorService } from './services/food-pipeline-orchestrator.service';
import { FoodSyncSchedulerService } from './services/food-sync-scheduler.service';
import { FoodQualityMonitorService } from './services/food-quality-monitor.service';
import { CnFoodCompositionImporterService } from './services/fetchers/cn-food-composition-importer.service';
import { FoodEnrichmentService } from './services/food-enrichment.service';
import { FoodEnrichmentProcessor } from './food-enrichment.processor';
// Controllers
import { FoodPipelineController } from './controllers/food-pipeline.controller';
import { FoodEnrichmentController } from './controllers/food-enrichment.controller';
import { QUEUE_NAMES } from '../core/queue';

@Module({
  imports: [
    ConfigModule,
    HttpModule.register({ timeout: 30000 }),
    BullModule.registerQueue({ name: QUEUE_NAMES.FOOD_ENRICHMENT }),
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
    // V6.6: Food Enrichment
    FoodEnrichmentService,
    FoodEnrichmentProcessor,
  ],
  controllers: [FoodPipelineController, FoodEnrichmentController],
  exports: [
    FoodRuleEngineService,
    FoodPipelineOrchestratorService,
    FoodImageRecognitionService,
    FoodQualityMonitorService,
    CnFoodCompositionImporterService,
    FoodEnrichmentService,
  ],
})
export class FoodPipelineModule {}
