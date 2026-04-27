# 03 · 数据迁移方案

## 迁移流程总览

```
[备份] → [新表 DDL] → [灌数据] → [校验] → [改业务代码] → [回归测试]
   ↓                    ↓            ↓
  pg_dump         migrate-food    verify-food
                  -infra.ts       -infra.ts
```

环境前提：本项目尚未上线，可全程停服重构，无需在线双写。

---

## Step 1：备份

```bash
# 业务代码已完整在 git；此处只备份食物库
pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME \
  -t foods -t food_sources -t food_translations -t food_regional_info \
  -t food_change_logs -t food_conflicts -t food_candidates \
  -F c -f backup/food-infra-pre-refactor-$(date +%Y%m%d).dump
```

回滚命令：

```bash
pg_restore -h $DB_HOST -U $DB_USER -d $DB_NAME -c \
  backup/food-infra-pre-refactor-YYYYMMDD.dump
```

---

## Step 2：DDL 迁移（Prisma migrate）

由 Prisma 生成 `<timestamp>_food_infra_refactor/migration.sql`，关键 DDL：

```sql
-- 1. 新表
CREATE TABLE food_embeddings (
  id           TEXT PRIMARY KEY,
  food_id      TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  model_name   TEXT NOT NULL,
  model_version TEXT,
  vector       vector(1536),
  vector_legacy DOUBLE PRECISION[],
  dimension    INT NOT NULL,
  generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (food_id, model_name)
);

CREATE INDEX idx_food_embeddings_food ON food_embeddings(food_id);
CREATE INDEX idx_food_embeddings_model ON food_embeddings(model_name);
CREATE INDEX idx_food_embeddings_vector_hnsw
  ON food_embeddings USING hnsw (vector vector_cosine_ops)
  WHERE model_name = 'openai_v5';

CREATE TABLE food_field_provenance (
  id          TEXT PRIMARY KEY,
  food_id     TEXT NOT NULL REFERENCES foods(id) ON DELETE CASCADE,
  field_name  TEXT NOT NULL,
  source      TEXT NOT NULL,        -- 'usda' | 'gpt' | 'manual' | 'translated' | ...
  confidence  DOUBLE PRECISION,
  status      TEXT NOT NULL,        -- 'success' | 'failed' | 'pending'
  failure_reason TEXT,
  raw_value   JSONB,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (food_id, field_name, source)
);

CREATE INDEX idx_food_provenance_food ON food_field_provenance(food_id);
CREATE INDEX idx_food_provenance_field ON food_field_provenance(field_name);
CREATE INDEX idx_food_provenance_status ON food_field_provenance(status);

CREATE TABLE food_recommendation_profile (
  food_id              TEXT PRIMARY KEY REFERENCES foods(id) ON DELETE CASCADE,
  fat_loss_score       DOUBLE PRECISION,
  muscle_gain_score    DOUBLE PRECISION,
  general_health_score DOUBLE PRECISION,
  popularity_score     DOUBLE PRECISION,
  region_fitness       JSONB,        -- {asia:0.9, europe:0.6,...}
  computed_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  computed_version     TEXT
);

-- 2. 主表移除字段（保留 field_sources/field_confidence 作为 jsonb 缓存层；
--    只移除 embedding/embedding_v5/embedding_updated_at/failed_fields）
ALTER TABLE foods DROP COLUMN IF EXISTS embedding;
ALTER TABLE foods DROP COLUMN IF EXISTS embedding_v5;
ALTER TABLE foods DROP COLUMN IF EXISTS embedding_updated_at;
ALTER TABLE foods DROP COLUMN IF EXISTS failed_fields;
```

**注意 DDL 顺序**：先 INSERT 新表的数据迁移脚本运行（Step 3），再 ALTER 主表。Prisma migration 会同时下发 CREATE 和 DROP，因此本方案拆为：

- migration A（仅 CREATE 新表 + 索引）
- 数据迁移脚本（INSERT 新表）
- migration B（DROP foods 旧字段 + Prisma 模型重命名 Foods→Food）

---

## Step 3：数据迁移脚本

`apps/api-server/scripts/refactor/migrate-food-infra.ts`

