# 推荐系统现状文档（CURRENT STATE）

> 本文档基于 2026-05-02 仓库 HEAD 实际代码生成，**不引用** `docs/archive/intelligent-diet-system/INTELLIGENT_DIET_SYSTEM_V7_7.md`（已过时）。
> 所有事实均带 `file:line` 锚点；与代码注释自述出现矛盾的，已就地修正注释或在本文档中以 ⚠️ DISCREPANCY 标注。
> 交付分 3 批：**Batch 1**（第 1-4 章 + 总览）/ Batch 2（第 5-8 章）/ Batch 3（第 9-12 章 + 附录）。

---

## 0. 总览（Architecture Overview）

### 0.1 架构分层

```
┌──────────────────────────────────────────────────────────────────────┐
│  Entry  RecommendationEngineService（3 入口）                         │
│   ├─ recommendDailyPlan       完整一天 4 餐                           │
│   ├─ recommendMeal            指定单餐                                │
│   └─ recommendReplacement     单食物替换                              │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Context  PipelineContextFactory + ProfileAggregatorService           │
│   - 9 个画像/配置 DI（aggregator facade）                             │
│   - SceneResolver 4 层场景（explicit → 行为学习 → 规则 → general）    │
│   - ScoringConfigService 加载 12 大段配置                             │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Recall   PipelineBuilder.recallCandidates                            │
│   - 角色 → 类别集合过滤（无 quota）                                   │
│   - dietary / 过敏 / sodium / purine / fat / 预算 / 技能 / 渠道       │
│   - 三路合并（rule / semantic / cf）by RecallMergerService            │
│   - 兜底 ensureMinCandidates                                          │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Feasibility  RealisticCandidateFilter + RegionalCandidateFilter      │
│   - RealismLevel 4 档（strict/normal/relaxed/off）                    │
│   - 地区 availability + regulatoryInfo                                │
│   - MIN_CANDIDATES=5 兜底                                             │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Scoring  ScoringChainService（12 个 ScoringFactor，按 order 执行）   │
│   formula: score = score * multiplier + additive                      │
│   factor stack:                                                        │
│     preference-signal(10) → regional-boost(15) → price-fit(20) →     │
│     collaborative-filtering(?) → channel-availability(25) →           │
│     short-term-profile(25) → scene-context(30) →                      │
│     analysis-profile(35) → lifestyle-boost(40) → popularity(50) →     │
│     replacement-feedback(55) → rule-weight(60)                        │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Modify  HealthModifierEngine（5 层管道：veto/penalty/goal/condition/ │
│           bonus），L1 请求级 Map + L2 Redis 2h                        │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Assemble  MealAssembler                                              │
│   - diversify 硬约束（cat≤2 / mainIng≤1 / fg≤2）                      │
│   - addExploration（Thompson Sampling，per-food α/β）                 │
│   - cross-meal-rules（声明式跨餐规则引擎）                            │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Optimize  MultiObjectiveOptimizer + GlobalOptimizer                  │
│   - Pareto 6 维 + 加权和 + Pareto 层级奖励                            │
│   - 6 维偏差迭代贪心（默认 24 轮 / 替换分数下降 ≤25%）                 │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Learn  WeightLearner（4 层融合）+ LearnedRanking（周训）+            │
│         FactorLearner（Redis Hash 自适应 LR）+ StrategyAutoTuner       │
└──────────────────────────────────────────────────────────────────────┘
```

### 0.2 关键模块路径速查

| 类别 | 关键文件 |
|---|---|
| 入口 | `apps/api-server/src/modules/diet/app/services/recommendation-engine.service.ts:163,407,582` |
| 画像聚合 | `apps/api-server/src/modules/diet/app/recommendation/profile/profile-aggregator.service.ts` |
| 管线编排 | `apps/api-server/src/modules/diet/app/recommendation/pipeline/pipeline-builder.service.ts` |
| 场景解析 | `apps/api-server/src/modules/diet/app/recommendation/context/scene-resolver.service.ts` |
| 评分配置 | `apps/api-server/src/modules/diet/app/recommendation/context/scoring-config.service.ts` |
| 评分链 | `apps/api-server/src/modules/diet/app/recommendation/scoring-chain/scoring-chain.service.ts` |
| 因子目录 | `apps/api-server/src/modules/diet/app/recommendation/scoring-chain/factors/index.ts` |
| 三路召回合并 | `apps/api-server/src/modules/diet/app/recommendation/recall/recall-merger.service.ts` |
| 可行性过滤 | `apps/api-server/src/modules/diet/app/recommendation/filter/realistic-filter.service.ts` |
| 地区过滤 | `apps/api-server/src/modules/diet/app/recommendation/filter/regional-candidate-filter.service.ts` |
| 健康修正 | `apps/api-server/src/modules/diet/app/recommendation/modifier/health-modifier-engine.service.ts` |
| 餐次装配 | `apps/api-server/src/modules/diet/app/recommendation/meal/meal-assembler.service.ts` |
| 多目标优化 | `apps/api-server/src/modules/diet/app/recommendation/optimization/multi-objective-optimizer.ts` |
| 全局约束优化 | `apps/api-server/src/modules/diet/app/recommendation/optimization/global-optimizer.ts` |
| 4 层权重融合 | `apps/api-server/src/modules/diet/app/recommendation/optimization/weight-learner.service.ts` |
| 周训 LTR | `apps/api-server/src/modules/diet/app/recommendation/optimization/learned-ranking.service.ts` |
| 因子自学习 | `apps/api-server/src/modules/diet/app/recommendation/optimization/factor-learner.service.ts` |
| 跨餐规则 | `apps/api-server/src/modules/diet/app/recommendation/utils/cross-meal-rules.ts` |
| 季节服务 | `apps/api-server/src/modules/diet/app/recommendation/utils/seasonality.service.ts` |
| 渠道工具 | `apps/api-server/src/modules/diet/app/recommendation/utils/channel.ts` |
| 类型定义 | `apps/api-server/src/modules/diet/app/recommendation/types/{pipeline,scoring,scene,recommendation,strategy,config,recommendation-strategy}.types.ts` |
| 指标 | `apps/api-server/src/core/metrics/metrics.service.ts` |

---

## 1. 入口与编排（Entry & Orchestration）

### 1.1 三个入口

`apps/api-server/src/modules/diet/app/services/recommendation-engine.service.ts`：

| 入口 | file:line | 用途 |
|---|---|---|
| `recommendDailyPlan` | :163 | 完整一天 4 餐推荐 |
| `recommendMeal` | :407 | 指定单餐推荐 |
| `recommendReplacement` | :582 | 单食物替换推荐 |

三入口共享 PipelineContext 构建路径（第 2 章），但下游分别走"全餐贪心 + 全局优化"、"单餐装配"、"单点候选打分"。

### 1.2 ProfileAggregatorService（9 DI 聚合 facade）

`apps/api-server/src/modules/diet/app/recommendation/profile/profile-aggregator.service.ts`（289 行）。

聚合的下游服务（构造函数注入）：

1. UserPreferenceProfileService
2. ShortTermPreferenceService
3. AnalysisProfileService
4. PreferenceProfileService（V8 4 维 cache）
5. UserDeclaredPreferenceService
6. UserBudgetService
7. UserContextProfileService（contextualProfile：dayType/timezone/tier）
8. KitchenProfileService
9. UserMealHistoryService

聚合输出 `EnrichedUserProfile` 给 PipelineContextFactory 装配 `ctx.userProfile`、`ctx.shortTermProfile`、`ctx.analysisProfile`、`ctx.preferenceProfile`、`ctx.declaredPreference`、`ctx.budget`、`ctx.contextualProfile`、`ctx.kitchenProfile`、`ctx.mealHistory`。

> ⚠️ 当前聚合是**串行 await**（不是 Promise.all），P1 可优化为并行；本文档只记录现状。

### 1.3 上下文工厂

`apps/api-server/src/modules/diet/app/recommendation/context/pipeline-context-factory.service.ts` 是 PipelineContext 的唯一组装点：

- 调用 ProfileAggregator 取 9 维画像
- 调用 SceneResolver 解析 SceneContext（4 层优先级，第 2 章详述）
- 调用 ScoringConfigService 取 ScoringConfigSnapshot（含 12 大段，§ 2.4）
- 装入 `regionCode`（pipeline.types.ts:43，**optional**）、`channel`（normalize 后，§ 3）、`mealType`、`goalType`、`recommendationStrategy`
- `ctx.cuisinePreferences` 来自 `ctx.userProfile?.cuisinePreferences`（pipeline.types.ts:165）

PipelineContext 类型定义见 `apps/api-server/src/modules/diet/app/recommendation/types/pipeline.types.ts`。

---

## 2. 上下文构建（Context Building）

### 2.1 PipelineContext 字段总览

`apps/api-server/src/modules/diet/app/recommendation/types/pipeline.types.ts` 定义全字段：

| 区段 | 关键字段 |
|---|---|
| 基础 | userId / mealType / goalType / regionCode? / channel / locale |
| 用户画像 | userProfile（含 cuisinePreferences）/ declaredPreference / budget / kitchenProfile / contextualProfile |
| 行为画像 | shortTermProfile / analysisProfile / preferenceProfile / mealHistory |
| 场景 | scene（SceneContext，§ 2.3）/ realismLevel |
| 配置 | recommendationStrategy / scoringConfig（ScoringConfigSnapshot）/ allFoods |
| 学习 | factorAdjustments（FactorLearner 强度系数 Map）|
| Trace | trace（StageBuffer，给 Telemetry 用）|
| 约束 | maxSameCategory（recommendation-strategy.types.ts:124,158,201,244，默认 2，特殊场景 3）|

### 2.2 SceneResolver 4 层解析

`apps/api-server/src/modules/diet/app/recommendation/context/scene-resolver.service.ts`（751 行）。

优先级链：

1. **Explicit**：调用方直接传入 SceneContext
2. **行为学习**：Redis key `scene_pref:{userId}:{dayOfWeek}:{mealType}`，半衰期 14 天，λ = ln2/14；选历史最高的 channel/sceneType
3. **规则推断**：基于 `contextualProfile.dayType`（weekday/weekend）+ `mealType` 的硬规则（如 weekday lunch 默认 `CANTEEN` 或 `DELIVERY`）
4. **General**：兜底为 `HOME_COOK + UNKNOWN`

V7.1 P2-E 引入 KitchenProfile 设备约束注入：
- `EQUIPMENT_COOKING_MAP`：设备 → 烹饪法集合（如 oven → ['bake', 'roast', 'broil']）
- `STOVE_REQUIRED_METHODS`：依赖灶台的方法（如 stir_fry, deep_fry, pan_fry）

### 2.3 SceneContext 4 层结构

```ts
interface SceneContext {
  channel: 'home_cook' | 'restaurant' | 'delivery' | 'canteen' | 'convenience' | 'unknown';
  sceneType: SceneType;       // HOME_COOK / RESTAURANT / DELIVERY / CANTEEN / CONVENIENCE / UNKNOWN
  realismLevel: RealismLevel; // strict / normal / relaxed / off（§ 4.3）
  kitchenProfile?: KitchenProfile;
}
```

### 2.4 ScoringConfigSnapshot 加载链路

`apps/api-server/src/modules/diet/app/recommendation/context/scoring-config.service.ts`：

