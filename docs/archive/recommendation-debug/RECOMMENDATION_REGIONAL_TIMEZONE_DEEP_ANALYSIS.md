# 推荐引擎 · 地区与时区能力深度分析（II）

> 续 `RECOMMENDATION_REGIONAL_TIMEZONE_ANALYSIS.md` 阶段 1~4 完工后的二轮审计。
> 视角：把"地区+时区"作为情境信号，沿"用户画像三层 × 推荐能力六层"全链路追踪，
> 找出**已有阶段1~4 未覆盖**的遗留盲点 / 死代码 / 隐性 bug / 数据资产浪费。
>
> 本文不重复一轮已闭环的内容（preloadRegion、currentMonth、PriceFitFactor 雏形、
> RegionalCandidateFilterService、UNKNOWN 衰减、ChannelAvailabilityFactor 等已交付）。

---

## 0. 范围与方法

**用户画像三层（来源：`profile-resolver.service.ts`）**
| 层 | 来源 | 是否吃到 region/timezone |
|---|---|---|
| `declared` | `UserProfiles` 表 | regionCode/timezone/locale 字段已存在；budgetPerMeal/currencyCode 已加 schema 但 0 读取 |
| `contextual` | `ContextualProfileService` 实时计算 | localHour/dayOfWeek/isWeekend 已用 timezone util ✅ |
| `inferred` | `ProfileInferenceService` LLM 推断 | 0 次出现 region/timezone — **完全无感知** |

**推荐能力六层（按数据流向）**
1. Recall（召回）
2. Filter（过滤）
3. Score（评分）
4. Rerank（重排/优化）
5. Explain（解释）
6. Learning（反馈学习）

矩阵交叉每一格，标注当前覆盖度。

---

## 1. 全景矩阵（× = 完全无；△ = 部分；✓ = 完整）

| 能力层 ↓ ／ 信号 → | regionCode | timezone (currentMonth) | timezone (localHour) | locale | 价格(priceMin/Max) | budgetPerMeal | currencyCode |
|---|---|---|---|---|---|---|---|
| **Recall** | × | × | × | × | × | × | × |
| **Filter** | △¹ | × | × | × | × | × | × |
| **Score** (seasonality) | ✓ | ✓ | × | × | × | × | × |
| **Score** (regional boost) | ✓ | × | × | × | × | × | × |
| **Score** (channel avail) | × | × | ✓² | × | × | × | × |
| **Score** (price fit) | × | × | × | × | × | × | × |
| **Rerank/MOO** | × | × | × | × | × | × | × |
| **Explain** | × | × | × | △³ | × | × | × |
| **Learning** | × | × | × | × | × | × | × |
| **Inferred Profile** | × | × | × | × | × | × | × |

¹ 只查"当前 region 的 FoodRegionalInfo 行"，未跨 region 比较，无行 = 视为可用
² 时段→渠道映射用本地小时
³ 仅用 locale 做翻译，不输出"因地区/季节"原因

---

## 2. 关键遗留逐项

### 2.1 召回层零 region 过滤（最大遗留）

**位置**：`food-pool-cache.service.ts:449` `loadCategoryFromDB`

```ts
const sql = this.buildFoodPoolSQL(
  'WHERE f.is_verified = true AND f.category = $1',  // ← 全球用户共享同一池
);
```

**问题**：
- 所有用户读同一个全量 verified 食物池，**美区用户也会拿到油条/腊肉**等中区独有食物
- 缓存键 `pool:{category}` 不带 region → 混区污染
- 当一个食物在某 region **完全没有 FoodRegionalInfo 行**时，`RegionalCandidateFilterService` 把它视为可用，但实际可能根本不在该地区销售

**影响**：
- 召回污染向下游 score/rerank 传播，最终靠"软评分降权"挽救，但 top-N 截断时仍可能漏过
- 法规禁售食物（如某些含咖啡因饮品在中东禁售）在无 `regulatoryInfo` 行的食物上无法拦截

**根因**：召回层认为食物池是全局的；地区差异完全交给打分/过滤兜底处理。

---

### 2.2 价格信号断链（数据资产浪费）

**链路实况**：

```
USDA/OFF/AI → enrichment-apply.service.ts:649 写入 priceMin/priceMax/currencyCode/priceUnit ✓
                                                            ↓
                                                     food_regional_info 表 ✓
                                                            ↓
                                                    推荐链 0 次读取 ✗
```

**当前 `PriceFitFactor`**（`price-fit.factor.ts:55`）只读：

```ts
const cost = food.estimatedCostLevel ?? 2;  // 食物级粗粒度 1-5
```

`estimatedCostLevel` 来自 `food_portion_guides`（**全球同一值**），无法区分：
- 同一杯咖啡：北京 ¥15 vs 纽约 $5 vs 东京 ¥400
- 同一份牛肉：阿根廷 vs 日本

