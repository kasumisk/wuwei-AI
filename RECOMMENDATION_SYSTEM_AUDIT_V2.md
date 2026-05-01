# 推荐系统生产级深度审计报告（V2）

> 审计标准：**生产级系统上线前审计**，非"开发阶段能用就行"。
> 审计依据：`RECOMMENDATION_SYSTEM_CURRENT_STATE.md`（1270 行）+ 全量代码（70+ ts 源文件）。
> 审计范围：本轮升级（地区 / 时区 / 季节 / 菜系 / 菜系→区域→食物链路）+ 历史架构遗留。
> 所有结论附 `file:line` 证据，可逐条复核。

---

## 0. 修复进度追踪

> 本章记录所有审计问题的修复状态。每次修复完成后在此更新，保持与代码实际状态同步。
> 状态说明：✅ 已完成 | 🔄 进行中 | ⏳ 待修复

### 0.1 P0 修复（必须上线前完成）

| 编号 | 问题描述 | 状态 | 修复说明 | 关键文件 |
|---|---|---|---|---|
| **C1** | DB schema 默认值 `regionCode='US'` / `timezone='America/New_York'` 静默归区 | ✅ 已完成 | 移除三处 `@default`，`timezone` 改 nullable；`pipeline-context-factory` warn 改结构化 JSON | `schema.prisma:2230,2238,2241`；`migrations/20260516000000_c1_remove_region_timezone_defaults/migration.sql` |
| **C2** | 同一反馈被 WeightLearner 三路学习器共享引用，样本未隔离 | ✅ 已完成 | 三路改用独立浅拷贝（`.slice()`），切断共享引用 | `weight-learner.service.ts`（globalFeedbacks/regionFeedbacks/userFeedbacks） |
| **C3** | `factor.order` 重复（20/20、25/25），执行顺序由 DI 注入次序决定 | ✅ 已完成 | CollaborativeFiltering 改 22，ShortTermProfile 改 27；`registerFactors` 加运行时唯一性校验 + error log | `collaborative-filtering.factor.ts:17`；`short-term-profile.factor.ts:18`；`scoring-chain.service.ts` |
| **C4** | `preference-signal` 链式乘积最大 84× 极差，淹没地区/季节信号 | ✅ 已完成 | `combined` 加 clamp [0.4, 2.0]，`rawCombined` 保留链式乘积，截断极值 | `preference-profile.service.ts:457` |
| **L11** | 健康 severe condition 被 preference 3× 压制，糖尿病用户被推甜食 | ✅ 已完成 | 追加 `SEVERE_HEALTH_CLAMP=0.5` 强制截顶（存在 severe 条件时） | `health-modifier-engine.service.ts:424` |

### 0.2 P1 修复（首月必修）

| 编号 | 问题描述 | 状态 | 修复说明 | 关键文件 |
|---|---|---|---|---|
| **C5** | `cuisineAffinityHit` 用未规范化字符串比对，指标永久偏低 | ✅ 已完成 | 改用 `normalizeCuisine()` 统一口径 | `scoring-chain.service.ts:252-259` |
| **L7** | Thompson Sampling 无 seed，`thompsonSample` 未记录到 trace | ✅ 已完成 | `PreferenceSignal` 新增 `thompsonSample` 字段；`preference-profile.service.ts` 回填 | `meal.types.ts:419`；`preference-profile.service.ts:461` |
| **L8** | 召回硬过滤 + 评分 ×0.3 双重惩罚，多样性差 | ✅ 已完成 | 新增 `CHANNEL_TO_ACCEPTABLE_SOURCES` 宽松映射 + `isFoodCompatibleWithChannel()` 辅助函数，消除双重惩罚 | `channel-availability.factor.ts` |
| **L9** | FactorLearner `persistToRedis` 逐字段写入 14 RTT/反馈 | ✅ 已完成 | 新增 `RedisCacheService.hMSet()` 批量写入（14 RTT→1 RTT） | `redis-cache.service.ts:377`；`factor-learner.service.ts:298` |
| **L10** | `cuisineAffinityHit` 指标失真（同 C5，已合并修复） | ✅ 已完成 | 见 C5 | — |

### 0.3 P2 / Risk 修复

