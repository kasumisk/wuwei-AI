# Intelligent Food Enrichment System — V2.1 Upgrade

> **范围严格限定**：食物管理模块（`src/modules/food/`）+ AI 补全模块（`src/food-pipeline/`）
> 推荐系统、用户画像、决策系统、商业化逻辑 **一律不涉及**。

---

## 概览

V2.1 专注于两个模块的 **可维护性、数据流健壮性、字段覆盖完整性** 三个维度的提升，同时修复已知 Bug，重构强制入队流程，使其直接走自定义字段一次性补全而非分阶段流程。

---

## Step 1：现有能力分析

### 食物管理（Food Management）

**已有能力**
- 完整 CRUD（创建/更新/删除/批量导入）
- 14 维度筛选（名称/类别/状态/完整度/审核状态…）
- `enrichmentMeta` 聚合字段（completeness / fieldSources / fieldConfidence / failedFields）
- 字段级来源标记（`fieldSources` JSONB）
- 字段级置信度（`fieldConfidence` JSONB）
- 批量审核 `reviewStatus`
- 变更日志（`food_change_logs`）

**已知问题 / 不足**
| 编号 | 问题 | 影响 |
|------|------|------|
| G-01 | `rollbackEnrichment` 删除原 change_log，审计链断裂 | 无法追溯谁/何时回滚 |
| G-02 | staged 列表 `currentValues` 用 snake_case key 读 Prisma camelCase 对象，多词字段全为 null | 审核列表显示"当前值"全部错误 |
| G-03 | completeness 门槛：`enrichmentStatus` 写入用 ≥30=partial，进度显示 SQL 用 ≥40=partial，不一致 | 仪表盘与状态字段数量对不上 |

### AI 补全（AI Enrichment）

**已有能力**
- 5 阶段分批补全（Stage 1–5，合计 64 个 ENRICHABLE_FIELDS）
- 分阶段入库（staged review）或直接入库
- 单条立即补全 `enrich-now`
- 批量入队（null 字段过滤）
- 强制重新入队 `re-enqueue`（clearFields 选项）
- 字段级预览 diff（current vs proposed）
- IQR 一致性校验
- 类别均值兜底（Stage 1/2 失败时）
- 失败字段持久化（`failedFields` JSONB）

**已知问题 / 不足**
| 编号 | 问题 | 影响 |
|------|------|------|
| E-01 | `AI_OVERRIDABLE_FIELDS` 混用 camelCase/snake_case，与 `ENRICHABLE_FIELDS`（全 snake_case）比较时大量失效 | 可覆盖字段实际只有 4 个生效 |
| E-02 | 强制入队（`re-enqueue`）仍走分阶段流程，无法指定字段一次性补全 | 与"强制"语义矛盾；效率低 |
| E-03 | 批量 approve/reject 串行 `for...of`，大批量极慢 | 100 条约需 30–60 秒 |
| E-04 | `clearData['enrichmentStatus'] = null` 随后被 `enrichmentStatus: 'pending'` 覆盖，死代码 | 误导性，维护困惑 |

---

## Step 2：修复清单（按优先级）

### BUG-01 `AI_OVERRIDABLE_FIELDS` 混用大小写（E-01）

**根因**：`ENRICHABLE_FIELDS` 全为 snake_case，`AI_OVERRIDABLE_FIELDS` 混用，导致 camelCase 条目在 `includes()` 比对时永远不匹配。

**修复**：统一改为 snake_case，移除不存在于 `ENRICHABLE_FIELDS` 中的 `popularity`。

```
文件：src/food-pipeline/services/food-enrichment.service.ts
修复前 → 修复后（见代码实现）
```

---

### BUG-02 staged 列表 `currentValues` 字段读取失败（G-02）

**根因**：`getStagedEnrichments()` 中用 `food[key]` 读取当前值，`key` 是 AI 返回的 snake_case（如 `glycemic_index`），而 Prisma 返回对象是 camelCase（`glycemicIndex`）。单词字段（`protein`、`fat`）偶然正确，多词字段全为 undefined → null。