| 步骤 | file:line | 说明 |
|---|---|---|
| 入口 | `getConfig(shard?)` :119-153 | 内存命中即返回 |
| Redis L2 | `loadConfig` :250-256 | key = `this.CACHE_KEY` |
| Prisma L3 | :263-265 | `featureFlag.findUnique({ key: 'scoring_config_v68' })` |
| Fallback | :268-272 | 回退 `scoring_config_v67` |
| 合并默认 | :274-280 | `mergeWithDefaults(flag.config)` 或 `getDefaults()` |
| 写回 Redis | :287-289 | |
| 分片覆盖 | `loadShardConfig(shard)` :341-395 | 按 `scoring_config_shard_{goalType}_{season}_{dayType}` 等 5 级 key 顺序 |
| Admin 写入 | `apps/api-server/src/modules/diet/admin/controllers/scoring-config.controller.ts:16,41,63` | upsert featureFlag → 刷 Redis |

ScoringConfigSnapshot 接口：`apps/api-server/src/modules/diet/app/recommendation/types/config.types.ts:40-311`，关键字段：

- `semanticOnlyWeight`（:70，默认 **0.7**）
- `cfOnlyWeight`（:72，默认 **0.6**）
- `maxCandidatesPerCategoryForNonRule`（:74，默认 **5**）
- 默认值定义于 `scoring-config.service.ts:650-836`（`getDefaults()`，三字段位于 :674-676）
- 实际消费点：`recall-merger.service.ts:91-97`

> ⚠️ DB 模型走通用 `featureFlag` 表（key 为字符串），**没有独立 ScoringConfig 表**。

### 2.5 SceneScoringProfile（V7.3 配置驱动）

`SceneContextFactor`（§ 6.6）启动时从 ScoringConfigSnapshot 读取 `SceneScoringProfile.dimensionWeightAdjustments`，写入 `ctx.sceneDimensionAdjustments`，由该因子的 `computeAdjustment` 消费。

---

## 3. 渠道与归一化（Channel Normalization）

### 3.1 KNOWN_CHANNELS

`apps/api-server/src/modules/diet/app/recommendation/utils/channel.ts`（P0-3 落地）：

```ts
export const KNOWN_CHANNELS = ['home_cook','restaurant','delivery','canteen','convenience','unknown'] as const;
export function normalizeChannel(input?: string | null): KnownChannel { ... }
```

- 大小写归一化（lower + 去空格 + 别名映射）
- 未知值 → `'unknown'` + 触发 `MetricsService` Counter `recommendation_unknown_channel_total{source}`

### 3.2 上下游 normalize 点

| 位置 | file:line | 用途 |
|---|---|---|
| Precompute 写入端 | `apps/api-server/src/modules/diet/app/services/precompute.service.ts` | 写入前 normalize + warn |
| Precompute 读取端 | 同上 | 读取后 normalize + warn |
| Pipeline 上下文 | `pipeline-context-factory.service.ts` | 注入 `ctx.channel` 前 normalize |
| food-plan 控制器 | `food-plan.controller` | TODO(P1)，目前裸传 |

### 3.3 渠道矩阵（CHANNEL_TO_SOURCES）

`pipeline-builder.service.ts:412-442`（**作用域为 recallCandidates 内部 const**，不是独立常量文件）：

| channel | sources |
|---|---|
| `home_cook` | supermarket, wet_market, farmers_market, online, specialty_store, butcher, butcher_shop, bakery, pharmacy, traditional_chinese_medicine_store, chinese_medicine_store |
| `delivery` | restaurant, takeout, fast_food, delivery, convenience_store, bakery |
| `restaurant` | restaurant |
| `convenience` | convenience_store, convenience, supermarket, bakery |
| `canteen` | restaurant, canteen |
| `unknown` | （L410 提前 return，不过滤）|

### 3.4 渠道 × 类别可用性矩阵（评分阶段使用）

`apps/api-server/src/modules/diet/app/recommendation/scoring-chain/factors/channel-availability.factor.ts:25-56`：

| channel \ category | protein | grain | veggie | fruit | dairy | composite | snack | beverage | fat | condiment |
|---|---|---|---|---|---|---|---|---|---|---|
| `HOME_COOK` | 0.9 | 0.95 | 0.9 | 0.85 | 0.85 | 0.6 | 0.7 | 0.8 | 0.9 | 0.95 |
| `DELIVERY` | 0.7 | 0.8 | 0.6 | 0.4 | 0.5 | 0.9 | 0.5 | 0.7 | 0.3 | 0.2 |
| `CONVENIENCE` | 0.3 | 0.6 | 0.2 | 0.5 | 0.8 | 0.7 | 0.95 | 0.95 | 0.1 | 0.1 |
| `CANTEEN` | 0.8 | 0.9 | 0.85 | 0.5 | 0.4 | 0.85 | 0.3 | 0.6 | 0.3 | 0.3 |
| `RESTAURANT` | 0.8 | 0.7 | 0.7 | 0.4 | 0.5 | 0.95 | 0.4 | 0.8 | 0.3 | 0.3 |
| `UNKNOWN` | 0.7 | 0.8 | 0.7 | 0.6 | 0.6 | 0.7 | 0.6 | 0.7 | 0.5 | 0.5 |

时段乘子 `DEFAULT_CHANNEL_TIME_MATRIX`（:72-79）+ 区域覆写 `CHANNEL_TIME_MATRIX_BY_REGION`（CN/JP/US，:81-100）按 `morning/midday/evening/lateNight` 分时段叠乘。

---

## 4. 召回层（Recall）

### 4.1 角色 → 类别映射（ROLE_CATEGORIES）

`apps/api-server/src/modules/diet/app/recommendation/types/scoring.types.ts:369-379`（recommendation.types.ts:78 仅 re-export，无独立定义）：

| role | categories |
|---|---|
| `carb` | `['grain', 'composite']` |
| `protein` | `['protein', 'dairy']` |
| `protein2` | `['protein', 'dairy']`（Bug13 第二蛋白槽位）|
| `protein3` | `['protein', 'dairy']`（P0-A 第三蛋白槽位）|
| `veggie` | `['veggie']` |
| `side` | `['veggie', 'dairy', 'beverage', 'fruit']` |
| `snack1` | `['fruit', 'snack', 'dairy']` |
| `snack_protein` | `['protein', 'dairy', 'snack']`（muscle_gain snack protein-first）|
| `snack2` | `['beverage', 'snack', 'fruit']` |

> ⚠️ **不存在 `staple` / `main` / `dessert` / `drink` / `soup` 角色**。汤/饮品通过 `side` slot 命中 `beverage` 类别承担。

`MEAL_ROLES`（scoring.types.ts:351-356）与 `MUSCLE_GAIN_MEAL_ROLES`（:362-367）决定每餐使用哪些角色，由 `buildMealRoles()`（:394-）动态生成（含可选 `protein3`）。

### 4.2 recallCandidates 过滤链（pipeline-builder.service.ts:249-468）

严格顺序，每一步都可减少候选数：

| # | file:line | 过滤逻辑 | 备注 |
|---|---|---|---|
| 1 | :255-258 | `roleCategories ← mealPolicy?.roleCategories?.[role] ?? ROLE_CATEGORIES[role] ?? []`；`f.category ∈ roleCategories` | mealPolicy 来自 `ctx.resolvedStrategy?.config?.meal` |
| 2 | :258 | usedNames 去重 | |
| 3 | :262-265 | mealType 适配 | |
| 4 | :268-273 | excludeTags | |
| 5 | :278-286 | `foodViolatesDietaryRestriction`（§ 4.4）| |
| 6 | :289-291 | excludeIsFried | |
| 7 | :294-297 | maxSodium | |
| 8 | :300-303 | maxPurine | |
| 9 | :306-309 | maxFat | |
| 10 | :312-314 | allergens | |
| 11 | :320-337 | commonalityThreshold（默认 20）| |
| 12 | :344-348 | budget cap：`BUDGET_CAP = { low:3, medium:4, high:5 }` | |
| 13 | :358-367 | beginner → 排除 advanced | 与 RealisticFilter § 5.6 重叠 |
| 14 | :371-389 | shortTermProfile.rejectedFoods，阈值 `recallConfig?.shortTermRejectThreshold ?? 2` | |
| 15 | :392-402 | analysisProfile.recentRiskFoods | |
| 16 | :410-468 | channel → CHANNEL_TO_SOURCES 矩阵（§ 3.3）| `unknown` 跳过 |
| 17 | :471-542 | 三路召回合并（§ 4.5）| |
| 18 | :545-548 | 三路合并后 mealType 二次门控 | |
| 19 | :551-565 | 兜底：候选为空 → ctx.allFoods 全集 | |

> ⚠️ **recall 阶段无 quota 概念**——全仓 grep `quota|Quota|roleQuota|categoryQuota|slotQuota` 在 `recommendation/` 下零命中。仅做"角色 → 类别集合"过滤。

### 4.3 ensureMinCandidates 兜底

`pipeline-builder.service.ts:94-141`：默认 `minCount=3 / fallbackLimit=10`。**保留所有硬约束**（dietary / isFried / maxSodium / maxPurine / maxFat），其他维度可放宽以补足候选。

### 4.4 dietary 硬过滤完整规则

实现在 `apps/api-server/src/modules/diet/app/recommendation/pipeline/food-filter.service.ts`，分两个版本：

- 实例方法版：`FoodFilterService.violatesDietaryRestriction` :291-387
- 独立函数版：`foodViolatesDietaryRestriction` :463-534（pipeline-builder 复用）

判定字段：`foodGroup`（fg）/ `category`（cat）/ `mainIngredient`（mi）/ `tags` / `allergens` / `name`。

| 限制 | 实例版 | 独立版 | 关键判据 |
|---|---|---|---|
| `vegetarian` | :300-316 | :473-480 | MEAT_FG/SEAFOOD_FG/MEAT_MI/SEAFOOD_MI 命中；`fg='egg'`；mi=`egg/chicken egg/duck egg`；`cat='protein'` 且 `fg ∉ NON_MEAT_FG` |
| `vegan` | :317-332 ✅ | :481-487 | 同 vegetarian + `fg='dairy'/'egg'`；mi=`milk/egg/cheese/yogurt/cream` |
| `pescatarian` | :333-336 | :487-489 | 仅 MEAT_FG / MEAT_MI（保留鱼/海鲜）|
| `lactose_free` | :337-353 | :489-501 | allergens 含 dairy/milk/lactose；`fg='dairy'`；mi=milk/cheese/yogurt/cream |
| `no_beef` | :354-359 | :501-506 | `fg='beef'`；mi=`beef/牛肉`；name 含 `beef` |
| `gluten_free` | :360-365 | :506-511 | allergens 含 gluten/wheat；`fg='wheat'/'flour'` |
| `halal` | :366-380 | :512-525 | `fg='pork'/'processed_meat'`；mi=`pork/bacon/ham/lard/猪肉`；tags 含 `alcohol/alcoholic` |
| `kosher` | :381-393 | :525-531 | `fg='pork'`；mi=`pork/bacon/ham/猪肉`；`SEAFOOD_FG.has(fg) && fg!=='fish'` |

> ✅ 历史曾在实例版 vegan 分支缺 `mi==='cream'` 检查（与独立版不等价）；本批已修复使两版一致（commit pending）。

关键集合（独立版 :392-457）：

- **MEAT_FG**：pork, beef, chicken, poultry, lamb, duck, goose, game, organ, meat, processed_meat
- **SEAFOOD_FG**：seafood, fish, shellfish, shrimp, crab
- **MEAT_MI**：pork, beef, chicken, lamb, duck, goose, turkey, organ meat, bacon, sausage, ham
- **SEAFOOD_MI**：fish, shrimp, crab, lobster, squid, octopus, clam, mussel, oyster, scallop, abalone, sea cucumber
- **NON_MEAT_FG**：vegetable, fruit, grain, legume, nut, seed, tuber, mushroom, oil, condiment, seasoning, spice, herb, cereal, dairy, beverage, tea, coffee, juice, water, soy, tofu（**不含 egg**，:453 注释 "#fix Bug15: 中国市场素食不含蛋"）
- 实例版 `NON_MEAT_FOOD_GROUPS`（:214-238）等价。

