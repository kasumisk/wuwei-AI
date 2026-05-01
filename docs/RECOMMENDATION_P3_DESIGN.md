# P3 实现细节设计文档

> 来源：`docs/RECOMMENDATION_REGIONAL_TIMEZONE_DEEP_ANALYSIS.md` §4 优先级表 P3 项
>
> 范围：本轮覆盖 §2.6（Weight-Learner region 分桶）、§2.4（Inferred Profile 注入 region）、§2.11（MOO 加本地化目标）、§3.x（画像 × 能力深度联动），先把所有实现细节、决策点、数据流、验证点写明，再分批落地。
>
> **落地进度（2026-05-01 更新）**：PR-1 ✅ PR-2 ✅ PR-3 ✅ PR-4 ✅ PR-5 ✅ —— 全部 tsc EXIT=0

---

## 0. 总览与编排

| 子项 | 标题 | 主要文件 | PR 拆分建议 | 依赖 | 状态 |
|---|---|---|---|---|---|
| P3-2.6 | Weight-Learner region 三层先验 | `optimization/weight-learner.service.ts` | PR-1 | 独立 | ✅ 已落地 |
| P3-2.4 | 规则推断注入 region（非 LLM） | `services/profile/profile-inference.service.ts`、`segmentation.util.ts`、`profile-cron.service.ts` | PR-2 | 独立 | ✅ 已落地 |
| P3-2.11 | MOO 增加 `regionalFit` 维度 | `optimization/multi-objective-optimizer.ts`、`strategy.types.ts` | PR-3 | 独立 | ✅ 已落地 |
| P3-3.1 | 食物名翻译查漏补缺 | `food.service.ts`、`recommendation-engine.service.ts` | 合入 PR-3 | 独立 | ✅ 已落地 |
| P3-3.2 | `CHANNEL_TIME_MATRIX` 按 region 分桶 | `scoring-chain/factors/channel-availability.factor.ts` | PR-4 | 独立 | ✅ 已落地 |
| P3-3.3 | `inferred.dietary_preference` × region 群体相对偏好 | `profile-inference.service.ts`、`profile-cron.service.ts` | 合入 PR-2 | 依赖 P3-2.4 | ✅ 已落地 |
| P3-3.4 | 季节冲突（北/南半球切换） | `utils/seasonality.service.ts` | PR-5 | 与 P2-2.7 已有 monthToSeason 协同 | ✅ 已落地 |

**审计文档 §2.4 偏差说明**：实际代码中 `ProfileInferenceService` **不调用 LLM**，全部为规则推断。本文档将 §2.4 重新定义为「**规则推断注入 region**」（segmentation 阈值、营养基线、churn 风险均按 region 调参），与代码现状对齐。

---

## 1. P3-2.6 Weight-Learner region 三层先验 ✅

### 1.1 现状

`weight-learner.service.ts`：

```ts
const REDIS_PREFIX           = 'weight_learned:';                 // global:goalType
const USER_REDIS_PREFIX      = 'weight_learner:user:';            // user:userId:goalType
const USER_MEAL_REDIS_PREFIX = 'weight_learner:user:';            // user×meal:userId:goalType:mealType
```

读取链路：
- `getUserMealWeights(userId, goalType, mealType, base)` → user×meal offset → `getUserWeights` → user offset → `getGlobalWeights` → goalType offset → base
- 全是「offset 命中即用、否则 fallback 上一层」的硬切换，没有加权融合。

注：盘点结果 `getUserWeights` / `getUserMealWeights` 当前**未被任何外部调用方使用**，仅 `getLearnedWeights(goalType)` 被 `learned-ranking.service.ts` 间接调用。本子项视为 V6.8 已铺好但未通电的扩展点，本设计**同时打通消费侧**。

### 1.2 目标

引入 region 层级，得到 `global → region → user → user×meal` 四层先验，**加权融合而非硬切换**。

冷启动新用户（无 user offset）应能立即享受**同 region 的群体先验**，而非全局均值。

### 1.3 数据模型

#### 1.3.1 新增 Redis key

| Key 模板 | 含义 | TTL |
|---|---|---|
| `weight_learner:region:{regionCode}:{goalType}` | 区域 × 目标的 offset 向量 | 30 天（写入时刷新） |
| `weight_learner:region:{regionCode}:{goalType}:{mealType}` | 区域 × 目标 × 餐次 offset 向量 | 30 天 |

