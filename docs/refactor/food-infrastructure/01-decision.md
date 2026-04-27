# 01 · 核心决策记录（ADR）

> 这份文档记录了关键架构决策的**理由**，供未来 review 和后续维护者参考。

## 决策 1：为什么是 4 张表而不是 7 张表？

### 背景

初版方案提议将 `Foods` 表拆为 7 层（FoodBase / FoodSources / FoodFieldResolution / FoodNutrition / FoodAttribute / FoodAIProfile / FoodEmbedding / FoodRecommendationProfile）。

代码盘点（见 `docs/refactor/food-infrastructure/inventory.md` 或 `task` agent 输出）发现以下事实：

1. **`FoodLibrary` 接口是 245+ 处引用的真实契约**，不是 Prisma 自动生成的 `Foods` 类型。
2. **`food-pool-cache` 和 `food-library.service` 手写了 ~80 列 SELECT 清单**，是推荐流热路径。
3. **`food-enrichment.service.ts` 大量按字段动态 SELECT/UPDATE**（~16 处 raw SQL）。
4. **`fieldSources` / `fieldConfidence` 已经是 jsonb**，业务代码大量使用 jsonb 操作符（`#-`、`?`）。
5. **代码中 `aiHealthScore` 字段零引用**——AIProfile 层是空的。
6. **`tags` / `allergens` / `compatibility` / `mealTypes` 在内存中被推荐流过滤**，已有 GIN 索引。

### 决策

| 拆分诉求 | 是否拆 | 原因 |
|---|---|---|
| 拆出 embedding | ✅ 拆 | 1536 维向量是行宽炸弹；HNSW 索引独立后性能更好；支持多模型版本 |
| 拆出 fieldSources/fieldConfidence/failedFields | ✅ 拆为 `food_field_provenance` 关联表 | 可结构化索引；可"按字段反查所有低置信记录"；为可解释 AI 服务 |
| 新增 food_recommendation_profile | ✅ 新增 | 推荐排序专用预计算特征，与主表读写模式完全不同 |
| 拆营养字段 | ❌ 不拆 | enrichment 16 处动态 SQL 全部重写代价过高；推荐流也要 JOIN |
| 拆 tags/allergens 为关联表 | ❌ 不拆 | 推荐流在内存过滤，关联表需 JOIN 后聚合，性能反退 |
| 新增 AIProfile 表 | ❌ 不新增 | 当前没有真实的 LLM 推断字段；过早设计 |

### 替代方案考量

- **方案 A（激进 7 表）**：拆得多，工作量 50+ 文件改造，`FoodLibrary` 重写
  - 风险：业务代码大量改动；推荐流多 JOIN；enrichment 重写
  - 收益：架构更"干净"
- **方案 B（修正 4 表）✅ 采用**：拆"行宽 / 结构化 / 预计算"三大不同读写模式
  - 风险：主表仍然较宽（80 字段，从 150 降）
  - 收益：业务改动局限在 ~15 文件；`FoodLibrary` 几乎不变
- **方案 C（保守 1 表）**：仅拆 embedding
  - 风险：缺少可解释 AI 基础；缺少推荐预计算
  - 收益：最小改动

**采用方案 B**。理由：B 拿到了 A 的 70% 收益，但只付出 30% 代价。

---

## 决策 2：为什么把 fieldSources 这种 jsonb 拆出去？

### 背景

`foods.field_sources` 当前是 jsonb：
```json
{ "protein": "ai_enrichment", "fat": "manual", "carbs": "usda" }
```

业务代码大量依赖 jsonb 操作符。

### 决策

**采用"双层共存"策略**：
- 主表保留 `field_sources` jsonb（**真实源**）—— admin/enrichment 继续直接读
- 新增 `food_field_provenance` 表（**派生层**）—— 由 enrichment service 写入时双写
- `food_field_provenance` 用于：
  - 按字段反查（"所有 protein 是 AI 生成的食物"）
  - 统计低置信字段
  - 可解释 AI 推荐说明

### 为什么不直接消除 jsonb？

