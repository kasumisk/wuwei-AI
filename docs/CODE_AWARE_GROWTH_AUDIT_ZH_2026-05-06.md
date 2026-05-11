# 代码感知增长审计报告

> 范围：`apps/api-server` 当前 NestJS + Prisma 后端
> 日期：2026-05-06
> 目标：基于真实模型、接口、事件链路，分析留存、参与、变现失败原因，并提出 2 周内可落地的增长改造

## 0. 结论先行

这个系统当前**不是没有 AI 能力**，而是**增长闭环没有接通**。

真实情况是：

1. 有大量分析、推荐、画像、订阅、A/B、追踪、游戏化表和服务。
2. 但多条核心用户链路停在“给结果”或“记日志”，没有稳定进入“结果落库 -> 行为确认 -> 下次更准 -> 形成习惯”。
3. 结果会直接导致：
   - 首次有价值，但价值不沉淀。
   - 推荐看起来智能，但不一定越用越准。
   - 订阅只能在“额度用尽”时硬拦，而不是在“用户已经感到痛点”时精准转化。

最关键的断点有 4 个：

1. `AI 决策反馈链基本是空回路`：`AiDecisionLogs` 有表，也有 `decision-feedback` 接口，但主链路里几乎没有地方调用 `BehaviorService.logDecision()`；`actualOutcome` 字段也没有被前台反馈接口使用。见 `apps/api-server/src/modules/diet/app/services/behavior.service.ts:66-107`。
2. `推荐执行闭环未真正接入`：`RecommendationExecutions` 表和 `ExecutionTrackerService` 已存在，但全仓库没有业务代码调用 `recordRecommendation()` 或 `recordExecution()`。见 `apps/api-server/prisma/schema.prisma:2859-2880`、`apps/api-server/src/modules/diet/app/recommendation/feedback/execution-tracker.service.ts:81-184`。
3. `图片/文本分析和日常进展脱节`：图片分析返回结果后，用户还要额外调用 `POST /api/app/food/analyze-save` 才会生成 `FoodRecords`；文本分析当前是同步返回结果，但没有同等的保存闭环。见 `apps/api-server/src/modules/food/app/controllers/food-image-analyze.controller.ts:92-169`、`apps/api-server/src/modules/food/app/controllers/food-analysis-save.controller.ts:56-139`、`apps/api-server/src/modules/food/app/controllers/food-text-analyze.controller.ts:56-189`。
4. `付费触发过度依赖配额耗尽`：`QuotaGateService` 和 `SubscriptionTriggerLogs` 已具备基础设施，但 `ResultEntitlementService` 当前明确“不再裁剪任何字段”，导致原本的“结果不完整 -> 软转化”基本失效，付费主要退化成“额度用完再拦”。见 `apps/api-server/src/modules/subscription/app/services/result-entitlement.service.ts:37-60`、`apps/api-server/src/modules/subscription/app/services/paywall-trigger.service.ts:120-167`。

## 1. 系统真实核心流

## 1.1 图片分析流

真实链路：

1. 用户上传图片：`POST /api/app/food/analyze`。
2. 服务端先做订阅/额度检查：`QuotaGateService.checkAccess()`。
3. 图片上传到存储后，进入异步分析队列：`AnalyzeService.submitAnalysis()`。
4. 客户端轮询 `GET /api/app/food/analyze/:requestId` 获取结果。
5. 高置信度时，异步持久化为 `FoodAnalysisRecords`，并发出 `ANALYSIS_COMPLETED` 事件。见 `apps/api-server/src/modules/food/app/services/analyze.service.ts:244-295`。
6. 用户如果想把这餐纳入自己的摄入历史，必须再调用 `POST /api/app/food/analyze-save`，这一步才会创建 `FoodRecords`，再触发 `DailySummaries` 更新和 `MEAL_RECORDED` 事件。见 `apps/api-server/src/modules/food/app/controllers/food-analysis-save.controller.ts:81-137`、`apps/api-server/src/modules/diet/app/services/food.service.ts:1277-1299`。

