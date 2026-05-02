-- Seed 12 test users: goal(4: fat_loss, muscle_gain, health, habit) x region(3: CN, US, JP)
-- Idempotent: removes old test users by email pattern '%@e2e.test', recreates.
-- Used by recommendation system debug matrix runner.

BEGIN;

-- 1. Cleanup prior runs (cascade deletes user_profiles via FK)
DELETE FROM app_users WHERE email LIKE '%@e2e.test';

-- 2. Insert 12 users + profiles
WITH matrix(idx, goal, region, locale, currency, height, weight, target, gender, birth_year, activity, calorie) AS (
  VALUES
    -- fat_loss
    (1,  'fat_loss',    'CN', 'zh-CN', 'CNY', 170.0, 78.0, 65.0, 'male',   1990, 'moderate', 1800),
    (2,  'fat_loss',    'US', 'en-US', 'USD', 178.0, 95.0, 80.0, 'male',   1988, 'light',    2000),
    (3,  'fat_loss',    'JP', 'ja-JP', 'JPY', 162.0, 65.0, 55.0, 'female', 1992, 'moderate', 1500),
    -- muscle_gain
    (4,  'muscle_gain', 'CN', 'zh-CN', 'CNY', 175.0, 68.0, 75.0, 'male',   1995, 'active',   2800),
    (5,  'muscle_gain', 'US', 'en-US', 'USD', 183.0, 80.0, 88.0, 'male',   1993, 'active',   3000),
    (6,  'muscle_gain', 'JP', 'ja-JP', 'JPY', 170.0, 60.0, 68.0, 'male',   1996, 'moderate', 2600),
    -- health
    (7,  'health',      'CN', 'zh-CN', 'CNY', 168.0, 60.0, 60.0, 'female', 1991, 'light',    1900),
    (8,  'health',      'US', 'en-US', 'USD', 175.0, 75.0, 75.0, 'male',   1985, 'moderate', 2300),
    (9,  'health',      'JP', 'ja-JP', 'JPY', 158.0, 52.0, 52.0, 'female', 1994, 'light',    1700),
    -- habit
    (10, 'habit',       'CN', 'zh-CN', 'CNY', 172.0, 70.0, 70.0, 'male',   1989, 'moderate', 2200),
    (11, 'habit',       'US', 'en-US', 'USD', 165.0, 62.0, 62.0, 'female', 1990, 'light',    1900),
    (12, 'habit',       'JP', 'ja-JP', 'JPY', 167.0, 58.0, 58.0, 'female', 1993, 'moderate', 1850)
),
inserted_users AS (
  INSERT INTO app_users (id, auth_type, email, nickname, status, email_verified, created_at, updated_at)
  SELECT
    uuid_generate_v4(),
    'email'::app_users_auth_type_enum,
    'e2e-' || idx || '-' || lower(goal) || '-' || lower(region) || '@e2e.test',
    'E2E ' || upper(substring(goal,1,1)) || idx || '-' || region,
    'active'::app_users_status_enum,
    true,
    NOW(), NOW()
  FROM matrix
  RETURNING id, email
)
INSERT INTO user_profiles (
  id, user_id, gender, birth_year, height_cm, weight_kg, target_weight_kg,
  activity_level, daily_calorie_goal, goal, goal_speed, meals_per_day,
  takeout_frequency, can_cook, food_preferences, dietary_restrictions,
  weak_time_slots, binge_triggers, discipline, onboarding_completed,
  allergens, health_conditions, exercise_profile, cooking_skill_level,
  taste_intensity, cuisine_preferences, budget_level, family_size,
  meal_prep_willing, region_code, onboarding_step, data_completeness,
  profile_version, timezone, supplements_used, locale, currency_code,
  created_at, updated_at
)
SELECT
  uuid_generate_v4(),
  iu.id,
  m.gender, m.birth_year, m.height, m.weight, m.target,
  m.activity::user_profiles_activity_level_enum,
  m.calorie, m.goal, 'steady', 3,
  'sometimes', true, '[]'::jsonb, '[]'::jsonb,
  '[]'::jsonb, '[]'::jsonb, 'medium', true,
  '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, 'intermediate',
  '{}'::jsonb,
  CASE m.region
    WHEN 'CN' THEN '["chinese"]'::jsonb
    WHEN 'US' THEN '["american","mexican"]'::jsonb
    WHEN 'JP' THEN '["japanese"]'::jsonb
  END,
  'medium', 1,
  false, m.region, 100, 0.85,
  1,
  CASE m.region
    WHEN 'CN' THEN 'Asia/Shanghai'
    WHEN 'US' THEN 'America/Los_Angeles'
    WHEN 'JP' THEN 'Asia/Tokyo'
  END,
  '[]'::jsonb, m.locale, m.currency,
  NOW(), NOW()
FROM matrix m
JOIN inserted_users iu ON iu.email = 'e2e-' || m.idx || '-' || lower(m.goal) || '-' || lower(m.region) || '@e2e.test';

COMMIT;

-- Verify
SELECT au.email, up.goal, up.region_code, up.locale, up.daily_calorie_goal
FROM app_users au
JOIN user_profiles up ON up.user_id = au.id
WHERE au.email LIKE '%@e2e.test'
ORDER BY au.email;
