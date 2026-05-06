# Food Log 统一架构 V8

## 饮食记录 + 分析决策 + 推荐记录 + 每日评分 — 全链路重构设计文档

> 作者：后端架构 + 数据链路重构 + 前端系统整合  
> 版本：V8.0  
> 日期：2026-04-18

---

# Step 1：现有问题分析

## 1.1 重构前的数据链路

```
推荐系统                    决策系统                    手动记录
    ↓                           ↓                          ↓
用户点"我吃了"             用户确认分析结果             用户输入食物
    ↓                           ↓                          ↓
saveRecord({               saveRecord({              saveRecord({
  source: 'manual',   ←错  source: text_analysis       source: 'manual'
  估算宏量营养         ←错    or image_analysis
})                         })
    ↓                           ↓                          ↓
              food_records（来源混乱，营养不准）
                              ↓
                    DailySummaryService
                    updateDailySummary()
                              ↓
                      daily_summaries
                    avgQuality/avgSatiety 经常为 0 ←问题
```

## 1.2 已确认的核心问题

| #   | 问题                                    | 根因                                           | 影响                              |
| --- | --------------------------------------- | ---------------------------------------------- | --------------------------------- |
| 1   | 推荐执行写入 `source: 'manual'`         | 前端 `meal-recommendation-card.tsx:198` 硬编码 | 无法区分来源，来源统计失真        |
| 2   | 推荐营养素前端估算                      | `estimateMacrosFromCalories()` 按固定比例估算  | food_records 蛋白质/脂肪/碳水不准 |
| 3   | 分析保存两条路径                        | 有 requestId 走 analyze-save，无则走 records   | 数据不一致                        |
| 4   | source 枚举缺 `recommend` 和 `decision` | 枚举未扩展                                     | 来源信息丢失                      |
| 5   | avgQuality/avgSatiety 经常为 0          | 推荐写入时未传这两个字段                       | Daily Score 偏低/不稳定           |
| 6   | Daily Summary 无来源统计                | 未设计 sourceBreakdown 字段                    | 无法统计推荐执行率                |
| 7   | 首页 7 个并行请求                       | use-home-data 聚合过多                         | 性能差，isLoading 卡 UI           |

## 1.3 重构后的目标数据链路

```
推荐系统                    决策系统                    手动记录
    ↓                           ↓                          ↓
用户点"我吃了"             用户确认分析结果             用户输入食物
    ↓                           ↓                          ↓
POST /food-log/         POST /food-log/             POST /food-log
from-recommendation     (source=decision             (source=manual)
(source=recommend)       via analyze-save)
    ↓                           ↓                          ↓
              ┌─────────────────────────────────┐
              │         food_records             │
              │  source: recommend/decision/manual│
              │  avgQuality/avgSatiety: 真实值   │
              └─────────────────────────────────┘
                              ↓
                    DailySummaryService
                    updateDailySummary()
                    写入 sourceBreakdown
                    写入 recommendExecutionCount
                              ↓
                      daily_summaries（可信）
                              ↓
                    Daily Score（稳定）
```

---

# Step 2：Food Log 重构（已实施）

## 2.1 统一数据结构

`food_records` 表现有字段（V8 完整版）：

```typescript
interface FoodRecord {
  // 基础
  id: string
  userId: string
  recordedAt: DateTime          // 实际用餐时间
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack'

  // 食物内容
  foods: FoodItem[]             // [{ name, calories, protein, fat, carbs, quality, satiety }]
  totalCalories: number

  // 营养素（真实值，非估算）
  totalProtein: Decimal(6,1)
  totalFat: Decimal(6,1)
  totalCarbs: Decimal(6,1)
  avgQuality: Decimal(3,1)      // 食物质量均值（1-10）
  avgSatiety: Decimal(3,1)      // 饱腹感均值（1-10）
  nutritionScore: number        // 0-100

  // 来源（V8 扩展）
  source: 'manual' | 'recommend' | 'decision' |
          'text_analysis' | 'image_analysis' | 'screenshot' | 'camera'
  isExecuted: boolean           // 默认 true，预留"计划但未吃"扩展
  recommendationTraceId?: string // source=recommend 时的推荐追踪 ID

  // 来源追溯
  analysisId?: string           // source=decision 时关联 food_analysis_records

  // 决策快照（source=decision 时）
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID'
  riskLevel?: string
  reason?: string
  suggestion?: string
  insteadOptions: string[]
  compensation?: { diet?; activity?; nextMeal? }
  contextComment?: string
  encouragement?: string
}
```