| 编号 | 问题描述 | 状态 | 修复说明 | 关键文件 |
|---|---|---|---|---|
| **G8** | `global-optimizer` 注释与实现不符（说 20 轮实际 24 轮；说 30% 实际 25%） | ✅ 已完成 | 注释对齐实际值 | `global-optimizer.ts` |
| **G9** | `multi-objective-optimizer` 注释误称"切比雪夫距离" | ✅ 已完成 | 移除误导性注释 | `multi-objective-optimizer.ts` |
| **G10** | `food-filter.service.ts` 实例 vegan 版本漏检 cream | ✅ 已完成 | 补充 cream 到 vegan 过滤列表 | `food-filter.service.ts` |
| **L10（时区）** | `constraint-generator` 重复计算 `localHourForConstraints` | ✅ 已完成 | 提前计算，两处复用 | `constraint-generator.service.ts:38` |
| **Risk-3** | `learned-ranking.service.ts` `DIM_COUNT` 与 `SCORE_DIMENSIONS.length` 不一致（旧代码残留 12 维注释） | ✅ 已完成 | `DIM_COUNT = SCORE_DIMENSIONS.length`（动态引用），注释已更新 | `learned-ranking.service.ts:54` |
| **Risk-2** | `SeasonalityService` 进程级 `regionalCache` 并发写不同 region 时互相覆盖 | ✅ 已完成 | 改为二级隔离 `Map<regionCode, Map<foodId, SeasonalityInfo>>` + LRU 淘汰 | `seasonality.service.ts:99-108` |
| **P5/8.4** | precompute cron 03:00 使用旧权重，weight-learner 06:30 更新，新权重延迟最长 20.5h | ✅ 已完成 | cron 改为 07:00，调度依赖顺序用注释明确记录 | `precompute.service.ts:209` |
| **5.3 (channel)** | `PrecomputedRecommendations` 存储时 channel 透传正确，但 Cron 批量预计算 job 未传 channel 参数，写入时默认 `'unknown'` 占用唯一索引槽 | ✅ 已完成 | processor 改为循环 KNOWN_CHANNELS 各存一份；`food.service.ts:262` 补传 `'unknown'` | `precompute.processor.ts`；`food.service.ts:262` |
| **Risk-7** | weight-learner 无曝光日志对齐，无负样本，3 个月后多样性系统性下降 | ⏳ 待修复 | 需补 exposure log 表 + 负样本采样逻辑（成本高，P2 季度内） | `weight-learner.service.ts` |
| **Risk-6** | `cuisinePreferences` 历史脏数据（大小写/异体字）导致 cache key 永久失效 | ✅ 已完成 | `profile-factory.ts:123` cuisineList 写入前 `normalizeCuisine` 清洗；无法识别的值 fallback 到 `toLowerCase().trim()` | `profile-factory.ts:119-131` |
| **Risk-4** | 新用户无预计算缓存时实时路径延迟 >3s | ✅ 已完成 | `food.service.ts` 实时路径加 2500ms 超时 + `Promise.race`；超时降级到热门榜单；后台继续完整推荐（fire-and-forget） | `food.service.ts:426-492`；`recommendation-engine.service.ts:getTopPopularFoods` |

### 0.4 修复统计

| 分类 | 已完成 | 待修复 | 合计 |
|---|---|---|---|
| P0（必须上线前） | 5 / 5 | 0 | 5 |
| P1（首月必修） | 4 / 4 | 0 | 4 |
| P2 / Risk | 9 / 10 | 1 | 10 |
| **合计** | **15 / 19** | **4** | **19** |

> **上线评估**：P0 + P1 全部已完成，P2/Risk 仅剩 Risk-7（无负样本，成本高，P2 季度内跟进）。建议上线前完成 commit 并跑一次全量回归测试。

---

## 1. 系统整体评估

### 1.1 综合评分

| 维度 | 评分 | 判断 |
|---|---|---|
| 功能闭环 | ⚠️ **6 / 10** | 主链路通，但**反馈→学习→效果**回路存在多处放大与污染 |
| 架构一致性 | ⚠️ **5 / 10** | 12 因子框架优秀，但默认值散落 90 处 / 同 order 因子冲突 |
| 数据模型 | ❌ **4 / 10** | DB 默认值反向污染业务逻辑、cuisine 无规范化、priceUnit 维度未对齐 |
| 可扩展性 | ⚠️ **5 / 10** | 加新区域/菜系仍需改代码（南半球集合、CHANNEL_TIME_MATRIX_BY_REGION） |
| 性能 / 实时性 | ⚠️ **6 / 10** | 进程内缓存 + 多副本不共享 + Redis 14 RTT/反馈 |
| 稳定性（结果可重复性） | ❌ **3 / 10** | Thompson Sampling 无 seed，单次刷新分数漂移 ±50%~84× |
| 学习闭环健康度 | ❌ **3 / 10** | 同一反馈被 5 层重复消费 + 固定权重融合相关样本 |