问题：

1. “看到了结果”不等于“形成了行为数据”。
2. 用户在分析结果页流失时，系统只得到了一条分析记录，拿不到真实摄入、日汇总、连续记录、挑战推进。

## 1.2 文本分析流

真实链路：

1. 用户提交 `POST /api/app/food/analyze-text`。
2. 同步完成文本分析并直接返回结果。见 `apps/api-server/src/modules/food/app/controllers/food-text-analyze.controller.ts:56-189`。
3. 有配额检查、有缓存、有结果裁剪接口，但没有与 `FoodAnalysisRecords` 或 `FoodRecords` 的等价保存链。

问题：

1. 文本分析可以给出即时价值，但**默认不进入长期状态**。
2. 这条链路对后续推荐、进展、留存的贡献明显低于图片分析保存链。

## 1.3 推荐流

真实链路：

1. 用户调用 `GET /api/app/food/meal-suggestion`。
2. `FoodService.getMealSuggestion()` 读取 `DailySummaries`、`UserProfiles`、推荐引擎和预计算缓存。见 `apps/api-server/src/modules/diet/app/services/food.service.ts:224-420`。
3. 推荐引擎会异步写 `RecommendationTraces`。见 `apps/api-server/src/modules/diet/app/services/recommendation-engine.service.ts:874-925`、`apps/api-server/prisma/schema.prisma:2621-2672`。
4. 用户可通过 `POST /api/app/food/recommendation-feedback` 提交 accepted/replaced/skipped。见 `apps/api-server/src/modules/diet/app/controllers/food-plan.controller.ts:320-358`。

问题：

1. `RecommendationFeedbacks` 有 `traceId` 字段，但 `RecommendationFeedbackDto` 没有 `traceId`，Controller 也没有传。见 `apps/api-server/prisma/schema.prisma:1534-1569`、`apps/api-server/src/modules/diet/app/dto/recommendation.dto.ts:134-190`。
2. 也就是说，推荐已经被 trace 了，但反馈无法精确归因到那次推荐。
3. 更严重的是，`RecommendationExecutions` 和 `ExecutionTrackerService` 存在，但没有接入任何主链路，导致“推荐是否真的被吃掉”没有进入学习系统。

## 1.4 记录与进展流

真实链路：

1. 所有正式摄入都进入 `FoodRecords`。见 `apps/api-server/prisma/schema.prisma:687-755`。
2. 创建记录后会异步更新 `DailySummaries`，并发送 `MEAL_RECORDED` 事件。见 `apps/api-server/src/modules/diet/app/services/food.service.ts:1277-1299`。
3. `DailySummaries` 存了热量、宏量营养、营养分、来源分布、推荐执行次数等。见 `apps/api-server/prisma/schema.prisma:440-483`。
4. `RealtimeProfileService` 会基于 `MEAL_RECORDED` 更新短期画像。见 `apps/api-server/src/modules/user/app/services/profile/realtime-profile.service.ts:218-271`。

问题：

1. `DailySummaries.recommendExecutionCount` 有字段，但推荐执行闭环并未接通，字段价值被削弱。
2. `BehaviorService.updateStreak()` 和 `GamificationService.updateStreak()` 都存在，但我没有在主事件链里找到它们被记录创建自动触发。见 `apps/api-server/src/modules/diet/app/services/behavior.service.ts:109-197`、`apps/api-server/src/modules/gamification/app/gamification.service.ts:169-236`。
3. 这意味着系统有“进展分数”和“连胜字段”，但没有稳定强化成用户感知到的习惯奖励。

## 1.5 订阅与变现流

真实链路：