## 2.2 写入入口统一（三条路径）

### 路径1：推荐执行

```
用户点"我吃了"（meal-recommendation-card / next-meal-card）
  ↓
前端: foodRecordService.logFromRecommendation({
  foods,              // 来自推荐内容（含 quality/satiety）
  totalCalories,
  mealType,
  totalProtein,       // 推荐接口返回的真实营养素
  totalFat,
  totalCarbs,
  avgQuality,         // 若未传，后端自动从 foods[] 计算均值
  avgSatiety,
  recommendationTraceId?
})
  ↓
POST /api/app/food/food-log/from-recommendation
  ↓
FoodRecordService.createFoodLogFromRecommendation()
  ↓
food_records: source = 'recommend', avgQuality/avgSatiety = 真实值
```

### 路径2：分析决策确认

```
用户完成分析 → 点"保存记录"
  ↓
方式A（有 analysisId）:
  前端: foodRecordService.saveAnalysis({ analysisId, mealType })
  → POST /api/app/food/analyze-save
  → source = 'decision'（V8修复：原来按 inputType 区分）

方式B（无 analysisId，手动编辑后保存）:
  前端: foodRecordService.createFoodLog({ source: 'decision', ... })
  → POST /api/app/food/food-log
  → source = 'decision'
```

### 路径3：手动记录

```
用户直接输入食物
  ↓
前端: foodRecordService.createFoodLog({ source: 'manual', ... })
  ↓
POST /api/app/food/food-log
  ↓
food_records: source = 'manual'
```

---

# Step 3：Analyze / Explain 现状与要求

## 3.1 当前状态

`analyze-save` 端点（`food-analyze.controller.ts`）：

- 接收 `analysisId` → 查 `food_analysis_records` → 提取营养数据
- 调用 `foodService.saveRecord()` 写入 `food_records`
- **V8 已修复**：`source` 固定为 `RecordSource.DECISION`

`AnalysisPersistenceService`：

- 只写 `food_analysis_records`，不写 `food_records`
- 不需要修改

## 3.2 原则确认

- Analyze / Explain 只读 `food_records`（通过 Daily Summary / FoodRecordService）
- 不直接影响评分
- 不持有独立的"行为记录"

---

# Step 4：Daily Score 重构（已实施）

## 4.1 计算输入

```
当天 food_records（全部）
  ↓
DailySummaryService.updateDailySummary()
  ├── totalCalories = SUM(r.totalCalories)
  ├── totalProtein = SUM(r.totalProtein)
  ├── totalFat = SUM(r.totalFat)
  ├── totalCarbs = SUM(r.totalCarbs)
  ├── avgQuality = 热量加权均值(r.avgQuality)   ← V8 保证有值
  ├── avgSatiety = 热量加权均值(r.avgSatiety)   ← V8 保证有值
  ├── sourceBreakdown = { manual: N, recommend: N, decision: N }  ← V8 新增
  └── recommendExecutionCount = COUNT(source='recommend')          ← V8 新增
  ↓
NutritionScoreService.calculateScore()
  ↓
daily_summaries.nutritionScore（可信）
```

## 4.2 触发机制

每次写入 food_records 后，异步触发：

```typescript
// food.service.ts
this.dailySummaryService
  .updateDailySummary(userId, saved.recordedAt)
  .catch(err => this.logger.error(...))
```

三条写入路径（createFoodLog / logFromRecommendation / saveRecord）均会触发。

## 4.3 Daily Score 稳定性保障

