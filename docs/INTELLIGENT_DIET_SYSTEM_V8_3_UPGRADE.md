# V8.3 升级方案 — 食物管理增强 + AI补全模块增强（第三轮迭代）

> 基于 V8.2 架构的版本演进，不新增核心系统，不扩展业务边界
> **严格限制修改范围：仅允许优化「食物管理」和「AI数据补全」两个模块**
> 聚焦：关键Bug修复、enrichment_status 生命周期修正、统计面板数据一致性、性能优化、审核流程补全、代码质量提升

---

## 一、V8.2 遗留问题分析

### 1.1 统计面板异常（仍存在）

| 编号 | 问题                                                        | 根因                                                                                                                                                                                               | 严重度 |
| ---- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| H1   | `/enrichment/stats` 历史统计 failed/staged/rejected 永远为0 | `getEnrichmentHistoricalStats()` 查找 `'ai_enrichment_failed'`/`'ai_enrichment_staged'`/`'ai_enrichment_rejected'`，但实际数据库写入的是 `'failed'(从未写入)`/`'staged'`/无(rejected不更新foods表) | 🔴     |
| H2   | `enriched` 计数也不准                                       | 查找 `'ai_enrichment_approved'` 但 `approveStaged` 实际写入 `'completed'`/`'partial'`/`'pending'`                                                                                                  | 🔴     |

### 1.2 enrichment_status 生命周期缺陷

| 编号 | 问题                                                                                | 影响                                                                                     | 严重度 |
| ---- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------ |
| L1   | `rejectStaged()` 只更新 `food_change_logs.action`，不更新 `foods.enrichment_status` | 食物被拒绝后状态永远停留在 `'staged'`，无法被重新补全或进入其他流程                      | 🔴     |
| L2   | `'failed'` 状态从未被写入数据库                                                     | 补全失败时（`enrichFoodByStage` 全部阶段失败）`enrichment_status` 不更新，导致统计不准确 | 🟡     |
| L3   | Processor worker 模式补全失败时不更新 `enrichment_status`                           | 队列任务失败后食物状态仍为 `'pending'`，无法区分"未补全"和"补全失败"                     | 🟡     |

### 1.3 性能问题

| 编号 | 问题                                                                           | 影响                                                                                                        | 严重度 |
| ---- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | ------ |
| P1   | `update`/`toggleVerified`/`updateStatus`/`remove` 调用 `findOne`               | `findOne` 加载 translations/sources/conflicts/enrichmentMeta（4个额外查询），但这些方法只需检查食物是否存在 | 🟡     |
| P2   | `update` 方法使用两次 `prisma.foods.update`（先保存字段，再更新 completeness） | 可合并为一次 UPDATE                                                                                         | 🟡     |

### 1.4 统计口径不一致

| 编号 | 问题                                                                                       | 影响                                                                    | 严重度 |
| ---- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------ |
| S1   | `getStatistics` 计所有foods，`getStatisticsV81` 只计 `status='active'`                     | 两个端点返回不同的 total/verified 数据                                  | 🟡     |
| S2   | `getStatistics` 冲突用 `resolution='pending'`，`getStatisticsV81` 用 `resolved_at IS NULL` | 冲突计数可能不一致（如 resolution 被设为其他值但 resolved_at 未设置时） | 🟡     |

---

## 二、V8.3 升级方案

### Phase 1：已知Bug修复 + 基础操作优化

#### 1.1 修复 `getEnrichmentHistoricalStats()` 状态键不匹配（H1, H2）

**根因**：V8.2 新增此方法时，状态值使用了 `food_change_logs.action` 的命名风格（`ai_enrichment_*`），但 `foods.enrichment_status` 实际使用的是简短值（`staged`/`completed`/`partial`/`pending`）。

**修复方案**：将状态键改为数据库实际值：

```typescript
// 修复前（错误）
const enriched = (statusMap['completed'] ?? 0) + (statusMap['ai_enrichment_approved'] ?? 0);
const failed = statusMap['ai_enrichment_failed'] ?? 0;
const staged = statusMap['ai_enrichment_staged'] ?? 0;
const rejected = statusMap['ai_enrichment_rejected'] ?? 0;

// 修复后（正确）
const enriched = (statusMap['completed'] ?? 0) + (statusMap['partial'] ?? 0);
const failed = statusMap['failed'] ?? 0;
const staged = statusMap['staged'] ?? 0;
const rejected = statusMap['rejected'] ?? 0;
```