值结构沿用现有 `{ offsets: number[]; updatedAt: string; sampleSize: number }`（沿用 user 层格式，新增 sampleSize 字段以便监控置信度）。

#### 1.3.2 输入信号

learnRound（在线学习一轮）需要从反馈表多查一列 `regionCode`：

- 反馈来源：`feedback_logs.regionCode`（已有列；写入端见 `feedback.service.ts`）。
- learnRound 现有 SQL：按 `goalType` / `userId` / `mealType` 聚合 → 改为同时按 `regionCode` 聚合。

### 1.4 接口签名

#### 1.4.1 `getUserWeights` 改写

```ts
async getUserWeights(
  userId: string,
  goalType: string,
  base: number[],
  regionCode?: string,           // 新增（可选，缺省走旧逻辑）
): Promise<number[]>
```

- 新增可选参数 `regionCode`；undefined 时**完全等价旧行为**（向后兼容）。
- 内部调用顺序保持调用方零改动：

```
final = base + α·userOffset + β·regionOffset + γ·globalOffset
```

权重默认（写到常量，可由 strategy 配置覆盖）：

| 命中状态 | α (user) | β (region) | γ (global) |
|---|---|---|---|
| user + region + global 均命中 | 0.5 | 0.3 | 0.2 |
| user 缺失，region + global 命中 | 0 | 0.6 | 0.4 |
| user + global 命中（regionCode 未传或 region 缺失） | 0.7 | 0 | 0.3 |
| 仅 global 命中 | 0 | 0 | 1.0 |
| 全部缺失 | 0 | 0 | 0（直接 base） |

权重归一：`adjusted = base.map((b, i) => max(0.01, b + α·u[i] + β·r[i] + γ·g[i]))`，最后 sum-normalize。

> **重要**：global offset 的存储格式当前是「学习后绝对权重」（`getLearnedWeights` 返回的就是最终权重数组），不是 delta。本设计**不动 global 存储格式**，只在融合时做转换：`globalOffset = globalLearned - base`（如果 globalLearned 存在），保证语义统一为 delta 之后再加权。

#### 1.4.2 `getUserMealWeights` 同步扩展

```ts
async getUserMealWeights(
  userId: string,
  goalType: string,
  mealType: string,
  base: number[],
  regionCode?: string,           // 新增
): Promise<number[]>
```

四层融合：

```
final = base
      + α·userMealOffset    (0.45)
      + β·userOffset        (0.25)
      + γ·regionMealOffset  (0.15)
      + δ·regionOffset      (0.10)
      + ε·globalOffset      (0.05)
```

任何一层缺失，其权重重分配给同语义的下一层（user×meal 缺 → user；region×meal 缺 → region；region 缺 → global）。

#### 1.4.3 写入侧 `learnRound` 扩展

```ts
private async writeRegionOffset(
  regionCode: string,
  goalType: GoalType,
  offsets: number[],
  sampleSize: number,
): Promise<void>
```

- 在每轮 learnRound 内，对 `groupBy(regionCode, goalType)` 的反馈样本计算梯度，写入 region key。
- `sampleSize < 30` 不写入（降低早期噪声）。
- `delByPrefix` 也要清 `weight_learner:region:`（现有 `clearAll` 只清 user 前缀，需补充）。

### 1.5 调用方接通

当前消费侧 `learned-ranking.service.ts:384` 拿的是全局 `getLearnedWeights(userSegment)`（注：此 `userSegment` 字段实际传的是 segment 字符串，不是 goalType；命名混用）。

接通策略：

1. **`profile-aggregator.service.ts:149`**：将 `userId` + `userProfile.regionCode` + `goalType` 一并传入 `learnedRankingService.getLearnedWeights`。
2. **`learned-ranking.service.ts`**：`getLearnedWeights` 改为代理给 `WeightLearnerService.getUserWeights(userId, goalType, base, regionCode)`。
3. **`pipeline-builder.service.ts`** 计算 mealType 后，可选切到 `getUserMealWeights`。

接通 PR 与本设计可拆分独立验收（先打通 `getUserWeights` + region，user×meal 留作后续）。

### 1.6 兼容 / 降级