**修复**：用 `snakeToCamel(key)` 转换后再读取。

---

### BUG-03 `rollbackEnrichment` 删除日志而非标记（G-01）

**根因**：代码注释"无需审计日志"，直接 `delete` change_log 记录。

**修复**：改为更新 `action = 'ai_enrichment_rolled_back'`，追加 `rollbackAt` / `rollbackBy` 元数据，保留审计链。

---

### BUG-04 completeness 门槛不一致（G-03）

**根因**：`getEnrichmentProgress()` 的 distribution SQL 使用 `>= 40` 判断 partial，而所有写入逻辑使用 `>= 30`。

**修复**：统一改为 `>= 30`，提取常量 `COMPLETENESS_PARTIAL_THRESHOLD = 30`、`COMPLETENESS_COMPLETE_THRESHOLD = 80`。

---

### BUG-05 `clearData['enrichmentStatus'] = null` 死代码（E-04）

**修复**：删除该行，因为后续 `{ ...clearData, enrichmentStatus: 'pending' }` 已正确设置。

---

## Step 3：强制入队重构（核心）

### 现有问题

`POST /enrichment/re-enqueue` 当前：
1. 找出符合条件的食物
2. （可选）清空字段
3. 入队 job，job 数据仅有 `fields` 列表和 `staged` 标志
4. Worker 收到 job 后仍然调用 `processFoodsByStage()` → 跑完整 5 阶段流程

**结果**：即使你只想重新补全 3 个字段，也会运行全部 5 个 stage 的 prompt，而且还受 `staged` 模式（置信度 < 0.7 自动暂存）约束。

### 目标行为

强制入队应：
1. **直接**针对用户指定的字段构建一次性 prompt（不分阶段）
2. **跳过** staged 模式判断，直接写入 DB
3. 仅清空并重写指定字段，不触碰其余字段

### 实现方案

新增 `mode` 字段到 job data：

```ts
interface EnrichmentJobData {
  foodId: string;
  fields?: EnrichableField[];
  target?: 'foods' | 'translations' | 'regional';
  staged?: boolean;
  locale?: string;
  region?: string;
  stages?: number[];
  mode?: 'staged_flow' | 'direct_fields';  // NEW
}
```

- `mode = 'direct_fields'`：processor 调用新方法 `enrichFieldsDirect()`，一次 AI call，结果直接写入 DB，跳过 staged 判断。
- `mode = 'staged_flow'`（默认）：保持现有 `processFoodsByStage()` 路径不变。

`re-enqueue` endpoint 固定使用 `mode: 'direct_fields'`。

### `enrichFieldsDirect()` 逻辑

```
1. 按 fields 列表构建单一 prompt（不分 stage，复用 FIELD_DESC）
2. 调用 AI（deepseek-chat，JSON mode）
3. validateAndClean() 验证结果
4. applyEnrichmentDirect()：
   a. 只更新 fields 中的字段
   b. 更新 fieldSources[field] = 'ai_enrichment_worker'
   c. 更新 fieldConfidence[field]
   d. 重算 dataCompleteness
   e. 写 food_change_logs（action='ai_enrichment'）
5. 失败时 persistFailedFields()
```

**Prompt 模板**（fields 数量 ≤ 20 时单次，> 20 自动分批每 20 一组）：

```
你是权威食品营养数据库专家。
食物：{name}（{category}）
已有数据：{existingDataJson}

请补全以下字段（每100g），严格JSON格式返回：
{
  {field1}: <value>,
  {field2}: <value>,
  ...
}
禁止返回 JSON 以外的任何文字。
```

---

## Step 4：数据流完整性检查

### 字段覆盖检查

经核查，以下字段存在于 `foods` schema 但当前 `ENRICHABLE_FIELDS` 未覆盖：