1. `SubscriptionService` 负责内部订阅真相源与 `UserEntitlement`/`UsageQuota`。见 `apps/api-server/src/modules/subscription/app/services/subscription.service.ts:57-109`。
2. `QuotaGateService` 在能力或额度检查时返回 `AccessDecision`。见 `apps/api-server/src/modules/subscription/app/services/quota-gate.service.ts:62-228`。
3. `PaywallTriggerService` 会把触发写入 `SubscriptionTriggerLogs`。见 `apps/api-server/src/modules/subscription/app/services/paywall-trigger.service.ts:75-239`。
4. 客户端可用 `GET /api/app/subscription/quota-status`、`POST /refresh`、`POST /restore`。见 `apps/api-server/src/modules/subscription/app/controllers/subscription-plans.controller.ts:73-139`。

问题：

1. 当前最强的转化触发点是“配额耗尽”。
2. 原本用于“结果裁剪后软转化”的链路，因 `ResultEntitlementService.trimResult()` 现返回完整结果而失效。见 `apps/api-server/src/modules/subscription/app/services/result-entitlement.service.ts:37-60`。
3. `PaywallTriggerService.markConverted()` 存在，但我没有找到调用方，说明“触发 -> 购买 -> 回写转化”未必闭环。见 `apps/api-server/src/modules/subscription/app/services/paywall-trigger.service.ts:215-239`。

## 2. 当前真正存了什么，没存什么

## 2.1 已存储的关键数据

1. 用户档案：`UserProfiles`，含 declared、`inferredData`、`behaviorData` 聚合。见 `apps/api-server/prisma/schema.prisma:2162-2271`。
2. 正式摄入：`FoodRecords`。见 `apps/api-server/prisma/schema.prisma:687-755`。
3. 每日进展：`DailySummaries`。见 `apps/api-server/prisma/schema.prisma:440-483`。
4. 分析结果：`FoodAnalysisRecords`。见 `apps/api-server/prisma/schema.prisma:536-591`。
5. 推荐反馈：`RecommendationFeedbacks`。见 `apps/api-server/prisma/schema.prisma:1534-1569`。
6. 推荐追踪：`RecommendationTraces`。见 `apps/api-server/prisma/schema.prisma:2621-2672`。
7. 订阅触发日志：`SubscriptionTriggerLogs`。见 `apps/api-server/prisma/schema.prisma:1999-2025`。
8. 配额：`UsageQuota`。见 `apps/api-server/prisma/schema.prisma:2027-2051`。
9. 成就与挑战：`UserAchievements`、`UserChallenges`。见 `apps/api-server/prisma/schema.prisma:2121-2156`。

## 2.2 缺失或未有效利用的数据

1. `AI 决策真实结果反馈`：`AiDecisionLogs.actualOutcome` 已有字段，但前台反馈接口不接这个值。见 `apps/api-server/prisma/schema.prisma:97-126`、`apps/api-server/src/modules/diet/app/dto/recommendation.dto.ts:219-234`。
2. `推荐展示归因`：trace 已写库，但没有稳定回传到 feedback 和执行记录。
3. `推荐执行映射`：系统定义了 `RecommendationExecutions`，但没有真实调用点。
4. `分析结果到正式摄入的漏斗状态`：当前无法低成本判断“看了结果但没保存”的规模和原因；`FoodAnalysisRecords` 缺少直接的 `savedRecordId` 类字段。
5. `付费触发到购买归因`：有触发日志，但回写转化链路不清晰。

## 3. 用户行为在哪丢失

## 3.1 丢在分析结果页

用户完成图片分析后，如果不点 `analyze-save`：

1. 不会产生 `FoodRecords`。
2. 不会更新 `DailySummaries`。
3. 不会推进 streak/challenge。
4. 第二天看不到明确进展。

这是留存最大黑洞之一。

## 3.2 丢在推荐页

用户看了推荐、觉得不错、甚至照着吃了，但系统很可能只知道：

1. 服务端生成过一条 `RecommendationTrace`。
2. 用户也许提交了 `accepted/skipped/replaced`。
3. 但系统不知道这次推荐最终是否被真实执行。

这会让“推荐变准”停留在显式反馈层，而不是行为层。

