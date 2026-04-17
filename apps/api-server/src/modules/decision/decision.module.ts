import { Module, forwardRef } from '@nestjs/common';
import { I18nService } from '../../config/i18n.service';
import { I18nManagementService } from '../../config/i18n-management.service';
import { DietModule } from '../diet/diet.module';
import { FoodModule } from '../food/food.module';
import { UserModule } from '../user/user.module';

// types / i18n / config
import { DynamicThresholdsService } from './config/dynamic-thresholds.service';

// score
import { FoodScoringService } from './score/food-scoring.service';

// decision
import { FoodDecisionService } from './decision/food-decision.service';
import { DecisionEngineService } from './decision/decision-engine.service';
import { DecisionExplainerService } from './decision/decision-explainer.service';
import { DecisionSummaryService } from './decision/decision-summary.service';
import { DecisionToneResolverService } from './decision/decision-tone-resolver.service';
import { DynamicSignalWeightService } from './config/dynamic-signal-weight.service';
import { DailyMacroSummaryService } from './decision/daily-macro-summary.service';
import { AlternativeSuggestionService } from './decision/alternative-suggestion.service';
import { ContextualDecisionModifierService } from './decision/contextual-modifier.service';
import { IssueDetectorService } from './decision/issue-detector.service';
import { PortionAdvisorService } from './decision/portion-advisor.service';
import { UserContextBuilderService } from './decision/user-context-builder.service';

// analyze
import { AnalysisPipelineService } from './analyze/analysis-pipeline.service';
import { ResultAssemblerService } from './analyze/result-assembler.service';
import { AnalysisPersistenceService } from './analyze/analysis-persistence.service';
import { AnalysisStateBuilderService } from './analyze/analysis-state-builder.service';
import { ConfidenceDiagnosticsService } from './analyze/confidence-diagnostics.service';
import { EvidencePackBuilderService } from './analyze/evidence-pack-builder.service';
import { PostMealRecoveryService } from './decision/post-meal-recovery.service';
import { ShouldEatActionService } from './decision/should-eat-action.service';

// V2.4 scoring & decision (Phase 1)
import { ScoringService } from './score/scoring.service';
import { DecisionClassifierService } from './decision/decision-classifier.service';

// V2.4 feedback (Phase 2)
import { AnalysisQualityFeedbackService } from './feedback/quality-feedback.service';

// V3.2 Phase 1 (Phase 1)
import { AnalysisAccuracyService } from './analyze/analysis-accuracy.service';
import { NutritionIssueDetector } from './analyze/nutrition-issue-detector.service';
import { AnalysisContextService } from './analyze/analysis-context.service';

// V3.2 Phase 2
import { DecisionCoachService } from './analyze/decision-coach.service';

// V3.3 Phase 3
import { DecisionCoachService as DecisionCoachServiceV33 } from './coach/decision-coach.service';
import { CoachInsightService } from './coach/coach-insight.service';

@Module({
  imports: [
    forwardRef(() => DietModule),
    forwardRef(() => FoodModule),
    UserModule,
  ],
  providers: [
    DynamicThresholdsService,
    FoodScoringService,
    FoodDecisionService,
    DecisionEngineService,
    DecisionExplainerService,
    DecisionSummaryService,
    DecisionToneResolverService,
    DynamicSignalWeightService,
    DailyMacroSummaryService,
    AlternativeSuggestionService,
    ContextualDecisionModifierService,
    IssueDetectorService,
    PortionAdvisorService,
    UserContextBuilderService,
    AnalysisPipelineService,
    ResultAssemblerService,
    AnalysisPersistenceService,
    AnalysisStateBuilderService,
    ConfidenceDiagnosticsService,
    EvidencePackBuilderService,
    PostMealRecoveryService,
    ShouldEatActionService,
    // V2.4 Phase 1
    ScoringService,
    DecisionClassifierService,
    // V2.4 Phase 2
    AnalysisQualityFeedbackService,
    // V3.2 Phase 1
    AnalysisAccuracyService,
    NutritionIssueDetector,
    AnalysisContextService,
    // V3.2 Phase 2
    DecisionCoachService,
    // V3.3 Phase 3
    DecisionCoachServiceV33,
    CoachInsightService,
    I18nService,
    I18nManagementService,
  ],
  exports: [
    AnalysisPipelineService,
    FoodDecisionService,
    FoodScoringService,
    AlternativeSuggestionService,
    DecisionExplainerService,
    UserContextBuilderService,
    ResultAssemblerService,
    AnalysisPersistenceService,
    DecisionSummaryService,
    AnalysisStateBuilderService,
    ConfidenceDiagnosticsService,
    EvidencePackBuilderService,
    PostMealRecoveryService,
    ShouldEatActionService,
    // V2.4 Phase 1
    ScoringService,
    DecisionClassifierService,
    // V2.4 Phase 2
    AnalysisQualityFeedbackService,
    // V3.2 Phase 1
    AnalysisAccuracyService,
    NutritionIssueDetector,
    AnalysisContextService,
    // V3.2 Phase 2
    DecisionCoachService,
    // V3.3 Phase 3
    DecisionCoachServiceV33,
    CoachInsightService,
    I18nService,
    I18nManagementService,
  ],
})
export class DecisionModule {}