| 字段（camelCase） | DB 类型 | 补全价值 | 建议 |
|---|---|---|---|
| `flavorProfile` | `Json?` | 高——影响推荐口味匹配 | 已在 Stage 5（`flavor_profile`）✓ |
| `isFried` | `Boolean @default(false)` | 中 | 已在 `AI_OVERRIDABLE_FIELDS` 但 camelCase 失效，修复后生效 |
| `isProcessed` | `Boolean?` | 中 | 同上 |
| `dishPriority` | `Int?` | 低——推荐排序辅助 | 已在 `dish_priority` ✓ |
| `popularity` | `Int @default(0)` | 低——种子数据默认 0 | 不适合 AI 补全，移出 AI_OVERRIDABLE_FIELDS |
| `searchWeight` | `Int @default(100)` | 无 | 系统字段，不补全 |
| `commonalityScore` | `Int` | 中 | 在 `AI_OVERRIDABLE_FIELDS`（fix 后生效） |
| `standardServingG` | `Int @default(100)` | 中 | 在 `AI_OVERRIDABLE_FIELDS`（fix 后生效） |

结论：核心营养/属性字段均已覆盖，BUG-01 修复后 `isFried`、`isProcessed`、`commonalityScore`、`standardServingG` 将自动生效。

---

## Step 5：API 能力设计

### 复用现有 API（无需修改路径）

| 能力 | 现有 API | 备注 |
|---|---|---|
| 食物 CRUD | `/admin/food-library` 全套 | 已完备 |
| 按完整度/状态筛选 | `GET /admin/food-library?minCompleteness&enrichmentStatus` | 已有 |
| 字段级来源/置信度查看 | `GET /admin/food-library/:id`（enrichmentMeta） | 已有 |
| 单条立即补全 | `POST /enrichment/:foodId/enrich-now` | 已有 |
| 批量入队 | `POST /enrichment/enqueue` | 已有 |
| staged 审核 | `/enrichment/staged/*` 全套 | 已有 |
| 历史记录 | `GET /enrichment/history` | 已有 |
| 完整度进度 | `GET /enrichment/progress` | 已有 |

### 修改现有 API

| API | 修改内容 |
|---|---|
| `POST /enrichment/re-enqueue` | 增加 `mode: 'direct_fields'` 到 job data，跳过 staged 流程 |
| `GET /enrichment/staged` | 修复 `currentValues` snake_case → camelCase 转换 |
| `POST /enrichment/rollback/:id` | 改为标记 `ai_enrichment_rolled_back` 而非删除记录 |

### 新增 API（最小必要）

无需新增 API。所有功能通过修复现有 API 和重构 job 处理逻辑实现。

---

## Step 6：分阶段实施

### Phase 1（本次 V2.1）— Bug 修复 + 强制入队重构

| 任务 | 文件 | 状态 |
|---|---|---|
| BUG-01：统一 `AI_OVERRIDABLE_FIELDS` 为 snake_case | `food-enrichment.service.ts` | 本次实施 |
| BUG-02：修复 staged 列表 `currentValues` 读取 | `food-enrichment.service.ts` | 本次实施 |
| BUG-03：rollback 保留审计日志 | `food-enrichment.service.ts` | 本次实施 |
| BUG-04：统一 completeness 门槛常量 | `food-enrichment.service.ts` | 本次实施 |
| BUG-05：删除死代码 `clearData['enrichmentStatus'] = null` | `food-enrichment.service.ts` | 本次实施 |
| FEAT：`re-enqueue` 走 `direct_fields` 模式 | `food-enrichment.service.ts` + `food-enrichment.processor.ts` | 本次实施 |

### Phase 2（后续迭代）

- 批量 approve/reject 改为并发 `Promise.allSettled`
- `food_change_logs` 添加复合索引 `(food_id, action)`
- Text analysis 添加 BullMQ 队列，避免同步阻塞
- 补全历史 rollback 操作本身记录独立 change_log

### Phase 3（后续迭代）

