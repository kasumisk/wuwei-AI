# EatCheck 订阅系统生产级架构设计

> 适用范围：NestJS 后端 + Flutter 客户端 + 管理后台
> 
> 前提：客户端已接入 RevenueCat，支付平台为 Apple App Store / Google Play
> 
> 目标：高可靠、可扩展、可审计、审核安全、可运营

## 0. 结论先行

当前如果你的移动端已经接入 RevenueCat，那么最合理的生产方案不是“只依赖 RevenueCat”，也不是“RevenueCat + Apple/Google + 客户端三方同时各自改状态”，而是：

1. RevenueCat 继续作为移动订阅聚合层。
2. 你的 NestJS 后端必须成为 App 内权限放行的最终判定方。
3. RevenueCat Webhook 必须成为服务端实时同步主入口。
4. RevenueCat REST API 定时对账必须存在，作为 Webhook 丢失和状态漂移的修复机制。
5. Flutter 客户端只能做购买触发和同步兜底，不能作为订阅真相源。
6. 管理后台必须基于你的内部订阅表和事件表做审计、纠偏、分析，不能直接拿 RevenueCat SDK 状态当运营依据。

当前仓库里的订阅实现已经暴露出一个关键风险：代码并不是“纯 RevenueCat 架构”，而是仍保留了 Apple 原生校验和 Apple S2S 处理链路：

1. `apps/api-server/src/modules/subscription/app/payment/apple-iap.service.ts`
2. `apps/api-server/src/modules/subscription/app/controllers/apple-iap.controller.ts`
3. `apps/api-server/src/modules/subscription/app/services/subscription.service.ts`

如果 Flutter 端现在实际上走的是 RevenueCat 购买，而后端又继续接 Apple 原生通知并直接修改内部订阅状态，那么你已经处于“双事件源 + 双状态写入”的危险区。生产级设计里，必须明确唯一 authoritative flow。

补充核实结果：Flutter 仓库 `/Users/xiehaiji/project/kasumi/flutter/flutter-scaffold` 已确认接入 RevenueCat，关键文件如下：

1. `lib/modules/subscription/services/purchases_service.dart`
2. `lib/modules/subscription/providers/subscription_provider.dart`
3. `lib/modules/subscription/view/subscription_page.dart`
4. `lib/modules/subscription/repositories/subscription_repository.dart`
5. `lib/app.dart`

这说明当前真实架构是：

1. Flutter 用 RevenueCat SDK 发起购买。
2. Flutter 用后端 `/app/subscription/quota-status` 作为会员业务真相。
3. iOS 购买成功后，Flutter 还会额外调用后端 `/app/subscription/apple/verify`。

也就是说，你当前不是“只依赖 RevenueCat”，而是“RevenueCat 客户端购买 + 后端 Apple 原生 verify + 后端本地 subscription 表判权”的混合模式。

补充说明：当前 Flutter 里的 anonymous 模式已确认只是提审使用，不属于正式生产模式。因此文档中关于匿名模式的风险，应理解为“提审路径与生产路径需要严格隔离”，而不是“你打算在生产长期开放匿名购买”。

推荐结论：

1. 短中期继续使用 RevenueCat，不建议现在绕过。
2. 但不要让 RevenueCat 成为唯一真相源，内部数据库必须落地完整订阅状态和事件审计。
3. 不建议当前阶段同时把 Apple/Google 原生通知作为主处理源接入，否则复杂度和错乱概率会上升。
4. 如果未来 GMV、风控、财务对账、促销复杂度明显上升，再评估部分脱离 RevenueCat。

## 1. 当前架构评估

### 1.1 “只依赖 RevenueCat”是否合理

可以依赖 RevenueCat 做以下事情：

1. Flutter 购买流程封装。
2. Apple / Google 收据聚合与兼容处理。
3. entitlement 聚合。
4. 跨平台恢复购买。
5. 基础订阅状态查询。

但不应该只依赖 RevenueCat 做以下事情：

1. App 内最终权限判定。
2. 审计留痕。
3. 管理后台运营视图。
4. 风控和异常恢复。
5. 历史事件追踪。
6. 财务级别对账。

原因很直接：RevenueCat 是优秀的订阅聚合层，但不是你的业务系统主数据库。只靠 RevenueCat，最终会在以下场景出问题。

### 1.2 只依赖 RevenueCat 的具体风险场景

#### 场景 A：Webhook 延迟或丢失

问题：用户已经支付成功，但你的后端没及时感知，用户无法立即使用付费权益，或者退款后依然长期可用。

后果：漏单、误封、放行错误。

必须措施：Webhook + 定时校验 + 客户端触发刷新三层兜底。

#### 场景 B：客户端状态比服务端快

问题：Flutter 端 `CustomerInfo` 已更新，但后端缓存或数据库还没更新。

后果：客户端显示已订阅，服务端接口仍返回 free；或者反过来，客户端显示 free，但后端已开通。

必须措施：购买完成后客户端立即调用后端同步接口；后端拉 RevenueCat 最新快照；服务端权限以内部表为准。

#### 场景 C：用户换账号 / 恢复购买 / 匿名 ID 污染

问题：RevenueCat `appUserID` 绑定策略设计不好，购买可能错误归属到匿名用户、旧账号或错误账号。

后果：刷订阅、串号、恢复购买归属错误。

必须措施：购买前必须登录；RevenueCat `appUserID` 必须使用后端用户主键；禁止把匿名设备 ID 当长期账号标识。

#### 场景 D：升级 / 降级 / 跨平台恢复导致链路错乱

问题：同一 entitlement 下，月订阅切年订阅、iOS 买后 Android 恢复、Google base plan 变化时，如果你只存“当前是否会员”，就丢失完整链路。

后果：无法审计，无法纠错，无法解释用户为什么是当前状态。

必须措施：保留原始事件表、交易表、订阅聚合表。

#### 场景 E：退款 / 撤销 / 计费宽限期处理不精确

问题：RevenueCat 已感知退款或撤销，但你的系统只认客户端缓存，或者只认本地 `expiresAt`。

后果：已退款用户继续使用高级能力。

必须措施：后端收到退款/撤销事件后立即刷新内部状态并失效缓存。

