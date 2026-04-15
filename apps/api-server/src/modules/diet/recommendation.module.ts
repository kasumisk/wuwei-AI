/**
 * V7.3 P3-C: 推荐核心子模块
 *
 * 从 DietModule 拆分出来的推荐管道核心服务。
 * 包含 Pipeline, Scorer, Filter, Assembler, ScoringChain, MealTemplate, FactorLearner 等。
 *
 * V7.5 P3-C: 合并原 ExplanationModule 的 6 个 providers 回本模块，
 * 消除 RecommendationModule ↔ ExplanationModule 的 forwardRef 循环依赖。
 *
 * 设计：
 * - 独立声明自己的 providers
 * - 导出所有需要被其他子模块或 DietModule 使用的服务
 * - 不包含 controllers（控制器留在 DietModule）
 */
import { Module } from '@nestjs/common';
import { TrackingModule } from './tracking.module';
import { UserModule } from '../user/user.module';
import { RecipeModule } from '../recipe/recipe.module';
import { RecommendationEngineService } from './app/services/recommendation-engine.service';
import { PipelineBuilderService } from './app/recommendation/pipeline/pipeline-builder.service';
import { FoodScorerService } from './app/recommendation/pipeline/food-scorer.service';
import { FoodFilterService } from './app/recommendation/pipeline/food-filter.service';
import { MealAssemblerService } from './app/recommendation/meal/meal-assembler.service';
import { ConstraintGeneratorService } from './app/recommendation/pipeline/constraint-generator.service';
import { HealthModifierEngineService } from './app/recommendation/modifier/health-modifier-engine.service';
import { FoodPoolCacheService } from './app/recommendation/pipeline/food-pool-cache.service';
import { SubstitutionService } from './app/recommendation/filter/substitution.service';
import { ABTestingService } from './app/recommendation/experiment/ab-testing.service';
import { CollaborativeFilteringService } from './app/recommendation/recall/collaborative-filtering.service';
import { VectorSearchService } from './app/recommendation/recall/vector-search.service';
import { NutritionTargetService } from './app/recommendation/pipeline/nutrition-target.service';
import { SeasonalityService } from './app/recommendation/utils/seasonality.service';
import { RecommendationTraceService } from './app/recommendation/tracing/recommendation-trace.service';
import { RealisticFilterService } from './app/recommendation/filter/realistic-filter.service';
import { ReplacementPatternService } from './app/recommendation/feedback/replacement-pattern.service';
import { MealCompositionScorer } from './app/recommendation/meal/meal-composition-scorer.service';
import { SemanticRecallService } from './app/recommendation/recall/semantic-recall.service';
import { RecallMergerService } from './app/recommendation/recall/recall-merger.service';
import { ReplacementFeedbackInjectorService } from './app/recommendation/feedback/replacement-feedback-injector.service';
import { LifestyleScoringAdapter } from './app/recommendation/modifier/lifestyle-scoring-adapter.service';
import { LearnedRankingService } from './app/recommendation/optimization/learned-ranking.service';
import { EmbeddingGenerationService } from './app/recommendation/embedding/embedding-generation.service';
import { EmbeddingGenerationProcessor } from './app/recommendation/embedding/embedding-generation.processor';
import { ScoringConfigService } from './app/recommendation/context/scoring-config.service';
import { CFRecallService } from './app/recommendation/recall/cf-recall.service';
import { SceneResolverService } from './app/recommendation/context/scene-resolver.service';
import { RecipeAssemblerService } from './app/recommendation/meal/recipe-assembler.service';
import { AvailabilityScorerService } from './app/recommendation/utils/availability-scorer.service';
import { DailyPlanContextService } from './app/recommendation/context/daily-plan-context.service';
import { RecommendationConfigService } from './app/recommendation/pipeline/recommendation.config';
// V7.2
import { ScoringChainService } from './app/recommendation/scoring-chain/scoring-chain.service';
// V7.3
import { MealTemplateService } from './app/recommendation/meal/meal-template.service';
import { FactorLearnerService } from './app/recommendation/optimization/factor-learner.service';
// V7.4
import { RecommendationStrategyResolverService } from './app/recommendation/pipeline/recommendation-strategy-resolver.service';
import { ProfileEventBusService } from './app/recommendation/profile/profile-event-bus.service';
import { ProfileEventListenerService } from './app/recommendation/profile/profile-event-listener.service';
// Shared diet services needed by recommendation pipeline
import { FoodI18nService } from './app/services/food-i18n.service';
// V7.5 P3-C: 原 ExplanationModule providers（合并回本模块，消除循环依赖）
import { ExplanationGeneratorService } from './app/recommendation/explanation/explanation-generator.service';
import { InsightGeneratorService } from './app/recommendation/explanation/insight-generator.service';
import { ExplanationTierService } from './app/recommendation/explanation/explanation-tier.service';
import { AdaptiveExplanationDepthService } from './app/recommendation/explanation/adaptive-explanation-depth.service';
import { ExplanationABTrackerService } from './app/recommendation/explanation/explanation-ab-tracker.service';
import { NaturalLanguageExplainerService } from './app/recommendation/explanation/natural-language-explainer.service';
// V7.6 P1-B: 画像聚合 Facade
import { ProfileAggregatorService } from './app/recommendation/profile/profile-aggregator.service';
// V7.6 P1-C: 策略解析 Facade
import { StrategyResolverFacade } from './app/recommendation/pipeline/strategy-resolver-facade.service';
// V7.6 P2-B/C: 解释拆分子服务
import { MealExplanationService } from './app/recommendation/explanation/meal-explanation.service';
import { ComparisonExplanationService } from './app/recommendation/explanation/comparison-explanation.service';

