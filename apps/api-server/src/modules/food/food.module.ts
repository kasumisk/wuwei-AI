import { Module, forwardRef } from '@nestjs/common';
// App 端
import { FoodLibraryController } from './app/controllers/food-library.controller';
import { FoodLibraryService } from './app/services/food-library.service';
import { FoodAnalyzeController } from './app/controllers/food-analyze.controller';
// Phase 7: 拆分子控制器
import { FoodImageAnalyzeController } from './app/controllers/food-image-analyze.controller';
import { FoodTextAnalyzeController } from './app/controllers/food-text-analyze.controller';
import { FoodAnalysisHistoryController } from './app/controllers/food-analysis-history.controller';
import { FoodAnalysisSaveController } from './app/controllers/food-analysis-save.controller';
import { AnalyzeResultHelperService } from './app/services/analyze-result-helper.service';
import { FoodAnalysisReportController } from './app/controllers/food-analysis-report.controller';
import { AnalyzeService } from './app/services/analyze.service';
// V6 Phase 1.4: AI 分析队列处理器
import { FoodAnalysisProcessor } from './app/processors/food-analysis.processor';
// V6.1 Phase 1.6: 文本分析服务
import { TextFoodAnalysisService } from './app/services/text-food-analysis.service';
// V6.1 Phase 2.3: 图片分析服务（从 AnalyzeService 拆分出的核心分析逻辑）
import { ImageFoodAnalysisService } from './app/services/image-food-analysis.service';
// 图片分析子组件（V6.x 重构：解耦 prompt / HTTP / 解析 / 库匹配 / legacy 适配）
import { VisionApiClient } from './app/services/image/vision-api.client';
import { ImagePromptBuilder } from './app/services/image/image-prompt.builder';
import { AnalysisPromptSchemaService } from './app/services/analysis-prompt-schema.service';
import { ImageResultParser } from './app/services/image/image-result.parser';
import { FoodLibraryMatcher } from './app/services/image/food-library-matcher.service';
import { LegacyResultAdapter } from './app/services/image/mappers/legacy-result.adapter';
// 置信度驱动 V1：Session + 判定
import { AnalysisSessionService } from './app/services/analysis-session.service';
import { ConfidenceJudgeService } from './app/services/confidence-judge.service';
// V6.1 Phase 2.6: 分析事件监听器（联动画像和推荐）
import { AnalysisEventListener } from './app/listeners/analysis-event.listener';
// V6.2 Phase 2.3: 分析保存事件监听器（popularity 更新）
import { AnalysisSaveListener } from './app/listeners/analysis-save.listener';
// V6.2 Phase 2.5: 分析提交行为追踪监听器
import { AnalysisTrackingListener } from './app/listeners/analysis-tracking.listener';
// V6.2 3.8: CandidatePromotedListener 已移至 DietModule（需要 FoodPoolCacheService）
// V6.1 Phase 3.1: 数据质量评分服务
import { DataQualityService } from './app/ingestion/data-quality.service';
// V6.1 Phase 3.2: 分析入库编排服务
import { AnalysisIngestionService } from './app/ingestion/analysis-ingestion.service';
// V6.1 Phase 3.3: 候选食物聚合服务
import { CandidateAggregationService } from './app/ingestion/candidate-aggregation.service';
// V6.9 Phase 3-C: 渠道标注迁移服务
import { ChannelMigrationService } from './app/services/channel-migration.service';
// V8.2: Repository 包装层（food_embeddings / food_field_provenance 收口）
import {
  FoodRepository,
  FoodEmbeddingRepository,
  FoodProvenanceRepository,
} from './repositories';
// Admin 端
import { FoodLibraryManagementController } from './admin/food-library-management.controller';
import { FoodLibraryManagementService } from './admin/food-library-management.service';
import { AnalysisRecordManagementController } from './admin/analysis-record-management.controller';
import { AnalysisRecordManagementService } from './admin/analysis-record-management.service';
import { AdminQualityMetricsController } from './admin/admin-quality-metrics.controller';
import { DietModule } from '../diet/diet.module';
import { UserModule } from '../user/user.module';
import { DecisionModule } from '../decision/decision.module';
import { AuthModule } from '../auth/auth.module';
import { RbacModule } from '../rbac/rbac.module';
import { RecommendationModule } from '../diet/recommendation.module';

@Module({
  imports: [
    AuthModule,
    RbacModule,
    forwardRef(() => DietModule),
    RecommendationModule,
    UserModule,
    forwardRef(() => DecisionModule),
  ],
  controllers: [
    FoodLibraryController,
    FoodAnalyzeController,
    // Phase 7: 新拆分子控制器
    FoodImageAnalyzeController,
    FoodTextAnalyzeController,
    FoodAnalysisHistoryController,
    FoodAnalysisSaveController,
    FoodAnalysisReportController,
    FoodLibraryManagementController,
    AnalysisRecordManagementController,
    AdminQualityMetricsController,
  ],
  providers: [
    FoodLibraryService,
    AnalyzeService,
    // Phase 7: 共享辅助服务
    AnalyzeResultHelperService,
    // V6.1 Phase 1.6: 文本分析服务
    TextFoodAnalysisService,
    // V6.1 Phase 2.3: 图片分析核心服务
    ImageFoodAnalysisService,
    // 图片分析子组件
    VisionApiClient,
    ImagePromptBuilder,
    AnalysisPromptSchemaService,
    ImageResultParser,
    FoodLibraryMatcher,
    LegacyResultAdapter,
    // 置信度驱动 V1
    AnalysisSessionService,
    ConfidenceJudgeService,
    // V6.1 Phase 2.6: 分析事件监听器
    AnalysisEventListener,
    // V6.2 Phase 2.3: 分析保存事件监听器
    AnalysisSaveListener,
    // V6.2 Phase 2.5: 分析提交行为追踪
    AnalysisTrackingListener,
    // V6.1 Phase 3.1: 数据质量评分
    DataQualityService,
    // V6.1 Phase 3.2: 分析入库编排
    AnalysisIngestionService,
    // V6.1 Phase 3.3: 候选食物聚合
    CandidateAggregationService,
    FoodLibraryManagementService,
    AnalysisRecordManagementService,
    // V6 Phase 1.4: 注册 AI 分析队列 Worker
    FoodAnalysisProcessor,
    // V6.2 3.8: CandidatePromotedListener 已移至 DietModule
    // V6.9 Phase 3-C: 渠道标注迁移
    ChannelMigrationService,
    // V8.2: Repository 层
    FoodRepository,
    FoodEmbeddingRepository,
    FoodProvenanceRepository,
  ],
  exports: [
    FoodLibraryService,
    AnalyzeService,
    TextFoodAnalysisService,
    ImageFoodAnalysisService,
    AnalysisEventListener,
    DataQualityService,
    AnalysisIngestionService,
    CandidateAggregationService,
    // V6.9 Phase 3-C: 渠道标注迁移（可被其他模块/CLI调用）
    ChannelMigrationService,
    // V8.2: 导出仓储以便其他模块（diet / food-pipeline）注入
    FoodRepository,
    FoodEmbeddingRepository,
    FoodProvenanceRepository,
  ],
})
export class FoodModule {}
