# V8.4 升级方案 — 食物管理 + AI补全深度增强

> **版本**：V8.4  
> **前序版本**：V8.3（Bug修复 + 基础增强）  
> **严格限制**：仅修改「食物管理」和「AI数据补全」两个模块  
> **核心目标**：统计数据准确、补全可控可视化、字段全覆盖、后台可运营

---

## 一、现状诊断（基于代码精确分析）

### 1.1 统计面板问题

| 编号 | 问题                                                                                                                                                       | 根因                                                                                                 | API                         |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------- |
| S1   | `/enrichment/stats` 历史数据基本准确（V8.3已修复状态键），但 `avgCompleteness` 包含大量 data_completeness=0 的食物拉低均值，不能反映"已补全食物"的真实水平 | `AVG(COALESCE(data_completeness,0))` 将未补全食物的0值计入均值                                       | enrichment/stats            |
| S2   | `/enrichment/progress` 全库补全进度面板为空                                                                                                                | 返回结构中 `byStatus` 已实现，但前端调的是 `/progress` 而非 `/stats`，两个端点各自独立，没有聚合视图 | enrichment/progress         |
| S3   | `/food-library/statistics` 计全部 foods（含 draft/deleted），数据虚高                                                                                      | `getStatistics()` COUNT 无 WHERE 过滤                                                                | food-library/statistics     |
| S4   | `/food-library/statistics-v81` 只计 `status='active'`，与主统计口径不一致，前端不知道该用哪个                                                              | 两个端点并存，设计混乱                                                                               | food-library/statistics-v81 |
| S5   | 两个统计端点都没有补全状态分布（enrichment_status），无法在食物库面板看到补全全貌                                                                          | getStatistics 未查询 enrichment_status                                                               | -                           |

### 1.2 队列管理问题

| 编号 | 问题                                                                   | 影响                     |
| ---- | ---------------------------------------------------------------------- | ------------------------ |
| Q1   | `POST /enrichment/clean` 只能按 type（completed/failed）清理，无法全清 | 卡队列时无法一键清除     |
| Q2   | 无法查看队列中具体任务列表（只有计数）                                 | 无法判断哪些食物在队列中 |
| Q3   | 无法取消特定 foodId 的待执行任务                                       | 错误入队后无法撤销       |
| Q4   | 队列 `drain`（清空等待中任务）功能缺失                                 | 批量误操作无法快速止损   |

### 1.3 补全字段覆盖问题

| 编号 | 问题                                                                                                              | 影响                            |
| ---- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| F1   | 现有 ENRICHABLE_FIELDS 共 45 个字段，但 `name`/`code`/`status`/`category` 等基础字段不在补全范围                  | 新增食物基础字段空缺            |
| F2   | `aliases` 字段不在 AI 补全范围（ENRICHABLE_FIELDS 无 aliases），但这是搜索命中的关键字段                          | 别名缺失导致搜索召回差          |
| F3   | `foodForm`（ingredient/dish/semi_prepared）字段虽在 ENRICHABLE_FIELDS，但 Stage 分配在 Stage5（最后），优先级太低 | 成品菜/原材料分类滞后           |
| F4   | 补全 Prompt 中字段说明缺乏中文食物的本土化背景                                                                    | AI 对中国食物特有属性推断精度低 |
| F5   | `buildStagePrompt` 中食物上下文信息传入不完整（缺少已知的别名/来源数据）                                          | AI 推断精度低                   |

### 1.4 数据流转问题

| 编号 | 问题                                                                    | 影响                                             |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------ |
| D1   | `getStatistics()` 和 `getStatisticsV81()` 并存，前者无补全/审核分布     | 前端无法从食物库面板看到完整数据概况             |
| D2   | `missingFields` 计算在 `enqueueBatch` 时即时执行，不持久化              | 每次必须重新计算，无法直接查询"缺什么字段的食物" |
| D3   | 补全失败的字段记录在 `failedFields` JSON 中，但无端点支持按失败字段筛选 | 无法批量修复特定字段的失败                       |

### 1.5 已知冗余

| 编号 | 冗余内容                                                                                 | 建议                                    |
| ---- | ---------------------------------------------------------------------------------------- | --------------------------------------- |
| R1   | `getStatistics()` 和 `getStatisticsV81()` 功能重叠，V81版本更完整                        | 合并为单一统计端点，V81为主，兼容旧字段 |
| R2   | `analysis-record-management.service.ts` LIMIT/OFFSET 参数索引Bug（V8.3文档记录但未修复） | Phase1修复                              |
| R3   | `analysis-record-management.service.ts` raw SQL 结果 camelCase 访问 snake_case 列        | Phase1修复                              |
| R4   | `food-conflict-resolver.service.ts` `sources` 数组重复字段 Bug                           | Phase1修复                              |

