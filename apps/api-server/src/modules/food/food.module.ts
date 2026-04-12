import { Module, forwardRef } from '@nestjs/common';
// App 端
import { FoodLibraryController } from './app/food-library.controller';
import { FoodLibraryService } from './app/food-library.service';
import { FoodAnalyzeController } from './app/food-analyze.controller';
import { AnalyzeService } from './app/analyze.service';
// V6 Phase 1.4: AI 分析队列处理器
import { FoodAnalysisProcessor } from './app/food-analysis.processor';
// V6.1 Phase 1.6: 文本分析服务
import { TextFoodAnalysisService } from './app/text-food-analysis.service';
// V6.1 Phase 2.3: 图片分析服务（从 AnalyzeService 拆分出的核心分析逻辑）
import { ImageFoodAnalysisService } from './app/image-food-analysis.service';
// V6.1 Phase 2.6: 分析事件监听器（联动画像和推荐）
import { AnalysisEventListener } from './app/analysis-event.listener';
// V6.2 Phase 2.3: 分析保存事件监听器（popularity 更新）
import { AnalysisSaveListener } from './app/analysis-save.listener';
// V6.2 Phase 2.5: 分析提交行为追踪监听器
import { AnalysisTrackingListener } from './app/analysis-tracking.listener';
// V6.2 3.8: CandidatePromotedListener 已移至 DietModule（需要 FoodPoolCacheService）
// V6.1 Phase 3.1: 数据质量评分服务
import { DataQualityService } from './app/data-quality.service';
// V6.1 Phase 3.2: 分析入库编排服务
import { AnalysisIngestionService } from './app/analysis-ingestion.service';
// V6.1 Phase 3.3: 候选食物聚合服务
import { CandidateAggregationService } from './app/candidate-aggregation.service';
// V6.9 Phase 3-C: 渠道标注迁移服务
import { ChannelMigrationService } from './app/channel-migration.service';
// Admin 端
import { FoodLibraryManagementController } from './admin/food-library-management.controller';
import { FoodLibraryManagementService } from './admin/food-library-management.service';
import { AnalysisRecordManagementController } from './admin/analysis-record-management.controller';
import { AnalysisRecordManagementService } from './admin/analysis-record-management.service';
import { DietModule } from '../diet/diet.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [forwardRef(() => DietModule), forwardRef(() => UserModule)],
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
  ],
})
export class FoodModule {}
