-- ═══════════════════════════════════════════════════════════════════════════
-- V8.2 Food Infrastructure Refactor
--
-- Goals:
--   1. Create FoodEmbedding / FoodFieldProvenance / FoodRecommendationProfile
--   2. Backfill data from foods.embedding/embedding_v5/embedding_updated_at/
--      field_sources/field_confidence/failed_fields
--   3. Drop the four migrated columns from foods
--
-- Notes:
--   - Single atomic migration (project not yet launched, no online dual-write)
--   - HNSW index on food_embeddings.vector is created conditionally on the
--     pgvector extension being installed (mirrors the v65 pattern)
--   - field_sources / field_confidence remain in foods as JSONB cache layer
--     (dual-layer coexistence). Only failed_fields is fully migrated.
-- ═══════════════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────────────
-- SECTION 1: Create new tables
-- ────────────────────────────────────────────────────────────────────────

CREATE TABLE "food_embeddings" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "food_id"         UUID NOT NULL,
    "model_name"      VARCHAR(50) NOT NULL,
    "model_version"   VARCHAR(100),
    "vector"          vector,
    "vector_legacy"   REAL[] NOT NULL DEFAULT ARRAY[]::REAL[],
    "dimension"       INTEGER NOT NULL,
    "generated_at"    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "food_embeddings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_food_embeddings_food_model" UNIQUE ("food_id", "model_name"),
    CONSTRAINT "food_embeddings_food_id_fkey"
      FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "idx_food_embeddings_food"  ON "food_embeddings"("food_id");
CREATE INDEX "idx_food_embeddings_model" ON "food_embeddings"("model_name");

CREATE TABLE "food_field_provenance" (
    "id"              UUID NOT NULL DEFAULT gen_random_uuid(),
    "food_id"         UUID NOT NULL,
    "field_name"      VARCHAR(100) NOT NULL,
    "source"          VARCHAR(50) NOT NULL,
    "confidence"      DOUBLE PRECISION,
    "status"          VARCHAR(20) NOT NULL DEFAULT 'success',
    "failure_reason"  VARCHAR(500),
    "raw_value"       JSONB,
    "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "updated_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    CONSTRAINT "food_field_provenance_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "uq_food_field_provenance_food_field_source"
      UNIQUE ("food_id", "field_name", "source"),
    CONSTRAINT "food_field_provenance_food_id_fkey"
      FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX "idx_food_field_provenance_food"   ON "food_field_provenance"("food_id");
CREATE INDEX "idx_food_field_provenance_field"  ON "food_field_provenance"("field_name");
CREATE INDEX "idx_food_field_provenance_status" ON "food_field_provenance"("status");

CREATE TABLE "food_recommendation_profile" (
    "food_id"              UUID NOT NULL,
    "fat_loss_score"       DOUBLE PRECISION,
    "muscle_gain_score"    DOUBLE PRECISION,
    "general_health_score" DOUBLE PRECISION,
    "popularity_score"     DOUBLE PRECISION,
    "region_fitness"       JSONB,
    "computed_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
    "computed_version"     VARCHAR(50),
    CONSTRAINT "food_recommendation_profile_pkey" PRIMARY KEY ("food_id"),
    CONSTRAINT "food_recommendation_profile_food_id_fkey"
      FOREIGN KEY ("food_id") REFERENCES "foods"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

-- ────────────────────────────────────────────────────────────────────────
-- SECTION 2: HNSW index on food_embeddings.vector — DEFERRED
-- ────────────────────────────────────────────────────────────────────────
--
-- HNSW 在 pgvector 中要求列具有固定维度（如 vector(96) 或 vector(1536)），
-- 而本表 vector 列声明为无维度 Unsupported("vector") 以兼容多模型共存
-- (feature_v5=96, openai_v5=1536)。
--
-- 处理方式：
--   * 本期不在 schema 层建 HNSW；召回先走 seq scan + LIMIT
--     （1441 行规模下 cosine 距离全表扫秒级返回，可接受）
--   * 后续 PR 决定主导模型后，再用 ALTER TABLE ... ALTER COLUMN
--     vector TYPE vector(N) 或拆分专属表，再按 partial index 建 HNSW
--
-- 不在此处创建任何 HNSW 索引。


-- ────────────────────────────────────────────────────────────────────────
-- SECTION 3: Backfill from foods → food_embeddings
-- ────────────────────────────────────────────────────────────────────────

-- 3a) legacy float array → vector_legacy
INSERT INTO "food_embeddings"
    ("food_id", "model_name", "vector_legacy", "dimension", "generated_at", "updated_at")
SELECT
    "id"::uuid,
    'legacy_v4',
    "embedding",
    COALESCE(array_length("embedding", 1), 0),
    COALESCE("embedding_updated_at", NOW()),
    COALESCE("embedding_updated_at", NOW())
  FROM "foods"
 WHERE "embedding" IS NOT NULL AND array_length("embedding", 1) IS NOT NULL
ON CONFLICT ("food_id", "model_name") DO NOTHING;

-- 3b) embedding_v5 → vector (only if pgvector extension is present)
--
-- 语义说明：原 foods.embedding_v5 是 computeFoodEmbedding() 输出的 96 维
-- 特征拼接向量（feature_v5），非 OpenAI 1536 维语义。这里以 feature_v5 标记，
-- 维度从向量自身实际长度推导，避免硬编码错值。
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
        EXECUTE $sql$
            INSERT INTO food_embeddings
                (food_id, model_name, model_version, vector, dimension, generated_at, updated_at)
            SELECT id::uuid,
                   'feature_v5',
                   NULL,
                   embedding_v5,
                   COALESCE(vector_dims(embedding_v5), 96),
                   COALESCE(embedding_updated_at, NOW()),
                   COALESCE(embedding_updated_at, NOW())
              FROM foods
             WHERE embedding_v5 IS NOT NULL
            ON CONFLICT (food_id, model_name) DO NOTHING
        $sql$;
    END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────
