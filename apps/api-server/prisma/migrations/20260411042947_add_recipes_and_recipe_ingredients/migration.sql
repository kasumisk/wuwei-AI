-- Enable uuid-ossp extension for uuid_generate_v4() support in shadow database
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Enable pgvector extension for vector type support
CREATE EXTENSION IF NOT EXISTS "vector";

-- Enable pg_trgm extension for GIN trigram index support
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- CreateEnum
CREATE TYPE "ab_experiments_status_enum" AS ENUM ('draft', 'running', 'paused', 'completed');

-- CreateEnum
CREATE TYPE "activity_level_enum" AS ENUM ('sedentary', 'light', 'moderate', 'active');

-- CreateEnum
CREATE TYPE "admin_role_enum" AS ENUM ('super_admin', 'admin');

-- CreateEnum
CREATE TYPE "admin_user_status_enum" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "admin_users_role_enum" AS ENUM ('super_admin', 'admin');

-- CreateEnum
CREATE TYPE "admin_users_status_enum" AS ENUM ('active', 'inactive', 'suspended');

-- CreateEnum
CREATE TYPE "app_user_auth_type_enum" AS ENUM ('anonymous', 'google', 'email', 'phone', 'wechat', 'wechat_mini', 'apple');

-- CreateEnum
CREATE TYPE "app_user_status_enum" AS ENUM ('active', 'inactive', 'banned');

-- CreateEnum
CREATE TYPE "app_users_auth_type_enum" AS ENUM ('anonymous', 'google', 'email', 'phone', 'wechat', 'wechat_mini', 'apple');

-- CreateEnum
CREATE TYPE "app_users_status_enum" AS ENUM ('active', 'inactive', 'banned');

-- CreateEnum
CREATE TYPE "app_version_packages_platform_enum" AS ENUM ('android', 'ios');

-- CreateEnum
CREATE TYPE "app_versions_platform_enum" AS ENUM ('android', 'ios');

-- CreateEnum
CREATE TYPE "app_versions_status_enum" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "app_versions_updateType_enum" AS ENUM ('optional', 'force');

-- CreateEnum
CREATE TYPE "capability_type_enum" AS ENUM ('text.generation', 'text.completion', 'text.embedding', 'image.generation', 'image.edit', 'speech.to_text', 'text.to_speech', 'translation', 'moderation');

-- CreateEnum
CREATE TYPE "currency_enum" AS ENUM ('USD', 'CNY');

-- CreateEnum
CREATE TYPE "feature_flag_type_enum" AS ENUM ('boolean', 'percentage', 'user_list', 'segment');

-- CreateEnum
CREATE TYPE "food_records_meal_type_enum" AS ENUM ('breakfast', 'lunch', 'dinner', 'snack');

-- CreateEnum
CREATE TYPE "food_records_source_enum" AS ENUM ('screenshot', 'camera', 'manual', 'text_analysis', 'image_analysis');

-- CreateEnum
CREATE TYPE "http_method_enum" AS ENUM ('GET', 'POST', 'PUT', 'DELETE', 'PATCH');

-- CreateEnum
CREATE TYPE "meal_type_enum" AS ENUM ('breakfast', 'lunch', 'dinner', 'snack');

-- CreateEnum
CREATE TYPE "model_configs_capabilitytype_enum" AS ENUM ('text.generation', 'text.completion', 'text.embedding', 'image.generation', 'image.edit', 'speech.to_text', 'text.to_speech', 'translation', 'moderation');

-- CreateEnum
CREATE TYPE "model_configs_currency_enum" AS ENUM ('USD', 'CNY');

-- CreateEnum
CREATE TYPE "model_configs_status_enum" AS ENUM ('active', 'inactive', 'deprecated');

-- CreateEnum
CREATE TYPE "model_status_enum" AS ENUM ('active', 'inactive', 'deprecated');

-- CreateEnum
CREATE TYPE "permission_status_enum" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "permission_type_enum" AS ENUM ('menu', 'operation');

-- CreateEnum
CREATE TYPE "permissions_action_enum" AS ENUM ('GET', 'POST', 'PUT', 'DELETE', 'PATCH');

-- CreateEnum
CREATE TYPE "permissions_status_enum" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "permissions_type_enum" AS ENUM ('menu', 'operation');

-- CreateEnum
CREATE TYPE "provider_status_enum" AS ENUM ('active', 'inactive', 'error');

-- CreateEnum
CREATE TYPE "provider_type_enum" AS ENUM ('openai', 'anthropic', 'deepseek', 'qwen', 'google', 'baidu', 'alibaba', 'tencent', 'custom');

-- CreateEnum
CREATE TYPE "providers_status_enum" AS ENUM ('active', 'inactive', 'error');

-- CreateEnum
CREATE TYPE "providers_type_enum" AS ENUM ('openai', 'anthropic', 'deepseek', 'qwen', 'google', 'baidu', 'alibaba', 'tencent', 'custom');

-- CreateEnum
CREATE TYPE "record_source_enum" AS ENUM ('screenshot', 'camera', 'manual');

-- CreateEnum
CREATE TYPE "roles_status_enum" AS ENUM ('active', 'inactive');

-- CreateEnum
CREATE TYPE "user_profiles_activity_level_enum" AS ENUM ('sedentary', 'light', 'moderate', 'active');

