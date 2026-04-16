import { Module, forwardRef } from '@nestjs/common';
// App 端
import { FoodLibraryController } from './app/controllers/food-library.controller';
import { FoodLibraryService } from './app/services/food-library.service';
import { FoodAnalyzeController } from './app/controllers/food-analyze.controller';
import { AnalyzeService } from './app/services/analyze.service';
// V6 Phase 1.4: AI 分析队列处理器
import { FoodAnalysisProcessor } from './app/processors/food-analysis.processor';
// V6.1 Phase 1.6: 文本分析服务
import { TextFoodAnalysisService } from './app/services/text-food-analysis.service';
// V6.1 Phase 2.3: 图片分析服务（从 AnalyzeService 拆分出的核心分析逻辑）
import { ImageFoodAnalysisService } from './app/services/image-food-analysis.service';
// V6.1 Phase 2.6: 分析事件监听器（联动画像和推荐）
import { AnalysisEventListener } from './app/listeners/analysis-event.listener';
// V6.2 Phase 2.3: 分析保存事件监听器（popularity 更新）
import { AnalysisSaveListener } from './app/listeners/analysis-save.listener';
// V6.2 Phase 2.5: 分析提交行为追踪监听器
import { AnalysisTrackingListener } from './app/listeners/analysis-tracking.listener';
// V6.2 3.8: CandidatePromotedListener 已移至 DietModule（需要 FoodPoolCacheService）
// V6.1 Phase 3.1: 数据质量评分服务
import { DataQualityService } from './app/services/data-quality.service';
// V6.1 Phase 3.2: 分析入库编排服务
import { AnalysisIngestionService } from './app/services/analysis-ingestion.service';
// V6.1 Phase 3.3: 候选食物聚合服务
import { CandidateAggregationService } from './app/services/candidate-aggregation.service';
// V6.9 Phase 3-C: 渠道标注迁移服务
import { ChannelMigrationService } from './app/services/channel-migration.service';
// Admin 端
import { FoodLibraryManagementController } from './admin/food-library-management.controller';
import { FoodLibraryManagementService } from './admin/food-library-management.service';
import { AnalysisRecordManagementController } from './admin/analysis-record-management.controller';
import { AnalysisRecordManagementService } from './admin/analysis-record-management.service';
// V1.3→V1.6: 饮食决策服务（迁移至 decision/）
import { FoodDecisionService } from './app/decision/food-decision.service';
// V1.6 Phase 2: 替代建议服务
import { AlternativeSuggestionService } from './app/decision/alternative-suggestion.service';
// V1.6 Phase 2: 决策解释服务
import { DecisionExplainerService } from './app/decision/decision-explainer.service';
// V1.6 Phase 1: 评分门面服务
import { FoodScoringService } from './app/scoring/food-scoring.service';
// V1.9 Phase 1.5: 统一用户上下文构建
import { UserContextBuilderService } from './app/decision/user-context-builder.service';
// V1.9 Phase 2.1: 上下文决策修正器
import { ContextualDecisionModifierService } from './app/decision/contextual-modifier.service';
// V2.1 Phase 1: 决策子服务（从 FoodDecisionService 拆分）
import { DecisionEngineService } from './app/decision/decision-engine.service';
import { PortionAdvisorService } from './app/decision/portion-advisor.service';
import { IssueDetectorService } from './app/decision/issue-detector.service';
// V2.2 Phase 1: 动态阈值计算服务
import { DynamicThresholdsService } from './app/config/dynamic-thresholds.service';
// V2.2 Phase 2: 决策结构化摘要服务
import { DecisionSummaryService } from './app/decision/decision-summary.service';
// V2.1 Phase 2: 统一分析管道
import { AnalysisPipelineService } from './app/pipeline/analysis-pipeline.service';
import { ResultAssemblerService } from './app/pipeline/result-assembler.service';
import { AnalysisPersistenceService } from './app/pipeline/analysis-persistence.service';
import { DietModule } from '../diet/diet.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [forwardRef(() => DietModule), UserModule],
  controllers: [
    FoodLibraryController,
    FoodAnalyzeController,
    FoodLibraryManagementController,
    AnalysisRecordManagementController,
  ],
  providers: [
    FoodLibraryService,
    AnalyzeService,
    // V6.1 Phase 1.6: 文本分析服务
    TextFoodAnalysisService,
    // V6.1 Phase 2.3: 图片分析核心服务
    ImageFoodAnalysisService,
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
    // V1.3→V1.6: 饮食决策服务
    FoodDecisionService,
    // V1.6 Phase 2: 替代建议服务
    AlternativeSuggestionService,
    // V1.6 Phase 2: 决策解释服务
    DecisionExplainerService,
    // V1.6 Phase 1: 评分门面服务
    FoodScoringService,
    // V1.9 Phase 1.5: 统一用户上下文构建
    UserContextBuilderService,
    // V1.9 Phase 2.1: 上下文决策修正器
    ContextualDecisionModifierService,
    // V2.1 Phase 1: 决策子服务
    DecisionEngineService,
    PortionAdvisorService,
    IssueDetectorService,
    // V2.2 Phase 1: 动态阈值计算服务
    DynamicThresholdsService,
    // V2.2 Phase 2: 决策结构化摘要服务
    DecisionSummaryService,
    // V2.1 Phase 2: 统一分析管道
    AnalysisPipelineService,
    ResultAssemblerService,
    AnalysisPersistenceService,
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
    // V1.3→V1.6: 饮食决策服务
    FoodDecisionService,
    // V1.6 Phase 2: 替代建议服务
    AlternativeSuggestionService,
    // V1.6 Phase 2: 决策解释服务
    DecisionExplainerService,
    // V1.6 Phase 1: 评分门面服务
    FoodScoringService,
    // V1.9 Phase 1.5: 统一用户上下文构建
    UserContextBuilderService,
  ],
})
export class FoodModule {}