**`UserProfiles.budgetPerMeal` (Decimal) + `currencyCode` 字段已在阶段 2.1 加入 schema，但全代码库 0 读取**。

**影响**：
- 美区用户 budget=$15/餐 与中区用户 budget=¥30/餐 在引擎眼里完全等价
- 价格适配只做了"等级匹配"，不做"币种+地区单价"匹配

---

### 2.3 SceneResolver 时区 bug（隐性 DST 问题）

**位置**：`scene-resolver.service.ts:156, 276, 352`

```ts
const dayOfWeek = new Date().getDay();   // 服务器时区！
const hour = new Date().getHours();      // 服务器时区！
```

**问题**：
- `recordChannelUsage` 把"用户行为"按服务器周几/小时分桶
- `inferByRules` 按服务器小时推断"早/午/晚/夜"
- DST 切换日跨小时直接错位
- 美区用户晚 8 点（北京时间晨 8 点）被服务器误判为"早餐时段"

**影响**：
- ctx.channel 来自 sceneContext.channel；channel 错 → ChannelAvailabilityFactor 给错乘数
- channelUsage 学习数据按错误时段聚类，越学越偏

**注**：`contextual-profile.service.ts` 已正确用 `getUserLocalHour(timezone)`，但 `scene-resolver` 是另一条路径，没修。

---

### 2.4 Inferred Profile 完全不感知 region

**位置**：`profile-inference.service.ts`

LLM 推断画像时没有传 `regionCode/locale` 给 prompt。

**问题**：
- 中区用户"早餐爱吃面食" vs 美区用户"早餐爱吃 cereal"在同一 prompt 上下文中推断
- LLM 没法学到"该用户偏好与 region 群体的差异"
- 冷启动用户 + 美区 → LLM 默认按训练分布（中文偏多）误推

**影响**：inferred 偏好回写后污染 declared，全链路偏移。

---

### 2.5 Recall 缓存键未按 region 分桶

**位置**：`food-pool-cache.service.ts` cache key = `category` 单维度

```ts
return this.cache.getOrSet(category, () => this.loadCategoryFromDB(category));
```

**问题**：即使 2.1 修复了 SQL where 加 region 过滤，**一份缓存被所有 region 共享**，先到的用户决定后到的用户看到什么。

**修法预备**：缓存键升级为 `${region}:${category}`。

---

### 2.6 Weight-Learner 未按 region 分桶

**位置**：`optimization/weight-learner.service.ts:154,184`

```ts
const key = `${USER_REDIS_PREFIX}${userId}:${goalType}`;          // userId 维度
const mealKey = `${USER_MEAL_REDIS_PREFIX}${userId}:${goalType}:${mealType}`;
```

**问题**：
- 全球权重学习只按 `userId+goalType+mealType` 分桶
- 没有"区域级先验"层 — 美区新用户冷启动只能用全局均值，不能继承"美区已学权重"
- 群体迁移学习能力缺失

**理想结构**（参考 churn/CF 服务的层级）：
```
global → region → user
```

---

### 2.7 解释层不输出地区/季节原因

**位置**：`explanation/explanation-generator.service.ts`

只用 locale 翻译，不会生成：
- "本月当地正值草莓季"
- "你所在地区常见这道菜"
- "符合你 ¥30/餐 的预算"

**影响**：用户拿到推荐时不知道为什么是这一道；信任度下降。

---

### 2.8 死代码 AvailabilityScorerService.scoreWithRegion / scoreWithTime（未消化）

阶段 1 文档已提及；当前已通过 `ChannelAvailabilityFactor` 接通"渠道×时段"路径，
但 `availability-scorer.service.ts` 里仍保留：
- `scoreWithRegion`（与 `RegionalBoostFactor` + `SeasonalityService` 重叠）
- `score`（旧矩阵，被 `ChannelAvailabilityFactor` 内联取代）
- `preloadRegion`（实际只 query 不存）

**应处理**：删除整个文件，从 `recommendation.module.ts` providers 移除。

---

### 2.9 Region 数据 staleness 无监控

**位置**：`FoodRegionalInfo.sourceUpdatedAt` (Date) + `confidence` (Float)

**问题**：写入时记录了，但推荐链零读取：
- 不知道某 region 的数据是 1 个月还是 3 年前的
- `confidence < 0.3` 的低质量数据和 0.95 的高质量数据被同等对待
- `applyConfidenceDecay` 只用了 `seasonalityConfidence`，没用整行的 `confidence`

**修法**：在 `RegionalBoostFactor` / `SeasonalityService.getSeasonalityScore` 里加二级衰减：
- `effectiveBoost = (raw - 1) * confidence + 1`
- 数据陈旧（>180 天）额外打 0.9 折