| 问题                  | 修复方案                                                              |
| --------------------- | --------------------------------------------------------------------- |
| 推荐记录 avgQuality=0 | `createFoodLogFromRecommendation()` 从 `foods[].quality` 自动计算均值 |
| 推荐记录 avgSatiety=0 | 同上，从 `foods[].satiety` 自动计算均值                               |
| source 分类错误       | 统一入口强制正确 source                                               |
| 无来源维度            | `sourceBreakdown` + `recommendExecutionCount` 写入 daily_summaries    |

---

# Step 5：前端重构（已实施）

## 5.1 前端允许使用的 API

```typescript
// 写入
foodRecordService.createFoodLog(); // 手动 + 决策（无 analysisId）
foodRecordService.logFromRecommendation(); // 推荐执行
foodRecordService.saveAnalysis(); // 决策（有 analysisId）

// 查询
foodRecordService.getFoodLog({ date, source }); // 今日/指定日期 Food Log
foodRecordService.getTodaySummary(); // 今日汇总（来自 daily_summaries）
foodRecordService.getNutritionScore(); // 今日评分详情
foodRecordService.getRecentSummaries(days); // 趋势数据
```

## 5.2 已修复的前端问题

| 文件                           | 修复内容                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `meal-recommendation-card.tsx` | `handleEaten` 改用 `logFromRecommendation()`，移除 `source:'manual'` 和 `estimateMacrosFromCalories()` |
| `next-meal-card.tsx`           | 同上                                                                                                   |
| `analyze-page.tsx`             | else 分支改用 `createFoodLog({ source:'decision' })`，移除 `saveRecord()` fallback                     |
| `use-home-data.ts`             | `recordsQuery` 改用 `getFoodLog()`，取 `.items` 数组                                                   |
| `types/food.ts`                | `FoodRecord.source` 枚举新增 `recommend`、`decision`；新增 `recommendationTraceId?`、`isExecuted?`     |

## 5.3 前端数据流（重构后）

```
use-home-data
  ├── getTodaySummary() → summary（单一来源）
  ├── getFoodLog()      → records.items（V8 统一查询）
  ├── getMealSuggestion() → 仅用于展示推荐
  ├── getNutritionScore() → scoreData
  └── getRecentSummaries() → 趋势图

HeroBudgetCard
  ├── score = scoreData?.totalScore ?? summary.nutritionScore  // 已有正确 fallback
  └── summary.nutritionScore 来自 daily_summaries（可信）
```

---

# Step 6：接口能力一览

## 6.1 Food Log 写入能力

| 端点                                              | 方法                              | 来源      | 说明                                             |
| ------------------------------------------------- | --------------------------------- | --------- | ------------------------------------------------ |
| `POST /api/app/food/food-log`                     | `createFoodLog`                   | any       | 通用写入，source 由调用方指定                    |
| `POST /api/app/food/food-log/from-recommendation` | `createFoodLogFromRecommendation` | recommend | 专用推荐执行写入，自动计算 avgQuality/avgSatiety |
| `POST /api/app/food/analyze-save`                 | `saveAnalysisToRecord`            | decision  | 分析确认写入，source=decision                    |
| `POST /api/app/food/records`                      | `saveRecord`（旧）                | 向后兼容  | 保留，内部逻辑未变                               |

## 6.2 Food Log 查询能力

| 端点                                                | 说明                 |
| --------------------------------------------------- | -------------------- |
| `GET /api/app/food/food-log?date=YYYY-MM-DD`        | 按日期查询，支持时区 |
| `GET /api/app/food/food-log?date=&source=recommend` | 按日期+来源筛选      |
| `GET /api/app/food/records/today`                   | 旧接口，兼容保留     |
| `GET /api/app/food/records?date=&page=&limit=`      | 旧分页接口，兼容保留 |

## 6.3 Daily Score 能力

| 端点                                      | 说明                                                                    |
| ----------------------------------------- | ----------------------------------------------------------------------- |
| `GET /api/app/food/summary/today`         | 今日汇总（含 nutritionScore, sourceBreakdown, recommendExecutionCount） |
| `GET /api/app/food/nutrition-score`       | 评分详情（维度分解）                                                    |
| `GET /api/app/food/summary/recent?days=7` | 最近 N 天趋势                                                           |

---

# Step 7：数据迁移

