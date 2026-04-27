# 02 · 目标 Schema 设计

## 总览

```
                  ┌─────────────────────────────┐
                  │         foods (主表)         │
                  │   ~80 字段（瘦身 ~50%）      │
                  │  - 基本/分类/营养/烹饪/媒体 │
                  │  - tags/allergens(jsonb)    │
                  │  - field_sources(jsonb 缓存)│
                  └──────┬──────────────────────┘
                         │ 1:1 / 1:N
       ┌─────────────────┼─────────────────┬───────────────────┐
       │                 │                 │                   │
       ▼                 ▼                 ▼                   ▼
┌──────────────┐  ┌────────────────────┐  ┌─────────────────────────────┐
│food_         │  │food_field_         │  │food_recommendation_profile  │
│embeddings    │  │provenance          │  │                             │
│              │  │                    │  │  fat_loss_score             │
│ 1:N 多模型   │  │ 1:N 字段级溯源     │  │  muscle_gain_score          │
│ HNSW 索引    │  │ 可索引/可统计      │  │  general_health_score       │
└──────────────┘  └────────────────────┘  │  popularity_score           │
                                          │  region_fitness (jsonb)     │
                                          │   1:1 给推荐排序            │
                                          └─────────────────────────────┘

不变：
  food_sources / food_translations / food_regional_info
  food_change_logs / food_conflicts / food_candidates
```

---

## 表 1：foods（主表，瘦身后）

### 移除的字段

| 字段 | 去向 | 备注 |
|---|---|---|
| `embedding` (Float[]) | → `food_embeddings.vector_legacy` | model_name='legacy_v4' |
| `embedding_v5` (vector) | → `food_embeddings.vector` | model_name='openai_v5' |
| `embedding_updated_at` | → `food_embeddings.updated_at` | 各行独立 |
| `failed_fields` (jsonb) | → `food_field_provenance` | enrichment 失败记录改为关联表 |

### 保留的字段（80 字段）

参考 schema.prisma 中保留的全部字段，仅去掉上述 4 个。

### `field_sources` / `field_confidence` 处理

**保留在主表（jsonb）作为快查缓存**，同时双写到 `food_field_provenance`。

> 见 `01-decision.md 决策 2`。

### Prisma 模型定义