#### 场景 F：管理后台无法回答“为什么这个用户有权限”

问题：当前库里只有 `subscription`、`payment_records`、`usage_quota` 这类结果表，没有真正完整的订阅事件链。

后果：运营和客服无法审计，技术无法快速追根溯源。

必须措施：增加事件日志表和交易表。

### 1.3 是否需要接入 Apple / Google 原生通知

我的建议分阶段：

#### 当前阶段

不建议把 Apple App Store Server Notifications / Google RTDN 再接成主处理链路。

原因：

1. 你已经用了 RevenueCat，它本身就是聚合层。
2. 再接原生通知会形成双源写状态。
3. 你当前后端已经有 Apple 原生逻辑，再叠 RevenueCat 主链会更容易冲突。

当前更优做法：

1. 以 RevenueCat Webhook 为主事件源。
2. 以 RevenueCat REST API 为校准源。
3. 内部 DB 为业务权限真相源。

#### 未来阶段

只有在以下情况，才建议额外引入 Apple / Google 原生通知，且默认作为 shadow source，而不是直接改业务状态：

1. 你的订阅收入规模很大，必须做 store 级灾备。
2. 你要做 RevenueCat 风险隔离，防止单供应商故障。
3. 你需要更细粒度的 store 原始字段，用于财务和风控。

如果引入，也建议：

1. 原生通知先落库。
2. 不直接修改最终订阅状态。
3. 仅用于比对 RevenueCat 快照和异常告警。

## 2. 当前代码里的潜在坑

以下风险不是抽象问题，而是当前仓库代码已经能看到的具体坑。

### 2.1 当前后端仍在直接处理 Apple 原生订阅

相关文件：

1. `apps/api-server/src/modules/subscription/app/controllers/apple-iap.controller.ts`
2. `apps/api-server/src/modules/subscription/app/payment/apple-iap.service.ts`

风险：如果 Flutter 端实际上已经通过 RevenueCat 发起购买，那么后端又接收 Apple 原生回调并直接改状态，就会和 RevenueCat 同时写同一用户的订阅状态。

结论：必须明确一个主链。既然你已接 RevenueCat，生产方案应把 Apple 原生链从“主状态源”降级为“历史兼容或未来 shadow source”。

### 2.1.1 Flutter 端 iOS 购买后还在走 `/app/subscription/apple/verify`

相关文件：

1. `flutter-scaffold/lib/modules/subscription/view/subscription_page.dart:116`
2. `flutter-scaffold/lib/modules/subscription/repositories/subscription_repository.dart:28`

现状：

1. Flutter 先调用 `Purchases.purchase(...)`。
2. 如果是 iOS，再拿 `transactionIdentifier` 和 `productIdentifier` 调后端 `/app/subscription/apple/verify`。

风险：

1. RevenueCat 和 Apple 原生后端验证同时参与激活逻辑。
2. iOS 和 Android 行为不对称。
3. 未来切到 RevenueCat webhook 主链后，这个接口会成为重复写入入口。

结论：生产化后应移除这个客户端后置 `apple/verify` 主链调用，统一改成 `sync-trigger` 模式。

### 2.1.2 Flutter 启动时匿名配置 RevenueCat，登录后再 `logIn`

相关文件：

1. `flutter-scaffold/lib/app.dart:100`
2. `flutter-scaffold/lib/modules/subscription/services/purchases_service.dart:10`
3. `flutter-scaffold/lib/modules/subscription/providers/subscription_provider.dart:23`

现状：

1. App bootstrap 时先 `PurchasesService.configure()`，没有传 `appUserId`。
2. 用户登录后再调用 `Purchases.logIn(userId)`。
3. 用户退出时调用 `Purchases.logOut()` 回到匿名用户。

风险：

1. 如果提审包和生产包使用同一套 RevenueCat project / entitlement / webhook 环境，容易产生 anonymous alias 链污染正式数据。
2. restore / transfer 策略不当时更容易串号。
3. 审核环境如果真的发生购买或恢复动作，会给归属追踪和测试数据清理增加复杂度。

结论：生产环境必须保证购买入口只对已登录用户开放，并把 `appUserID = backend userId` 作为强约束。

补充判断：如果匿名模式仅用于提审，这本身不是生产问题，但要满足两个前提：

1. 提审环境与正式生产环境隔离，至少隔离 RevenueCat project、store product、webhook 或 backend 环境。
2. 正式生产包不能保留匿名购买入口。

### 2.1.3 Flutter `restorePurchases()` 后没有通知后端强制重同步

相关文件：`flutter-scaffold/lib/modules/subscription/view/subscription_page.dart:195`

现状：restore 后只做了：

1. `Purchases.restorePurchases()`
2. 刷新 `subscriptionNotifierProvider`
3. 刷新 `quotaStatusProvider`

风险：

1. 如果后端未及时收到 RevenueCat webhook，`quota-status` 仍可能是旧状态。
2. 用户在 restore 成功后可能短时间看到错误权益。
3. 缺少显式服务端同步触发点。

结论：restore 后必须调用后端 `sync-trigger`。

### 2.1.4 Flutter 客户端仍有单 entitlement 硬编码

相关文件：`flutter-scaffold/lib/modules/subscription/services/purchases_service.dart:6`

现状：客户端使用 `const entitlementId = 'ShouldIEat Pro';`，并通过 `isPro()` 判断是否拥有该 entitlement。

风险：

1. entitlement 命名与 EatCheck 当前 tier/plan 模型耦合不清。
2. 未来扩展 `premium`、多权益包、活动 entitlement 时容易失效。
3. 客户端判断逻辑和后端 `quota-status` 容易分叉。

结论：客户端可保留 RevenueCat entitlement 仅用于 UI 辅助，但业务展示应以后端返回的 tier / accessState / entitlements 为主。

### 2.1.5 Flutter 已经明确写了“会员真相来自后端”

相关文件：`flutter-scaffold/lib/modules/subscription/providers/subscription_provider.dart:48`

现状：代码注释明确写着：`Membership truth comes from backend quota-status tier, not local RevenueCat cache.`

这是正确方向，但当前实现还没把购买后同步链闭环补齐。

