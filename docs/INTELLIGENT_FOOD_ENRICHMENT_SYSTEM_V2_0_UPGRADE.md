# Intelligent Food evrichment System — V2 Upgrade Notes

## Overview

V8.6 专注于食物管理模块和 AI 补全模块的优化，解决两个已知 Bug 并提升补全质量和后台可运营能力。所有改动严格限定在 `food-pipeline` 和 `food-library` 两个模块内。

---

## Bug 修复

### FIX-1：全库补全进度面板数据不更新

**根因**：`useEnrichmentProgress` 的 React Query 缓存在以下操作后从未被主动清除：
- 单条/批量审核通过（`approveStaged` / `batchApproveStaged`）
- 审核拒绝（`rejectStaged`）
- 单条立即补全（`enrichFoodNow`）

**修复位置**：`apps/admin/src/services/foodPipelineService.ts`

**改动内容**：
1. `useApproveStaged.onSuccess`：新增 `invalidateQueries` 清除 `progress`、`completenessDistribution`、`stats` 缓存
2. `useRejectStaged.onSuccess`：新增清除 `progress`、`stats` 缓存
3. `useBatchApproveStaged.onSuccess`：新增清除 `progress`、`completenessDistribution`、`stats` 缓存
4. `useEnrichNow.onSuccess`：新增清除 `progress`、`completenessDistribution` 缓存
5. `useEnrichmentProgress`：`staleTime` 从 60s 降至 15s
6. `useEnrichmentProgress`：新增 `refetchInterval`，当队列有活跃任务时每 15s 自动轮询

---

### FIX-2：补全历史每个食品记录多条

**根因 A**：`getEnrichmentHistory` 的默认 `action` 过滤包含 `ai_enrichment_staged`，导致一次 staged 流程产生两条记录（`ai_enrichment_staged` + `ai_enrichment_approved`）。

**根因 B**：`batchEnrichByStage` 在 orchestrator 中逐阶段调用 `applyEnrichment`，一次批量补全最多产生 5 条 change_log（每阶段一条）。

**修复位置**：
- `apps/api-server/src/food-pipeline/services/food-enrichment.service.ts`
- `apps/api-server/src/food-pipeline/services/food-pipeline-orchestrator.service.ts`

**改动内容**：
1. `getEnrichmentHistory`：历史记录默认过滤移除 `ai_enrichment_staged`，staged 记录在待审核 Tab 展示，历史只展示最终结果（`ai_enrichment`、`ai_enrichment_approved`、`ai_enrichment_rejected`、`ai_enrichment_rollback`、`ai_enrichment_rolled_back`）
2. `batchEnrichByStage`（orchestrator）：改为将所有阶段结果合并后调用一次 `applyEnrichment`，与 `enrichFoodNow` 的 V8.4 逻辑保持一致；同时导入 `EnrichmentResult` 类型

---

## 优化项

### OPT-1：食物库列表排序正确传递服务端

**问题**：ProTable 的 `sorter: true` 列（完整度列）点击排序后，排序参数通过 `sort` 参数传入 `request` 回调，原代码未处理该参数，服务端始终使用默认排序。

**修复位置**：`apps/admin/src/pages/food-library/list/index.tsx`

**改动内容**：`request` 回调改为 `async (params, sort)`，解析 `sort` 对象并转换为后端期望的 `sortBy` / `sortOrder` 参数后传递给 `foodLibraryApi.getList()`。

---

### OPT-2：AI 补全提示词优化

**目标**：提升字段填充率，减少 AI 返回 null 的情况。

**修复位置**：`apps/api-server/src/food-pipeline/services/food-enrichment.service.ts`

**改动内容**：

1. **max_tokens 全面提升**（减少 JSON 截断风险）：
   - Stage 1（核心营养素）：450 → 600
   - Stage 2（微量营养素）：1600 → 1800
   - Stage 3（健康属性）：500 → 650
   - Stage 4（使用属性）：900 → 1000
   - Stage 5（扩展属性）：1000 → 1100

2. **系统提示词（system prompt）强化**：
   - 明确"ALWAYS provide a value — estimation is expected and acceptable"
   - 对数组字段：明确"always return a non-empty array when any value applies"
   - 对数值字段：明确"do NOT return null for common nutrients"

3. **用户提示词（user prompt）强化**：
   - Rule 3 改为："ALWAYS provide an estimated value — do NOT return null unless the field is physically impossible to determine"
   - 新增 Rule 8：对数组字段至少返回一个值
   - 新增 Rule 9：对对象字段（flavor_profile、compatibility、common_portions）始终返回填充对象
   - reasoning 标记从 `"estimated"` 改为 `"[est]"`

---

## 影响范围

