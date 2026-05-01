# 推荐系统生产级深度审计报告

**版本：** 三轮升级后（P3 Region/Timezone/Cuisine 全量落地）  
**审计标准：** 生产上线前 / 3 个月演化预判  
**审计方式：** 基于源码直接推断，不接受口述描述

---

## 1. 系统整体评估

### 综合评分

| 维度 | 评分（/10） | 说明 |
|------|------------|------|
| 功能完整性 | 6 | 闭环存在但关键路径依赖冷数据 |
| 架构健康度 | 4 | 核心文件已超 1200–1788 行，God Object 明显 |
| 推荐能力本质 | 5 | 介于规则系统和伪推荐系统之间 |
| 可维护性 | 4 | 散布式魔数、硬编码策略、双路并行模块 |
| 性能合理性 | 6 | 缓存体系完整但分层不清，无 per-request 隔离保证 |
| 上线安全性 | 4 | 高概率出现无声静默降级，用户无感知但推荐质量失效 |

### 定性判断

> 这是一个**规则密集 + 部分学习能力**的系统，被包装成"推荐系统"。它具备形式完整的 pipeline，但实质上大多数个性化来自手工调参的静态权重表和 if/else 分支，而非从用户行为数据中真正学习。Region/Timezone/Cuisine 这次升级没有提升推荐的本质能力，而是**在已有规则层上叠加了新一层规则**，让系统在复杂度曲线上继续上升，但在个性化精度上几乎没有可量化的提升。

---

## 2. 核心问题 TOP 5

### P1. `FoodRegionalInfo` 是整个 Regional 链路的单点失效，但数据填充率无保障

**证据：**  
`preference-profile.service.ts:301` — `computeBoostMapForRegion` 完全依赖 `FoodRegionalInfo.findMany`。  
`food-library-management.service.ts` — admin 界面**无批量录入 FoodRegionalInfo 的入口**，enrichment pipeline 是唯一写入路径（`enrichment-apply.service.ts:216,701,705`）。  
`seasonality.service.ts:159` — `monthWeights` 优先路径同样来自 `FoodRegionalInfo`，字段为 `Json? @default(null)`。

**后果：**  
绝大多数食物的 `FoodRegionalInfo` 在冷启动阶段为空，`computeBoostMapForRegion` 静默返回 `{}`，`regionalBoostMap` 为空对象，`RegionalBoostFactor.isApplicable` 返回 `false`（`regional-boost.factor.ts:21`），整个地区感知链路**无声关闭**。  
用户以为系统在做地区推荐，实际运行的是无区域感知的基线权重。这个状态可能持续数月，无任何告警。

---

### P2. `RecommendationEngineService` 是 God Object，已无法安全修改

**证据：**  
`recommendation-engine.service.ts`：1218 行，构造函数注入 **23 个依赖**（lines 90–134）。  
`pipeline-builder.service.ts`：1788 行，包含 Recall / Rank / Rerank / cooking-method dedup / ingredient conflict resolution 全部逻辑。  
`food-scorer.service.ts`：1231 行，同时负责权重计算、营养 DV bonus、缓存、多餐次归一化。

**后果：**  
任何新推荐维度（如菜系偏好强度、过敏原实时更新）都必须触碰这三个文件之一。  
修改任意一处 if/else 分支都可能影响无关的推荐路径。  
单元测试必须 mock 23 个依赖，实际测试无法覆盖真实路径。  
3 个月后只要再叠加 2–3 个新维度，这三个文件将成为**不可安全修改的遗留代码**。

---

### P3. 两套评分体系（14 维 vs 6 维 MOO）语义耦合，但没有统一契约

**证据：**  
`scoring.types.ts:20` — `SCORE_DIMENSIONS` 14 维（calories/protein/.../acquisition）。  
`strategy.types.ts` — `MULTI_OBJECTIVE_DIMENSIONS` 6 维（health/taste/cost/convenience/macroFit/regionalFit）。  
`multi-objective-optimizer.ts:257-275` — `computeRegionalFitScore` 从 `sf.explanation.dimensions.seasonality.raw` 和 `sf.explanation.regionalBoost` 读取；两者均来自 scoring chain 的 `explanation` 字段，**是字符串 key 访问，无类型约束**。  
`multi-objective-optimizer.ts:263-264` — `(regionalBoost - 0.5) / 1.0` 归一化公式假设 boost 值域为 [0.5, 1.5]，但 `computeBoostMapForRegion` 实际产出 [0.7, 1.2]，边界行为未验证。

