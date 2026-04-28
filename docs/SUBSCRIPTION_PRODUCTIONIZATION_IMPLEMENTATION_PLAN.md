# EatCheck 订阅生产化实施清单

> 范围：NestJS 后端 + Flutter 客户端 + 管理后台
> 
> 目标：把当前“RevenueCat + 后端本地订阅 + Apple 原生 verify 混合模式”改造成生产级链路

## 1. 目标状态

目标链路：

1. Flutter 只负责购买、恢复购买、触发同步
2. RevenueCat 负责聚合 Apple / Google 订阅事件
3. NestJS 通过 RevenueCat webhook + API reconcile 维护内部订阅真相
4. 管理后台基于内部表做审计、纠偏、运营

## 2. P0 问题清单

当前必须先解决的 8 个问题：

1. iOS 购买后仍调用 `/app/subscription/apple/verify`
2. 没有 RevenueCat webhook 主入口
3. 没有持久化 webhook 事件表
4. 没有 transaction 历史表
5. `subscription` 表无法表达 provider / entitlement / sync 状态
6. restore 后没有显式服务端重同步
7. RevenueCat key 在 Flutter 端硬编码
8. 管理后台缺少 resync / timeline / 异常积压视图

## 3. 分阶段实施

## Phase 1：统一主链

### 后端

1. 新增 `POST /billing/revenuecat/webhook`
2. 校验 RevenueCat webhook secret
3. 原始事件落库 `billing_webhook_events`
4. 仅在事件落库成功后返回 200
5. 创建异步 `subscription-sync` job

### Flutter

1. 购买成功后不再调用 `/app/subscription/apple/verify`
2. 新增 `POST /app/subscription/sync-trigger`
3. purchase 成功后执行：
   - `Purchases.getCustomerInfo()`
   - `sync-trigger`
   - 刷新 `/app/subscription/quota-status`
4. restore 成功后执行同样流程

### 管理后台

1. 暂不改 UI，先接后台事件表
2. 后台保留对旧链路的只读兼容

### 验收标准

1. iOS / Android 购买路径一致
2. 不再依赖 Apple verify 作为主激活步骤
3. RevenueCat webhook 成为唯一实时事件入口

## Phase 2：补齐数据模型

### 数据库新增表

1. `billing_webhook_events`
2. `subscription_transactions`
3. `subscription_audit_logs`
4. `subscription_products`
5. `entitlements`
6. `product_entitlements`

### 数据库改造表

升级 `subscription` 表，新增字段：

1. `provider`
2. `provider_customer_id`
3. `entitlement_code`
4. `store`
5. `environment`
6. `runtime_env`
7. `provider_subscription_key`
8. `latest_transaction_id`
9. `last_provider_event_at`
10. `last_synced_at`
11. `access_state`
12. `state_version`

### 后端代码

1. 新增 `RevenueCatSyncService`
2. 新增 `SubscriptionStateMachineService`
3. 所有状态变更写审计日志
4. 所有交易变更写 transaction 表

### 验收标准

1. 能按 transaction id 查到每次订阅变化
2. 能按 user id 查到完整事件时间线
3. 能区分 review / production 数据

## Phase 3：补齐一致性与恢复

### 后端

1. 增加定时 reconcile cron
2. 增加 failed webhook retry job
3. 增加 dead-letter 标记
4. 增加用户级 resync 能力

### Flutter

1. App 启动时并发拉：
   - `Purchases.getCustomerInfo()`
   - `/app/subscription/status` 或升级后的 `quota-status`
2. 发现不一致时自动调用 `sync-trigger`

### 管理后台

1. 增加“手动 Resync”按钮
2. 增加 failed webhook 列表
3. 增加 dead-letter 事件重放能力

### 验收标准

1. 模拟 webhook 丢失时仍能自动收敛
2. restore 后 1 分钟内状态正确
3. 退款 / 撤销后权限能及时收回

## Phase 4：运营与审计

### 管理后台新增页面

1. 订阅详情时间线页
2. webhook 事件列表页
3. subscription transaction 列表页
4. 异常对账面板

### 指标

1. 新增订阅数
2. 活跃订阅数
3. 取消自动续费率
4. 退款率
5. webhook 失败率
6. 同步延迟

### 验收标准

1. 客服能回答“为什么这个用户现在有权限”
2. 技术能重放指定事件
3. 运营报表不混入 review 数据

## 4. NestJS 具体改造项

### 4.1 新增模块与服务