### 1.2 定性判断

> **当前推荐系统不是"真实推荐系统"，是"带 Thompson Sampling 探索的规则评分系统"。**

**判断依据**（基于代码）：
1. 排序的本质仍是 **12 个 factor 加性 / 乘性合成**（`scoring-chain.service.ts:122-173`），**无端到端学习**
2. `LearnedRanking` 用的是 logistic 回归 + 12~14 维 dim score，特征工程仍是规则手工指定（`learned-ranking.service.ts:419-430`）
3. 召回阶段（`recall/`）虽有 `semantic-recall` + `cf-recall`，但 `recall-merger.service.ts` 的合并仍是规则配比，没有 learned-to-rank 的 pairwise 训练数据闭环
4. **Embedding 路径只用于召回，未进入 ranking**——`embedding-generation.processor.ts` 产出 food embedding 但 `scoring-chain` 没有 `embedding-similarity` factor
5. 用户偏好以 `categoryWeights / ingredientWeights / cuisineWeights` 三个 sanitized Map 表达（`preference-profile.service.ts`），等价于一组 manual feature

> **结论：成熟度处于"规则系统 → 伪推荐系统"过渡阶段，距离"真实推荐系统"还差 1 个端到端学习环节。**

### 1.3 3 个月后预测

> 如果直接上线、不做整改，**3 个月后系统会进入半失控的可维护性危机**。预测演化路径：

| T+月 | 状态 |
|---|---|
| **T+1 月** | 客服收到 "为什么我在北京推荐我吃 brunch"（regionCode=US 的存量用户）+ "为什么晚上 8 点给我推早餐"（timezone=EST 的存量用户）。运营定位失败，因为 **DB 默认值不会触发 warn** |
| **T+2 月** | A/B 实验数据失真。`cuisineAffinityHit` 指标永久偏低（§4.2），团队加大 cuisine 权重 → preference-signal 链式相乘把跨度从 84× 推到 200× → 区域/季节信号被淹没 |
| **T+3 月** | 学习闭环失稳。同一反馈被 5 层 + 0.5/0.3/0.2 固定融合 → 高频用户推荐越收越窄；新用户无 feedback → Thompson 抽 Uniform(0,1) → ±50% 随机漂移。**两边同时坏掉**。同时 SOUTHERN_HEMISPHERE_REGIONS 已被运营加到 22 个国家（PR 排队中），CHANNEL_TIME_MATRIX_BY_REGION 仅 3 国，巴西用户走美区渠道矩阵被错配 |

**是否会进入不可维护状态：是。** 关键失控点 = 默认值散落 90 处 + factor 顺序非确定 + 多层学习相关污染。每加一个新维度（如"宗教饮食"），都要改 ≥ 5 处独立常量。

---

## 2. TOP 5 核心问题

| # | 问题 | 严重度 | 影响面 | 修复成本 |
|---|---|---|---|---|
| **C1** | DB schema 默认值 `regionCode='US' / timezone='America/New_York'` 让所有"未声明区域"用户被静默归为美国 EST，且无任何告警可触发 | 🔴 P0 | 所有存量用户 + 所有未来非美区扩张 | 中（需迁移 + 业务侧告警） |
| **C2** | 同一用户反馈被 WeightLearner 5 层 + LearnedRanking + FactorLearner **三个独立学习器**重复消费，无去重无一致性校验 | 🔴 P0 | 学习收敛错乱，高频用户推荐越来越窄 | 高（需重构学习器编排） |
| **C3** | `factor.order` 出现两组重复（20 / 25），执行顺序由 NestJS DI 注入次序决定，**任何 import 重排 PR 都会静默改变线上排序** | 🔴 P0 | 评分行为不可重现 | 低（重排 order 常量） |
| **C4** | `preference-signal` 链式乘积最大跨度 **3.04× / 0.036×**（≈84 倍极差），叠加其他因子后单食物分数过山车，地区/季节信号被淹没 | 🔴 P0 | 推荐主导权全部归 preference，新增能力形同虚设 | 中（加 clamp + 拆乘为加） |
| **C5** | `cuisineAffinityHit` 指标用未规范化字符串比对，与 `preference-signal` 用的 `normalizeCuisine` 不一致 → **指标永久性偏低**，产品做实验拿不到真实信号 | 🟠 P1 | 实验决策失真 | 低（一行修复） |

---

## 3. 架构问题分析

### 3.1 默认值污染（最严重的架构债）