/** 推荐管道核心 providers */
const RECOMMENDATION_PROVIDERS = [
  RecommendationEngineService,
  PipelineBuilderService,
  FoodScorerService,
  FoodFilterService,
  MealAssemblerService,
  ConstraintGeneratorService,
  HealthModifierEngineService,
  FoodPoolCacheService,
  SubstitutionService,
  ABTestingService,
  CollaborativeFilteringService,
  VectorSearchService,
  NutritionTargetService,
  SeasonalityService,
  RecommendationTraceService,
  RealisticFilterService,
  ReplacementPatternService,
  MealCompositionScorer,
  SemanticRecallService,
  RecallMergerService,
  ReplacementFeedbackInjectorService,
  LifestyleScoringAdapter,
  LearnedRankingService,
  EmbeddingGenerationService,
  EmbeddingGenerationProcessor,
  ScoringConfigService,
  CFRecallService,
  SceneResolverService,
  RecipeAssemblerService,
  AvailabilityScorerService,
  DailyPlanContextService,
  RecommendationConfigService,
  // V7.2
  ScoringChainService,
  // V7.3
  MealTemplateService,
  FactorLearnerService,
  // V7.4
  RecommendationStrategyResolverService,
  ProfileEventBusService,
  ProfileEventListenerService,
  // Shared diet services
  FoodI18nService,
  // V7.5 P3-C: 原 ExplanationModule providers（消除循环依赖）
  ExplanationGeneratorService,
  InsightGeneratorService,
  ExplanationTierService,
  AdaptiveExplanationDepthService,
  ExplanationABTrackerService,
  NaturalLanguageExplainerService,
  // V7.6 P1-B: 画像聚合 Facade
  ProfileAggregatorService,
  // V7.6 P1-C: 策略解析 Facade
  StrategyResolverFacade,
  // V7.6 P2-B/C: 解释拆分子服务
  MealExplanationService,
  ComparisonExplanationService,
];

@Module({
  imports: [TrackingModule, UserModule, RecipeModule],
  providers: RECOMMENDATION_PROVIDERS,
  exports: [
    // V7.5 P3-C: 只导出被外部模块实际注入的 service（原 38 个全部导出）
    RecommendationEngineService, // → DailyPlanService, FoodPlanController, WeeklyPlanService, FoodService, PrecomputeProcessor, RecommendationDebugService
    SubstitutionService, // → FoodPlanController
    ABTestingService, // → RecommendationDebugService, ABExperimentManagementService
    FoodPoolCacheService, // → CandidatePromotedListener
    ScoringConfigService, // → ScoringConfigController, RecommendationDebugService
    ExplanationGeneratorService, // → DailyPlanService
    AdaptiveExplanationDepthService, // → DailyPlanService
    // V7.9 P2-03: RecommendationDebugService 得分分解需要
    FoodScorerService,
    ScoringChainService,
    HealthModifierEngineService,
  ],
})
export class RecommendationModule {}
