# Daily Score Optimization V1.3 — 时间感知评分系统

## 版本信息

| 字段 | 值         |
| ---- | ---------- |
| 版本 | V1.3       |
| 基于 | V1.2       |
| 日期 | 2026-04-17 |
| 状态 | 实施中     |

## 1. 问题根因分析

### 1.1 核心 BUG：Energy 评分不感知时间

`calcEnergyScore` 使用高斯钟形函数，将**当前累计摄入**与**全天目标**对比：

```typescript
// 现状（V1.2）
calcEnergyScore((actual = 500), (target = 2000), 'fat_loss');
// sigma = 2000 * 0.12 = 240
// diff = 500 - 2000 = -1500
// score = 100 * exp(-1500²/(2*240²)) ≈ 0
```

**结果**：早上 10 点吃了健康的 500 卡早餐 → energy 维度得分 ≈ 0。

对于 `fat_loss` 目标，energy 权重 = 0.30（最高），直接导致**每个用户每天上午都得到不合理的低分**。

### 1.2 系统把"每日进度"和"饮食质量"混为一体

- `energy` 维度实质上测量的是"完成度"（累计摄入 vs 全天目标），不是"质量"
- `proteinRatio`、`macroBalance` 是比例型评分（calories 内比例），不受此影响
- `foodQuality`、`satiety` 是质量型评分，不受此影响
- **唯一但致命的问题在 energy 维度**

### 1.3 问题检测和状态解释同样不感知时间

- `detectIssueHighlights` 在 `calPct < 50 && mealCount >= 2` 时报 "热量严重不足"
- `buildStatusExplanation` 在 `breakdown.energy < 40` 时说 "今日热量摄入不足，建议加餐"
- 早上 10 点只吃了 1-2 餐，这些提示完全不合理

### 1.4 影响范围

两个消费路径都受影响：

1. **`/nutrition-score` API**（controller 实时计算）→ `nutrition-score-card.tsx`
2. **`updateDailySummary`**（写入 `daily_summaries` 表）→ `today-status.tsx`

## 2. 设计方案

### 2.1 时间进度曲线函数

引入 `getExpectedProgress(localHour): number`，返回 0-1 之间的值，表示该时间点预期的热量摄入进度：

```typescript
function getExpectedProgress(localHour: number): number {
  // 分段线性曲线，基于典型三餐模式：
  // 6:00  → 0.00（起床前）
  // 9:00  → 0.25（早餐后）
  // 13:00 → 0.50（午餐后）
  // 19:00 → 0.80（晚餐后）
  // 22:00 → 1.00（一天结束）
  const points: [number, number][] = [
    [0, 0],
    [6, 0],
    [9, 0.25],
    [13, 0.5],
    [19, 0.8],
    [22, 1.0],
    [24, 1.0],
  ];
  // 线性插值
}
```

### 2.2 时间感知的 Energy 评分

修改 `calcEnergyScore` 签名，增加 `localHour?: number`：

```typescript
calcEnergyScore(actual, target, goal, localHour?)
```

当 `localHour` 有值时：

- `adjustedTarget = target × getExpectedProgress(localHour)`
- 用 `adjustedTarget` 替代 `target` 进行高斯计算
- 保护：`adjustedTarget` 最小为 `target × 0.1`（避免极端）

**效果**：早上 10 点，`adjustedTarget ≈ 2000 × 0.33 = 660`，吃了 500 卡 → energy 接近 80 而不是 0。

### 2.3 calculateScore 接口扩展

```typescript
calculateScore(
  input: NutritionInput,
  goal: string,
  stabilityData?: {...},
  healthConditions?: string[],
  localHour?: number,          // V1.3 新增
): NutritionScoreResult
```

返回值类型不变（`NutritionScoreResult`），向后兼容。`localHour` 仅传递给 `calcEnergyScore`。

### 2.4 dailyProgress 响应字段

在 controller response 中新增 `dailyProgress` 对象，让前端区分"评分"和"进度"：

```json
{
  "dailyProgress": {
    "localHour": 10,
    "expectedProgress": 0.33,
    "actualProgress": 0.25,
    "isOnTrack": true
  }
}
```

- `expectedProgress` = `getExpectedProgress(localHour)`
- `actualProgress` = `intake.calories / goals.calories`
- `isOnTrack` = `actualProgress >= expectedProgress × 0.7`

### 2.5 时间感知的问题检测

`detectIssueHighlights` 增加 `localHour?: number` 参数：

- `calorie_deficit` 条件改为：`calPct < expectedProgress × 50`（而非固定 50%）
  - 例如早上 10 点 expectedProgress=0.33，阈值 = 16.5%，只有极端低摄入才报警
- `calorie_excess` 条件改为：`calPct > expectedProgress × 130 + 30`（给缓冲）
  - 防止午后正常进食被误报超标

### 2.6 时间感知的状态解释

`buildStatusExplanation` 增加 `localHour?: number` 参数：