### 4.5 三路召回合并（RecallMergerService）

`apps/api-server/src/modules/diet/app/recommendation/recall/recall-merger.service.ts:67-202`，调用方 `pipeline-builder.service.ts:518-527`。

#### 4.5.1 三路来源

`rule` / `semantic` / `cf`（:39）。

#### 4.5.2 默认权重常量（:70-74）

```ts
DEFAULT_SEMANTIC_ONLY_WEIGHT = 0.7
DEFAULT_CF_ONLY_WEIGHT = 0.6
DEFAULT_MAX_PER_CATEGORY = 5
```

实际取值（:91-97）：`config?.semanticOnlyWeight ?? DEFAULT_SEMANTIC_ONLY_WEIGHT`，配置来源 ScoringConfigSnapshot（§ 2.4）。

#### 4.5.3 ruleWeight 注入规则

| 命中模式 | ruleWeight | file:line |
|---|---|---|
| 规则路 | `1.0` | :110 |
| 仅语义命中 | `semanticOnlyWeight`（默认 0.7）| :140 |
| 仅 CF 命中 | `cfOnlyWeight`（默认 0.6）| :182 |
| 规则 + 语义命中 | 保持 `1.0` | :132 注释 |
| 非规则路 + CF 加成 | `min(1.0, ruleWeight + 0.1)` | :165 |

`RuleWeightFactor`（§ 6.9）在评分阶段消费 `food.__ruleWeight` 作为 multiplier，仅当 `<1.0` 时生效。

#### 4.5.4 品类限额

`enforceCategoryLimit()` :273-293，仅对**非规则路**候选按 `category` 计数 ≤ `maxPerCategory`，**规则路不限制**（:286）。

#### 4.5.5 CF-only 食物补全

CF-only 候选 `food=null`，由 `toFoodListWithAllFoods()`（:210-242）通过 `allFoodsMap.get(foodId)` 还原。

#### 4.5.6 触发条件与降级

- 触发：`vectorConfig?.enabled && weight>0 && ctx.userId`（pipeline-builder.service.ts:471-477）
- 失败降级：纯规则路（:538-541）

#### 4.5.7 Telemetry

`pipeline-builder.service.ts:530-537`：

```ts
writeStageBuffer(ctx.trace, 'recallMerge', {
  ruleCandidates, semanticCandidates, cfCandidates, mergedTotal
})
```

### 4.6 Recall 阶段 Counter 埋点（P0-4）

`apps/api-server/src/core/metrics/metrics.service.ts` 已落地 5 个 Counter，其中召回相关：

- `recommendation_unknown_channel_total{source}`
- `recommendation_dietary_filter_total{restriction}`
- 其余（健康否决 / scene 解析失败 / cache hit）见后续章节

---

## A. 能力全景表（Capability Inventory）

> 成熟度定义：**高** = 完整实现且接入主链路；**中高** = 实现完整但部分路径可选/降级；**中** = 基础实现，边缘情况未覆盖；**低** = 代码存在但未接入主链路；**未解决** = 已知缺陷/技术债，尚无修复。

### A.1 召回与过滤能力

| 能力 | 关键实现 | 成熟度 |
|---|---|---|
| 角色化召回 | `ROLE_CATEGORIES` 9 个 slot（carb/protein/protein2/protein3/veggie/side/snack1/snack_protein/snack2）；`buildMealRoles()` 动态生成 protein3（targetProtein/25≥3）`scoring.types.ts:369-419` | 高 |
| Dietary 硬过滤 | 8 种限制（vegetarian/vegan/pescatarian/lactose_free/no_beef/gluten_free/halal/kosher），双版本（实例版+独立函数版），判定字段 fg/cat/mi/tags/allergens `food-filter.service.ts:291-534` | 高 |
| 三路语义召回合并 | rule(1.0) / semantic(0.7) / cf(0.6)，品类限额 DEFAULT_MAX_PER_CATEGORY=5（仅非规则路），降级纯规则路 `recall-merger.service.ts:67-202` | 中高 |
| 过敏原硬排除 | `food.allergens` 数组匹配，不受 RealismLevel 影响，recall 阶段 + healthModifier 双重拦截 | 高 |
| commonality 阈值过滤 | recall 默认阈值 20；RealisticFilter 按 RealismLevel 4 档（strict:40/normal:30/relaxed:10/off:0）`scene.types.ts:263-296` | 高 |
| 渠道来源过滤 | CHANNEL_TO_SOURCES 5 channel × N source，unknown 跳过 `pipeline-builder.service.ts:412-442` | 高 |
| shortTerm 排斥过滤 | rejectedFoods 阈值 `recallConfig?.shortTermRejectThreshold ?? 2` `pipeline-builder.service.ts:371-389` | 高 |
| recentRiskFoods 排除 | analysisProfile.recentRiskFoods 硬排除 `pipeline-builder.service.ts:392-402` | 高 |
| ensureMinCandidates 兜底 | minCount=3/fallbackLimit=10，保留硬约束 `pipeline-builder.service.ts:94-141` | 高 |

### A.2 可行性层能力

| 能力 | 关键实现 | 成熟度 |
|---|---|---|
| RealismLevel 4 档 | strict/normal/relaxed/off，场景默认映射（CANTEEN→strict/HOME_COOK→normal/DELIVERY→relaxed）`scene.types.ts:263-308` | 高 |
| cookTimeCap 过滤 | weekday/weekend 双阈值；weekday+lunch→45min；weekday+breakfast→20min；snack→10min；HOME_COOK 专属 `realistic-filter.service.ts:151-197` | 高 |
| 预算过滤 | BUDGET_COST_CAP low:3/medium:4/high:5（两处独立定义但数值一致）`realistic-filter.service.ts:64-68` | 高 |
| 食堂模式 | canteen channel 或 canteenMode=true → commonality 阈值提升至 max(preset,60) `realistic-filter.service.ts:168-179` | 高 |
| 烹饪技能过滤 | SKILL_LEVEL_MAP(easy/beginner=1/medium/intermediate=2/hard/advanced=3)，HOME_COOK 专属，按用户技能自身为上限 `realistic-filter.service.ts:182-197` | 高 |
| 设备约束过滤 | KitchenProfile×EQUIPMENT_COOKING_MAP→unavailableMethods，STOVE_REQUIRED_METHODS，`checkCookingEquipment()` `realistic-filter.service.ts:200-210` | 高 |
| MIN_CANDIDATES=5 兜底 | 按 commonalityScore 降序回填，各维度内部亦有局部短路 `realistic-filter.service.ts:51,214-238` | 高 |
| ⚠️ 死配置 | `RealismPreset.maxSkillLevel` 和 `equipmentFilterEnabled` 字段在 `filterByRealismLevel` 中**未被消费**（preset 有值但未映射到 RealismConfig）`scene.types.ts:255,270` | 低 |
| 地区可用性过滤 | UNAVAILABLE_STATUSES={RARE,LIMITED} 剔除；regulatoryInfo.forbidden 剔除；MIN_CANDIDATES=5 兜底 `regional-candidate-filter.service.ts:20-23` | 高 |

### A.3 评分链能力

| 能力 | 关键实现 | 成熟度 |
|---|---|---|
| 12 因子评分链 | `ScoringChainService`，按 order 升序执行，公式 `score = score*multiplier + additive` `scoring-chain.service.ts` | 高 |
| 偏好信号（order=10） | loves×1.12/avoids×0.3；4 维画像权重直乘；cuisine 相对亲和度 log 映射；声明偏好 cap=0.15 `preference-signal.factor.ts:119` | 高 |
| 地区增益（order=15） | 从 `ctx.regionalBoostMap`（foodId→乘数 0.70~1.20）读取；regionalBoostMap 由 `PreferenceProfileService.computeBoostMapForRegion()` 按 availability+localPopularity 计算，叠加 cuisine 偏好来源国 boost map，取 max 合并；Redis TTL=CACHE_TTL_MS；regionCode 隔离防跨区污染（P0-2）`regional-boost.factor.ts:14-44` / `preference-profile.service.ts:194-290` | 高 |
| 价格适配（order=20）路径A精确预算 | P2-2.2 新增；触发条件：`userProfile.declared.budgetPerMeal + currencyCode`；数据源：`SeasonalityService.getPriceInfo(foodId, regionCode)`（Redis/DB 两层缓存）；跨币种直接跳过（无汇率依赖）；priceUnit 非 per_serving 回退路径B；评分曲线：priceMid≤budget→1.05 / ≤130%→0.85 / ≤180%→0.70 / >180%→0.60 `price-fit.factor.ts:56-205` | 高 |
| 价格适配（order=20）路径B粗粒度 | 旧逻辑 fallback；budgetLevel→BUDGET_MAX_COST(low:2/medium:3/high:5)；超出1级→0.85/2级→0.70/3+级→0.60 `price-fit.factor.ts:43-54` | 高 |
| 协同过滤（order=?） | CF 召回路 ruleWeight 加成，与 RecallMerger 联动 `collaborative-filtering.factor.ts` | 中高 |
| 渠道可用性（order=25） | CHANNEL_CATEGORY_MATRIX 6×10 乘子 + CHANNEL_TIME_MATRIX 4时段（morning/midday/evening/lateNight） + **P3-3.2 区域覆写(CN/JP/US)**（CN午餐外卖峰值0.98，JP便利店全时段0.95，US早餐外送0.4）；最终 clamp 1.1；localHour 由 `getUserLocalHour(timezone)` 解析 `channel-availability.factor.ts:72-134` | 高 |
| 短期画像（order=25） | boostRange=[0.9,1.1]，singleRejectPenalty=0.85，minInteractions=3 `short-term-profile.factor.ts` | 高 |
| 场景上下文（order=30） | SceneScoringProfile.dimensionWeightAdjustments，clamp [0.8,1.2]，消费 factorStrengthOverrides `scene-context.factor.ts:65` | 高 |
| 分析画像（order=35） | categoryInterestPerCount=0.02/cap=0.08；riskFoodPenalty=0.7 `analysis-profile.factor.ts` | 高 |
| 生活方式增益（order=40） | nutrientBoost clamp [0.85,1.15]，deltaMul=0.05 `lifestyle-boost.factor.ts` | 高 |
| 热门度（order=50） | popularity 数据 `popularity.factor.ts` | 中 |
| 替换反馈（order=55） | replacement_patterns A→B 频率 `replacement-feedback.factor.ts` | 中 |
| 规则权重（order=60） | `food.__ruleWeight`，仅 <1.0 时乘入 `rule-weight.factor.ts` | 高 |
| factorStrengthOverrides | strategy×FactorLearner 相乘，`mergeStrategyFactorOverrides()` `pipeline-builder.service.ts:743-767` | 高 |

### A.4 健康修正能力