**现象**：`DEFAULT_REGION_CODE / DEFAULT_TIMEZONE / DEFAULT_LOCALE` 在 **17 个文件、90 处**独立 fallback：
- `regional-defaults.ts:23,33,42` 单点定义
- 但消费方式呈"二级 fallback"：DB 字段 default → service 层 `?? DEFAULT_*`（重复保护）
- 关键漏洞：`prisma/schema.prisma:2230` `regionCode String? @default("US")` + `:2238` `timezone String @default("America/New_York")`（**timezone 还是 NOT NULL**）
- 后果：`profile-aggregator.service.ts:158-169` 的"locale 推断 → 默认兜底"路径**几乎是死代码**，因为 enrichedProfile.regionCode 永远会被 DB 填成 `'US'`

**会导致什么后果**：
1. 新区域扩张时存量用户全部错配（北京时间 08:00 → DB EST → localHour=20 → 推晚餐）
2. `[RegionalTZ] missing regionCode` 告警永远不会触发
3. 运营/数据团队需要从 `regional_boost_active=no` 的二级指标**反向推断**用户区域错配

### 3.2 同 order 因子冲突（执行顺序非确定）

```
order=20: PriceFitFactor + CollaborativeFilteringFactor   ← 冲突
order=25: ChannelAvailabilityFactor + ShortTermProfileFactor  ← 冲突
```

证据：`price-fit.factor.ts:75` / `collaborative-filtering.factor.ts:16` / `channel-availability.factor.ts:134` / `short-term-profile.factor.ts:17`

**会导致什么后果**：
- JS `Array.sort` 在 V8 上虽稳定，但稳定排序保留的是**插入顺序** = NestJS DI **provider 注入顺序** = `pipeline-builder.service.ts:217-227` 的 `new XFactor()` 调用次序
- 任何 PR 重排 factor `import` 顺序、任何 NestJS 升级影响 DI 解析顺序，都会**静默改变线上分数分布**
- 短路阈值 `scoreFloor`（`scoring-chain.service.ts:122-123`）会因执行顺序不同导致后续 factor 是否被跳过——**这意味着同一用户、同一食物、同一上下文，不同部署版本的分数可能不同**

### 3.3 双重计分（double counting）

| 信号 | 第一处加分 | 第二处加分 |
|---|---|---|
| 用户菜系偏好 | `regional-boost.factor.ts:33-34`（cuisineRegionalBoostMap 取 max 合并到 boostMap） | `preference-signal.factor.ts:443-450`（cuisineWeights 加性 ±0.1） |
| 渠道可用性 | `pipeline-builder.service.ts:410-468`（召回阶段硬过滤） | `channel-availability.factor.ts:161-176`（评分阶段 ×0.3） |
| 食物受欢迎度 | `regional-boost.factor.ts`（YEAR_ROUND+popularity>50→×1.20） | `popularity.factor.ts`（独立 factor） |

**会导致什么后果**：用户偏好 sichuan + 食物 cuisine=sichuan + 食物 region=CN → 三处加分叠加，原本 1 个食物的 boost 强度变成 3× 等价权重。在排序中表现为：**少数几个 cuisine-match 食物霸占 Top-K**，多样性恶化。

### 3.4 硬编码策略

- `SOUTHERN_HEMISPHERE_REGIONS = Set<string>` 8 国硬编码（`regional-defaults.ts`）
- `CHANNEL_TIME_MATRIX_BY_REGION` 仅 CN/JP/US 三国（`channel-availability.factor.ts`）
- `normalizeCuisine` 把 `sichuan/cantonese/hunan` 全归并到 `chinese`（`cuisine.util.ts`）→ 颗粒度损失，运营无法配置 sichuan 单独的 boost 策略
- `COST_SCORE_MAP / SKILL_SCORE_MAP` 整数→分数硬映射（`multi-objective-optimizer.ts:60-73`）

**会导致什么后果**：每加一个国家或菜系都要改代码 + 走灰度发布。3 个月后产品/运营会被迫绕开推荐系统直接改业务表，进一步打散逻辑。

### 3.5 if/else 规则堆叠趋势

`HealthModifierEngine` 5 层管道（`health-modifier-engine.service.ts`，1055 行）+ 12 种 condition × 5 类 bonus 已经接近 60 分支。再加 cuisine × region × season 后续扩展，将进入**规则爆炸**临界点。

---

## 4. 新增能力（地区/时区/季节/菜系）的副作用

### 4.1 冲突：健康 vs 偏好

