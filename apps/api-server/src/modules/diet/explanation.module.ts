/**
 * V7.3 P3-C: 解释生成子模块
 *
 * 从 DietModule 拆分出来的推荐解释相关服务。
 * 包含 ExplanationGenerator, InsightGenerator, ExplanationTier, NL Explainer 等。
 *
 * V7.4 P1-D: ExplanationGeneratorService 需要 MealCompositionScorer（来自 RecommendationModule），
 * 通过 forwardRef 解决循环依赖。
 */
import { Module, forwardRef } from '@nestjs/common';
import { RecommendationModule } from './recommendation.module';
import { ExplanationGeneratorService } from './app/recommendation/explanation/explanation-generator.service';
import { InsightGeneratorService } from './app/recommendation/explanation/insight-generator.service';
import { ExplanationTierService } from './app/recommendation/explanation/explanation-tier.service';
import { AdaptiveExplanationDepthService } from './app/recommendation/explanation/adaptive-explanation-depth.service';
import { ExplanationABTrackerService } from './app/recommendation/explanation/explanation-ab-tracker.service';
// V7.3
import { NaturalLanguageExplainerService } from './app/recommendation/explanation/natural-language-explainer.service';

/** 解释生成 providers */
const EXPLANATION_PROVIDERS = [
  ExplanationGeneratorService,
  InsightGeneratorService,
  ExplanationTierService,
  AdaptiveExplanationDepthService,
  ExplanationABTrackerService,
  // V7.3
  NaturalLanguageExplainerService,
];

@Module({
  imports: [
    // V7.4 P1-D: 需要 MealCompositionScorer from RecommendationModule
    forwardRef(() => RecommendationModule),
  ],
  providers: EXPLANATION_PROVIDERS,
  exports: EXPLANATION_PROVIDERS,
})
export class ExplanationModule {}
