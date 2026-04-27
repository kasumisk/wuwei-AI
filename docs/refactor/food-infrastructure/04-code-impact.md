# 04 · 代码改造影响清单

本文件枚举本次重构中**必须修改**的代码位置，按改造主题分组。所有路径相对仓库根。

---

## 主题 A：Prisma 模型 `Foods` → `Food`（重命名）

由于将 model 由 `Foods` 改为 `Food`（物理表名 `@@map("foods")` 不变），所有 `prisma.foods` 调用必须改为 `prisma.food`。

**影响范围**：113 处 `prisma.foods` 调用，分布在 24+ 文件。处理方式：全量字符串替换 + 编译验证。

涉及文件（节选 / 完整列表见 `01-decision.md` 附录 A）：

```
apps/api-server/src/modules/food/app/services/food-library.service.ts
apps/api-server/src/modules/food/app/services/food-library-management.service.ts
apps/api-server/src/modules/food/app/services/food-pool-cache.service.ts
apps/api-server/src/modules/diet/app/recommendation/pipeline/food-pool-cache.service.ts
apps/api-server/src/modules/diet/app/recommendation/recall/vector-search.service.ts
apps/api-server/src/modules/diet/app/recommendation/recall/semantic-recall.service.ts
apps/api-server/src/modules/diet/app/recommendation/embedding/embedding-generation.service.ts
apps/api-server/src/modules/diet/app/recommendation/embedding/embedding-generation.processor.ts
apps/api-server/src/food-pipeline/services/food-enrichment.service.ts
apps/api-server/src/food-pipeline/services/processing/food-conflict-resolver.service.ts
apps/api-server/src/food-pipeline/services/processing/food-quality-monitor.service.ts
apps/api-server/src/scripts/seeds/seed-foods.ts
apps/api-server/src/scripts/seeds/seed-translations.ts
apps/api-server/src/scripts/tools/reset-food-form-defaults.ts
... (完整 24+ 文件)
```

---

## 主题 B：embedding 字段下沉到 `food_embeddings` 表

### B1. 写入路径

**改造前**：`UPDATE foods SET embedding_v5 = $1, embedding_updated_at = NOW() WHERE id = $2`
**改造后**：`INSERT INTO food_embeddings (...) ON CONFLICT (food_id, model_name) DO UPDATE SET vector = $1, updated_at = NOW()`

涉及文件：

| 文件 | 改造点 |
|---|---|
| `modules/diet/app/recommendation/embedding/embedding-generation.service.ts` | 写入逻辑（按 model_name 路由） |
| `modules/diet/app/recommendation/embedding/embedding-generation.processor.ts` | 调用上述 service |

### B2. 读取路径（向量召回）

**改造前**：`SELECT id, embedding_v5 <=> $1 AS dist FROM foods WHERE embedding_v5 IS NOT NULL`
**改造后**：`SELECT f.id, fe.vector <=> $1 AS dist FROM foods f JOIN food_embeddings fe ON fe.food_id=f.id AND fe.model_name='openai_v5'`

涉及文件：

| 文件 | 改造点 |
|---|---|
| `modules/diet/app/recommendation/recall/vector-search.service.ts` | pgvector 距离 SQL，HNSW 索引继续生效 |
| `modules/diet/app/recommendation/recall/semantic-recall.service.ts` | 同上 |

### B3. 列清单

| 文件 | 改造点 |
|---|---|
| `modules/diet/app/recommendation/pipeline/food-pool-cache.service.ts` | 行 47-134 的列清单**无需改**（本就不含 embedding）；但 `mapRowToFoodLibrary` (217-348) 中如有引用 embedding 字段需移除 |
| `modules/food/app/services/food-library.service.ts` | 行 27-77 列清单：移除 `embedding`、`embedding_v5`、`embedding_updated_at` |

---

## 主题 C：fieldSources / fieldConfidence / failedFields 双层共存

### C1. 主表 jsonb 列保留

`field_sources` (jsonb) 和 `field_confidence` (jsonb) 在主表保留，作为快路径缓存。`failed_fields` 主表移除，只在 provenance 表中存在。

### C2. 写入路径：双写

**enrichment 成功一个字段时**：

```ts
// 旧
await prisma.$executeRawUnsafe(`
  UPDATE foods
  SET field_sources = field_sources || $1::jsonb,
      field_confidence = field_confidence || $2::jsonb
  WHERE id = $3
