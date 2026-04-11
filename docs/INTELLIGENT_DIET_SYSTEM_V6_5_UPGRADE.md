# 智能饮食系统 V6.5 升级方案

> 基于 V6.4 架构的版本演进设计，非重新设计。
> 所有升级不影响已有接口，保留已有模块设计。
> 日期：2026-04-11

---

## 目录

- [[#Step 1：V6.4 能力评估]]
- [[#Step 2：核心升级方向]]
- [[#Step 3：架构升级设计]]
- [[#Step 4：模块级升级设计]]
- [[#Step 5：技术路线图]]
- [[#Step 6：数据迁移]]
- [[#Step 7：文档差异]]

---

## Step 1：V6.4 能力评估

### 1.1 已具备能力（V6.4 达成状态）

| 能力域      | V6.4 现状                                                                                         | 成熟度 |
| ----------- | ------------------------------------------------------------------------------------------------- | ------ |
| 用户画像    | 5 层统一聚合 + exerciseSchedule DTO 暴露 + 渠道推断（inferAcquisitionChannel 4 层）               | 高     |
| 推荐引擎    | 11 维评分 + 12 层 Boost + 策略驱动 + 菜谱模式 + 冷启动 + 渠道过滤 + Thompson Sampling             | 高     |
| 菜谱系统    | Recipe 实体 + AI 3 层模型路由 + 评分推荐 + UGC + 翻译(recipe_translations) + quality_score 自动化 | 中高   |
| 缓存机制    | L1 内存 + L2 Redis + 食物池分片 + 预计算 + TieredCacheManager + 健康修正 L2 缓存                  | 高     |
| 营养评分    | 12 维 AI 分析 + 个性化 NRF 9.3 + GI 三因素估算 + NOVA 单品化 + 时令评分（第 11 维）               | 高     |
| 策略系统    | 4 套预设策略 + 分群自动映射 + A/B 实验配置合并 + 8 维策略参数                                     | 中高   |
| 协同过滤    | 增量更新（Mon-Sat）+ 全量重建（Sunday），双模式融合，cosine 相似度                                | 中高   |
| 行为推断    | 合规率/时段/暴食风险/份量趋势/分群驱动策略切换/替换模式分析                                       | 中高   |
| 解释系统    | 单食物 + 整餐 + 反向 + 雷达图 + i18n（zh/en/ja）+ 风格系统（concise/coaching）                    | 高     |
| 决策系统    | 过敏原前置 + 多维评分 + AI 建议 + 5 层健康修正（含 L2 缓存）                                      | 高     |
| 食物分析    | 文本 + 图片双链路 + 12 维营养素 + 候选食物管道 + 数据飞轮（质量分级入库）                         | 高     |
| 订阅系统    | Free/Pro/Premium + Apple IAP + 微信支付 + 配额（批量重置）                                        | 高     |
| 性能        | 周计划并行 + CF 增量 + Redis 原子操作 + 事件驱动预计算 + Prisma 连接池配置化                      | 中高   |
| 可观测性    | Prometheus 指标（HTTP/缓存/队列/Cron）+ Winston 日志轮转 + 健康检查（DB+Redis）                   | 中高   |
| 安全        | JWT 启动校验 + CORS 白名单 + ValidationPipe + 请求体限制 + 优雅关机 + Redis SMS                   | 高     |
| 归因追踪    | RecommendationTrace 记录 + 反馈关联 + StrategyEffectivenessService 效果分析                       | 中     |
| 场景化推荐  | AcquisitionChannel 5 种渠道 + 渠道过滤 + 食物/菜谱 available_channels                             | 中     |
| 区域化+时令 | food_regional_info + SeasonalityService + 品类旺季月份 + Redis 缓存                               | 中     |

### 1.2 核心问题诊断

以下问题基于对 V6.4 代码的深度审计发现，按严重程度排序：

#### P0：架构健壮性（影响可靠性）

| 问题                         | 具体表现                                                                             | 影响                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Gateway 限流/配额基于内存    | `rate-limit.guard.ts` 和 `quota.guard.ts` 使用进程内 `Map`                           | 多实例部署时限流失效，每个 Pod 独立计数                           |
| 无外部服务熔断               | AI Provider（OpenRouter）、SMS、FCM、Apple IAP、微信支付等外部调用无 circuit breaker | 下游故障级联到整个系统，所有请求排队等待超时                      |
| ScheduleModule 注册位置错误  | `ScheduleModule.forRoot()` 在 `FoodPipelineModule` 中注册，而非 `AppModule`          | 其他模块的 `@Cron` 依赖 FoodPipelineModule 加载顺序，静默失效风险 |
| EventEmitter2 无错误处理     | domain events listener 抛异常时直接传播到 emitter，无全局 `onError` handler          | 一个 listener 异常导致后续 listener 不执行                        |
| BullMQ 无降级处理            | Redis 不可用时 `queue.add()` 直接抛出，无 fallback                                   | Redis 故障 → 所有异步任务提交失败                                 |
| 无 Dead Letter Queue         | BullMQ 重试耗尽后 job 直接丢弃，无 DLQ 存储                                          | 失败任务无法审计和重放                                            |
| CANDIDATE_CREATED 事件无监听 | `domain-events.ts` 定义并 emit，但零 listener                                        | 死代码，食物候选创建后无后续处理                                  |

#### P1：推荐精度与现实贴近性

| 问题                 | 具体表现                                                                                                                   | 影响                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| 画像数据采而不用     | `tasteIntensity`、`cuisinePreferences`、`budgetLevel`、`cookingSkillLevel`、`familySize`、`mealPrepWilling` 已采集未入评分 | 用户画像采集增加摩擦但不影响推荐精度 |
| 替换模式未回流推荐   | `BehaviorService` 检测 A→B 替换模式（频次≥2），但未反馈到推荐评分                                                          | 系统重复推荐用户已反复替换的食物     |
| CF 冷启动空白        | 交互 <5 次的用户 CF 得分为空，无 content-based fallback                                                                    | 新用户推荐多样性不足（仅靠热门兜底） |
| 食物"大众性"控制不足 | `popularity` 字段存在但权重模糊，无"家常菜优先"策略                                                                        | 可能推荐鸵鸟肉、龙虾等低可获取性食物 |
| 菜谱推荐脱离日常     | 菜谱评分 50% nutritionMatch + 30% preferenceMatch + 20% difficultyMatch，无"烹饪时间"维度                                  | 工作日推荐 2 小时慢炖菜              |
| 推荐解释有效性未追踪 | 解释风格 concise/coaching 随机分配（FNV-1a hash），未衡量哪种风格提升接受率                                                | 解释优化无数据支撑                   |
| 餐食组合营养互补性弱 | 整餐解释仅一句话（蛋白质 leader + 纤维 leader），无组合层面的营养互补评分                                                  | 单品评分高但组合可能营养重叠         |
| 食物可获取性未量化   | `available_channels` 是静态标签，无基于地区/时间的动态可获取性评分                                                         | 凌晨推荐"外卖可点"但外卖平台已关     |

#### P2：数据模型与工程

| 问题                       | 具体表现                                                                                                              | 影响                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Prisma Schema 冗余字段     | `foods` 表同时有 `fiber` 和 `fiber_per_100g`（`sugar`/`sodium` 同理），来源不明                                       | 数据一致性风险                      |
| daily_plans 纯 JSON 存储   | `morning_plan`/`lunch_plan`/`dinner_plan`/`snack_plan` 全是 `Json?`，无关联到 foods/recipes                           | 无法 SQL 级聚合分析推荐历史         |
| food_records.foods JSON    | 膳食记录的食物列表存为 JSON blob，非规范化                                                                            | 无法 DB 级 JOIN 做食物频率分析      |
| 多表 FK 缺失               | `daily_plans.user_id`、`recommendation_feedbacks.user_id`（VARCHAR 非 UUID）、`strategy_assignment.strategy_id` 无 FK | 数据完整性无约束                    |
| 时间戳类型不一致           | 部分表 `Timestamp(6)`（无时区），部分 `Timestamptz(6)`（有时区）                                                      | 跨时区用户的时间计算可能出错        |
| `foods` 表 4 对重复索引    | `category`、`status`、`primary_source`、`barcode` 各有两个同列索引                                                    | 写入性能浪费，磁盘占用翻倍          |
| ab_experiments.groups JSON | 实验分组存为 JSON array，非规范化                                                                                     | 无法 SQL 查询"某用户属于哪个实验组" |
| 无菜谱用户评分表           | 用户对菜谱的反馈只存在于 `recommendation_feedbacks`，无独立 `recipe_ratings` 表                                       | 菜谱推荐无法积累独立的用户偏好信号  |
| Diet → Food 循环依赖       | `DietModule` 通过 `forwardRef()` 导入 `FoodModule`                                                                    | 初始化顺序脆弱，测试困难            |
| 共享 TieredCache namespace | `analysis_short_term` 被 Diet 和 Analysis 两个模块共用，无共享契约                                                    | 一方修改缓存结构会静默破坏另一方    |

#### P3：扩展性与未来需求

| 问题                        | 具体表现                                                  | 影响                             |
| --------------------------- | --------------------------------------------------------- | -------------------------------- |
| 策略无自动调优              | 策略分配后静态不变，无 performance tracking / auto-tuning | 策略优化依赖人工判断             |
| 无向量语义召回              | `vector-search.service.ts` 文件存在但未接入推荐管道       | 仅靠规则召回，无法捕捉语义相似性 |
| 无 Learned Ranking          | 评分权重硬编码（`SCORE_WEIGHTS`），非从数据学习           | 权重依赖人工调参，无法个性化     |
| CF brute-force cosine       | 相似度计算为暴力 cosine，无 ANN 优化                      | 用户/食物规模增长后 CF 重建变慢  |
| 无 OpenTelemetry 分布式追踪 | CLS 提供 requestId，但跨 queue/event 的链路断裂           | 异步任务失败时无法追溯到原始请求 |
| 解释系统无自适应深度        | 解释详细度仅二元（free/premium），非按用户互动意愿自适应  | 低互动用户被过多信息淹没         |
| 暴食干预无效果评估          | 检测暴食风险后发提醒，但未追踪干预后行为是否改善          | 无法评估干预策略有效性           |
| 无用户流失预测              | 分群系统有 7 类用户群，但无 churn 预测模型                | 无法主动挽留即将流失的用户       |

---

## Step 2：核心升级方向

基于以上诊断，确定 **8 个核心升级点**：

### 升级点 1：推荐现实贴近性 — 从"营养最优"到"用户真正会吃"

**为什么需要：** V6.4 评分体系以营养为核心（11 维评分中 8 维是营养相关），但用户不吃推荐的首要原因不是"不健康"，而是"不现实"——太贵、太难买、太费时间、不是常见食物。推荐系统的核心指标不是营养精度，而是**可执行率（Execution Rate）**。

**解决什么问题：**

- 推荐鸵鸟肉/藜麦/奇亚籽等"营养完美但用户不会买"的食物
- 工作日推荐 2 小时慢炖菜（烹饪时间不考虑场景）
- 凌晨推荐外卖但外卖平台已关（时间可获取性不考虑）
- 推荐结果营养分数高但用户反复跳过
- 画像数据 `budgetLevel`/`cookingSkillLevel`/`familySize` 采集了但未影响推荐

**具体目标：**

1. 引入 **第 12 维评分 `executability`**（可执行性评分），综合食物可获取性、价格合理性、常见程度
2. 新增 **RealisticFilterService**，在召回阶段按"现实过滤器"（购买难度、烹饪难度、时间成本）过滤
3. 新增 **`commonality_score`** 字段（食物大众化程度），在评分中加权
4. 将已采集但未使用的画像字段（`budgetLevel`、`cookingSkillLevel`、`familySize`、`cuisinePreferences`、`tasteIntensity`）接入评分管道
5. 菜谱推荐新增"烹饪时间"维度，工作日优先快手菜（≤30 分钟）

---

### 升级点 2：画像数据激活 + 替换模式闭环 — 从"采集画像"到"画像驱动推荐"

**为什么需要：** V6.4 采集了 20+ 画像字段，但评分管道只使用了其中约 12 个。`tasteIntensity`、`cuisinePreferences`、`budgetLevel`、`cookingSkillLevel`、`familySize`、`mealPrepWilling` 被采集后存入数据库，却不影响推荐结果。同时 BehaviorService 已检测的 A→B 替换模式也未回流推荐。

**解决什么问题：**

- 用户填了预算偏好但推荐不受影响，觉得"填了也没用"
- 用户标记烹饪技能为初学者，但仍推荐复杂菜谱
- 用户反复把鸡胸肉替换为三文鱼，但系统继续推荐鸡胸肉
- 用户偏好辣味但推荐清淡食物（tasteIntensity 未使用）
- 家庭 4 人但推荐 1 人份菜谱（familySize 未使用）

**具体目标：**

1. **画像→评分映射**：将 6 个未使用字段逐一接入评分管道
2. **替换模式加权**：A→B 替换频率 ≥2 → A 降权 15%、B 增权 10%
3. **口味偏好评分**：`tasteIntensity` + `cuisinePreferences` 融入食物口味匹配评分
4. **家庭适配**：`familySize` 影响菜谱份量推荐和食材用量
5. **预算评分**：`budgetLevel` 不仅限于 Boost（当前仅 -15%），而是映射到 `estimated_cost_level` 的连续评分

---

### 升级点 3：餐食组合优化 — 从"单品推荐"到"整餐最优"

**为什么需要：** V6.4 推荐管道按角色（carb/protein/veggie/side/snack）逐一评分选择，每个角色独立最优。但整餐层面可能出现：蛋白质角色选鸡蛋+蛋白质配菜也含大量鸡蛋，或所有菜都是炒菜没有汤。整餐解释也仅一句话，缺乏组合级营养互补分析。

**解决什么问题：**

- 整餐食材重复（两道菜都用鸡蛋）
- 整餐烹饪方式单一（全是炒菜）
- 整餐口味单一（全是咸味）
- 宏量营养素单品达标但整餐不均衡
- 整餐解释太薄（仅一句话 vs 单品多维）

**具体目标：**

1. **MealCompositionScorer**：整餐组合后进行组合级评分（食材去重、烹饪方式多样性、口味互补、营养互补）
2. **整餐级 rerank**：在单品 rank 之后增加组合 rerank 阶段，惩罚食材/烹饪方式/口味重复
3. **营养互补加分**：一道菜缺铁 + 另一道菜含维C → 吸收增强互补加分
4. **整餐解释增强**：从一句话升级为组合级营养分析 + 互补关系 + 多样性评分

---

### 升级点 4：策略自动调优 — 从"人工分配策略"到"数据驱动策略进化"

**为什么需要：** V6.4 已有 `StrategyEffectivenessService` 和 `RecommendationTrace`，但策略→分群映射是硬编码的（`new_user→warm_start`、`binge_risk→precision` 等）。系统能看到效果数据，但不能自动根据数据调整策略。

**解决什么问题：**

- 策略 A 对某分群效果差（接受率 <30%）但无法自动切换
- A/B 实验结果需人工分析和手动配置生效
- 策略参数（如 exploration rate、recall pool size）无法根据用户成熟度自动调整
- Thompson Sampling 的 alpha/beta 参数无可视化，无法判断探索是否已收敛

**具体目标：**

1. **StrategyAutoTuner**：定时（每周）分析效果矩阵，自动调整 segment→strategy 映射
2. **自适应 exploration rate**：根据用户交互量和 Thompson Sampling 收敛程度，逐步降低探索率
3. **策略参数渐进优化**：recall_pool_size、diversity_level 等参数根据历史效果数据微调
4. **Admin 收敛仪表盘**：Thompson Sampling alpha/beta 分布可视化 + 策略切换历史

---

### 升级点 5：基础设施健壮性 — 从"能跑"到"不怕挂"

**为什么需要：** V6.4 的基础设施在单实例部署下工作正常，但存在多个多实例/故障场景下的隐患：Gateway 限流基于内存、外部服务无熔断、BullMQ 无降级、事件系统无错误处理。这些在用户量增长和生产部署后会逐一暴露。

**解决什么问题：**

- 多实例部署时限流形同虚设（每个 Pod 独立计数）
- AI Provider 故障时所有推荐请求卡住（无 circuit breaker）
- Redis 闪断导致所有异步任务提交失败（BullMQ 无 fallback）
- 一个 event listener 异常导致后续 listener 链断裂
- 永久失败的 BullMQ job 无法审计和重放（无 DLQ）

**具体目标：**

1. **Gateway 限流迁移到 Redis**（`rate-limit.guard.ts` + `quota.guard.ts`）
2. **外部服务 Circuit Breaker**：AI Provider、SMS、FCM、IAP、微信支付
3. **BullMQ 降级处理**：Redis 不可用时 fallback 到同步处理 + 告警
4. **EventEmitter2 全局错误处理**：listener 异常不阻塞其他 listener
5. **Dead Letter Queue**：BullMQ 重试耗尽后转存 DLQ，支持审计和重放
6. **ScheduleModule.forRoot() 移到 AppModule**

---

### 升级点 6：数据模型治理 — 从"能用"到"规范化"

**为什么需要：** Prisma Schema 存在系统性问题：冗余字段（fiber vs fiber_per_100g）、关键 FK 缺失（6 张表）、时间戳类型不一致（Timestamp vs Timestamptz）、4 对重复索引、关键表使用纯 JSON 存储（daily_plans、food_records）。这些会在数据量增长后导致查询变慢、数据不一致。

**解决什么问题：**

- 冗余字段导致数据一致性问题（fiber vs fiber_per_100g 谁是真值？）
- FK 缺失导致孤儿数据（删了 user 但 daily_plans 残留）
- 时间戳类型混用导致跨时区计算错误
- 重复索引浪费磁盘空间和写入性能
- daily_plans 纯 JSON 无法做推荐历史的 SQL 分析

**具体目标：**

1. **清理冗余字段**：统一 `fiber`/`sugar`/`sodium` 含义，废弃 `_per_100g` 变体
2. **补齐 FK 约束**：6 张表的 user_id/strategy_id 补上外键
3. **统一时间戳类型**：全部迁移到 `Timestamptz(6)`
4. **清除重复索引**：删除 4 对中的重复项
5. **daily_plan_foods 规范化**：新增 `daily_plan_items` 关联表，保留 JSON 做兼容

---

### 升级点 7：向量语义召回 — 从"规则召回"到"语义召回"

**为什么需要：** V6.4 的召回（recall）完全基于规则：品类过滤 + 过敏原排除 + 渠道过滤 + 季节过滤。这导致系统无法发现"用户喜欢三文鱼 → 也可能喜欢金枪鱼"这类语义相似性。`vector-search.service.ts` 和 `embedding` 字段已存在但未接入推荐管道。

**解决什么问题：**

- 用户喜欢某类食物，但系统只推荐完全相同品类的食物
- 新食物入库后无法基于"相似性"被推荐（只能靠热门）
- CF 交互稀疏时无 content-based 语义相似性兜底
- `embedding` 字段已在 foods 表上，计算成本已付，但未利用

**具体目标：**

1. **接入向量召回**：在 recall 阶段新增 `semanticRecall` 通道，基于用户历史正向反馈食物的 embedding 做 ANN 搜索
2. **Embedding 生成管道**：新增/更新食物时自动生成 embedding（BullMQ 异步）
3. **混合召回权重**：strategy 配置 `recall.semantic` 权重，控制语义召回占比
4. **CF 冷启动 fallback**：交互 <5 次的用户，用 content-based 语义相似性替代空白 CF

---

### 升级点 8：可执行性配置化 — 从"全局规则"到"可配置现实策略"

**为什么需要：** 不同用户和场景对"现实性"的要求不同。健身爱好者可以接受鸡胸肉+西兰花的单调推荐；美食爱好者希望多样化；预算紧张的学生需要便宜的选择；忙碌的上班族需要快速烹饪。V6.4 的策略系统已有 8 维参数，但没有"现实性"维度。

**解决什么问题：**

- 所有用户收到同样的"现实性"约束
- 策略系统有 8 维参数但无法控制推荐的"大众化程度""价格敏感度""烹饪时间上限"
- Admin 无法为不同用户群配置不同的现实策略
- 用户无法自己选择"我要快手菜"还是"我想尝试新食物"

**具体目标：**

1. **策略扩展**：第 9 维策略参数 `realism`（包含 commonality_weight、budget_sensitivity、cook_time_cap、availability_strictness）
2. **用户偏好覆盖**：用户可设置"推荐偏好"（大众化/探索型、快手/精致、便宜/不限）
3. **场景动态调整**：工作日午餐自动提升 cook_time_cap 权重 + commonality_weight
4. **Admin 配置面板**：按分群/策略配置 realism 参数

---

## Step 3：架构升级设计

### V6.5 架构变更图

```
V6.4 架构：
┌──────────────────────────────────────────────────────────────────┐
│                          推荐引擎                                 │
│  ProfileResolver → StrategySelector → Recall → Rank → Assemble   │
│       ↑                    ↑           ↑       ↑        ↑        │
│  5层画像统一           4套策略    按Channel  11维评分   菜谱模式   │
│                        ↑         过滤     (+时令)                 │
│                   效果归因                                        │
│                                                                  │
│  NutritionTargetService  │  ExplanationGenerator                  │
│  SeasonalityService      │  RecommendationTrace                   │
│  HealthModifierCache     │  StrategyEffectivenessService          │
└──────────────────────────────────────────────────────────────────┘

V6.5 架构（新增/变更用 ★ 标记）：
┌──────────────────────────────────────────────────────────────────┐
│                          推荐引擎                                 │
│  ProfileResolver → StrategySelector → Recall → Rank → ★MealRank │
│       ↑                    ↑           ↑       ↑     → Assemble  │
│  ★ 全画像激活          ★ 自动调优  ★ 语义召回 ★ 12维  ★ 组合优化 │
│  ★ 替换模式回流        ★ realism    ANN混合   (+exec) ★ 整餐rerank│
│                          参数                  ★ 画像   ★ 互补评分│
│                                                 加权              │
│                                                                  │
│  NutritionTargetService  │  ★ MealCompositionScorer               │
│  SeasonalityService      │  ★ RealisticFilterService              │
│  HealthModifierCache     │  ★ StrategyAutoTuner                   │
│                          │  ★ SemanticRecallService               │
│                          │  ★ ReplacementPatternService           │
└──────────────────────────────────────────────────────────────────┘

★ 新增基础设施层：
┌──────────────────────────────────────────────────────────────────┐
│                    基础设施健壮性增强                               │
│  ┌────────────────┐  ┌─────────────┐  ┌──────────────────────┐  │
│  │★CircuitBreaker │  │★Redis限流    │  │★BullMQ降级+DLQ      │  │
│  │ (opossum)      │  │ (rate-limit  │  │ (fallback+deadletter │  │
│  │ AI/SMS/FCM/IAP │  │  + quota)    │  │  + audit)            │  │
│  └────────────────┘  └─────────────┘  └──────────────────────┘  │
│  ┌────────────────┐  ┌─────────────┐  ┌──────────────────────┐  │
│  │★EventError     │  │★Schedule    │  │★Schema治理           │  │
│  │ Handler        │  │ Module移正  │  │ FK/索引/时间戳/冗余  │  │
│  └────────────────┘  └─────────────┘  └──────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### 新增模块/服务清单

| 模块/服务                    | 类型                                | 职责                                                         |
| ---------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| `RealisticFilterService`     | Service（注入 DietModule）          | 召回阶段现实性过滤（购买难度、烹饪难度、时间成本、大众程度） |
| `MealCompositionScorer`      | Service（注入 DietModule）          | 整餐组合评分（食材去重、烹饪方式多样性、口味互补、营养互补） |
| `ReplacementPatternService`  | Service（注入 DietModule）          | 替换模式挖掘 + 权重调整（A→B 频率 → A 降权 B 增权）          |
| `SemanticRecallService`      | Service（注入 DietModule）          | 基于 embedding 的 ANN 向量语义召回                           |
| `StrategyAutoTuner`          | Service（注入 StrategyModule）      | 定时分析效果矩阵，自动调整 segment→strategy 映射             |
| `CircuitBreakerService`      | Service（注入 CoreModule, @Global） | 外部服务熔断管理（AI Provider、SMS、FCM、IAP、微信支付）     |
| `DeadLetterService`          | Service（注入 CoreModule）          | BullMQ DLQ 存储、审计、重放                                  |
| `EmbeddingGenerationService` | Service（注入 FoodModule）          | 食物 embedding 自动生成/更新管道                             |

### 修改的已有模块

| 模块                               | 变更点                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `recommendation-engine.service.ts` | 新增语义召回通道 + MealRank 组合 rerank + 第 12 维 executability + 画像加权注入 |
| `food-scorer.service.ts`           | 新增第 12 维 executability + 画像字段权重映射                                   |
| `recommendation.types.ts`          | SCORE_DIMENSIONS 12 维 + SCORE_WEIGHTS 更新 + realism 策略参数                  |
| `food-pool-cache.service.ts`       | 新增 commonality 过滤 + 时间可获取性过滤                                        |
| `explanation-generator.service.ts` | 整餐解释增强（组合营养分析 + 互补关系 + 多样性评分）                            |
| `strategy.types.ts`                | 新增第 9 维策略参数 `realism`                                                   |
| `strategy.service.ts`              | realism 参数的 CRUD + 预设策略更新                                              |
| `behavior-analysis.service.ts`     | 替换模式输出给 ReplacementPatternService                                        |
| `profile-resolver.service.ts`      | 输出增加未使用画像字段的结构化数据                                              |
| `food.types.ts`                    | FoodLibrary 新增 `commonality_score`                                            |
| `prisma/schema.prisma`             | FK 补齐 + 索引清理 + 冗余字段废弃 + daily_plan_items + recipe_ratings           |
| `rate-limit.guard.ts`              | 迁移到 Redis 存储                                                               |
| `quota.guard.ts`                   | 迁移到 Redis 存储                                                               |
| `app.module.ts`                    | ScheduleModule.forRoot() 迁入 + CircuitBreakerModule                            |
| `core.module.ts`                   | EventEmitter2 全局错误处理 + DeadLetterService                                  |
| `queue.constants.ts`               | DLQ 配置项                                                                      |
| `recipe.service.ts`                | 菜谱推荐新增 cooking_time 维度                                                  |

---

## Step 4：模块级升级设计

### 4.1 Profile 模块（用户画像）

**目标：全画像激活 + 替换模式闭环**

#### 4.1.1 未使用画像字段激活

当前状态：`ProfileResolverService` 聚合 5 层画像后输出 `EnrichedProfileContext`。以下 6 个字段已采集存在于 `user_profiles` 表，但未参与推荐评分。

```typescript
// profile-resolver.service.ts — resolveFullProfile 输出扩展
// V6.5：新增 lifestyle 子对象，暴露未使用字段的结构化数据
interface EnrichedProfileContext {
  // ... 已有 5 层
  lifestyle: {
    tasteIntensity: 'mild' | 'medium' | 'strong'; // 口味偏好强度
    cuisinePreferences: string[]; // 偏好菜系
    budgetLevel: 'low' | 'medium' | 'high'; // 预算水平
    cookingSkillLevel: number; // 烹饪技能 1-5
    familySize: number; // 家庭人数
    mealPrepWilling: boolean; // 是否愿意备餐
  };
}
```

**改动文件：** `modules/diet/app/recommendation/profile-resolver.service.ts`

#### 4.1.2 画像→评分映射规则

```typescript
// 新增：profile-scoring-mapper.ts
// 将 lifestyle 字段映射为评分调整因子

export function mapLifestyleToScoringFactors(lifestyle: LifestyleProfile): ScoringFactors {
  return {
    // 口味偏好：强口味用户偏好重口味食物
    tasteMatch: (food: FoodLibrary) => {
      if (!food.flavorProfile || !lifestyle.tasteIntensity) return 1.0;
      const intensity = calcFlavorIntensity(food.flavorProfile);
      const userPref = { mild: 0.3, medium: 0.6, strong: 0.9 }[lifestyle.tasteIntensity];
      const diff = Math.abs(intensity - userPref);
      return 1.0 - diff * 0.2; // 0.8 ~ 1.0
    },

    // 菜系偏好：匹配菜系 +8%
    cuisineMatch: (food: FoodLibrary) => {
      if (!lifestyle.cuisinePreferences?.length) return 1.0;
      return lifestyle.cuisinePreferences.includes(food.cuisine ?? '') ? 1.08 : 1.0;
    },

    // 预算匹配：cost_level vs budgetLevel
    budgetMatch: (food: FoodLibrary) => {
      const costLevel = food.estimatedCostLevel ?? 2; // 1-5
      const budgetMap = { low: 2, medium: 3, high: 5 };
      const maxAcceptable = budgetMap[lifestyle.budgetLevel] ?? 3;
      if (costLevel <= maxAcceptable) return 1.0;
      return 1.0 - (costLevel - maxAcceptable) * 0.1; // 超预算每级 -10%
    },

    // 烹饪技能：过滤难度超出技能的菜谱
    skillFilter: (recipe: ScoredRecipe) => {
      if (!lifestyle.cookingSkillLevel) return true;
      return recipe.difficulty <= lifestyle.cookingSkillLevel + 1; // 允许挑战高一级
    },

    // 家庭适配：份量调整建议
    portionMultiplier: lifestyle.familySize > 1 ? lifestyle.familySize : 1,
  };
}
```

#### 4.1.3 替换模式回流

```typescript
// 新增：replacement-pattern.service.ts
@Injectable()
export class ReplacementPatternService {
  /**
   * 从行为分析中提取替换模式，转换为评分权重调整
   *
   * 规则：
   * - A→B 替换频率 ≥ 2 次（30天内）
   * - A 降权 15%（用户不喜欢A）
   * - B 增权 10%（用户更喜欢B）
   * - 超过 5 次替换：A 降权 30%（强信号）
   */
  async getReplacementAdjustments(userId: string): Promise<Map<string, number>> {
    const patterns = await this.behaviorService.getReplacementPatterns(userId);
    const adjustments = new Map<string, number>();

    for (const pattern of patterns) {
      if (pattern.frequency >= 5) {
        adjustments.set(pattern.fromFoodId, (adjustments.get(pattern.fromFoodId) ?? 1.0) * 0.7);
      } else if (pattern.frequency >= 2) {
        adjustments.set(pattern.fromFoodId, (adjustments.get(pattern.fromFoodId) ?? 1.0) * 0.85);
      }
      adjustments.set(pattern.toFoodId, (adjustments.get(pattern.toFoodId) ?? 1.0) * 1.1);
    }

    return adjustments;
  }
}
```

#### 4.1.4 画像完整度驱动引导

```typescript
// profile-resolver.service.ts — 增强完整度反馈
// 当前：计算 completionScore（20 字段加权百分比）
// V6.5：区分"影响推荐精度的字段"和"锦上添花的字段"
interface ProfileCompletionDetail {
  overallScore: number; // 0-100
  impactFields: {
    // 影响推荐精度的缺失字段
    field: string;
    impact: 'high' | 'medium'; // 对推荐精度的影响程度
    prompt: string; // 引导文案
  }[];
  nextBestAction: string; // 最应该补充的字段
}
```

---

### 4.2 Recommendation 模块

**目标：可执行性评分 + 整餐组合优化 + 向量语义召回 + 策略自动调优**

#### 4.2.1 第 12 维评分 — executability（可执行性）

```typescript
// recommendation.types.ts — SCORE_DIMENSIONS 扩展为 12 维
export const SCORE_DIMENSIONS = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'quality',
  'satiety',
  'glycemic',
  'nutrientDensity',
  'inflammation',
  'fiber',
  'seasonality',
  'executability', // ★ V6.5
] as const;

// SCORE_WEIGHTS 所有 goalType 更新为 12 元素
export const SCORE_WEIGHTS: Record<string, number[]> = {
  fat_loss: [0.16, 0.15, 0.07, 0.05, 0.05, 0.06, 0.11, 0.09, 0.06, 0.04, 0.03, 0.13],
  muscle_gain: [0.15, 0.2, 0.1, 0.05, 0.05, 0.04, 0.09, 0.08, 0.04, 0.03, 0.03, 0.14],
  health: [0.06, 0.05, 0.04, 0.04, 0.14, 0.06, 0.1, 0.16, 0.1, 0.07, 0.05, 0.13],
  habit: [0.1, 0.08, 0.05, 0.05, 0.13, 0.11, 0.08, 0.08, 0.07, 0.04, 0.04, 0.17],
};
// habit 目标下 executability 权重最高（0.17），因为习惯养成最依赖可执行性
```

#### 4.2.2 FoodScorer — executability 计算

```typescript
// food-scorer.service.ts — 新增第 12 维
calcExecutabilityScore(
  food: FoodLibrary,
  channel: AcquisitionChannel,
  lifestyle: LifestyleProfile,
  hour: number,
): number {
  let score = 50; // 基准分

  // 1. 大众化程度 (0-30分)
  const commonality = food.commonalityScore ?? 50;
  score += (commonality / 100) * 30;

  // 2. 预算匹配 (0-20分)
  const costLevel = food.estimatedCostLevel ?? 2;
  const budgetMap = { low: 2, medium: 3, high: 5 };
  const maxBudget = budgetMap[lifestyle.budgetLevel] ?? 3;
  if (costLevel <= maxBudget) {
    score += 20;
  } else {
    score += Math.max(0, 20 - (costLevel - maxBudget) * 10);
  }

  // 3. 渠道时间可获取性 (0-20分)
  if (channel === AcquisitionChannel.DELIVERY) {
    // 外卖：06:00-23:00 可获取
    score += (hour >= 6 && hour <= 23) ? 20 : 5;
  } else if (channel === AcquisitionChannel.CONVENIENCE) {
    // 便利店：24h 可获取
    score += 20;
  } else if (channel === AcquisitionChannel.HOME_COOK) {
    // 自炊：需要烹饪，看技能匹配
    const skillGap = (food.skillRequired ?? 1) - (lifestyle.cookingSkillLevel ?? 3);
    score += skillGap <= 1 ? 20 : Math.max(0, 20 - skillGap * 8);
  } else {
    score += 15; // restaurant/canteen 默认
  }

  // 4. 烹饪时间适配 (0-15分)
  // 工作日中午：≤30min 满分，>60min 0分
  const isWorkdayLunch = this.isWorkdayLunch(hour);
  if (isWorkdayLunch && food.cookTimeMinutes) {
    score += food.cookTimeMinutes <= 30 ? 15 : Math.max(0, 15 - (food.cookTimeMinutes - 30) / 2);
  } else {
    score += 10; // 非工作日/非午餐默认
  }

  // 5. 烹饪意愿调整 (-15 ~ 0分)
  if (!lifestyle.mealPrepWilling && channel === AcquisitionChannel.HOME_COOK) {
    score -= 15; // 不愿意备餐但推荐自炊
  }

  return Math.max(0, Math.min(100, score));
}
```

#### 4.2.3 RealisticFilterService — 召回阶段过滤

```typescript
// 新增：realistic-filter.service.ts
@Injectable()
export class RealisticFilterService {
  /**
   * 在 recallCandidates 之后、rankCandidates 之前应用现实性过滤
   *
   * 过滤规则（可通过 strategy.realism 配置开关）：
   * 1. commonality_score < threshold → 过滤（默认 threshold=20）
   * 2. estimated_cost_level > budget + 2 → 过滤
   * 3. 工作日午餐 + cook_time > 45min → 过滤（自炊渠道）
   * 4. 渠道不匹配 → 过滤（已有逻辑，此处加强时间维度）
   */
  filterByRealism(
    candidates: FoodLibrary[],
    context: PipelineContext,
    realism: RealismConfig
  ): FoodLibrary[] {
    if (!realism.enabled) return candidates; // 配置化开关

    let filtered = candidates;

    // 1. 大众化过滤
    if (realism.commonalityThreshold > 0) {
      filtered = filtered.filter((f) => (f.commonalityScore ?? 50) >= realism.commonalityThreshold);
    }

    // 2. 预算过滤
    if (realism.budgetFilterEnabled && context.lifestyle?.budgetLevel) {
      const maxCost = { low: 3, medium: 4, high: 5 }[context.lifestyle.budgetLevel] ?? 5;
      filtered = filtered.filter((f) => (f.estimatedCostLevel ?? 2) <= maxCost);
    }

    // 3. 烹饪时间过滤（仅自炊渠道+工作日）
    if (realism.cookTimeCapEnabled && context.channel === AcquisitionChannel.HOME_COOK) {
      const isWorkday = context.contextual?.dayType === 'weekday';
      const cap = isWorkday
        ? (realism.weekdayCookTimeCap ?? 45)
        : (realism.weekendCookTimeCap ?? 120);
      filtered = filtered.filter((f) => !f.cookTimeMinutes || f.cookTimeMinutes <= cap);
    }

    // 兜底：至少保留 5 个候选
    if (filtered.length < 5) {
      return candidates.slice(0, Math.max(candidates.length, 5));
    }

    return filtered;
  }
}
```

#### 4.2.4 RealismConfig — 策略第 9 维参数

```typescript
// strategy.types.ts — 新增第 9 维
export interface RealismConfig {
  /** 是否启用现实性过滤 */
  enabled: boolean;
  /** 大众化最低阈值（0-100，默认 20） */
  commonalityThreshold: number;
  /** 是否启用预算过滤 */
  budgetFilterEnabled: boolean;
  /** 是否启用烹饪时间过滤 */
  cookTimeCapEnabled: boolean;
  /** 工作日烹饪时间上限（分钟） */
  weekdayCookTimeCap: number;
  /** 周末烹饪时间上限（分钟） */
  weekendCookTimeCap: number;
  /** 可执行性评分权重倍数（1.0=默认，2.0=双倍权重） */
  executabilityWeightMultiplier: number;
}

// StrategyConfig 扩展
export interface StrategyConfig {
  rank: RankPolicyConfig;
  recall: RecallPolicyConfig;
  boost: BoostPolicyConfig;
  meal: MealPolicyConfig;
  multiObjective: MultiObjectiveConfig;
  exploration: ExplorationConfig;
  assembly: AssemblyConfig;
  explain: ExplainConfig;
  realism: RealismConfig; // ★ V6.5 第 9 维
}
```

#### 4.2.5 预设策略 realism 默认值

```typescript
// strategy.service.ts — 4 套预设策略的 realism 参数
const PRESET_REALISM: Record<string, RealismConfig> = {
  warm_start: {
    enabled: true,
    commonalityThreshold: 40, // 新用户推荐更大众的食物
    budgetFilterEnabled: true,
    cookTimeCapEnabled: true,
    weekdayCookTimeCap: 30, // 快手菜优先
    weekendCookTimeCap: 90,
    executabilityWeightMultiplier: 1.5, // 新用户可执行性权重提升
  },
  re_engage: {
    enabled: true,
    commonalityThreshold: 30,
    budgetFilterEnabled: true,
    cookTimeCapEnabled: true,
    weekdayCookTimeCap: 40,
    weekendCookTimeCap: 120,
    executabilityWeightMultiplier: 1.3,
  },
  precision: {
    enabled: true,
    commonalityThreshold: 15, // 精确模式允许小众食物
    budgetFilterEnabled: false, // 不限预算（目标优先）
    cookTimeCapEnabled: false,
    weekdayCookTimeCap: 60,
    weekendCookTimeCap: 180,
    executabilityWeightMultiplier: 0.8, // 营养精度优先
  },
  discovery: {
    enabled: true,
    commonalityThreshold: 10, // 探索模式允许冷门食物
    budgetFilterEnabled: false,
    cookTimeCapEnabled: false,
    weekdayCookTimeCap: 90,
    weekendCookTimeCap: 180,
    executabilityWeightMultiplier: 0.7, // 探索优先
  },
};
```

#### 4.2.6 MealCompositionScorer — 整餐组合评分

```typescript
// 新增：meal-composition-scorer.service.ts
@Injectable()
export class MealCompositionScorer {
  /**
   * 对已选定的整餐组合进行组合级评分
   * 在单品 rank 之后、最终输出之前执行
   */
  scoreMealComposition(
    selectedFoods: ScoredFood[],
    targets: NutritionTarget
  ): MealCompositionScore {
    return {
      // 1. 食材重复度（0-100，100=完全不重复）
      ingredientDiversity: this.calcIngredientDiversity(selectedFoods),

      // 2. 烹饪方式多样性（0-100，100=每道菜不同烹饪方式）
      cookingMethodDiversity: this.calcCookingMethodDiversity(selectedFoods),

      // 3. 口味互补性（0-100，100=咸甜酸辣均衡）
      flavorBalance: this.calcFlavorBalance(selectedFoods),

      // 4. 营养互补性（0-100，100=维生素+矿物质互补完美）
      nutritionComplementarity: this.calcNutritionComplementarity(selectedFoods, targets),

      // 5. 整体评分
      overall: 0, // 加权计算
    };
  }

  /**
   * 食材重复检测
   * 提取每道菜的主要食材，检测重叠
   */
  private calcIngredientDiversity(foods: ScoredFood[]): number {
    const allIngredients = foods.map((f) => f.food.mainIngredient?.toLowerCase()).filter(Boolean);
    const uniqueCount = new Set(allIngredients).size;
    return allIngredients.length > 0
      ? Math.round((uniqueCount / allIngredients.length) * 100)
      : 100;
  }

  /**
   * 烹饪方式多样性
   */
  private calcCookingMethodDiversity(foods: ScoredFood[]): number {
    const methods = foods.map((f) => f.food.cookingMethod).filter(Boolean);
    const uniqueCount = new Set(methods).size;
    return methods.length > 0 ? Math.round((uniqueCount / methods.length) * 100) : 100;
  }

  /**
   * 口味互补性：基于 flavorProfile 6 轴
   * 理想：不同菜覆盖不同口味维度
   */
  private calcFlavorBalance(foods: ScoredFood[]): number {
    const profiles = foods.map((f) => f.food.flavorProfile).filter(Boolean) as FlavorProfile[];

    if (profiles.length < 2) return 80; // 单品默认

    // 6 轴口味：sweet, sour, salty, bitter, umami, spicy
    // 计算各轴的标准差 → 标准差越大表示越分散（越好）
    const axes = ['sweet', 'sour', 'salty', 'bitter', 'umami', 'spicy'];
    let totalVariance = 0;
    for (const axis of axes) {
      const values = profiles.map((p) => (p as any)[axis] ?? 0);
      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
      totalVariance += variance;
    }

    // 标准差映射到 0-100：std < 0.5 → 低分（太相似），std > 2 → 高分
    const avgStd = Math.sqrt(totalVariance / axes.length);
    return Math.min(100, Math.round(avgStd * 40));
  }

  /**
   * 营养互补性：检测互补营养素对
   * 如：铁 + 维C → 吸收增强
   */
  private calcNutritionComplementarity(foods: ScoredFood[], targets: NutritionTarget): number {
    const COMPLEMENTARY_PAIRS = [
      { a: 'iron', b: 'vitaminC', bonus: 'ironAbsorption' },
      { a: 'calcium', b: 'vitaminD', bonus: 'calciumAbsorption' },
      { a: 'fat', b: 'vitaminA', bonus: 'fatSolubleVitamin' },
      { a: 'protein', b: 'vitaminB12', bonus: 'proteinSynthesis' },
    ];

    let complementaryHits = 0;
    for (const pair of COMPLEMENTARY_PAIRS) {
      const hasA = foods.some((f) => (f.food as any)[pair.a] > 0);
      const hasB = foods.some((f) => (f.food as any)[pair.b] > 0);
      if (hasA && hasB) complementaryHits++;
    }

    return Math.round((complementaryHits / COMPLEMENTARY_PAIRS.length) * 100);
  }
}
```

#### 4.2.7 整餐 Rerank — 在 Assemble 中注入

```typescript
// recommendation-engine.service.ts — assembleMeal 方法增强
// 在每个角色最佳食物选定后，进行整餐组合检查

private assembleMealWithCompositionCheck(
  rankedByRole: Map<string, ScoredFood[]>,
  context: PipelineContext,
): AssembledMeal {
  // 1. 每个角色选 top-1（已有逻辑）
  const selected = this.selectTopPerRole(rankedByRole);

  // 2. ★ V6.5: 整餐组合检查
  const compositionScore = this.mealCompositionScorer.scoreMealComposition(
    selected, context.nutritionTargets,
  );

  // 3. 如果组合分数 < 60，尝试替换重复食材的角色
  if (compositionScore.ingredientDiversity < 60) {
    this.resolveIngredientConflicts(selected, rankedByRole);
  }

  // 4. 如果烹饪方式过于单一，尝试替换
  if (compositionScore.cookingMethodDiversity < 50) {
    this.resolveCookingMethodConflicts(selected, rankedByRole);
  }

  return {
    foods: selected,
    compositionScore, // ★ 新增：组合评分
  };
}
```

#### 4.2.8 向量语义召回

```typescript
// 新增：semantic-recall.service.ts
@Injectable()
export class SemanticRecallService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisCacheService: RedisCacheService
  ) {}

  /**
   * 基于用户历史正向反馈食物的 embedding，
   * 做 ANN（Approximate Nearest Neighbor）搜索
   *
   * 使用 pgvector 的 <=> 运算符（cosine distance）
   */
  async recallSimilarFoods(
    userId: string,
    limit: number = 30,
    excludeIds: string[] = []
  ): Promise<string[]> {
    // 1. 获取用户最近 30 天正向反馈的食物 embedding
    const cacheKey = `semantic_profile:${userId}`;
    let userVector = await this.redisCacheService.get<number[]>(cacheKey);

    if (!userVector) {
      userVector = await this.buildUserSemanticProfile(userId);
      if (userVector) {
        await this.redisCacheService.set(cacheKey, userVector, 3600); // 1h TTL
      }
    }

    if (!userVector) return []; // 无正向反馈，无法做语义召回

    // 2. ANN 搜索最相似的食物
    const excludeClause =
      excludeIds.length > 0
        ? `AND f.id NOT IN (${excludeIds.map((id) => `'${id}'`).join(',')})`
        : '';

    const results = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `
      SELECT f.id
      FROM foods f
      WHERE f.status = 'active'
        AND f.is_verified = true
        AND f.embedding IS NOT NULL
        ${excludeClause}
      ORDER BY f.embedding <=> $1::vector
      LIMIT $2
    `,
      `[${userVector.join(',')}]`,
      limit
    );

    return results.map((r) => r.id);
  }

  /**
   * 构建用户语义画像：正向反馈食物 embedding 的加权平均
   */
  private async buildUserSemanticProfile(userId: string): Promise<number[] | null> {
    const feedbacks = await this.prisma.recommendation_feedbacks.findMany({
      where: {
        user_id: userId,
        action: { in: ['accepted', 'loved'] },
        created_at: { gte: new Date(Date.now() - 30 * 86400_000) },
      },
      select: { food_id: true, action: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 50,
    });

    if (feedbacks.length < 3) return null; // 需要至少 3 个正向反馈

    // 获取这些食物的 embedding
    const foodIds = feedbacks.map((f) => f.food_id).filter(Boolean) as string[];
    const foods = await this.prisma.foods.findMany({
      where: { id: { in: foodIds }, embedding: { not: null } },
      select: { id: true, embedding: true },
    });

    if (foods.length < 3) return null;

    // 加权平均（时间衰减 + 反馈强度）
    const dim = (foods[0].embedding as number[]).length;
    const avg = new Array(dim).fill(0);
    let totalWeight = 0;

    for (const food of foods) {
      const fb = feedbacks.find((f) => f.food_id === food.id);
      if (!fb) continue;

      const daysAgo = (Date.now() - fb.created_at.getTime()) / 86400_000;
      const timeWeight = Math.exp(-0.03 * daysAgo);
      const actionWeight = fb.action === 'loved' ? 1.5 : 1.0;
      const weight = timeWeight * actionWeight;

      const emb = food.embedding as number[];
      for (let i = 0; i < dim; i++) {
        avg[i] += emb[i] * weight;
      }
      totalWeight += weight;
    }

    if (totalWeight === 0) return null;
    return avg.map((v) => v / totalWeight);
  }
}
```

#### 4.2.9 混合召回集成

```typescript
// recommendation-engine.service.ts — recallCandidates 增强
// 在已有的规则召回之后，合并语义召回结果

private async recallCandidates(
  pool: FoodLibrary[],
  context: PipelineContext,
  strategy: ResolvedStrategy,
): Promise<FoodLibrary[]> {
  // 1. 规则召回（已有逻辑，不修改）
  let ruleBased = this.applyRuleFilters(pool, context, strategy);

  // 2. ★ V6.5: 语义召回
  const semanticWeight = strategy.config.recall?.semantic ?? 0;
  if (semanticWeight > 0 && context.userId) {
    const semanticIds = await this.semanticRecallService.recallSimilarFoods(
      context.userId,
      Math.ceil(strategy.config.recall?.poolSize ?? 50) * semanticWeight,
      ruleBased.map(f => f.id),
    );

    // 合并：语义召回的食物加入候选池（标记来源）
    const semanticFoods = pool.filter(f => semanticIds.includes(f.id));
    for (const f of semanticFoods) {
      (f as any).__recallSource = 'semantic';
    }
    ruleBased = [...ruleBased, ...semanticFoods];
  }

  // 3. ★ V6.5: 现实性过滤
  const realism = strategy.config.realism;
  if (realism?.enabled) {
    ruleBased = this.realisticFilterService.filterByRealism(
      ruleBased, context, realism,
    );
  }

  return ruleBased;
}
```

#### 4.2.10 StrategyAutoTuner

```typescript
// 新增：strategy-auto-tuner.service.ts
@Injectable()
export class StrategyAutoTuner {
  private readonly logger = new Logger(StrategyAutoTuner.name);

  /**
   * 每周一 04:00 执行策略自动调优
   * 分析过去 7 天的效果矩阵，调整 segment→strategy 映射
   */
  @Cron('0 4 * * 1')
  async autoTune(): Promise<void> {
    const endDate = new Date();
    const startDate = new Date(Date.now() - 7 * 86400_000);

    // 1. 获取效果矩阵
    const report = await this.effectivenessService.getEffectivenessReport({
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    });

    if (!report?.strategies?.length) {
      this.logger.log('效果数据不足，跳过自动调优');
      return;
    }

    // 2. 找出每个 segment 的最佳策略
    const segmentBest = new Map<string, { strategy: string; rate: number }>();

    for (const strategy of report.strategies) {
      for (const segment of this.extractSegments(strategy)) {
        const current = segmentBest.get(segment.name);
        if (!current || segment.acceptanceRate > current.rate) {
          segmentBest.set(segment.name, {
            strategy: strategy.strategyName,
            rate: segment.acceptanceRate,
          });
        }
      }
    }

    // 3. 对比当前映射，生成调整建议
    const suggestions: TuningSuggestion[] = [];
    for (const [segment, best] of segmentBest) {
      const current = this.getCurrentMapping(segment);
      if (current !== best.strategy && best.rate > 0.3) {
        // 仅在新策略接受率 > 30% 且比当前高 20%+ 时建议切换
        const currentRate = this.getAcceptanceRate(report, current, segment);
        if (best.rate > currentRate * 1.2) {
          suggestions.push({
            segment,
            currentStrategy: current,
            suggestedStrategy: best.strategy,
            currentRate,
            suggestedRate: best.rate,
            improvement: best.rate - currentRate,
          });
        }
      }
    }

    // 4. 自动应用低风险调整（improvement > 50%），高风险调整仅记录建议
    for (const suggestion of suggestions) {
      if (suggestion.improvement > 0.5 * suggestion.currentRate) {
        // 高置信度：自动切换
        await this.applyStrategySwitch(suggestion);
        this.logger.log(
          `自动策略切换: ${suggestion.segment} ${suggestion.currentStrategy} → ${suggestion.suggestedStrategy} ` +
            `(${(suggestion.currentRate * 100).toFixed(1)}% → ${(suggestion.suggestedRate * 100).toFixed(1)}%)`
        );
      } else {
        // 低置信度：仅记录
        this.logger.log(`策略调优建议（未自动应用）: ${JSON.stringify(suggestion)}`);
      }
    }
  }

  /**
   * 自适应 exploration rate
   * 根据用户交互量和 TS 收敛程度调整
   */
  calcAdaptiveExplorationRate(
    totalInteractions: number,
    tsConvergence: number // 0-1，1=完全收敛
  ): number {
    // 基础 exploration rate 从策略配置获取
    const baseRate = 0.15;

    // 交互量衰减：交互越多，探索越少
    const interactionDecay = Math.exp(-totalInteractions / 100);

    // 收敛衰减：TS 越收敛，探索越少
    const convergenceDecay = 1 - tsConvergence * 0.8;

    return Math.max(0.02, baseRate * interactionDecay * convergenceDecay);
  }
}
```

---

### 4.3 Nutrition / Scoring 模块

**目标：12 维评分 + 画像字段注入 + 整餐营养分析增强**

#### 4.3.1 ScoringExplanation 扩展

```typescript
// scoring-explanation.interface.ts — dimensions 新增 executability
export interface ScoringExplanation {
  dimensions: {
    calories: DimensionScore;
    protein: DimensionScore;
    carbs: DimensionScore;
    fat: DimensionScore;
    quality: DimensionScore;
    satiety: DimensionScore;
    glycemic: DimensionScore;
    nutrientDensity: DimensionScore;
    inflammation: DimensionScore;
    fiber: DimensionScore;
    seasonality: DimensionScore;
    executability: DimensionScore; // ★ V6.5
  };
}
```

#### 4.3.2 整餐解释增强

```typescript
// explanation-generator.service.ts — explainMealComposition 增强
// 从一句话升级为结构化整餐分析

interface MealExplanation {
  // 已有
  summary: string; // 一句话总结

  // ★ V6.5 新增
  compositionScore: {
    ingredientDiversity: number;
    cookingMethodDiversity: number;
    flavorBalance: number;
    nutritionComplementarity: number;
    overall: number;
  };
  complementaryPairs: {
    // 营养互补关系
    nutrientA: string;
    foodA: string;
    nutrientB: string;
    foodB: string;
    benefit: string; // "维C帮助铁吸收"
  }[];
  macroBalance: {
    // 宏量营养素分布
    caloriesTotal: number;
    proteinPct: number;
    carbsPct: number;
    fatPct: number;
    targetMatch: number; // 0-100 与目标的匹配度
  };
  diversityTips: string[]; // 多样性建议（如"建议增加一道蒸菜"）
}
```

#### 4.3.3 菜谱推荐新增烹饪时间维度

```typescript
// recipe.service.ts — scoreRecipeForUser 改造
// 当前：50% nutritionMatch + 30% preferenceMatch + 20% difficultyMatch
// V6.5：45% nutritionMatch + 25% preferenceMatch + 15% difficultyMatch + 15% timeMatch

private scoreRecipeForUser(
  recipe: RecipeDetail,
  profile: EnrichedProfileContext,
  context: PipelineContext,
): number {
  const nutritionScore = this.calcNutritionMatch(recipe, profile);
  const preferenceScore = this.calcPreferenceMatch(recipe, profile);
  const difficultyScore = this.calcDifficultyMatch(recipe, profile);

  // ★ V6.5: 烹饪时间匹配
  const timeScore = this.calcTimeMatch(recipe, context);

  return nutritionScore * 0.45
       + preferenceScore * 0.25
       + difficultyScore * 0.15
       + timeScore * 0.15;
}

/**
 * 烹饪时间匹配评分
 * 工作日优先快手菜，周末允许更长时间
 */
private calcTimeMatch(recipe: RecipeDetail, context: PipelineContext): number {
  const totalTime = (recipe.prepTimeMinutes ?? 0) + (recipe.cookTimeMinutes ?? 0);
  const isWorkday = context.contextual?.dayType === 'weekday';
  const idealTime = isWorkday ? 30 : 60; // 工作日 30min，周末 60min
  const maxTime = isWorkday ? 60 : 120;

  if (totalTime <= idealTime) return 100;
  if (totalTime >= maxTime) return 20;
  return 100 - ((totalTime - idealTime) / (maxTime - idealTime)) * 80;
}
```

---

### 4.4 Cache / 性能

**目标：基础设施健壮化 + 向量索引优化**

#### 4.4.1 Gateway 限流迁移到 Redis

```typescript
// core/guards/rate-limit.guard.ts 改造
// 当前：进程内 Map（单实例有效）
// V6.5：Redis sliding window（多实例安全）

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(private readonly redisCacheService: RedisCacheService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const clientId = request.headers['x-client-id'] || request.ip;
    const key = `ratelimit:${clientId}`;

    // Redis sliding window counter
    const current = await this.redisCacheService.increment(key);
    if (current === 1) {
      // 首次访问，设置过期
      await this.redisCacheService.expire(key, 60); // 1 分钟窗口
    }

    const limit = this.getLimit(request);
    if (current > limit) {
      throw new ThrottlerException('Rate limit exceeded');
    }

    return true;
  }
}
```

#### 4.4.2 Circuit Breaker Service

```typescript
// 新增：core/circuit-breaker/circuit-breaker.service.ts
import CircuitBreaker from 'opossum';

@Injectable()
export class CircuitBreakerService {
  private readonly breakers = new Map<string, CircuitBreaker>();

  /**
   * 获取或创建指定服务的 circuit breaker
   */
  getBreaker(serviceName: string, options?: CircuitBreakerOptions): CircuitBreaker {
    if (!this.breakers.has(serviceName)) {
      const defaultOptions = {
        timeout: 30000,           // 30s 超时
        errorThresholdPercentage: 50, // 50% 错误率触发熔断
        resetTimeout: 30000,      // 30s 后尝试恢复
        rollingCountTimeout: 60000, // 1min 滚动窗口
        rollingCountBuckets: 6,
        ...options,
      };

      const breaker = new CircuitBreaker(
        async (fn: () => Promise<any>) => fn(),
        defaultOptions,
      );

      // Prometheus 指标
      breaker.on('open', () => {
        this.logger.warn(`Circuit OPEN: ${serviceName}`);
        this.metricsService.incrementCircuitEvent(serviceName, 'open');
      });
      breaker.on('halfOpen', () => {
        this.logger.log(`Circuit HALF-OPEN: ${serviceName}`);
      });
      breaker.on('close', () => {
        this.logger.log(`Circuit CLOSE: ${serviceName}`);
        this.metricsService.incrementCircuitEvent(serviceName, 'close');
      });

      this.breakers.set(serviceName, breaker);
    }

    return this.breakers.get(serviceName)!;
  }
}

// 使用示例（recipe-generation.service.ts）：
async callLLM(request: RecipeGenerationRequest): Promise<CreateRecipeDto[]> {
  const breaker = this.circuitBreakerService.getBreaker('openrouter', {
    timeout: routeConfig.timeoutMs,
  });

  return breaker.fire(async () => {
    const response = await fetch(/* ... */);
    // ... existing logic
  }).catch((err) => {
    if (err.code === 'EOPENBREAKER') {
      this.logger.warn('AI Provider 熔断中，跳过菜谱生成');
      return [];
    }
    throw err;
  });
}
```

#### 4.4.3 BullMQ 降级 + DLQ

```typescript
// core/queue/queue-resilience.service.ts
@Injectable()
export class QueueResilienceService {
  /**
   * 带降级的任务提交
   * Redis 不可用时 fallback 到同步处理
   */
  async safeEnqueue<T>(
    queue: Queue,
    jobName: string,
    data: T,
    opts?: JobsOptions
  ): Promise<{ mode: 'queued' | 'sync'; jobId?: string }> {
    try {
      const job = await queue.add(jobName, data, opts);
      return { mode: 'queued', jobId: job.id ?? undefined };
    } catch (err) {
      this.logger.warn(`队列提交失败（${queue.name}），降级为同步处理: ${(err as Error).message}`);
      this.metricsService.incrementQueueFallback(queue.name);
      return { mode: 'sync' };
    }
  }
}

// core/queue/dead-letter.service.ts
@Injectable()
export class DeadLetterService {
  /**
   * 将永久失败的 job 存入 DLQ（数据库）
   */
  async storeFailedJob(
    queueName: string,
    jobId: string,
    jobData: any,
    error: string,
    attemptsMade: number
  ): Promise<void> {
    await this.prisma.dead_letter_jobs.create({
      data: {
        queue_name: queueName,
        job_id: jobId,
        job_data: jobData,
        error_message: error,
        attempts_made: attemptsMade,
        failed_at: new Date(),
        status: 'pending', // pending / retried / discarded
      },
    });
  }

  /**
   * 重放 DLQ 中的 job
   */
  async replayJob(dlqId: string): Promise<void> {
    const dlqJob = await this.prisma.dead_letter_jobs.findUnique({
      where: { id: dlqId },
    });
    if (!dlqJob || dlqJob.status !== 'pending') return;

    const queue = this.getQueueByName(dlqJob.queue_name);
    await queue.add('replay', dlqJob.job_data);

    await this.prisma.dead_letter_jobs.update({
      where: { id: dlqId },
      data: { status: 'retried', retried_at: new Date() },
    });
  }
}
```

#### 4.4.4 EventEmitter2 全局错误处理

```typescript
// core/events/event-error-handler.ts
@Injectable()
export class EventErrorHandler implements OnModuleInit {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  onModuleInit(): void {
    // 全局 listener 错误处理
    // 确保一个 listener 异常不会阻塞其他 listener
    this.eventEmitter.on('error', (error: Error) => {
      this.logger.error(`Domain event listener 异常: ${error.message}`, error.stack);
    });
  }
}

// 同时将关键 listener 包装为 try/catch
// 推荐使用 @OnEvent 装饰器的 { async: true, suppressErrors: true } 选项
```

#### 4.4.5 pgvector 索引优化

```sql
-- 为 foods.embedding 创建 IVFFlat 索引（已有 embedding 列）
-- 需要先选择合适的 lists 数（通常 sqrt(总行数)）
CREATE INDEX idx_foods_embedding_ivfflat
  ON foods USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- 或使用 HNSW 索引（更高精度，更多内存）
CREATE INDEX idx_foods_embedding_hnsw
  ON foods USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

---

### 4.5 数据流

**目标：替换模式事件化 + 语义画像自动更新 + 组合评分缓存**

#### 4.5.1 替换模式事件链

```
用户提交反馈（replaced A → B）
    │
    ├─→ 已有：权重学习、偏好更新、预计算
    │
    └─→ ★ V6.5: ReplacementPatternService.recordReplacement()
            │
            ├─→ 更新 replacement_patterns 聚合（A→B 频率+1）
            ├─→ 当频率 ≥ 2：标记 A 为"用户不满意"
            ├─→ 当频率 ≥ 5：标记 A 为"强烈不满意"
            └─→ 下次推荐时 getReplacementAdjustments() 生效
```

#### 4.5.2 语义画像自动更新

```
用户反馈事件（FEEDBACK_SUBMITTED）
    │
    ├─→ 已有：权重学习、短期画像、预计算
    │
    └─→ ★ V6.5: 语义画像缓存失效
            └─→ redisCacheService.del(`semantic_profile:${userId}`)
            └─→ 下次推荐时自动重建语义画像
```

#### 4.5.3 食物入库/更新 → Embedding 生成

```
食物创建/更新事件
    │
    ├─→ 已有：食物池缓存失效、搜索索引更新
    │
    └─→ ★ V6.5: EmbeddingGenerationService
            │
            ├─→ 提取食物特征（名称、品类、营养素、标签、口味、烹饪方式）
            ├─→ 调用 embedding API 生成向量
            ├─→ 写入 foods.embedding 字段
            └─→ 更新 pgvector 索引
```

#### 4.5.4 策略自动调优事件链

```
每周一 04:00 Cron
    │
    ├─→ StrategyAutoTuner.autoTune()
    │       ├─→ 获取过去 7 天效果矩阵
    │       ├─→ 计算每个 segment 的最佳策略
    │       ├─→ 高置信度自动切换（improvement > 50%）
    │       ├─→ 低置信度记录建议
    │       └─→ 更新 strategy_assignment 表
    │
    └─→ Admin 仪表盘可查看调优历史 + 手动覆盖
```

---

## Step 5：技术路线图

### Phase 1：短期（1-2 周）— 可执行性 + 画像激活 + 基础设施加固

**目标：推荐结果贴近现实 + 消除基础设施隐患**

| 任务                                               | 工作量 | 风险 | 优先级 |
| -------------------------------------------------- | ------ | ---- | ------ |
| `commonality_score` 字段新增 + 数据填充            | 2d     | 中   | P0     |
| `RealisticFilterService` 实现                      | 2d     | 低   | P0     |
| 策略第 9 维 `realism` 参数定义 + 预设策略更新      | 1d     | 低   | P0     |
| 第 12 维 `executability` 评分 + SCORE_WEIGHTS 更新 | 2d     | 中   | P0     |
| 画像 6 字段激活（lifestyle→评分映射）              | 3d     | 中   | P1     |
| 替换模式回流（ReplacementPatternService）          | 2d     | 低   | P1     |
| Gateway 限流/配额迁移到 Redis                      | 2d     | 中   | P0     |
| CircuitBreakerService + AI Provider 熔断           | 2d     | 中   | P0     |
| EventEmitter2 全局错误处理                         | 0.5d   | 低   | P1     |
| ScheduleModule.forRoot() 移到 AppModule            | 0.5d   | 低   | P1     |
| CANDIDATE_CREATED 死事件清理或实现                 | 0.5d   | 低   | P2     |
| 菜谱推荐新增烹饪时间维度                           | 1d     | 低   | P1     |

**总计：~18 天**

**验证方式：**

- 同一用户 `budgetLevel=low` 推荐结果不含 costLevel ≥ 4 的食物
- `commonality_score < 20` 的食物在 `warm_start` 策略下被过滤
- 工作日午餐推荐 cook_time > 45min 的菜谱占比 < 10%
- 多实例部署下限流计数一致（Redis 验证）
- AI Provider 模拟宕机 → circuit breaker open → 系统不卡死

---

### Phase 2：中期（2-4 周）— 整餐优化 + 数据治理 + 策略调优

**目标：整餐组合质量提升 + 数据模型规范化 + 策略自动进化**

| 任务                                                  | 工作量 | 风险 | 优先级 |
| ----------------------------------------------------- | ------ | ---- | ------ |
| `MealCompositionScorer` 实现                          | 3d     | 中   | P1     |
| 整餐 rerank（assembleMeal 组合检查 + 冲突解决）       | 3d     | 高   | P1     |
| 整餐解释增强（组合营养分析 + 互补关系 + 多样性评分）  | 2d     | 低   | P1     |
| `StrategyAutoTuner` 实现                              | 3d     | 中   | P1     |
| 自适应 exploration rate                               | 1d     | 中   | P2     |
| BullMQ DLQ（dead_letter_jobs 表 + DeadLetterService） | 2d     | 低   | P1     |
| BullMQ 降级处理（QueueResilienceService）             | 1d     | 中   | P1     |
| Prisma Schema 冗余字段清理                            | 1d     | 低   | P2     |
| FK 约束补齐（6 张表）                                 | 1d     | 中   | P2     |
| 时间戳类型统一迁移                                    | 1d     | 中   | P2     |
| 重复索引清除（4 对）                                  | 0.5d   | 低   | P2     |
| daily_plan_items 规范化表                             | 2d     | 高   | P2     |
| recipe_ratings 表新增                                 | 1d     | 低   | P2     |

**总计：~22 天**

**验证方式：**

- 整餐食材重复率 < 15%（当前无控制）
- 整餐烹饪方式重复率 < 30%
- 策略自动调优：模拟 7 天数据 → 自动切换低效策略
- DLQ：模拟 BullMQ 永久失败 → DLQ 存储 → Admin 可查看和重放
- FK 约束：删除 user → 级联清理 daily_plans（或报错）

---

### Phase 3：长期（3-5 周）— 向量召回 + 可配置现实策略 + 高级特性

**目标：语义智能召回 + 现实性用户可配 + 接近 AI 驱动**

| 任务                                                        | 工作量 | 风险 | 优先级 |
| ----------------------------------------------------------- | ------ | ---- | ------ |
| `SemanticRecallService` 实现                                | 3d     | 高   | P1     |
| Embedding 生成管道（BullMQ 异步）                           | 2d     | 中   | P1     |
| pgvector IVFFlat/HNSW 索引创建                              | 1d     | 中   | P1     |
| 混合召回集成（strategy.recall.semantic 权重）               | 2d     | 中   | P1     |
| CF 冷启动 fallback（<5 交互用 semantic 替代空白 CF）        | 1d     | 低   | P1     |
| 用户推荐偏好设置 API（大众化/探索型、快手/精致、便宜/不限） | 2d     | 低   | P2     |
| 场景动态 realism 调整（工作日午餐自动提升）                 | 1d     | 低   | P2     |
| Admin realism 配置面板（按分群/策略配置）                   | 2d     | 低   | P2     |
| Thompson Sampling 收敛可视化 API                            | 2d     | 中   | P2     |
| 暴食干预效果追踪                                            | 1d     | 低   | P3     |
| 解释自适应深度（根据互动意愿调整详细度）                    | 2d     | 中   | P3     |
| 用户流失预测模型（基于行为特征）                            | 3d     | 高   | P3     |

**总计：~22 天**

**验证方式：**

- 语义召回：用户喜欢三文鱼 → 推荐金枪鱼/鳕鱼等语义相似食物
- CF 冷启动：新用户（<5 交互）推荐多样性提升 30%+ vs V6.4
- 用户设置"大众化+快手" → 推荐结果全部是常见食物 + ≤30min 菜谱
- Thompson Sampling 收敛：Admin 可看到每个食物的 alpha/beta 分布图

---

## Step 6：数据迁移

### 6.1 新增 Prisma Model

```prisma
// schema.prisma 新增

// ★ 死信队列（BullMQ 永久失败任务存储）
model dead_letter_jobs {
  id             String   @id @default(uuid())
  queue_name     String   @db.VarChar(50)
  job_id         String   @db.VarChar(100)
  job_data       Json
  error_message  String   @db.Text
  attempts_made  Int      @default(0)
  status         String   @default("pending") @db.VarChar(20) // pending / retried / discarded
  failed_at      DateTime @default(now())
  retried_at     DateTime?
  created_at     DateTime @default(now())

  @@index([queue_name, status])
  @@index([failed_at])
}

// ★ 每日计划食物明细（daily_plans JSON 规范化）
model daily_plan_items {
  id             String   @id @default(uuid())
  daily_plan_id  String
  meal_type      String   @db.VarChar(20) // morning / lunch / dinner / snack
  role           String   @db.VarChar(20) // carb / protein / veggie / side / snack
  food_id        String?
  recipe_id      String?
  food_name      String   @db.VarChar(200)
  calories       Float?
  protein        Float?
  fat            Float?
  carbs          Float?
  score          Float?
  sort_order     Int      @default(0)

  daily_plan     daily_plans @relation(fields: [daily_plan_id], references: [id], onDelete: Cascade)
  food           foods?      @relation(fields: [food_id], references: [id])
  recipe         recipes?    @relation(fields: [recipe_id], references: [id])

  @@index([daily_plan_id, meal_type])
  @@index([food_id])
  @@index([recipe_id])
}

// ★ 菜谱用户评分
model recipe_ratings {
  id         String   @id @default(uuid())
  recipe_id  String
  user_id    String
  rating     Int      // 1-5
  comment    String?  @db.Text
  created_at DateTime @default(now())
  updated_at DateTime @updatedAt

  recipe     recipes  @relation(fields: [recipe_id], references: [id], onDelete: Cascade)

  @@unique([recipe_id, user_id])
  @@index([user_id])
  @@index([recipe_id])
}

// ★ 策略调优历史
model strategy_tuning_log {
  id                 String   @id @default(uuid())
  segment_name       String   @db.VarChar(50)
  previous_strategy  String   @db.VarChar(50)
  new_strategy       String   @db.VarChar(50)
  previous_rate      Float
  new_rate           Float
  improvement        Float
  auto_applied       Boolean  @default(false)
  created_at         DateTime @default(now())

  @@index([segment_name])
  @@index([created_at])
}

// ★ 替换模式聚合
model replacement_patterns {
  id              String   @id @default(uuid())
  user_id         String
  from_food_id    String
  from_food_name  String   @db.VarChar(200)
  to_food_id      String
  to_food_name    String   @db.VarChar(200)
  frequency       Int      @default(1)
  last_occurred   DateTime @default(now())
  created_at      DateTime @default(now())
  updated_at      DateTime @updatedAt

  @@unique([user_id, from_food_id, to_food_id])
  @@index([user_id])
  @@index([from_food_id])
}
```

### 6.2 已有表新增/修改字段

```sql
-- foods 表新增大众化评分
ALTER TABLE foods
ADD COLUMN commonality_score INTEGER DEFAULT 50;
-- 取值 0-100：0=极罕见, 50=一般, 100=日常必备
-- 如：米饭=95, 鸡胸肉=85, 藜麦=25, 鸵鸟肉=5

CREATE INDEX idx_foods_commonality ON foods(commonality_score);

-- daily_plans 表新增关系（保留 JSON 做兼容）
-- daily_plan_items 通过 daily_plan_id FK 关联

-- recipes 表新增关系
-- recipe_ratings 通过 recipe_id FK 关联
-- daily_plan_items 通过 recipe_id FK 关联

-- 清理冗余字段（标记废弃，Phase 2 执行）
-- 注：不直接删除，先标记废弃，待代码全部迁移后删除
COMMENT ON COLUMN foods.fiber_per_100g IS 'DEPRECATED_V6.5: 使用 fiber 字段';
COMMENT ON COLUMN foods.sugar_per_100g IS 'DEPRECATED_V6.5: 使用 sugar 字段';
COMMENT ON COLUMN foods.sodium_per_100g IS 'DEPRECATED_V6.5: 使用 sodium 字段';

-- 时间戳类型统一迁移（Phase 2 执行）
-- 将所有 timestamp(6) 改为 timestamptz(6)
ALTER TABLE foods ALTER COLUMN created_at TYPE timestamptz(6);
ALTER TABLE foods ALTER COLUMN updated_at TYPE timestamptz(6);
ALTER TABLE foods ALTER COLUMN verified_at TYPE timestamptz(6);
-- ... 其他表类似

-- 清除重复索引（Phase 2 执行）
DROP INDEX IF EXISTS "IDX_c147959a431fea61665d0e8bf4"; -- foods.category 重复
DROP INDEX IF EXISTS "IDX_68aa1d0fe3ef6b57e4fd922033"; -- foods.status 重复
DROP INDEX IF EXISTS "IDX_0e3bd85e37aa82a7ccdd76e135"; -- foods.primary_source 重复
DROP INDEX IF EXISTS "IDX_94919a5b0af8952c73beb42fbc"; -- foods.barcode 重复

-- 补齐 FK 约束（Phase 2 执行）
-- 注意：需要先清理孤儿数据
DELETE FROM daily_plans WHERE user_id NOT IN (SELECT id FROM app_users);
ALTER TABLE daily_plans
  ADD CONSTRAINT fk_daily_plans_user
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

-- user_behavior_profiles
ALTER TABLE user_behavior_profiles
  ADD CONSTRAINT fk_behavior_profiles_user
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

-- strategy_assignment
ALTER TABLE strategy_assignment
  ADD CONSTRAINT fk_strategy_assignment_strategy
  FOREIGN KEY (strategy_id) REFERENCES strategy(id) ON DELETE SET NULL;

-- notification
ALTER TABLE notification
  ADD CONSTRAINT fk_notification_user
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

-- weight_history
ALTER TABLE weight_history
  ADD CONSTRAINT fk_weight_history_user
  FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;

-- pgvector 索引（Phase 3 执行）
CREATE INDEX idx_foods_embedding_hnsw
  ON foods USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

### 6.3 数据初始化

```sql
-- 1. commonality_score 初始填充
-- 基于品类和 popularity 综合计算
UPDATE foods SET commonality_score = CASE
  -- 日常主食类（米饭、面条、馒头等）
  WHEN category = 'grains' AND popularity >= 70 THEN 90
  WHEN category = 'grains' THEN 70

  -- 常见蔬菜
  WHEN category = 'vegetables' AND popularity >= 60 THEN 85
  WHEN category = 'vegetables' THEN 60

  -- 常见水果
  WHEN category = 'fruits' AND popularity >= 60 THEN 80
  WHEN category = 'fruits' THEN 55

  -- 常见肉类
  WHEN category = 'meat' AND name LIKE ANY(ARRAY['%鸡%', '%猪%', '%牛%', '%羊%']) THEN 85
  WHEN category = 'meat' THEN 40

  -- 海鲜（地域差异大）
  WHEN category = 'seafood' AND name LIKE ANY(ARRAY['%虾%', '%鱼%', '%蟹%']) THEN 65
  WHEN category = 'seafood' THEN 35

  -- 乳制品
  WHEN category = 'dairy' AND popularity >= 50 THEN 75
  WHEN category = 'dairy' THEN 50

  -- 豆类
  WHEN category = 'legumes' THEN 70

  -- 零食饮料
  WHEN category IN ('snacks', 'beverages') AND popularity >= 50 THEN 65
  WHEN category IN ('snacks', 'beverages') THEN 45

  -- 预制食品
  WHEN category IN ('prepared_foods', 'mixed_dishes') THEN 60

  -- 默认
  ELSE LEAST(popularity, 50)
END;

-- 2. 高级食材特别标注（手动降低 commonality）
UPDATE foods SET commonality_score = LEAST(commonality_score, 20)
WHERE name LIKE ANY(ARRAY[
  '%鸵鸟%', '%鹿肉%', '%鳄鱼%', '%蛇肉%',
  '%藜麦%', '%奇亚籽%', '%亚麻籽%',
  '%松露%', '%鹅肝%', '%鱼子酱%',
  '%牛油果%', '%羽衣甘蓝%'
]);

-- 3. 日常必备食材特别标注（手动提高 commonality）
UPDATE foods SET commonality_score = GREATEST(commonality_score, 90)
WHERE name LIKE ANY(ARRAY[
  '%米饭%', '%白米%', '%面条%', '%馒头%', '%面包%',
  '%鸡蛋%', '%豆腐%', '%牛奶%',
  '%白菜%', '%土豆%', '%番茄%', '%黄瓜%',
  '%苹果%', '%香蕉%'
]);

-- 4. 替换模式初始数据（从现有 recommendation_feedbacks 挖掘）
INSERT INTO replacement_patterns (user_id, from_food_id, from_food_name, to_food_id, to_food_name, frequency, last_occurred)
SELECT
  f1.user_id,
  f1.food_id as from_food_id,
  f1.food_name as from_food_name,
  f2.food_id as to_food_id,
  f2.food_name as to_food_name,
  COUNT(*) as frequency,
  MAX(f2.created_at) as last_occurred
FROM recommendation_feedbacks f1
JOIN recommendation_feedbacks f2
  ON f1.user_id = f2.user_id
  AND f1.action = 'replaced'
  AND f2.action = 'accepted'
  AND f2.created_at BETWEEN f1.created_at AND f1.created_at + INTERVAL '10 minutes'
  AND f1.food_id IS NOT NULL
  AND f2.food_id IS NOT NULL
  AND f1.food_id != f2.food_id
GROUP BY f1.user_id, f1.food_id, f1.food_name, f2.food_id, f2.food_name
HAVING COUNT(*) >= 2
ON CONFLICT (user_id, from_food_id, to_food_id) DO UPDATE
  SET frequency = EXCLUDED.frequency,
      last_occurred = EXCLUDED.last_occurred;
```

### 6.4 迁移执行顺序

```bash
# Phase 1（短期）
# 1. foods 表新增 commonality_score
pnpm prisma migrate dev --name add_commonality_score

# 2. 数据填充
psql -f scripts/v6.5/fill_commonality_scores.sql

# Phase 2（中期）
# 3. 新增 dead_letter_jobs、daily_plan_items、recipe_ratings、strategy_tuning_log、replacement_patterns 表
pnpm prisma migrate dev --name add_v65_tables

# 4. 清除重复索引 + 补齐 FK
pnpm prisma migrate dev --name cleanup_indexes_and_fks

# 5. 时间戳类型统一
pnpm prisma migrate dev --name unify_timestamps

# 6. 替换模式数据初始化
psql -f scripts/v6.5/init_replacement_patterns.sql

# Phase 3（长期）
# 7. pgvector HNSW 索引
pnpm prisma migrate dev --name add_embedding_hnsw_index

# 8. Embedding 回填（BullMQ 异步）
# 通过 Admin API 触发
curl -X POST /api/admin/foods/backfill-embeddings
```

---

## Step 7：文档差异

### 7.1 新增章节

| 章节           | 位置                      | 内容                                                          |
| -------------- | ------------------------- | ------------------------------------------------------------- |
| 可执行性评分   | 核心模块 §推荐系统 - 评分 | 第 12 维 executability 计算逻辑 + commonality_score 定义      |
| 现实性过滤     | 核心模块 §推荐系统 - 召回 | RealisticFilterService 过滤规则 + realism 策略参数            |
| 整餐组合评分   | 核心模块 §推荐系统 - 排序 | MealCompositionScorer 4 维组合评分 + 整餐 rerank 逻辑         |
| 画像激活映射   | 核心模块 §用户画像        | 6 个未使用字段 → 评分映射规则                                 |
| 替换模式闭环   | 核心模块 §行为分析        | ReplacementPatternService + A→B 权重调整规则                  |
| 向量语义召回   | 核心模块 §推荐系统 - 召回 | SemanticRecallService + embedding ANN 搜索 + 用户语义画像构建 |
| 策略自动调优   | 核心模块 §策略系统        | StrategyAutoTuner 自动切换逻辑 + 自适应 exploration rate      |
| 基础设施健壮性 | 技术架构 §可靠性          | Circuit Breaker + Redis 限流 + BullMQ DLQ + 事件错误处理      |
| 数据模型治理   | 技术架构 §数据层          | 冗余清理 + FK 补齐 + 时间戳统一 + 索引去重                    |

### 7.2 修改内容

| 位置                 | 变更                                                                                                                         |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| §评分维度表          | 从 11 维扩展到 12 维（+executability），权重表更新                                                                           |
| §Goal-specific 权重  | 4 组权重从 11 元素扩展到 12 元素                                                                                             |
| §策略参数            | 从 8 维扩展到 9 维（+realism）                                                                                               |
| §预设策略            | 4 套策略新增 realism 默认配置                                                                                                |
| §foods 表结构        | 新增 commonality_score 字段                                                                                                  |
| §菜谱推荐评分        | 从 3 维（nutrition+preference+difficulty）扩展到 4 维（+timeMatch）                                                          |
| §推荐管道            | recall 新增语义召回 + 现实性过滤；rank 新增整餐 rerank                                                                       |
| §整餐解释            | 从一句话升级为结构化组合分析                                                                                                 |
| §行为分析            | 替换模式从"分析"到"回流推荐"                                                                                                 |
| §实体统计            | 新增 5 个模型（dead_letter_jobs, daily_plan_items, recipe_ratings, strategy_tuning_log, replacement_patterns），总计 60 → 65 |
| §Cron 调度表         | 新增策略自动调优 Cron（Mon 04:00）                                                                                           |
| §ScheduleModule 注册 | 从 FoodPipelineModule 移到 AppModule                                                                                         |
| §Gateway 限流        | 从内存 Map 改为 Redis                                                                                                        |
| §推荐请求参数        | 新增用户推荐偏好覆盖                                                                                                         |

### 7.3 删除内容

| 位置                        | 变更                           |
| --------------------------- | ------------------------------ |
| CANDIDATE_CREATED 事件定义  | 若无实际用途则删除（或补实现） |
| `fiber_per_100g` 等冗余字段 | 标记 DEPRECATED，后续版本删除  |
| foods 表 4 对重复索引       | 删除旧命名的重复索引           |

### 7.4 API 变更

#### 新增端点

| 端点                                        | 方法 | 说明                   |
| ------------------------------------------- | ---- | ---------------------- |
| `/api/admin/strategy-tuning/history`        | GET  | 策略调优历史           |
| `/api/admin/strategy-tuning/trigger`        | POST | 手动触发策略调优       |
| `/api/admin/dead-letter-queue`              | GET  | 查看 DLQ 中的失败任务  |
| `/api/admin/dead-letter-queue/:id/replay`   | POST | 重放 DLQ 任务          |
| `/api/admin/dead-letter-queue/:id/discard`  | POST | 丢弃 DLQ 任务          |
| `/api/admin/foods/backfill-embeddings`      | POST | 批量回填食物 embedding |
| `/api/admin/thompson-sampling/convergence`  | GET  | TS 收敛可视化数据      |
| `/api/app/users/recommendation-preferences` | PUT  | 用户推荐偏好设置       |
| `/api/app/recipes/:id/rating`               | POST | 菜谱评分               |
| `/api/app/recipes/:id/rating`               | GET  | 获取菜谱评分           |

#### 修改端点

| 端点                            | 变更                                     |
| ------------------------------- | ---------------------------------------- |
| `POST /api/app/diet/daily-plan` | 响应新增 `compositionScore` 整餐组合评分 |
| `GET /api/app/diet/explain`     | 整餐解释从一句话升级为结构化响应         |

---

## 附：V5 → V6.5 演进总结

| 维度   | V5           | V6.0                | V6.1          | V6.2              | V6.3                       | V6.4                              | V6.5                                 |
| ------ | ------------ | ------------------- | ------------- | ----------------- | -------------------------- | --------------------------------- | ------------------------------------ |
| 推荐   | 10 维评分    | + 策略引擎 + 预计算 | 不变          | + 全画像接入      | + 策略映射 + 菜谱 + 冷启动 | + 场景化渠道 + 时令 + 效果归因    | + 可执行性 + 整餐组合 + 语义召回     |
| 画像   | 3 层 + 填充  | + 短期 + 上下文     | 不变          | + ProfileResolver | + 死数据激活 + 运动        | + 渠道推断 + DTO 修复             | + 全画像激活 + 替换模式回流          |
| 营养   | NRF 9.3 固定 | 不变                | 不变          | + addedSugar      | + 12 维 + 个性化 RDA + GI  | + 时令评分（11 维）               | + 可执行性（12 维）+ 整餐互补评分    |
| 策略   | 无           | + 策略引擎          | 不变          | 不变              | + 4 套预设 + 分群映射      | + 效果分析                        | + 自动调优 + realism 第 9 维         |
| 商业   | 无           | 订阅 + 支付         | + 配额 + 分层 | + 安全加固        | 不变                       | 不变                              | 不变（稳定）                         |
| 食物   | 原料库       | 不变                | + 分析管道    | + 搜索增强        | + 菜谱层 + AI 生成         | + 渠道标签 + 时令标签             | + 大众化评分 + 向量语义 + 菜谱评分   |
| 性能   | 基础         | + 3 级缓存          | 不变          | + 批量 + 游标     | + 并行 + 增量 CF + 原子    | + 健康修正缓存 + 连接池           | + Circuit Breaker + DLQ + Redis 限流 |
| 解释   | 单食物       | + 反向              | + 分层        | 不变              | + 整餐 + 菜谱              | 不变                              | + 整餐组合分析 + 营养互补            |
| 安全   | 基础         | + Guard 体系        | + 订阅 Guard  | + 安全加固        | 不变                       | + 生产加固（JWT/CORS/Validation） | + 熔断 + Redis 限流                  |
| 可观测 | 无           | + 日志              | 不变          | 不变              | 不变                       | + Prometheus + 健康检查增强       | + 事件错误处理 + DLQ 审计            |
| 归因   | 无           | 无                  | 无            | 无                | 无                         | + RecommendationTrace + 效果矩阵  | + 策略自动调优 + 替换模式闭环        |
| 数据   | 基础         | + 事件驱动          | 不变          | 不变              | 不变                       | 不变                              | + Schema 治理 + 规范化 + FK + 索引   |