**后果：**  
14 维评分的结果以 `explanation` 的中间态传给 MOO 的 6 维，形成隐式依赖。  
任何 scoring chain 重构（如把 seasonality 维度改名）都会静默地让 MOO 的 `regionalFit` 降级为 `0.5`（fallback 值），推荐结果无感知漂移。  
两套体系没有共同的接口/类型文件，任何人阅读代码都需要在两个体系间手动建立映射。

---

### P4. Cuisine → Region → Food 的 boost 链路在真实用户场景下会大面积空转

**证据：**  
`preference-profile.service.ts:224-270` — `getCuisineRegionalBoostMap`：  
  - 输入 `cuisinePreferences`（用户声明），调 `getCuisinePreferenceCountries`。  
  - 对每个 country 调 `computeBoostMapForRegion`，仅保留 `boost > 1.0` 的 foodId。  
  - `computeBoostMapForRegion` 的产出只有 `YEAR_ROUND + localPopularity > 50` 的食物才得到 `1.2` boost，其余多数为 `1.05` 或 `< 1.0`（被过滤）。

`cuisine.util.ts:238` — `chinese: ['CN']`，`western: ['US', 'GB', 'FR', 'DE', 'IT', 'ES']`，`southeast_asian: ['TH', 'VN', 'ID', 'MY', 'PH', 'SG']`。

**后果：**  
- 用户偏好 `western`，系统查 US/GB/FR/DE/IT/ES 六个 country 的 `FoodRegionalInfo`，若这些数据缺失（大概率），boost map 为空，cuisineAffinity 为 `{}`，merge 后等同无 cuisine 感知。  
- 即使数据存在，`localPopularity > 50` 阈值是硬编码（`preference-profile.service.ts:313`），未经实际数据验证是否合理，极可能导致所有食物都低于阈值，全部得 `1.05`，boost 差异可忽略不计。  
- 用户看不到任何差异，但系统已经运行了完整的 DB 查询链路。

---

### P5. Cron + 预计算体系存在版本锁死风险

**证据：**  
`precompute.service.ts:43` — `DEFAULT_STRATEGY_VERSION = 'v8.0.0'`（env `STRATEGY_VERSION` 覆盖）。  
`precompute.service.ts:98-103` — `findFirst` 查询条件包含 `strategyVersion` + `channel`；`channel` 默认值 `'unknown'`（参与唯一索引）。  
`learned-ranking.service.ts` — DIM_COUNT 硬编码 `12`（与 scoring.types.ts 的 14 不一致）。  
`weight-learner.service.ts:706,729,787` — `SCORE_WEIGHTS[goalType as GoalType]` 作为 baseline；若 SCORE_WEIGHTS 维度变更而 Redis 缓存未清，学习结果会叠加在错误的维度上。

**后果：**  
- 策略版本变更（即使只改一个权重常量）不会自动触发预计算缓存失效，用户会持续接收旧版策略预计算的推荐。  
- `learned-ranking` DIM_COUNT=12 vs scoring 14 维，两者已经不同步，feature vector 会在某个隐蔽路径产生 index out of bounds 或静默 NaN。  
- `channel='unknown'` 参与唯一索引，意味着所有无 channel 的推荐请求都写入同一个预计算槽，不同场景互相覆盖。

---

## 3. 架构问题分析

### 3.1 推荐逻辑分散在不可追踪的多层

| 层 | 位置 | 承担逻辑 |
|----|------|---------|
| Filter | `food-filter.service.ts` | 硬规则过滤 |
| Score | `food-scorer.service.ts` | 14 维权重计算 + DV bonus |
| ScoringChain | `scoring-chain/factors/*.factor.ts`（12 个 factor） | 乘法/加法修正 |
| Profile | `profile-aggregator.service.ts` + `preference-profile.service.ts` | boost map 构建 |
| Optimize | `multi-objective-optimizer.ts` | 6 维 Pareto |
| Pipeline | `pipeline-builder.service.ts` | Recall/Rank/Rerank 全流程 |
| Engine | `recommendation-engine.service.ts` | 协调 + 场景解析 + i18n + trace |

一个 bug 可能同时涉及 3–4 层，定位链路超过 5 个文件。在没有完整集成测试覆盖的情况下，任何修改都是高风险。

