# V8.1 升级方案 — 食物管理增强 + AI补全模块增强

> 基于 V8.0 架构的版本演进，不新增核心系统，不扩展业务边界
> **严格限制修改范围：仅允许优化「食物管理」和「AI数据补全」两个模块**
> 聚焦：数据完整性、AI补全可控性、后台可运营能力、API能力完整性、补全字段完善、数据流转与状态更新

---

## 一、现有能力分析（Step 1）— 仅限食物管理 + AI补全

### 1.1 食物管理模块现有能力

| 能力                  | 状态 | 说明                                                     |
| --------------------- | ---- | -------------------------------------------------------- |
| 食物 CRUD             | ✅   | 创建/读取/更新/删除，含唯一名称和编码校验                |
| 批量导入              | ✅   | 按编码去重，含错误收集                                   |
| 多维筛选              | ✅   | 关键词/分类/状态/验证/来源/完整度/补全状态               |
| 生命周期管理          | ✅   | draft→active→archived→merged 状态流转                    |
| 验证工作流            | ✅   | toggle is_verified，含操作者追踪                         |
| 多语言翻译管理        | ✅   | 按 locale 的 CRUD                                        |
| 多来源数据溯源        | ✅   | food_sources 优先级排序                                  |
| 数据冲突检测与解决    | ✅   | food_conflicts 含操作者审计                              |
| 完整变更日志          | ✅   | 每次操作记录 version/diff/operator/reason                |
| 完整度评分            | ✅   | V8.0 加权评分（核心35%+微量25%+健康15%+使用15%+扩展10%） |
| 字段级来源/置信度追踪 | ✅   | field_sources + field_confidence JSON                    |
| 审核状态              | 🟡   | review_status 字段已存在但能力不完整                     |
| 缺失字段筛选          | 🟡   | missingField 查询参数已支持单字段，但无多字段组合        |

### 1.2 AI补全模块现有能力

| 能力            | 状态 | 说明                                              |
| --------------- | ---- | ------------------------------------------------- |
| 5阶段分阶段补全 | ✅   | 核心营养→微量营养→健康属性→使用属性→扩展属性      |
| 64个可补全字段  | ✅   | 覆盖营养素、属性、评分、描述、烹饪等              |
| 暂存审核工作流  | ✅   | staged→preview→approve/reject，含字段级选择性入库 |
| 批量暂存审核    | ✅   | batch-approve，按 ID 列表批量通过                 |
| 回滚机制        | ✅   | 单条/批量回滚已入库的补全数据                     |
| 单条立即补全    | ✅   | enrichFoodNow 同步执行，支持指定阶段/字段         |
| 分阶段批量入队  | ✅   | enqueue-staged 按阶段批量入队 BullMQ              |
| 预览对比        | ✅   | 暂存预览含 diff + 同类平均值参考                  |
| Fallback 降级   | ✅   | 阶段1/2 AI失败时使用同类均值（置信度0.45）        |
| 交叉验证        | ✅   | 宏量营养素一致性校验，权威来源自动修正            |
| IQR 异常检测    | ✅   | 同类食物 IQR 方法检测离群值                       |
| 完整度分布统计  | ✅   | 全库完整度分布（low/mid/high）                    |
| 补全进度追踪    | ✅   | 全库补全进度/字段缺失统计                         |
| 失败重试        | ✅   | retry-failed 批量重试失败的队列任务               |
| 死信队列        | ✅   | 永久失败任务存储到 dead_letter                    |

### 1.3 当前问题（仅限这两个模块）

#### 🔴 数据完整性问题

| 编号 | 问题                                                                           | 影响                                    |
| ---- | ------------------------------------------------------------------------------ | --------------------------------------- |
| D1   | **缺失字段无分级管理** — 只有总完整度评分，无法按字段组/单字段维度查看缺失情况 | 运营无法精准定位数据短板                |
| D2   | **多字段缺失组合筛选缺失** — missingField 仅支持单字段筛选                     | 无法找出"同时缺少 protein 和 fat"的食物 |
| D3   | **数据排序能力不足** — 不支持按完整度/置信度排序                               | 无法优先处理数据质量最差的食物          |

#### 🟡 AI补全可控性问题

