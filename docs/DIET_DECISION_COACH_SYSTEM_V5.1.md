# Diet Decision + AI Coach System V5.1 — Design Document

## Overview

V5.1 upgrades the diet decision + AI coach system from V5.0 by addressing 3 core problems:

1. **Prompt-DB misalignment**: Analysis prompt fields diverge from food library DB schema and enrichment pipeline conventions
2. **i18n scattered in logic**: Translations hardcoded in service logic instead of centralized label files
3. **Weak alternative suggestions**: Static rules instead of leveraging the mature recommendation engine

### Constraints

- **NO modifications** to: recommendation system, user profile system, subscription/business logic (read-only)
- **NO new database fields**, **NO new modules** (new files within existing modules OK)
- **NOT backward-compatible** with old code — optimize freely
- Logger messages: English only
- User-facing error messages: English (frontend handles display)
- Chinese NLP logic in `text-food-analysis.service.ts` must NOT be modified

---

## Step 1: Current Capability Analysis

### What exists (V5.0)

| Layer        | Capability                                                                                                  | Status        |
| ------------ | ----------------------------------------------------------------------------------------------------------- | ------------- |
| **Analysis** | Text/image → foods with per-100g nutrition, 40+ fields                                                      | ✅ Mature     |
| **Analysis** | Food library matching (nameEn + fuzzy)                                                                      | ✅ Exists     |
| **Analysis** | Context analysis (today's intake, budget status, macro slot)                                                | ✅ Exists     |
| **Scoring**  | 7-dimension breakdown (energy, proteinRatio, macroBalance, foodQuality, satiety, stability, glycemicImpact) | ✅ Mature     |
| **Scoring**  | Health condition adjustments (diabetes, hypertension, gout, IBS, etc.)                                      | ✅ Exists     |
| **Scoring**  | Goal-specific weights + phase adjustment                                                                    | ✅ Exists     |
| **Decision** | 3-verdict (recommend/caution/avoid) + 4-factor structured decision                                          | ✅ Exists     |
| **Decision** | Dynamic thresholds based on user goals                                                                      | ✅ Exists     |
| **Decision** | Conflict detection (allergen/restriction/health)                                                            | ✅ Exists     |
| **Decision** | Alternative suggestions (static rules + limited engine)                                                     | ⚠️ Weak       |
| **Coach**    | Coaching explanation with headline/summary/issues/guidance/education                                        | ✅ Exists     |
| **Coach**    | Conflict explanations (P3.1), flavor tips (P3.5)                                                            | ✅ Exists     |
| **Coach**    | Tone resolver (control/encourage/neutral/urgent/affirm)                                                     | ✅ Exists     |
| **i18n**     | 3 systems: cl(), ci(), chainLabel() — 700+ keys per locale                                                  | ⚠️ Fragmented |

### Gaps Identified

| #   | Gap                                                                                                                                                                                                                                                                                                       | Impact                                           |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| G1  | Analysis prompt returns fields that don't match food library DB naming (e.g. prompt uses `standardServingG` but enrichment uses `standard_serving_g`; prompt missing `waterContentPercent`, `naturalSugar`, `insolubleFiber`, `vitaminE`, `vitaminB12`, `vitaminB6`, `folate`, `magnesium`, `phosphorus`) | Downstream scoring/decision gets incomplete data |
| G2  | Text/image prompts still have separate code paths with redundant prompt construction                                                                                                                                                                                                                      | Maintenance burden, inconsistency                |
| G3  | `DecisionFoodItem` has flat fields that duplicate `AnalyzedFoodItem` — per-100g→per-serving conversion scattered                                                                                                                                                                                          | Error-prone, hard to maintain                    |
| G4  | Alternative suggestions use static category rules as primary; recommendation engine only called as fallback                                                                                                                                                                                               | Poor alternatives quality                        |
| G5  | Coach i18n keys scattered: some in `labels-*.ts`, some inline in service logic (`cl('health.diabetesRisk.label')` etc.)                                                                                                                                                                                   | Hard to maintain, inconsistent                   |
| G6  | Scoring service has duplicate `BreakdownExplanation` type defined both in `food-scoring.service.ts` and `decision.types.ts`                                                                                                                                                                               | Type confusion                                   |
| G7  | `analysis-prompt-schema.ts` has deprecated functions (`buildContextBlock`, `buildPrecisionBlock`) still present                                                                                                                                                                                           | Dead code                                        |
| G8  | No structured per-food scoring (only aggregate meal scoring)                                                                                                                                                                                                                                              | Cannot explain per-food contribution             |

---

## Step 2: Analysis System Design

### (1) Single Meal Analysis

- **Input**: User + food text/image + optional mealType
- **Output**: `AnalyzedFoodItem[]` with per-100g nutrition, `NutritionTotals` (per-serving aggregated), `AnalysisScore`
- **V5.1 change**: Prompt schema aligned with food enrichment pipeline (64 DB fields)

### (2) Context Analysis

- Already exists via `UserContextBuilderService` + `AnalysisContextService`
- Produces: today's consumed totals, remaining budget, macro slot status (deficit/ok/excess per dimension)
- **V5.1 change**: Pass `contextualAnalysis.recommendationContext` to recommendation engine for alternatives

### (3) Issue Identification

- Already exists: `NutritionIssueDetector` produces `NutritionIssue[]` (15 types, 3 severity levels)
- `IssueDetectorService` produces `DietIssue[]` (14 categories)
- **V5.1 change**: Coach uses both issue lists for richer explanations

---

## Step 3: Decision System Design

### (1) Should Eat verdict

- Exists: `DecisionEngineService.computeDecision()` → recommend/caution/avoid
- `computeStructuredDecision()` → 4-factor weighted scoring with goal-adaptive weights

### (2) Reason Explanation

- Exists: `DecisionExplainerService` + `BreakdownExplanation[]`
- **V5.1 change**: Conflict explanations enriched with specific food-nutrient data

### (3) Alternatives

- **V5.1 key change**: Primary path uses `RecommendationEngineService.recommendMeal()` with nutritional constraints from `contextualAnalysis.recommendationContext`
- Static rules become fallback only

### (4) Dynamic Decision

- Exists: time-aware (late night penalty), streak-aware (compliance bonus), trend-aware (7-day intake trend)
- Same food can get different verdicts at different times — already supported

---

## Step 4: AI Coach System Design

### (1) Dialogue-style Guidance

- Exists: `COACH_PROMPT_TEMPLATES` with structured headline/guidance/close
- **V5.1 change**: Templates use `cl()` keys instead of inline text

### (2) Structured Output

- Already structured: `CoachingExplanation` with headline, summary, issueExplanations[], guidance[], educationPoints[], actionPlan

### (3) Personalized Tone

- Exists: `DecisionToneResolverService` resolves tone key from goal + context
- fat_loss → control, muscle_gain → encourage
- **V5.1 change**: Tone modifiers pulled from `cl()` keys

---

## Step 5: Decision Chain Design

```
User Input (text/image)
  → Food Recognition (text-food-analysis / image-food-analysis)
  → Library Matching (food-library.service)
  → [Pipeline Entry: analysis-pipeline.service]
     Stage 1 — Analyze:
       → Nutrition Aggregation (per-100g → per-serving)
       → User Context Build (profile + today's intake + goals)
       → Scoring (7-dimension + health adjustments)
       → Context Analysis (issues + macro progress)
     Stage 2 — Decide:
       → Decision Engine (verdict + structured 4-factor)
       → Alternatives (recommendation engine primary + static fallback)
       → Decision Summary
     Stage 3 — Coach:
       → Coaching Explanation (tone-aware, i18n, conflict-enriched)
       → Action Plan
  → Response Assembly
```

---

## Step 6: API Capability Design

| Capability          | Existing API                                  | V5.1 Change                      |
| ------------------- | --------------------------------------------- | -------------------------------- |
| Text food analysis  | `POST /food/analyze/text`                     | Prompt upgraded, fields aligned  |
| Image food analysis | `POST /food/analyze/image`                    | Same prompt as text              |
| Decision query      | Part of analysis response                     | No API change                    |
| Coach explanation   | Part of analysis response                     | Richer output                    |
| Recommendation      | `RecommendationEngineService.recommendMeal()` | Read-only, used for alternatives |

No new API endpoints needed. All changes are internal service-level.

---

## Step 7: Data Structure Design

### Enhanced types (no DB changes)

1. **`AnalyzedFoodItem`** — add missing enrichment-aligned fields: `waterContentPercent`, `naturalSugar`, `insolubleFiber`, `vitaminE`, `vitaminB12`, `vitaminB6`, `folate`, `magnesium`, `phosphorus`, `textureTags`, `dishType`, `mainIngredient`
2. **`DecisionFoodItem`** — replaced with computed view from `AnalyzedFoodItem` (per-serving conversion centralized)
3. **`ScoringFoodItem`** — updated Pick to include new fields
4. **Prompt JSON schema** — aligned 1:1 with food enrichment `FIELD_DESC` naming

---

## Step 8: Phased Implementation

### Phase 1 — Prompt Alignment + Field Unification + Cleanup (6 goals)

| #    | Goal                                           | Description                                                                                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.1 | **Prompt schema alignment**                    | Rewrite `FOOD_JSON_SCHEMA` in `analysis-prompt-schema.ts` to align 1:1 with food enrichment pipeline's `FIELD_DESC`. Add missing fields (`waterContentPercent`, `naturalSugar`, `insolubleFiber`, `vitaminE`, `vitaminB12`, `vitaminB6`, `folate`, `magnesium`, `phosphorus`). Use identical field descriptions and validation ranges. |
| P1.2 | **AnalyzedFoodItem type expansion**            | Add missing fields to `AnalyzedFoodItem` interface to match expanded prompt schema.                                                                                                                                                                                                                                                    |
| P1.3 | **Remove deprecated prompt functions**         | Remove `buildContextBlock()`, `buildPrecisionBlock()`, `SYSTEM_ROLE` (deprecated V5.0). Clean `USER_MESSAGE_TEMPLATE` to single unified template.                                                                                                                                                                                      |
| P1.4 | **Deduplicate BreakdownExplanation type**      | Remove duplicate `BreakdownExplanation` from `food-scoring.service.ts`, use single source from `decision.types.ts`.                                                                                                                                                                                                                    |
| P1.5 | **Centralize per-100g→per-serving conversion** | Create `toPerServing()` utility. Refactor `DecisionStageService.toDecisionFoodItems()` and `ScoringStageService` to use it.                                                                                                                                                                                                            |
| P1.6 | **tsc 0 errors**                               | Ensure clean compilation.                                                                                                                                                                                                                                                                                                              |

### Phase 2 — Recommendation Engine Alternatives + Architecture (6 goals)

| #    | Goal                                           | Description                                                                                                                                                                                                                                      |
| ---- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2.1 | **Recommendation engine primary alternatives** | Refactor `AlternativeSuggestionService.generateAlternatives()` to call `RecommendationEngineService.recommendMeal()` as primary path with nutritional constraints from `contextualAnalysis.recommendationContext`. Static rules become fallback. |
| P2.2 | **Enrich alternatives with comparison data**   | For each engine-sourced alternative, compute `AlternativeComparison` (calorie diff, protein diff, score diff) against original food.                                                                                                             |
| P2.3 | **Move inline i18n to labels files**           | Extract all inline `Record<string, string>` translations from service files (scoring-dimensions, prompt-labels, analysis-prompt-schema) into `labels-zh/en/ja.ts`. Replace with `cl()` calls.                                                    |
| P2.4 | **Clean coach-i18n redundancy**                | Audit `CoachI18nStrings` interface — remove unused keys, ensure all 166 keys have entries in all 3 locale files.                                                                                                                                 |
| P2.5 | **Scoring dimension i18n consolidation**       | Move `DIMENSION_LABELS`, `DIMENSION_EXPLANATIONS`, `DIMENSION_SUGGESTIONS` from `scoring-dimensions.ts` into `labels-*.ts`, accessed via `cl()`.                                                                                                 |
| P2.6 | **tsc 0 errors**                               | Ensure clean compilation.                                                                                                                                                                                                                        |

### Phase 3 — Coach Enhancement + i18n Consolidation (6 goals)

| #    | Goal                                                                | Description                                                                                                                     |
| ---- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| P3.1 | **Coach prompt templates via cl()**                                 | Move `COACH_PROMPT_TEMPLATES` content into `labels-*.ts` under `coach.prompt.*` keys. `prompt-labels.ts` becomes thin accessor. |
| P3.2 | **Conflict explanation enrichment**                                 | In `buildConflictExplanations()`, include specific food names and nutrient values that caused the conflict.                     |
| P3.3 | **Health condition i18n consolidation**                             | Move `HEALTH_CONDITION_INSTRUCTIONS` text from `prompt-labels.ts` into `labels-*.ts` under `prompt.health.*` keys.              |
| P3.4 | **Goal focus blocks i18n consolidation**                            | Move `GOAL_FOCUS_BLOCKS` text into `labels-*.ts` under `prompt.goal.*` keys.                                                    |
| P3.5 | **Remove all remaining inline Record<string, string> translations** | Final sweep of all decision module files to ensure zero inline translations remain. All user-facing text goes through `cl()`.   |
| P3.6 | **tsc 0 errors + final audit**                                      | Ensure clean compilation, remove all dead code.                                                                                 |

---

## Files to Modify

### Phase 1

- `apps/api-server/src/modules/food/app/services/analysis-prompt-schema.ts` — rewrite prompt schema
- `apps/api-server/src/modules/decision/types/food-item.types.ts` — expand AnalyzedFoodItem
- `apps/api-server/src/modules/decision/score/food-scoring.service.ts` — remove duplicate type
- `apps/api-server/src/modules/decision/decision/decision-stage.service.ts` — use centralized conversion
- `apps/api-server/src/modules/decision/score/scoring-stage.service.ts` — use centralized conversion

### Phase 2

- `apps/api-server/src/modules/decision/decision/alternative-suggestion.service.ts` — engine-first alternatives
- `apps/api-server/src/modules/decision/i18n/labels-zh.ts` — add scoring dimension + prompt keys
- `apps/api-server/src/modules/decision/i18n/labels-en.ts` — same
- `apps/api-server/src/modules/decision/i18n/labels-ja.ts` — same
- `apps/api-server/src/modules/decision/config/scoring-dimensions.ts` — delegate to cl()
- `apps/api-server/src/modules/decision/coach/coach-i18n.ts` — audit

### Phase 3

- `apps/api-server/src/modules/decision/i18n/prompt-labels.ts` — thin accessors
- `apps/api-server/src/modules/decision/coach/decision-coach.service.ts` — enriched conflicts
- `apps/api-server/src/modules/decision/i18n/labels-zh.ts` — add prompt/coach template keys
- `apps/api-server/src/modules/decision/i18n/labels-en.ts` — same
- `apps/api-server/src/modules/decision/i18n/labels-ja.ts` — same