## 3.3 丢在 AI 决策反馈后

`POST /api/app/food/decision-feedback` 只写 `followed` 和 `feedback`，而且前提是已有对应 `AiDecisionLogs`。但主链里没有看到 `logDecision()` 被调用，导致这条接口很容易成为“用户点了反馈，但后台无对象可更新”的死接口。

## 3.4 丢在持续使用的强化阶段

系统虽然有：

1. `CollectionTriggerService`
2. `Achievements` / `Challenges`
3. `Notification` / `DeviceToken`

但从当前饮食主链看，缺的是“记录发生后立刻告诉用户今天有何变化、离目标还差多少、是否守住连胜、明天该怎么做”。现在数据层足够，强化层偏弱。

## 4. Activation Audit

## 4.1 用户能否在 10 秒内获得价值

结论：`文本分析有机会，图片分析大概率不能稳定做到，且价值默认不沉淀。`

### 文本分析

1. `POST /api/app/food/analyze-text` 是同步接口。
2. 这是当前最接近“10 秒内价值”的链路。
3. 第一份有意义输出是：结构化食物识别 + 热量/宏量 + 决策说明。

问题：

1. 文本分析结果没有天然进入进展链。
2. 用户拿到答案后，如果没有继续记入 `FoodRecords`，系统第二天几乎无法基于这次使用做复利。

### 图片分析

1. `POST /api/app/food/analyze` 是异步上传 + 入队 + 轮询。
2. 第一份有意义输出是 `GET /api/app/food/analyze/:requestId` 返回的分析结果或 `needs_review`。
3. 这条链路比文本分析重，明显更依赖网络、上传、轮询和用户二次点击。

问题：

1. 上传图片后，用户先得到的是 `processing`，不是价值本身。
2. 真正形成长期价值还要多一步 `analyze-save`。
3. 这会显著增加首次使用流失。

## 4.2 首次体验中的慢步骤和困惑点

1. `价值输出和价值沉淀分离`：先看到结果，再单独保存，这对首次用户是不自然的。
2. `结果页和进展页之间没有即时桥接`：保存后没有明确的 “今天已记录 / 剩余多少 / 连胜如何变化” 的后端返回结构。
3. `引导和即时价值割裂`：虽然有四步 onboarding 和 `dataCompleteness`，但首次核心价值更多来自分析，不是来自画像。见 `apps/api-server/src/modules/user/app/services/profile/user-profile.service.ts:276-392`。

## 5. Retention System Gap

## 5.1 Daily state tracking

结论：`部分存在，但没闭环到用户强化。`

已有：

1. `DailySummaries` 存每日热量、营养、分数、目标。见 `apps/api-server/prisma/schema.prisma:440-483`。
2. `WeightHistory` 已存在，可做体重趋势。
3. `FoodSummaryController` 暴露了 `summary/today` 和 `summary/recent`。见 `apps/api-server/src/modules/diet/app/controllers/food-summary.controller.ts:25-92`。

缺失：

1. 没有“保存一餐后立即返回今天进展变化”的标准接口输出。
2. 没有把 streak/challenge/achievement 的推进稳定挂在 `MEAL_RECORDED` 主事件上。

## 5.2 Feedback loop

结论：`推荐反馈有一半，AI 决策反馈基本没接通。`

已有：

1. 推荐反馈表 `RecommendationFeedbacks`。
2. `FEEDBACK_SUBMITTED` 事件会驱动短期画像更新。见 `apps/api-server/src/modules/diet/app/recommendation/feedback/feedback.service.ts:137-171`、`apps/api-server/src/modules/user/app/services/profile/realtime-profile.service.ts:200-216`。

缺失：

1. `traceId` 没从客户端传回来，精确归因断掉。
2. `AiDecisionLogs` 主动写入没有接入主链，`decision-feedback` 的学习价值极低。
3. `actualOutcome` 没有采集，无法验证 AI 决策长期正确性。