```ts
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';

const prisma = new PrismaClient();

async function migrateEmbeddings() {
  // 旧 embedding (Float[]) → vector_legacy
  await prisma.$executeRawUnsafe(`
    INSERT INTO food_embeddings (id, food_id, model_name, vector_legacy, dimension, generated_at, updated_at)
    SELECT gen_random_uuid()::text, id, 'legacy_v4', embedding,
           COALESCE(array_length(embedding, 1), 0),
           COALESCE(embedding_updated_at, NOW()),
           COALESCE(embedding_updated_at, NOW())
    FROM foods WHERE embedding IS NOT NULL
    ON CONFLICT (food_id, model_name) DO NOTHING;
  `);

  // 新 embedding_v5 (vector) → vector
  await prisma.$executeRawUnsafe(`
    INSERT INTO food_embeddings (id, food_id, model_name, model_version, vector, dimension, generated_at, updated_at)
    SELECT gen_random_uuid()::text, id, 'openai_v5', 'text-embedding-3-small',
           embedding_v5, 1536,
           COALESCE(embedding_updated_at, NOW()),
           COALESCE(embedding_updated_at, NOW())
    FROM foods WHERE embedding_v5 IS NOT NULL
    ON CONFLICT (food_id, model_name) DO NOTHING;
  `);
}

async function migrateProvenance() {
  // field_sources / field_confidence → food_field_provenance (success 行)
  // 注：field_sources 是 {fieldName: source} 形如 {"calories":"usda","protein":"gpt"}
  await prisma.$executeRawUnsafe(`
    INSERT INTO food_field_provenance (id, food_id, field_name, source, confidence, status, created_at, updated_at)
    SELECT gen_random_uuid()::text, f.id,
           kv.key AS field_name,
           kv.value::text AS source,
           COALESCE((f.field_confidence->>kv.key)::float, NULL),
           'success', NOW(), NOW()
    FROM foods f, jsonb_each_text(COALESCE(f.field_sources, '{}'::jsonb)) kv
    ON CONFLICT (food_id, field_name, source) DO NOTHING;
  `);

  // failed_fields → food_field_provenance (failed 行)
  // failed_fields 形如 {"calories": {"reason":"...", "attempts":3}}
  await prisma.$executeRawUnsafe(`
    INSERT INTO food_field_provenance (id, food_id, field_name, source, status, failure_reason, raw_value, created_at, updated_at)
    SELECT gen_random_uuid()::text, f.id,
           kv.key,
           'enrichment',
           'failed',
           kv.value->>'reason',
           kv.value,
           NOW(), NOW()
    FROM foods f, jsonb_each(COALESCE(f.failed_fields, '{}'::jsonb)) kv
    ON CONFLICT (food_id, field_name, source) DO NOTHING;
  `);
}

async function main() {
  console.log('[1/2] migrating embeddings...');
  await migrateEmbeddings();
  console.log('[2/2] migrating field provenance...');
  await migrateProvenance();
  console.log('done');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
```

---

## Step 4：校验脚本

`apps/api-server/scripts/refactor/verify-food-infra.ts`

校验项：

| 检查 | SQL |
|---|---|
| embedding 总数对齐 | `SELECT COUNT(*) FILTER (WHERE embedding IS NOT NULL) FROM foods` ≈ `SELECT COUNT(*) FROM food_embeddings WHERE model_name='legacy_v4'` |
| embedding_v5 总数对齐 | 同上换 v5 / openai_v5 |
| field_sources 键数对齐 | `SELECT SUM(jsonb_object_length(field_sources)) FROM foods WHERE field_sources IS NOT NULL` ≈ provenance success 行数 |
| failed_fields 键数对齐 | 同理 vs provenance failed 行数 |
| 主表行数不变 | `SELECT COUNT(*) FROM foods` 前后一致 |
| 抽样回填 | 随机 50 条 food_id，比对旧 jsonb 与 provenance JOIN 结果 |

校验失败立即中止，不进入 Step 5。

---

## Step 5：执行顺序

```bash
# 假定已 git checkout refactor/food-infra
cd apps/api-server

# 1. 备份
pnpm db:backup:foods

# 2. 应用 migration A（仅新建表）
pnpm prisma migrate dev --name food_infra_create_new_tables

# 3. 灌数据
pnpm tsx scripts/refactor/migrate-food-infra.ts

# 4. 校验
pnpm tsx scripts/refactor/verify-food-infra.ts

# 5. 改代码（Phase 2）& 应用 migration B（DROP 旧字段 + rename model）
pnpm prisma migrate dev --name food_infra_drop_old_columns

# 6. 重新生成 Prisma Client
pnpm prisma generate

# 7. 类型检查
pnpm -w typecheck
```

---

## 回滚方案

| 阶段 | 回滚动作 |
|---|---|
| Step 2 之后 | `prisma migrate resolve --rolled-back` + 手动 DROP 三张新表 |
| Step 3 之后 | TRUNCATE 三张新表，重跑 Step 3 |
| Step 5 之后（已 DROP 旧列） | `pg_restore` 整库回到备份点；git checkout main |

由于未上线，任何阶段都可直接 `pg_restore` 全量恢复，无须在线回滚机制。
