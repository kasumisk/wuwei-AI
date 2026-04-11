-- V6.5 Phase 1F: 替换模式初始数据
-- 从现有 recommendation_feedbacks 挖掘 A→B 替换模式

BEGIN;

INSERT INTO replacement_patterns (id, user_id, from_food_id, from_food_name, to_food_id, to_food_name, frequency, last_occurred, created_at, updated_at)
SELECT
  gen_random_uuid(),
  f1.user_id::uuid,
  f1.food_id::uuid as from_food_id,
  f1.food_name as from_food_name,
  f2.food_id::uuid as to_food_id,
  f2.food_name as to_food_name,
  COUNT(*) as frequency,
  MAX(f2.created_at) as last_occurred,
  NOW() as created_at,
  NOW() as updated_at
FROM recommendation_feedbacks f1
JOIN recommendation_feedbacks f2
  ON f1.user_id = f2.user_id
  AND f1.action = 'replaced'
  AND f2.action = 'accepted'
  AND f2.created_at BETWEEN f1.created_at AND f1.created_at + INTERVAL '10 minutes'
  AND f1.food_id IS NOT NULL
  AND f2.food_id IS NOT NULL
  AND f1.food_id != f2.food_id
GROUP BY f1.user_id, f1.food_id, f1.food_name, f2.food_id, f2.food_name
HAVING COUNT(*) >= 2
ON CONFLICT (user_id, from_food_id, to_food_id) DO UPDATE
  SET frequency = EXCLUDED.frequency,
      last_occurred = EXCLUDED.last_occurred,
      updated_at = NOW();

COMMIT;
