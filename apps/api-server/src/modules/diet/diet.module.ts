/**
 * V7.3 P3-C: DietModule（瘦身后的聚合模块）
 *
 * 从原来的 66+ providers 单体模块拆分为：
 * - RecommendationModule: 推荐管道核心（Pipeline, Scorer, Filter, ScoringChain, etc.）
 * - ExplanationModule: 推荐解释生成（Explanation, Insight, NL Explainer, etc.）
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
// V7.3 子模块
import { RecommendationModule } from './recommendation.module';
import { ExplanationModule } from './explanation.module';
import { TrackingModule } from './tracking.module';
// App 端控制器
import { FoodRecordController } from './app/food-record.controller';
import { FoodSummaryController } from './app/food-summary.controller';
import { FoodPlanController } from './app/food-plan.controller';
import { FoodBehaviorController } from './app/food-behavior.controller';
import { FoodNutritionController } from './app/food-nutrition.controller';
// 领域服务（不属于推荐/解释/追踪子模块）
import { FoodService } from './app/food.service';
import { FoodRecordService } from './app/food-record.service';
import { DailySummaryService } from './app/daily-summary.service';
import { DailyPlanService } from './app/daily-plan.service';
import { NutritionScoreService } from './app/nutrition-score.service';
import { BehaviorService } from './app/behavior.service';
import { FoodI18nService } from './app/food-i18n.service';
import { WeeklyPlanService } from './app/weekly-plan.service';
import { PrecomputeService } from './app/precompute.service';
import { PrecomputeProcessor } from './app/precompute.processor';
// V6.2: 事件监听器
import { RecommendationEventListener } from './app/recommendation-event.listener';
// V6.2 3.8: 候选食物晋升事件监听器
import { CandidatePromotedListener } from '../food/app/candidate-promoted.listener';
// V6.2 3.10: 数据导出
import { ExportService } from './app/export.service';
import { ExportProcessor } from './app/export.processor';
// Admin 端
import { ContentManagementController } from './admin/content-management.controller';
import { ContentManagementService } from './admin/content-management.service';
import { RecommendationQualityService } from './admin/recommendation-quality.service';
import { AppDataQueryService } from './admin/app-data-query.service';
import { ABExperimentManagementController } from './admin/ab-experiment-management.controller';
import { ABExperimentManagementService } from './admin/ab-experiment-management.service';
import { RecommendationDebugController } from './admin/recommendation-debug.controller';
import { RecommendationDebugService } from './admin/recommendation-debug.service';
import { StrategyEffectivenessController } from './admin/strategy-effectiveness.controller';
import { StrategyEffectivenessService } from './admin/strategy-effectiveness.service';
import { ThompsonSamplingController } from './admin/thompson-sampling.controller';
import { ThompsonSamplingService } from './admin/thompson-sampling.service';
import { BingeInterventionController } from './admin/binge-intervention.controller';
import { ScoringConfigController } from './admin/scoring-config.controller';
import { BingeInterventionService } from './admin/binge-intervention.service';

@Module({
  imports: [
    ConfigModule,
    UserModule,
    forwardRef(() => FoodModule),
    RecipeModule,
    // V7.3 P3-C: 子模块
    RecommendationModule,
    ExplanationModule,
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
    FoodI18nService,
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
    // V7.3: re-export 子模块，让外部模块也能访问推荐/解释/追踪服务
    RecommendationModule,
    ExplanationModule,
    TrackingModule,
  ],
})
export class DietModule {}