## 5.3 Progress tracking

结论：`有数据底座，缺用户感知层。`

已有：

1. 营养分、宏量目标、最近 N 天汇总。
2. 画像里也有 `goalProgress`、`churnRisk` 等推断位。见 `UserProfiles.inferredData` 注释 `apps/api-server/prisma/schema.prisma:2258-2267`。

缺失：

1. 前台核心链路里没有看到“目标进度更新后推送给用户”的强反馈接口。
2. 用户完成一次记录，不一定马上感知“我离目标更近了”。

## 5.4 Behavioral reinforcement

结论：`结构存在，触发弱。`

已有：

1. 成就、挑战、行为画像、持续收集提醒。
2. `collection-triggers` 接口能在 App 打开时取提醒。见 `apps/api-server/src/modules/user/app/controllers/user-profile.controller.ts:324-345`。

缺失：

1. 挑战/成就没有看到稳定绑定 `MEAL_RECORDED` 事件。
2. streak 更新逻辑存在双份实现，但没有看到统一的事件驱动接线。
3. 强化层更像后台能力，不像用户日常行为驱动器。

## 6. Data Loop Analysis

目标闭环应为：`User Action -> AI Decision -> Result -> Stored -> Future influence`

## 6.1 图片分析闭环

当前状态：`半闭环`

1. User Action：上传图片。
2. AI Decision：分析结果、风险判断已生成。
3. Result：能返回给前端。
4. Stored：高置信度时会存 `FoodAnalysisRecords`。
5. Future influence：只部分影响短期分析画像；若未保存为 `FoodRecords`，对日总结和习惯链影响不足。

断点：`Result -> Stored(正式摄入)`。

## 6.2 文本分析闭环

当前状态：`弱闭环`

1. User Action：输入文本。
2. AI Decision：即时返回。
3. Result：有。
4. Stored：默认没有进长期状态。
5. Future influence：几乎没有稳定来源。

断点：`Result -> Stored`。

## 6.3 推荐闭环

当前状态：`假闭环`

1. User Action：请求下一餐推荐。
2. AI Decision：推荐引擎给出结果，并记录 `RecommendationTraces`。
3. Result：前端可见。
4. Stored：trace 存了，反馈也能存。
5. Future influence：只到“显式偏好更新”这一层，缺“真实执行结果”这一层。

断点：

1. `traceId` 未从客户端回传。
2. `RecommendationExecutions` 未接入。
3. `FoodRecords.recommendationTraceId` 有字段，但主链没有自动打通推荐到实际进食。

这会直接削弱习惯形成，因为系统无法判断：

1. 用户是喜欢这个推荐，还是只是点了接受。
2. 用户是真的吃了，还是之后换掉了。
3. 哪些推荐是“高接受低执行”的伪优质建议。

## 6.4 AI 决策闭环

当前状态：`接近断裂`

1. 表有：`AiDecisionLogs`。
2. 反馈接口有：`POST /api/app/food/decision-feedback`。
3. 但主链没有持续写 decision log。

这意味着：你设计了“AI 该不该吃”的后验学习表，但业务几乎没真正用起来。

## 7. Growth Feature Design

以下功能都尽量复用现有表、服务、事件和订阅基建，控制在 2 周内可落地。

## 7.1 功能一：分析结果一键落进展

目标：把“看到分析结果”变成“进入每日进展”。

### 需要的 DB 变更

Prisma：建议给 `FoodAnalysisRecords` 增加两个字段。

1. `savedRecordId String? @map("saved_record_id") @db.Uuid`
2. `savedAt DateTime? @map("saved_at") @db.Timestamptz(6)`

作用：

1. 防重复保存。
2. 统计 `analysis -> saved record` 转化率。
3. 能直接找到“分析结果已沉淀成哪条正式记录”。

### 需要的 API 变更