| 模块 | 文件 | 类型 |
|------|------|------|
| food-pipeline（后端） | `food-enrichment.service.ts` | Bug Fix + 优化 |
| food-pipeline（后端） | `food-pipeline-orchestrator.service.ts` | Bug Fix |
| food-library（前端） | `foodPipelineService.ts` | Bug Fix + 优化 |
| food-library（前端） | `list/index.tsx` | 优化 |

**未修改范围**：推荐系统、用户画像、决策系统、可解释性系统、订阅/商业化逻辑、数据库 Schema。

---

## 验证要点

1. 审核通过一条 staged 记录后，进度面板（完整度/均值/状态分布）在刷新后立即更新
2. 查看补全历史，同一食物只出现一条汇总记录（不再有 staged+approved 两条）
3. 批量补全（batchEnrichByStage）执行后，change_log 中每个食物只有一条记录
4. 食物库列表点击"完整度"列排序，按实际数据升序/降序展示
5. AI 补全后字段填充率提升（null 字段减少）

---

---

# V8.7 升级说明

## Overview

V8.7 在 V8.6 基础上修复三个残余 Bug，并补全前端缺失功能。所有改动严格限定在 `food-pipeline` 和 `food-library` 两个模块内，未修改数据库 Schema。

---

## Bug 修复

### FIX-3：队列 Processor 补全历史仍多条（V8.6 遗漏路径）

**根因**：V8.6 只修复了 `batchEnrichByStage`（orchestrator 直接调用路径），但队列 Processor（`food-enrichment.processor.ts`）中的 `processFoodsByStage` 仍按阶段逐一调用 `applyEnrichment`/`stageEnrichment`，每阶段写一条 change_log（最多 5 条）。队列是生产环境主执行路径，故历史多条问题依然存在。

**修复位置**：`apps/api-server/src/food-pipeline/food-enrichment.processor.ts`

**改动内容**：
- `processFoodsByStage` 重构：改为先收集所有阶段的 AI 返回数据，全部合并后调用一次 `applyEnrichment`（直接模式）或 `stageEnrichment`（暂存模式），保证每个食物通过队列补全只产生**一条** change_log
- 与 `enrichFoodNow`（V8.4）和 `batchEnrichByStage`（V8.6）逻辑完全统一

---

### FIX-4：待补全数量不减少（补全状态统计永不更新）

**根因**：`getFoodsNeedingEnrichment` 查询的排除条件为 `NOT IN ('enriched', 'staged')`，但 `applyEnrichment` 实际写入的完成状态是 `'completed'`（而非 `'enriched'`）。导致所有 `enrichment_status = 'completed'` 的食物**不被排除**，每次扫描仍计入"需要补全"，待补全数量始终不降。

**修复位置**：`apps/api-server/src/food-pipeline/services/food-enrichment.service.ts`（第 2103 行附近）

**改动内容**：
- 排除条件从 `NOT IN ('enriched', 'staged')` 改为 `NOT IN ('enriched', 'completed', 'staged')`
- 修复后，已补全食物将被正确排除，待补全计数随补全进度实时减少

---

## 新增功能

### FIX-5：前端缺失批量拒绝接口与 Hook

**根因**：后端 `POST /food-pipeline/staged/batch-reject` 已存在，但前端 `foodPipelineService.ts` 中 `enrichmentApi.batchReject` 方法和 `useBatchRejectStaged` Hook 完全缺失。

**修复位置**：`apps/admin/src/services/foodPipelineService.ts`

**改动内容**：
1. 新增 `enrichmentApi.batchReject(ids, reason)` API 方法
2. 新增 `useBatchRejectStaged` Hook，`onSuccess` 包含完整缓存清除：`staged`、`history`、`foodLibrary`、`progress`、`stats`

---

## 优化

### OPT-3：入队成功后补充刷新进度缓存

**修复位置**：`apps/admin/src/services/foodPipelineService.ts`

**改动内容**：
- `useEnqueueStagedBatch.onSuccess` 原本只刷新 `stats`/`jobs`，补充新增 `progress` 和 `completenessDistribution` 缓存清除，确保入队后进度面板同步更新

---

## 影响范围

| 模块 | 文件 | 类型 |
|------|------|------|
| food-pipeline（后端） | `food-enrichment.processor.ts` | Bug Fix |
| food-pipeline（后端） | `food-enrichment.service.ts` | Bug Fix |
| food-library（前端） | `foodPipelineService.ts` | Bug Fix + 新增功能 + 优化 |

**未修改范围**：推荐系统、用户画像、决策系统、可解释性系统、订阅/商业化逻辑、数据库 Schema。

---

## 验证要点

1. 通过队列批量补全后，查看 change_log，每个食物只有**一条**汇总记录
2. 补全 N 条食物后，"待补全数量"减少 N（而非维持不变）
3. 前端批量拒绝按钮（如有）可正常调用，拒绝后 staged 列表、历史、进度面板均刷新
4. 入队操作完成后，进度面板数据自动刷新（不需要手动刷新页面）