### 2.2 `createSubscription()` 是“先失效旧订阅，再创建新订阅”模型

相关文件：`apps/api-server/src/modules/subscription/app/services/subscription.service.ts:164`

风险：

1. 对升级 / 降级 / 恢复购买不够精细。
2. 对同一 entitlement 下的换商品、跨平台恢复不够友好。
3. 对多订阅产品并存扩展性差。

生产级方案应改为：

1. 一条“订阅聚合记录”表示一条订阅链。
2. 交易与事件分开记录。
3. 当前有效产品只是聚合状态，不是历史本体。

### 2.3 `renewSubscription(userId, newExpiresAt)` 按用户找最近订阅更新

相关文件：`apps/api-server/src/modules/subscription/app/services/subscription.service.ts:262`

风险：

1. 不是按 store subscription chain 更新。
2. 未来多产品、多 entitlement、多平台时会误更新。
3. 不能正确表达 upgrade/downgrade 的链路。

生产级方案必须按 `provider_subscription_key` 或 `store_original_transaction_id / purchase_token` 处理，而不是按 `userId` 模糊处理。

### 2.4 Apple Webhook 失败后仍返回 200

相关文件：`apps/api-server/src/modules/subscription/app/controllers/apple-iap.controller.ts:85`

现状：处理失败后仍返回 `{ status: 'error_logged' }`，HTTP 200。

风险：

1. 上游不会重试。
2. 一次异常就可能永久漏事件。

这在生产中是高风险设计。Webhook 主链必须满足：

1. 成功落库后再返回 200。
2. 未成功落库必须返回非 2xx，让上游重试。

### 2.5 缺少持久化幂等事件表

现状：Apple 通知去重依赖缓存，缺少专用事件表。

风险：

1. 进程重启后无法可靠判断历史是否处理过。
2. 无法重放。
3. 无法审计。

生产级必须新增：

1. `billing_webhook_events`
2. `subscription_transactions`
3. `subscription_audit_logs`

### 2.6 当前 `subscription` 表字段不足以支撑 RevenueCat 生产化

现状：`subscription` 表没有以下关键字段：

1. RevenueCat event id
2. RevenueCat app user id
3. store 环境
4. entitlement code
5. 当前 store product id
6. 原始 store 链路 key
7. 最后同步时间
8. 最后状态来源
9. 退款/撤销原因
10. sandbox / production 区分

结果：你现在的模型更像“本地会员结果表”，不是“可审计的生产级订阅模型”。

### 2.7 当前计划表没有 Google / RevenueCat 维度映射

现状：`subscription_plan` 只有 `appleProductId`、`wechatProductId`。

风险：

1. Google Play 产品映射不完整。
2. RevenueCat entitlement / package / offering 无法表达。
3. 活动价、不同 store SKU、不同 base plan 不好建模。

## 3. 生产级目标架构

### 3.1 角色划分

#### Flutter 客户端

职责：

1. 展示 paywall。
2. 发起购买、恢复购买。
3. 读取 RevenueCat SDK 的本地状态做 UI 快速反馈。
4. 主动触发后端刷新。

不负责：

1. 最终权限判定。
2. 最终订阅真相存储。

#### RevenueCat

职责：

1. 聚合 Apple / Google Store 状态。
2. 提供购买 SDK。
3. 提供 Webhook 事件。
4. 提供 Subscriber / CustomerInfo 查询接口。

不负责：

1. 你的业务权限数据库。
2. 运营审计后台。
3. 最终业务风控规则。

#### NestJS 后端

职责：

1. 接收 RevenueCat Webhook。
2. 拉取 RevenueCat 最新订阅快照。
3. 维护内部订阅聚合表、交易表、事件表。
4. 为 App API 提供最终 entitlement 判定。
5. 为管理后台提供审计、对账、纠偏能力。

#### 管理后台

职责：

1. 查看用户当前订阅状态。
2. 查看完整事件时间线。
3. 手动触发 resync。
4. 手动补偿赠送、冻结、备注。
5. 观察漏单、延迟、退款、转化数据。

### 3.2 生产级数据流

```text
Flutter App
  -> 登录后拿到 backend userId
  -> RevenueCat SDK configure(appUserID = backend userId)
  -> 发起 purchase / restore
  -> RevenueCat 返回 CustomerInfo 给客户端
  -> 客户端调用 NestJS /app/subscription/sync-trigger

RevenueCat
  -> POST webhook 到 NestJS /billing/revenuecat/webhook

NestJS
  -> 校验 webhook secret
  -> 原始事件落库 billing_webhook_events
  -> 入队 subscription-sync job
  -> Worker 调 RevenueCat REST API 拉取该用户最新 subscriber snapshot
  -> 在事务中更新：subscription / subscription_transactions / subscription_audit_logs
  -> 失效缓存
  -> 更新 user entitlements summary

Admin
  -> 读取内部 subscription aggregate + event timeline
```

### 3.3 核心设计原则

1. 实时事件只负责触发同步，不直接盲信事件本身改最终状态。
2. 最终状态以“拉取的最新 RevenueCat 快照 + 内部状态机”合并得出。
3. 原始事件永远保留，不覆盖。
4. 订阅当前态、交易历史、原始事件必须分层建模。
5. App 接口判权一律读内部表，不直接实时请求 RevenueCat。

## 4. Webhook 设计

### 4.1 Webhook 接入方式

推荐新增专用入口：`POST /billing/revenuecat/webhook`

要求：

1. HTTPS。
2. 校验 RevenueCat 自定义 Authorization Secret。
3. 限制请求体大小。
4. 完整保存原始 JSON。

### 4.2 Webhook 处理流程

#### 同步入口层

只做四件事：

1. 校验 secret。
2. 提取 event id、app_user_id、event type、store、transaction id。
3. 将原始 payload 插入 `billing_webhook_events`。
4. 投递异步 job，返回 200。

注意：只有“成功落库”后才能返回 200。

#### 异步处理层

处理步骤：

1. 按事件 id 加锁。
2. 如果该事件已 `processed`，直接结束。
3. 读取 RevenueCat API 的最新 subscriber/customer 快照。
4. 将快照映射到内部 entitlement 和订阅聚合。
5. 在单个数据库事务里完成：
   - upsert `subscription`
   - insert `subscription_transactions`
   - insert `subscription_audit_logs`
   - update `billing_webhook_events.processed_at`