1. 保留现有 `POST /api/app/food/analyze-save`，但改成幂等：如果已保存，直接返回现有 `recordId`。
2. 响应增加：
   - `todaySummary`
   - `delta`：本次新增热量、蛋白质、分数变化
   - `streakPreview`：当前连胜/是否 on_track
3. 为文本分析新增轻量保存入口：
   - `POST /api/app/food/analyze-text/save`
   - 或给 `POST /api/app/food/analyze-text` 增加 `saveAfterAnalyze` 选项

### 需要的客户端行为

1. 结果页主 CTA 从“关闭”改成“记入今天”。
2. 保存成功后直接展示“今天已记录第 X 餐 / 还剩 Y kcal / 分数变化”。
3. 文本分析和图片分析使用同一套保存成功反馈。

### 预期影响

1. 提高首次价值沉淀率。
2. 提高 Day 1 到 Day 2 的可感知连续性。
3. 为后续 streak/challenge/summary 提供稳定输入。

## 7.2 功能二：推荐归因闭环接通

目标：让系统知道“推荐了什么”“用户怎么反馈”“最后吃了什么”。

### 需要的 DB 变更

Prisma：建议给 `FoodRecords` 增加一个精准外键字段。

1. `recommendationExecutionId String? @map("recommendation_execution_id") @db.Uuid`
2. `@@index([recommendationExecutionId])`

说明：

1. 现在 `FoodRecords` 只有 `recommendationTraceId`，更偏追踪，不足以稳定绑定一次执行闭环。
2. `RecommendationExecutions` 已有，不需要新建表。

### 需要的 API 变更

1. `GET /api/app/food/meal-suggestion` 响应增加：
   - `traceId`
   - `executionId`
2. `RecommendationFeedbackDto` 增加 `traceId?: string`、`executionId?: string`。
3. `POST /api/app/food/records` 支持传入 `recommendationExecutionId`。

### 需要的服务逻辑变更

1. 生成推荐时调用 `ExecutionTrackerService.recordRecommendation()`。
2. 用户记餐时若带 `recommendationExecutionId`，调用 `recordExecution()` 回填实际执行食物。
3. `feedbackService.submitFeedback()` 里把 `traceId` 真正写进 `RecommendationFeedbacks.traceId`。

### 需要的客户端行为

1. 展示推荐卡片时缓存 `traceId/executionId`。
2. 用户点击“接受/替换/跳过”时一起回传。
3. 用户从推荐卡去记餐时，把 `executionId` 一并带上。

### 预期影响

1. 推荐学习从“显式意见”升级为“真实执行”。
2. 可以识别“高点击低执行”的伪好推荐。
3. 明显提升推荐长期质量和用户信任。

## 7.3 功能三：AI 决策后验学习接通

目标：把“你照做了吗”和“后来结果如何”真正回收到 AI 决策层。

### 需要的 DB 变更

最小可行方案：`AiDecisionLogs` 可复用，DB 可不新增表。

建议补两个时间字段：

1. `feedbackAt DateTime? @map("feedback_at") @db.Timestamptz(6)`
2. `outcomeAt DateTime? @map("outcome_at") @db.Timestamptz(6)`

### 需要的 API 变更

1. `POST /api/app/food/decision-feedback` 扩展为：
   - `decisionLogId?: string`
   - `analysisId?: string`
   - `recordId?: string`
   - `followed`
   - `feedback`
   - `actualOutcome?`
2. 图片/文本分析结果响应中返回 `decisionLogId`。

### 需要的服务逻辑变更

1. 在文本分析和图片分析完成时，真正调用 `BehaviorService.logDecision()`。
2. `decision-feedback` 更新 `userFollowed`、`userFeedback`、`actualOutcome`。
3. `BehaviorService.analyzeUserBehavior()` 不再只依赖弱信号，而是吃真实 follow/outcome。

### 需要的客户端行为

1. 分析后即时问一次“有帮助吗”。
2. 次日或数小时后轻提示一次“你最后吃了吗/结果如何”。

### 预期影响