| 编号 | 问题                                                                            | 影响                                 |
| ---- | ------------------------------------------------------------------------------- | ------------------------------------ |
| A1   | **补全粒度不够细** — 虽支持指定阶段，但不支持从后台按"单个字段"触发补全         | 只想补全 GI 值却要跑整个阶段3        |
| A2   | **批量补全缺少过滤条件** — enqueue-staged 只能按完整度上限和阶段筛选            | 无法"只补全某分类下缺失蛋白质的食物" |
| A3   | **补全任务缺乏全局视图** — 无法在一个接口获取"当前有多少任务在执行、排队、失败" | 运营缺乏全局掌控感                   |
| A4   | **补全失败字段无标记** — 失败信息只在日志中，不在食物记录上                     | 无法筛选"哪些字段补全失败了"         |

#### 🟢 后台可运营能力问题

| 编号 | 问题                                                                              | 影响                               |
| ---- | --------------------------------------------------------------------------------- | ---------------------------------- |
| O1   | **审核流程不完整** — review_status 字段存在但缺少审核历史/审核者/审核时间         | 无法追溯谁在什么时候审核了         |
| O2   | **统计API分散** — statistics 和 statisticsV81 两个端点，且未暴露在控制器上        | 前端无法获取增强统计               |
| O3   | **字段级数据来源可视化不足** — field_sources/field_confidence 存在但无专门查询API | 后台无法展示每个字段的来源和可信度 |

### 1.4 API能力不足点

| 操作                         | 现有API | 缺失能力                                     |
| ---------------------------- | ------- | -------------------------------------------- |
| 按完整度排序食物列表         | ❌      | findAll 不支持 sortBy 参数                   |
| 多字段缺失组合筛选           | ❌      | 仅支持单个 missingField                      |
| 查看单食物字段级来源/置信度  | 🟡      | findOne 返回了数据但无结构化展示             |
| 获取增强统计(V8.1)           | ❌      | getStatisticsV81 方法存在但未暴露端点        |
| 批量更新审核状态             | 🟡      | batchUpdateReviewStatus 方法存在但未暴露端点 |
| 按分类+缺失字段组合批量入队  | ❌      | enqueue-staged 无分类筛选                    |
| 获取补全任务全局视图         | 🟡      | stats 端点有但信息不够全面                   |
| 查看字段级补全失败记录       | ❌      | 失败信息仅在日志中                           |
| 获取食物的完整补全历史时间线 | 🟡      | history 端点有但缺乏时间线聚合               |

---

## 二、食物管理增强设计（Step 2）

> 在不新增新系统的前提下，仅在现有 food 数据结构上做轻量增强

### 2.1 数据完整度管理增强

**目标：** 标记缺失字段，支持按缺失程度排序

**方案：**

1. **findAll 增强排序能力** — 新增 `sortBy` 和 `sortOrder` 参数
   - 支持按 `data_completeness`、`confidence`、`created_at`、`updated_at` 排序
   - 默认保持 `search_weight DESC, created_at DESC`

2. **多字段缺失组合筛选** — 新增 `missingFields`（复数）参数
   - 接受逗号分隔的字段名列表，如 `missingFields=protein,fat,carbs`
   - SQL 层生成 `f.protein IS NULL AND f.fat IS NULL AND f.carbs IS NULL`

3. **字段完整度详情API** — 增强 findOne 返回
   - 在 findOne 返回中新增 `fieldCompleteness` 对象：标记每个可补全字段的填充状态
   - 格式：`{ fieldName: { filled: boolean, source: string|null, confidence: number|null } }`

### 2.2 数据质量控制

**目标：** 标记AI生成数据、支持人工修正、支持标记审核状态

**方案：**

1. **审核状态增强** — 补充审核元数据字段
   - 数据库新增：`reviewed_by`（审核者）、`reviewed_at`（审核时间）
   - 审核状态流转：`pending` → `approved` / `rejected`
   - 审核操作写入 change_logs 审计

2. **暴露已有能力** — 将已实现但未暴露的方法加入控制器
   - `POST /admin/food-library/batch-review` → `batchUpdateReviewStatus`
   - `GET /admin/food-library/statistics-v81` → `getStatisticsV81`

