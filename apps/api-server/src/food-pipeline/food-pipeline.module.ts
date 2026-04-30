import { forwardRef, Module } from '@nestjs/common';
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
import { FoodPipelineOrchestratorService } from './services/food-pipeline-orchestrator.service';
import { FoodSyncSchedulerService } from './services/food-sync-scheduler.service';
import { FoodQualityMonitorService } from './services/food-quality-monitor.service';
import { CnFoodCompositionImporterService } from './services/fetchers/cn-food-composition-importer.service';
import { FoodEnrichmentService } from './services/food-enrichment.service';
import { EnrichmentAiClient } from './services/enrichment/services/ai-client.service';
import { EnrichmentCompletenessService } from './services/enrichment/services/enrichment-completeness.service';
import { EnrichmentApplyService } from './services/enrichment/services/enrichment-apply.service';
import { EnrichmentStatsService } from './services/enrichment/services/enrichment-stats.service';
import { EnrichmentI18nService } from './services/enrichment/services/enrichment-i18n.service';
import {
  EnrichmentStagingService,
  ENRICHMENT_APPLY_SERVICE,
} from './services/enrichment/services/enrichment-staging.service';
import { EnrichmentStageService } from './services/enrichment/services/enrichment-stage.service';
import { EnrichmentScanService } from './services/enrichment/services/enrichment-scan.service';
import { EnrichmentDirectService } from './services/enrichment/services/enrichment-direct.service';
import { EnrichmentNowService } from './services/enrichment/services/enrichment-now.service';
import { EnrichmentReEnqueueService } from './services/enrichment/services/enrichment-reenqueue.service';
import { FoodEnrichmentProcessor } from './food-enrichment.processor';
import { FoodUsdaImportProcessor } from './food-usda-import.processor';
// Controllers
import { FoodPipelineController } from './controllers/food-pipeline.controller';
import { FoodEnrichmentController } from './controllers/food-enrichment.controller';
import { QUEUE_NAMES } from '../core/queue';
import { FoodModule } from '../modules/food/food.module';

@Module({
  imports: [
    ConfigModule,
    HttpModule.register({ timeout: 30000 }),
    BullModule.registerQueue({ name: QUEUE_NAMES.FOOD_ENRICHMENT }),
    BullModule.registerQueue({ name: QUEUE_NAMES.FOOD_USDA_IMPORT }),
    forwardRef(() => FoodModule),
    // V6.5 Phase 1J: ScheduleModule.forRoot() 已迁移到 AppModule（全局唯一注册）
  ],
  providers: [
    FoodRuleEngineService,
    UsdaFetcherService,
    OpenFoodFactsService,
    FoodDataCleanerService,
    FoodDedupService,
    FoodConflictResolverService,
    FoodPipelineOrchestratorService,
    FoodSyncSchedulerService,
    FoodQualityMonitorService,
    CnFoodCompositionImporterService,
    // V6.6: Food Enrichment
    EnrichmentAiClient,
    EnrichmentCompletenessService,
    EnrichmentApplyService,
    EnrichmentStatsService,
    EnrichmentI18nService,
    EnrichmentStageService,
    EnrichmentScanService,
    EnrichmentDirectService,
    EnrichmentNowService,
    EnrichmentReEnqueueService,
    {
      provide: ENRICHMENT_APPLY_SERVICE,
      useExisting: FoodEnrichmentService,
    },
    EnrichmentStagingService,
    FoodEnrichmentService,
    FoodEnrichmentProcessor,
    FoodUsdaImportProcessor,
  ],
  controllers: [FoodPipelineController, FoodEnrichmentController],
  exports: [
    FoodRuleEngineService,
    FoodPipelineOrchestratorService,
    FoodQualityMonitorService,
    CnFoodCompositionImporterService,
    FoodEnrichmentService,
  ],
})
export class FoodPipelineModule {}