- 字段级补全策略配置（哪些字段 AI 可覆盖、哪些必须人工审核）
- 补全质量评分趋势（按类别、按来源统计 AI 准确率）
- 批量补全任务进度 WebSocket 实时推送

---

## 代码变更详情

### 变更 1：`food-enrichment.service.ts`

#### 1-A `AI_OVERRIDABLE_FIELDS`（BUG-01）

```diff
- export const AI_OVERRIDABLE_FIELDS: ReadonlyArray<string> = [
-   'food_form',
-   'is_processed',
-   'isFried',             // camelCase — 失效
-   'acquisition_difficulty',
-   'availableChannels',   // camelCase — 失效
-   'standardServingG',    // camelCase — 失效
-   'commonalityScore',    // camelCase — 失效
-   'commonPortions',      // camelCase — 失效
-   'processingLevel',     // camelCase — 失效
-   'aliases',
-   'ingredientList',      // camelCase — 失效
-   'popularity',          // 不在 ENRICHABLE_FIELDS — 无效
- ];
+ export const AI_OVERRIDABLE_FIELDS: ReadonlyArray<string> = [
+   'food_form',
+   'is_processed',
+   'is_fried',
+   'acquisition_difficulty',
+   'available_channels',
+   'standard_serving_g',
+   'commonality_score',
+   'common_portions',
+   'processing_level',
+   'aliases',
+   'ingredient_list',
+ ];
```

#### 1-B completeness 门槛常量（BUG-04）

```diff
+ /** 完整度分级门槛，所有代码统一引用此常量 */
+ export const COMPLETENESS_COMPLETE_THRESHOLD = 80;
+ export const COMPLETENESS_PARTIAL_THRESHOLD = 30;
```

所有原有 `>= 80` / `>= 30` 硬编码替换为常量引用；`getEnrichmentProgress` distribution SQL 中的 `>= 40` 同步修正为 `>= 30`。

#### 1-C staged 列表 currentValues 修复（BUG-02）

```diff
- currentValues[key] = (food as any)[key] ?? null;
+ const camelKey = key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
+ currentValues[key] = (food as any)[camelKey] ?? null;
```

#### 1-D rollback 保留日志（BUG-03）

```diff
- // 将原日志删除（回退即清除，无需审计日志）
- await tx.foodChangeLogs.delete({ where: { id: logId } });
+ // 标记为已回退（保留审计链）
+ await tx.foodChangeLogs.update({
+   where: { id: logId },
+   data: {
+     action: 'ai_enrichment_rolled_back',
+     metadata: {
+       ...((existingLog.metadata as object) ?? {}),
+       rollbackAt: new Date().toISOString(),
+     },
+   },
+ });
```

#### 1-E clearData 死代码删除（BUG-05）

```diff
- clearData['enrichmentStatus' as any] = null;
```

#### 1-F `enrichFieldsDirect()` 新方法

新增私有方法，用于 `direct_fields` 模式下的字段级一次性补全（详见实现）。

### 变更 2：`food-enrichment.processor.ts`

```diff
  async processJob(job: Job<EnrichmentJobData>) {
+   // direct_fields 模式：强制入队专用，一次性补全指定字段，跳过 staged 流程
+   if (job.data.mode === 'direct_fields' && job.data.fields?.length) {
+     return this.enrichmentService.enrichFieldsDirect(
+       job.data.foodId,
+       job.data.fields,
+     );
+   }
    // 原有分阶段流程
    return this.processFoodsByStage(job);
  }
```

---

## 测试影响

本次变更仅修改 `food-pipeline` 模块，不影响推荐系统测试套件（P3 测试全部通过）。

建议在 `test/` 下补充：
- `food-enrichment-direct.service.spec.ts`：验证 `enrichFieldsDirect` 字段写入行为
- `food-enrichment-rollback.service.spec.ts`：验证 rollback 后 change_log 保留

---

*文档版本：V2.1 | 生成时间：2026-04-15*