- 业务代码 ~5 处 raw SQL 依赖 `field_sources - 'key'` 等 jsonb 操作
- 全表迁移到关联表后，`UPDATE` 操作需先 DELETE 再 INSERT，事务复杂度上升
- 当前 jsonb 大小可控（~10 字段 × 平均 30 字节 = 300 字节），不构成性能问题
- 双层设计让我们可以**渐进迁移**：未来如果需要彻底消除 jsonb，再做第二阶段

### 一致性保证

- 写入唯一入口：`FoodEnrichmentService.markFieldEnriched()`
- 同时写 jsonb 和关联表，事务中完成
- 提供 `verify-provenance.ts` 校验脚本，定期对账

---

## 决策 3：为什么 embedding 拆成 1:N？

### 决策

`food_embeddings` 表设计为：
```
PK: id (uuid)
UNIQUE: (food_id, model_name)
```

不是 1:1 而是 1:N。一个食物可以有多个模型的 embedding 共存。

### 理由

1. **当前主表已有 `embedding` (Float[]) + `embedding_v5` (vector) 两个字段**——已经在事实上做"多模型并存"，但靠加列实现，无法扩展。
2. **A/B 测试需要**：上线新模型时，旧模型 embedding 必须保留对照。
3. **冷启动需要**：新加食物没生成 embedding 前，能 fall back 到旧模型。

### 当前状态的迁移

| 旧字段 | 迁移到 |
|---|---|
| `foods.embedding` (Float[]) | `food_embeddings` 行 1，`model_name='legacy_v4'`（如有数据） |
| `foods.embedding_v5` (vector) | `food_embeddings` 行 2，`model_name='openai_text_embedding_3_small_v5'` |
| `foods.embedding_updated_at` | 各行 `updated_at` |

迁移脚本会自动处理。

---

## 决策 4：Prisma 模型重命名 Foods → Food

### 背景

现有 Prisma 模型是 `model Foods`（复数），不符合 Prisma 官方推荐（实体类应单数）。

### 决策

重命名 `model Foods` → `model Food`，但物理表名 `@@map("foods")` 保持不变。

### 后果

- 业务代码 113 处 `prisma.foods.*` → `prisma.food.*`
- 满足"彻底改"原则（用户决定）
- 数据库零迁移

### 不重命名其他表

`FoodSources` / `FoodTranslations` 等暂不重命名，避免范围蔓延。这是**已知的不一致**，记入第二阶段（如有）。

---

## 决策 5：foods 视图层（兼容旧代码）的取舍

### 选项 A：物理表 foods 仍是真实表，业务代码必须改 ✅ 采用

- 业务代码 113 处必须改
- 数据真实位置清晰
- 性能最优

### 选项 B：拆字段后用 VIEW 兼容旧代码

- 业务代码无需改
- 但 VIEW 不支持高效 UPDATE
- 多表 JOIN 影响性能
- enrichment 的动态 SQL 通过 VIEW 反而更慢

### 决策

**采用 A**，符合用户决策"彻底改：删除 foods 模型，所有代码必须改"。

---

## 决策 6：迁移采用 in-place 而不是 dual-write

### 背景

项目未上线 + 食物库有备份 + git 已切分支。

### 决策

**采用 in-place migration**（停机迁移）：
1. 写迁移 SQL：建新表 → 数据从旧 foods 灌入新表 → drop 旧字段
2. 写业务代码改造：一次提交完成
3. 不做双写、不做读切换

### 理由

- 项目未上线，停机零成本
- 双写策略复杂度高，调试时间反而更长
- 单次切换可逆（git revert + 数据库 backup restore）

---

## 边界外的问题（已记录，不在本次解决）

- `food.types.ts` 中 `FoodLibrary` 接口手写镜像 Prisma 类型 → 可考虑改为从 Prisma 类型派生（下一阶段）
- `food-pool-cache` 手写列清单 → 可考虑用 Prisma `$queryRaw` 模板字面量自动生成（下一阶段）
- 区域数据（`food_regional_info`）尚未升级为"决策型"（下一阶段）
- 推荐预计算 `food_recommendation_profile` 仅建表，离线计算任务由后续 PR 实现
