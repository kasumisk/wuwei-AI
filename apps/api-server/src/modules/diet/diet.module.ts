/**
 * V7.3 P3-C: DietModule（瘦身后的聚合模块）
 *
 * 从原来的 66+ providers 单体模块拆分为：
 * - RecommendationModule: 推荐管道核心 + 解释生成（V7.5 P3-C 合并原 ExplanationModule）
 * - TrackingModule: 用户行为追踪与反馈学习（Feedback, WeightLearner, Execution, etc.）
 * - DietModule: 聚合器 + 控制器 + 领域服务 + Admin 服务 + 事件监听器
 *
 * 拆分原则：
 * - 子模块导出所有 providers，DietModule 通过 imports 获得访问权
 * - 不改变任何服务的注入行为，仅调整模块结构
 * - 控制器留在 DietModule（NestJS 控制器必须在模块级声明）
 */
import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// 依赖模块
import { UserModule } from '../user/user.module';
import { FoodModule } from '../food/food.module';
import { RecipeModule } from '../recipe/recipe.module';
// V7.3 子模块（V7.5 P3-C: ExplanationModule 已合并回 RecommendationModule）
import { RecommendationModule } from './recommendation.module';
import { TrackingModule } from './tracking.module';
// App 端控制器
import { FoodRecordController } from './app/controllers/food-record.controller';
import { FoodSummaryController } from './app/controllers/food-summary.controller';
import { FoodPlanController } from './app/controllers/food-plan.controller';
import { FoodBehaviorController } from './app/controllers/food-behavior.controller';
import { FoodNutritionController } from './app/controllers/food-nutrition.controller';
// 领域服务（不属于推荐/解释/追踪子模块）
import { FoodService } from './app/services/food.service';
import { FoodRecordService } from './app/services/food-record.service';
import { DailySummaryService } from './app/services/daily-summary.service';
import { DailyPlanService } from './app/services/daily-plan.service';
import { NutritionScoreService } from './app/services/nutrition-score.service';
import { BehaviorService } from './app/services/behavior.service';
import { WeeklyPlanService } from './app/services/weekly-plan.service';
import { PrecomputeService } from './app/services/precompute.service';
import { PrecomputeProcessor } from './app/processors/precompute.processor';
// V6.2: 事件监听器
import { RecommendationEventListener } from './app/listeners/recommendation-event.listener';
// V6.2 3.8: 候选食物晋升事件监听器
import { CandidatePromotedListener } from '../food/app/listeners/candidate-promoted.listener';
// V6.2 3.10: 数据导出
import { ExportService } from './app/services/export.service';
import { ExportProcessor } from './app/processors/export.processor';
// Admin 端
import { ContentManagementController } from './admin/controllers/content-management.controller';
import { ContentManagementService } from './admin/services/content-management.service';
import { RecommendationQualityService } from './admin/services/recommendation-quality.service';
import { AppDataQueryService } from './admin/services/app-data-query.service';
import { ABExperimentManagementController } from './admin/controllers/ab-experiment-management.controller';
import { ABExperimentManagementService } from './admin/services/ab-experiment-management.service';
import { RecommendationDebugController } from './admin/controllers/recommendation-debug.controller';
import { RecommendationDebugService } from './admin/services/recommendation-debug.service';
import { StrategyEffectivenessController } from './admin/controllers/strategy-effectiveness.controller';
import { StrategyEffectivenessService } from './admin/services/strategy-effectiveness.service';
import { ThompsonSamplingController } from './admin/controllers/thompson-sampling.controller';
import { ThompsonSamplingService } from './admin/services/thompson-sampling.service';
import { BingeInterventionController } from './admin/controllers/binge-intervention.controller';
import { ScoringConfigController } from './admin/controllers/scoring-config.controller';
import { BingeInterventionService } from './admin/services/binge-intervention.service';

@Module({
  imports: [
    ConfigModule,
    UserModule,
    forwardRef(() => FoodModule),
    RecipeModule,
    // V7.3 P3-C: 子模块（V7.5: ExplanationModule 已合并回 RecommendationModule）
    RecommendationModule,
    TrackingModule,
  ],
  controllers: [
    FoodRecordController,
    FoodSummaryController,
    FoodPlanController,
    FoodBehaviorController,
    FoodNutritionController,
    ContentManagementController,
    ABExperimentManagementController,
    RecommendationDebugController,
    StrategyEffectivenessController, // V6.4 Phase 3.6: 策略效果分析
    ThompsonSamplingController, // V6.5 Phase 3I: TS 收敛可视化
    BingeInterventionController, // V6.5 Phase 3J: 暴食干预效果追踪
    ScoringConfigController, // V6.7 Phase 1-B: 评分参数配置 Admin API
  ],
  providers: [
    // 领域服务（不属于推荐/解释/追踪子模块）
    FoodService,
    FoodRecordService,
    DailySummaryService,
    DailyPlanService,
    NutritionScoreService,
    BehaviorService,
    WeeklyPlanService,
    PrecomputeService,
    PrecomputeProcessor,
    // 事件监听器
    RecommendationEventListener,
    CandidatePromotedListener,
    // 数据导出
    ExportService,
    ExportProcessor,
    // Admin 服务
    ContentManagementService,
    RecommendationQualityService,
    AppDataQueryService,
    ABExperimentManagementService,
    RecommendationDebugService,
    StrategyEffectivenessService,
    ThompsonSamplingService,
    BingeInterventionService,
  ],
  exports: [
    // 领域服务
    FoodService,
    FoodRecordService,
    DailySummaryService,
    BehaviorService,
    NutritionScoreService,
    ContentManagementService,
    PrecomputeService,
    ExportService,
    // V7.3: re-export 子模块，让外部模块也能访问推荐/追踪服务
    RecommendationModule,
    TrackingModule,
  ],
})
export class DietModule {}