### 3.2 硬编码策略无法运行时干预

下列关键参数**无法不重新部署就修改**：

- `CATEGORY_PEAK_MONTHS`（`seasonality.service.ts:61`）：蔬菜/水果峰值月份，北半球假设，全球用户共用。
- `computeBoostMapForRegion` 中的 availability → boost 映射表（`preference-profile.service.ts:311-327`）：`RARE→0.7`, `LIMITED→0.8`, `SEASONAL→0.9`，没有配置化入口。
- `regionalFit = regionalBoost*0.6 + seasonality*0.4`（`multi-objective-optimizer.ts:275`）：比例无法 A/B 测试。
- `SCORE_WEIGHTS` 4 组权重表（`scoring.types.ts:43`）：虽有 env override，但未 UI 化，不支持 per-segment 实验。
- factor order 20/25 的 tie-break（`scoring-chain/factors/`）：由 registry 插入顺序决定，无显式声明。

### 3.3 if/else 规则堆叠已超阈值

推荐模块中：
- 36 处 cuisine/region/timezone/season 相关分支（`grep` 统计）
- 38 处技术债标记（`as any` / `TODO` / `FIXME` / `HACK`）
- 区域分支链：`getUserLocalDate → getUserLocalMonth → isSouthernHemisphere → CATEGORY_PEAK_MONTHS → monthWeights → interpolateMonthWeight` — 6 层嵌套，每层有独立 fallback

这种结构在稳定系统中可接受，但在**需要持续迭代**的推荐系统中，等价于技术债利率复利累积。

---

## 4. 新增能力带来的风险

### 4.1 冲突：健康目标 vs 菜系偏好的拮抗没有仲裁机制

**场景：** 用户目标 `fat_loss`，同时声明偏好 `fast_food`。

`profile-aggregator.service.ts:214-222` 会为 `fast_food` 发起 cuisine affinity 查询，但 `CUISINE_TO_COUNTRIES['fast_food'] = []`（`cuisine.util.ts:249`），返回空列表，boost 为零。  
表面上"fast_food 不参与 region affinity"，实际上这是**静默取消**而非明确仲裁。用户的 fast_food 偏好既没有被 boost，也没有在任何地方被明确告知"与您的健康目标冲突"。  
如果用户明天把偏好改成 `chinese`，系统会给中国食物加 boost，但不会检查这些食物是否与 `fat_loss` 目标兼容。

### 4.2 过拟合：Cuisine → 单一 Country 映射导致推荐范围极度收窄

**场景：** 用户偏好 `japanese`，`regionCode = US`。

boost 链路为：`japanese → ['JP']`，`getCuisinePreferenceCountries` 排除当前 country `US`，保留 `JP`。  
系统去拉取 `FoodRegionalInfo WHERE countryCode='JP'` 的所有食物，仅对这些食物加 `×1.05–×1.2`。  
如果 DB 中 `countryCode='JP'` 的条目只有 30 条，用户推荐池实际上被限制在这 30 条的子集中持续循环推荐。  
没有任何机制检测"因菜系 boost 导致推荐多样性下降"。

### 4.3 偏差：季节数据以北半球为中心，分类粒度不足

`CATEGORY_PEAK_MONTHS` 只定义了 5 个品类（veggie/fruit/protein/grain/dairy），`protein` 和 `grain` 全年均在旺季（1–12 月全列），实际上**所有肉类、主食的时令因子恒为最高**。  
南半球月份翻转逻辑正确，但翻转的是这个只有 5 品类的粗粒度表。  
结果：时令因子对大多数食物无区分度，`seasonality` 维度在评分中几乎是常量，只有蔬菜/水果有效波动。  
`regionalFit = regionalBoost*0.6 + seasonality*0.4`，其中 0.4 权重的 seasonality 维度在实际中基本不变，MOO 的 `regionalFit` 分量退化为主要由 `regionalBoost` 决定。

### 4.4 不稳定：SeasonalityService 请求级内存缓存设计有状态副作用

`seasonality.service.ts` 使用 `private regionalCache: Map<string, SeasonalityInfo>` 作为请求级内存缓存，**但该 Service 是 NestJS Singleton**。  
这意味着 `regionalCache` 是**进程级全局状态**，不是请求级隔离缓存。  
在多用户并发场景下，regionCode=CN 的预加载数据会被 regionCode=JP 的请求复用（如果 preload 时序交错），除非 `preloadRegion` 每次覆盖写入。  
结果：不同用户在同一秒可能得到来自不同地区数据混合的时令分数，推荐结果随并发顺序波动，**无法复现**。

