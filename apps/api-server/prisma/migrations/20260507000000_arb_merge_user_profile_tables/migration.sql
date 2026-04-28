-- ARB-2026-04: Merge UserInferredProfiles + UserBehaviorProfiles into UserProfiles
-- Strategy: Add JSONB columns to user_profiles, backfill from old tables, DROP old tables

-- Step 1: Add new JSONB columns to user_profiles
ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "inferred_data" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS "behavior_data"  JSONB NOT NULL DEFAULT '{}';

-- Step 2: Backfill inferred_data from user_inferred_profiles
UPDATE "user_profiles" up
SET "inferred_data" = jsonb_build_object(
  'estimatedBmr',        uip."estimated_bmr",
  'estimatedTdee',       uip."estimated_tdee",
  'recommendedCalories', uip."recommended_calories",
  'macroTargets',        COALESCE(uip."macro_targets", '{}'),
  'userSegment',         uip."user_segment",
  'churnRisk',           uip."churn_risk",
  'optimalMealCount',    uip."optimal_meal_count",
  'tastePrefVector',     COALESCE(uip."taste_pref_vector", '[]'),
  'nutritionGaps',       COALESCE(uip."nutrition_gaps", '[]'),
  'goalProgress',        COALESCE(uip."goal_progress", '{}'),
  'confidenceScores',    COALESCE(uip."confidence_scores", '{}'),
  'lastComputedAt',      uip."last_computed_at",
  'preferenceWeights',   uip."preference_weights"
)
FROM "user_inferred_profiles" uip
WHERE up."user_id" = uip."user_id";

-- Step 3: Backfill behavior_data from user_behavior_profiles
UPDATE "user_profiles" up
SET "behavior_data" = jsonb_build_object(
  'foodPreferences',     COALESCE(ubp."food_preferences", '{}'),
  'bingeRiskHours',      COALESCE(ubp."binge_risk_hours", '[]'),
  'failureTriggers',     COALESCE(ubp."failure_triggers", '[]'),
  'avgComplianceRate',   ubp."avg_compliance_rate",
  'coachStyle',          ubp."coach_style",
  'totalRecords',        ubp."total_records",
  'healthyRecords',      ubp."healthy_records",
  'streakDays',          ubp."streak_days",
  'longestStreak',       ubp."longest_streak",
  'mealTimingPatterns',  COALESCE(ubp."meal_timing_patterns", '{}'),
  'portionTendency',     ubp."portion_tendency",
  'replacementPatterns', COALESCE(ubp."replacement_patterns", '{}'),
  'lastStreakDate',      ubp."last_streak_date"
)
FROM "user_behavior_profiles" ubp
WHERE up."user_id" = ubp."user_id";

-- Step 4: DROP old tables (CASCADE removes FK constraints)
DROP TABLE IF EXISTS "user_inferred_profiles" CASCADE;
DROP TABLE IF EXISTS "user_behavior_profiles" CASCADE;
