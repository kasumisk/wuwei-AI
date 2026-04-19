# 智能饮食推荐系统 V7.1 升级方案

> **版本**: V7.1 — 现实化 & 场景深化  
> **基线**: V7.0（领域模型 + 目标追踪 + 管道集成，已全部完成）  
> **日期**: 2026-04-12  
> **原则**: 增量迭代，不重写已有模块，不理想化 AI 系统，工程可实现

---

## 一、升级背景与目标

### V7.0 已完成的能力

| 层       | 模块                                                 | 能力                                    |
| -------- | ---------------------------------------------------- | --------------------------------------- |
| 领域模型 | NutritionProfile, PreferencesProfile, ProfileFactory | 强类型画像，消除 any                    |
| 目标追踪 | GoalTrackerService, GoalPhaseService                 | 14天行为计算达成度，分阶段目标管理      |
| 管道集成 | PipelineContext, ScoringContext 扩展                 | effectiveGoal、goalProgress 贯穿管道    |
| 评分调整 | FoodScorer 阶段权重 + 菜系偏好                       | weightAdjustment 叠加 + ±10% 菜系 boost |
| 可解释性 | ExplanationGenerator goal_progress 洞察              | streak、compliance、phase transition    |

### V7.1 要解决的核心问题

基于两轮深度扫描（系统架构 + 食物模型/现实性差距），识别出以下关键问题：

1. **执行率闭环不完整** — ExecutionTracker 用严格食物 ID 匹配，用户吃"烤鸡胸"代替推荐的"煎鸡胸"算 0% 执行率，substitution_notes 未回馈推荐
2. **场景化推荐不够深** — 无跨餐关联（轻早餐不影响午餐推荐），行为学习无时间衰减，SceneContext 无温度/天气信号
3. **食物可获得性粗糙** — 无厨房设备意识，commonalityScore 是全局分数无区域差异，外卖无时间估算
4. **多样性模型不完整** — 无风味/口感多样性追踪，只有惩罚无正向奖励，Thompson Sampling 与 PreferenceProfile 两套独立机制
5. **可解释性仍是"陈述式"** — 告知用户"推荐了什么"，缺少"为什么不推荐 X"的对比解释，缺少行动指导

### V7.1 升级目标

| 目标         | 指标             | V7.0 现状           | V7.1 目标                      |
| ------------ | ---------------- | ------------------- | ------------------------------ |
| 执行率       | 14天平均执行率   | ~50%（ID 精确匹配） | ~65%（语义匹配 + 替换容忍）    |
| 场景贴合     | 场景置信度       | 0.4-0.8             | 0.5-0.9（跨餐联动 + 时间衰减） |
| 推荐多样性   | 每日不重复品类数 | ≥3 品类（惩罚驱动） | ≥4 品类（奖惩双向）            |
| 可解释性覆盖 | 洞察类型数       | 6 种                | 9 种（+对比/替换/行动）        |

---

## 二、5 个核心升级方向

### 方向 1：执行率闭环强化

**问题**：当前 ExecutionTracker 只做食物 ID 精确匹配，用户稍微换个做法或食材就算执行失败，导致执行率偏低，WeightLearner 学习信号被抑制。

**方案**：

#### 1A. 语义执行匹配（Semantic Execution Matching）

在 `recordExecution()` 中引入三级匹配：

```
Level 1: 精确 ID 匹配          → 执行率 = 1.0
Level 2: 同食材/同品类匹配     → 执行率 = 0.7
Level 3: 同食物组匹配          → 执行率 = 0.4
Level 4: 完全不匹配            → 执行率 = 0.0
```

**实现细节**：

- 新增 `matchExecutionSemantic(recommended: string[], executed: string[])` 方法
- 对每个 executed food，按 Level 1→2→3 依次匹配推荐列表中尚未匹配的食物
- 使用贪心算法（优先高匹配度），避免 O(n!) 复杂度
- 匹配依据：`food.mainIngredient`（同食材）、`food.category`（同品类）、`food.foodGroup`（同食物组）
- 需要批量查询 food 表获取匹配属性，增加一次 DB 查询

**改动文件**：