- `regionCode === undefined` → 不查 region key，等价旧行为（保护现有调用点）。
- region key miss 且 user key miss → 回退 global only，与现状一致。
- 反馈表 `regionCode IS NULL` 的样本不参与 region 聚合，但仍计入 user/global 聚合。

### 1.7 测试要点

| 场景 | 预期 |
|---|---|
| 新用户 + 美区 + 美区 region offset 已学 | 推荐权重 = base + 0.6·regionOffset + 0.4·globalOffset |
| 老用户 + 美区 + 三层均命中 | 推荐权重 = base + 0.5·user + 0.3·region + 0.2·global |
| `regionCode=undefined` 调用 | 结果等于旧 `getUserWeights(userId, goalType, base)` |
| sampleSize=10 的 region 数据 | 不写入（避免噪声）|
| `clearAll` 调用 | 同步清 region 前缀 |

### 1.8 落地实际情况（2026-05-01）

| 设计点 | 实际落地 |
|---|---|
| `REGION_REDIS_PREFIX` / `MIN_REGION_FEEDBACK_COUNT=30` / `REGION_LEARNED_TTL=30d` | ✅ |
| `learnRegionWeights()` 按 country×goalType / country×goalType×mealType 分组写 Redis | ✅ |
| `getUserWeights/getUserMealWeights` 四层加权融合，全空返回 `null` | ✅ |
| `resetAll` 清 `weight_learner:region:` 前缀 | ✅ |
| feedback SQL `LEFT JOIN user_profiles` 取 `region_code` | ✅ |
| `@Cron('30 6 * * *')` 每日触发 `learn()` | ✅ |
| `profile-aggregator.service.ts` 注入 learner，优先 learner，fallback segment | ✅ |
| `TrackingModule` export `WeightLearnerService` | ✅ |

### 1.9 监控

新增 metric：
- `weight_learner.region.hit` — region offset 命中次数 / 总调用
- `weight_learner.region.sample_size` — 各 region 写入时的样本量分布

---

## 2. P3-2.4 规则推断注入 region ✅

### 2.1 现状（与审计文档差异）

`profile-inference.service.ts` 无任何 LLM 调用。规则推断包含：
- `inferUserSegment(goal, behavior)`（`segmentation.util.ts`）
- `goalProgress` 趋势（plateau / losing / gaining / fluctuating）
- `optimalMealCount`（基于 `mealTimingPatterns`）
- `recommendedCalories` / `macroTargets`（在 `profile-cron.service.ts` 中计算）
- `nutritionGaps`（cron 中按 macro 偏离基线推断）
- `churnRisk`（`churn-prediction.service.ts`）

**所有规则均无 region 输入**。审计文档 §2.4 描述的"LLM prompt 注入 regionCode"在代码中不存在；与用户确认后**重定义为：在规则推断中引入 region 调参**。

### 2.2 目标

让"同一行为模式 + 不同 region"的用户得到**不同推断结果**：
- segment 阈值（如美区低使用频率的"活跃"门槛 vs 中区）
- 营养基线（`recommendedCalories` / macro split 在不同 region 的口味分布差异）
- churn 风险（不同 region 的用户活跃节奏差异）

### 2.3 数据接入

#### 2.3.1 `SegmentBehaviorInput` 扩展

```ts
export interface SegmentBehaviorInput {
  avgComplianceRate?: number;
  totalRecords?: number;
  daysSinceLastRecord?: number;
  usageDays?: number;
  regionCode?: string;            // 新增（可选，向后兼容）
}
```

#### 2.3.2 `inferUserSegment` 内部按 region 调参

新增常量：

```ts
const REGION_SEGMENT_TUNING: Record<string, {
  newUserUsageDays: number;       // 默认 7
  returningInactiveDays: number;  // 默认 14
  highComplianceThreshold: number;// 默认 0.7
}> = {
  US: { newUserUsageDays: 5,  returningInactiveDays: 10, highComplianceThreshold: 0.65 },
  CN: { newUserUsageDays: 7,  returningInactiveDays: 14, highComplianceThreshold: 0.70 },
  JP: { newUserUsageDays: 10, returningInactiveDays: 21, highComplianceThreshold: 0.75 },
  // ... 兜底 default
};
```

> 阈值数值**不是凭空拍**：必须由 §1.8 监控数据 + `strategy-auto-tuner` 现有 segment 分布数据复盘后确定。本设计先以 default 值上线（即 region 不影响），打开「按 region 调参的开关」让后续基于数据迭代。

