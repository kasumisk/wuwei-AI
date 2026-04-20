import { Module, forwardRef } from '@nestjs/common';
import { I18nService } from '../../config/i18n.service';
// V4.3: I18nManagementService removed — only used by deprecated DecisionClassifierService
import { DietModule } from '../diet/diet.module';
import { FoodModule } from '../food/food.module';
import { UserModule } from '../user/user.module';

// types / i18n / config
import { DynamicThresholdsService } from './config/dynamic-thresholds.service';

// score
import { FoodScoringService } from './score/food-scoring.service';
import { ScoringStageService } from './score/scoring-stage.service';
import { DecisionStageService } from './decision/decision-stage.service';

// decision
import { FoodDecisionService } from './decision/food-decision.service';
import { DecisionEngineService } from './decision/decision-engine.service';
import { DecisionExplainerService } from './decision/decision-explainer.service';
import { DecisionSummaryService } from './decision/decision-summary.service';
import { DecisionToneResolverService } from './decision/decision-tone-resolver.service';
import { DynamicSignalWeightService } from './config/dynamic-signal-weight.service';
import { DailyMacroSummaryService } from './coach/daily-macro-summary.service';
import { AlternativeSuggestionService } from './decision/alternative-suggestion.service';
import { ContextualDecisionModifierService } from './decision/contextual-modifier.service';
import { IssueDetectorService } from './decision/issue-detector.service';
import { PortionAdvisorService } from './decision/portion-advisor.service';
import { UserContextBuilderService } from './analyze/user-context-builder.service';

// analyze
import { AnalysisPipelineService } from './analyze/analysis-pipeline.service';
import { ResultAssemblerService } from './analyze/result-assembler.service';
import { AnalysisPersistenceService } from './analyze/analysis-persistence.service';
import { AnalysisStateBuilderService } from './analyze/analysis-state-builder.service';
import { ConfidenceDiagnosticsService } from './analyze/confidence-diagnostics.service';
import { EvidencePackBuilderService } from './analyze/evidence-pack-builder.service';
import { PostMealRecoveryService } from './decision/post-meal-recovery.service';
import { ShouldEatActionService } from './decision/should-eat-action.service';

// V4.3: removed — only used by deprecated DecisionClassifierService
// import { ScoringService } from './score/scoring.service';
// import { DecisionClassifierService } from './decision/decision-classifier.service';

// V2.4 feedback (Phase 2)
import { AnalysisQualityFeedbackService } from './feedback/quality-feedback.service';

// V3.2 Phase 1 (Phase 1)
import { AnalysisAccuracyService } from './analyze/analysis-accuracy.service';
import { NutritionIssueDetector } from './analyze/nutrition-issue-detector.service';
import { AnalysisContextService } from './analyze/analysis-context.service';

// V3.3 Phase 3 (V4.1: removed old V3.2 coach, unified to coach/)
import { DecisionCoachService } from './coach/decision-coach.service';
import { CoachInsightService } from './coach/coach-insight.service';
import { CoachingStageService } from './coach/coaching-stage.service';

@Module({
  imports: [
    forwardRef(() => DietModule),
    forwardRef(() => FoodModule),
    UserModule,
  ],
  providers: [
    DynamicThresholdsService,
    FoodScoringService,
    ScoringStageService,
    DecisionStageService,
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
    // V2.4 Phase 1 — V4.3: ScoringService + DecisionClassifierService deprecated & removed
    // V2.4 Phase 2
    AnalysisQualityFeedbackService,
    // V3.2 Phase 1
    AnalysisAccuracyService,
    NutritionIssueDetector,
    AnalysisContextService,
    // V3.3 Phase 3 (V4.1: unified coach)
    DecisionCoachService,
    CoachInsightService,
    CoachingStageService,
    I18nService,
    // V4.3: I18nManagementService removed — only used by deprecated DecisionClassifierService
  ],
  exports: [
    AnalysisPipelineService,
    FoodDecisionService,
    FoodScoringService,
    ScoringStageService,
    DecisionStageService,
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
    // V2.4 Phase 1 — V4.3: ScoringService + DecisionClassifierService deprecated & removed
    // V2.4 Phase 2
    AnalysisQualityFeedbackService,
    // V3.2 Phase 1
    AnalysisAccuracyService,
    NutritionIssueDetector,
    AnalysisContextService,
    // V3.3 Phase 3 (V4.1: unified coach)
    DecisionCoachService,
    CoachInsightService,
    CoachingStageService,
    I18nService,
    // V4.3: I18nManagementService removed
  ],
})
export class DecisionModule {}