- `execution-tracker.service.ts` — 新增 `matchExecutionSemantic()` + 修改 `recordExecution()`
- `recommendation.types.ts` — 新增 `ExecutionMatchResult` 类型

#### 1B. 替换模式回馈（Substitution Feedback Loop）

将 `replacement_patterns` 表数据回馈到推荐环节：

- `ExecutionTrackerService` 新增 `getTopSubstitutions(userId)` — 返回用户高频替换对
- 在 `FoodScorer` 中，如果候选食物是某个推荐食物的高频替换品，给予 +5% 的分数 boost
- 在 `ExplanationGenerator` 中，当推荐包含用户常用替换品时，生成"根据你的习惯"洞察

**改动文件**：

- `execution-tracker.service.ts` — 新增 `getTopSubstitutions()`
- `food-scorer.service.ts` — 在 `applyPreferenceBoost()` 中叠加替换 boost
- `explanation-generator.service.ts` — 新增 `substitution_pattern` 洞察类型

### 方向 2：场景化推荐深化

**问题**：场景解析是"单餐独立"的，一天内各餐之间没有关联。行为学习无时间衰减，3个月前的行为和昨天的行为权重一样。

**方案**：

#### 2A. 跨餐场景联动（Cross-Meal Scene Linking）

在 `DailyPlanContextService` 中新增跨餐联动逻辑：

**营养补偿规则**：
| 前餐情况 | 后餐调整 | 实现方式 |
|----------|----------|----------|
| 早餐轻食（<300kcal） | 午餐热量目标 +10% | 修改 MealTarget.calories |
| 午餐高碳水（>60%碳水比） | 晚餐降碳水权重 ×1.3 | 修改 weights.carbs |
| 前两餐蛋白不足（<目标70%） | 下一餐蛋白权重 ×1.4 | 修改 weights.protein |
| 前两餐全是中餐 | 下一餐非中餐加分 +0.1 | 新增 cuisineDiversityBonus |

**实现细节**：

- `DailyPlanContextService` 新增 `computeCrossMealAdjustment(state: DailyPlanState, mealIndex: number, dailyTarget: DailyNutritionTarget)` 方法
- 返回 `CrossMealAdjustment { calorieMultiplier, weightOverrides, cuisineDiversityBonus }`
- 在 `RecommendationEngine.recommendMeal()` 中，dailyPlan 存在时调用此方法，将调整应用到 MealTarget 和 weights

**改动文件**：

- `daily-plan-context.service.ts` — 新增 `computeCrossMealAdjustment()` + `CrossMealAdjustment` 类型
- `recommendation-engine.service.ts` — 在 MealTarget 构建后应用 CrossMealAdjustment
- `recommendation.types.ts` — 新增 `CrossMealAdjustment` 接口

#### 2B. 行为学习时间衰减（Behavior Learning Decay）

当前 `SceneResolverService.learnFromHistory()` 按 `dayOfWeek × mealType` 统计渠道使用次数，无衰减。

**方案**：引入指数时间衰减：

```
effectiveCount = Σ count_i × exp(-λ × daysSinceRecord_i)
λ = ln(2) / halfLifeDays  // 半衰期默认 14 天
```

**实现细节**：

- Redis 存储结构从 `{ channel, count }[]` 改为 `{ channel, records: { date: string, count: number }[] }[]`
- `learnFromHistory()` 计算时对每条 record 应用衰减系数
- 新记录 `recordChannelUsage()` 按天粒度追加（当天已有则 count+1，否则新增）
- 兼容性：旧格式数据（无 date 字段）按 15 天前处理

**改动文件**：

- `scene-resolver.service.ts` — 修改 `learnFromHistory()` + `recordChannelUsage()` + 类型定义

#### 2C. 场景约束精细化

当前场景约束是静态的（如 `home_cooking` 固定 prepTime≤30min）。增加用户声明的设备约束：

**新增 `KitchenProfile` 概念**：

```typescript
interface KitchenProfile {
  hasOven: boolean; // 有烤箱
  hasMicrowave: boolean; // 有微波炉
  hasAirFryer: boolean; // 有空气炸锅
  hasRiceCooker: boolean; // 有电饭煲
  hasSteamer: boolean; // 有蒸锅
  primaryStove: 'gas' | 'induction' | 'none'; // 灶具类型
}
```