| 能力 | 关键实现 | 成熟度 |
|---|---|---|
| 过敏原一票否决 | `matchAllergens()` 命中 → multiplier=0；transFat>2g/100g → multiplier=0 `health-modifier-engine.service.ts:316-339` | 高 |
| 12 种健康状况管理 | DIABETES_TYPE2/HYPERTENSION/HYPERLIPIDEMIA/GOUT/KIDNEY_DISEASE/FATTY_LIVER/CELIAC_DISEASE/IBS/IRON_DEFICIENCY_ANEMIA/OSTEOPOROSIS/CARDIOVASCULAR/THYROID `health.types.ts:14-38` | 高 |
| severity 加权 | mild:0.6/moderate:1.0/severe:1.3；惩罚 `1-(1-base)*sev`；增益 `1+(base-1)*sev` `health-modifier-engine.service.ts:1011-1054` | 高 |
| 目标惩罚（goal-aware） | fat_loss+sugar>15→×0.9；muscle_gain+蛋白比<5%→×0.9 `health-modifier-engine.service.ts:461-493` | 高 |
| 6 种 bonus 增益 | HYPERLIPIDEMIA+Omega3→1.15；DIABETES+GI<40→1.10；HYPERTENSION+高钾低钠→1.12；ANEMIA+铁>3→1.10；OSTEOPOROSIS+钙>100→1.10；CARDIOVASCULAR+Omega3/高纤维→1.15/1.10 | 高 |
| L1+L2 缓存 | L1 请求级 Map；L2 Redis 2h，key=`health_mod:{sha256(allergens|conditions|goal).slice(0,16)}:{foodId}` `health-modifier-engine.service.ts:84-141` | 高 |
| i18n reasonKey | `t(key, params)`，3 locale(zh-CN/en-US/ja-JP)，FALLBACK='en-US' `i18n-messages.ts:33,101-128` | 高 |

### A.5 装配与多样性能力

| 能力 | 关键实现 | 成熟度 |
|---|---|---|
| 角色装配（贪心） | 每餐按 MEAL_ROLES/MUSCLE_GAIN_MEAL_ROLES 顺序选最高分 `meal-assembler.service.ts` | 高 |
| diversify 硬约束 | cat≤2/mainIngredient≤1/foodGroup≤2，装配时实时检查 `meal-assembler.service.ts:43-80` | 高 |
| Thompson Sampling 探索 | per-food α=accept+1/β=reject+1，Beta 分布采样；addExploration `meal-assembler.service.ts:148-169` | 高 |
| 自适应探索率 | `baseRate=0.15 × exp(-interactions/100) × (1-tsConvergence×0.8)`，clamp [0.02,0.15] `strategy-auto-tuner.service.ts:394-407` | 高 |
| 跨餐补偿规则引擎 | 4 条声明式规则（light-breakfast/high-carb-lunch/protein-deficit/cuisine-monotony），priority 升序叠加 `cross-meal-rules.ts` | 高 |
| MEAL_ROLES 完整集合 | breakfast:[carb,protein,side] / lunch:[carb,protein,veggie] / dinner:[protein,veggie,side] / snack:[snack1,snack2] `scoring.types.ts:351-356` | 高 |
| MUSCLE_GAIN_MEAL_ROLES | breakfast:[carb,protein,protein2] / lunch:[carb,protein,protein2,veggie] / dinner:[protein,protein2,veggie,side] / snack:[snack_protein,snack2] `scoring.types.ts:362-367` | 高 |
| buildMealRoles 动态生成 | protein3 条件：ceil(targetProtein/25)≥3；snack 按 slotsNeeded 自动切换 snack_protein `scoring.types.ts:394-419` | 高 |

### A.6 优化能力

| 能力 | 关键实现 | 成熟度 |
|---|---|---|
| 多目标 Pareto 优化 | 6 维(macroFit/health/taste/cost/convenience/regionalFit)，DEFAULT_PARETO_LIMIT=20，朴素 O(n²) 非支配排序 `multi-objective-optimizer.ts` | 高 |
| 加权和+Pareto 奖励 | compositeScore=Σ(w_i×obj_i)；前沿+0.1/次前沿+0.05；DEFAULT_PREFERENCES见下表 `multi-objective-optimizer.ts:164-177` | 高 |
| 6 维偏差迭代优化 | DEVIATION_WEIGHTS cal:0.22/protein:0.22/fat:0.20/carbs:0.20/fiber:0.10/GL:0.06；默认 24 轮；minScoreRatio=0.75 `global-optimizer.ts:29-72` | 高 |
| 份量微调 | PORTION_MULTIPLIERS=[0.8,0.9,1.1,1.2]（±10%/±20%），GL 近似比例缩放 `global-optimizer.ts:39` | 高 |
| 多样性约束（优化内） | 替换时同餐同 category 已有≥2 个则跳过 `global-optimizer.ts:174-181` | 高 |
| 目标比例（MEAL_RATIOS） | fat_loss:[0.30/0.35/0.25/0.10] / muscle_gain:[0.25/0.30/0.25/0.20] / health:[0.25/0.35/0.30/0.10] / habit:[0.25/0.35/0.30/0.10]（breakfast/lunch/dinner/snack）`scoring.types.ts:290-295` | 高 |

### A.7 学习与个性化能力

| 能力 | 关键实现 | 成熟度 |
|---|---|---|
| 4 层权重融合 | global(TTL:7d/MIN:20/权重:0.2) + user(TTL:14d/MIN:5/权重:0.5) + user×meal(TTL:14d/MIN:5/权重:0.5) + region×goal(TTL:30d/MIN:30/权重:0.3)；offset clamp ±20% `weight-learner.service.ts:27-50` | 高 |
| 周训 LTR（LearnedRanking） | feature_flag:`learned_ranking_enabled`；DIM_COUNT=SCORE_DIMENSIONS.length（V7.4注释=14维）；MIN_SAMPLES=50/LR=0.001/MAX_ITER=1000/L2=0.01/EARLY_STOPPING=50；周一 06:00 cron `learned-ranking.service.ts:33-54` | 中高 |
| 因子自学习（FactorLearner） | Redis Hash key:`factor_learner:{userId}:{goalType}`；BASE_LR=0.05；DECAY_HALF_LIFE=50；clamp [0.5,2.0]；冷启动≥10次；TTL:14d；fallback 内存 Map（无 LRU，手动 cleanupExpired）`factor-learner.service.ts:40-52` | 高 |
| 策略自动调优 | `calcAdaptiveExplorationRate`：baseRate=0.15×exp(-interactions/100)×(1-convergence×0.8)，clamp [0.02,0.15]；周一 04:00 cron `strategy-auto-tuner.service.ts:394-407` | 高 |
| 协同过滤 | RecallMerger cf 路，冷启动降级规则路，CF-only food 通过 allFoodsMap 还原 `recall-merger.service.ts` | 中高 |
| 替换模式学习 | replacement_patterns 表，A→B 频率，ReplacementFeedbackFactor(order=55) `replacement-feedback.factor.ts` | 中 |
| StrategyAutoTuner 调优持久化 | ⚠️ **仅改内存 Map，重启丢失**（与审计 V7.7 同款技术债）`strategy-auto-tuner.service.ts` | 未解决 |

### A.8 指标与可观测性能力

| 能力 | 关键实现 | 成熟度 |
|---|---|---|
| Prometheus Counter（推荐专属） | `recommendation_requests_total{mealType}` / `recommendation_regional_boost_active_total{active}` / `recommendation_food_regional_info_coverage_total{status}` / `recommendation_cuisine_affinity_hit_total{hit}` / `recommendation_learned_weights_dim_mismatch_total` / `recommendation_channel_total{channel}` `metrics.service.ts:57-236` | 高 |
| StageBuffer trace | 4 个 stage：recallMerge/realisticFilter/scoringChain/healthModifier；writeStageBuffer/consumeStageBuffer `pipeline.types.ts:466-606` | 高 |
| SeasonalityService 采样 | 1/32 概率触发 Prometheus 采样（P0-4）`seasonality.service.ts` | 高 |
| 熔断器 | CircuitBreakerService（opossum），per-service 实例，`circuit_breaker_events_total{service,event}` `metrics.service.ts:132-136` | 高 |
| cron 执行统计 | `cron_executions_total{job,result}` `metrics.service.ts:114-118` | 高 |
| cache 操作统计 | `cache_operations_total{tier,operation,result}` `metrics.service.ts:66-70` | 高 |

### A.9 策略与配置能力

| 能力 | 关键实现 | 成熟度 |
|---|---|---|
| 4 种推荐策略预设 | explore(explorationRate:0.6/maxSameCategory:2) / exploit(0.15/2) / strict_health(0.1/2/realismLevel:normal) / scene_first(0.2/maxSameCategory:3/acquisitionDifficultyMax:2/realismLevel:strict) `recommendation-strategy.types.ts:93-212` | 高 |
| factorStrengthOverrides | `Record<string, number>`，strategy 层注入，与 FactorLearner 相乘后写 ctx.factorAdjustments `recommendation-strategy.types.ts:69` | 高 |
| ScoringConfigSnapshot | featureFlag 表（key:scoring_config_v68/v67），Redis 缓存，Admin API 可写，5 级分片覆盖 `scoring-config.service.ts` | 高 |
| RealismLevel 配置 | 4 档完整阈值（见 § 5.1），strategy.rerank.realismLevel 可覆写 | 高 |
| maxSameCategory | 默认 2，scene_first 策略=3，`ctx.maxSameCategory` `recommendation-strategy.types.ts:124,158,201,244` | 高 |

### A.10 已知技术债 / 未解决问题

| 问题 | 影响 | file:line 锚点 |
|---|---|---|
| ⚠️ `RealismPreset.maxSkillLevel` 死配置 | PRESET 字段有值但 filterByRealismLevel 未映射，skill 过滤完全忽略 RealismLevel 档位 | `realistic-filter.service.ts:308-338` / `scene.types.ts:269-293` |
| ⚠️ `RealismPreset.equipmentFilterEnabled` 死配置 | 设备过滤始终执行（只要有 kitchenProfile），不受 RealismLevel 控制 | `realistic-filter.service.ts:200,308-338` |
| ⚠️ ProfileAggregator 串行 await | 9 个下游服务串行调用，P1 改 Promise.all 可降延迟 | `profile-aggregator.service.ts` |
| ⚠️ food-plan.controller 未 normalize channel | 直接透传 channel，与 normalizeChannel 体系脱节 | `food-plan.controller`（TODO P1 标记） |
| ⚠️ StrategyAutoTuner 调优不持久 | 内存 Map，重启后 segment→strategy 映射丢失 | `strategy-auto-tuner.service.ts` |
| ⚠️ FactorLearner fallback Map 无 LRU | 内存 fallback Map 无大小限制，Redis 长期故障时可能 OOM | `factor-learner.service.ts:63-70` |
| ⚠️ dietary 两版本共存 | 实例版与独立函数版并行存在，vegan cream 已修复，后续若新增限制需双版同步维护 | `food-filter.service.ts:291-534` |
| ⚠️ global-optimizer 注释曾与默认值矛盾 | 已修复：注释改为 24 轮/25%（G8 fix） | `global-optimizer.ts:23-25,71-72` |
| ⚠️ LearnedRanking 特征维度 DIM_COUNT 动态 | 注释称 V7.4=14 维，但 SCORE_DIMENSIONS 定义在外部 types 文件，无法从 learned-ranking.service.ts 直接确认 | `learned-ranking.service.ts:51-54` |
| ⚠️ CHANNEL_TO_SOURCES inline | 不是全局常量，仅在 recallCandidates 函数内定义，外部无法复用 | `pipeline-builder.service.ts:412-442` |

---

### A.11 地区 / 季节 / 时区 / 价格 升级能力专项

> 本节汇总上述四个横切维度的**最新升级**，以版本标签标注演进里程碑。

#### A.11.1 地区感知（Regional Awareness）

