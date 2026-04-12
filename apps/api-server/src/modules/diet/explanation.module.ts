/**
 * V7.3 P3-C: 解释生成子模块
 *
 * 从 DietModule 拆分出来的推荐解释相关服务。
 * 包含 ExplanationGenerator, InsightGenerator, ExplanationTier, NL Explainer 等。
 */
import { Module } from '@nestjs/common';
import { ExplanationGeneratorService } from './app/recommendation/explanation-generator.service';
import { InsightGeneratorService } from './app/recommendation/insight-generator.service';
import { ExplanationTierService } from './app/recommendation/explanation-tier.service';
import { AdaptiveExplanationDepthService } from './app/recommendation/adaptive-explanation-depth.service';
import { ExplanationABTrackerService } from './app/recommendation/explanation-ab-tracker.service';
// V7.3
import { NaturalLanguageExplainerService } from './app/recommendation/natural-language-explainer.service';

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
  providers: EXPLANATION_PROVIDERS,
  exports: EXPLANATION_PROVIDERS,
})
export class ExplanationModule {}