1. AI 决策从“会说”变成“会学”。
2. 能找出误判食物、误判时段、误判用户群。
3. 为高价值精度升级版订阅打基础。

## 7.4 功能四：结果页即时转化而不是只等配额耗尽

目标：让转化触发发生在“用户已经感到价值，但还没形成稳定习惯”的时点，而不是纯硬拦。

### 需要的 DB 变更

无强制新增表，复用 `SubscriptionTriggerLogs` 即可。见 `apps/api-server/prisma/schema.prisma:1999-2025`。

### 需要的 API 变更

1. 在以下接口响应中补 `upgradeHint`：
   - `POST /api/app/food/analyze-save`
   - `GET /api/app/food/summary/today`
   - `GET /api/app/food/summary/recent`
2. `GET /api/app/subscription/quota-status` 增加：
   - `recommendedUpgradeMoment`
   - `triggerReason`

### 需要的服务逻辑变更

1. 基于现有 `PaywallTriggerService.recordTrigger()` 增加新的触发场景：
   - `first_progress_gap`
   - `execution_tracking_locked`
   - `weekly_trend_locked`
2. 不改 `RevenueCat` 主架构，只在服务端把这些触发写库并返回前端展示信息。

### 需要的客户端行为

1. 当用户已连续 2 天记录，但看不到趋势/周计划/行为洞察时，展示软升级卡。
2. 不阻断核心记录和分析，只强调“继续用会更准/更连续”。

### 预期影响

1. 付费触发从“配额被打断”升级为“增长感缺口”。
2. 更适合健康习惯产品，而不是纯工具型 API 产品。

## 8. Monetization Trigger Analysis

## 8.1 当前真正能触发订阅的点

当前最真实的触发点只有两类：

1. `额度耗尽`：`AI_IMAGE_ANALYSIS`、`AI_TEXT_ANALYSIS`、`AI_COACH` 等。见 `QuotaGateService`。
2. `能力锁定`：如 `WEEKLY_PLAN`、`BEHAVIOR_ANALYSIS` 这类 `RequireFeature` 功能。见 `apps/api-server/src/modules/diet/app/controllers/food-plan.controller.ts:134-148`、`apps/api-server/src/modules/diet/app/controllers/food-behavior.controller.ts:35-48`。

## 8.2 为什么当前变现偏弱

1. 分析结果已不再裁剪，软转化点减弱。
2. 用户在免费版里最容易先得到“单次有用答案”，但不一定迅速撞到硬痛点。
3. 如果没有形成连续记录，用户还没走到需要周趋势、行为分析、教练强化时就先流失了。

换句话说：`你当前的付费点更像“高级工具权限”，不是“持续结果权限”。`

## 8.3 更合适的触发时机

建议时机：

1. 第 2 次或第 3 次成功记录后，用户第一次打开 `summary/recent` 时。
2. 用户连续两天记餐，但没有周视角、趋势解释、行为洞察时。
3. 用户开始频繁替换推荐或多次收到 caution/avoid 时，提示“升级到更个性化精度”。

## 8.4 Feature gating 逻辑建议

保持现有架构即可：

1. 核心记录与基础分析继续免费。
2. 付费增强放在：
   - 周计划 `WEEKLY_PLAN`
   - 行为画像 `BEHAVIOR_ANALYSIS`
   - 更强解释/替代建议
   - 趋势洞察与精度升级
3. 所有放行仍走 `SubscriptionService + UserEntitlement + QuotaGateService`。

## 8.5 RevenueCat 集成点

现有服务端结构已足够，不需要大改：

1. 购买成功后，继续走 `RevenueCatSyncService.triggerSyncForUser()`。
2. 在订阅状态变更成功处补调用 `PaywallTriggerService.markConverted()`，把触发日志真正回写成转化。
3. 前端继续以后端 `quota-status` 为真相源，不直接依赖本地 SDK 状态。

## 9. 用户 3 天流失模拟

## Day 1