6. 失效用户订阅缓存。
7. 发布内部 `subscription.changed` 领域事件。

### 4.3 为什么不能只根据 Webhook payload 直接改状态

因为 Webhook 有以下天然问题：

1. 可能乱序。
2. 可能重试。
3. 可能延迟。
4. 可能部分字段不足以表达当前完整 entitlement 状态。

所以正确做法是：Webhook 负责触发，最终状态由“最新快照”收敛。

### 4.4 Webhook 事件表必须保存的字段

表名建议：`billing_webhook_events`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `provider` | enum | `revenuecat` |
| `provider_event_id` | varchar(128) | RevenueCat 事件唯一 ID，唯一索引 |
| `event_type` | varchar(64) | 如 initial_purchase / renewal / cancellation / uncancellation / expiration / refund |
| `app_user_id` | varchar(128) | RevenueCat app user id |
| `original_app_user_id` | varchar(128) | 原始归属账号 |
| `aliases` | jsonb | RevenueCat aliases |
| `store` | varchar(32) | `app_store` / `play_store` |
| `environment` | varchar(16) | `sandbox` / `production` |
| `product_id` | varchar(256) | RevenueCat / store product id |
| `entitlement_ids` | jsonb | entitlement 列表 |
| `transaction_id` | varchar(256) | 当前交易 id |
| `original_transaction_id` | varchar(256) | 订阅链原始 id |
| `event_timestamp` | timestamptz | 事件原始发生时间 |
| `received_at` | timestamptz | 你的系统收到时间 |
| `processing_status` | varchar(32) | `pending` / `processing` / `processed` / `failed` / `dead_letter` |
| `retry_count` | int | 重试次数 |
| `last_error` | text | 最近一次失败原因 |
| `processed_at` | timestamptz | 处理完成时间 |
| `raw_payload` | jsonb | 原始 webhook |

索引建议：

1. unique(`provider`, `provider_event_id`)
2. index(`app_user_id`, `event_timestamp desc`)
3. index(`processing_status`, `received_at`)
4. index(`original_transaction_id`)

## 5. 是否需要定时校验

必须需要。

原因：Webhook 从来不是 100% 可靠链路，尤其生产环境不能把权限系统押在单一推送机制上。

### 5.1 推荐定时任务设计

#### 任务 A：近期变更用户快速校验

频率：每 10 到 15 分钟一次

对象：

1. 最近 48 小时收到过 webhook 的用户
2. 最近 48 小时完成购买或 restore 的用户
3. 当前处于 grace period / billing issue / refunded 边缘状态的用户

动作：调用 RevenueCat API 拉最新 subscriber snapshot，对内部状态做纠偏。

#### 任务 B：全量活跃付费用户巡检

频率：每 6 到 12 小时一次

对象：所有非 expired 的订阅聚合记录。

动作：

1. 拉取 RevenueCat 状态。
2. 比对 period end、will renew、entitlement active。
3. 发现偏差自动修复并记录审计日志。

#### 任务 C：每日异常审计

频率：每天一次

检查项：

1. 内部为 active，但 RevenueCat 已无 active entitlement
2. 内部为 free，但 RevenueCat 仍有 active entitlement
3. 有 payment / transaction 但没有对应订阅聚合
4. webhook failed backlog

### 5.2 不建议使用本地猜测过期逻辑代替对账

当前 `SubscriptionService.processExpiredSubscriptions()` 里是根据本地 `expiresAt`、`autoRenew` 去推导宽限期和过期。

这对于自营支付可接受，但对 Apple / Google 订阅并不精确，因为：

1. 宽限期是否存在由 store 决定。
2. 计费重试时间不应由本地硬编码推断。
3. 退款、撤销、价格同意、暂停等状态都不是单靠 `expiresAt` 能表达。

生产级方案里，本地 cron 只能做“纠偏”和“状态回收”，不能替代 RevenueCat / store 的事实状态。

## 6. 是否需要客户端兜底

必须需要，但客户端兜底不是客户端自己判定最终权限。

### 6.1 客户端必须做的事情

#### 购买成功后

1. 立刻调用 `Purchases.getCustomerInfo()`。
2. 立刻调用后端 `POST /app/subscription/sync-trigger`。
3. 后端异步拉 RevenueCat 最新状态。
4. 客户端轮询或短轮询 `GET /app/subscription/status`，直到后端状态更新。

对你当前 Flutter 实现的直接调整建议：

1. 保留 `Purchases.purchase(...)`。
2. 删除 iOS 专属的 `/app/subscription/apple/verify` 后置激活链。
3. 增加统一的 `/app/subscription/sync-trigger` 调用。
4. `sync-trigger` 后刷新 `/app/subscription/quota-status`。

#### App 启动 / 回到前台时

1. 调用 `Purchases.getCustomerInfo()` 做本地刷新。
2. 调用后端 `GET /app/subscription/status` 获取服务端最终状态。
3. 如果本地 RC 状态与后端状态差异明显，调用 `sync-trigger`。

#### restore purchases 后

必须再调用一次 `sync-trigger`，不能只更新本地 UI。

对你当前 Flutter 代码，这一点是明确缺失项。

### 6.2 客户端不应该做的事情

1. 直接根据 RevenueCat SDK 本地 entitlement 决定所有受保护 API 是否放行。
2. 仅凭客户端缓存长期放权。
3. 不通知后端就认为购买已完成。

## 7. 异常恢复机制

### 7.1 Webhook 丢失

恢复手段：

1. 定时任务扫描最近活跃订阅。
2. 客户端启动 / 购买后触发 `sync-trigger`。
3. 管理后台支持手动 resync。

### 7.2 Webhook 处理失败

恢复手段：

1. `billing_webhook_events.processing_status = failed`
2. 后台任务自动重试
3. 超过阈值进入 `dead_letter`
4. 管理后台人工重放

### 7.3 RevenueCat API 临时异常

恢复手段：

1. job 指数退避重试
2. 失败期间不轻易做 destructive downgrade
3. 若用户刚购买成功，允许短时“待确认中”状态，而不是直接 free

