import { Module, forwardRef } from '@nestjs/common';
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
import { ScoringService } from './scoring/scoring.service';
import { DecisionClassifierService } from './decision/decision-classifier.service';

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
  ],
})
export class DecisionModule {}