1. 用户注册/匿名升级后进入应用。
2. 最可能先用的是文本分析或图片分析。
3. 他看到了一个“这顿吃得怎么样”的结果。

为什么还没稳住：

1. 如果是图片分析，保存为正式记录还要多一步。
2. 如果是文本分析，结果默认不沉淀。
3. 用户还没建立“这个 App 会记住我、明天会更懂我”的感觉。

## Day 2

1. 用户再回来时，期望看到昨天带来的连续价值。
2. 但如果昨天没保存记录，今天几乎没有进展积累。
3. 即使有记录，也未必有明显 streak/challenge 正反馈。

为什么开始流失：

1. 推荐可能还是“看起来智能”，但不一定明显更贴合昨天行为。
2. 没有清晰强化：“你已经连续 2 天、你今天比昨天更好、你现在离目标还有多少”。

## Day 3

1. 用户会开始问：这个产品除了单次判断，还有什么复利？
2. 如果回答仍然只是“继续拍照/继续分析”，而不是“越用越准、越记越成体系”，就会自然流失。

流失点通常发生在：

1. 分析结果页没有进入正式记录时。
2. 记录后看不到连续奖励时。
3. 推荐没有表现出明显学习感时。

缺失的信号：

1. 推荐执行信号。
2. AI 决策后效信号。
3. 触发到转化信号。
4. 保存分析到正式记录的漏斗信号。

## 10. 优先级输出

## 🔥 Must fix before growth

1. 打通 `分析结果 -> FoodRecords -> DailySummaries` 的保存闭环，至少让图片分析保存幂等化并回传进展变化。
2. 真正接入 `RecommendationExecutions`，让推荐能知道“是否被执行”。
3. 在分析主链里写 `AiDecisionLogs`，否则 `decision-feedback` 只是空设计。
4. 把 `PaywallTriggerService.markConverted()` 接到真实订阅成功链路，补齐转化归因。

## ⚡ High ROI quick wins

1. `RecommendationFeedbackDto` 增加 `traceId/executionId`，这是很小改动，但会显著提升归因质量。
2. `analyze-save` 返回 `todaySummary + delta + streakPreview`，用户会立即感知价值沉淀。
3. 文本分析增加“保存为今天这餐”的轻量入口，降低文本链路的数据流失。
4. 在 `summary/recent` 或 `behavior-profile` 的锁定场景做软升级提示，不要只等额度打光。

## 🧠 Structural improvements

1. 统一 streak/challenge/achievement 的事件入口，全部挂在 `MEAL_RECORDED` 和“日终评估”上，不要分散在多个 service 里各自存在一套逻辑。
2. 将“分析、推荐、教练”的后验效果统一进用户画像，减少功能各自学习、彼此不共享的问题。
3. 让订阅卖点从“更多次数”升级为“更连续的结果系统”。

## 11. Bonus：必须明确指出的问题

## 11.1 过度工程化

当前代码里已经有：

1. `RecommendationTraces`
2. `RecommendationExecutions`
3. `AbExperiments`
4. `StrategyAssignment`
5. `StrategyTuningLog`
6. `SubscriptionTriggerLogs`
7. `Achievements` / `Challenges`

但核心增长问题不是“缺算法层”，而是“主行为闭环没有接好”。

直接说：`现在的系统在增长层面偏重“可观测性和可调优能力”，轻“结果沉淀和行为强化”。`

## 11.2 缺少核心增长层

真正缺的是这层：

`一次有用 -> 形成记录 -> 形成今天进展 -> 形成连续奖励 -> 形成更准推荐 -> 再触发付费`

这层目前并不完整。

## 11.3 产品方向风险

如果继续把重点放在：

1. 更复杂的推荐策略
2. 更多 trace 字段
3. 更多实验配置

而不先补“保存、执行、后验、强化、转化”五个闭环，增长会继续卡住。

原因不是 AI 不够强，而是用户没有感受到“我每次使用都在积累长期收益”。