## 7.1 历史数据兼容策略

**无需迁移历史 food_records**，原因：

- 旧记录的 `source` 为 `manual`/`screenshot`/`camera`/`text_analysis`/`image_analysis` — 均是有效枚举值
- `recommendationTraceId` 为可空字段，历史记录默认 null
- `isExecuted` 默认 `true`，历史记录自动兼容

**Daily Summaries 迁移**（可选）：

- `sourceBreakdown` 为 `Json?`，历史记录默认 null，前端需做 null 兼容
- `recommendExecutionCount` 默认 0，历史记录自动为 0

## 7.2 数据库 Migration 要求

需要执行以下 migration（`prisma migrate dev`）：

```sql
-- 1. 扩展枚举
ALTER TYPE food_records_source_enum ADD VALUE 'recommend';
ALTER TYPE food_records_source_enum ADD VALUE 'decision';

-- 2. food_records 新增字段
ALTER TABLE food_records
  ADD COLUMN recommendation_trace_id VARCHAR(255),
  ADD COLUMN is_executed BOOLEAN NOT NULL DEFAULT true;

-- 3. 新增索引
CREATE INDEX IF NOT EXISTS idx_food_records_user_source_date
  ON food_records(user_id, source, recorded_at);

-- 4. daily_summaries 新增字段
ALTER TABLE daily_summaries
  ADD COLUMN source_breakdown JSONB,
  ADD COLUMN recommend_execution_count INTEGER NOT NULL DEFAULT 0;
```

**注意**：`ADD VALUE` 对 PostgreSQL enum 是不可逆操作，且在 Prisma migration 中需要特殊处理（不能在同一事务内使用新枚举值）。

## 7.3 兼容层

- 旧 `POST /app/food/records` 保留，不删除
- 旧 `GET /app/food/records/today` 保留，不删除
- 旧 `saveRecord()` service 方法保留，不删除

---

# Step 8：分阶段重构状态

## Phase 1：Food Log 统一入口 ✅ 已完成

- [x] `food_records_source_enum` 新增 `recommend`、`decision`
- [x] `FoodRecords` 新增 `recommendationTraceId`、`isExecuted`
- [x] `DailySummaries` 新增 `sourceBreakdown`、`recommendExecutionCount`
- [x] `RecordSource` enum 新增 `RECOMMEND`、`DECISION`
- [x] 新增 `CreateFoodLogDto`、`LogFromRecommendationDto`、`FoodLogQueryDto`
- [x] `FoodRecordService.createFoodLog()` 统一写入
- [x] `FoodRecordService.getFoodLogByDate()` 统一查询
- [x] `POST /app/food/food-log`、`GET /app/food/food-log` 端点

## Phase 2：推荐 / 决策接入 Food Log + Daily Score 重构 ✅ 已完成

- [x] `POST /app/food/food-log/from-recommendation` 端点
- [x] `FoodRecordService.createFoodLogFromRecommendation()` — 自动计算 avgQuality/avgSatiety
- [x] `analyze-save` source 固定为 `RecordSource.DECISION`
- [x] `DailySummaryService.updateDailySummary()` 写入 `sourceBreakdown` 和 `recommendExecutionCount`

## Phase 3：前端全面切换 ✅ 已完成

- [x] `FoodRecord` 类型新增 `recommend`、`decision`、`recommendationTraceId`、`isExecuted`
- [x] `foodRecordService.createFoodLog()` API 方法
- [x] `foodRecordService.logFromRecommendation()` API 方法
- [x] `foodRecordService.getFoodLog()` API 方法
- [x] `meal-recommendation-card.tsx` handleEaten 改用 `logFromRecommendation()`
- [x] `next-meal-card.tsx` handleEaten 改用 `logFromRecommendation()`
- [x] `analyze-page.tsx` else 分支改用 `createFoodLog({ source:'decision' })`
- [x] `use-home-data.ts` 改用 `getFoodLog()`

---

# Step 9：验证清单

## 9.1 数据一致性验证