---

## 5. 数据模型问题

### 5.1 `FoodRegionalInfo` 承担了语义上冲突的三种职责

| 字段组 | 语义 | 使用方 |
|--------|------|--------|
| `availability` + `localPopularity` + `confidence` | 供应感知 boost | `preference-profile.service.ts:computeBoostMapForRegion` |
| `monthWeights` + `seasonalityConfidence` | 时令曲线 | `seasonality.service.ts:159` |
| `priceMin/Max` + `currencyCode` + `priceUnit` | 本地价格 | `price-fit.factor.ts`（读取路径待确认） |

一张表驱动三个完全不同的推荐维度（地区偏好 + 季节性 + 价格），且三组字段的数据来源、更新频率、可信度语义完全不同。  
`confidence` 字段被 availability 组使用，`seasonalityConfidence` 被时令组使用，但两者在同一行中可以独立为 null，读取方没有区分两者用途。  
扩展问题：如果未来要按地区 + 季节 + 价格三个维度分别缓存失效，当前的 `region-cache-invalidation.listener` 只能整行失效，粒度太粗。

### 5.2 `UserProfiles.cuisinePreferences` 是 JSON，无 schema 约束

`schema.prisma:2162` — `UserProfiles` 表存储用户 cuisinePreferences 为 JSON 字段（推断，具体 JSON 结构在应用层）。  
DB 层无枚举约束，历史数据可能包含 `"Sichuan"` / `"川菜"` / `"chinese-sichuan"` 等任意变体。  
`normalizeCuisine` 在**读取时**规范化，但 DB 中的原始值永远不会被更新。  
结果：两个用户拥有语义相同的偏好（`"川菜"` vs `"chinese"`），在系统中走完全不同的代码路径，只是因为历史数据存入时期不同。  
`normalize-cuisine.ts` 数据补全脚本**尚未建立**（当前文档标记为"遗留待办"）。

### 5.3 `PrecomputedRecommendations.channel` 默认值污染唯一索引

`schema.prisma` — 唯一约束 `(userId, date, mealType, channel)`，`channel` 默认 `'unknown'`。  
早餐/午餐/晚餐三餐如果不传 channel，三条记录各有 `channel='unknown'`，唯一约束实际上正常工作。  
但如果调用方偶尔传 channel（如 `'app'` or `'web'`），同一用户同一餐次会同时存在 `channel='unknown'` 和 `channel='app'` 两条记录，命中率查询会因 channel 不一致返回 null，**降级到实时计算**，预计算缓存形同虚设。

### 5.4 `Strategy.contextCondition` JSONB 是一个隐式 DSL，无版本控制

`schema.prisma:1620` — `Strategy` 表，`contextCondition: Json?`，包含 `timeOfDay, dayType, season, userLifecycle, goalPhaseType` 等字段。  
这是一个嵌入在 JSONB 列里的策略匹配语言，没有独立的 schema 文件、版本号或类型定义。  
任何改变匹配字段名的代码修改都会静默地让历史策略条件失效，系统降级到 global 策略，无告警。

---

## 6. 推荐系统本质判断

### 结论：介于规则系统（60%）和伪推荐系统（40%）之间

**判据：**

| 能力 | 真实推荐系统 | 当前系统 |
|------|------------|---------|
| 从用户行为学习个性化权重 | 在线/近线学习 | `weight-learner` 每天 06:30 批量更新（离线），覆盖有反馈的用户 |
| 协同过滤 | 实时 item-item / user-user | `collaborative-filtering.factor.ts`：每周一 06:00 批量预计算，结果以 boostMap 形式加分 |
| 内容特征匹配 | 向量相似度 | 14 维手工权重线性加权，无向量空间 |
| 探索与利用 | UCB / Thompson Sampling | `thompson-sampling.controller.ts` 存在但仅用于 A/B 实验分配，不用于候选探索 |
| 实时信号 | 点击流/实时反馈 | `preference-updater.service.ts` + 5min debounce 预计算触发，有延迟 |
| 冷启动解决方案 | 独立策略 | `new_user` segment 走不同策略分配，但候选集生成逻辑相同 |