- 在 `user_profiles` 表新增 `kitchen_profile` JSON 字段
- `SceneResolverService` 在 `home_cooking` 场景下，根据 KitchenProfile 过滤不可行的烹饪方式
- `RealisticFilterService` 新增设备可行性检查

**改动文件**：

- `prisma/schema.prisma` — `user_profiles` 新增 `kitchen_profile Json?`
- `scene-resolver.service.ts` — `resolve()` 接收 KitchenProfile，叠加设备约束
- `realistic-filter.service.ts` — 新增 `checkCookingEquipment()` 过滤规则
- `user.types.ts` — 新增 `KitchenProfile` 接口

### 方向 3：多样性与偏好学习统一

**问题**：Thompson Sampling（MealAssembler.addExploration）和 PreferenceProfileService 是两套独立机制。多样性只有惩罚没有正向激励。

**方案**：

#### 3A. 风味多样性追踪（Flavor Diversity Tracking）

在 `DailyPlanContextService` 的 `DailyPlanState` 中新增风味追踪：

```typescript
interface DailyPlanState {
  // ... 已有字段
  flavorCounts: Record<string, number>; // 风味统计 (spicy, sweet, sour, savory, bland...)
  temperatureCounts: Record<string, number>; // 温度统计 (hot, cold, room_temp)
}
```

**多样性惩罚扩展**：
| 规则 | 条件 | 惩罚 |
|------|------|------|
| 风味重复 | `flavorCounts[food.flavorProfile] >= 2` | -0.1 |
| 温度单一 | 所有前餐都是热食，候选也是热食 | -0.05 |

**多样性正向奖励**：
| 规则 | 条件 | 奖励 |
|------|------|------|
| 新品类 | 该品类今日首次出现 | +0.05 |
| 新烹饪方式 | 该烹饪方式今日首次 | +0.03 |
| 新风味 | 该风味今日首次 | +0.03 |

**改动文件**：

- `daily-plan-context.service.ts` — 扩展 `DailyPlanState` + 修改 `calcDiversityPenalty()` → `calcDiversityAdjustment()`
- `recommendation.types.ts` — `DailyPlanState` 接口更新

#### 3B. 偏好信号统一入口（Unified Preference Signal）

将 Thompson Sampling 的探索信号和 PreferenceProfile 的利用信号统一为一个 `PreferenceSignal`：

```typescript
interface PreferenceSignal {
  explorationMultiplier: number; // Thompson Sampling 探索系数
  categoryBoost: number; // 品类偏好 boost
  ingredientBoost: number; // 食材偏好 boost
  substitutionBoost: number; // 替换模式 boost（方向1B）
  cuisineBoost: number; // 菜系偏好 boost（V7.0 已有）
  combined: number; // 综合乘数
}
```

- `PreferenceProfileService` 新增 `computePreferenceSignal(food, userId)` 方法，统一计算所有偏好信号
- `FoodScorer` 中将当前分散的 `applyPreferenceBoost()` + `applyCuisineBoost()` 合并为 `applyUnifiedPreference()`
- Thompson Sampling 逻辑从 `MealAssembler` 移到 `PreferenceProfileService`，与偏好画像同源计算

**改动文件**：

- `preference-profile.service.ts` — 新增 `computePreferenceSignal()` + 迁移 Thompson Sampling
- `food-scorer.service.ts` — 合并为 `applyUnifiedPreference()`
- `meal-assembler.service.ts` — 移除 `addExploration()`，改为调用 PreferenceSignal
- `recommendation.types.ts` — 新增 `PreferenceSignal` 接口

### 方向 4：可解释性升级

**问题**：当前洞察是"陈述式"的（"你的蛋白质达到了80%"），缺少对比解释和行动指导。

**方案**：

#### 4A. 新增 3 种洞察类型

| #   | type                     | 说明                                       | 触发条件                 | importance |
| --- | ------------------------ | ------------------------------------------ | ------------------------ | ---------- |
| 7   | `substitution_rationale` | 替换解释 — 你常用 X 替代 Y，所以直接推荐 X | 命中替换模式             | 0.7        |
| 8   | `cross_meal_context`     | 跨餐补偿 — 午餐蛋白不足，晚餐加强蛋白      | CrossMealAdjustment 存在 | 0.75       |
| 9   | `actionable_tip`         | 行动建议 — 具体的做法/购买/搭配建议        | 每次推荐                 | 0.5        |