3. **人工修正标记** — update 时自动标记 `field_sources[fieldName] = 'manual'`
   - 已在 V8.0 实现，确认逻辑正确

### 2.3 数据可视化支持

**目标：** 字段完整情况、数据来源、置信度的结构化展示

**方案：**

1. **字段完整度摘要** — findOne 增强返回 `enrichmentMeta`

   ```
   {
     completeness: { score, groups: { core, micro, health, usage, extended } },
     fieldDetails: [
       { field, label, unit, filled, value, source, confidence, validRange }
     ],
     missingFields: string[],
     enrichmentHistory: { lastEnrichedAt, totalEnrichments, lastAction }
   }
   ```

2. **列表级快速指标** — findAll 已返回 `data_completeness`、`enrichment_status`、`field_sources`、`field_confidence`、`review_status`
   - 无需额外修改，前端可直接使用

---

## 三、AI补全模块增强设计（Step 3）

### 3.1 补全方式优化 — 按字段分阶段补全

**目标：** 从"一次补全全部字段" → "按字段分阶段补全"，支持指定字段补全

**方案：**

1. **enrichFoodNow 增强** — 已支持 `fields` 参数但未完全实现字段级过滤
   - 当指定 `fields` 时，自动推断所需阶段，仅补全指定字段
   - 补全 Prompt 中仅请求指定字段，减少 Token 消耗
   - 补全结果中仅保留指定字段的数据

2. **字段级补全入队** — enqueue-staged 增强
   - 新增 `category` 筛选参数：只入队指定分类的食物
   - 新增 `missingFields` 筛选参数：只入队缺少指定字段的食物
   - 新增 `primarySource` 筛选参数：只入队指定来源的食物

### 3.2 补全流程可控

**目标：** 后台支持手动触发、批量补全、查看执行状态

**方案：**

1. **手动触发单条补全** — 已有 `enrichFoodNow` 端点，增强参数
   - 增加 `forceOverwrite` 参数：是否覆盖已有字段（默认 false）
   - 增加 `onlyMissing` 参数：仅补全缺失字段（默认 true）

2. **批量补全增强** — enqueue-staged 增强条件筛选
   - 复用现有 BullMQ 队列机制
   - 增强筛选条件（分类 + 缺失字段 + 来源 + 完整度范围）

3. **补全任务全局视图** — 新增 `GET /task-overview` 端点
   - 聚合：活跃任务数、等待中任务数、已完成任务数、失败任务数
   - 包含：最近失败原因、平均处理时间、队列深度

### 3.3 补全结果可视化

**目标：** 原始数据 vs AI补全数据对比，标记新增/修改字段，字段级别补全结果

**方案：**

1. **预览端点增强** — `getEnrichmentPreview` 已有完善的 diff 实现
   - 增强 diff 返回：标记 `isNew`（原值为空→AI填入）和 `isModified`（原值存在但被修改）
   - 增加 `confidenceLevel` 标记：high(≥0.8) / medium(0.6-0.8) / low(<0.6)

2. **批量预览增强** — `batchPreviewStaged` 已有实现
   - 增强 summary：新增字段数统计、修改字段数统计、平均置信度

### 3.4 入库控制

**目标：** 不自动覆盖已有字段、支持人工审核后入库、支持选择性入库

**方案：**

1. **不自动覆盖** — 已有核心约束（第1条：只补全 null/undefined/空数组字段）
   - 确认现有逻辑正确，无需修改

2. **人工审核后入库** — 已有 staged→approve 流程
   - 增强：approve 时记录审核者和审核时间

3. **选择性入库** — 已有 `selectedFields` 参数
   - 增强：返回每个字段的入库结果（成功/跳过/失败）

### 3.5 失败处理机制

**目标：** 标记补全失败字段，支持失败重试

**方案：**

1. **失败字段持久化** — 在 food 记录上标记失败信息
   - 利用已有 `field_sources` JSON：失败字段标记为 `'ai_failed'`
   - 新增查询筛选：`failedField` 参数，按 `field_sources` 中含 `'ai_failed'` 的字段筛选

2. **精细重试** — 增强 retry-failed
   - 支持指定 foodId 重试
   - 支持指定字段重试
   - 重试时自动清除 `'ai_failed'` 标记