| 子能力 | 关键实现 | 版本 | 成熟度 |
|---|---|---|---|
| FoodRegionalInfo 多级匹配 | `buildFoodRegionalFallbackWhere(regionCode)` 按 country→province→city 降级；`getFoodRegionSpecificity()` 排序，city>province>country，相同 foodId 保留最精确匹配 `food-regional-info.util.ts` | V6.4+ | 高 |
| availability 硬过滤 | `UNAVAILABLE_STATUSES={RARE,LIMITED}`+`regulatoryInfo.forbidden` → 候选剔除；MIN_CANDIDATES=5 兜底 `regional-candidate-filter.service.ts:20-23` | V6.4 | 高 |
| regionalBoostMap availability→乘数 | YEAR_ROUND+popularity>50→1.20/YEAR_ROUND→1.05/SEASONAL→0.90/RARE→0.70/LIMITED→0.80/UNKNOWN→0.85 `preference-profile.service.ts:310-327` | V6.4 | 高 |
| confidence + sourceUpdatedAt 二级衰减 | `boost=(boost-1)*confidence+1`；陈旧数据再 ×0.9 折扣 `preference-profile.service.ts:330-336` | 新增 | 高 |
| cuisine affinity → 跨国 boost（P3-3.5） | `getCuisinePreferenceCountries(cuisinePrefs, excludeCountry)` → 多国 boostMap 取 max（仅保留>1.0 正向 boost，不反向流入 RARE 惩罚）`preference-profile.service.ts:224-270` | P3-3.5 | 高 |
| region×cuisine 合并（mergeRegionalBoostMaps） | `Math.max(existing, cuisineBoost)`；cuisine 来源国 boost 可覆盖本地 RARE 惩罚 `preference-profile.service.ts:279-290` | P3-3.5 | 高 |
| regionCode 缺失推断 | locale → `localeToFoodRegion(locale)`（如 en-US→US）→ 兜底 DEFAULT_REGION_CODE='US' `profile-aggregator.service.ts:156-170` | 阶段1.4 | 高 |
| 法规禁止 regulatoryInfo | DB 字段 `foodRegionalInfo.regulatoryInfo.forbidden=true` → 直接从候选池剔除 `seasonality.service.ts:363-365` / `regional-candidate-filter.service.ts` | 阶段3.2 | 高 |
| regionCode 缓存隔离（P0-2） | SeasonalityService 从单层 Map 升级为 `Map<regionCode, Map<foodId, SeasonalityInfo>>`，LRU 上限 MAX_REGIONS_IN_MEMORY=32，LRU 淘汰最久未访问 region `seasonality.service.ts:99-109` | P0-2 | 高 |
| 并发 preload mutex | `preloadInProgress Map<regionCode, Promise<void>>`，同 regionCode 并发请求等待同一 Promise `seasonality.service.ts:118-145` | 阶段2.3 | 高 |
| 渠道时段 × 区域分层（P3-3.2） | `CHANNEL_TIME_MATRIX_BY_REGION{CN/JP/US}` 覆写默认矩阵；country=regionCode.split('-')[0] 解析 `channel-availability.factor.ts:81-123` | P3-3.2 | 高 |

#### A.11.2 季节性（Seasonality）

| 子能力 | 关键实现 | 版本 | 成熟度 |
|---|---|---|---|
| 品类级峰值月份（V6.4 原有逻辑） | `CATEGORY_PEAK_MONTHS{veggie:3-9/fruit:5-10/protein:全年/grain:全年/dairy:全年}`；SEASONAL 当季→1.0/非当季→0.3；YEAR_ROUND→0.7；RARE→0.4；LIMITED→0.45 `seasonality.service.ts:62-476` | V6.4 | 高 |
| 食物级月份权重（V7.0 升级） | `food_regional_info.month_weights`（12 元素 0-1 数组）；优先于品类逻辑；平滑插值 `current×0.6 + prev×0.2 + next×0.2` `seasonality.service.ts:524-534` | V7.0 | 高 |
| 置信度衰减（阶段4.3） | `score_final = score_raw * confidence + 0.5*(1-confidence)`；月份权重 confidence=0.9/YEAR_ROUND=0.85/SEASONAL=0.75/RARE=0.6/LIMITED=0.6 `seasonality.service.ts:486-488` | 阶段4.3 | 高 |
| 南半球月份翻转（P3-3.4） | `isSouthernHemisphere(regionCode)` → `effectiveMonth = ((month-1+6)%12)+1`；覆盖国家：AU/NZ/AR/CL/ZA/BR/PE/UY `seasonality.service.ts:430-433` / `regional-defaults.ts:55-75` | P3-3.4 | 高 |
| 非法 month 防御 | 非 [1,12] 整数直接 throw（移除旧 `new Date().getMonth()` fallback，防止服务器时区与南半球翻转叠加双重错误）`seasonality.service.ts:423-428` | P3-3.4 | 高 |
| 批量评分接口 | `getSeasonalityScores(foods, month, regionCode)` → `Map<foodId, score>` `seasonality.service.ts:497-510` | V6.4+ | 高 |
| P0-4 采样 Metrics | `coverageSampleCounter % COVERAGE_SAMPLE_RATE(32)`，status∈{present/missing/no_region}，`metricsService.foodRegionalInfoCoverage.inc` `seasonality.service.ts:290-327` | P0-4 | 高 |

#### A.11.3 时区（Timezone）

| 子能力 | 关键实现 | 版本 | 成熟度 |
|---|---|---|---|
| 默认常量单点管理 | `DEFAULT_TIMEZONE='America/New_York'` / `DEFAULT_REGION_CODE='US'` / `DEFAULT_LOCALE='en-US'`，全后端单点引用 `regional-defaults.ts:23-42` | 阶段1 | 高 |
| 用户本地月份解析 | `getUserLocalMonth(timezone)` → `currentMonth(1-12)` 写入 PipelineContext；下游 SeasonalityService 强制消费 ctx.currentMonth，不再用服务器时区 `timezone.util.ts:100` / `pipeline-context-factory.service.ts:96` | 阶段1.1 | 高 |
| 用户本地小时解析 | `getUserLocalHour(timezone)` → `localHour(0-23)` 写入 PipelineContext；ChannelAvailabilityFactor 消费 → 时段（morning/midday/evening/lateNight）`pipeline-context-factory.service.ts:97` / `channel-availability.factor.ts:146` | 阶段1.1 | 高 |
| 缺失时区一次性告警 | `warnedMissingTimezone Set<userId>` 去重，同 userId 仅打印 1 次 WARN，避免高频刷屏 `pipeline-context-factory.service.ts:56-85` | 阶段1.5 | 高 |
| 缺失 regionCode 推断链 | `userProfile.regionCode` → `localeToFoodRegion(locale)` → `DEFAULT_REGION_CODE`，三级兜底 `profile-aggregator.service.ts:156-170` | 阶段1.4 | 高 |
| SeasonalityService month 防御 | 调用方必须传 `ctx.currentMonth`（用户本地月）；传入非整数/越界 → throw，不 fallback 服务器时区 `seasonality.service.ts:423-428` | P3-3.4 | 高 |

#### A.11.4 价格（Price）

| 子能力 | 关键实现 | 版本 | 成熟度 |
|---|---|---|---|
| 区域价格数据 DB 字段 | `food_regional_info.priceMin/priceMax/currencyCode/priceUnit`（Prisma Decimal→number 转换）`seasonality.service.ts:186-214` | P2-2.2 | 高 |
| 价格数据随区域预加载 | `SeasonalityService.preloadRegion(regionCode)` 一并载入价格字段；Redis L2 TTL=4h；内存 L1 按 region 隔离 `seasonality.service.ts:134-239` | P2-2.2 | 高 |
| getPriceInfo API | `SeasonalityService.getPriceInfo(foodId, regionCode)` 返回 `FoodPriceInfo{priceMin/priceMax/currencyCode/priceUnit}`，无数据四字段均 null `seasonality.service.ts:372-388` | P2-2.2 | 高 |
| PriceFitFactor 路径A（精确预算） | 触发：`userProfile.declared.budgetPerMeal>0 + currencyCode`；通过 `getPriceInfo(foodId, regionCode)` 查询（P0-2 透传 regionCode 防跨区污染）；priceMid=(min+max)/2；评分 1.05/0.85/0.70/0.60 `price-fit.factor.ts:134-204` | P2-2.2 | 高 |
| priceUnit 兼容判断 | `isPerServingCompatible(priceUnit)`：null/空/'per_serving'/含'serving' → 兼容；'per_kg'/'per_box'/'per_100g' → 回退路径B `price-fit.factor.ts:66-71` | P2-2.2 | 高 |
| 跨币种"零外部依赖"策略 | 食物 currencyCode≠用户 currencyCode → multiplier=1.0 跳过（不引入汇率服务），trace=`currency_mismatch` `price-fit.factor.ts:165-173` | P2-2.2 | 高 |
| PriceFitFactor 路径B（粗粒度 fallback） | 路径A 数据不足时 silent fallback；`estimatedCostLevel` vs BUDGET_MAX_COST(low:2/medium:3/high:5)；超出阶梯 1→0.85/2→0.70/3+→0.60 `price-fit.factor.ts:207-232` | 旧逻辑 | 高 |
| RealisticFilter 预算硬过滤 | BUDGET_COST_CAP(low:3/medium:4/high:5)×estimatedCostLevel 硬过滤（与 PriceFitFactor 软评分互补）`realistic-filter.service.ts:64-148` | V6.x | 高 |

---

## 5. 可行性层（Feasibility Layer）

### 5.1 RealismLevel 完整阈值表

`apps/api-server/src/modules/diet/app/recommendation/types/scene.types.ts:237-308`：

| Level | commonalityThreshold | budgetFilterEnabled | cookTimeCap (min) | canteenFilterEnabled |
|---|---|---|---|---|
| `strict` | 40 | true | 45 | true |
| `normal` | 30 | true | 60 | true |
| `relaxed` | 10 | false | 120 | false |
| `off` | 0 | false | ∞ | false |

> ⚠️ `maxSkillLevel`（strict:2/normal:3/relaxed:5/off:∞）和 `equipmentFilterEnabled`（strict:true/normal:true/relaxed:false/off:false）字段定义在 PRESET 中但**未被 `filterByRealismLevel` 消费**，属于死配置（见 A.10）。

**场景默认 RealismLevel**（scene.types.ts:301-308）：

| 场景 | 默认 RealismLevel |
|---|---|
| `HOME_COOK` | normal |
| `RESTAURANT` | relaxed |
| `DELIVERY` | relaxed |
| `CANTEEN` | strict |
| `CONVENIENCE` | strict |
| `UNKNOWN` | normal |

### 5.2 RealisticFilter 6 维过滤逻辑

`apps/api-server/src/modules/diet/app/recommendation/filter/realistic-filter.service.ts`，`filterByRealism()` :95-261：

#### 5.2.1 commonality 过滤（:122-128）

```ts
if (config.commonalityThreshold > 0)
  filtered = filtered.filter(f => (f.commonalityScore ?? 50) >= config.commonalityThreshold)
```

#### 5.2.2 预算过滤（:138-148）

```ts
BUDGET_COST_CAP = { low: 3, medium: 4, high: 5 }  // :64-68
if (config.budgetFilterEnabled)
  maxCost = BUDGET_COST_CAP[budgetLevel] ?? 5
  filtered = filter(f => (f.estimatedCostLevel ?? 2) <= maxCost)
```

#### 5.2.3 cookTimeCap 过滤（:151-197）