### 7.4 内部状态错乱

恢复手段：

1. 以 RevenueCat 最新快照做全量收敛
2. 保留全部原始事件，支持重放
3. 管理后台提供“按用户重建订阅状态”操作

## 8. 数据库设计

下面不是抽象模型，而是一套能支持你当前移动订阅场景且可演进的实际模型。

### 8.1 建模原则

1. `subscription` 保存当前聚合态。
2. `subscription_transactions` 保存每次交易周期变化。
3. `billing_webhook_events` 保存原始外部事件。
4. `subscription_products` 保存可售卖商品，不把商品信息硬编码在 plan 上。
5. `entitlements` 和 `product_entitlements` 解耦产品与权益。

### 8.2 `subscription` 表结构

建议保留现有 `subscription` 表名，但升级字段。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `user_id` | uuid | 内部用户 ID |
| `provider` | varchar(32) | `revenuecat` / `manual` |
| `provider_customer_id` | varchar(128) | RevenueCat app user id，建议等于 backend userId |
| `entitlement_code` | varchar(64) | 如 `pro_access` |
| `status` | varchar(32) | `active` / `grace_period` / `cancelled` / `expired` / `refunded` / `revoked` / `paused` |
| `access_state` | varchar(32) | `has_access` / `no_access`，用于业务快速判权 |
| `store` | varchar(32) | `app_store` / `play_store` / `manual` |
| `environment` | varchar(16) | `sandbox` / `production` |
| `current_product_id` | uuid | 当前内部商品 ID |
| `store_product_id` | varchar(256) | 当前 store SKU |
| `provider_subscription_key` | varchar(256) | 订阅链唯一键，Apple 可用 `original_transaction_id`，Google 可用 purchase token 根键 |
| `latest_transaction_id` | varchar(256) | 最近一次交易 id |
| `original_transaction_id` | varchar(256) | Apple 原始交易链 id |
| `purchase_token` | varchar(512) | Google purchase token |
| `started_at` | timestamptz | 订阅首次开始时间 |
| `current_period_start_at` | timestamptz | 当前计费周期开始 |
| `current_period_end_at` | timestamptz | 当前计费周期结束 |
| `grace_period_end_at` | timestamptz | 宽限期结束时间 |
| `cancelled_at` | timestamptz | 用户关闭自动续费时间 |
| `refunded_at` | timestamptz | 退款时间 |
| `revoked_at` | timestamptz | 撤销时间 |
| `will_renew` | boolean | 是否会自动续费 |
| `billing_issue_detected` | boolean | 是否存在扣款问题 |
| `ownership_type` | varchar(32) | `purchased` / `family_shared` 等，按 RevenueCat 可用字段保存 |
| `last_provider_event_at` | timestamptz | 最近收到外部事件时间 |
| `last_synced_at` | timestamptz | 最近向 RevenueCat 校准时间 |
| `state_version` | bigint | 每次状态变更递增 |
| `last_event_id` | varchar(128) | 最后处理的 RevenueCat 事件 id |
| `metadata` | jsonb | 扩展字段 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

关键索引：

1. unique(`provider`, `provider_subscription_key`)
2. index(`user_id`, `entitlement_code`, `access_state`)
3. index(`status`, `current_period_end_at`)
4. index(`last_synced_at`)

如果你的 App 当前只有一个核心付费权益，也建议仍保留 `entitlement_code`，不要把 `tier` 硬塞到 `subscription` 表里。这样未来扩展 meal plan、coach、report pack 等多权益商品时不用重构。

### 8.3 `subscription_products` 表

该表替代把 store 商品字段直接堆在 `subscription_plan` 上。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `product_code` | varchar(64) | 内部商品编码，如 `pro_monthly` |
| `name` | varchar(128) | 商品名 |
| `tier` | varchar(32) | `free` / `pro` / `premium` |
| `store` | varchar(32) | `app_store` / `play_store` |
| `store_product_id` | varchar(256) | App Store / Play SKU |
| `revenuecat_product_id` | varchar(256) | RevenueCat product identifier |
| `revenuecat_entitlement_code` | varchar(64) | RevenueCat entitlement |
| `revenuecat_offering_id` | varchar(64) | offering id |
| `revenuecat_package_id` | varchar(64) | package id |
| `billing_period_unit` | varchar(16) | `month` / `year` |
| `billing_period_count` | int | 1 / 12 |
| `subscription_group` | varchar(64) | 同组商品标识，用于 upgrade/downgrade |
| `base_price_cents` | int | 标准价 |
| `currency` | varchar(8) | 货币 |
| `is_active` | boolean | 是否可售 |
| `sort_order` | int | 排序 |
| `metadata` | jsonb | base plan id、offer id 等 |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间 |

### 8.4 `entitlements` 表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `code` | varchar(64) | 如 `pro_access` / `premium_access` |
| `name` | varchar(128) | 名称 |
| `description` | text | 描述 |
| `is_active` | boolean | 是否启用 |
| `metadata` | jsonb | 备注 |

### 8.5 `product_entitlements` 映射表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `product_id` | uuid | 关联 `subscription_products.id` |
| `entitlement_id` | uuid | 关联 `entitlements.id` |
| `grant_config` | jsonb | 可直接存 EatCheck 的 entitlements JSON |
| `created_at` | timestamptz | 创建时间 |

这样做的好处：

1. 月订阅 / 年订阅可以映射到同一个 entitlement。
2. iOS / Android 不同 SKU 也可以映射到同一个 entitlement。
3. 一个商品理论上也可以映射多个 entitlement。

### 8.6 `subscription_transactions` 表