调用方修改：`profile-inference.service.ts:67`

```ts
const segResult = inferUserSegment(profile.goal as GoalType, {
  ...segBehavior,
  regionCode: profile.regionCode ?? DEFAULT_REGION_CODE,
});
```

#### 2.3.3 nutritionGaps & macro 基线注入 region

`profile-cron.service.ts` 中 `updateWeeklySegmentation` / `nutritionGaps` 计算逻辑中：

- 当前 `macroTargets` 完全由 declared.goal 决定
- 新增 region 微调：每 region 的 protein/carbs/fat 比例做小幅校正（±2~5%），从配置常量读取

```ts
// regional-defaults.ts 新增
export const REGION_MACRO_BIAS: Record<string, { proteinPct?: number; carbsPct?: number; fatPct?: number }> = {
  US: { proteinPct: +0.03 },  // 美区高蛋白偏好 +3pp
  CN: { carbsPct: +0.02 },    // 中区主食偏好 +2pp
  JP: { proteinPct: +0.02, fatPct: -0.02 },
};
```

应用位置：`profile-cron.service.ts` 计算 `macroTargets` 后乘以 bias 再 sum-normalize。

#### 2.3.4 confidenceScores 加 region

`InferredData.confidenceScores` 新增 `regionCode` 字段，记录推断时使用的 region，便于后续审计：

```ts
confidenceScores = {
  ...,
  userSegment: segResult.confidence,
  inferenceRegionCode: regionCode,   // 新增
};
```

### 2.4 兼容 / 降级

- `profile.regionCode` 为 null → 用 `DEFAULT_REGION_CODE = 'US'`（与全链路统一）
- region 不在 `REGION_SEGMENT_TUNING` 表内 → 用 default 值
- 行为 region 与 declared.regionCode 不一致 → 优先 declared（reflects user 主观选择）

### 2.5 测试要点

| 场景 | 预期 |
|---|---|
| 美区用户 usageDays=6 | new_user（默认 cutoff=5，用户在边界外） |
| 中区用户 usageDays=6 | new_user（cutoff=7，仍是新用户） |
| profile.regionCode=null | 走 DEFAULT_REGION_CODE='US' 调参 |
| confidenceScores.inferenceRegionCode | 等于实际使用的 region |

### 2.6 P3-3.3 联动：dietary_preference × region 群体相对偏好

P3-3.3 在 P3-2.4 框架内实现：

新增字段 `inferred.cuisineAffinityRelative`：

```ts
{
  // 食物 cuisine → 相对偏好分数（用户偏好 / region 群体均值）
  // > 1.0 表示比同 region 群体更偏好该 cuisine
  // ≈ 1.0 表示与群体一致（无显著区分价值）
  szechuan: 1.8,    // 用户偏好该菜系是同区均值的 1.8 倍 → 在推荐中高权重
  italian:  0.9,
}
```

计算位置：`profile-cron.service.ts:updateWeeklySegmentation`：

1. 拉取该 region 群体最近 30 天的 `feedback_logs` 按 cuisine 聚合 → `regionMean[cuisine]`
2. 拉取该用户最近 30 天的 cuisine 偏好分布 → `userMean[cuisine]`
3. `relative = userMean / max(regionMean, 0.05)`，clip 到 [0.2, 5.0]
4. 写入 `inferred.cuisineAffinityRelative`

下游消费：`PreferenceFactor` 在打分时优先用 `cuisineAffinityRelative` 替代绝对偏好（兼容：缺失时回退绝对值）。

> **落地（2026-05-01）**：`pipeline.types.ts` inferred 加 `cuisineAffinityRelative` 字段；`profile-resolver.service.ts` 透传；`preference-signal.factor.ts` init 读取 + computeAdjustment 以 `ln(relative)*0.05` 乘法叠加；tsc EXIT=0。

---

## 3. P3-2.11 MOO 加本地化目标 ✅

### 3.1 现状

`MULTI_OBJECTIVE_DIMENSIONS = ['health', 'taste', 'cost', 'convenience', 'macroFit']`（5 维）

`computeObjectives` 全部基于 food 内在属性，**无 region/season 信号**。

### 3.2 目标