- 触发条件：`config.cookTimeCapEnabled && context.channel === HOME_COOK`
- 工作日/周末双阈值：`weekdayCookTimeCap` / `weekendCookTimeCap`（由 `filterByRealismLevel` 映射 `:331-332`：weekday=min(preset.cookTimeCap,45)）
- `adjustForScene()` 场景进一步收紧（:530-594）：

| 场景 | cap |
|---|---|
| weekday + lunch | min(default, 45) |
| weekday + breakfast | min(default, 20) |
| weekday + dinner | min(default, 45) |
| snack（任意） | min(default, 10) |

#### 5.2.4 食堂模式（:168-179）

```ts
if (config.canteenMode || context.channel === CANTEEN)
  canteenThreshold = Math.max(config.commonalityThreshold, 60)
```
内部亦有 MIN_CANDIDATES=5 局部短路。

#### 5.2.5 烹饪技能过滤（:182-197）

仅 HOME_COOK。`SKILL_LEVEL_MAP`（:54-61）：easy/beginner=1 / medium/intermediate=2 / hard/advanced=3。以**用户自身技能**为 maxSkill 上限，而非 `preset.maxSkillLevel`。

#### 5.2.6 设备约束过滤（:200-210）

仅有 `kitchenProfile` 时触发（不受 `preset.equipmentFilterEnabled` 控制）。`checkCookingEquipment`（:456-506）：`primaryStove === 'none'` → 加入 STOVE_REQUIRED_METHODS；未拥有设备 → 收集 `unavailableMethods`；至少一个 cookingMethod 不在 unavailableMethods 集合中才保留食物。

#### 5.2.7 MIN_CANDIDATES=5 全局兜底（:214-238）

各维度内部若过滤后 < MIN_CANDIDATES 则**跳过该维过滤**（局部短路）；全局兜底按 **`commonalityScore` 降序**取前 5。

### 5.3 RegionalCandidateFilter

`apps/api-server/src/modules/diet/app/recommendation/filter/regional-candidate-filter.service.ts`：

- `MIN_CANDIDATES = 5`（:20）
- `UNAVAILABLE_STATUSES = new Set(['RARE', 'LIMITED'])`（:23）
- 执行顺序：先剔除 `regulatoryInfo.forbidden`，再剔除 `food.regionalAvailability[regionCode] ∈ UNAVAILABLE_STATUSES`
- 兜底：`filtered.length < MIN_CANDIDATES` → 回退全部候选（不按任何字段排序，直接保留）
- `regionCode` 由 `ctx.regionCode` 显式传入，防跨 region 缓存污染（P0-2 落地）

---

## 6. 评分链（Scoring Chain）

### 6.1 ScoringChain 执行机制

`apps/api-server/src/modules/diet/app/recommendation/scoring-chain/scoring-chain.service.ts`：

```ts
// ScoringFactor 协议（scoring-factor.interface.ts）
interface ScoringFactor {
  name: string
  order: number
  isApplicable(ctx): boolean
  init?(ctx): void | Promise<void>
  computeAdjustment(food, ctx): ScoringAdjustment | null
}
// ScoringAdjustment
interface ScoringAdjustment {
  multiplier: number       // 1.0 = 无影响
  additive: number         // 0 = 无影响
  explanationKey?: string
  reason?: string
}
// 执行公式
score = score * multiplier + additive
```

- 注册时按 `order` 升序排列（`scoring-chain.service.ts:229`）
- `init()` 在每次 pipeline 启动时调用（可预计算 ctx 级缓存）
- `computeAdjustment` 返回 `null` = 跳过本因子

### 6.2 12 个因子完整参数表

`apps/api-server/src/modules/diet/app/recommendation/scoring-chain/factors/index.ts`（共 12 个导出）：

| # | factor name | file | order | 关键参数/clamp |
|---|---|---|---|---|
| 1 | `preference-signal` | `preference-signal.factor.ts:119` | **10** | loves=×1.12/avoids=×0.3；声明偏好 perMatch=0.05/cap=0.15；无 clamp |
| 2 | `regional-boost` | `regional-boost.factor.ts` | **15** | LRU(32) regionCode 隔离 cache，季节权重，P0-2 |
| 3 | `price-fit` | `price-fit.factor.ts:75` | **20** | 路径A阶梯 1.05/0.85/0.70/0.60；BUDGET_MAX_COST low:2/medium:3/high:5；无 clamp |
| 4 | `collaborative-filtering` | `collaborative-filtering.factor.ts` | **?** | cfBoostCap=0.15 |
| 5 | `channel-availability` | `channel-availability.factor.ts:134` | **25** | CHANNEL_CATEGORY_MATRIX 6×10；时段乘子；上限 clamp 1.1 |
| 6 | `short-term-profile` | `short-term-profile.factor.ts` | **25** | boostRange=[0.9,1.1]；singleRejectPenalty=0.85；minInteractions=3 |
| 7 | `scene-context` | `scene-context.factor.ts:65` | **30** | dimensionWeightAdjustments；clamp [0.8,1.2]；消费 factorStrengthOverrides |
| 8 | `analysis-profile` | `analysis-profile.factor.ts` | **35** | categoryInterestPerCount=0.02/cap=0.08；riskFoodPenalty=0.7 |
| 9 | `lifestyle-boost` | `lifestyle-boost.factor.ts` | **40** | nutrientBoost clamp [0.85,1.15]；deltaMul=0.05 |
| 10 | `popularity` | `popularity.factor.ts` | **50** | — |
| 11 | `replacement-feedback` | `replacement-feedback.factor.ts` | **55** | replacement_patterns A→B 频率 |
| 12 | `rule-weight` | `rule-weight.factor.ts` | **60** | `food.__ruleWeight`；仅 <1.0 时生效 |

> ⚠️ `collaborative-filtering` 的 `order` 未从因子文件直接确认，需后续补锚点。

### 6.3 factorStrengthOverrides 注入链路

`apps/api-server/src/modules/diet/app/recommendation/pipeline/pipeline-builder.service.ts:743-767`（`mergeStrategyFactorOverrides`）：

```
strategy.rank.factorStrengthOverrides (Record<string,number>)
    × ctx.factorAdjustments (FactorLearner 学习强度 Map)
    → merged = (existing ?? 1.0) * strategyStrength    (:760-764)
    → mergedCtx = { ...ctx, factorAdjustments: merged }
    → executeChain(baseFoods, baseScores, mergedCtx)    (:668-673)
```

示例（代码注释 :745-751）：FactorLearner=1.2 × 策略=0.8 → 最终=0.96；无 FactorLearner 数据时直接使用策略强度。

`scene-context.factor.ts:65` 是当前代码中唯一确认消费 `ctx.factorAdjustments` 的因子（其余因子需通过 `init(ctx)` 自行读取）。

### 6.4 PreferenceSignalFactor 偏好枚举集合（V8.x 7 类）

`preference-signal.factor.ts` 中的偏好枚举映射（cuisine 亲和度 + 声明偏好 + 4 维画像权重 + loves/avoids 五路叠加）。

支持的声明偏好类型（V8.x）：`spicy_lover / health_conscious / budget_sensitive / convenience_seeker / diverse_cuisine / high_protein / low_carb`（7 项，`preference-signal.factor.ts:131-132` 处 `cap=0.15/perMatch=0.05`）。

---

## 7. 健康修正（Health Modifier）

### 7.1 HealthModifierEngine 5 层管道

`apps/api-server/src/modules/diet/app/recommendation/modifier/health-modifier-engine.service.ts`（1055 行）：

```
食物 → 第一层：一票否决（过敏原/transFat>2g）
      → 第二层：重度惩罚（isFried/sodium）
      → 第三层：目标惩罚（goal-aware）
      → 第四层：健康状况惩罚/否决
      → 第五层：正向增益（bonus）
      → 最终 multiplier clamp [0,+∞) / veto=0
```

### 7.2 第一层：一票否决（:316-339）

| 触发条件 | multiplier |
|---|---|
| `matchAllergens()` 命中 | 0（veto）|
| `transFat > 2g/100g` | 0（veto）|

### 7.3 第二层：重度惩罚（:341-374）

| 条件 | base multiplier |
|---|---|
| `isFried === true` | 0.92 |
| `sodium > 1200mg/100g` | 0.88 |
| `sodium > 600mg/100g` | 0.94 |

### 7.4 第三层：目标惩罚（:461-493）

| goalType | 条件 | base multiplier |
|---|---|---|
| `fat_loss` | `sugar > 15g/100g` | 0.9 |
| `muscle_gain` | `(protein×4)/calories < 0.05` 且 `calories > 100` | 0.9 |

### 7.5 第四层：健康状况完整矩阵（:497-835）

| HealthCondition | 否决条件 | 惩罚条件 | base |
|---|---|---|---|
| `diabetes_type2` | — | GI>70 → 0.8；GI>55 → 0.9 | — |
| `hypertension` | — | sodium>400 → 0.85 | — |
| `hyperlipidemia` | — | satFat>5 → 0.9；cholesterol>100 → 0.9 | — |
| `gout` | purine>300 → veto | purine>150 → 0.7；purine>50 → 0.9 | — |
| `kidney_disease` | — | phosphorus>250 → 0.75；phosphorus>150 → 0.9；potassium>400 → 0.8 | — |
| `fatty_liver` | — | satFat>5 → 0.85；sugar>10 → 0.88 | — |
| `celiac_disease` | allergens含gluten 或 tags含gluten/contains_gluten → veto | — | — |
| `ibs` | — | fodmapLevel='high'或tag:high_fodmap → 0.75；'moderate' → 0.9 | — |
| `iron_deficiency_anemia` | — | tags含tea/coffee → 0.85 | — |
| `osteoporosis` | — | oxalateLevel='high' → 0.85；sodium>400 → 0.9 | — |
| `cardiovascular` | — | satFat>5 → 0.85；cholesterol>100 → 0.9；sodium>400 → 0.85；transFat>0 → 0.7 | — |
| `thyroid` | — | tag:high_iodine/iodine_rich → 0.8 | — |

### 7.6 第五层：正向增益完整矩阵（:844-967）

| HealthCondition | 触发条件 | bonus multiplier |
|---|---|---|
| `hyperlipidemia` | Omega3-rich tag | 1.15 |
| `diabetes_type2` | GI < 40 | 1.10 |
| `hypertension` | potassium>300 且 sodium<200 | 1.12 |
| `iron_deficiency_anemia` | iron > 3mg | 1.10 |
| `osteoporosis` | calcium > 100mg | 1.10 |
| `cardiovascular` | Omega3-rich tag | 1.15 |
| `cardiovascular` | fiber>5g 或 tag:high_fiber | 1.10 |

### 7.7 Severity 加权公式（:1011-1054）

```
severityFactor: mild=0.6 / moderate=1.0 / severe=1.3

惩罚: adjusted = 1 - (1 - baseMultiplier) × severityFactor; clamp [0,1]
增益: adjusted = 1 + (baseMultiplier - 1) × severityFactor; clamp [1,∞)
```

示例（惩罚）：base=0.8，mild → 1-(1-0.8)×0.6=0.88；severe → 1-(1-0.8)×1.3=0.74

### 7.8 缓存架构

| 层 | 类型 | TTL | Key 格式 |
|---|---|---|---|
| L1 | 请求级 `Map<foodId, HealthModifierResult>` | 请求生命周期 | foodId |
| L2 | Redis | 2h（`L2_CACHE_TTL_MS`，:84）| `health_mod:{contextHash}:{foodId}`（:87,139-141）|

`contextHash` = `sha256(allergens|conditions|goal).slice(0,16)`（:120-133）