```prisma
/// 全球化食物库主表（重构后瘦身版）
model Food {
  // ─── 基本信息 ─────────────────────────
  id                    String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  code                  String    @unique @db.VarChar(50)
  name                  String    @unique @db.VarChar(100)
  aliases               String?   @db.VarChar(1000)
  barcode               String?   @db.VarChar(50)
  status                String    @default("draft") @db.VarChar(20)
  category              String    @db.VarChar(30)
  subCategory           String?   @map("sub_category") @db.VarChar(200)
  foodGroup             String?   @map("food_group") @db.VarChar(200)
  foodForm              String?   @map("food_form") @db.VarChar(20)
  dishPriority          Int?      @map("dish_priority")
  acquisitionDifficulty Int?      @map("acquisition_difficulty")

  // ─── 营养字段（保留全部，约 30 个）──────
  calories              Decimal   @db.Decimal(7, 1)
  protein               Decimal?  @db.Decimal(6, 1)
  // ... 全部营养字段保持不变

  // ─── 健康评估 ─────────────────────────
  glycemicIndex         Int?      @map("glycemic_index")
  glycemicLoad          Decimal?  @map("glycemic_load") @db.Decimal(5, 1)
  isProcessed           Boolean?  @map("is_processed")
  isFried               Boolean?  @map("is_fried")
  processingLevel       Int?      @map("processing_level")
  fodmapLevel           String?   @map("fodmap_level") @db.VarChar(10)
  oxalateLevel          String?   @map("oxalate_level") @db.VarChar(10)
  allergens             Json      @default("[]")
  qualityScore          Decimal?  @map("quality_score") @db.Decimal(3, 1)
  satietyScore          Decimal?  @map("satiety_score") @db.Decimal(3, 1)
  nutrientDensity       Decimal?  @map("nutrient_density") @db.Decimal(5, 1)

  // ─── 标签（保留 jsonb + GIN 索引）────────
  mealTypes             Json      @map("meal_types") @default("[]")
  tags                  Json      @default("[]")
  mainIngredient        String?   @map("main_ingredient") @db.VarChar(200)
  ingredientList        String[]  @map("ingredient_list") @default([])
  compatibility         Json      @default("{}")
  availableChannels     Json      @map("available_channels") @default("[\"home_cook\",\"restaurant\",\"delivery\",\"convenience\"]")
  commonalityScore      Int       @map("commonality_score")

  // ─── 份量 / 烹饪 / 风味 / 媒体（不变）────
  // ... 见原 schema

  // ─── 数据溯源（保留）─────────────────────
  primarySource         String    @map("primary_source") @default("manual") @db.VarChar(50)
  primarySourceId       String?   @map("primary_source_id") @db.VarChar(100)
  dataVersion           Int       @map("data_version") @default(1)
  confidence            Decimal   @default(1) @db.Decimal(3, 2)
  isVerified            Boolean   @map("is_verified") @default(false)
  verifiedBy            String?   @map("verified_by") @db.VarChar(100)
  verifiedAt            DateTime? @map("verified_at") @db.Timestamptz(6)
  searchWeight          Int       @map("search_weight") @default(100)
  popularity            Int?      @default(0)

  // ─── 补全元数据（保留 jsonb 缓存）─────────
  dataCompleteness      Int       @map("data_completeness") @default(0)
  enrichmentStatus      String    @map("enrichment_status") @default("pending") @db.VarChar(20)
  reviewStatus          String    @map("review_status") @default("pending") @db.VarChar(20)
  lastEnrichedAt        DateTime? @map("last_enriched_at") @db.Timestamptz(6)
  fieldSources          Json      @map("field_sources") @default("{}")  // ← jsonb 缓存
  fieldConfidence       Json      @map("field_confidence") @default("{}")  // ← jsonb 缓存
  reviewedBy            String?   @map("reviewed_by") @db.VarChar(100)
  reviewedAt            DateTime? @map("reviewed_at") @db.Timestamptz(6)

  createdAt             DateTime  @map("created_at") @default(now()) @db.Timestamptz(6)
  updatedAt             DateTime  @map("updated_at") @default(now()) @db.Timestamptz(6)

  // ─── 关联关系 ─────────────────────────
  embeddings            FoodEmbedding[]
  fieldProvenance       FoodFieldProvenance[]
  recommendationProfile FoodRecommendationProfile?
  foodSources           FoodSources[]
  foodTranslations      FoodTranslations[]
  foodRegionalInfo      FoodRegionalInfo[]
  foodChangeLogs        FoodChangeLogs[]
  foodConflicts         FoodConflicts[]
  analysisFoodLink      AnalysisFoodLink[]
  dailyPlanItems        DailyPlanItems[]
  recipeIngredients     RecipeIngredients[]

  @@map("foods")
  @@index([searchWeight])
  @@index([allergens], type: Gin)
  @@index([mealTypes], type: Gin)
  @@index([tags], type: Gin)
  @@index([cookingMethods], type: Gin)
  @@index([category])
  @@index([cuisine])
  @@index([status])
  @@index([primarySource])
  @@index([barcode])
  @@index([foodForm])
  @@index([enrichmentStatus])
  @@index([reviewStatus])
  @@index([dataCompleteness])
  @@index([lastEnrichedAt])
  @@index([commonalityScore])
  @@index([searchWeight(sort: Desc)])
  @@index([isVerified, category])
  @@index([name(ops: raw("gin_trgm_ops"))], type: Gin)
  @@index([aliases(ops: raw("gin_trgm_ops"))], type: Gin)
}
```

---

## 表 2：food_embeddings（向量层）

### 设计