1. `revenuecat-webhook.controller.ts`
2. `revenuecat-webhook.service.ts`
3. `revenuecat-sync.service.ts`
4. `subscription-reconcile-cron.service.ts`
5. `subscription-admin-ops.service.ts`

### 4.2 新增接口

#### App 端

1. `POST /app/subscription/sync-trigger`
2. `GET /app/subscription/status`

#### Billing 端

1. `POST /billing/revenuecat/webhook`

#### Admin 端

1. `POST /admin/subscriptions/:id/resync`
2. `GET /admin/subscriptions/:id/timeline`
3. `GET /admin/subscriptions/webhook-events`
4. `POST /admin/subscriptions/webhook-events/:id/replay`

### 4.3 现有代码处理建议

#### 继续保留但降级处理

1. `apple-iap.service.ts`
2. `apple-iap.controller.ts`

处理建议：

1. 从主链降级为 legacy / shadow
2. 不再作为正式生产判权入口
3. 等 RevenueCat 主链稳定后再决定是否删除

#### `subscription.service.ts`

需要做的改动：

1. 续费和取消不要再只按 `userId` 更新
2. 按 `provider_subscription_key` 更新聚合订阅
3. 引入 `access_state`
4. 引入 `last_synced_at`
5. 所有变更写 `subscription_audit_logs`

## 5. Flutter 具体改造项

### 5.1 `PurchasesService`

文件：`flutter-scaffold/lib/modules/subscription/services/purchases_service.dart`

改造项：

1. RevenueCat api key 改为 `dart-define` 注入
2. entitlement 常量从单一硬编码改为配置化或仅作辅助
3. 增加 review / production 环境切换

### 5.2 `subscription_page.dart`

改造项：

1. 删除 iOS 专属 `verifyApplePurchase` 主链调用
2. 新增统一 `_syncSubscription()`
3. purchase / restore 后统一执行：
   - refresh RC
   - call backend sync-trigger
   - refresh quota-status

### 5.3 `subscription_provider.dart`

改造项：

1. 保留 RevenueCat CustomerInfo 监听
2. 但 UI 继续以后端状态为主
3. 增加“状态不一致时触发 sync”逻辑

### 5.4 `quota-status` 模型升级

当前 `QuotaStatus` 建议增加字段：

1. `status`
2. `accessState`
3. `willRenew`
4. `currentProductCode`
5. `lastSyncedAt`

这样客户端才能正确区分：

1. 已取消但仍有效
2. 已过期
3. 已退款
4. 已撤销

## 6. 管理后台具体改造项

### 6.1 新增能力

1. 订阅时间线
2. webhook 失败列表
3. 用户级 resync
4. 事件 replay
5. runtime_env 过滤

### 6.2 现有页面扩展

在当前 `admin/subscriptions` 基础上新增字段：

1. `provider`
2. `store`
3. `environment`
4. `runtime_env`
5. `entitlement_code`
6. `last_synced_at`
7. `last_event_id`

## 7. 任务拆解

### Sprint 1

1. 后端接 RevenueCat webhook
2. Flutter 加 `sync-trigger`
3. Flutter 去掉 iOS Apple verify 主链依赖
4. 增加 `runtime_env`

### Sprint 2

1. 新增 webhook 事件表
2. 新增 transaction 表
3. subscription 表扩展
4. 管理后台增加基础查询

### Sprint 3

1. reconcile cron
2. retry / dead-letter
3. admin resync / replay
4. 客户端启动一致性校验

### Sprint 4

1. 报表与审计完善
2. review / production 数据隔离验收
3. Apple 原生 legacy 链下线评估

## 8. 优先级建议

### 必须马上做

1. RevenueCat webhook 主入口
2. Flutter `sync-trigger`
3. review / production 订阅链路隔离
4. 去掉 iOS 特殊激活路径依赖

### 紧接着做

1. 事件表
2. transaction 表
3. 管理后台 resync
4. cron reconcile

### 可以后做

1. Apple 原生链完全删除
2. 更复杂的活动和优惠运营
3. 多 entitlement 商品扩展

## 9. 完成标准

当满足以下条件时，可以认为订阅系统进入 production ready：

1. 正式生产只存在一个实时主事件源
2. 购买、恢复、退款、取消、过期都能被后端正确收敛
3. webhook 丢失后可以自动恢复
4. 管理后台可以按用户追溯完整订阅时间线
5. review 数据不会污染 production 数据
6. Flutter 业务判权以后端为准，不依赖本地 RevenueCat 缓存