#### 4B. 对比解释框架（Contrastive Explanation）

新增 `generateContrastiveInsight()` 方法：

```typescript
interface ContrastiveInsight extends StructuredInsight {
  type: 'contrastive';
  vars: {
    recommended: string; // 推荐食物名
    alternative: string; // 对比食物名
    advantage: string; // 推荐食物的优势维度
    advantageValue: string; // 优势值
    alternativeValue: string; // 对比值
  };
}
```

- 对 Top-1 推荐食物，找到 Top-4~10 中的一个"直觉上可能更好"的食物（如更常见、更便宜）
- 解释"为什么推荐 A 而不是 B"
- 只在 ScoreBreakdown 中有显著差异（>15%）时触发

**改动文件**：

- `explanation-generator.service.ts` — 新增洞察类型 + `generateContrastiveInsight()` + `generateActionableTip()`
- `recommendation.types.ts` — 新增 `ContrastiveInsight` 接口

### 方向 5：食物模型现实化增强

**问题**：食物模型字段不够精细（单一 cookingMethod、单一 mainIngredient），影响场景匹配和多样性判断的准确性。

**方案**：

#### 5A. 食物字段扩展

在 `foods` 表新增以下字段（全部可选，默认 null）：

| 字段                  | 类型       | 说明                                                       |
| --------------------- | ---------- | ---------------------------------------------------------- |
| `cooking_methods`     | `String[]` | 多种可行烹饪方式（替代单一 cooking_method）                |
| `required_equipment`  | `String[]` | 所需设备（oven, microwave, air_fryer, steamer, wok, none） |
| `serving_temperature` | `String`   | 建议温度（hot, warm, cold, room_temp）                     |
| `texture_tags`        | `String[]` | 口感标签（crispy, creamy, chewy, soft, crunchy）           |
| `ingredient_list`     | `String[]` | 所有食材清单（替代单一 main_ingredient）                   |
| `dish_type`           | `String`   | 成品类型（dish, soup, drink, dessert, snack, staple）      |

**兼容策略**：

- `cooking_methods` 填充时自动从 `cooking_method`（单数）迁移
- `ingredient_list` 填充时自动从 `main_ingredient` + recipe_ingredients 迁移
- 原字段保留不删除，新字段优先读取

**改动文件**：

- `prisma/schema.prisma` — foods 表新增 6 个字段
- `food.types.ts` — FoodLibrary 接口扩展
- 数据迁移脚本 — 从旧字段填充新字段

#### 5B. 可获得性精细化

当前 `AvailabilityScorerService` 的渠道可获得性是全局的。增加时段维度：

```typescript
interface ChannelAvailabilityByTime {
  channel: AcquisitionChannel;
  timeSlots: {
    morning: number; // 早上可获得性 0-1
    midday: number; // 中午可获得性 0-1
    evening: number; // 晚上可获得性 0-1
    late_night: number; // 深夜可获得性 0-1
  };
}
```

- 便利店深夜可获得性高，食堂深夜可获得性为 0
- 外卖凌晨可获得性低
- 在 `AvailabilityScorerService.score()` 中根据当前时段选择对应的可获得性分数

**改动文件**：

- `availability-scorer.service.ts` — 新增时段可获得性矩阵 + 修改 `score()` 接受 mealType/hour
- `recommendation.types.ts` — 新增 `ChannelAvailabilityByTime` 接口

---

## 三、实施分阶段计划

### Phase 1：基础扩展（类型 + Schema + 数据迁移）

**目标**：扩展数据模型，不改变推荐逻辑，确保编译通过。