```prisma
/// 食物语义向量表 — 多模型版本共存，独立 HNSW 索引
model FoodEmbedding {
  id            String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  foodId        String    @map("food_id") @db.Uuid
  modelName     String    @map("model_name") @db.VarChar(64)
  /// 维度（用于校验：openai-3-small=1536，bge-m3=1024）
  dimension     Int
  /// pgvector 类型（推荐查询主用）
  vector        Unsupported("vector")?
  /// 旧版 Float[] 兼容（V4 模型遗留，迁移后逐步淘汰）
  vectorLegacy  Float[]   @map("vector_legacy") @db.Real
  /// 是否为该食物的主向量（推荐流默认查询此条）
  isPrimary     Boolean   @map("is_primary") @default(true)
  createdAt     DateTime  @map("created_at") @default(now()) @db.Timestamptz(6)
  updatedAt     DateTime  @map("updated_at") @default(now()) @db.Timestamptz(6)

  food Food @relation(fields: [foodId], references: [id], onDelete: Cascade)

  @@unique([foodId, modelName])
  @@index([foodId, isPrimary])
  @@map("food_embeddings")
}
```

### 索引（手写 SQL，因为 Prisma 不支持 HNSW）

```sql
CREATE INDEX food_embeddings_vector_hnsw_idx
  ON food_embeddings
  USING hnsw (vector vector_cosine_ops)
  WHERE vector IS NOT NULL;
```

### 写入约束

- 主向量唯一性：每个 `food_id` 至多一条 `is_primary=true`（应用层强制）
- 模型名规范：枚举值见 `apps/api-server/src/modules/food/embedding-model.constants.ts`（新建）

---

## 表 3：food_field_provenance（字段级溯源）

### 设计

```prisma
/// 食物字段级溯源 — 支持可解释 AI 与按字段反查
model FoodFieldProvenance {
  id          String    @id @default(dbgenerated("uuid_generate_v4()")) @db.Uuid
  foodId      String    @map("food_id") @db.Uuid
  /// 字段路径，如 'protein' / 'glycemic_index' / 'tags' / 'flavor_profile.sweet'
  fieldPath   String    @map("field_path") @db.VarChar(120)
  /// 来源：manual/usda/cfsb/ai_enrichment/import/rule_inference
  source      String    @db.VarChar(40)
  /// 置信度 0-1
  confidence  Decimal?  @db.Decimal(3, 2)
  /// 状态：active / failed / overridden
  status      String    @default("active") @db.VarChar(20)
  /// 失败原因（仅 status=failed 时）
  failureReason String? @map("failure_reason") @db.VarChar(500)
  /// 决策方法：highest_trust / latest / ai_fusion / manual_override
  method      String?   @db.VarChar(40)
  /// 关联的 food_sources.id（如该字段值确实来自某个外部源）
  sourceRecordId String? @map("source_record_id") @db.Uuid
  /// 决策时间
  resolvedAt  DateTime  @map("resolved_at") @default(now()) @db.Timestamptz(6)
  /// 决策人 / 系统
  resolvedBy  String?   @map("resolved_by") @db.VarChar(100)

  food Food @relation(fields: [foodId], references: [id], onDelete: Cascade)

  @@unique([foodId, fieldPath])
  @@index([fieldPath])
  @@index([source])
  @@index([status])
  @@index([confidence])
  @@map("food_field_provenance")
}
```

### 与主表 jsonb 的关系

| 写入场景 | 主表 `field_sources` jsonb | `food_field_provenance` 表 |
|---|---|---|
| AI 补全单字段 | `{ ..., "protein": "ai_enrichment" }` | INSERT 一行 (foodId, 'protein', 'ai_enrichment', confidence) |
| 人工覆盖 | 更新 jsonb key | UPSERT 行（method='manual_override'） |
| 字段补全失败 | `failed_fields` jsonb（→ 移除） | INSERT 行 status='failed' |
| 清空 enrichment | jsonb `#-` 删 key | DELETE 对应行 |