```sql
-- 验证1：推荐执行记录来源正确
SELECT source, COUNT(*) FROM food_records
WHERE source IN ('recommend', 'manual', 'decision')
GROUP BY source;
-- 期望：recommend 来自推荐卡片点击，decision 来自分析确认

-- 验证2：daily_summaries 来源统计
SELECT date, recommend_execution_count, source_breakdown
FROM daily_summaries
ORDER BY date DESC LIMIT 7;
-- 期望：recommend_execution_count > 0，source_breakdown 包含各来源计数

-- 验证3：推荐记录营养素非零
SELECT COUNT(*) FROM food_records
WHERE source = 'recommend'
  AND (avg_quality = 0 OR avg_satiety = 0);
-- 期望：0（所有推荐记录 avgQuality/avgSatiety 均有值）
```

## 9.2 Daily Score 稳定性验证

```sql
-- 验证4：有记录的日期 nutritionScore 非零
SELECT date, nutrition_score, meal_count FROM daily_summaries
WHERE meal_count > 0 AND nutrition_score = 0;
-- 期望：空（无有记录但评分为0的情况）

-- 验证5：avgQuality/avgSatiety 与记录一致
SELECT ds.date, ds.avg_quality AS summary_avg_quality,
  AVG(fr.avg_quality * fr.total_calories) / NULLIF(ds.total_calories, 0) AS computed_avg_quality
FROM daily_summaries ds
JOIN food_records fr ON fr.user_id = ds.user_id
  AND fr.recorded_at::date = ds.date::date
GROUP BY ds.date, ds.avg_quality, ds.total_calories
ORDER BY ds.date DESC LIMIT 7;
```

## 9.3 前端一致性验证

| 场景               | 期望行为                                                                       |
| ------------------ | ------------------------------------------------------------------------------ |
| 推荐卡片点"我吃了" | `source=recommend`，`avgQuality/avgSatiety` 非零，Daily Score 更新             |
| 分析确认"保存记录" | `source=decision`，Daily Score 更新                                            |
| 手动输入食物       | `source=manual`，Daily Score 更新                                              |
| 首页刷新           | `records` 来自 `getFoodLog()`，`summary.nutritionScore` 来自 `daily_summaries` |
| 连续点两次"我吃了" | 第二次应 disabled（UI 已有 `isLoggingEaten` 状态锁）                           |

---

# 附录：关键文件位置

## 后端

| 文件                                                                              | 说明                     |
| --------------------------------------------------------------------------------- | ------------------------ |
| `apps/api-server/prisma/schema.prisma:746`                                        | FoodRecords model        |
| `apps/api-server/prisma/schema.prisma:446`                                        | DailySummaries model     |
| `apps/api-server/prisma/schema.prisma:2199`                                       | food_records_source_enum |
| `apps/api-server/src/modules/diet/diet.types.ts:95`                               | RecordSource enum        |
| `apps/api-server/src/modules/diet/app/services/food-record.service.ts`            | 统一 Food Log 写入/查询  |
| `apps/api-server/src/modules/diet/app/services/food.service.ts`                   | 委托 + 事件发布          |
| `apps/api-server/src/modules/diet/app/services/daily-summary.service.ts`          | Daily Score 计算         |
| `apps/api-server/src/modules/diet/app/controllers/food-record.controller.ts`      | V8 端点                  |
| `apps/api-server/src/modules/food/app/controllers/food-analyze.controller.ts:215` | analyze-save 端点        |

## 前端

| 文件                                                                     | 说明                   |
| ------------------------------------------------------------------------ | ---------------------- |
| `apps/web/src/lib/api/food-record.ts`                                    | 全部 Food Log API 方法 |
| `apps/web/src/types/food.ts:183`                                         | FoodRecord 类型定义    |
| `apps/web/src/features/home/hooks/use-home-data.ts`                      | 首页数据聚合 hook      |
| `apps/web/src/features/home/components/meal-recommendation-card.tsx:171` | 推荐卡片 handleEaten   |
| `apps/web/src/features/home/components/next-meal-card.tsx:67`            | 简版推荐 handleEaten   |
| `apps/web/src/features/food-analysis/components/analyze-page.tsx:408`    | 分析确认 handleSave    |