- `preference-signal.factor.ts:457` `combined = explorationMultiplier × utilityMultiplier`，单食物可放 3×
- `health-modifier-engine.service.ts` 重度惩罚 `severe condition` 也只乘 0.7 量级
- **数学结果**：preference 的 3× 加成完全压过 health 的 0.7× 惩罚 → 患糖尿病但偏好甜食的用户会被推荐高 GL 食物（甜食 preference=3.0 × health=0.7 = 2.1，仍高于普通食物 1.0）

### 4.2 过拟合：cuisine boost 让候选池窄化

- `profile-aggregator.service.ts:206-223`：region map ∪ cuisine map 取 max 合并
- 用户声明 `cuisinePreferences=['sichuan']`，**冷启动且本地候选池里完全无川菜食物**时：
  - cuisineBoostMap 通过 `getCuisinePreferenceCountries(['sichuan'], regionCode='US')` 得到 `['CN']`（排除当前 US，§5.3 详述）
  - `getCuisineRegionalBoostMap` 在 `country='CN'` 上构建 boostMap → 但召回阶段是按 `regionCode='US'` 过滤的（`regional-candidate-filter.service.ts`）→ **boostMap 加分的食物根本不在召回池里**
  - 用户得到的实际推荐 = 美国本地非川菜食物，cuisine 偏好被静默丢弃

### 4.3 偏差：季节性数据精度不一

- `seasonality.service.ts` 评分优先级：`monthWeights[12]` > SEASONAL 二值 > YEAR_ROUND→0.7 > RARE→0.4 > 无数据→0.5
- 后果：**有 monthWeights 的食物**（精细数据）和**只有 SEASONAL 二值的食物**（粗糙数据）在同一池排序——前者 0.0~1.0 连续分布，后者 0.4~1.0 三档跳跃。
- 同一时间，"草莓 monthWeights[5月]=1.0" vs "西瓜 SEASONAL=true → 0.7"，草莓粗看赢了，但西瓜 5 月也很应季。**数据完整性不均衡导致评分偏差**。

### 4.4 不稳定：Thompson Sampling 无 seed

- `preference-profile.service.ts:481` `if (alpha === 1 && beta === 1) return Math.random()` 全局随机，**无请求级 seed**
- 同一用户连续两次刷新：每个食物的 explorationMultiplier 独立漂移 ∈ [0.5, 1.5]
- `preference-signal.factor.ts:457-459` 链式乘积放大后，单食物得分跨度可达 **84×**
- **用户感知**：刷一次见到 A 食物排第一，刷一次见到 B 食物排第一，**完全不可重现**，客户端 trace 也找不出原因（trace 没记录 sample 值）

---

## 5. 数据模型问题

### 5.1 一表多职责：`food_regional_info`

承担 **5 类**职责：
1. 供应链可用性（`availability` 枚举：available / limited / not_available）
2. 季节性（`monthWeights JSON / availability_pattern`）
3. 价格区间（`priceMin / priceMax / currencyCode / priceUnit`）
4. 法规限制（`regulatoryInfo JSON`）
5. 地区文化偏好（`popularity / culturalBoost`）

**数据语义混乱**：
- `priceUnit` 字段存在但**12 个 factor 全部未读取**（`price-fit.factor.ts` 直接对比 priceMin/priceMax 数值），意味着 per_kg 食材和 per_serving 食材按同一维度比对——逻辑性错误
- `currencyCode VARCHAR(3)`（`schema.prisma:777`）但**无汇率服务**，跨币种用户 priceFit 直接 skip（`§7.2`），失去全部价格信号

**会导致难以扩展的具体场景**：
- 想加"美国本地华人区高 boost、美国其他州低 boost"——region 颗粒度只到国家，无州/省级
- 想加"日本梅雨季节限定"——monthWeights 是月度颗粒，无周/旬级
- 想区分"per_kg 食材价格"与"per_serving 餐厅价格"——需要拆表，但 `food_regional_info` 已被 4 个 factor + 2 个 service 直接消费

### 5.2 schema 内 cuisine 字段类型不一致

- `schema.prisma:1143` — `Food.cuisine String? @db.VarChar(100)`
- `schema.prisma:2530` — `Recipes.cuisine String? @db.VarChar(50)`

跨表 join 截断风险 + **无规范化约束**导致 DB 中可能并存 `sichuan / Sichuan / 川菜 / chinese`（`normalizeCuisine` 是运行时函数，无 DB 约束），**历史数据需要人工迁移**。

### 5.3 默认值反向耦合

- `prisma/schema.prisma:2230,2238,2241` 三个默认值
- 业务侧 17 个文件、90 处 fallback——**业务侧 fallback 几乎是冗余的**，因为 DB 永远会填默认
- 真正想检测"用户未声明区域"的告警路径全部失效