这是生产级审计关键表。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `subscription_id` | uuid | 关联 `subscription.id` |
| `provider` | varchar(32) | `revenuecat` |
| `provider_event_id` | varchar(128) | 触发本交易的 webhook event id |
| `transaction_type` | varchar(32) | `initial_purchase` / `renewal` / `product_change` / `refund` / `revoke` / `expiration` |
| `store` | varchar(32) | 平台 |
| `store_product_id` | varchar(256) | 当次商品 |
| `transaction_id` | varchar(256) | 当前交易 id，唯一索引 |
| `original_transaction_id` | varchar(256) | 原始链路 id |
| `purchase_token` | varchar(512) | Google token |
| `purchased_at` | timestamptz | 购买时间 |
| `effective_from` | timestamptz | 周期开始 |
| `effective_to` | timestamptz | 周期结束 |
| `amount_cents` | int | 金额 |
| `currency` | varchar(8) | 货币 |
| `status` | varchar(32) | `success` / `refunded` / `revoked` |
| `raw_snapshot` | jsonb | 拉取时的原始 RevenueCat 交易快照 |
| `created_at` | timestamptz | 创建时间 |

### 8.7 `subscription_audit_logs` 表

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | uuid | 主键 |
| `subscription_id` | uuid | 关联 `subscription.id` |
| `actor_type` | varchar(32) | `system` / `webhook` / `cron` / `admin` / `client_trigger` |
| `actor_id` | varchar(128) | 管理员 id 或 event id |
| `action` | varchar(64) | `activate` / `renew` / `cancel` / `expire` / `refund` / `grant` / `resync` |
| `before_state` | jsonb | 变更前快照 |
| `after_state` | jsonb | 变更后快照 |
| `reason` | text | 原因说明 |
| `created_at` | timestamptz | 创建时间 |

### 8.8 如何支持月订阅 / 年订阅 / 多产品 / 升降级 / 跨平台

#### 月订阅 / 年订阅

通过 `subscription_products` 的 `billing_period_unit` + `billing_period_count` 区分。

示例：

1. `pro_monthly_ios`
2. `pro_yearly_ios`
3. `pro_monthly_android`
4. `pro_yearly_android`

它们都映射到同一个 entitlement：`pro_access`。

#### 多产品

不要把产品等同于 tier。

正确做法：

1. `product_code` 表示售卖项。
2. `entitlement_code` 表示能力权限。
3. 一个 entitlement 下可有多个 product。

#### 升级 / 降级

升级 / 降级不是“删除旧订阅再新建订阅”，而是：

1. 保持同一 `provider_subscription_key` 订阅链。
2. `subscription.current_product_id` 切换到新商品。
3. 插入一条 `subscription_transactions.transaction_type = product_change`。
4. 保留原周期、proration、即时生效或下周期生效信息到 `raw_snapshot` / `metadata`。

#### 跨平台

前提：同一用户在 iOS / Android 登录的是同一个 EatCheck 账号，RevenueCat `appUserID` 也一致。

则：

1. `subscription.user_id` 唯一表示业务用户。
2. `subscription.entitlement_code` 表示权限。
3. `store` 只表示当前权益来源平台。
4. 如果用户 iOS 购买后 Android 恢复，不应该新开一条业务会员，而是合并进同一用户 entitlement。

## 9. 后端核心逻辑设计（NestJS）

### 9.1 模块建议

建议新增或重构为以下服务：

1. `RevenueCatWebhookController`
2. `RevenueCatWebhookService`
3. `RevenueCatSyncService`
4. `SubscriptionStateMachineService`
5. `SubscriptionReconcileCronService`
6. `SubscriptionAdminOpsService`

### 9.2 Webhook 处理流程

#### Controller

职责：

1. 校验 header secret。
2. 调用 `RevenueCatWebhookService.ingest(payload)`。
3. 只有成功入库才返回 200。

#### Ingest Service

职责：

1. 做幂等插入。
2. 创建异步任务。
3. 不直接改 subscription。

伪代码：

```ts
async ingest(payload: RevenueCatWebhookPayload) {
  await prisma.$transaction(async (tx) => {
    const exists = await tx.billingWebhookEvents.findUnique({
      where: { provider_providerEventId: { provider: 'revenuecat', providerEventId: payload.event.id } },
    });

    if (exists) {
      return;
    }

    await tx.billingWebhookEvents.create({
      data: mapWebhookPayload(payload),
    });

    await tx.subscriptionSyncJobs.create({
      data: buildSyncJob(payload),
    });
  });
}
```

### 9.3 幂等设计

幂等必须至少三层：

#### 第一层：Webhook 事件幂等

唯一键：`provider + provider_event_id`

#### 第二层：交易幂等

唯一键：`transaction_id`

#### 第三层：订阅聚合更新幂等

更新时按 `provider_subscription_key` 加行锁，或者用 PostgreSQL advisory lock。

### 9.4 状态更新策略

核心原则：永远不要让旧事件覆盖新状态。

更新规则：

1. 若新快照的 `last_provider_event_at` 早于当前库中值，则拒绝降级写入。
2. 若是 refund/revoke 这类强状态，可立即覆盖。
3. 若 cancellation 只是关闭自动续费，则只更新 `will_renew = false`，不立即去除访问权限。
4. 若 expiration 发生，只有当前 entitlement 已无访问权限时才写 `access_state = no_access`。
5. 若 renewal 到来，更新 `current_period_end_at`，并插入交易行。

### 9.5 如何处理续费、取消、退款、过期

#### 续费

处理：

1. upsert 一条 `subscription_transactions` 记录。
2. 更新 `subscription.current_period_end_at`。
3. `status = active`
4. `access_state = has_access`
5. `will_renew = true`

#### 取消

这里必须区分“取消自动续费”和“立即失效”。

默认移动订阅场景下，用户点击取消只是：

1. `will_renew = false`
2. `status = cancelled`
3. 但 `access_state` 仍然可能是 `has_access`
4. 直到 `current_period_end_at` 到来且 entitlement 不再 active，才真正变成 `no_access`

也就是说，“已取消但仍可用”不是 bug，而是 App Store / Google Play 正常语义。你的客户端和管理后台必须准确展示文案：

1. “已取消，将在 2026-05-31 到期”
2. 不能展示成“会员已失效”

#### 退款

处理：

1. 插入 `subscription_transactions.status = refunded`
2. 更新 `subscription.refunded_at`
3. 如果 RevenueCat 快照显示 entitlement 已撤销，则 `access_state = no_access`
4. 写审计日志

#### 过期

处理：

1. 不单靠本地时间判断。
2. 以 RevenueCat 最新快照确认 entitlement 已 inactive。
3. 然后更新：
   - `status = expired`
   - `access_state = no_access`
   - `will_renew = false`