---

### 2.10 多 region 用户切换无缓存失效

**问题**：用户从中国出差到美国，把 `UserProfiles.regionCode` 改成 'US'：
- preference-profile 缓存 `regional_boost:CN:v1` 仍存活
- 该用户的画像缓存 `profile:userId` 也未感知 region 变化
- 结果：下一次推荐拿旧 region 的 boost map

**已有**：`REGION_DATA_CHANGED` 事件（写入端 emit）只在**食物池区域数据变更**时触发，不在用户改 region 时触发。

**修法**：`UserProfileService.update()` 检测 regionCode 变化时 emit `USER_REGION_CHANGED`，listener 清该用户相关的 profile/preference 缓存。

---

### 2.11 跨表"价格/可获得性"未参与多目标优化（MOO）

**位置**：`pipeline-builder.service.ts` 的多目标优化阶段

当前 MOO 目标里没有：
- "本地化匹配度"（matches user.region）
- "预算偏离度"（|food.price - budgetPerMeal|）

**影响**：当 score 平局时，rerank 不会偏向"更本地化"的食物。

---

### 2.12 时区对"近期食用窗口"不正确

**位置**：`recommendation-engine.service.ts` / `feedback` 多处用 `new Date(Date.now() - 7*86400000)` 做"7 天窗口"

**问题**：
- "今天是否吃过这道菜"判断用 UTC 边界
- 美西用户晚 11 点（UTC 次日 7 点）吃了一道菜，第二天本地 8 点会被判断为"昨天吃过" → 实际是同一日
- 多样性去重（usedNames 7 天窗口）也用 UTC 边界 → 可能漏掉相邻日重复

**修法**：所有"按日"窗口改用 `getUserLocalDate(timezone)` 划界。

---

## 3. 画像 × 能力交互盲点（更宏观）

### 3.1 `declared.locale → 食物名翻译` 链路断
- 食物有 `FoodTranslations` 表存多语言名称
- 推荐链返回食物时根据 `userProfile.locale` 选 i18n 名称的逻辑只在 explanation 里有
- 食物列表（top-N）输出时未做翻译

### 3.2 `contextual.scene + region` 未联动
- contextual 推断 "晚餐 + late_night + canteen 不可用" 已知道
- 但没结合 region：中区 late_night 便利店 24h 可达 vs 美区便利店多数关门
- `CHANNEL_TIME_MATRIX` 是全球共享一张表，不分 region

### 3.3 `inferred.dietary_preference` 与 `region` 不交互
- 推断 "用户喜欢辣" 后没标记 "在川渝 region 是常态 / 在沪杭 region 是显著偏好"
- 群体相对偏好缺失，导致"区域内推荐多样性"无法实现

### 3.4 季节冲突未处理
- 用户 7 月从北京（北半球夏）飞到悉尼（南半球冬）
- timezone 切到 `Australia/Sydney` 后，`currentMonth=7`，但 monthWeights 的语义是"月份"，没有半球翻转
- 食物 `monthWeights[6]=0.9`（北半球 7 月草莓）传到悉尼会错配

**修法**：`FoodRegionalInfo` 写入时已按 region 存月份权重；只要召回时按 region 分桶就解决。但当前 2.1 没修 → 这个 bug 放大。

---

## 4. 修复优先级建议

| # | 项 | 影响面 | 难度 | 推荐 |
|---|---|---|---|---|
| P0 | 2.3 SceneResolver 时区 bug | 全用户每次推荐 | 极低 | ✅ 已修 |
| P0 | 2.10 用户改 region 后缓存失效 | 跨地区用户 | 低 | ✅ 已修 |
| ~~P1~~ | ~~2.1 + 2.5 召回层 region 分桶 + 缓存分桶~~ | ~~多 region 部署~~ | ~~中~~ | ❌ 取消（架构合理） |
| P1 | 2.8 删除 AvailabilityScorerService 死代码 | 代码债 | 低 | ✅ 已删 |
| P1 | 2.9 confidence 二级衰减 | 评分质量 | 低 | ✅ 已修 |
| P2 | 2.2 PriceFitFactor 升级用 priceMin/priceMax/budgetPerMeal | 价格敏感用户 | 中 | 阶段化 |
| P2 | 2.7 解释输出地区/季节原因 | 用户信任 | 中 | 阶段化 |
| P2 | 2.12 时区日窗口 | 多样性去重 | 低 | 修 |
| P3 | 2.6 Weight-Learner region 分桶 | 冷启动 | 高 | 长期 |
| P3 | 2.4 Inferred Profile 注入 region | LLM 质量 | 中 | 长期 |
| P3 | 2.11 MOO 加本地化目标 | 重排细化 | 高 | 长期 |
| P3 | 3.x 画像×能力深度联动 | 战略 | 高 | 长期 |