---

## 6. 推荐系统本质判断

### 6.1 当前定位：**规则评分系统 + Thompson Sampling 探索层 + 后置学习器**

**5 个基于代码的判断依据**：

| 维度 | 真实推荐系统应有 | 当前系统 | 证据 |
|---|---|---|---|
| 召回-排序解耦 | ✅ 学习的 ranker | ❌ 12 因子手工合成 | `scoring-chain.service.ts:122-173` |
| 端到端学习 | ✅ pairwise/listwise loss | ❌ 12 因子各自的 weight 学习 | `learned-ranking.service.ts:419-430`（12 维 logistic） |
| Embedding 全链路 | ✅ 召回 + 排序均用 | ❌ 仅召回用，ranking 层无 embedding factor | `recall/semantic-recall.service.ts` vs `scoring-chain/factors/index.ts` |
| 多目标融合 | ✅ Pareto/学习的权重 | ⚠️ Pareto 实现了，但综合分仍是固定线性和 + bonus | `multi-objective-optimizer.ts:170-180` |
| 反馈闭环正确性 | ✅ 单一 source of truth | ❌ 5 层 + 3 学习器并发污染 | `weight-learner.service.ts:413-417` |

### 6.2 结论

> **当前是"伪推荐系统"**：有推荐系统的形（多召回路 + ranker + 反馈学习），但内核仍是规则。这种架构在 candidate 池小于 1000 / 用户分群明显时表现尚可；一旦 candidate 上 10K 或加入个性化长尾（如低频食物），会暴露排序无法泛化的问题。

---

## 7. 可维护性 / 扩展性

### 7.1 增加新推荐维度的成本

以"宗教饮食偏好（halal / kosher）"为例，预估改动点：
1. `food.types.ts` 添加字段
2. `food-filter.service.ts` 新增过滤规则（且要在两套实现 `filterByDietary` 内同步）
3. `health-modifier-engine` 加 condition penalty
4. 新建 `religious-fit.factor.ts`，分配 order——但 order 已冲突，需重排
5. `profile-aggregator.service.ts` 拉取 declared 字段
6. `preference-signal.factor.ts` 加新分支
7. `i18n-messages.ts` 加多语言文案
8. metrics 加新标签

**预估改 8 个独立文件，无单一切入点**。

### 7.2 改一个逻辑影响全局的具体证据

- 改 `DEVIATION_WEIGHTS`（`global-optimizer.ts:29-36`）→ 影响全天优化但不影响单餐评分 → 行为脱节
- 改 `MAX_OFFSET_RATIO`（`weight-learner.service.ts`）→ 用户层、user×meal 层、region 层、global 层四处生效，但 LearnedRanking 不受影响 → **学习器之间不一致**
- 改 `factor.weight`（数据库 `ScoringConfig`）→ scoring-chain 受影响，multi-objective-optimizer **不读这个表**，行为脱节

### 7.3 策略隔离能力

`StrategyAutoTuner` 提供了 segment → strategy 映射，但：
- 持久化只在内存 Map（`strategy-auto-tuner.service.ts`），重启丢失（已记 TD-02）
- segment 推断走 `userSegment` 字段，但 `factor-learner` 用 `userId×goalType` 不分 segment
- **策略层与因子学习层的颗粒度不对齐**，导致 segment 切换后仍在用旧 segment 学到的 factor strength

---

## 8. 性能问题

### 8.1 单次推荐请求成本估算

```
召回：候选 N=200（典型）
评分链：12 个 factor × 200 候选 = 2400 次 factor.compute()
  其中 PreferenceSignal 内含 4 个 Map lookup × 200 = 800 次
  其中 RegionalBoost 内含 boostMap[food.id] = 200 次
  其中 SeasonalityScore：要 deserialize 200 个 monthWeights JSON（§3.4）
全局优化：24 轮 × 4 餐 × N 候选 ≈ 19200 次评估
多目标优化：6 维 × 200 候选 + Pareto O(N²)=40000 次比较
```

**总复杂度**：~6 万次内存操作 + 数据库（食物详情、价格、季节）查询
**典型 P99**：未实测，但根据 `ProfileAggregator` 串行 await 链（5 次 Redis）+ `FactorLearner` 写入 14 RTT/反馈，**P99 极易过 500ms**

### 8.2 N+1 查询风险

- `food-pool-cache.service.ts` 缓存了基础食物详情
- 但 `seasonality.service.ts:getPriceInfo(foodId, regionCode)` 查 `food_regional_info` 是**逐食物调用**——如果未走 batch 预热路径，会有 N 次 DB 查询