新增第 6 维 `regionalFit`，让 MOO 在 Pareto 前沿选解时**偏好本地化匹配的食物**。

### 3.3 数据接入

- `RegionalBoostFactor` 已经计算了 `regionalBoost` multiplier（≥1.0 = 加成，<1.0 = 衰减）
- `SeasonalityFactor` 已经计算了 `seasonalityScore` (0~1，1.0 = 当季最优)
- 二者已写入 `ScoredFood.factorMultipliers` / `factorTraces`

`computeObjectives` 直接复用：

```ts
function computeRegionalFitScore(sf: ScoredFood): number {
  const regional = sf.factorMultipliers?.regionalBoost ?? 1.0;
  const seasonal = sf.factorMultipliers?.seasonality ?? 1.0;

  // regionalBoost ∈ [0.7, 1.3]，归一化到 [0, 1]
  const regionalNorm = Math.min(1, Math.max(0, (regional - 0.7) / 0.6));

  // seasonalityScore（如果是 raw，需归一化）
  const seasonalNorm = Math.min(1, Math.max(0, seasonal));

  // 0.6/0.4 加权（region 主导，季节为补强）
  return 0.6 * regionalNorm + 0.4 * seasonalNorm;
}
```

### 3.4 接口签名

#### 3.4.1 类型扩展（`strategy.types.ts`）

```ts
export const MULTI_OBJECTIVE_DIMENSIONS = [
  'health',
  'taste',
  'cost',
  'convenience',
  'macroFit',
  'regionalFit',   // 新增
] as const;
```

#### 3.4.2 默认偏好权重

```ts
const DEFAULT_PREFERENCES = {
  health: 0.30,        // 0.35 → 0.30
  macroFit: 0.30,      // 0.35 → 0.30 (合并 macroFit 进 health 调整)
  taste: 0.18,         // 0.20 → 0.18
  cost: 0.10,          // 不变
  convenience: 0.07,   // 0.10 → 0.07
  regionalFit: 0.05,   // 新增
};
```

> 默认权重**保守**（5%），避免对存量推荐结果造成大幅扰动；运营可通过 strategy 配置调高。

### 3.5 验证 / 兼容

- `MultiObjectiveConfig.preferences` 旧配置缺失 `regionalFit` → 用 5% 默认值，向后兼容
- `factorMultipliers` 缺失 `regionalBoost`（如关闭了 RegionalBoostFactor）→ regional=1.0 → regionalFit=0.5（中性）
- Pareto 计算（dominates）自动支持新维度，无需改动

### 3.6 测试要点

| 场景 | 预期 |
|---|---|
| 关闭 RegionalBoostFactor | regionalFit=0.5，对最终选择无偏 |
| 美区 + 美式食物 + 当季 | regionalFit≈0.9，MOO 倾向选它 |
| 美区 + 中式食物 + 反季 | regionalFit≈0.2，MOO 降权 |

---

## 4. P3-3.1 食物名翻译查漏补缺 ✅

### 4.1 现状

已通过 `FoodI18nService.applyToMealRecommendation` 覆盖：
- `recommendation-engine.service.ts:354`
- `daily-plan.service.ts`
- `food.service.ts:268,275,449`

### 4.2 待补查点

| 位置 | 是否已应用 i18n | 处理 |
|---|---|---|
| `food.service.ts` 食物搜索 / 列表 / 详情 API | 抽样检查 | 缺失则补 |
| `pipeline-builder.service.ts` 中间产物（traces 中的 foodName） | 否 | 不需翻译（仅日志） |
| `explanation-generator.service.ts` reason 中的食物名 | 是（已用 locale） | 复查 |

### 4.3 具体修改

落地阶段：grep `name: food.name` / `foodName: food.name` 全代码库，列出所有「输出到响应」的位置，逐一接入 `foodI18nService.applyToMealRecommendation` 或 `applyToFoodList`（如有）。

> 本子项**不在本设计内列举具体清单**（执行阶段动态发现），但合并入 PR-3 与 P3-2.11 一起验收。

---

## 5. P3-3.2 `CHANNEL_TIME_MATRIX` 按 region 分桶 ✅

### 5.1 现状

`channel-availability.factor.ts:63`

```ts
const CHANNEL_TIME_MATRIX: Record<string, Record<TimeSlot, number>> = {
  // 全球共享：canteen × late_night = 0（无视 region 差异）
  ...
};
```