---

## 5. 本轮落地范围（P0+P1）

> 状态：✅ 已落地（typecheck 通过）。原计划 5 项，实际落地 4 项，1 项重新评估后取消（见下）。

### ✅ P0-1：scene-resolver 时区修复
- `scene-resolver.service.ts` 三处 `new Date().getDay()/getHours()` 替换为 `getUserLocalDayOfWeek/getUserLocalHour(timezone)`；
- `recordChannelUsage` 内的 `new Date().toISOString().slice(0,10)` 改为 `getUserLocalDate(timezone)`；
- `resolve / recordChannelUsage / learnFromHistory / inferByRules` 全链路新增 `timezone?: string` 参数（缺失回退 `DEFAULT_TIMEZONE`，即 `regional-defaults.ts` 中的 `'America/New_York'`）；
- `recommendation-engine.service.ts` 在调用处透传 `enrichedProfile.declared?.timezone`。

### ✅ P0-2：用户 region 变更缓存失效
- 新增 domain event `USER_REGION_CHANGED` + class `UserRegionChangedEvent`（`core/events/domain-events.ts`）；
- `UserProfileService.updateDeclaredProfile()` 在 `regionCode` 实际变化时 emit 事件；
- 新增 `UserRegionCacheInvalidationListener`（`recommendation/profile/`）：清 `pref_profile:{userId}` 与 `scene:user:{userId}:patterns` 两个用户维度缓存前缀；
- `regional_boost:{countryCode}` 是 country 维度共享缓存，**不**在用户切换时清；
- declared/aggregated profile 缓存仍由现有 `PROFILE_UPDATED` 路径失效，避免重复。

### ❌ P1-1：召回层 region 分桶（取消）
- **重新评估结论**：现有架构合理，不应改动。
- foodPoolCache 是 region 无关的"全量已验证食物池"，按品类分片缓存；region 过滤已由后置 `RegionalCandidateFilterService`（按 `FoodRegionalInfo.confidence` 软过滤 RARE/forbidden）+ `RegionalBoostFactor` 加权承担。
- 在 SQL 层加 region 过滤会破坏"foreign 食物 fallback"能力（如 region=DE 用户也应能看到通用食物 apple），且使缓存按 region×category 笛卡尔膨胀。
- 同一物理食物跨 region 共享，region 差异通过 `FoodRegionalInfo (foodId, countryCode)` 维护是正确的设计。

### ✅ P1-2：删除死代码 AvailabilityScorerService
- 删除 `recommendation/utils/availability-scorer.service.ts`（其逻辑已被 `ChannelAvailabilityFactor`（渠道×品类×时段）+ `RegionalBoostFactor` + `SeasonalityService` 三处取代）；
- 移除 `recommendation.module.ts` 中的 import 与 provider 注册；
- 更新 `pipeline-builder.service.ts` 与 `scene.types.ts` 中过期注释。

### ✅ P1-3：RegionalBoost confidence 二级衰减
- `PreferenceProfileService.getRegionalBoostMap()` 在用 `availability` 算出 raw boost 后，应用两级衰减：
  1. `effective = (raw - 1) × confidence + 1`（低置信度向 1.0 拉回）；
  2. `sourceUpdatedAt > 180 天` 视为陈旧，额外 `(eff - 1) × 0.9 + 1`（向 1.0 收缩 10%）；
- 衰减后 `|boost - 1| ≤ 1e-3` 的条目不再写入 boostMap（节省下游遍历）；
- 新增 helper `clamp01()` / `isStaleSource()`（兼容 Prisma 可能返回 number / Decimal / null）。

P2/P3 留作后续 PR。

---

## 6. 验收标准

- 单元/类型校验：`npx tsc --noEmit` 零错误
- 关键日志可观测：
  - `[SceneResolver] hour=... tz=...` 体现本地时区
  - `[FoodPool] region=... category=... loaded N foods` 体现分桶命中
  - `[RegionCacheInvalidate] userId=... oldRegion=... newRegion=... cleared K keys`
- 死代码消除：`grep -r AvailabilityScorerService src/` 零结果
- Confidence 衰减：score 日志包含 `boost*conf=` 字段

---

## 7. 与一轮文档的关系

| 一轮文档章节 | 本轮处理 |
|---|---|
| 阶段 1 区域+时区基础 | 已闭环；本轮不动 |
| 阶段 2 schema + 写入端事件 | 已闭环；2.10 补"用户端改 region"事件 |
| 阶段 3 候选过滤 | 已闭环；2.1 补召回层分桶（更上游） |
| 阶段 4 评分 | PriceFitFactor 已立但只是雏形（2.2 升级方案）；2.9 补 confidence 衰减 |
| 阶段 5（未做） | 仍延后 |