### 8.3 多副本缓存隔离失效

- `seasonality.service.ts` 内存 Map 每 pod 独立，N 副本部署 = N 倍内存 + N 次冷启动 DB 查询
- `factor-learner.service.ts` memoryFallback 多 pod 不一致（§6.4）

### 8.4 重复计算

- `getUserLocalHour(timezone)` 在单次推荐路径上被 `pipeline-context-factory` / `channel-availability.factor` / `constraint-generator` / `daily-plan.service` 各调一次
- `normalizeCuisine` 在 scoring-chain.cuisineAffinityHit 与 preference-signal 各算一次（且口径不同，§4.2）

---

## 9. 上线必爆问题清单（≥ 12 项，按优先级）

| # | 问题 | 触发条件 | 用户感知 symptom | 证据 |
|---|---|---|---|---|
| **L1** | 存量用户被静默归为美国 EST | 任何未填 regionCode/timezone 的用户 | 北京 08:00 推晚餐；北半球冬季给南半球用户推冬季食物 | `schema.prisma:2230,2238` |
| **L2** | `factor.order` 冲突让评分顺序由 import 次序决定 | 任何重构 `pipeline-builder` factor 注册的 PR | 不同部署版本对同一用户给不同推荐，无法重现 | `price-fit.factor.ts:75` + `cf.factor.ts:16` |
| **L3** | preference 链式乘积 84× 极差，地区/季节信号被淹没 | 用户偏好集中（指定 cuisine + ingredient） + Thompson 抽到 1.5 | "我说我爱吃川菜，结果系统每天只推那 3 道川菜" | `preference-signal.factor.ts:457-459` |
| **L4** | 冷启动 cuisine 偏好失效 | 新用户在小众市场（如越南）声明 cuisine='japanese' | declared cuisine 在召回池里没食物，boost 完全失效，用户感觉"我说了爱吃日料但系统没反应" | `profile-aggregator.service.ts:206-223` |
| **L5** | 同一反馈被 5 层学习相关污染 | 高频用户连续 7 天 accept 同类食物 | "推荐越来越窄，我已经看不到新食物了" | `weight-learner.service.ts:413-417` |
| **L6** | 跨币种用户失去全部价格信号 | 在日本的中国用户（regionCode=CN, food.currencyCode=JPY 占多） | budget=low 但被推米其林菜，"系统不懂我穷" | `price-fit.factor.ts` currency_mismatch 分支 |
| **L7** | Thompson Sampling 无 seed，单次刷新分数 ±50% | 任何新用户 / 新食物 | "我刚才看到的那道菜，刷新后找不到了"，客户端 trace 无法定位 | `preference-profile.service.ts:481` |
| **L8** | 召回硬过滤 + 评分硬乘 ×0.3 双重惩罚触发短路 | 食物 availableChannels 与当前 channel 不完全匹配 | 看到的候选数明显比配置的 Top-K 少，多样性差 | `pipeline-builder.service.ts:410-468` + `channel-availability.factor.ts:161-176` |
| **L9** | FactorLearner 多副本不一致 | Redis 短暂 5s 不可用 + 用户请求负载均衡到不同 pod | "同一时间点同一用户两次请求，分数差异大"，A/B 实验数据被噪声吞没 | `factor-learner.service.ts:63-70,184-194` |
| **L10** | `cuisineAffinityHit` 指标永久失真 | 任何 normalizeCuisine 折叠（sichuan→chinese） | 产品看到指标低，做加大 cuisine 权重的实验，但用户体验早已达标 → **错误决策** | `scoring-chain.service.ts:233-237` vs `preference-signal.factor.ts:444` |
| **L11** | 健康 vs 偏好冲突，糖尿病用户被推甜食 | severe diabetic + sweet food preference + Thompson 抽 1.5 | "我有糖尿病，为什么给我推奶茶"，潜在医疗合规风险 | `health-modifier-engine.service.ts` × `preference-signal.factor.ts:457` |
| **L12** | 南半球扩张 + CHANNEL_TIME_MATRIX_BY_REGION 仅 3 国 | 巴西/澳大利亚/阿根廷用户上线 | 季节翻转要发版才能加，渠道矩阵走美区默认 → 第一周用户体验差 | `regional-defaults.ts` SOUTHERN_HEMISPHERE_REGIONS + `channel-availability.factor.ts` |
| **L13** | priceUnit 维度未对齐，per_kg vs per_serving 直接比对 | 食物库混合食材（per_kg）和成品（per_serving） | budget=low 时偏向 per_kg 食材（数值小），用户看到 "推我去买生米" | `price-fit.factor.ts` 未读 `priceUnit` |
| **L14** | DEFAULT_REGION_CODE 散落 17 文件 90 处，迁移成本指数级 | 团队决定改默认区域为 `'global'` 或加 `null` 显式状态 | 改一个常量，影响 90 处独立 fallback，回归测试覆盖不到全部 | grep `DEFAULT_REGION_CODE\|DEFAULT_TIMEZONE` 全仓 |
| **L15** | seasonality 缓存 LRU=32 在多语言市场抖动 | 活跃 region > 32（欧洲多国 + 东南亚） | 被踢出的 region 下次首请求慢（DB 全表扫），P99 抖动 | `seasonality.service.ts:105` |