### 9.6 是否需要事件表

必须需要，而且至少要两类：

1. 原始外部事件表：`billing_webhook_events`
2. 内部审计事件表：`subscription_audit_logs`

原因：

1. 原始事件表用于重放和排障。
2. 审计事件表用于解释“系统为什么把用户改成这个状态”。
3. 单靠当前 `subscription` 结果表无法满足客服、运营、财务、研发的追责需求。

## 10. 客户端策略（Flutter）

> 当前仓库中未找到 Flutter 客户端代码，本节按目标架构设计。

### 10.1 App 启动是否需要校验订阅

需要，但不是每次都全量重拉所有远端数据。

推荐流程：

1. App 启动读本地缓存的订阅摘要做首屏 UI。
2. 并发调用：
   - `Purchases.getCustomerInfo()`
   - `GET /app/subscription/status`
3. 如果两边一致，刷新本地 UI。
4. 如果不一致，触发 `POST /app/subscription/sync-trigger`，以后端结果为准。

结合你当前 Flutter 代码，现状是：

1. bootstrap 会初始化 RevenueCat。
2. 登录态变化时会调用 `Purchases.logIn(userId)` / `logOut()`。
3. 业务 UI 主要看后端 `quota-status`。

这个方向是对的，但还缺少启动阶段的显式订阅一致性校验接口。

### 10.2 是否完全依赖 RevenueCat SDK

不建议完全依赖。

推荐角色分工：

1. RevenueCat SDK：购买、恢复购买、本地快速 UI 提示。
2. 后端 API：最终权限、可用配额、运营策略、强一致判权。

对于 EatCheck 这种有强功能门控和日配额控制的 App，后端本来就已经承担了大量功能判权工作，所以更不能只认客户端 SDK。

从你当前 Flutter 实现看，这个原则已经部分成立：

1. `isProSubscriberProvider` 实际读的是后端 `quotaStatusProvider`。
2. 订阅页展示也会拉 `/app/subscription/plans`。

但购买闭环仍然没有完全切到“RevenueCat 购买，后端同步，后端判权”的标准链路。

### 10.3 如何避免“已取消但仍可用”的问题

先纠正语义：

1. `cancelled` 不等于 `expired`
2. `cancelled but active until period end` 是移动订阅标准行为

真正要避免的是：

1. 已退款 / 已撤销 / 已真正过期，但客户端还放权
2. 用户取消后文案误导

客户端应这样做：

1. 使用后端返回的字段：
   - `status`
   - `accessState`
   - `currentPeriodEndAt`
   - `willRenew`
2. 当 `status = cancelled` 且 `accessState = has_access` 时，展示：
   - “会员已取消，将于 X 到期”
3. 当 `accessState = no_access` 时，立即关闭受保护功能入口。

### 10.4 客户端购买后的正确链路

```text
purchase() success
  -> getCustomerInfo()
  -> POST /app/subscription/sync-trigger
  -> poll GET /app/subscription/status (最多 10-20 秒)
  -> 状态就绪后刷新 paywall / feature gates
```

你当前 Flutter 实现与推荐链路的差异：

1. 现在是 `purchase -> iOS verifyApplePurchase -> refresh RC -> refresh quota-status`
2. 推荐改成 `purchase -> sync-trigger -> refresh quota-status`

这样 Android / iOS 路径才能统一，也能彻底消除 RevenueCat 与 Apple 原生双写风险。

## 11. 风控与一致性

### 11.1 如何避免用户刷订阅

#### 规则 1：购买前必须完成账号登录

不要允许长期匿名用户直接购买。购买前必须绑定内部 `userId`。

补充：如果为了审核演示保留匿名浏览或匿名体验，这可以接受，但购买能力、恢复购买能力、正式订阅归属仍应只在真实登录态下开放。

#### 规则 2：RevenueCat `appUserID` 必须使用后端稳定主键

推荐：`appUserID = app_user.id`

不要使用：

1. 设备 ID
2. 临时匿名 ID
3. 邮箱这种可能变化的标识

#### 规则 3：恢复购买策略要保守

如果你的业务更重视防串号而不是极致恢复便利，RevenueCat 的 restore / transfer 策略应使用保守模式，避免把一个活跃订阅轻易转移到另一个账号。

#### 规则 4：服务端接口必须全量判权

像 EatCheck 这种有：

1. AI 分析配额
2. 高级报告
3. 高级教练
4. 趋势分析

这些都必须由后端校验 entitlement，不能让用户只改本地状态就解锁。

#### 规则 5：记录异常行为

管理后台应统计：

1. 同一订阅链频繁切账号
2. 同一用户频繁 restore
3. 高频 sandbox / production 异常混用
4. 同一设备多账号共享订阅迹象

### 11.2 如何防止状态不同步

三层机制：

1. RevenueCat webhook 实时同步
2. RevenueCat API 定时校验
3. 客户端购买后 / 启动后触发同步

再加两项工程约束：

1. 后端缓存必须在状态变更后立即失效
2. 所有订阅变更都必须写 `state_version`

### 11.3 最终一致性机制

建议采用“快路径 + 慢路径 + 人工路径”三层结构。

#### 快路径

Webhook 到达后秒级更新。

#### 慢路径

Cron 轮询 RevenueCat 做收敛校正。

#### 人工路径

管理后台提供：

1. 按用户 resync
2. 按事件重放
3. 按交易链重建

### 11.4 一致性状态机建议

建议业务判权不要直接只看 `status`，而是看：

1. `status`
2. `access_state`
3. `current_period_end_at`
4. `will_renew`
5. `billing_issue_detected`

其中真正给业务接口放权的，是 `access_state`。

## 12. 管理后台设计建议

你的项目包含管理后台，所以这里必须补齐运营和客服能力，不然生产级订阅系统是不完整的。

### 12.1 用户订阅详情页必须展示

1. 当前状态：active / cancelled / expired / refunded / revoked
2. 当前 entitlement
3. 当前商品 SKU
4. 来源平台：iOS / Android
5. 当前周期开始 / 结束时间
6. 是否自动续费
7. 最后同步时间
8. 最近 webhook 时间
9. 最近失败重试信息
10. 事件时间线