### 7.9 i18n reasonKey 体系

`apps/api-server/src/modules/diet/app/recommendation/utils/i18n-messages.ts`：

| 常量 | 值 | file:line |
|---|---|---|
| `FALLBACK_LOCALE` | `'en-US'` | :33 |
| `KEY_PREFIX` | `'recommendation.'` | :36 |
| 支持 locale | `'zh-CN' \| 'en-US' \| 'ja-JP'` | :30 |
| 语言文件目录 | `apps/api-server/src/modules/diet/i18n/{zh-CN,en-US,ja-JP}.json` | — |

> ⚠️ 代码注释第 94 行写"回退到 zh-CN"，但实际回退逻辑（:112-113）用 `FALLBACK_LOCALE='en-US'`，以代码为准。

---

## 8. 装配层（Meal Assembly）

### 8.1 MealAssembler 总体流程

`apps/api-server/src/modules/diet/app/recommendation/meal/meal-assembler.service.ts`：

```
① 按 MEAL_ROLES（或 MUSCLE_GAIN_MEAL_ROLES / buildMealRoles）确定本餐角色列表
② 对每个 role：
   a. 过滤候选（category ∈ roleCategories）
   b. diversify 硬约束检查（§ 8.2）
   c. 选最高 score 食物
③ addExploration Thompson Sampling（§ 8.3）
④ 跨餐补偿规则（§ 8.5）
⑤ resolveCompositionConflicts（装配后冲突解决）
⑥ enforceMaxSameCategory（ctx.maxSameCategory 约束）
```

### 8.2 diversify 硬约束（:43-80）

| 约束 | 上限 | 说明 |
|---|---|---|
| 同一 `category` | ≤ 2 | 如已有 2 个 protein，下一个 protein 类被拒 |
| 同一 `mainIngredient` | ≤ 1 | 避免同食材重复 |
| 同一 `foodGroup` | ≤ 2 | foodGroup 多样性 |

实时检查：每次 push 前验证，不满足则跳过当前候选取下一个。

### 8.3 addExploration（Thompson Sampling，:148-169）

```ts
// per-food Beta 分布
α = accepts + 1
β = rejects + 1
sample = betaSample(α, β)
// explorationRate 来自 strategy.rank.explorationRate（或 StrategyAutoTuner 自适应值）
if (sample > threshold) → 用 exploration 候选替换当前最高分食物
```

explorationRate 下限由 `calcAdaptiveExplorationRate` 保证 ≥ 0.02。

### 8.4 MEAL_ROLES 完整集合

`apps/api-server/src/modules/diet/app/recommendation/types/scoring.types.ts`：

| goalType | mealType | roles |
|---|---|---|
| 通用（MEAL_ROLES） | breakfast | carb, protein, side |
| 通用（MEAL_ROLES） | lunch | carb, protein, veggie |
| 通用（MEAL_ROLES） | dinner | protein, veggie, side |
| 通用（MEAL_ROLES） | snack | snack1, snack2 |
| muscle_gain（MUSCLE_GAIN_MEAL_ROLES） | breakfast | carb, protein, protein2 |
| muscle_gain（MUSCLE_GAIN_MEAL_ROLES） | lunch | carb, protein, protein2, veggie |
| muscle_gain（MUSCLE_GAIN_MEAL_ROLES） | dinner | protein, protein2, veggie, side |
| muscle_gain（MUSCLE_GAIN_MEAL_ROLES） | snack | snack_protein, snack2 |
| 动态（buildMealRoles，targetProtein/25≥3） | 任意 | 同上 + protein3（第三蛋白槽）|

### 8.5 跨餐补偿规则（CrossMealRules，:185-267）

`apps/api-server/src/modules/diet/app/recommendation/utils/cross-meal-rules.ts`，调用点：`daily-plan-context.service.ts:345`。

4 条声明式规则，按 priority 升序叠加：

| id | priority | condition | 效果 |
|---|---|---|---|
| `light-breakfast` | 10 | mealIndex=1 且 早餐热量/日目标 < 0.2 | calorieMultiplier=1.1（+10%）|
| `high-carb-lunch` | 20 | mealIndex=2 且 累积碳水×4/累积热量 > 0.6 | weightOverrides:{carbs:1.3} |
| `protein-deficit` | 30 | mealIndex≥1 且 实际蛋白进度 < 预期×0.85（预期=mealIndex/3）| weightOverrides:{protein:1.4} |
| `cuisine-monotony` | 40 | mealCount≥2 且 usedCuisines.size≤1 | cuisineDiversityBonus=0.05 |

叠加规则（:246-262）：`calorieMultiplier` 覆盖；`weightOverrides` 合并（后者覆盖前者同 key）；`cuisineDiversityBonus` 累加。

`CrossMealRuleEffect` 接口（:42-51）：`calorieMultiplier? / weightOverrides?: Partial<Record<ScoreDimension,number>> / cuisineDiversityBonus? / reasonTag: string`

### 8.6 resolveCompositionConflicts 与 enforceMaxSameCategory（:572）

- `resolveCompositionConflicts`：装配后对冲突食物组合（如重复主食）做替换
- `enforceMaxSameCategory`：最终强制执行 `ctx.maxSameCategory`（默认 2，scene_first 策略=3）

---

## Batch 2 完结

**已交付**：能力全景表（A.1-A.11，含地区/季节/时区/价格升级专项）+ 第 5-8 章（可行性/评分链/健康/装配）。

---

## 9. 全局优化（Optimization Layer）

### 9.1 GlobalOptimizer 迭代贪心

`apps/api-server/src/modules/diet/app/recommendation/optimization/global-optimizer.ts`：

**触发时机**：MealAssembler 完成所有餐次贪心装配后，对全天 4 餐联合做后优化。

```
inputs:  4×MealSlot(picks + candidates + target)  + dailyTarget
outputs: OptimizationResult(meals, deviationBefore, deviationAfter, swapCount)
```

**算法流程（每轮最多 1 个动作）**：

1. 计算全天 6 维偏差向量（cal/protein/fat/carbs/fiber/GL）
2. 枚举所有可行动作（`food_swap` + `portion_adjust`）
3. 选偏差改善最大且该餐评分不降超 25%（`minScoreRatio=0.75`）的动作
4. 执行动作，重复至 `maxIterations=24` 或无改善动作

**关键常量**（`global-optimizer.ts:29-39`）：

| 参数 | 值 | 说明 |
|---|---|---|
| `DEVIATION_WEIGHTS.calories` | 0.22 | V4:0.35→V5:0.30→P1-1:0.22 |
| `DEVIATION_WEIGHTS.protein` | 0.22 | V4:0.30→V5:0.25→P1-1:0.22 |
| `DEVIATION_WEIGHTS.fat` | 0.20 | V4:0.15→P1-1:0.20（fat 偏差核心修复） |
| `DEVIATION_WEIGHTS.carbs` | 0.20 | V4:0.20→P1-1:0.20 |
| `DEVIATION_WEIGHTS.fiber` | 0.10 | V5 新增 |
| `DEVIATION_WEIGHTS.glycemicLoad` | 0.06 | V5:0.08→P1-1:0.06 |
| `PORTION_MULTIPLIERS` | [0.8,0.9,1.1,1.2] | ±10%/±20% 四档 |
| `maxIterations` | 24（default） | 外部可覆写 |
| `minScoreRatio` | 0.75（default） | 外部可覆写 |

**多样性约束**：替换时同餐同 category 已有 ≥2 个则跳过候选（`global-optimizer.ts:174-181`）。

**GL 近似**：份量调整时 glycemicLoad 按比例缩放（无精确 GL 值时的近似）。

**⚠️ 无 ΔL 早停**：当前实现跑满 maxIterations，即使已无改善动作也不提前退出（小效率问题，非阻塞）。

### 9.2 MultiObjectiveOptimizer Pareto 优化

`apps/api-server/src/modules/diet/app/recommendation/optimization/multi-objective-optimizer.ts`（586 行）：

**6 维目标向量**（`MULTI_OBJECTIVE_DIMENSIONS`）：

| 维度 | 计算来源 | 默认权重 |
|---|---|---|
| `macroFit` | 实际营养 vs 餐级目标偏差（MEAL_RATIOS 分摊）归一化 | 0.30 |
| `health` | ScoredFood.score 归一化（/ maxScore）| 0.25 |
| `taste` | flavorProfile 余弦相似度 vs 用户 tastePreference | 0.20 |
| `cost` | estimatedCostLevel 反转（1→1.0/2→0.75/3→0.5/4→0.25/5→0.0）| 0.10 |
| `convenience` | `0.4×timeScore + 0.3×skillScore + 0.3×processingScore`；timeScore(≤15→1.0/≤30→0.8/≤60→0.6/≤90→0.4/>90→0.2) | 0.10 |
| `regionalFit` | `regionalBoost×0.6 + seasonality×0.4`（P3-2.11）| 0.05 |

**算法**（`multi-objective-optimizer.ts:131-200`）：

```
1. 计算 6 维目标向量（候选 × 维度）
2. 朴素非支配排序（O(n²)）→ paretoRank（0=前沿, 1=次前沿, ...）
3. compositeScore = Σ(w_i × obj_i)
   + paretoBonus(rank=0:+0.1 / rank=1:+0.05)
4. 按 compositeScore 降序，综合分相同时 ScoredFood.score 为 tiebreaker
5. 截断：len > paretoLimit×3 时裁剪
```

`DEFAULT_PARETO_LIMIT = 20`；`paretoFrontLimit` 可由策略配置覆写。

> ⚠️ 早期注释写"切比雪夫距离"，**实际实现为加权线性和**（已修复注释，G9 fix）。

### 9.3 优化层调用链

```
DailyPlanContextService.buildPlan()
  → MealAssembler.assemble()（每餐贪心装配 + Thompson Sampling）
  → GlobalOptimizer.optimizeDailyPlan()（全天 6 维偏差迭代微调）
  → MultiObjectiveOptimizer.rankCandidates()（Pareto 重排候选池）
       （MultiObjective 在装配前对候选池重排，为贪心提供更优排序）
```

---

## 10. 学习闭环（Learning Loop）

### 10.1 WeightLearnerService 4 层融合

`apps/api-server/src/modules/diet/app/recommendation/optimization/weight-learner.service.ts`（855 行）：

**4 层 Redis 权重偏移（12 维 delta 数组）**：

| 层 | Redis key | TTL | MIN_FB | 融合权重 |
|---|---|---|---|---|
| global | `weight_learned:{goalType}` | 7d | 20 | 0.20 |
| user | `weight_learner:user:{userId}:{goalType}` | 14d | 5 | 0.50 |
| user×meal | `weight_learner:user:{userId}:{goalType}:{mealType}` | 14d | 5 | 0.50 |
| region×goal | `weight_learner:region:{regionCode}:{goalType}` | 30d | 30 | 0.30 |

> user 与 user×meal 共用同一 prefix（`USER_MEAL_REDIS_PREFIX`），通过 mealType suffix 区分。

**融合公式**（`FUSION_USER=0.5 / FUSION_REGION=0.3 / FUSION_GLOBAL=0.2`）：

```
mergedOffset[i] = userOffset[i] * 0.5 + regionOffset[i] * 0.3 + globalOffset[i] * 0.2
finalWeight[i]  = baseWeight[i] * (1 + clamp(mergedOffset[i], -0.20, +0.20))
```

**在线学习参数**：`LEARNING_RATE=0.01`；`DECAY_HALF_LIFE_DAYS=7`（时间衰减）；`FEEDBACK_WINDOW_DAYS=14`；`MAX_OFFSET_RATIO=±0.20`。