---

## 二、V8.4 优化方案

### 优化原则

1. **不新增数据库字段**（schema已足够，充分利用 `failedFields`/`fieldSources`/`fieldConfidence` 等已有 JSON 字段）
2. **不修改其他模块**（推荐/决策/用户画像等一律不动）
3. **向后兼容**（旧 API 路径继续有效，合并统计时保留旧字段名）
4. **优先修 Bug，再扩能力**

---

## 三、Phase 1：统计修复 + Bug修复 + 队列增强

### 3.1 统计数据修复

#### 3.1.1 `getStatistics()` 合并增强（解决 S3/S4/S5）

**修改方案**：`getStatistics()` 增加以下内容，同时废弃 `getStatisticsV81()` 的独立端点（路由保留但调用同一方法）：

```
新增字段：
- byEnrichmentStatus: { pending, partial, completed, failed, staged, rejected }
- completenessDistribution: { low(<30), mid(30-79), high(>=80) }
- reviewStatusCounts: { pending, approved, rejected }
- byStatus: 包含 draft/active/archived 分布（原 getStatistics 已有）

口径统一：
- total: 全部 foods（含 draft），前端可根据 byStatus 自行计算 active 数
- avgCompleteness: 只对 data_completeness > 0 的食物计均值（排除从未补全的）
- activeCount: 单独字段，不替换 total（向后兼容）
```

#### 3.1.2 `getEnrichmentHistoricalStats()` avgCompleteness 修复（解决 S1）

```sql
-- 修复前（将 0 值纳入平均，大量未补全食物拉低数值）
SELECT AVG(COALESCE(data_completeness, 0)) FROM foods

-- 修复后（只统计已有补全数据的食物）
SELECT AVG(data_completeness) FROM foods WHERE data_completeness > 0
-- 同时新增 totalWithData 字段说明样本数
```

### 3.2 队列管理增强（解决 Q1-Q4）

新增 `POST /enrichment/drain` 端点：清空队列中所有等待中（waiting）的任务，不影响正在执行（active）的任务。

增强 `POST /enrichment/clean` 端点：支持 `type: 'all'`，同时清理 completed + failed。

### 3.3 Bug 修复

修复 `analysis-record-management.service.ts`：

- LIMIT/OFFSET 参数索引（R2）
- raw SQL camelCase 访问 snake_case（R3）

修复 `food-conflict-resolver.service.ts` sources 数组重复字段（R4）。

---

## 四、Phase 2：补全字段完善 + 任务管理增强

### 4.1 补全字段扩展（解决 F1/F2/F3）

#### 新增 `aliases` 到补全字段

`aliases` 是搜索命中的关键字段，当前不在 `ENRICHABLE_FIELDS` 中。将其加入 Stage 4（使用属性）。

AI prompt 描述：

```
aliases: '[string] 别名/俗称，逗号分隔，列举3-8个常用叫法，如"米饭,白饭,蒸米,大米饭"（中文，最常用放前面）'
```

#### `foodForm` 提升到 Stage 1（解决 F3）

`foodForm`（ingredient=原材料, dish=成品菜, semi_prepared=半成品）是最基础的分类信息，应在宏量营养素阶段同时补全。将其从 Stage5 移至 Stage1。

#### 完善 Stage 提示词中文背景（解决 F4/F5）

每个 Stage 的 Prompt 增加中文食物本土化提示：

```
背景：该食物数据主要用于中国用户的饮食管理，请优先参考《中国食物成分表》（2002/2018版）数据。
对于中式菜肴，请考虑常见家庭烹饪方式（如炒、蒸、煮、红烧等）对营养素的影响。
```

#### 食物上下文信息增强（解决 F5）

`buildFoodContext()` 方法增加以下信息传入 AI：

- `aliases`（已知别名，帮助 AI 理解食物）
- `primarySource` + `primarySourceId`（来源，如 USDA 可提示 AI 参考对应数据库）
- `ingredientList`（已知食材，帮助推断营养和属性）

### 4.2 按缺失字段批量入队（解决 D2）

新增 `POST /enrichment/enqueue-missing` 端点：

```
功能：查询 data_completeness < threshold 的食物，按缺失字段分 stage 入队
参数：
  - threshold: number（默认 80，查询 data_completeness < threshold 的食物）
  - stages: number[]（可选，指定只补全哪些阶段）
  - limit: number（最多入队数量，默认 200）
  - category: string（可选，只补全某分类）
```

### 4.3 按失败字段重试（解决 D3）

增强 `POST /enrichment/retry-failed` 支持 `failedField` 参数：查询 `failedFields` JSON 中包含指定字段的食物，定向重试。

---

## 五、Phase 3：AI提示词深度优化 + 审核增强 + 冗余清理