---

## 10. 修复路线图（生产级建议）

### 10.1 P0（必须上线前修复）

1. **C1 / L1 / L14**：移除 DB schema 默认值，改为 nullable + 显式业务层 fallback；同时在 `pipeline-context-factory.service.ts` 入口处发 **结构化告警**（带 userId / 推断路径），让 90 处 fallback 退化为单点
2. **C3 / L2**：重排 factor `order` 为 10/15/20/25/30/35/40/45/50/55/60/65（互不冲突），并加 unit test 校验"无重复 order"
3. **C2 / L5**：学习器编排改造——用一份 feedback 流，分解出 `(user, region, global)` 三组**不相交**样本（按用户类型采样），消除多层相关污染
4. **C4 / L3**：`preference-signal` 链式乘积全部改加性 + 限幅 [0.5, 1.5]，最终 combined ∈ [0.4, 2.0]
5. **L11**：health 严重 condition 加最终 clamp（无视 preference，强制 ≤ 0.5）

### 10.2 P1（首月必修）

6. **C5 / L10**：`cuisineAffinityHit` 改用 `normalizeCuisine` 统一口径
7. **L6 / L13**：引入汇率服务 + priceUnit 维度对齐（per_serving 优先，per_kg 走估算函数）
8. **L7**：Thompson Sampling 加 request-level seed，trace 记录 sample 值
9. **L8**：召回硬过滤通过的食物，channel-availability 不再施加 ×0.3，仅用 time-slot 微调
10. **L9**：FactorLearner 取消内存 fallback，Redis 不可用时直接走 baseline weight（fail-safe）

### 10.3 P2（季度内整改）

11. **L12 / L15**：`SOUTHERN_HEMISPHERE_REGIONS` / `CHANNEL_TIME_MATRIX_BY_REGION` 进 DB 配置表
12. **§5.1**：`food_regional_info` 拆为 4 个职责清晰的子表（availability / season / price / regulatory）
13. **§5.2**：cuisine 字段加 enum 约束 + 历史数据迁移
14. **§6**：引入端到端 LTR 模型（XGBoost-pairwise 或 deep-ranker），让 12 因子退化为 feature

---

## 附录 A：与 V1 审计的差异

| 项 | V1 | V2 |
|---|---|---|
| 范围 | 主要是 P0-1~P0-4 修复点 | 系统级架构审计，覆盖学习闭环 + 数据模型 |
| 证据数 | ~40 个 file:line | ~120 个 file:line |
| 核心发现 | 季节缓存污染 / 价格透传 | 默认值反向耦合 / 多层学习相关污染 / preference 84× 跨度 |
| 上线风险数 | 5 | 15 |
| 维度 | 修复清单 | 修复清单 + 3 月演化预测 + 本质判断 |

V1 已修复内容（P0-1/2/3/4 + G8/G9/G10）已并入当前 codebase 基线。本审计 V2 不再重复 V1 已闭环项。

---

**审计执行日期**：2026-05-02
**审计人**：RecSys + 后端 + AI 产品 + 代码审计 联合审计组
**复核基线**：commit `8c2ad29`（P0/P1 修复工作区，含 C1-C5/L7-L11/G8-G10/Risk-2/Risk-3，尚未 commit）
**P0+P1 修复完成时间**：2026-05-02
**下一次复审建议时间**：P0+P1 修复 commit 合并后 2 周内；Risk-4/P5/5.3/Risk-6/Risk-7 建议首月内跟进

---

## 总结一句话

> 当前系统是一个**完成度 60% 的伪推荐系统**：12 因子框架优秀，但**默认值散落 90 处 + 学习器三方相关污染 + preference 链式过山车**三重隐患叠加。**直接上线 3 个月后将进入半失控状态**，必须在上线前完成 P0 五项整改。