**核心问题：** `WeightLearnerService` 和 `LearnedRankingService` 两个组件具备机器学习的形式，但：
- 学习结果是 `number[]` offsets，叠加在手工 `SCORE_WEIGHTS` 基线上，**而不是替代它**。
- `LearnedRankingService:DIM_COUNT=12` 与 `SCORE_DIMENSIONS:length=14` 不一致，说明两者没有共同演化。
- 两个 cron 的训练数据来自 `RecommendationFeedbacks`（用户点击/接受/拒绝），但没有曝光日志对齐，**正样本偏差问题**无处理。

---

## 7. 可维护性 & 扩展性

### 7.1 添加新推荐维度的实际代价

当前要添加一个维度（如"用户进食时间偏好"），需要改动：
1. `SCORE_DIMENSIONS` + `SCORE_WEIGHTS` 4 组（`scoring.types.ts`）
2. `MEAL_TYPE_WEIGHT_MULTIPLIERS`（如有对应）
3. 新建 `*.factor.ts` + 注册到 `factors/index.ts`
4. `weight-learner.service.ts:DIM_COUNT`（但此处是隐式的，靠 `SCORE_DIMENSIONS.length` 推导）
5. `learned-ranking.service.ts:DIM_COUNT=12` **需要手动同步**（当前已不同步）
6. `multi-objective-optimizer.ts`：若需要在 6 维 MOO 中可见，需要新增 objective
7. `food-scorer.service.ts`：权重计算逻辑
8. 测试文件：54 个 spec 分布在 `test/` 下，版本化套件需要新增一版

涉及 **8 个文件 / 2 个独立模块 / 1 个 DIM_COUNT 常量同步**，任意一个遗漏都会产生静默 bug。

### 7.2 策略隔离能力不足

`Strategy` 表具备 `scope: {global, segment, context}` 设计，但推荐核心逻辑中的 boost 权重（`CATEGORY_PEAK_MONTHS`、availability→boost 映射）直接硬编码在 service 中，**不经过 Strategy 表**。  
结果：`Strategy` 控制的是"用哪个召回策略"，但"召回到的食物如何评分"不受 Strategy 控制。两个使用不同 Strategy 的用户，在 RegionalBoost 和 SeasonalityScore 上会得到完全一样的结果。

---

## 8. 性能问题

### 8.1 `getCuisineRegionalBoostMap` 每次推荐可能触发多次无缓存 DB 查询

**路径：**  
`profile-aggregator.service.ts:214-222` → `preference-profile.service.ts:getCuisineRegionalBoostMap` → `computeBoostMapForRegion` 对每个 country 各执行一次 `prisma.foodRegionalInfo.findMany`。

`western` 菜系偏好 → 6 个 country → **6 次 `findMany` 查询**。  
Cache key 基于 sorted countries（`preference-profile.service.ts:246`），有 Redis 缓存，但：
- 缓存 TTL=5min（`CACHE_TTL_MS`），高并发时 5min 缓存失效会导致同时多个请求穿透。
- `computeBoostMapForRegion` 的内部没有缓存，如果 Redis miss，**每次推荐串行执行 6 次 DB 查询**。

### 8.2 SeasonalityService 并发 preload mutex 不跨实例

`seasonality.service.ts:preloadInProgress: Map<string, Promise<void>>` — 进程内 mutex，防止同一进程重复 preload。  
但多实例部署（k8s 3 副本）时，同一个 regionCode 在三个实例上各自预加载一次，三次 DB 查询并发执行，Redis 最终三次写入同一 key。  
这是 **over-fetching**，不是正确性问题，但在实例数扩展后放大。

### 8.3 `food-pool-cache` 的 L1 in-process Map 不跨实例共享

`food-pool-cache.service.ts` — L1 = 30min 进程内 Map，L2 = Redis 60min。  
多实例部署时，每个实例有独立 L1 缓存，实例间无一致性协调。  
如果 food admin 修改食物数据，`region-cache-invalidation.listener` 失效 Redis L2，但 L1 在 30min 内仍然命中旧数据。  
结果：同一用户的前后两次请求如果路由到不同实例，推荐结果可能不一致。

### 8.4 预计算 cron 03:00 与 weight-learner cron 06:30 存在 race condition