`, sourcesPatch, confidencePatch, foodId);

// 新（事务内双写）
await prisma.$transaction([
  prisma.$executeRawUnsafe(`
    UPDATE foods SET field_sources = field_sources || $1::jsonb,
                     field_confidence = field_confidence || $2::jsonb
    WHERE id = $3
  `, sourcesPatch, confidencePatch, foodId),
  prisma.foodFieldProvenance.upsert({
    where: { food_id_field_name_source: { foodId, fieldName, source } },
    update: { confidence, status: 'success', updatedAt: new Date() },
    create: { id: randomUUID(), foodId, fieldName, source, confidence, status: 'success' },
  }),
]);
```

**enrichment 失败时**：原本 `UPDATE foods SET failed_fields = failed_fields || $1::jsonb`，改为只写 `food_field_provenance`，主表不再有 failed_fields 列。

### C3. 涉及文件

| 文件 | 估计修改点 | 说明 |
|---|---|---|
| `food-pipeline/services/food-enrichment.service.ts` | ~16 处动态 SQL | 最大改造对象，包括 `markFieldFailed`、`recordFieldSource` 等内部方法 |
| `food-pipeline/services/processing/food-conflict-resolver.service.ts:147` | 1 处动态列名 UPDATE | 无 jsonb 修改，仅做 model 重命名；保留原逻辑 |
| `modules/food/app/services/food-library-management.service.ts` | 若有读 `failed_fields` 的逻辑，改为查询 provenance 表 |
| `scripts/tools/reset-food-form-defaults.ts` | 若清理 failed_fields，改为 DELETE provenance |

### C4. 读取路径

**保持读 jsonb**（快路径），不改读取代码。仅当需要"按 source 聚合统计"或"按字段失败次数排查"时，查询 `food_field_provenance`，这类查询当前业务上零调用，新增即可。

---

## 主题 D：FoodRepository 抽象层（新建）

新文件：`apps/api-server/src/modules/food/repositories/food.repository.ts`

职责：

1. 包装 `mapRowToFoodLibrary`，统一从 prisma `Food` + 关联表组装 `FoodLibrary` 接口
2. 提供 `findManyForRecommendation(ids)`：批量查 food + embedding + provenance（按需）
3. 提供 `upsertEmbedding(foodId, modelName, vector)`、`getEmbedding(foodId, modelName)`
4. 提供 `recordFieldSource(foodId, fieldName, source, confidence)` / `recordFieldFailure(foodId, fieldName, reason)`

**不强制**所有调用方迁移到 Repository。本期只在涉及多表 JOIN 的位置使用，避免业务代码 churn 过大。后续 PR 逐步迁移其余调用点。

---

## 主题 E：Recommendation Profile（新建表，本期不强制使用）

`food_recommendation_profile` 表本期建好 + 写一份占位空数据迁移（每个 food 一行 NULL 分数），但不接入推荐排序逻辑。后续单独 PR 接入：

- 离线计算 job 写入 `fat_loss_score` 等
- `food-pool-cache` 加列清单（追加而非替换）
- 推荐 `scoreCalculator` 读这些字段做加权

本期范围内只做 schema 落地。

---

## 主题 F：Seed / Tools 脚本

| 文件 | 修改 |
|---|---|
| `scripts/seeds/seed-foods.ts` | `prisma.foods.upsert` → `prisma.food.upsert`；移除 embedding 字段 |
| `scripts/seeds/seed-translations.ts` | 同上模型重命名 |
| `scripts/tools/reset-food-form-defaults.ts` | 同上 + 处理 failed_fields 清理改为 DELETE provenance |

---

## 主题 G：FoodLibrary 类型定义

`apps/api-server/src/modules/food/food.types.ts:89-219`

- `embedding?: number[]` → 设为可选并标注"由 FoodRepository 按需注入，主表查询不返回"
- `embeddingV5?: number[]` → 同上
- `embeddingUpdatedAt?: Date` → 同上
- `failedFields?: ...` → **删除**（业务从未读取）

245+ 处引用因接口字段变可选/删除可能编译报错，逐个修复。

---

## 不改的部分

- `food_sources` / `food_translations` / `food_regional_info` / `food_change_logs` / `food_conflicts` / `food_candidates` 表与对应代码：完全不动
- 推荐流的 tags / allergens / compatibility 过滤逻辑：完全不动
- 营养字段（calories/protein/...）：完全不动
- AI healthScore 相关字段：当前代码零引用，保留主表字段，**无人接** —— 本期不引入新表

---

## 影响面汇总

| 维度 | 数量 |
|---|---|
| 必改文件 | ~50 |
| 必改 Prisma 调用 | ~113 |
| 必改 raw SQL | ~30（其中 enrichment 16 + vector-search 4 + 其它 ~10） |
| 新建文件 | 4（FoodRepository、embedding-model.constants、migrate 脚本、verify 脚本） |
| 文档 | 8（本目录） |