### 5.1 AI提示词深度优化

#### 核心原则调整

```
V8.3 版本：
- 要求说明数据来源
- 低置信度标注

V8.4 新增：
- 中文食物本土化背景
- 字段间一致性约束（如 fat 和 saturated_fat 的关系）
- 针对成品菜与原材料的不同推断策略
- 分阶段上下文继承（Stage2 可参考 Stage1 已补全的宏量数据）
```

#### Stage 级别的提示词优化细节

**Stage 1 - 宏量营养素**：

- 增加"注意区分原材料（生）和成品菜（熟）的营养差异，熟食请标注是否含调味料热量"
- 增加 `foodForm` 字段（原材料/成品菜判断）

**Stage 2 - 微量营养素**：

- 增加"钠含量对腌制食品/加工食品特别重要，请给出较精确估算"
- 传入 Stage1 已补全的 calories/protein/fat/carbs 作为参考

**Stage 3 - 健康属性**：

- 增加"allergens 请列举所有可能的过敏原，包括交叉污染风险"
- 增加"对于中式发酵食品（如豆豉、腐乳），FODMAP 通常为 high"

**Stage 4 - 使用属性**：

- 增加 `aliases` 字段补全
- cuisine 字段增加：regional_chinese（地方菜系可细化为 sichuan/cantonese/hunan 等）

**Stage 5 - 扩展属性**：

- `compatibility` 字段增加中医食材相克提示
- `availableChannels` 针对中国渠道（wet_market=菜市场, supermarket=超市, online=电商, delivery=外卖）

### 5.2 冗余清理

1. 废弃 `/food-library/statistics-v81` 独立路由（保留方法但重定向到统一统计）
2. `getStatistics()` 和 `getStatisticsV81()` 合并为 `getUnifiedStatistics()`，由统一路由调用
3. 修复 `analysis-record-management.service.ts` 两个遗留 Bug

---

## 六、API 能力设计

### 6.1 食物管理 API 能力分组

| 能力           | 现有/新增           | 说明                                   |
| -------------- | ------------------- | -------------------------------------- |
| 食物 CRUD      | 现有                | list/create/read/update/delete/restore |
| 统计概览       | **增强**            | 合并统计口径，增加补全/审核分布        |
| 缺失字段查询   | 现有（quality接口） | 查询低完整度食物列表                   |
| 按缺失程度排序 | **新增**            | orderBy=data_completeness ASC          |
| 变更日志/回滚  | 现有                | changelog/rollback                     |
| 翻译管理       | 现有                | CRUD 翻译记录                          |
| 冲突解决       | 现有                | 查询/解决冲突                          |
| 候选晋升       | 现有                | 候选→正式食物                          |

### 6.2 AI补全 API 能力分组

| 能力                 | 现有/新增      | 说明                               |
| -------------------- | -------------- | ---------------------------------- |
| 单条同步补全         | 现有           | `POST /enrich/:id`                 |
| 批量异步入队         | 现有           | `POST /enqueue`                    |
| **按缺失度批量入队** | **新增**       | `POST /enqueue-missing`            |
| 队列状态查询         | 现有           | 实时计数                           |
| 批量进度快照         | 现有（V8.4）   | 队列+DB 聚合视图                   |
| 历史统计             | 现有（已修复） | enrichment_status 分布             |
| 全库进度             | 现有           | stagesCoverage + byStatus          |
| 暂存审核列表         | 现有           | staged 列表 + 预览                 |
| 批量审核             | 现有           | approve/reject 批量                |
| **队列清空**         | **新增**       | `POST /drain`（清空 waiting）      |
| 队列清理增强         | **增强**       | `POST /clean` 支持 type='all'      |
| 失败重试             | 现有（V8.3）   | retry-failed（queue+database双源） |
| **按字段失败重试**   | **增强**       | retry-failed 支持 failedField 参数 |
| 规则重算             | 现有           | 全库 tags/quality/satiety 重算     |
| 完整度重算           | 现有（V8.3）   | recalculate-completeness           |
| 质量报告             | 现有           | 字段覆盖率/低质量列表              |

### 6.3 不新增的 API

以下操作通过现有 API 已可支持，**无需新增**：

- 手动修正食物字段 → `PATCH /food-library/:id`
- 标记审核状态 → `PATCH /food-library/:id`（修改 reviewStatus 字段）
- 查看字段级补全来源 → `GET /food-library/:id`（返回 fieldSources/fieldConfidence）
- 失败字段查询 → `GET /food-library/:id`（返回 failedFields）
- 数据来源标记 → `GET /food-library/:id`（返回 primarySource/fieldSources）

---

## 七、enrichment_status 生命周期（V8.4）