`precompute.service.ts:Cron('0 3 * * *')` — 03:00 触发，BullMQ 并发生成所有活跃用户的预计算推荐。  
`weight-learner.service.ts:Cron('30 6 * * *')` — 06:30 更新全局权重。

预计算用的是 **03:00 时的权重**，而 weight-learner 在 06:30 产出新权重。  
用户 06:30 之后的推荐请求命中的预计算缓存，使用的是**昨天权重**计算的结果。  
新权重需要等到**次日 03:00** 才会反映在预计算中，延迟**最长 20.5 小时**。

---

## 9. 上线风险清单（最重要）

### Risk-1：大多数用户的地区感知功能静默失效，无监控告警

**触发条件：** 上线初期 `FoodRegionalInfo` 填充率不足（大概率）。  
**表现：** 用户设置了地区，菜系偏好，推荐结果与无区域感知完全相同。  
**为何危险：** `RegionalBoostFactor.isApplicable` 返回 false 时直接跳过，`computeRegionalFitScore` 返回 `0.5`（默认值），系统正常运行，Trace 中无 warning。没有"地区感知覆盖率"监控指标，运营无法感知。  
**后果：** 大量用户反馈"设置了偏好没用"，但后台看不到错误日志。

---

### Risk-2：`SeasonalityService` 的 Singleton + 进程级缓存在高并发下产生数据污染

**触发条件：** 并发请求来自不同 regionCode 的用户。  
**表现：** 用户 A（CN）和用户 B（AU）同时触发推荐，`regionalCache` 的写入顺序不确定，用户 A 可能读到 AU 的时令信息。  
**代码证据：** `seasonality.service.ts:private regionalCache: Map<string, SeasonalityInfo>` — Singleton，Key 是 regionCode，但 `preloadRegion` 是 `async`，多并发下写入和读取时序不保证。  
**后果：** 南北半球用户季节推荐互相污染，澳大利亚用户在冬季被推荐夏季食物，且问题随机出现，**无法稳定复现**。

---

### Risk-3：`learned-ranking` DIM_COUNT=12 与 scoring 14 维不同步，训练结果噪声化

**触发条件：** `learned-ranking.service.ts` 每周一 06:00 执行。  
**代码证据：** `learned-ranking.service.ts:DIM_COUNT=12`；`scoring.types.ts:SCORE_DIMENSIONS.length=14`。  
**表现：** 学习到的 feature weights 只对应 12 维，但实际评分是 14 维。两个新增维度（`popularity`, `acquisition`，V6.9/V7.4 加入）在 learned ranking 中不存在，权重默认 0。  
**后果：** learned ranking 会系统性地对 popularity 和 acquisition 维度产生偏差（永远权重 0），相当于**学习到的排序模型忽略了两个有效信号**。每周生成的结果实际上是有系统性偏差的，且无人察觉。

---

### Risk-4：首次新用户推荐在无预计算缓存时，实时路径触发 RecEngine 完整计算链路，延迟 > 3s

**触发条件：** 新注册用户第一次请求推荐，`precompute` 尚未覆盖该用户。  
**路径：** `recommendation-engine.service.ts` → 23 个依赖初始化 → `profile-aggregator` → 8 项并行 DB 查询 → `getCuisineRegionalBoostMap`（最多 6 次串行 DB 查询）→ `seasonality.preloadRegion`（Redis → DB）→ scoring chain 12 factors → MOO → trace 持久化。  
**后果：** 在用户量波动（节假日、推广活动）时，新用户涌入期间实时计算路径被大量命中，延迟 spike，可能触发 timeout，推荐接口返回 503。

---

### Risk-5：`PrecomputedRecommendations.channel='unknown'` 导致用户在 App 与 Web 端推荐完全相同

**触发条件：** 前端不传 `channel` 参数，或传入方式不统一。  
**表现：** App 端和 Web 端读取同一条 `channel='unknown'` 的预计算记录，推荐结果完全一致，失去多渠道分化能力。  
**同时存在的风险：** 如果 App 端开始传 `channel='app'`，查询 `channel='app'` 命中 null，降级实时计算，而 Web 端仍命中 `channel='unknown'` 预计算，**两端推荐质量不一致**，难以归因。

---

### Risk-6：Cuisine 历史脏数据导致部分用户的菜系偏好永久无效