### 12.2 后台需要新增的运营动作

1. `Resync from RevenueCat`
2. `Replay webhook event`
3. `Grant manual access`
4. `Revoke manual access`
5. `Add internal note`

所有后台人工操作必须写 `subscription_audit_logs`，包含：

1. `actor_type = admin`
2. `actor_id = admin_user_id`
3. `reason`

### 12.3 后台报表建议

1. 活跃订阅数
2. 新增订阅数
3. 续费率
4. 退款率
5. 取消自动续费率
6. webhook 失败积压数
7. 同步延迟分布
8. 漏单修复数

## 13. 是否需要绕过 RevenueCat（未来演进）

### 13.1 当前阶段是否建议脱离 RevenueCat

不建议。

你现在的重点不是“去 RevenueCat”，而是“把 RevenueCat 正确放到生产架构里”。

对于 EatCheck 这种 AI 健康 App，当前阶段的真实挑战是：

1. 订阅状态可靠同步
2. 后端强判权
3. 审计与运营能力
4. 风控与异常恢复

这些问题用不用 RevenueCat 都要解决。

### 13.2 什么时候建议部分脱离 RevenueCat

当出现以下任一情况时，再考虑：

1. 订阅收入规模显著上升，RevenueCat 成本变成明显利润项。
2. 你要接入 Web 端 Stripe 订阅，并做跨渠道统一会员体系。
3. 你需要 store 原始级别的财务对账、税务、退款责任链控制。
4. 你需要更复杂的促销、intro offer、win-back、region pricing 策略，而 RevenueCat 抽象层限制明显。
5. 你已经有团队能长期维护 Apple / Google 原生订阅逻辑、验证、风控和合规。

### 13.3 是否建议长期依赖 RevenueCat

我的建议：

1. 中短期建议长期依赖 RevenueCat 作为移动订阅适配层。
2. 长期不要把自己的订阅领域模型设计成与 RevenueCat 强绑定。

具体做法：

1. 内部表使用 `provider` 抽象。
2. entitlement、product、transaction、event 都按平台无关方式设计。
3. RevenueCat 只是 provider adapter，不是数据库结构本身。

这样未来要接 Stripe、原生 Apple/Google、甚至企业团购码，也不需要推翻现有模型。

## 14. 推荐落地方案

### Phase 1：统一主链到 RevenueCat

1. 明确 Flutter 购买主路径只走 RevenueCat。
2. 后端新增 RevenueCat webhook 入口。
3. Apple 原生处理链从主链降级，不再直接驱动业务状态。

### Phase 2：补齐数据层

1. 升级 `subscription` 表。
2. 新增 `subscription_products`
3. 新增 `entitlements`
4. 新增 `product_entitlements`
5. 新增 `billing_webhook_events`
6. 新增 `subscription_transactions`
7. 新增 `subscription_audit_logs`

### Phase 3：补齐同步与恢复

1. webhook 异步化
2. RevenueCat API reconcile cron
3. `sync-trigger` 客户端兜底接口
4. 后台 resync / replay 能力

### Phase 4：补齐管理后台

1. 订阅详情页时间线
2. webhook 异常看板
3. 对账看板
4. 人工操作审计

## 15. 对你当前设计的最终判断

### 15.1 合理的部分

1. 已经有独立订阅模块。
2. 已有后台订阅管理基础。
3. 已有 entitlement / quota 体系，说明业务判权意识是对的。
4. 已有缓存和事件机制雏形。

### 15.2 最大的问题

最大问题不是“有没有接 RevenueCat”，而是“当前没有明确唯一状态源，且数据模型还停留在本地会员结果表层级”。

### 15.3 最优架构建议

最优方案不是完全绕过 RevenueCat，而是：

1. RevenueCat 负责移动支付聚合。
2. NestJS 负责订阅领域建模和最终权限放行。
3. 管理后台负责审计、纠偏、运营。
4. 通过 webhook + API reconcile + client trigger 形成最终一致性。

这比“只信 RevenueCat”更可靠，也比“RevenueCat + Apple 原生 + 客户端一起改状态”更稳。

## 16. 需要你尽快改的 10 件事

1. 明确 RevenueCat 是唯一实时订阅事件入口。
2. 停止让 Apple 原生链继续作为主状态写入源。
3. 新增 `billing_webhook_events` 原始事件表。
4. 新增 `subscription_transactions` 交易表。
5. 扩展 `subscription` 表，加入 provider / entitlement / sync 字段。
6. 增加 RevenueCat 定时对账任务。
7. 增加 `POST /app/subscription/sync-trigger`。
8. 客户端启动、购买后、restore 后都调用服务端同步。
9. 管理后台增加 resync、timeline、异常积压面板。
10. 所有服务端权限判断以内部订阅聚合表为准，不直接以客户端 SDK 为准。

## 17. 基于现有 Flutter 实现的附加建议

### 17.1 不要在生产文档里继续保留“Apple verify 是购买成功必要步骤”

当前 Flutter iOS 购买后还调用 `/app/subscription/apple/verify`，这应该被视为迁移中的历史实现，不应进入未来生产标准链路。

如果审核包临时保留了某些特殊路径，也应限定在 review/staging 环境，不要进入正式 production subscription flow。

### 17.2 `quota-status` 接口应升级为更明确的订阅状态接口

当前 Flutter 主要读 `/app/subscription/quota-status`。建议新增或补强响应字段，至少包含：

1. `tier`
2. `status`
3. `accessState`
4. `willRenew`
5. `expiresAt`
6. `currentProductCode`
7. `entitlementCodes`
8. `lastSyncedAt`

否则客户端只能知道“是不是 pro”，却不知道“已取消但仍有效”还是“已退款已失效”。

### 17.3 客户端硬编码 entitlement 名称应尽快去耦

当前 `ShouldIEat Pro` 这个 entitlement 常量至少说明两件事：

1. 品牌命名还未完全切到 EatCheck。
2. 客户端仍对 RevenueCat dashboard 配置名有直接耦合。

建议：

1. 后端维护内部 `entitlement_code`
2. 客户端只把 RevenueCat entitlement 当作辅助信号
3. 最终 UI 和功能放行都以后端字段为准
