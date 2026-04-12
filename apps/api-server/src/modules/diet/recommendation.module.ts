/**
 * V7.3 P3-C: 推荐核心子模块
 *
 * 从 DietModule 拆分出来的推荐管道核心服务。
 * 包含 Pipeline, Scorer, Filter, Assembler, ScoringChain, MealTemplate, FactorLearner 等。
 *
 * 设计：
 * - 独立声明自己的 providers
 * - 导出所有需要被其他子模块或 DietModule 使用的服务
 * - 不包含 controllers（控制器留在 DietModule）
 */
import { Module, forwardRef } from '@nestjs/common';
import { TrackingModule } from './tracking.module';
import { ExplanationModule } from './explanation.module';
import { RecommendationEngineService } from './app/recommendation-engine.service';
import { PipelineBuilderService } from './app/recommendation/pipeline-builder.service';
import { FoodScorerService } from './app/recommendation/food-scorer.service';
import { FoodFilterService } from './app/recommendation/food-filter.service';
import { MealAssemblerService } from './app/recommendation/meal-assembler.service';
import { ConstraintGeneratorService } from './app/recommendation/constraint-generator.service';
import { HealthModifierEngineService } from './app/recommendation/health-modifier-engine.service';
import { FoodPoolCacheService } from './app/recommendation/food-pool-cache.service';
import { SubstitutionService } from './app/recommendation/substitution.service';
import { ABTestingService } from './app/recommendation/ab-testing.service';
import { CollaborativeFilteringService } from './app/recommendation/collaborative-filtering.service';
import { VectorSearchService } from './app/recommendation/vector-search.service';
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
import { LearnedRankingService } from './app/recommendation/learned-ranking.service';
import { EmbeddingGenerationService } from './app/recommendation/embedding-generation.service';
import { EmbeddingGenerationProcessor } from './app/recommendation/embedding-generation.processor';
import { ScoringConfigService } from './app/recommendation/scoring-config.service';
import { CFRecallService } from './app/recommendation/cf-recall.service';
import { SceneResolverService } from './app/recommendation/scene-resolver.service';
import { RecipeAssemblerService } from './app/recommendation/recipe-assembler.service';
import { AvailabilityScorerService } from './app/recommendation/availability-scorer.service';
import { DailyPlanContextService } from './app/recommendation/daily-plan-context.service';
import { RecommendationConfigService } from './app/recommendation/recommendation.config';
// V7.2
import { ScoringChainService } from './app/recommendation/scoring-chain/scoring-chain.service';
// V7.3
import { MealTemplateService } from './app/recommendation/meal-template.service';
import { FactorLearnerService } from './app/recommendation/factor-learner.service';

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
];

@Module({
  imports: [
    forwardRef(() => TrackingModule),
    forwardRef(() => ExplanationModule),
  ],
  providers: RECOMMENDATION_PROVIDERS,
  exports: RECOMMENDATION_PROVIDERS,
})
export class RecommendationModule {}