### 失败字段记录迁移

旧 `foods.failed_fields` jsonb 完全迁移到本表的 `status='failed'` 行，主表删除 `failed_fields` 字段。

---

## 表 4：food_recommendation_profile（推荐预计算特征）

### 设计

```prisma
/// 推荐系统预计算特征 — 离线计算，给推荐排序使用
model FoodRecommendationProfile {
  foodId             String    @id @map("food_id") @db.Uuid
  /// 减脂目标适配度 0-1
  fatLossScore       Decimal?  @map("fat_loss_score") @db.Decimal(4, 3)
  /// 增肌目标适配度 0-1
  muscleGainScore    Decimal?  @map("muscle_gain_score") @db.Decimal(4, 3)
  /// 综合健康评分 0-1
  generalHealthScore Decimal?  @map("general_health_score") @db.Decimal(4, 3)
  /// 平衡饮食评分 0-1
  balancedDietScore  Decimal?  @map("balanced_diet_score") @db.Decimal(4, 3)
  /// 流行度评分 0-1（基于 popularity 归一化）
  popularityScore    Decimal?  @map("popularity_score") @db.Decimal(4, 3)
  /// 区域适配度，如 {"CN":0.9,"US":0.7,"JP":0.5}
  regionFitness      Json?     @map("region_fitness")
  /// 餐次适配度，如 {"breakfast":0.8,"lunch":0.5,"dinner":0.6}
  mealFitness        Json?     @map("meal_fitness")
  /// 上次计算时间
  lastComputedAt     DateTime  @map("last_computed_at") @default(now()) @db.Timestamptz(6)
  /// 计算批次/版本号
  computeVersion     String?   @map("compute_version") @db.VarChar(40)

  food Food @relation(fields: [foodId], references: [id], onDelete: Cascade)

  @@index([fatLossScore])
  @@index([muscleGainScore])
  @@index([generalHealthScore])
  @@index([popularityScore])
  @@map("food_recommendation_profile")
}
```

### 计算来源

- `fat_loss_score`：基于 `protein/calories` 比 + 纤维 + 加工度（公式见 `food-recommendation-scoring.service.ts`，本次仅建表）
- `muscle_gain_score`：基于蛋白质密度 + 必需氨基酸（暂用蛋白质 g 占比代理）
- `general_health_score`：等于现有 `quality_score` 标准化到 0-1
- `popularity_score`：`popularity` 全表 min-max 归一化

### 本次重构范围

✅ 仅建表 + 提供空白迁移（所有食物初始无值）
❌ 不实现计算任务（留给下一阶段）

---

## 表的物理表名总览

| Prisma 模型 | 物理表 |
|---|---|
| `Food` | `foods`（重命名模型，物理表不变） |
| `FoodEmbedding` | `food_embeddings`（新增） |
| `FoodFieldProvenance` | `food_field_provenance`（新增） |
| `FoodRecommendationProfile` | `food_recommendation_profile`（新增） |
| `FoodSources` | `food_sources`（不变） |
| `FoodTranslations` | `food_translations`（不变） |
| `FoodRegionalInfo` | `food_regional_info`（不变） |
| `FoodChangeLogs` | `food_change_logs`（不变） |
| `FoodConflicts` | `food_conflicts`（不变） |

---

## 迁移前后对比

| 维度 | Before | After |
|---|---|---|
| 主表字段数 | 150+ | ~80 |
| 主表行宽（含向量） | ~6KB（vector 1536 维 × 4B + 其他） | ~2KB |
| 主表 SELECT \* 性能 | 慢（含 vector） | 快 |
| HNSW 索引位置 | 主表上 | 独立 `food_embeddings` 表 |
| 字段级溯源 | jsonb（不可索引） | jsonb 缓存 + 关联表（可索引） |
| 推荐预计算 | 无 | 独立 1:1 表 |
| Prisma 模型名 | `Foods` | `Food`（业务代码 113 处需改） |