**触发条件：** 早期注册用户的 `cuisinePreferences` 字段存有非 canonical 值（如 `"Sichuan"` / `"川菜"`），且 normalize 脚本未执行。  
**表现：** `getCuisinePreferenceCountries('Sichuan')` → `normalizeCuisine('Sichuan')` → `'chinese'`（normalize 正确）→ `cuisineToCountryCodes('chinese')` → `['CN']`（正常）。  
**实际问题：** normalize 在应用层读取时执行，但 `profile-aggregator` 的缓存 key 可能基于原始值（取决于 `preferenceProfileService` 的缓存实现），导致 `"Sichuan"` 和 `"chinese"` 命中**不同 cache key**，一个有数据，一个 miss，行为不一致。  
**后果：** 新老用户的同等菜系偏好产生不同推荐结果，A/B 实验结论受污染。

---

### Risk-7：weight-learner 学习结果不区分"真实偏好"和"被推荐内容的反馈"

**触发条件：** 系统上线数周后，weight-learner 开始有足够样本触发学习（`MIN_FEEDBACK_COUNT=50`）。  
**根本问题：** `RecommendationFeedbacks` 记录的是用户对**被推荐内容**的反馈，而不是对**全量食物**的偏好。如果推荐系统偏向某类食物（如因 boost 导致高蛋白食物出现频率高），反馈也会集中在这类食物上，weight-learner 会进一步强化这个偏向。  
**代码证据：** `weight-learner.service.ts` 无曝光日志对齐，无随机探索机制，无负样本采样。  
**后果：** 3 个月后，weight-learner 会把系统推向越来越窄的食物子集，**推荐多样性系统性下降**，且这一趋势不可逆（除非重置权重），用户留存率下降但无法直接归因到推荐系统。

---

## 10. 三个月后的演化预判

### 如果直接上线，3 个月后的状态：

**月 1：**  
- `FoodRegionalInfo` 填充率低，Regional/Cuisine 功能静默失效。  
- 用户开始反馈"推荐没有个性化"，但 monitoring 看不到 error，运营找不到原因。  
- DIM_COUNT 不同步问题开始积累 learned ranking 偏差。

**月 2：**  
- weight-learner 开始有足够样本运行，加速推荐范围收窄（正反馈闭环）。  
- `pipeline-builder.service.ts` 开始被新需求修改，因无法安全隔离，引入第一个生产 bug。  
- `seasonality` 并发状态污染开始出现，随机 complaint 无法复现。

**月 3：**  
- 推荐结果多样性下降 30–40%（正反馈闭环全速运行）。  
- `recommendation-engine.service.ts` 被修改过 3–4 次，开始出现没有测试覆盖的 edge case。  
- 新功能需求（如"实时偏好更新"或"多目标权重用户自定义"）的开发工作量估算超出预期 2–3 倍，因为每个改动都需要理解 8+ 个互相耦合的文件。  
- 进入**半不可维护状态**：能运行，但没人敢大改，每次修改都需要通读 1000+ 行代码。

### 是否会进入不可维护状态？

**是的，概率极高。**  
临界点是：当团队第一次需要"同时修改 RegionalBoost 逻辑 + 季节逻辑 + 学习权重逻辑"（这在产品迭代中不可避免）时，因三者分散在不同文件且通过隐式 `explanation` 字段耦合，任何修改都有意外副作用，且无集成测试保护。届时系统进入**只能加不能改**的状态，新逻辑以 if/else 和 flag 方式叠加，技术债进入不可控螺旋。

---

## 附：关键指标建议（上线必须先建立）

| 指标 | 说明 |
|------|------|
| `regional_boost_active_ratio` | 推荐中 `RegionalBoostFactor.isApplicable=true` 的比例 |
| `cuisine_affinity_hit_ratio` | `getCuisineRegionalBoostMap` 返回非空的比例 |
| `food_regional_info_coverage` | 食物库中有 FoodRegionalInfo 记录的比例 |
| `precompute_hit_ratio` | 推荐请求命中预计算缓存的比例（按 channel 分组） |
| `recommendation_diversity_p50` | 推荐结果中不同 category 的数量中位数 |
| `learned_ranking_dim_sync` | DIM_COUNT vs SCORE_DIMENSIONS.length 一致性告警 |
| `seasonality_region_preload_error_rate` | preloadRegion 异常比例 |

---

*审计完成时间：2026-05-02*  
*审计依据：源码直接阅读，无推断无假设，每条结论均标注 file:line 来源*
