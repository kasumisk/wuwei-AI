import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
// 依赖模块
import { UserModule } from '../user/user.module';
import { FoodModule } from '../food/food.module';
import { RecipeModule } from '../recipe/recipe.module';
// App 端控制器
import { FoodRecordController } from './app/food-record.controller';
import { FoodSummaryController } from './app/food-summary.controller';
import { FoodPlanController } from './app/food-plan.controller';
import { FoodBehaviorController } from './app/food-behavior.controller';
import { FoodNutritionController } from './app/food-nutrition.controller';
// App 端服务
import { FoodService } from './app/food.service';
import { FoodRecordService } from './app/food-record.service';
import { DailySummaryService } from './app/daily-summary.service';
import { DailyPlanService } from './app/daily-plan.service';
import { NutritionScoreService } from './app/nutrition-score.service';
import { BehaviorService } from './app/behavior.service';
import { RecommendationEngineService } from './app/recommendation-engine.service';
import { ConstraintGeneratorService } from './app/recommendation/constraint-generator.service';
import { FoodFilterService } from './app/recommendation/food-filter.service';
import { FoodScorerService } from './app/recommendation/food-scorer.service';
import { MealAssemblerService } from './app/recommendation/meal-assembler.service';
import { HealthModifierEngineService } from './app/recommendation/health-modifier-engine.service';
import { FoodPoolCacheService } from './app/recommendation/food-pool-cache.service';
import { RecommendationFeedbackService } from './app/recommendation/feedback.service';
import { PreferenceProfileService } from './app/recommendation/preference-profile.service';
import { SubstitutionService } from './app/recommendation/substitution.service';
import { PreferenceUpdaterService } from './app/recommendation/preference-updater.service';
import { ABTestingService } from './app/recommendation/ab-testing.service';
import { CollaborativeFilteringService } from './app/recommendation/collaborative-filtering.service';
import { VectorSearchService } from './app/recommendation/vector-search.service';
import { ExplanationGeneratorService } from './app/recommendation/explanation-generator.service';
import { WeightLearnerService } from './app/recommendation/weight-learner.service';
import { NutritionTargetService } from './app/recommendation/nutrition-target.service';
import { SeasonalityService } from './app/recommendation/seasonality.service';
import { RecommendationTraceService } from './app/recommendation/recommendation-trace.service';
import { RealisticFilterService } from './app/recommendation/realistic-filter.service';
import { ReplacementPatternService } from './app/recommendation/replacement-pattern.service';
import { MealCompositionScorer } from './app/recommendation/meal-composition-scorer.service';
import { SemanticRecallService } from './app/recommendation/semantic-recall.service';
import { RecallMergerService } from './app/recommendation/recall-merger.service';
import { ReplacementFeedbackInjectorService } from './app/recommendation/replacement-feedback-injector.service';
import { LifestyleScoringAdapter } from './app/recommendation/lifestyle-scoring-adapter.service';
import { ExplanationABTrackerService } from './app/recommendation/explanation-ab-tracker.service';
import { LearnedRankingService } from './app/recommendation/learned-ranking.service';
import { FoodI18nService } from './app/food-i18n.service';
import { EmbeddingGenerationService } from './app/recommendation/embedding-generation.service';
import { EmbeddingGenerationProcessor } from './app/recommendation/embedding-generation.processor';
import { AdaptiveExplanationDepthService } from './app/recommendation/adaptive-explanation-depth.service';
import { WeeklyPlanService } from './app/weekly-plan.service';
import { PrecomputeService } from './app/precompute.service';
import { PrecomputeProcessor } from './app/precompute.processor';
// V6.2: 推荐生成事件监听器
import { RecommendationEventListener } from './app/recommendation-event.listener';
// V6.2 3.2: 评分权重运行时配置
import { RecommendationConfigService } from './app/recommendation/recommendation.config';
// V6.2 3.8: 候选食物晋升事件监听器（需要 FoodPoolCacheService，放在 DietModule）
import { CandidatePromotedListener } from '../food/app/candidate-promoted.listener';
// V6.2 3.10: 数据导出队列 Processor + Service
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
import { BingeInterventionService } from './admin/binge-intervention.service';