中区 24h 便利店 vs 美区便利店多数 23 点关门 → 同一矩阵无法表达。

### 5.2 数据模型

```ts
const CHANNEL_TIME_MATRIX_BY_REGION: Record<
  string,                                        // regionCode
  Record<string, Record<TimeSlot, number>>       // channel × timeSlot
> = {
  default: { /* 现有矩阵 */ },
  CN: {
    convenience_store: { breakfast: 1, lunch: 1, dinner: 1, late_night: 1, snack: 1 },
    canteen:           { breakfast: 1, lunch: 1, dinner: 1, late_night: 0, snack: 0 },
    restaurant:        { breakfast: 0.5, lunch: 1, dinner: 1, late_night: 0.5, snack: 0.5 },
    // ...
  },
  US: {
    convenience_store: { breakfast: 1, lunch: 1, dinner: 1, late_night: 0.3, snack: 1 },
    canteen:           { breakfast: 1, lunch: 1, dinner: 0.5, late_night: 0, snack: 0 },
    // ...
  },
  JP: { /* 24h 便利店全开 */ },
};
```

### 5.3 接口签名

```ts
export class ChannelAvailabilityFactor {
  constructor(
    private readonly channel: AcquisitionChannel,
    private readonly timeSlot: TimeSlot,
    private readonly regionCode: string = 'default',  // 新增
  ) {}

  // multiplier 计算
  private getMultiplier(): number {
    const regionMatrix = CHANNEL_TIME_MATRIX_BY_REGION[this.regionCode]
                      ?? CHANNEL_TIME_MATRIX_BY_REGION.default;
    return regionMatrix[this.channel]?.[this.timeSlot]
        ?? regionMatrix[AcquisitionChannel.UNKNOWN]?.[this.timeSlot]
        ?? 1.0;
  }
}
```

### 5.4 注入位置

`pipeline-builder.service.ts` 构造 `ChannelAvailabilityFactor` 时传入 `enrichedProfile.regionCode ?? DEFAULT_REGION_CODE`。

### 5.5 兼容 / 降级

- `regionCode` 不在矩阵中 → 用 `default`
- `default` 矩阵 = 现有全球矩阵原样保留 → 完全向后兼容

### 5.6 测试要点

| 场景 | 预期 |
|---|---|
| 美区 + late_night + convenience_store | multiplier=0.3 |
| 中区 + late_night + canteen | multiplier=0 |
| 日区 + late_night + convenience_store | multiplier=1 |
| 未知 region + 任意 | 等于 default 矩阵 |

---

## 6. P3-3.4 季节冲突（半球切换） ✅

### 6.1 现状

P2-2.7 `explanation-generator.ts` 已加 `monthToSeason(month, regionCode)`，对 8 个南半球国家做月份反相 → **解释文案侧**已部分修复。

但 `SeasonalityService.getSeasonalityScore` 仍直接用 `currentMonth` 索引 `monthWeights[]`，**评分侧**未做半球翻转。

### 6.2 未修风险位置

`utils/seasonality.service.ts:getSeasonalityScore`（具体行号在落地时确认）：

```ts
const month = new Date().getMonth();          // 0~11
const score = food.monthWeights[month] ?? 1.0;
```

如果 `food.monthWeights` 是按 region 写入（来自 `FoodRegionalInfo`，已分桶），则该位置**已无 bug**（写入端已按 region 反相）。

如果 `food.monthWeights` 是 `FoodLibrary.monthWeights`（食物本征属性，无 region 概念），则需在读取时做翻转。

### 6.3 落地步骤

1. **盘点**：确认 `getSeasonalityScore` 实际读哪一张表的 `monthWeights`。
2. 若读 `FoodRegionalInfo`：**已正确**，本子项关闭。
3. 若读 `FoodLibrary`：在调用处增加 region 翻转：

```ts
import { isSouthernHemisphere } from '../../../common/utils/timezone.util';

const rawMonth = new Date().getMonth();
const month = isSouthernHemisphere(regionCode)
  ? (rawMonth + 6) % 12
  : rawMonth;
```

4. 抽出 `isSouthernHemisphere` 到 `regional-defaults.ts`（与 P2-2.7 中的 `SOUTHERN_HEMISPHERE` 复用同一常量）。