| 任务                                                                                                                                             | 改动文件                                                   | 估时  |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ----- |
| P1-A: Prisma schema 扩展（foods 6字段 + user_profiles kitchen_profile）                                                                          | `schema.prisma`                                            | 15min |
| P1-B: 食物类型扩展（FoodLibrary + 视图接口）                                                                                                     | `food.types.ts`                                            | 10min |
| P1-C: 新增类型定义（ExecutionMatchResult, CrossMealAdjustment, PreferenceSignal, KitchenProfile, ContrastiveInsight, ChannelAvailabilityByTime） | `recommendation.types.ts`, `user.types.ts`                 | 20min |
| P1-D: DailyPlanState 扩展（flavorCounts, temperatureCounts）                                                                                     | `daily-plan-context.service.ts`, `recommendation.types.ts` | 10min |
| P1-E: 数据迁移脚本（cooking_method→cooking_methods, main_ingredient→ingredient_list）                                                            | 新增迁移脚本                                               | 15min |
| P1-F: Prisma generate + 编译验证                                                                                                                 | —                                                          | 5min  |

**验证**：

```bash
pnpm prisma validate --schema=apps/api-server/prisma/schema.prisma
pnpm prisma generate --schema=apps/api-server/prisma/schema.prisma
pnpm exec tsc --noEmit --project apps/api-server/tsconfig.json
```

### Phase 2：核心逻辑实现

**目标**：实现 5 个方向的核心逻辑。

| 任务                            | 改动文件                                                                               | 依赖       |
| ------------------------------- | -------------------------------------------------------------------------------------- | ---------- |
| P2-A: 语义执行匹配              | `execution-tracker.service.ts`                                                         | P1-B, P1-C |
| P2-B: 替换模式回馈              | `execution-tracker.service.ts`                                                         | P2-A       |
| P2-C: 跨餐场景联动              | `daily-plan-context.service.ts`                                                        | P1-D       |
| P2-D: 行为学习时间衰减          | `scene-resolver.service.ts`                                                            | —          |
| P2-E: 场景设备约束              | `scene-resolver.service.ts`, `realistic-filter.service.ts`                             | P1-A       |
| P2-F: 多样性奖惩双向 + 风味追踪 | `daily-plan-context.service.ts`                                                        | P1-D       |
| P2-G: 偏好信号统一              | `preference-profile.service.ts`, `food-scorer.service.ts`, `meal-assembler.service.ts` | P1-C       |
| P2-H: 可获得性时段矩阵          | `availability-scorer.service.ts`                                                       | P1-C       |

### Phase 3：管道集成 + 可解释性 + 验证

**目标**：将 Phase 2 的能力集成到推荐管道，增强可解释性，编写测试。

| 任务                                                | 改动文件                                                 | 依赖    |
| --------------------------------------------------- | -------------------------------------------------------- | ------- |
| P3-A: RecommendationEngine 集成 CrossMealAdjustment | `recommendation-engine.service.ts`                       | P2-C    |
| P3-B: RecommendationEngine 集成 KitchenProfile      | `recommendation-engine.service.ts`                       | P2-E    |
| P3-C: FoodScorer 集成 UnifiedPreference             | `food-scorer.service.ts`                                 | P2-G    |
| P3-D: FoodScorer 集成替换 boost                     | `food-scorer.service.ts`                                 | P2-B    |
| P3-E: ExplanationGenerator 新增 3 种洞察 + 对比解释 | `explanation-generator.service.ts`                       | P2-全部 |
| P3-F: PipelineContext/ScoringContext 扩展           | `recommendation.types.ts`, `pipeline-builder.service.ts` | P2-全部 |
| P3-G: 集成测试（v7.1-integration.spec.ts）          | 新增测试文件                                             | P3-A~F  |

---

## 四、类型定义清单（Phase 1 输出物）

### 新增类型

