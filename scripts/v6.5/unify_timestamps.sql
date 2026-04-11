-- V6.5 Phase 2J: 时间戳类型统一迁移
-- 将所有 timestamp(6) 字段改为 timestamptz(6)，确保时区感知

-- foods
ALTER TABLE foods ALTER COLUMN created_at TYPE timestamptz(6);
ALTER TABLE foods ALTER COLUMN updated_at TYPE timestamptz(6);
ALTER TABLE foods ALTER COLUMN verified_at TYPE timestamptz(6);
ALTER TABLE foods ALTER COLUMN embedding_updated_at TYPE timestamptz(6);

-- daily_plans
ALTER TABLE daily_plans ALTER COLUMN created_at TYPE timestamptz(6);
ALTER TABLE daily_plans ALTER COLUMN updated_at TYPE timestamptz(6);

-- daily_summaries
ALTER TABLE daily_summaries ALTER COLUMN date TYPE timestamptz(6);
ALTER TABLE daily_summaries ALTER COLUMN created_at TYPE timestamptz(6);

-- food_records
ALTER TABLE food_records ALTER COLUMN recorded_at TYPE timestamptz(6);
ALTER TABLE food_records ALTER COLUMN created_at TYPE timestamptz(6);
ALTER TABLE food_records ALTER COLUMN updated_at TYPE timestamptz(6);

-- recommendation_feedbacks
ALTER TABLE recommendation_feedbacks ALTER COLUMN created_at TYPE timestamptz(6);

-- user_profiles
ALTER TABLE user_profiles ALTER COLUMN created_at TYPE timestamptz(6);
ALTER TABLE user_profiles ALTER COLUMN updated_at TYPE timestamptz(6);

-- user_behavior_profiles
ALTER TABLE user_behavior_profiles ALTER COLUMN updated_at TYPE timestamptz(6);

-- user_inferred_profiles
ALTER TABLE user_inferred_profiles ALTER COLUMN last_computed_at TYPE timestamptz(6);
ALTER TABLE user_inferred_profiles ALTER COLUMN updated_at TYPE timestamptz(6);

-- app_users
ALTER TABLE app_users ALTER COLUMN last_login_at TYPE timestamptz(6);
ALTER TABLE app_users ALTER COLUMN created_at TYPE timestamptz(6);
ALTER TABLE app_users ALTER COLUMN updated_at TYPE timestamptz(6);

-- weight_history
ALTER TABLE weight_history ALTER COLUMN recorded_at TYPE timestamptz(6);

-- recipe_translations
ALTER TABLE recipe_translations ALTER COLUMN created_at TYPE timestamptz(6);
ALTER TABLE recipe_translations ALTER COLUMN updated_at TYPE timestamptz(6);

-- profile_snapshots
ALTER TABLE profile_snapshots ALTER COLUMN created_at TYPE timestamptz(6);

-- coach_conversations
ALTER TABLE coach_conversations ALTER COLUMN created_at TYPE timestamptz(6);
ALTER TABLE coach_conversations ALTER COLUMN updated_at TYPE timestamptz(6);

-- 注意：此迁移对现有数据无损，PostgreSQL 会保留原始值
-- 但新写入的数据将自动附带时区信息