#### 1.2 修复 `rejectStaged()` 未更新 `foods.enrichment_status`（L1）

**修复方案**：拒绝后将 `foods.enrichment_status` 回退为 `'rejected'`：

```typescript
async rejectStaged(logId, reason, operator) {
  // ... 现有逻辑 ...
  await this.prisma.food_change_logs.update({ ... });

  // V8.3: 更新 foods.enrichment_status 为 rejected
  await this.prisma.foods.update({
    where: { id: log.food_id },
    data: { enrichment_status: 'rejected' },
  });
}
```

注：`'rejected'` 是新引入的状态值，需同步修改 `getEnrichmentHistoricalStats` 使其可被统计。

#### 1.3 `enrichFoodNow` 补全全部失败时写入 `'failed'` 状态（L2）

在 `enrichFoodNow` 方法中，当 `totalEnriched === 0 && totalFailed > 0` 时更新状态为 `'failed'`。

#### 1.4 Processor 失败更新状态（L3）

在 `FoodEnrichmentProcessor.onFailed` 中，当任务最终失败（达到最大重试次数）时，更新 `foods.enrichment_status` 为 `'failed'`。

#### 1.5 提取 `findOneSimple` 方法优化性能（P1）

```typescript
// 新增轻量查询方法，仅检查存在性并返回必要字段
private async findOneSimple(id: string) {
  const food = await this.prisma.foods.findUnique({ where: { id } });
  if (!food) throw new NotFoundException('食物不存在');
  return food;
}
```

`update`/`toggleVerified`/`updateStatus`/`remove` 改用 `findOneSimple`。`findOne` 保留给详情端点。

#### 1.6 合并 `update` 方法双重 UPDATE（P2）

将 `data_completeness` 和 `enrichment_status` 合并到第一次 `prisma.foods.update` 中。

#### 1.7 统一 `getStatistics` 与 `getStatisticsV81` 口径（S1, S2）

- `getStatistics` 保持计所有foods（向后兼容）
- `getStatisticsV81` 计 `status='active'`（V8.1设计）
- 统一冲突计数为 `resolved_at IS NULL`

### Phase 2：批量补全增强 + 任务管理 + 结果对比

#### 2.1 批量补全失败重试

现有端点 `POST /enrichment/enqueue` 可以批量入队，但没有专门的"失败重试"端点。新增 `POST /enrichment/retry-failed` 端点，将 `enrichment_status = 'failed'` 的食物重新入队。

#### 2.2 批量补全进度面板增强

`getEnrichmentProgress` 新增 `byStatus` 分布（pending/staged/completed/partial/failed/rejected），与 `getEnrichmentHistoricalStats` 数据一致。

#### 2.3 结果对比（Staged Preview）增强

`getStagedEnrichments` 增加食物当前值的对比数据（`currentValues`），方便前端展示 diff。

### Phase 3：数据质量控制 + 审核机制 + 补全策略优化

#### 3.1 `batchRejectStaged` 修复（继承 L1）

`batchRejectStaged` 调用的是 `rejectStaged`，Phase 1 修复后自动生效。

#### 3.2 AI 提示词关键字段优化

- `reasoning` 字段提示词增加"请说明数据来源依据"
- `confidence` 字段提示词强调"0-1范围，低于0.5请标注不确定字段"

#### 3.3 数据完整度校准端点

新增 `POST /enrichment/recalculate-completeness` 端点，批量重新计算所有食物的 `data_completeness` 和 `enrichment_status`，修复历史数据不一致。

---

## 三、enrichment_status 生命周期（V8.3 修正后）

```
foods 创建 → pending
       ↓
  AI 补全入队
       ↓
  补全成功 → completeness >= 80 → completed
           → completeness >= 30 → partial
           → completeness <  30 → pending
       ↓
  补全全部失败 → failed
       ↓
  staged 模式 → staged
       ↓
  审核通过 → completed / partial / pending
  审核拒绝 → rejected
```

**V8.3 新增的状态值**：`'rejected'`（拒绝暂存）、`'failed'`（补全失败，首次实际写入）

---

## 四、影响范围

| 文件                                 | 修改类型            | Phase |
| ------------------------------------ | ------------------- | ----- |
| `food-enrichment.service.ts`         | Bug修复 + 新增端点  | 1-3   |
| `food-enrichment.controller.ts`      | 新增端点            | 2-3   |
| `food-enrichment.processor.ts`       | 失败状态更新        | 1     |
| `food-library-management.service.ts` | 性能优化 + 统计修复 | 1     |