### 6.4 测试要点

| 场景 | 预期 |
|---|---|
| 北京 7 月 + 北半球草莓（monthWeights[6]=0.9）| score=0.9 |
| 悉尼 7 月（南半球）+ 同食物 | score=monthWeights[0]=（冬季权重，应较低）|
| 默认 region 'US' | 与现状一致（北半球）|

---

## 7. 验收标准（汇总）

每项 PR 必须通过：

1. **类型检查**：`npx tsc --noEmit` exit=0
2. **单测**：新增/修改的服务方法对每个「测试要点」表项至少 1 个 case
3. **向后兼容**：所有新参数/字段为 optional；旧调用点无需改动即可工作
4. **trace 注入**：新增的决策点（region offset 命中、regionalFit 计算、半球翻转）在 `RecommendationTrace` / `factorTraces` 中可见
5. **配置可控**：所有阈值、权重、bias 表抽到 `regional-defaults.ts` 或 strategy 配置中
6. **无 db push**：如需 schema 变更，仅用 `migrate dev --create-only`

---

## 8. 与一轮 / 二轮文档关系

- 一轮：`RECOMMENDATION_REGIONAL_TIMEZONE_ANALYSIS.md`（基础接通）
- 二轮：`RECOMMENDATION_REGIONAL_TIMEZONE_DEEP_ANALYSIS.md`（遗留盘点）
- P0/P1 实施：见二轮文档 §5
- P2 实施：见 `RECOMMENDATION_P2_DESIGN.md`（已落地）
- **P3 实施：本文档**

---

## 9. PR 拆分与排期建议

| PR | 子项 | 工作量 | 风险 | 排期 | 状态 |
|---|---|---|---|---|---|
| PR-1 | P3-2.6 Weight-Learner 三层先验 | 中 | 中（涉及 Redis 写入路径 + 学习算法） | W1 | ✅ 已落地 |
| PR-2 | P3-2.4 + P3-3.3 规则推断注入 region | 中 | 低（默认值不动 → 等价旧行为） | W1 | ✅ 已落地 |
| PR-3 | P3-2.11 MOO regionalFit + P3-3.1 i18n 查漏 | 小 | 低 | W2 | ✅ 已落地 |
| PR-4 | P3-3.2 CHANNEL_TIME_MATRIX 分桶 | 小 | 低 | W2 | ✅ 已落地 |
| PR-5 | P3-3.4 季节冲突 | 小（盘点为主） | 极低 | W2 | ✅ 已落地 |

并行可行性：PR-1/2/3/4/5 之间无强依赖，可同时开工；PR-3 中 P3-3.1 需对全代码库做一次 grep 后再开 PR。

---

## 10. 二轮深度审计修复（R1–R9） ✅

二轮审计在 P3 全量落地后又发现 9 处遗留风险点；以下 7 项已闭环（R8/R9 验证为可接受现状或在 P3-3.5 已透出 trace）。

### R1 Cron 锁缺失 — `weight-learner.service.ts` ✅
- 发现：`@Cron('30 6 * * *') learn()` 多实例并发会重复学习/重复写 Redis。
- 基础设施：`RedisCacheService.runWithLock(lockName, ttlMs, fn)`（`redis-cache.service.ts:308`）已存在，6/7 cron 早已用。
- 修复：拆出 `runDailyCron()` 入口包 `runWithLock('weight-learner-daily', 60*60*1000, ...)`，原 `learn()` 保留供单测调用。

### R2 季节月份双时区 — `seasonality.service.ts` + pipeline ✅
- 发现：`getSeasonalityScore` 内部 `new Date().getMonth()+1` 与 ctx.userLocalDate 错位。
- 修复：`month` 入参由可选改为必填并校验范围 [1,12]；`PipelineContext.currentMonth: number` 必填；`pipeline-context-factory.service.ts:96` 用 `getUserLocalMonth(timezone)` 赋值；`food-scorer.service.ts` `scoreFood / scoreFoodsWithServing` 签名加 `currentMonth: number` 必填，全链路透传。

