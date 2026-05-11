# Food Log 重构 V8 — 全链路统一饮食记录

## 背景与目标

重构前存在以下核心问题：

1. **推荐写入 source 错误**：推荐执行写入 `source: 'manual'`，导致无法区分来源
2. **推荐营养素前端估算**：`estimateMacrosFromCalories()` 按固定比例估算，写入 food_records 的蛋白质/脂肪/碳水不准确
3. **分析保存两条路径**：有 `requestId` 走 `analyze-save`，无则走 `records`，数据不一致
4. **source 枚举缺 `recommend` 和 `decision`**：无法区分推荐来源和决策来源
5. **Daily Score avgQuality/avgSatiety 经常为 0**：推荐写入时这两个字段为 0
6. **Daily Summary 缺少来源统计**：无法统计每日推荐执行次数

**核心原则**：Food Log 是唯一真实数据源，所有"吃的行为"统一进入 Food Log。

---

## 变更清单

### 后端变更

#### `apps/api-server/prisma/schema.prisma`

- `food_records_source_enum` 新增 `recommend`、`decision`
- `FoodRecords` 新增字段：`recommendationTraceId String?`、`isExecuted Boolean @default(true)`
- `FoodRecords` 新增索引：`IDX_food_records_user_source_date`
- `DailySummaries` 新增字段：`sourceBreakdown Json?`、`recommendExecutionCount Int @default(0)`

#### `apps/api-server/src/modules/diet/diet.types.ts`

- `RecordSource` enum 新增 `RECOMMEND = 'recommend'`、`DECISION = 'decision'`

#### `apps/api-server/src/modules/diet/app/dto/food-record.dto.ts`

- 新增 `CreateFoodLogDto`（统一写入 DTO）
- 新增 `LogFromRecommendationDto`（推荐执行写入 DTO）
- 新增 `FoodLogQueryDto`（按日期+来源筛选 DTO）

#### `apps/api-server/src/modules/diet/app/services/food-record.service.ts`

- 新增 `createFoodLog(userId, dto: CreateFoodLogDto)` — 统一写入
- 新增 `createFoodLogFromRecommendation(userId, dto)` — 推荐执行写入，固定 source='recommend'，自动计算 avgQuality/avgSatiety
- 新增 `getFoodLogByDate(userId, query, timezone)` — 按日期+来源查询

#### `apps/api-server/src/modules/diet/app/services/food.service.ts`

- 新增 `createFoodLog()` — 委托 + 触发每日汇总更新和 MEAL_RECORDED 事件
- 新增 `logFromRecommendation()` — 推荐执行写入委托
- 新增 `getFoodLog()` — 查询委托

#### `apps/api-server/src/modules/diet/app/controllers/food-record.controller.ts`

- 新增 `POST /api/app/food/food-log` — 统一写入
- 新增 `POST /api/app/food/food-log/from-recommendation` — 推荐执行写入
- 新增 `GET /api/app/food/food-log` — 按日期查询

#### `apps/api-server/src/modules/food/app/controllers/food-analyze.controller.ts`

- `analyze-save` 端点：`source` 改为固定使用 `RecordSource.DECISION`（原来按 inputType 区分 text_analysis/image_analysis）

#### `apps/api-server/src/modules/diet/app/services/daily-summary.service.ts`

- `updateDailySummary()` 新增写入 `sourceBreakdown`（各 source 计数）和 `recommendExecutionCount`

### 前端变更

#### `apps/web/src/types/food.ts`

- `FoodRecord.source` 枚举新增 `'recommend' | 'decision'`
- `FoodRecord` 新增字段：`recommendationTraceId?: string`、`isExecuted?: boolean`

#### `apps/web/src/lib/api/food-record.ts`

- 新增 `foodRecordService.createFoodLog()` — 统一写入
- 新增 `foodRecordService.logFromRecommendation()` — 推荐执行写入
- 新增 `foodRecordService.getFoodLog()` — 按日期查询

#### `apps/web/src/features/home/components/meal-recommendation-card.tsx`

- `handleEaten`：改用 `foodRecordService.logFromRecommendation()`，移除 `source: 'manual'` 和 `estimateMacrosFromCalories()` 估算

#### `apps/web/src/features/home/components/next-meal-card.tsx`

- `handleEaten`：改用 `foodRecordService.logFromRecommendation()`，移除 `source: 'manual'`

#### `apps/web/src/features/food-analysis/components/analyze-page.tsx`

- `handleSave`：else 分支（无 requestId）改用 `foodRecordService.createFoodLog({ source: 'decision' })`，移除旧 `saveRecord` 路径

#### `apps/web/src/features/home/hooks/use-home-data.ts`

- `recordsQuery` 改用 `foodRecordService.getFoodLog()`（返回 `{ items, total, ... }`）
- `records` 取 `recordsQuery.data?.items ?? []`

---

## 新 API 端点

| Method | Path                                                      | 描述                             |
| ------ | --------------------------------------------------------- | -------------------------------- |
| POST   | `/api/app/food/food-log`                                  | 统一写入 Food Log（所有来源）    |
| POST   | `/api/app/food/food-log/from-recommendation`              | 推荐执行写入（source=recommend） |
| GET    | `/api/app/food/food-log?date=YYYY-MM-DD&source=recommend` | 按日期+来源查询                  |

---

## 数据流（重构后）

```
用户吃推荐食物
  → 前端 logFromRecommendation()
  → POST /food-log/from-recommendation
  → FoodRecordService.createFoodLogFromRecommendation()
    → food_records.source = 'recommend'
    → 自动计算 avgQuality/avgSatiety from foods[]
  → DailySummaryService.updateDailySummary()
    → recommendExecutionCount++
    → sourceBreakdown.recommend++

用户确认分析结果
  → 有 requestId → saveAnalysis → analyze-save → source = 'decision'
  → 无 requestId → createFoodLog({ source: 'decision' })

用户手动记录
  → createFoodLog({ source: 'manual' })
```

---

## 注意事项

1. **需要执行数据库 Migration**：`schema.prisma` 已更新枚举和字段，需运行 `prisma migrate dev` 或 `prisma migrate deploy`
2. **`recommendationTraceId` 字段**：当前推荐接口不返回 traceId，前端暂时不传此字段，字段为可选
3. **旧 `saveRecord` 接口保留**：`POST /api/app/food/records` 仍可用，向后兼容
4. **`getTodayRecords` 接口保留**：`GET /api/app/food/records/today` 仍可用