---

## 四、流程优化设计（Step 4）— 仅限这两个模块

### 4.1 场景1：批量补全流程

```
┌──────────────────────────────────────────────────────────────────┐
│  ① 筛选缺失数据                                                 │
│     GET /admin/food-library?missingFields=protein,fat            │
│     &maxCompleteness=50&category=grain                           │
├──────────────────────────────────────────────────────────────────┤
│  ② 创建补全任务                                                 │
│     POST /admin/food-pipeline/enrichment/enqueue-staged          │
│     body: { stages:[1,2], category:"grain",                      │
│            missingFields:["protein","fat"], limit:100 }          │
├──────────────────────────────────────────────────────────────────┤
│  ③ 查看执行状态                                                 │
│     GET /admin/food-pipeline/enrichment/task-overview             │
│     GET /admin/food-pipeline/enrichment/progress                 │
├──────────────────────────────────────────────────────────────────┤
│  ④ 查看结果对比                                                 │
│     GET /admin/food-pipeline/enrichment/staged                   │
│     GET /admin/food-pipeline/enrichment/staged/:id/preview       │
│     （diff 含 置信度 + 同类均值参考 + isNew/isModified 标记）     │
├──────────────────────────────────────────────────────────────────┤
│  ⑤ 审核（有可信度参考）                                         │
│     POST /admin/food-pipeline/enrichment/staged/:id/approve      │
│     body: { selectedFields: ["protein","fat"] }                  │
│     （置信度 ≥0.7 自动入库，<0.7 需人工确认）                     │
├──────────────────────────────────────────────────────────────────┤
│  ⑥ 入库                                                         │
│     approve 成功 → 自动更新 foods 表                              │
│     更新 field_sources / field_confidence / data_completeness     │
│     写入 food_change_logs 审计日志                                │
└──────────────────────────────────────────────────────────────────┘
```

### 4.2 场景2：人工修正流程