### R3 Cuisine 大小写/别名 — 全链路规范化 ✅
- 发现：`Sichuan` / `cantonese` / `szechuan` 等历史值与 canonical 12 项（前端 `onboarding-constants.ts:CUISINE_OPTIONS`）不一致，导致 cuisineMatch / cuisinePreferences 漏匹配。
- 修复：`apps/api-server/src/common/utils/cuisine.util.ts` 新增 `normalizeCuisine()`（含 sichuan/cantonese/szechuan/szechwan → `chinese` 归并）+ `normalizeCuisineWeights()` 等 helpers；`preferences-profile.ts:sanitizeCuisineWeights`、`profile-scoring-mapper.ts:cuisineMatch`、`food-scorer.service.ts:432` fallback、`preference-signal.factor.ts:209 cuisineAffinityRelative` 全部接入。

### R4 年龄基于 server timezone — `pipeline-builder.service.ts` ✅
- 发现：`buildNutritionTargets` 用 `new Date().getFullYear() - birthYear`，跨年时刻服务器/用户在不同 UTC 偏移会算错 ±1。
- 修复：改用 `getUserLocalDate(enrichedCtx?.timezone || DEFAULT_TIMEZONE).slice(0,4)` 取用户本地年份。

### R5 `(food as any).allergens` 散布 ✅
- 发现：`food-filter.service.ts:332,354`、`restriction-checks.service.ts:43` 用 `as any` 绕过类型，掩盖了 schema 演化风险。
- 修复：确认 `FoodLibrary.allergens: string[]`（`food.types.ts:161`）+ `CheckableFoodItem.allergens?: string[]`（`decision/checks/types.ts:36`）已定义；删除三处 cast。

### R6 admin 写后区域缓存 stale — `food-library-management.service.ts` ✅
- 发现：admin 改 food 后，`SeasonalityService` / `PreferenceProfileService` 缓存（`seasonality:region:{cc}` / `regional_boost:{cc}` 前缀）不会失效；listener 只监听 enrichment apply。
- 修复：注入 `EventEmitter2`，新增私有 `emitRegionInvalidation(foodId, source)`：查 `FoodRegionalInfo.distinct(countryCode)`（无关联回退 'US'），逐个发 `REGION_DATA_CHANGED`；在 `create / update / batchImport / toggleVerified / updateStatus / remove` 后调用（remove 在 delete **前**收集 cc）；`source` 复用现有 union `'admin_edit' | 'batch_import'`，避免改 schema。

### R7 weight-learner offsets length 不校验 — `applyOffsets` ✅
- 发现：`fuseOffsets` 已 `?? 0` 兜底，但 `applyOffsets(baseline, offsets)` 直接 `baseline[i] + offsets[i]`；当 `SCORE_DIMENSIONS` 维度变更而 Redis 缓存仍是老 length 时会 NaN 污染权重。
- 修复：`loadOffsets` 已有 `expectedLen` 校验；额外在 `applyOffsets` 内加 length 不匹配 warn 日志 + `offsets[i] ?? 0` 兜底，避免 NaN 透出。

### R8 其他 `as any` 残留 — 评估保留 ⚪
- 评估：剩余 `as any` 集中在 prisma DTO → schema 字段映射处（`food-library-management.service.ts` `data: ... as any`），属于 prisma 类型与 DTO 交互的常规处理；强类型化收益与改动面不成比例，本轮保留。

### R9 region bias trace 缺失 — P3-3.5 接线已透出 ✅
- 修复（P3-3.5 完成）：`profile-aggregator.service.ts` 调 `getCuisineRegionalBoostMap` + `mergeRegionalBoostMaps`；`PipelineContext` 加 `cuisinePreferenceRegions?: string[]`；`recommendation-trace.service.ts:PipelineSnapshot` 写入；trace 中可观察菜系偏好如何转换为区域 boost。

### 验收
- `npx tsc --noEmit -p apps/api-server/tsconfig.json` 全绿。
- 所有改动均向后兼容（无破坏性 schema 变更，DTO/参数皆 optional 或在调用方就近补默认）。

### 遗留待办（不在本批次）
- `scripts/normalize-cuisine.ts` 一次性数据补全脚本（DB 历史 cuisine 字段对齐 canonical）。
- `apps/admin/src/pages/recipe/list/index.tsx:45-56 CUISINE_OPTIONS` 与前端 `onboarding-constants.ts` 同步至 12 项 canonical。

---

> 本文档定稿后，每个 PR 实施前再做一次 git pull rebase + 二次确认依赖文件未被外部改动。