@Module({
  imports: [
    ConfigModule,
    UserModule,
    forwardRef(() => FoodModule),
    RecipeModule,
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
  ],
  providers: [
    FoodService,
    FoodRecordService,
    DailySummaryService,
    DailyPlanService,
    NutritionScoreService,
    BehaviorService,
    RecommendationEngineService,
    ConstraintGeneratorService,
    FoodFilterService,
    FoodScorerService,
    MealAssemblerService,
    HealthModifierEngineService,
    FoodPoolCacheService,
    RecommendationFeedbackService,
    PreferenceProfileService,
    SubstitutionService,
    PreferenceUpdaterService,
    ABTestingService,
    CollaborativeFilteringService,
    VectorSearchService,
    ExplanationGeneratorService,
    WeightLearnerService,
    NutritionTargetService, // V6.3 P1-10: 个性化营养目标计算
    SeasonalityService, // V6.4 Phase 3.4: 时令感知服务
    RecommendationTraceService, // V6.4 Phase 3.5: 推荐归因追踪
    RealisticFilterService, // V6.5 Phase 1D: 现实性过滤
    ReplacementPatternService, // V6.5 Phase 1F: 替换模式挖掘
    MealCompositionScorer, // V6.5 Phase 2C: 整餐组合评分器
    SemanticRecallService, // V6.5 Phase 3A: 语义召回服务
    RecallMergerService, // V6.6 Phase 2-A: 双路召回去重合并
    ReplacementFeedbackInjectorService, // V6.6 Phase 2-B: 替换反馈权重注入
    LifestyleScoringAdapter, // V6.6 Phase 2-C: 生活方式营养素优先级调整
    ExplanationABTrackerService, // V6.6 Phase 2-E: 解释风格 A/B 追踪
    LearnedRankingService, // V6.6 Phase 3-A: per-segment 学习权重优化
    FoodI18nService, // V6.6 Phase 3-B: 推荐结果多语言
    EmbeddingGenerationService, // V6.5 Phase 3B: Embedding 异步生成服务
    EmbeddingGenerationProcessor, // V6.5 Phase 3B: Embedding 生成 Processor
    AdaptiveExplanationDepthService, // V6.5 Phase 3K: 自适应解释深度
    WeeklyPlanService,
    PrecomputeService,
    PrecomputeProcessor,
    RecommendationEventListener, // V6.2: 推荐生成事件监听器
    RecommendationConfigService, // V6.2 3.2: 评分权重运行时配置
    CandidatePromotedListener, // V6.2 3.8: 候选食物晋升事件监听器
    ExportService, // V6.2 3.10: 数据导出服务
    ExportProcessor, // V6.2 3.10: 数据导出队列处理器
    ContentManagementService,
    RecommendationQualityService,
    AppDataQueryService,
    ABExperimentManagementService,
    RecommendationDebugService,
    StrategyEffectivenessService, // V6.4 Phase 3.6: 策略效果分析
    ThompsonSamplingService, // V6.5 Phase 3I: TS 收敛可视化
    BingeInterventionService, // V6.5 Phase 3J: 暴食干预效果追踪
  ],
  exports: [
    FoodService,
    FoodRecordService,
    DailySummaryService,
    BehaviorService,
    NutritionScoreService,
    RecommendationEngineService,
    ContentManagementService,
    PrecomputeService,
    ExportService, // V6.2 3.10: 供控制器入队导出任务
    SemanticRecallService, // V6.5 Phase 3A: 供推荐引擎混合召回
    EmbeddingGenerationService, // V6.5 Phase 3B: 供管理端触发 embedding 生成
  ],
})
export class DietModule {}