```
创建食物
  └→ enrichment_status = 'pending'

入队补全（enqueueBatch / enqueue-missing）
  └→ 仍为 'pending'（入队不改状态）

补全执行中（Processor）
  ├→ 成功写入
  │    ├→ completeness >= 80  → 'completed'
  │    ├→ completeness >= 30  → 'partial'
  │    └→ completeness <  30  → 'pending'（数据不足，待补）
  │
  ├→ staged 模式
  │    └→ 'staged'（待人工审核）
  │
  └→ 补全全部失败（V8.3+）
       └→ 'failed'

staged 审核
  ├→ approve → 'completed'/'partial'/'pending'（按实际 completeness）
  └→ reject  → 'rejected'（V8.3+）

rejected 食物
  └→ retry-failed → 重置为 'pending' → 重新入队

failed 食物
  └→ retry-failed → 重置为 'pending' → 重新入队
```

---

## 八、数据完整度计算权重（V8.4 确认，无变化）

食物数据完整度由 `computeCompletenessScore()` 计算，字段按重要性分组加权：

| 字段组           | 权重 | 包含字段                                      |
| ---------------- | ---- | --------------------------------------------- |
| 核心营养（必填） | 35%  | calories, protein, fat, carbs                 |
| 次要营养         | 20%  | fiber, sugar, sodium, cholesterol             |
| 微量营养         | 15%  | 8个微量营养素                                 |
| 分类与标签       | 10%  | category, subCategory, tags, allergens        |
| 使用属性         | 10%  | mealTypes, cookingMethods, cuisine, portions  |
| 扩展属性         | 10%  | ingredientList, flavorProfile, textureTags 等 |

---

## 九、影响文件清单

| 文件                                    | 修改类型                                 | Phase |
| --------------------------------------- | ---------------------------------------- | ----- |
| `food-enrichment.service.ts`            | 字段扩展+提示词优化+统计修复             | 1-3   |
| `food-enrichment.controller.ts`         | 新增端点(drain/enqueue-missing)+清理增强 | 1-2   |
| `food-library-management.service.ts`    | 统计合并+冗余清理                        | 1/3   |
| `food-library-management.controller.ts` | statistics 路由统一                      | 3     |
| `analysis-record-management.service.ts` | Bug修复(R2/R3)                           | 1     |
| `food-conflict-resolver.service.ts`     | Bug修复(R4)                              | 1     |

**不修改文件**（零接触）：

- 推荐系统相关文件
- 用户画像/决策系统
- 分析记录（除Bug修复）
- 订阅/商业化逻辑

---

## 十、修改清单（勾选追踪）

### Phase 1 — 统计修复 + Bug修复 + 队列增强

- [ ] S1: `getEnrichmentHistoricalStats` avgCompleteness 排除 data_completeness=0
- [ ] S3/S4/S5: `getStatistics()` 合并增强（添加 enrichment/review/completeness 分布）
- [ ] S4: `/statistics-v81` 路由重定向到统一统计
- [ ] Q1/Q4: 新增 `POST /enrichment/drain` 清空等待中任务
- [ ] Q1: `POST /enrichment/clean` 支持 type='all'
- [ ] R2: 修复 analysis-record LIMIT/OFFSET 参数索引
- [ ] R3: 修复 analysis-record raw SQL camelCase 访问
- [ ] R4: 修复 food-conflict-resolver sources 重复字段

### Phase 2 — 补全字段完善 + 任务管理

- [ ] F2: `aliases` 加入 ENRICHABLE_FIELDS (Stage 4)
- [ ] F3: `foodForm` 从 Stage5 移至 Stage1
- [ ] F4/F5: 补全 Prompt 增加中文背景 + 上下文信息
- [ ] D2: 新增 `POST /enrichment/enqueue-missing` 端点
- [ ] D3: `POST /enrichment/retry-failed` 支持 failedField 参数

### Phase 3 — AI提示词深度优化 + 冗余清理

- [ ] Stage 级别提示词优化（5个 Stage 分别增强）
- [ ] Stage 间上下文继承（Stage2+ 传入前序已补全数据）
- [ ] `getStatistics()` / `getStatisticsV81()` 合并，废弃旧方法
- [ ] 编译验证通过

---

## 十一、不在本次范围内的问题（记录备忘）

以下问题涉及其他模块，本次不处理：

- `AnalysisEventListener` 借用 `replacement_patterns` 字段存储行为数据（涉及用户画像模块）
- `getPopularAnalyzedFoods` 按 raw_text 分组统计热门食物语义错误（涉及分析记录模块）
- `FoodLibraryService.getPopular` 按 searchWeight 排序但方法名叫 getPopular（涉及 App 端推荐）
- Free 用户 `total` 返回误导性数据（涉及订阅权益）
- `FoodAnalyzeController` 进程内 Map 缓存（涉及图片分析链路）