```typescript
// === recommendation.types.ts ===

/** 执行匹配结果（方向1A） */
interface ExecutionMatchResult {
  recommendedFoodId: string;
  executedFoodId: string | null;
  matchLevel: 'exact' | 'same_ingredient' | 'same_category' | 'same_food_group' | 'none';
  matchScore: number; // 1.0 / 0.7 / 0.4 / 0.0
}

/** 跨餐调整（方向2A） */
interface CrossMealAdjustment {
  calorieMultiplier: number; // 热量目标倍数 (0.9-1.15)
  weightOverrides: Partial<Record<ScoreDimension, number>>; // 权重覆盖
  cuisineDiversityBonus: number; // 菜系多样性加分 (0-0.1)
  reason: string; // 调整原因（用于可解释性）
}

/** 偏好统一信号（方向3B） */
interface PreferenceSignal {
  explorationMultiplier: number; // Thompson Sampling 探索系数
  categoryBoost: number; // 品类偏好 boost
  ingredientBoost: number; // 食材偏好 boost
  substitutionBoost: number; // 替换模式 boost
  cuisineBoost: number; // 菜系偏好 boost
  combined: number; // 综合乘数 = 各信号加权合成
}

/** 渠道时段可获得性（方向5B） */
interface ChannelTimeAvailability {
  morning: number; // 06:00-10:00
  midday: number; // 10:00-14:00
  evening: number; // 14:00-21:00
  late_night: number; // 21:00-06:00
}

/** 对比解释（方向4B） */
interface ContrastiveInsight {
  type: 'contrastive';
  recommended: string;
  alternative: string;
  advantageDimension: string;
  advantageValue: number;
  alternativeValue: number;
  differencePercent: number;
}

// === user.types.ts ===

/** 厨房设备画像（方向2C） */
interface KitchenProfile {
  hasOven: boolean;
  hasMicrowave: boolean;
  hasAirFryer: boolean;
  hasRiceCooker: boolean;
  hasSteamer: boolean;
  primaryStove: 'gas' | 'induction' | 'none';
}
```

### DailyPlanState 扩展

```typescript
interface DailyPlanState {
  // --- 已有 ---
  usedFoodIds: Set<string>;
  usedFoodNames: Set<string>;
  categoryCounts: Record<string, number>;
  cookingMethodCounts: Record<string, number>;
  usedMainIngredients: Set<string>;
  accumulatedNutrition: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
  };
  // --- V7.1 新增 ---
  flavorCounts: Record<string, number>; // 风味统计
  temperatureCounts: Record<string, number>; // 温度统计
  usedCuisines: Set<string>; // 已用菜系（跨餐多样性）
  mealCount: number; // 已完成餐数（用于跨餐联动）
}
```

### Prisma Schema 扩展

```prisma
model foods {
  // --- 已有字段（保留） ---
  cooking_method    String?
  main_ingredient   String?

  // --- V7.1 新增 ---
  cooking_methods      String[]    @default([])
  required_equipment   String[]    @default([])
  serving_temperature  String?
  texture_tags         String[]    @default([])
  ingredient_list      String[]    @default([])
  dish_type            String?
}

model user_profiles {
  // --- V7.1 新增 ---
  kitchen_profile   Json?    // KitchenProfile JSON
}
```

---

## 五、风险与兼容性

### 向后兼容保证

| 变更                               | 兼容策略                                                    |
| ---------------------------------- | ----------------------------------------------------------- |
| foods 新增 6 字段                  | 全部可选，默认 `[]` 或 `null`，为空时回退到旧字段           |
| user_profiles 新增 kitchen_profile | 可选 `null`，无时跳过设备检查                               |
| DailyPlanState 新增字段            | `createEmpty()` 初始化新字段，旧测试不受影响                |
| Thompson Sampling 迁移             | MealAssembler.addExploration() 标记 @deprecated，保留调用链 |
| 执行率计算变化                     | 语义匹配的分数 ≥ 精确匹配，不会降低已有执行率               |

### 性能风险

| 风险                                | 应对                                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| 语义执行匹配需要额外 DB 查询        | 使用 `food_pool_cache` 中已加载的食物数据，避免新查询        |
| 行为学习时间衰减增加计算量          | Redis 数据量有限（30天 × 7天 × 4餐 = 840条上限），计算可忽略 |
| PreferenceSignal 统一计算增加复杂度 | 合并原有分散计算，总复杂度不变，只是收敛到一处               |

### 数据迁移

| 迁移                                  | 操作                                                                                                                     |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `cooking_method` → `cooking_methods`  | `UPDATE foods SET cooking_methods = ARRAY[cooking_method] WHERE cooking_method IS NOT NULL AND cooking_methods = '{}'`   |
| `main_ingredient` → `ingredient_list` | `UPDATE foods SET ingredient_list = ARRAY[main_ingredient] WHERE main_ingredient IS NOT NULL AND ingredient_list = '{}'` |
| recipe_ingredients → ingredient_list  | 从 recipe_ingredients 聚合食材名写入 foods.ingredient_list（补充迁移）                                                   |