```
┌──────────────────────────────────────────────────────────────────┐
│  ① 查看食物                                                     │
│     GET /admin/food-library/:id                                  │
│     → 返回含 enrichmentMeta（字段级来源/置信度/完整度）           │
├──────────────────────────────────────────────────────────────────┤
│  ② 编辑字段                                                     │
│     PUT /admin/food-library/:id                                  │
│     body: { protein: 8.5, fat: 1.2 }                             │
│     → 自动标记 field_sources.protein = 'manual'                  │
│     → 自动设置 field_confidence.protein = 1.0                    │
│     → 自动重算 data_completeness                                 │
├──────────────────────────────────────────────────────────────────┤
│  ③ 标记为已审核                                                 │
│     POST /admin/food-library/batch-review                        │
│     body: { ids: ["xxx"], reviewStatus: "approved" }             │
│     → 更新 review_status / reviewed_by / reviewed_at             │
│     → 写入 food_change_logs                                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## 五、API能力设计（Step 5）— 最小必要API集合

### 5.1 食物管理 API 能力

| 能力分组     | 操作                | 复用现有API     | 必须新增    | 说明                             |
| ------------ | ------------------- | --------------- | ----------- | -------------------------------- |
| **列表查询** | 多维筛选            | ✅ findAll      | —           | 已支持 13 个筛选参数             |
|              | 多字段缺失组合筛选  | 🔧 增强 findAll | —           | 新增 missingFields 复数参数      |
|              | 按完整度/置信度排序 | 🔧 增强 findAll | —           | 新增 sortBy + sortOrder 参数     |
| **详情查询** | 食物详情+字段元数据 | 🔧 增强 findOne | —           | 返回增加 enrichmentMeta          |
| **数据修改** | CRUD                | ✅ 完整         | —           | 已有                             |
|              | 批量导入            | ✅ batchImport  | —           | 已有                             |
| **审核管理** | 批量更新审核状态    | —               | ✅ 新增端点 | 暴露已有 batchUpdateReviewStatus |
| **统计信息** | 增强统计            | —               | ✅ 新增端点 | 暴露已有 getStatisticsV81        |

### 5.2 AI补全任务 API 能力

| 能力分组     | 操作            | 复用现有API                    | 必须新增              | 说明                             |
| ------------ | --------------- | ------------------------------ | --------------------- | -------------------------------- |
| **任务触发** | 单条立即补全    | ✅ enrichFoodNow               | —                     | 已有，增强字段级过滤             |
|              | 分阶段批量入队  | 🔧 增强 enqueue-staged         | —                     | 新增 category/missingFields 筛选 |
| **任务管理** | 查看队列任务    | ✅ getJobs                     | —                     | 已有                             |
|              | 全局任务视图    | —                              | ✅ 新增 task-overview | 聚合队列状态概览                 |
|              | 清理任务        | ✅ clean                       | —                     | 已有                             |
| **审核流程** | 暂存列表        | ✅ getStaged                   | —                     | 已有                             |
|              | 暂存预览        | ✅ previewStaged               | —                     | 增强 diff 标记                   |
|              | 审核通过/拒绝   | ✅ approve/reject              | —                     | 增强审核者记录                   |
|              | 批量审核        | ✅ batchApprove                | —                     | 已有                             |
|              | 批量预览        | ✅ batchPreviewStaged          | —                     | 已有                             |
| **回滚**     | 单条/批量回滚   | ✅ rollback                    | —                     | 已有                             |
| **失败处理** | 批量重试        | ✅ retryFailed                 | —                     | 已有                             |
|              | 按食物/字段重试 | 🔧 增强 retryFailed            | —                     | 新增 foodId/fields 参数          |
| **统计监控** | 补全进度        | ✅ getProgress                 | —                     | 已有                             |
|              | 完整度分布      | ✅ getCompletenessDistribution | —                     | 已有                             |
|              | 操作统计        | ✅ getOperationsStats          | —                     | 已有                             |
|              | 补全历史        | ✅ getHistory                  | —                     | 已有                             |

### 5.3 API能力总结

- **完全复用（无需修改）：** 16 个 API
- **增强现有（功能扩展）：** 5 个 API（findAll, findOne, enqueue-staged, enrichFoodNow, retryFailed）
- **必须新增：** 3 个 API（batch-review, statistics-v81, task-overview）

---

## 六、数据结构增强（Step 6）

### 6.1 foods 表新增辅助字段

| 字段            | 类型         | 默认值 | 说明                                                                        |
| --------------- | ------------ | ------ | --------------------------------------------------------------------------- |
| `reviewed_by`   | VARCHAR(100) | NULL   | 最近审核者用户名                                                            |
| `reviewed_at`   | TIMESTAMPTZ  | NULL   | 最近审核时间                                                                |
| `failed_fields` | JSONB        | '{}'   | 补全失败的字段记录 `{"protein": {"reason":"AI返回null","at":"2026-04-13"}}` |

### 6.2 已有字段复用（不修改）

| 字段                | 已有            | 用途                                                              |
| ------------------- | --------------- | ----------------------------------------------------------------- |
| `field_sources`     | ✅ JSONB        | 字段级来源标记：`manual` / `ai_enrichment` / `usda` / `ai_failed` |
| `field_confidence`  | ✅ JSONB        | 字段级置信度 0-1                                                  |
| `data_completeness` | ✅ INTEGER      | 加权完整度 0-100                                                  |
| `enrichment_status` | ✅ VARCHAR(20)  | pending/partial/completed/failed                                  |
| `review_status`     | ✅ VARCHAR(20)  | pending/approved/rejected                                         |
| `last_enriched_at`  | ✅ TIMESTAMPTZ  | 最近补全时间                                                      |
| `confidence`        | ✅ DECIMAL(3,2) | 整体置信度                                                        |
| `is_verified`       | ✅ BOOLEAN      | 是否已验证                                                        |
| `data_version`      | ✅ INTEGER      | 数据版本号                                                        |

### 6.3 不允许的修改

- ❌ 不修改核心营养素字段结构
- ❌ 不修改主键/索引策略
- ❌ 不修改关联关系
- ❌ 不新增新表

---

## 七、分阶段实现路线图（Step 7）

### Phase 1：基础增强（缺失字段识别 + 单条补全 + 基础操作可用）

| 编号 | 任务                                                                        | 优先级 | 文件                                  | 预估影响 |
| ---- | --------------------------------------------------------------------------- | ------ | ------------------------------------- | -------- |
| P1-1 | 数据库迁移：新增 reviewed_by / reviewed_at / failed_fields 字段             | 高     | schema.prisma + migration SQL         | +20 行   |
| P1-2 | DTO增强：findAll 新增 missingFields / sortBy / sortOrder / failedField 参数 | 高     | food-library-management.dto.ts        | +30 行   |
| P1-3 | Service增强：findAll 支持多字段缺失筛选 + 排序 + 失败字段筛选               | 高     | food-library-management.service.ts    | +40 行   |
| P1-4 | Service增强：findOne 返回 enrichmentMeta（字段级完整度详情）                | 高     | food-library-management.service.ts    | +80 行   |
| P1-5 | Controller增强：暴露 batch-review + statistics-v81 端点                     | 高     | food-library-management.controller.ts | +40 行   |
| P1-6 | Service增强：batchUpdateReviewStatus 写入 reviewed_by / reviewed_at         | 中     | food-library-management.service.ts    | +10 行   |
| P1-7 | 编译验证                                                                    | 高     | —                                     | 0        |

### Phase 2：补全能力增强（批量补全 + 任务管理 + 结果对比）

| 编号 | 任务                                                                                  | 优先级 | 文件                          | 预估影响 |
| ---- | ------------------------------------------------------------------------------------- | ------ | ----------------------------- | -------- |
| P2-1 | Controller增强：enqueue-staged 新增 category / missingFields / primarySource 筛选参数 | 高     | food-enrichment.controller.ts | +40 行   |
| P2-2 | Service增强：getFoodsNeedingEnrichment 支持分类和来源筛选                             | 高     | food-enrichment.service.ts    | +30 行   |
| P2-3 | Controller新增：GET /task-overview 全局任务视图端点                                   | 高     | food-enrichment.controller.ts | +50 行   |
| P2-4 | Service增强：预览 diff 增加 isNew / isModified / confidenceLevel 标记                 | 中     | food-enrichment.service.ts    | +20 行   |
| P2-5 | Service增强：失败字段持久化到 failed_fields 和 field_sources                          | 中     | food-enrichment.service.ts    | +30 行   |
| P2-6 | Controller增强：retryFailed 支持 foodId / fields 参数精细重试                         | 中     | food-enrichment.controller.ts | +30 行   |
| P2-7 | 编译验证                                                                              | 高     | —                             | 0        |

### Phase 3：运营能力增强（数据质量控制 + 审核机制 + 补全策略优化）

| 编号 | 任务                                                                              | 优先级 | 文件                          | 预估影响    |
| ---- | --------------------------------------------------------------------------------- | ------ | ----------------------------- | ----------- |
| P3-1 | Service增强：approveStaged 增强审核者追踪，关联更新 foods.reviewed_by/reviewed_at | 中     | food-enrichment.service.ts    | +15 行      |
| P3-2 | Service增强：enrichFoodNow 字段级过滤完善（Prompt 仅请求指定字段）                | 中     | food-enrichment.service.ts    | +40 行      |
| P3-3 | Service增强：补全结果聚合统计（每阶段成功率、平均置信度、失败率趋势）             | 低     | food-enrichment.service.ts    | +60 行      |
| P3-4 | 修复：getEnrichmentPreview 中 name_zh 取值错误                                    | 高     | food-enrichment.service.ts    | 修改 1 行   |
| P3-5 | 修复：controller SQL注入风险（enqueue 中 locale/region 字符串插值）               | 高     | food-enrichment.controller.ts | 修改 ~20 行 |
| P3-6 | 编译验证                                                                          | 高     | —                             | 0           |

---

## 八、防跑偏声明（必须遵守）

本次升级**严格限制**在以下模块内：

- ✅ 食物管理模块：`apps/api-server/src/modules/food/admin/`
- ✅ AI补全模块：`apps/api-server/src/food-pipeline/`

以下模块一律不修改：

- ❌ 推荐系统
- ❌ 用户画像系统
- ❌ 决策系统
- ❌ 可解释性系统
- ❌ 订阅/商业化逻辑
- ❌ 其它后台模块

---

## 九、实现记录

> 本节在实现过程中逐步补充