**触发时机**：Cron `30 6 * * *`（每天 06:30）全量重算，各层各 goalType 独立运行。

### 10.2 LearnedRankingService per-segment LTR

`apps/api-server/src/modules/diet/app/recommendation/optimization/learned-ranking.service.ts`（446 行）：

**控制开关**：`feature_flag: 'learned_ranking_enabled'`（默认 false，灰度开放）。

**7 个已知用户分群**（FALLBACK_SEGMENTS）：`new_user / returning_user / disciplined_loser / muscle_builder / active_maintainer / casual_maintainer / binge_risk`。

**训练样本格式**：`{dimScores: number[DIM_COUNT], accepted: 0|1}`（`DIM_COUNT = SCORE_DIMENSIONS.length`，V7.4 起注释为 14 维）。

**梯度下降超参数**：

| 参数 | 值 |
|---|---|
| `MIN_SAMPLES` | 50 |
| `LEARNING_RATE` | 0.001 |
| `MAX_ITERATIONS` | 1000 |
| `CONVERGENCE_THRESHOLD` | 1e-6 |
| `L2_LAMBDA` | 0.01（L2 正则） |
| `EARLY_STOPPING_PATIENCE` | 50 |

**存储**：Redis key `learned_weights:{segment}`（TTL 8d）+ DB 持久化（`strategy.config.rank.learnedWeights.{segment}`）。

**Cron**：`周一 06:00`（`StrategyAutoTuner 04:00` 先运行，粗粒度策略确定后，细粒度权重向量再优化）。

**降级链**：`WeightLearnerService.getUserMealWeights()` 优先；无数据时回退 `LearnedRankingService.getLearnedWeights(segment)`（`profile-aggregator.service.ts:172-204`）。

### 10.3 FactorLearnerService 因子强度自适应

`apps/api-server/src/modules/diet/app/recommendation/optimization/factor-learner.service.ts`（359 行）：

**存储**：Redis Hash，key `factor_learner:{userId}:{goalType}`；字段：`{factorName: strength}`+`__feedbackCount`；TTL=14d。

**自适应学习率**：`lr = BASE_LR / (1 + feedbackCount / DECAY_HALF_LIFE)` `:81`

| 参数 | 值 |
|---|---|
| `BASE_LEARNING_RATE` | 0.05 |
| `DECAY_HALF_LIFE` | 50 次反馈 |
| `MIN_STRENGTH` | 0.5 |
| `MAX_STRENGTH` | 2.0 |
| `COLD_START_THRESHOLD` | 10 次反馈 |

**Attribution 计算**：`contributionRatio[i] = (|multiplier_i - 1| + |additive_i|) / Σ(...)`，比例归一化后按方向（accept:+1/reject:-1）更新 strength。

**Redis 不可用降级**：fallback 到内存 `Map<string, {strengths, feedbackCount, lastUpdated}>`（无 LRU 限制，长期 Redis 故障有 OOM 风险，见 A.10 技术债）。

**注入链路**：`FactorLearnerService.getStrengths(userId, goalType)` → `PipelineBuilder.mergeStrategyFactorOverrides()` → `ctx.factorAdjustments`（`pipeline-builder.service.ts:743-767`）。

### 10.4 StrategyAutoTuner 策略自动调优

`apps/api-server/src/modules/strategy/app/strategy-auto-tuner.service.ts`：

**功能**：根据用户行为推断 segment，映射到最优推荐策略，并自适应调整探索率。

**探索率公式**（`:394-407`）：
```
baseRate = 0.15 × exp(-interactions/100) × (1 - tsConvergence × 0.8)
explorationRate = clamp(baseRate, 0.02, 0.15)
```

**Cron**：`周一 04:00`。

**⚠️ 持久化缺失**：`segment→strategy` 映射仅存内存 Map，进程重启后丢失（见 A.10）。

---

## 11. 画像层（Profile Layer）

### 11.1 ProfileAggregatorService 聚合架构

`apps/api-server/src/modules/diet/app/recommendation/profile/profile-aggregator.service.ts`（289 行）：

**并行 Phase 1**（`Promise.all` 8 路）：

| # | DI 服务 | 数据 |
|---|---|---|
| 1 | `PreferenceProfileService.getRecentFoodNames(userId, 3days)` | 近 3 天食物名（排重用） |
| 2 | `RecommendationFeedbackService.getUserFeedbackStats(userId)` | Thompson Sampling α/β |
| 3 | `PreferenceProfileService.getUserPreferenceProfile(userId)` | 4 维偏好画像 |
| 4 | `ProfileResolverService.resolveWithDomainProfiles(userId, mealType)` | EnrichedProfile + 领域画像 |
| 5 | `GoalPhaseService.getCurrentGoal(userId)` | 分阶段有效 goalType |
| 6 | `GoalTrackerService.getProgress(userId)` | 目标进度 |
| 7 | `UserProfileService.getKitchenProfile(userId)` | 厨房设备画像 |
| 8 | `ExecutionTrackerService.getTopSubstitutions(userId)` | 高频替换模式 |

**串行 Phase 2**（依赖 Phase 1 的 `enrichedProfile`）：

1. `regionCode` 缺失时 `localeToFoodRegion(locale)` 推断，再兜底 `DEFAULT_REGION_CODE='US'`
2. `WeightLearnerService.getUserMealWeights()` 4 层融合（失败降级→下步）
3. `LearnedRankingService.getLearnedWeights(segment)` per-segment 回退
4. `PreferenceProfileService.getRegionalBoostMap(regionCode)` 区域 boost
5. `PreferenceProfileService.getCuisineRegionalBoostMap(cuisinePrefs, country)` cuisine 跨国 boost
6. `mergeRegionalBoostMaps()` 取 max 合并

> ⚠️ Phase 2 中 2-5 步串行 await（ProfileAggregator P1 技术债，可改 Promise.all 降延迟，见 A.10）。

### 11.2 EnrichedProfile 5 层结构

`EnrichedProfileWithDomain`（`profile-resolver.service.ts`）：

| 层 | 说明 |
|---|---|
| `declared` | 用户主动声明（区域/语言/饮食偏好/cuisinePreferences/budgetPerMeal/currencyCode） |
| `inferred` | 系统推断（userSegment/activityLevel/complianceScore/riskFactors） |
| `analyzed` | 行为分析（短/中期食物摄入、宏量分布、风险食物） |
| `historical` | 历史汇总（食物多样性、饮食模式、季节倾向） |
| `domainProfiles` | 领域专属画像（diet/health/lifestyle/goals 等） |

`regionCode / locale / timezone` 均在 declared 层，由 `PipelineContextFactory` 提取写入 PipelineContext。

### 11.3 PreferenceProfileService 4 维偏好画像

`UserPreferenceProfile`（`meal.types.ts`）：

| 维度 | 类型 | 说明 |
|---|---|---|
| `categoryWeights` | `Record<string, number>` | 食物品类偏好权重 |
| `ingredientWeights` | `Record<string, number>` | 食材偏好权重 |
| `foodGroupWeights` | `Record<string, number>` | 食物组偏好权重 |
| `cuisineWeights` | `Record<string, number>` | 菜系偏好权重（驱动 cuisineAffinity 评分） |

`PreferenceSignalFactor`（order=10）直接消费以上 4 维权重，叠加 loves/avoids/声明偏好 7 类（`preference-signal.factor.ts:131`）。

### 11.4 locale→regionCode 推断工具

`apps/api-server/src/common/utils/locale-region.util.ts`（`localeToFoodRegion(locale)`）：

BCP 47 locale → ISO 国家代码。示例：`'zh-CN'→'CN'`，`'en-US'→'US'`，`'ja-JP'→'JP'`。用于 regionCode 三级兜底链第二级（`profile-aggregator.service.ts:160-163`）。

---

## 12. 技术债与改进点汇总

> 同 A.10 能力全景表，此处以可操作优先级排序。

### 12.1 P0 级（影响数据正确性）

| 编号 | 描述 | 影响 | 状态 |
|---|---|---|---|
| — | ~~SeasonalityService 内存缓存跨 region 污染~~ | ~~多 region 并发请求互相覆盖~~ | ✅ P0-2 已修复 |
| — | ~~PriceFitFactor regionCode 未透传导致跨区价格数据污染~~ | ~~跨 region 用户读取错误价格~~ | ✅ P0-2 已修复 |
| — | ~~global-optimizer 注释描述与代码默认值矛盾~~ | ~~文档误导~~ | ✅ G8 已修复 |
| — | ~~multi-objective 注释称"切比雪夫"但实为"加权线性和"~~ | ~~文档误导~~ | ✅ G9 已修复 |
| — | ~~food-filter.service vegan 未排除 cream~~ | ~~dietary 过滤漏洞~~ | ✅ G10 已修复 |

### 12.2 P1 级（可显著改善性能/稳定性）

| 编号 | 描述 | 影响 | 建议 |
|---|---|---|---|
| TD-01 | `ProfileAggregator.aggregateForRecommendation` Phase 2 串行 await | 推荐延迟偏高（WeightLearner+RegionalBoost 两次串行 Redis） | 改 `Promise.all([weightLearner, regionBoost, cuisineBoost])`，可降延迟 ~30-50ms |
| TD-02 | `StrategyAutoTuner` segment→strategy 映射不持久 | 进程重启丢失所有调优数据 | 持久化到 Redis Hash 或 DB |
| TD-03 | `FactorLearner` fallback 内存 Map 无 LRU 限制 | Redis 长期故障时 OOM 风险 | 加 LRU 淘汰（LRU-cache 库或手动实现，上限 ~1000 user×goal） |
| TD-04 | `food-plan.controller` channel 未 normalize | 直接透传原始 channel 字符串，与 `normalizeChannel` 体系脱节 | 在 controller 入口调用 `normalizeChannel()` |

### 12.3 P2 级（改善代码质量/可维护性）

| 编号 | 描述 | 影响 | 建议 |
|---|---|---|---|
| TD-05 | `RealismPreset.maxSkillLevel` 死配置 | 烹饪技能过滤忽略 RealismLevel 档位 | 在 `filterByRealismLevel` 中读取 `preset.maxSkillLevel` 并传入 skill 过滤逻辑 |
| TD-06 | `RealismPreset.equipmentFilterEnabled` 死配置 | 设备过滤无法通过 RealismLevel 关闭 | 在设备过滤前检查 `config.equipmentFilterEnabled` |
| TD-07 | dietary 双版本（实例版+独立函数版）共存 | 新增限制需同步修改两处 | 合并为单一实现，deprecate 其中一个 |
| TD-08 | `CHANNEL_TO_SOURCES` inline 定义 | 非全局常量，外部无法复用 | 提取到 `channel.ts` 或 `types/` 统一维护 |
| TD-09 | `GlobalOptimizer` 无 ΔL 早停 | 跑满 24 轮即使已无改善 | 加 `if (bestGain <= 0) break` 早停 |
| TD-10 | `LearnedRanking` DIM_COUNT 与 SCORE_DIMENSIONS 分离 | 注释称"V7.4=14 维"但实际值在外部 types，难以确认 | 加 runtime assert：`if (DIM_COUNT !== SCORE_DIMENSIONS.length) throw` |

---

## Batch 3 完结

**全文已交付**：能力全景表（A.1-A.11）+ 第 0-12 章（总览/入口/上下文/渠道/召回/可行性/评分链/健康/装配/优化/学习/画像/技术债）。

**文档总行数**：`~990+ 行`（含 A.11 地区/季节/时区/价格升级专项）。