- 当 `localHour < 14`（下午 2 点前）且 `breakdown.energy < 40` 时：
  - 不再说"热量摄入不足"
  - 改为"进度正常，继续保持"（如果 isOnTrack）
  - 或"进度稍慢"（如果偏低但不极端）

### 2.7 computeMacroSlotStatus 时间感知

`computeMacroSlotStatus` 增加 `localHour?: number` 参数：

- 当 `localHour` 有值时，deficit 阈值从固定 0.7 调整为 `expectedProgress × 0.7`
- 避免早上把所有宏量都标记为 deficit

## 3. 完整评分结构 JSON 定义（V1.3）

### 3.1 `/nutrition-score` API Response

```json
{
  "success": true,
  "code": 200,
  "data": {
    "totalScore": 78,
    "breakdown": {
      "energy": 82,
      "proteinRatio": 75,
      "macroBalance": 90,
      "foodQuality": 81,
      "satiety": 75,
      "stability": 80,
      "glycemicImpact": 75
    },
    "highlights": ["..."],
    "decision": "SAFE",
    "feedback": "...",
    "goals": {
      "calories": 2000,
      "protein": 130,
      "fat": 49,
      "carbs": 250,
      "quality": 7,
      "satiety": 6
    },
    "intake": { "calories": 500, "protein": 20, "fat": 15, "carbs": 70 },
    "statusLabel": "good",
    "statusExplanation": "进度正常，继续保持。蛋白质比例良好。",
    "topStrength": { "dimension": "macroBalance", "score": 90 },
    "topWeakness": { "dimension": "satiety", "score": 75 },
    "behaviorBonus": { "streakDays": 10, "complianceRate": 0.85, "bonusPoints": 1.5 },
    "complianceInsight": {
      "calorieAdherence": 25,
      "proteinAdherence": 15,
      "fatAdherence": 31,
      "carbsAdherence": 28
    },
    "macroSlotStatus": { "calories": "ok", "protein": "ok", "fat": "ok", "carbs": "ok" },
    "issueHighlights": [],
    "dailyProgress": {
      "localHour": 10,
      "expectedProgress": 0.33,
      "actualProgress": 0.25,
      "isOnTrack": true
    }
  }
}
```

### 3.2 关键变化说明

| 字段                       | V1.2                      | V1.3         | 变化原因             |
| -------------------------- | ------------------------- | ------------ | -------------------- |
| `breakdown.energy`         | 0（早上）                 | 82（早上）   | 时间感知 target 调整 |
| `totalScore`               | 56（早上）                | 78（早上）   | energy 不再拖低整体  |
| `macroSlotStatus.calories` | `deficit`（早上）         | `ok`（早上） | 时间感知阈值         |
| `issueHighlights`          | `calorie_deficit`（早上） | `[]`（早上） | 时间感知问题检测     |
| `dailyProgress`            | 无                        | 新增         | 分离质量与进度       |

## 4. 实施步骤

### Step 1: 核心函数修改（nutrition-score.service.ts）

1. 新增 `getExpectedProgress(localHour: number): number` 工具函数
2. 修改 `calcEnergyScore` 增加 `localHour?: number` 参数
3. 修改 `calculateScore` 增加 `localHour?: number` 参数，透传给 `calcEnergyScore`
4. 修改 `detectIssueHighlights` 增加 `localHour?: number` 参数，时间感知阈值
5. 修改 `buildStatusExplanation` 增加 `localHour?: number` 参数，时间感知措辞
6. 修改 `computeMacroSlotStatus` 增加 `localHour?: number` 参数，时间感知阈值

### Step 2: 调用方修改

1. `daily-summary.service.ts`：获取 `localHour`（通过 `getUserLocalHour`），传入 `calculateScore`
2. `food-nutrition.controller.ts`：获取 `localHour`，传入所有评分函数，response 增加 `dailyProgress`

### Step 3: 向后兼容性

- 所有新参数均为 optional（`localHour?: number`）
- 不传 `localHour` 时行为与 V1.2 完全一致
- 不修改数据库 schema
- 不修改前端代码（`dailyProgress` 为新增字段，前端可按需消费）

## 5. 时间进度曲线设计

```
Progress
1.0 |                                    ─────────
    |                               ╱
0.8 |                          ╱
    |                    ╱
0.5 |               ╱
    |          ╱
0.25|     ╱
    |╱
0.0 └──────────────────────────────────────────
    0  3  6  9  12  15  18  21  24  (hour)
```

基于典型三餐模式（早 7-9、午 12-13、晚 18-19），曲线在三餐时段斜率较大，其余时段平缓。

## 6. 迭代路线

- **V1.3**（本版本）：时间感知评分 + 进度分离
- **V1.4**（未来）：餐间评分（单独评每一餐质量，不受全天进度影响）
- **V1.5**（未来）：学习型曲线（基于用户实际用餐时间模式调整 expectedProgress）