-- CreateTable
CREATE TABLE "ab_experiments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "goal_type" VARCHAR(30) NOT NULL DEFAULT '*',
    "status" "ab_experiments_status_enum" NOT NULL DEFAULT 'draft',
    "groups" JSONB NOT NULL DEFAULT '[]',
    "start_date" TIMESTAMP(6),
    "end_date" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ab_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "icon" VARCHAR(10),
    "category" VARCHAR(30),
    "threshold" INTEGER NOT NULL,
    "reward_type" VARCHAR(30),
    "reward_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PK_1bc19c37c6249f70186f318d71d" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "username" VARCHAR(100) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "email" VARCHAR(255),
    "phone" VARCHAR(20),
    "role" "admin_users_role_enum" NOT NULL DEFAULT 'admin',
    "status" "admin_users_status_enum" NOT NULL DEFAULT 'active',
    "avatar" VARCHAR(255),
    "nickname" VARCHAR(100),
    "last_login_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_06744d221bb6145dc61e5dc441d" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_decision_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "record_id" UUID,
    "input_context" JSONB,
    "input_image_url" TEXT,
    "decision" VARCHAR(10),
    "risk_level" VARCHAR(5),
    "full_response" JSONB,
    "user_followed" BOOLEAN,
    "user_feedback" VARCHAR(20),
    "actual_outcome" VARCHAR(20),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_e5aa864516bc349d6e085024cee" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_food_link" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "analysis_id" UUID NOT NULL,
    "food_library_id" UUID,
    "food_candidate_id" UUID,
    "food_name" VARCHAR(120) NOT NULL,
    "match_type" VARCHAR(20) NOT NULL,
    "confidence" DECIMAL(5,2) DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_food_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_users" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "auth_type" "app_users_auth_type_enum" NOT NULL DEFAULT 'anonymous',
    "email" VARCHAR(255),
    "password" VARCHAR(255),
    "google_id" VARCHAR(255),
    "device_id" VARCHAR(255),
    "phone" VARCHAR(20),
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "wechat_open_id" VARCHAR(128),
    "wechat_union_id" VARCHAR(128),
    "wechat_mini_open_id" VARCHAR(128),
    "apple_id" VARCHAR(255),
    "nickname" VARCHAR(100),
    "avatar" VARCHAR(255),
    "status" "app_users_status_enum" NOT NULL DEFAULT 'active',
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "last_login_at" TIMESTAMP(6),
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_9b97e4fbff9c2f3918fda27f999" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_version_packages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "versionId" UUID NOT NULL,
    "platform" "app_version_packages_platform_enum" NOT NULL,
    "channel" VARCHAR(50) NOT NULL,
    "downloadUrl" VARCHAR(1000) NOT NULL,
    "fileSize" BIGINT NOT NULL DEFAULT 0,
    "checksum" VARCHAR(255),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_cf82df0345378efd08dd5683389" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_versions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "platform" "app_versions_platform_enum",
    "version" VARCHAR(50) NOT NULL,
    "versionCode" INTEGER NOT NULL,
    "updateType" "app_versions_updateType_enum" NOT NULL DEFAULT 'optional',
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT NOT NULL,
    "minSupportVersion" VARCHAR(50),
    "minSupportVersionCode" INTEGER,
    "status" "app_versions_status_enum" NOT NULL DEFAULT 'draft',
    "grayRelease" BOOLEAN NOT NULL DEFAULT false,
    "grayPercent" INTEGER NOT NULL DEFAULT 0,
    "releaseDate" TIMESTAMP(6),
    "i18nDescription" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_8d36b0dcf0c026c7aad923c80fd" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "challenges" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "title" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "type" VARCHAR(30),
    "duration_days" INTEGER NOT NULL,
    "rules" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PK_1e664e93171e20fe4d6125466af" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_capability_permissions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "client_id" UUID NOT NULL,
    "capability_type" VARCHAR(100) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rate_limit" INTEGER NOT NULL DEFAULT 60,
    "quota_limit" BIGINT,
    "preferred_provider" VARCHAR(50),
    "allowed_providers" TEXT,
    "allowed_models" TEXT,
    "config" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_c1a6818a8b4efddd7f349efd371" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(255) NOT NULL,
    "api_key" VARCHAR(255) NOT NULL,
    "api_secret" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "quota_config" JSONB,
    "description" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_f1ab7cf3a5714dbc6bb4e1c28a4" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_conversations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "title" VARCHAR(200),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_a39c641e9cb65d97f4297f6e48e" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coach_messages" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "conversation_id" UUID NOT NULL,
    "role" VARCHAR(20) NOT NULL,
    "content" TEXT NOT NULL,
    "tokens_used" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_d739031ac3c1470a4d96a9bfe8f" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_plans" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "morning_plan" JSONB,
    "lunch_plan" JSONB,
    "dinner_plan" JSONB,
    "snack_plan" JSONB,
    "adjustments" JSONB NOT NULL DEFAULT '[]',
    "strategy" TEXT,
    "total_budget" INTEGER,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_ebf4c93c574708a8ba6919252df" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_summaries" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "total_calories" INTEGER NOT NULL DEFAULT 0,
    "calorie_goal" INTEGER,
    "meal_count" INTEGER NOT NULL DEFAULT 0,
    "total_protein" DECIMAL(7,1) NOT NULL DEFAULT 0,
    "total_fat" DECIMAL(7,1) NOT NULL DEFAULT 0,
    "total_carbs" DECIMAL(7,1) NOT NULL DEFAULT 0,
    "avg_quality" DECIMAL(3,1) NOT NULL DEFAULT 0,
    "avg_satiety" DECIMAL(3,1) NOT NULL DEFAULT 0,
    "nutrition_score" INTEGER NOT NULL DEFAULT 0,
    "protein_goal" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "fat_goal" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "carbs_goal" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_2d7ed4d1fd3c764c045b6945c4a" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" VARCHAR(500) NOT NULL,
    "device_id" VARCHAR(200) NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_embeddings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "text" TEXT,
    "metadata" JSONB,
    "embedding" vector,

    CONSTRAINT "document_embeddings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flag" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(100) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "type" "feature_flag_type_enum" NOT NULL DEFAULT 'boolean',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "config" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feature_flag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback_details" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "feedback_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "food_name" VARCHAR(100) NOT NULL,
    "meal_type" VARCHAR(20) NOT NULL,
    "taste_rating" SMALLINT,
    "portion_rating" SMALLINT,
    "price_rating" SMALLINT,
    "timing_rating" SMALLINT,
    "comment" TEXT,
    "dwell_time_ms" INTEGER,
    "detail_expanded" BOOLEAN,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_details_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_analysis_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "input_type" VARCHAR(10) NOT NULL,
    "raw_text" TEXT,
    "image_url" VARCHAR(500),
    "meal_type" VARCHAR(20),
    "status" VARCHAR(20) NOT NULL DEFAULT 'completed',
    "recognized_payload" JSONB,
    "normalized_payload" JSONB,
    "nutrition_payload" JSONB,
    "decision_payload" JSONB,
    "confidence_score" DECIMAL(5,2),
    "quality_score" DECIMAL(5,2),
    "matched_food_count" INTEGER NOT NULL DEFAULT 0,
    "candidate_food_count" INTEGER NOT NULL DEFAULT 0,
    "persist_status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "source_request_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_analysis_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_candidate" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "canonical_name" VARCHAR(120) NOT NULL,
    "aliases" JSONB DEFAULT '[]',
    "category" VARCHAR(30),
    "estimated_nutrition" JSONB,
    "source_type" VARCHAR(20) NOT NULL,
    "source_count" INTEGER DEFAULT 1,
    "avg_confidence" DECIMAL(5,2) DEFAULT 0,
    "quality_score" DECIMAL(5,2) DEFAULT 0,
    "review_status" VARCHAR(20) DEFAULT 'pending',
    "merged_food_id" UUID,
    "first_seen_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "food_candidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_change_logs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "food_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "changes" JSONB NOT NULL,
    "reason" TEXT,
    "operator" VARCHAR(100),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_717727f76e41ee87d1cfc893745" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_conflicts" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "food_id" UUID NOT NULL,
    "field" VARCHAR(50) NOT NULL,
    "sources" JSONB NOT NULL,
    "resolution" VARCHAR(20),
    "resolved_value" TEXT,
    "resolved_by" VARCHAR(100),
    "resolved_at" TIMESTAMP(6),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_37c15f451790ed4ba5c66c8d82c" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_records" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "image_url" VARCHAR(500),
    "source" "food_records_source_enum" NOT NULL DEFAULT 'screenshot',
    "recognized_text" TEXT,
    "foods" JSONB NOT NULL DEFAULT '[]',
    "total_calories" INTEGER NOT NULL DEFAULT 0,
    "meal_type" "food_records_meal_type_enum" NOT NULL DEFAULT 'lunch',
    "advice" TEXT,
    "is_healthy" BOOLEAN,
    "decision" VARCHAR(10) NOT NULL DEFAULT 'SAFE',
    "risk_level" VARCHAR(5),
    "reason" TEXT,
    "suggestion" TEXT,
    "instead_options" JSONB NOT NULL DEFAULT '[]',
    "compensation" JSONB,
    "context_comment" TEXT,
    "encouragement" TEXT,
    "total_protein" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "total_fat" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "total_carbs" DECIMAL(6,1) NOT NULL DEFAULT 0,
    "avg_quality" DECIMAL(3,1) NOT NULL DEFAULT 0,
    "avg_satiety" DECIMAL(3,1) NOT NULL DEFAULT 0,
    "nutrition_score" INTEGER NOT NULL DEFAULT 0,
    "recorded_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analysis_id" UUID,

    CONSTRAINT "PK_11f84af71017274532ef98f5d43" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_regional_info" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "food_id" UUID NOT NULL,
    "region" VARCHAR(10) NOT NULL,
    "local_popularity" INTEGER NOT NULL DEFAULT 0,
    "local_price_range" VARCHAR(20),
    "availability" VARCHAR(20),
    "regulatory_info" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_a85c86ffa0a1e8ad0b7b650d0e0" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_sources" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "food_id" UUID NOT NULL,
    "source_type" VARCHAR(50) NOT NULL,
    "source_id" VARCHAR(200),
    "source_url" VARCHAR(500),
    "raw_data" JSONB NOT NULL,
    "mapped_data" JSONB,
    "confidence" DECIMAL(3,2) NOT NULL DEFAULT 0.8,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "fetched_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_43211afdee8a61e9634d7c6865c" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_translations" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "food_id" UUID NOT NULL,
    "locale" VARCHAR(10) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "aliases" TEXT,
    "description" TEXT,
    "serving_desc" VARCHAR(100),
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_f7e8f00e342c52db74bf2820e19" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "foods" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "aliases" VARCHAR(300),
    "barcode" VARCHAR(50),
    "status" VARCHAR(20) NOT NULL DEFAULT 'draft',
    "category" VARCHAR(30) NOT NULL,
    "sub_category" VARCHAR(50),
    "food_group" VARCHAR(30),
    "calories" DECIMAL(7,1) NOT NULL,
    "protein" DECIMAL(6,1),
    "fat" DECIMAL(6,1),
    "carbs" DECIMAL(6,1),
    "fiber" DECIMAL(5,1),
    "sugar" DECIMAL(5,1),
    "saturated_fat" DECIMAL(5,1),
    "trans_fat" DECIMAL(5,2),
    "cholesterol" DECIMAL(6,1),
    "sodium" DECIMAL(7,1),
    "potassium" DECIMAL(7,1),
    "calcium" DECIMAL(7,1),
    "iron" DECIMAL(5,2),
    "vitamin_a" DECIMAL(7,1),
    "vitamin_c" DECIMAL(6,1),
    "vitamin_d" DECIMAL(5,2),
    "vitamin_e" DECIMAL(5,2),
    "vitamin_b12" DECIMAL(5,2),
    "folate" DECIMAL(6,1),
    "zinc" DECIMAL(5,2),
    "magnesium" DECIMAL(6,1),
    "glycemic_index" INTEGER,
    "glycemic_load" DECIMAL(5,1),
    "is_processed" BOOLEAN NOT NULL DEFAULT false,
    "is_fried" BOOLEAN NOT NULL DEFAULT false,
    "processing_level" INTEGER NOT NULL DEFAULT 1,
    "allergens" JSONB NOT NULL DEFAULT '[]',
    "quality_score" DECIMAL(3,1),
    "satiety_score" DECIMAL(3,1),
    "nutrient_density" DECIMAL(5,1),
    "meal_types" JSONB NOT NULL DEFAULT '[]',
    "tags" JSONB NOT NULL DEFAULT '[]',
    "main_ingredient" VARCHAR(50),
    "compatibility" JSONB NOT NULL DEFAULT '{}',
    "standard_serving_g" INTEGER NOT NULL DEFAULT 100,
    "standard_serving_desc" VARCHAR(100),
    "common_portions" JSONB NOT NULL DEFAULT '[]',
    "image_url" VARCHAR(500),
    "thumbnail_url" VARCHAR(500),
    "primary_source" VARCHAR(50) NOT NULL DEFAULT 'manual',
    "primary_source_id" VARCHAR(100),
    "data_version" INTEGER NOT NULL DEFAULT 1,
    "confidence" DECIMAL(3,2) NOT NULL DEFAULT 1,
    "is_verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_by" VARCHAR(100),
    "verified_at" TIMESTAMP(6),
    "search_weight" INTEGER NOT NULL DEFAULT 100,
    "popularity" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" VARCHAR(20) DEFAULT 'official',
    "fiber_per_100g" DECIMAL(5,1),
    "sugar_per_100g" DECIMAL(5,1),
    "sodium_per_100g" DECIMAL(6,1),
    "added_sugar" DECIMAL(5,1),
    "natural_sugar" DECIMAL(5,1),
    "purine" DECIMAL(7,1),
    "phosphorus" DECIMAL(7,1),
    "embedding" REAL[],
    "embedding_updated_at" TIMESTAMP(6),
    "cuisine" VARCHAR(30),
    "flavor_profile" JSONB,
    "cooking_method" VARCHAR(20),
    "prep_time_minutes" INTEGER,
    "cook_time_minutes" INTEGER,
    "skill_required" VARCHAR(10),
    "estimated_cost_level" INTEGER,
    "shelf_life_days" INTEGER,
    "fodmap_level" VARCHAR(10),
    "oxalate_level" VARCHAR(10),
    "embedding_v5" vector,

    CONSTRAINT "PK_0cc83421325632f61fa27a52b59" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "migrations" (
    "id" SERIAL NOT NULL,
    "timestamp" BIGINT NOT NULL,
    "name" VARCHAR NOT NULL,

    CONSTRAINT "PK_8c82d7f526340ab734260ea46be" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_configs" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "providerId" UUID NOT NULL,
    "modelName" VARCHAR(100) NOT NULL,
    "displayName" VARCHAR(100) NOT NULL,
    "capabilityType" "model_configs_capabilitytype_enum" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "status" "model_configs_status_enum" NOT NULL DEFAULT 'active',
    "inputCostPer1kTokens" DECIMAL(10,6) NOT NULL,
    "outputCostPer1kTokens" DECIMAL(10,6) NOT NULL,
    "currency" "model_configs_currency_enum" NOT NULL DEFAULT 'USD',
    "maxTokens" INTEGER NOT NULL,
    "maxRequestsPerMinute" INTEGER,
    "contextWindow" INTEGER NOT NULL,
    "streaming" BOOLEAN NOT NULL DEFAULT false,
    "functionCalling" BOOLEAN NOT NULL DEFAULT false,
    "vision" BOOLEAN NOT NULL DEFAULT false,
    "endpoint" VARCHAR(500),
    "customApiKey" VARCHAR(500),
    "customTimeout" INTEGER,
    "customRetries" INTEGER,
    "configMetadata" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "custom_api_key" VARCHAR(500),
    "custom_timeout" INTEGER,
    "custom_retries" INTEGER,
    "config_metadata" JSONB,

    CONSTRAINT "PK_37b8d27a688c96443f78bdb3e3c" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "type" VARCHAR(30) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMPTZ(6),
    "is_pushed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "push_enabled" BOOLEAN NOT NULL DEFAULT true,
    "enabled_types" JSONB NOT NULL DEFAULT '[]',
    "quiet_start" VARCHAR(5),
    "quiet_end" VARCHAR(5),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_record" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "subscription_id" UUID,
    "order_no" VARCHAR(64) NOT NULL,
    "channel" VARCHAR(32) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'CNY',
    "status" VARCHAR(32) NOT NULL DEFAULT 'pending',
    "platform_transaction_id" VARCHAR(512),
    "callback_payload" JSONB,
    "refund_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "paid_at" TIMESTAMPTZ(6),
    "refunded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_payment_record" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permission_templates" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(500),
    "permission_patterns" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_58491c665954fb0fc0f0378e677" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "code" VARCHAR(100) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "type" "permissions_type_enum" NOT NULL,
    "action" "permissions_action_enum",
    "resource" VARCHAR(200),
    "parent_id" UUID,
    "icon" VARCHAR(50),
    "description" VARCHAR(500),
    "status" "permissions_status_enum" NOT NULL DEFAULT 'active',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "precomputed_recommendations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "date" VARCHAR(10) NOT NULL,
    "meal_type" VARCHAR(20) NOT NULL,
    "result" JSONB NOT NULL,
    "scenario_results" JSONB,
    "strategy_version" VARCHAR(50) NOT NULL,
    "computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "is_used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "precomputed_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_change_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "change_type" VARCHAR(32) NOT NULL,
    "source" VARCHAR(32) NOT NULL,
    "changed_fields" JSONB NOT NULL DEFAULT '[]',
    "before_values" JSONB NOT NULL DEFAULT '{}',
    "after_values" JSONB NOT NULL DEFAULT '{}',
    "trigger_event" VARCHAR(128),
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_profile_change_log" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_snapshots" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "trigger_type" VARCHAR(30) NOT NULL,
    "changed_fields" JSONB NOT NULL,
    "created_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "providers" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "name" VARCHAR(100) NOT NULL,
    "type" "providers_type_enum" NOT NULL,
    "baseUrl" VARCHAR(500) NOT NULL,
    "apiKey" VARCHAR(500) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "healthCheckUrl" VARCHAR(500),
    "timeout" INTEGER NOT NULL DEFAULT 30000,
    "retryCount" INTEGER NOT NULL DEFAULT 3,
    "status" "providers_status_enum" NOT NULL DEFAULT 'active',
    "lastHealthCheck" TIMESTAMP(6),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_af13fc2ebf382fe0dad2e4793aa" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_feedbacks" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" VARCHAR NOT NULL,
    "meal_type" VARCHAR(20) NOT NULL,
    "food_name" VARCHAR(100) NOT NULL,
    "food_id" VARCHAR,
    "action" VARCHAR(20) NOT NULL,
    "replacement_food" VARCHAR(100),
    "recommendation_score" DECIMAL(5,3),
    "goal_type" VARCHAR(20),
    "experiment_id" VARCHAR,
    "group_id" VARCHAR,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_538c99577bef661f2eff1325862" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_84059017c90bfcb701b8fa42297" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "code" VARCHAR(50) NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "parent_id" UUID,
    "description" VARCHAR(500),
    "status" "roles_status_enum" NOT NULL DEFAULT 'active',
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "scope" VARCHAR(32) NOT NULL DEFAULT 'global',
    "scope_target" VARCHAR(128),
    "config" JSONB NOT NULL DEFAULT '{}',
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "version" INTEGER NOT NULL DEFAULT 1,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_strategy" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "strategy_assignment" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "strategy_id" UUID NOT NULL,
    "assignment_type" VARCHAR(32) NOT NULL DEFAULT 'manual',
    "source" VARCHAR(128),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "active_from" TIMESTAMPTZ(6),
    "active_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_strategy_assignment" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'active',
    "payment_channel" VARCHAR(32) NOT NULL,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "cancelled_at" TIMESTAMPTZ(6),
    "auto_renew" BOOLEAN NOT NULL DEFAULT true,
    "platform_subscription_id" VARCHAR(512),
    "grace_period_ends_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_subscription" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_plan" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(128) NOT NULL,
    "description" TEXT,
    "tier" VARCHAR(32) NOT NULL,
    "billing_cycle" VARCHAR(32) NOT NULL,
    "price_cents" INTEGER NOT NULL,
    "currency" VARCHAR(8) NOT NULL DEFAULT 'CNY',
    "entitlements" JSONB NOT NULL DEFAULT '{}',
    "apple_product_id" VARCHAR(256),
    "wechat_product_id" VARCHAR(256),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_subscription_plan" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_trigger_log" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "trigger_scene" VARCHAR(30) NOT NULL,
    "feature" VARCHAR(50) NOT NULL,
    "current_tier" VARCHAR(20) NOT NULL,
    "recommended_plan" VARCHAR(20) NOT NULL,
    "ab_bucket" VARCHAR(20),
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_5130854651b572f030f3ed0ac96" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_quota" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "feature" VARCHAR(64) NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "quota_limit" INTEGER NOT NULL DEFAULT 0,
    "cycle" VARCHAR(16) NOT NULL DEFAULT 'daily',
    "reset_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_usage_quota" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_records" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "client_id" UUID NOT NULL,
    "request_id" VARCHAR(255) NOT NULL,
    "capability_type" VARCHAR(100) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "model" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "usage" JSONB NOT NULL,
    "cost" DECIMAL(10,6) NOT NULL,
    "response_time" INTEGER NOT NULL,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_e511cf9f7dc53851569f87467a5" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_achievements" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "achievement_id" UUID NOT NULL,
    "unlocked_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_3d94aba7e9ed55365f68b5e77fa" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_behavior_profiles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "food_preferences" JSONB NOT NULL DEFAULT '{}',
    "binge_risk_hours" JSONB NOT NULL DEFAULT '[]',
    "failure_triggers" JSONB NOT NULL DEFAULT '[]',
    "avg_compliance_rate" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "coach_style" VARCHAR(20) NOT NULL DEFAULT 'friendly',
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "healthy_records" INTEGER NOT NULL DEFAULT 0,
    "streak_days" INTEGER NOT NULL DEFAULT 0,
    "longest_streak" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meal_timing_patterns" JSONB DEFAULT '{}',
    "portion_tendency" VARCHAR(10) DEFAULT 'normal',
    "replacement_patterns" JSONB DEFAULT '{}',
    "last_streak_date" VARCHAR(10),

    CONSTRAINT "PK_80d69430cb45fe3d5af5540de7b" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_challenges" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "challenge_id" UUID NOT NULL,
    "started_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_progress" INTEGER NOT NULL DEFAULT 0,
    "max_progress" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "completed_at" TIMESTAMP(6),

    CONSTRAINT "PK_7c111333fc0e3a23528503498de" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_inferred_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "estimated_bmr" INTEGER,
    "estimated_tdee" INTEGER,
    "recommended_calories" INTEGER,
    "macro_targets" JSONB DEFAULT '{}',
    "user_segment" VARCHAR(30),
    "churn_risk" DECIMAL(3,2) DEFAULT 0,
    "optimal_meal_count" INTEGER,
    "taste_pref_vector" JSONB DEFAULT '[]',
    "nutrition_gaps" JSONB DEFAULT '[]',
    "goal_progress" JSONB DEFAULT '{}',
    "confidence_scores" JSONB DEFAULT '{}',
    "last_computed_at" TIMESTAMP(6),
    "updated_at" TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP,
    "preference_weights" JSONB,

    CONSTRAINT "user_inferred_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "gender" VARCHAR(10),
    "birth_year" INTEGER,
    "height_cm" DECIMAL(5,1),
    "weight_kg" DECIMAL(5,1),
    "target_weight_kg" DECIMAL(5,1),
    "activity_level" "user_profiles_activity_level_enum" NOT NULL DEFAULT 'light',
    "daily_calorie_goal" INTEGER,
    "goal" VARCHAR(30) NOT NULL DEFAULT 'health',
    "goal_speed" VARCHAR(20) NOT NULL DEFAULT 'steady',
    "body_fat_percent" DECIMAL(4,1),
    "meals_per_day" INTEGER NOT NULL DEFAULT 3,
    "takeout_frequency" VARCHAR(20) NOT NULL DEFAULT 'sometimes',
    "can_cook" BOOLEAN NOT NULL DEFAULT true,
    "food_preferences" JSONB NOT NULL DEFAULT '[]',
    "dietary_restrictions" JSONB NOT NULL DEFAULT '[]',
    "weak_time_slots" JSONB NOT NULL DEFAULT '[]',
    "binge_triggers" JSONB NOT NULL DEFAULT '[]',
    "discipline" VARCHAR(20) NOT NULL DEFAULT 'medium',
    "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "allergens" JSONB DEFAULT '[]',
    "health_conditions" JSONB DEFAULT '[]',
    "exercise_profile" JSONB DEFAULT '{}',
    "cooking_skill_level" VARCHAR(20),
    "taste_intensity" JSONB DEFAULT '{}',
    "cuisine_preferences" JSONB DEFAULT '[]',
    "budget_level" VARCHAR(10),
    "family_size" INTEGER DEFAULT 1,
    "meal_prep_willing" BOOLEAN DEFAULT false,
    "region_code" VARCHAR(5) DEFAULT 'CN',
    "onboarding_step" INTEGER DEFAULT 0,
    "data_completeness" DECIMAL(3,2) DEFAULT 0,
    "profile_version" INTEGER DEFAULT 1,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Shanghai',

    CONSTRAINT "PK_1ec6662219f4605723f1e41b6cb" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "id" UUID NOT NULL DEFAULT uuid_generate_v4(),
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PK_8acd5cf26ebd158416f477de799" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weight_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "weight_kg" DECIMAL(5,1) NOT NULL,
    "body_fat_percent" DECIMAL(4,1),
    "source" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "recorded_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weight_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminder_dismissals" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "reminder_type" VARCHAR(50) NOT NULL,
    "dismissed_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminder_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "cuisine" VARCHAR(50),
    "difficulty" SMALLINT NOT NULL DEFAULT 1,
    "prep_time_minutes" INTEGER,
    "cook_time_minutes" INTEGER,
    "servings" SMALLINT NOT NULL DEFAULT 1,
    "tags" TEXT[],
    "instructions" JSONB,
    "image_url" VARCHAR(500),
    "source" VARCHAR(50) NOT NULL DEFAULT 'ai_generated',
    "calories_per_serving" DECIMAL(8,2),
    "protein_per_serving" DECIMAL(8,2),
    "fat_per_serving" DECIMAL(8,2),
    "carbs_per_serving" DECIMAL(8,2),
    "fiber_per_serving" DECIMAL(8,2),
    "quality_score" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_ingredients" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipe_id" UUID NOT NULL,
    "food_id" UUID,
    "ingredient_name" VARCHAR(100) NOT NULL,
    "amount" DECIMAL(8,2),
    "unit" VARCHAR(20),
    "is_optional" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" SMALLINT NOT NULL DEFAULT 0,

    CONSTRAINT "recipe_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IDX_ab_experiments_status" ON "ab_experiments"("status");

-- CreateIndex
CREATE UNIQUE INDEX "UQ_cd74882f69ff37d7330e89c63d5" ON "achievements"("code");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_2873882c38e8c07d98cb64f962" ON "admin_users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_dcd0c8a4b10af9c986e510b9ec" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "idx_ai_logs_user" ON "ai_decision_logs"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_analysis_food_link_analysis_id" ON "analysis_food_link"("analysis_id");

-- CreateIndex
CREATE INDEX "idx_analysis_food_link_food_candidate_id" ON "analysis_food_link"("food_candidate_id");

-- CreateIndex
CREATE INDEX "idx_analysis_food_link_food_library_id" ON "analysis_food_link"("food_library_id");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_28d5834968612821f4675a9f7a" ON "app_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_77751cf159acfefb704456e4f6" ON "app_users"("google_id");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_app_users_phone" ON "app_users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_45e81ae90b9a0d7fb2b72e21b2" ON "app_users"("wechat_open_id");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_app_users_wechat_mini_open_id" ON "app_users"("wechat_mini_open_id");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_458012dc4bdbf3309edd3205da" ON "app_users"("apple_id");

-- CreateIndex
CREATE INDEX "IDX_601d4f4be742d3ca28891c0207" ON "app_users"("device_id");

-- CreateIndex
CREATE INDEX "IDX_app_version_packages_versionId" ON "app_version_packages"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_app_version_packages_version_channel_platform" ON "app_version_packages"("versionId", "channel", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_6222da359534e48044dce6829e" ON "app_versions"("platform", "version");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_60603413d17812e8ef04288227" ON "client_capability_permissions"("client_id", "capability_type");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_740fe6d4fd0cd0ff47d766c8e0" ON "clients"("api_key");

-- CreateIndex
CREATE INDEX "IDX_64b7c797968982036808dd8928" ON "coach_conversations"("user_id", "updated_at");

-- CreateIndex
CREATE INDEX "idx_coach_conversations_user" ON "coach_conversations"("user_id", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "IDX_ce15bf83d158339d1460ef5046" ON "coach_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_daily_plans_user_date" ON "daily_plans"("user_id", "date" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "UQ_2bec94b8d146beda9ec7c984e41" ON "daily_summaries"("user_id", "date");

-- CreateIndex
CREATE INDEX "idx_device_token_user" ON "device_token"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_device_token_lookup" ON "device_token"("user_id", "device_id");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flag_key_key" ON "feature_flag"("key");

-- CreateIndex
CREATE INDEX "IDX_feature_flag_key" ON "feature_flag"("key");

-- CreateIndex
CREATE INDEX "IDX_feedback_details_feedback_id" ON "feedback_details"("feedback_id");

-- CreateIndex
CREATE INDEX "IDX_feedback_details_user_created" ON "feedback_details"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "IDX_feedback_details_user_id" ON "feedback_details"("user_id");

-- CreateIndex
CREATE INDEX "idx_food_analysis_record_input_type" ON "food_analysis_record"("input_type");

-- CreateIndex
CREATE INDEX "idx_food_analysis_record_source_request" ON "food_analysis_record"("source_request_id");

-- CreateIndex
CREATE INDEX "idx_food_analysis_record_status" ON "food_analysis_record"("status");

-- CreateIndex
CREATE INDEX "idx_food_analysis_record_user_created" ON "food_analysis_record"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_food_analysis_record_user_id" ON "food_analysis_record"("user_id");

-- CreateIndex
CREATE INDEX "idx_food_candidate_canonical_name" ON "food_candidate"("canonical_name");

-- CreateIndex
CREATE INDEX "idx_food_candidate_review_status" ON "food_candidate"("review_status");

-- CreateIndex
CREATE INDEX "idx_food_candidate_source_count" ON "food_candidate"("source_count" DESC);

-- CreateIndex
CREATE INDEX "idx_food_candidate_source_type" ON "food_candidate"("source_type");

-- CreateIndex
CREATE INDEX "IDX_c05fd8febec4e6c891d55037bb" ON "food_change_logs"("food_id", "version");

-- CreateIndex
CREATE INDEX "IDX_c38e8be317412e0e211bde36c2" ON "food_conflicts"("food_id");

-- CreateIndex
CREATE INDEX "IDX_f70f77608ec0d03dcb273d28b7" ON "food_conflicts"("resolution");

-- CreateIndex
CREATE INDEX "IDX_b60a81211f912774c20ff25101" ON "food_records"("user_id", "recorded_at");

-- CreateIndex
CREATE INDEX "idx_food_record_analysis_id" ON "food_records"("analysis_id");

-- CreateIndex
CREATE INDEX "idx_food_records_user_recorded" ON "food_records"("user_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "IDX_food_regional_info_food_id" ON "food_regional_info"("food_id");

-- CreateIndex
CREATE INDEX "IDX_food_regional_info_region" ON "food_regional_info"("region");

-- CreateIndex
CREATE UNIQUE INDEX "UQ_41a17bad128becea48895910fa6" ON "food_regional_info"("food_id", "region");

-- CreateIndex
CREATE INDEX "IDX_c358d4034107dae538d5e906e9" ON "food_sources"("source_type");

-- CreateIndex
CREATE INDEX "IDX_dd78760b3ccd557a6be426c896" ON "food_sources"("food_id");

-- CreateIndex
CREATE INDEX "IDX_eafdca1bd9632ceabd94d182f2" ON "food_translations"("locale");

-- CreateIndex
CREATE UNIQUE INDEX "UQ_5ce4d8b4f0dad567d3b81052e34" ON "food_translations"("food_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_94114b6498bb8a8c102e194b8c" ON "foods"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UQ_c3cf46642750fce8fea692ad946" ON "foods"("name");

-- CreateIndex
CREATE INDEX "IDX_0e3bd85e37aa82a7ccdd76e135" ON "foods"("primary_source");

-- CreateIndex
CREATE INDEX "IDX_5f8b45ec9d0608cffe04d3afbe" ON "foods"("search_weight");

-- CreateIndex
CREATE INDEX "IDX_68aa1d0fe3ef6b57e4fd922033" ON "foods"("status");

-- CreateIndex
CREATE INDEX "IDX_94919a5b0af8952c73beb42fbc" ON "foods"("barcode");

-- CreateIndex
CREATE INDEX "IDX_c147959a431fea61665d0e8bf4" ON "foods"("category");

-- CreateIndex
CREATE INDEX "IDX_foods_allergens_gin" ON "foods" USING GIN ("allergens");

-- CreateIndex
CREATE INDEX "IDX_foods_barcode" ON "foods"("barcode");

-- CreateIndex
CREATE INDEX "IDX_foods_meal_types_gin" ON "foods" USING GIN ("meal_types");

-- CreateIndex
CREATE INDEX "IDX_foods_primary_source" ON "foods"("primary_source");

-- CreateIndex
CREATE INDEX "IDX_foods_status" ON "foods"("status");

-- CreateIndex
CREATE INDEX "IDX_foods_tags_gin" ON "foods" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "idx_food_library_cooking_method" ON "foods"("cooking_method");

-- CreateIndex
CREATE INDEX "idx_food_library_cuisine" ON "foods"("cuisine");

-- CreateIndex
CREATE INDEX "idx_foods_category" ON "foods"("category");

-- CreateIndex
CREATE INDEX "idx_foods_name_trgm" ON "foods" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "idx_foods_weight" ON "foods"("search_weight" DESC);

-- CreateIndex
CREATE INDEX "idx_foods_verified_category" ON "foods"("is_verified", "category");

-- CreateIndex
CREATE INDEX "idx_foods_aliases_trgm" ON "foods" USING GIN ("aliases" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "IDX_model_configs_capability_enabled" ON "model_configs"("capabilityType", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "IDX_94e209ecbfca512f7f7f24269f" ON "model_configs"("providerId", "modelName", "capabilityType");

-- CreateIndex
CREATE INDEX "idx_notification_user_created" ON "notification"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_notification_user_unread" ON "notification"("user_id", "is_read");

-- CreateIndex
CREATE UNIQUE INDEX "idx_notification_pref_user" ON "notification_preference"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "idx_payment_order" ON "payment_record"("order_no");

-- CreateIndex
CREATE INDEX "idx_payment_channel_status" ON "payment_record"("channel", "status");

-- CreateIndex
CREATE INDEX "idx_payment_status" ON "payment_record"("status");

-- CreateIndex
CREATE INDEX "idx_payment_user" ON "payment_record"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UQ_0eac5e983d19cd89c54c37b6ecc" ON "permission_templates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "UQ_8dad765629e83229da6feda1c1d" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "idx_precomputed_expires" ON "precomputed_recommendations"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "uq_precomputed_user_date_meal" ON "precomputed_recommendations"("user_id", "date", "meal_type");

-- CreateIndex
CREATE INDEX "idx_profile_change_log_created" ON "profile_change_log"("created_at");

-- CreateIndex
CREATE INDEX "idx_profile_change_log_user" ON "profile_change_log"("user_id");

-- CreateIndex
CREATE INDEX "idx_profile_change_log_user_type" ON "profile_change_log"("user_id", "change_type");

-- CreateIndex
CREATE INDEX "idx_profile_change_log_user_version" ON "profile_change_log"("user_id", "version");

-- CreateIndex
CREATE INDEX "idx_snapshot_user_time" ON "profile_snapshots"("user_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "IDX_d735474e539e674ba3702eddc4" ON "providers"("name");

-- CreateIndex
CREATE INDEX "IDX_84be6fe526b10313d0015fbdea" ON "recommendation_feedbacks"("user_id");

-- CreateIndex
CREATE INDEX "IDX_f3a0234ecd1f178e4c36fb8f00" ON "recommendation_feedbacks"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_rec_feedbacks_food_id" ON "recommendation_feedbacks"("food_id");

-- CreateIndex
CREATE UNIQUE INDEX "UQ_f6d54f95c31b73fb1bdd8e91d0c" ON "roles"("code");

-- CreateIndex
CREATE INDEX "idx_strategy_scope_status" ON "strategy"("scope", "status");

-- CreateIndex
CREATE INDEX "idx_strategy_scope_target" ON "strategy"("scope", "scope_target", "status");

-- CreateIndex
CREATE INDEX "idx_strategy_assignment_strategy" ON "strategy_assignment"("strategy_id");

-- CreateIndex
CREATE INDEX "idx_strategy_assignment_user" ON "strategy_assignment"("user_id");

-- CreateIndex
CREATE INDEX "idx_strategy_assignment_user_type" ON "strategy_assignment"("user_id", "assignment_type");

-- CreateIndex
CREATE INDEX "idx_subscription_expires" ON "subscription"("expires_at");

-- CreateIndex
CREATE INDEX "idx_subscription_user" ON "subscription"("user_id");

-- CreateIndex
CREATE INDEX "idx_subscription_user_status" ON "subscription"("user_id", "status");

-- CreateIndex
CREATE INDEX "idx_subscription_plan_active" ON "subscription_plan"("is_active");

-- CreateIndex
CREATE INDEX "idx_subscription_plan_tier" ON "subscription_plan"("tier");

-- CreateIndex
CREATE INDEX "idx_trigger_log_converted" ON "subscription_trigger_log"("converted");

-- CreateIndex
CREATE INDEX "idx_trigger_log_scene" ON "subscription_trigger_log"("trigger_scene");

-- CreateIndex
CREATE INDEX "idx_trigger_log_user_created" ON "subscription_trigger_log"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_trigger_log_user_id" ON "subscription_trigger_log"("user_id");

-- CreateIndex
CREATE INDEX "idx_usage_quota_reset" ON "usage_quota"("reset_at");

-- CreateIndex
CREATE UNIQUE INDEX "idx_usage_quota_user_feature" ON "usage_quota"("user_id", "feature");

-- CreateIndex
CREATE INDEX "IDX_0616a784ab63d9f654498cd84b" ON "usage_records"("capability_type", "timestamp");

-- CreateIndex
CREATE INDEX "IDX_1f7f090f5d081ae21593ab3844" ON "usage_records"("provider", "timestamp");

-- CreateIndex
CREATE INDEX "IDX_d397b87d28105b361b8f5a840d" ON "usage_records"("client_id", "timestamp");

-- CreateIndex
CREATE INDEX "idx_user_achievements_user_id" ON "user_achievements"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UQ_4a98fb7c71270ccf2e6ebb5552c" ON "user_behavior_profiles"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_challenges_user_status" ON "user_challenges"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "user_inferred_profiles_user_id_key" ON "user_inferred_profiles"("user_id");

-- CreateIndex
CREATE INDEX "idx_inferred_user" ON "user_inferred_profiles"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "UQ_6ca9503d77ae39b4b5a6cc3ba88" ON "user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "idx_weight_history_user_recorded" ON "weight_history"("user_id", "recorded_at");

-- CreateIndex
CREATE INDEX "reminder_dismissals_user_id_idx" ON "reminder_dismissals"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "uq_reminder_user_type" ON "reminder_dismissals"("user_id", "reminder_type");

-- CreateIndex
CREATE INDEX "idx_recipes_cuisine" ON "recipes"("cuisine");

-- CreateIndex
CREATE INDEX "idx_recipes_difficulty" ON "recipes"("difficulty");

-- CreateIndex
CREATE INDEX "idx_recipes_tags" ON "recipes" USING GIN ("tags");

-- CreateIndex
CREATE INDEX "idx_recipes_quality" ON "recipes"("quality_score" DESC);

-- CreateIndex
CREATE INDEX "idx_recipe_ingredients_recipe" ON "recipe_ingredients"("recipe_id");

-- CreateIndex
CREATE INDEX "idx_recipe_ingredients_food" ON "recipe_ingredients"("food_id");

-- AddForeignKey
ALTER TABLE "analysis_food_link" ADD CONSTRAINT "fk_afl_analysis" FOREIGN KEY ("analysis_id") REFERENCES "food_analysis_record"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "analysis_food_link" ADD CONSTRAINT "fk_afl_food_candidate" FOREIGN KEY ("food_candidate_id") REFERENCES "food_candidate"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "analysis_food_link" ADD CONSTRAINT "fk_afl_food_library" FOREIGN KEY ("food_library_id") REFERENCES "foods"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "app_version_packages" ADD CONSTRAINT "FK_ecb85e41b68428adb8df8fc0a01" FOREIGN KEY ("versionId") REFERENCES "app_versions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client_capability_permissions" ADD CONSTRAINT "FK_ad53318f3e760401ed26580a61a" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coach_conversations" ADD CONSTRAINT "FK_28e39678e3cbc5deced6c3b5f7e" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "coach_messages" ADD CONSTRAINT "FK_10a0fc9e61c8d70b657decdc02c" FOREIGN KEY ("conversation_id") REFERENCES "coach_conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "daily_summaries" ADD CONSTRAINT "FK_b8fe1bf443d817a306fbda45040" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "feedback_details" ADD CONSTRAINT "fk_feedback_details_feedback" FOREIGN KEY ("feedback_id") REFERENCES "recommendation_feedbacks"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "food_change_logs" ADD CONSTRAINT "FK_3bed3ebac60097ade2410992361" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "food_conflicts" ADD CONSTRAINT "FK_c38e8be317412e0e211bde36c2c" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "food_records" ADD CONSTRAINT "FK_ec3b604a6a49e32b3b7261e8b16" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "food_regional_info" ADD CONSTRAINT "FK_999e5485019b3efa2aae0a557f5" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "food_sources" ADD CONSTRAINT "FK_dd78760b3ccd557a6be426c896f" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "food_translations" ADD CONSTRAINT "FK_880ef718b1e294d7cbeb2c7265a" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "model_configs" ADD CONSTRAINT "FK_43d272f8e0fb42c6736b0fdc119" FOREIGN KEY ("providerId") REFERENCES "providers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "permissions" ADD CONSTRAINT "FK_e152e0aa9e0df7ed44539db894c" FOREIGN KEY ("parent_id") REFERENCES "permissions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "profile_snapshots" ADD CONSTRAINT "profile_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_17022daf3f885f7d35423e9971e" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "FK_178199805b901ccd220ab7740ec" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "FK_3e97eeaf865aeda0d20c0c5c509" FOREIGN KEY ("parent_id") REFERENCES "roles"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "subscription" ADD CONSTRAINT "FK_subscription_plan" FOREIGN KEY ("plan_id") REFERENCES "subscription_plan"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_inferred_profiles" ADD CONSTRAINT "user_inferred_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "FK_6ca9503d77ae39b4b5a6cc3ba88" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "FK_b23c65e50a758245a33ee35fda1" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "FK_user_roles_admin_user_id" FOREIGN KEY ("user_id") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_ingredients" ADD CONSTRAINT "recipe_ingredients_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