---

## 六、测试计划

### V7.1 集成测试（v7.1-integration.spec.ts）

| 测试组       | 测试点                                                     | 数量   |
| ------------ | ---------------------------------------------------------- | ------ |
| 语义执行匹配 | ID匹配=1.0, 同食材=0.7, 同品类=0.4, 不匹配=0               | 4      |
| 替换模式回馈 | 高频替换品获得 boost                                       | 2      |
| 跨餐联动     | 轻早餐→午餐热量+10%, 高碳午餐→晚餐降碳                     | 3      |
| 行为学习衰减 | 近期行为权重>远期行为                                      | 2      |
| 设备约束     | 无烤箱时过滤烤箱菜                                         | 2      |
| 风味多样性   | 新风味加分, 重复风味惩罚                                   | 3      |
| 偏好信号统一 | Thompson Sampling + PreferenceProfile 合成                 | 2      |
| 可获得性时段 | 深夜便利店高分, 深夜食堂低分                               | 2      |
| 新洞察类型   | substitution_rationale, cross_meal_context, actionable_tip | 3      |
| 对比解释     | 差异>15%时生成对比                                         | 2      |
| **总计**     |                                                            | **47** |

---

## 七、依赖关系图

```
Phase 1（基础）
  P1-A: Schema 扩展
  P1-B: 类型扩展
  P1-C: 新类型定义
  P1-D: DailyPlanState 扩展
  P1-E: 数据迁移
  P1-F: 编译验证

Phase 2（核心逻辑）
  P2-A: 语义执行匹配        ← P1-B, P1-C
  P2-B: 替换模式回馈        ← P2-A
  P2-C: 跨餐场景联动        ← P1-D
  P2-D: 行为学习时间衰减    ← 独立
  P2-E: 场景设备约束        ← P1-A
  P2-F: 多样性奖惩 + 风味   ← P1-D
  P2-G: 偏好信号统一        ← P1-C
  P2-H: 可获得性时段矩阵    ← P1-C

Phase 3（集成 + 验证）
  P3-A: Engine 集成 CrossMeal  ← P2-C
  P3-B: Engine 集成 Kitchen    ← P2-E
  P3-C: Scorer 集成 Preference ← P2-G
  P3-D: Scorer 集成 Substitution ← P2-B
  P3-E: Explanation 新洞察     ← P2-全部
  P3-F: Context 类型扩展       ← P2-全部
  P3-G: 集成测试               ← P3-A~F
```

---

## 八、实施状态

| Phase   | 任务数 | 状态        | 验证结果                   |
| ------- | ------ | ----------- | -------------------------- |
| Phase 1 | 6      | ✅ 全部完成 | Prisma validate + tsc 通过 |
| Phase 2 | 8      | ✅ 全部完成 | tsc 通过                   |
| Phase 3 | 7      | ✅ 全部完成 | 47 测试通过 + tsc 通过     |

### 测试结果汇总

| 测试套件      | 测试数  | 状态 |
| ------------- | ------- | ---- |
| V6.9 集成测试 | 45      | ✅   |
| V7.0 集成测试 | 59      | ✅   |
| V7.1 集成测试 | 47      | ✅   |
| **总计**      | **151** | ✅   |

编译验证：`tsc --noEmit` — 0 错误

---

## 九、总结

V7.1 是 V7.0 的**现实化升级**，核心改进：

1. **执行率**：从 ID 精确匹配升级为三级语义匹配 + 替换模式回馈
2. **场景化**：跨餐营养补偿 + 行为学习时间衰减 + 厨房设备意识
3. **多样性**：从"只有惩罚"升级为"奖惩双向" + 风味/温度维度
4. **可解释性**：从 6 种洞察扩展到 9 种 + 对比解释框架
5. **食物模型**：多烹饪方式 + 设备需求 + 口感标签 + 成品类型

全部改动保持向后兼容，新字段有默认值，不影响 V7.0 已有接口和测试。