-- SECTION 4: Backfill from foods → food_field_provenance
-- ────────────────────────────────────────────────────────────────────────

-- 4a) field_sources → success rows
INSERT INTO "food_field_provenance"
    ("food_id", "field_name", "source", "confidence", "status", "created_at", "updated_at")
SELECT
    f."id"::uuid,
    kv."key",
    kv."value",
    NULLIF((f."field_confidence" ->> kv."key"), '')::double precision,
    'success',
    NOW(),
    NOW()
  FROM "foods" f,
       jsonb_each_text(COALESCE(f."field_sources", '{}'::jsonb)) AS kv("key", "value")
 WHERE COALESCE(f."field_sources", '{}'::jsonb) <> '{}'::jsonb
ON CONFLICT ("food_id", "field_name", "source") DO NOTHING;

-- 4b) failed_fields → failed rows
INSERT INTO "food_field_provenance"
    ("food_id", "field_name", "source", "status", "failure_reason", "raw_value", "created_at", "updated_at")
SELECT
    f."id"::uuid,
    kv."key",
    'enrichment',
    'failed',
    LEFT(COALESCE(kv."value" ->> 'reason', ''), 500),
    kv."value",
    NOW(),
    NOW()
  FROM "foods" f,
       jsonb_each(COALESCE(f."failed_fields", '{}'::jsonb)) AS kv("key", "value")
 WHERE COALESCE(f."failed_fields", '{}'::jsonb) <> '{}'::jsonb
ON CONFLICT ("food_id", "field_name", "source") DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- SECTION 5: Backfill placeholder rows in food_recommendation_profile
-- (one row per food, all scores NULL — actual computation is a follow-up PR)
-- ────────────────────────────────────────────────────────────────────────

INSERT INTO "food_recommendation_profile" ("food_id", "computed_at", "computed_version")
SELECT "id"::uuid, NOW(), 'v0_placeholder'
  FROM "foods"
ON CONFLICT ("food_id") DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────
-- SECTION 6: Drop migrated columns from foods
-- (field_sources / field_confidence retained as JSONB cache layer)
-- ────────────────────────────────────────────────────────────────────────

DROP INDEX IF EXISTS "idx_foods_embedding_v5_hnsw";

ALTER TABLE "foods" DROP COLUMN IF EXISTS "embedding";
ALTER TABLE "foods" DROP COLUMN IF EXISTS "embedding_v5";
ALTER TABLE "foods" DROP COLUMN IF EXISTS "embedding_updated_at";
ALTER TABLE "foods" DROP COLUMN IF EXISTS "failed_fields";