---

## 五、修改清单

### Phase 1（已知问题修复）

- [x] H1/H2: `getEnrichmentHistoricalStats` 状态键修正
- [x] L1: `rejectStaged` 更新 `foods.enrichment_status`
- [x] L2: `enrichFoodNow` 全部失败时写入 `'failed'`
- [x] L3: Processor `onFailed` 更新 `foods.enrichment_status`
- [x] P1: 提取 `findOneSimple` 优化性能
- [x] P2: 合并 `update` 双重UPDATE
- [x] S1/S2: 统一统计口径

### Phase 2（批量补全 + 任务管理）

- [x] 新增 `retry-failed` 端点
- [x] `getEnrichmentProgress` 增加 `byStatus` 分布
- [x] `getStagedEnrichments` 增加当前值对比

### Phase 3（数据质量 + 策略优化）

- [x] AI提示词优化（reasoning 增加数据来源要求，confidence 增加低置信度标注要求）
- [x] 新增 `recalculate-completeness` 端点（批量重算全库 data_completeness 和 enrichment_status）
- [x] 编译验证通过

---

## 六、V8.3 新增 API 端点汇总

| 方法 | 路径                                   | 说明                                                                                       | Phase |
| ---- | -------------------------------------- | ------------------------------------------------------------------------------------------ | ----- |
| POST | `/enrichment/retry-failed`             | 增强：支持 `source` 参数（`queue`/`database`/`both`），从数据库 `failed`/`rejected` 重入队 | 2     |
| POST | `/enrichment/recalculate-completeness` | 批量重算全库完整度和状态，支持 `batchSize` 参数                                            | 3     |

### retry-failed 增强参数

```json
{
  "limit": 50,
  "foodId": "uuid（可选，指定食物）",
  "fields": "protein,fat（可选，筛选字段）",
  "source": "queue | database | both（默认 both）"
}
```

### recalculate-completeness 参数

```json
{
  "batchSize": 200
}
```

返回：

```json
{
  "total": 1000,
  "updated": 150,
  "errors": 0,
  "statusChanges": {
    "pending→partial": 80,
    "pending→completed": 30,
    "partial→completed": 40
  }
}
```

---

## 七、V8.3 Service 新增方法汇总

| 方法                                      | 说明                                   | Phase |
| ----------------------------------------- | -------------------------------------- | ----- |
| `markEnrichmentFailed(foodId, errorMsg?)` | 将食物标记为 `failed` 状态             | 1     |
| `getFailedFoods(limit, foodId?)`          | 查询 `failed`/`rejected` 食物列表      | 2     |
| `resetEnrichmentStatus(foodId)`           | 重置状态为 `pending`（重入队前）       | 2     |
| `recalculateCompleteness(batchSize?)`     | 批量重算全库完整度和状态               | 3     |
| `findOneSimple(id)`                       | 轻量查询（食物管理模块，替代 findOne） | 1     |

---

## 八、AI 提示词优化详情（Phase 3）

`buildStagePrompt` 方法的"要求"部分增强：

```
要求：
1. 数值基于每100g计算
2. 无法确定的字段返回 null
3. 只返回请求的字段，不要多余字段
4. 对每个字段单独评估置信度，在 "field_confidence" 中返回（0.0-1.0）
5. confidence 为整体置信度（0.0-1.0），若低于0.5请在 reasoning 中逐一标注不确定的字段及原因
6. reasoning 请说明数据来源依据，例如：参考《中国食物成分表》、USDA数据库、类似食物推算、烹饪经验推测等；若为推测值请明确标注
```

**优化目的**：

- 提高 `reasoning` 字段的可追溯性 — 管理员可判断AI估算是否有依据
- 提高 `confidence` 字段的实用性 — 低置信度数据可优先人工复核

---

## 九、总结

V8.3 共完成 3 个 Phase，全部通过编译验证：

- **Phase 1**：修复 5 个已知Bug（2个严重、3个中等），优化 2 个性能问题，统一 1 对统计口径
- **Phase 2**：增强批量重试（数据库+队列双源），增加状态分布统计，增加审核对比数据
- **Phase 3**：优化AI提示词质量，新增完整度校准工具

修改文件 4 个，新增 Service 方法 5 个，新增/增强 API 端点 2 个，未新增数据库字段。
