# ADR-20260428 Subscription Production Architecture

## Status

Accepted

## Context

EatCheck 当前订阅系统具备以下特征：

1. Flutter 客户端已接入 RevenueCat SDK。
2. NestJS 后端维护本地 `subscription`、`payment_records`、`usage_quota` 等表。
3. 管理后台已具备基础订阅管理能力。
4. iOS 端当前仍存在 `RevenueCat purchase -> /app/subscription/apple/verify` 的混合链路。
5. 后端当前仍保留 Apple 原生 verify 与 Apple S2S webhook 处理逻辑。

这导致系统存在两个生产级风险：

1. 缺少明确唯一的实时订阅事件主入口。
2. Flutter、RevenueCat、Apple 原生后端逻辑之间存在双源写状态风险。

另外，团队已确认匿名模式仅用于提审，不属于正式生产模式。问题焦点不是匿名本身，而是 review 路径不能污染 production 订阅数据。

## Decision

### 1. 订阅主架构

采用以下生产级主链：

1. Flutter 负责购买、恢复购买、触发同步。
2. RevenueCat 作为移动订阅聚合层。
3. NestJS 后端作为业务权限最终真相源。
4. 管理后台基于内部订阅聚合、交易、事件数据做运营与审计。

### 2. 实时事件源

RevenueCat webhook 作为唯一实时订阅事件入口。

决策要求：

1. 新增 `POST /billing/revenuecat/webhook`。
2. 原始 webhook 事件必须持久化。
3. webhook 只负责触发同步，不直接盲写最终订阅状态。
4. 最终状态由最新 provider 快照与内部状态机收敛得出。

### 3. 客户端同步策略

Flutter 客户端在以下场景必须触发后端同步：

1. purchase 成功后
2. restore 成功后
3. App 启动或前后台切换后发现状态不一致时

新增 `POST /app/subscription/sync-trigger` 作为客户端统一同步入口。

### 4. Apple 原生链路定位

Apple 原生 verify 与 Apple S2S 逻辑短期保留为 legacy / compatibility path，不再作为未来正式生产标准链路。

这意味着：

1. 不再继续扩展 iOS 专属激活逻辑。
2. 新增链路统一围绕 RevenueCat webhook + sync-trigger 构建。
3. 待 RevenueCat 主链稳定后，再评估是否彻底下线 Apple 原生主写路径。

### 5. 数据模型方向

内部订阅系统最终演进为三层模型：

1. `subscription`：当前聚合态
2. `subscription_transactions`：交易历史
3. `billing_webhook_events` / `subscription_audit_logs`：原始事件与审计时间线

### 6. 环境隔离

review 与 production 的订阅链必须隔离，至少包括：

1. Flutter build config
2. RevenueCat project / key
3. backend API base URL
4. webhook endpoint
5. runtime environment tagging

提审匿名模式仅允许存在于 review path，不能进入 production subscription flow。

## Consequences

### Positive

1. 购买、恢复、退款、取消、过期的收敛链路更清晰。
2. 后端对会员权限拥有最终控制权。
3. 管理后台可逐步补齐订阅审计与人工纠偏能力。
4. Flutter iOS / Android 的购买后行为可以统一。
5. review 数据污染 production 的风险显著下降。

### Negative

1. 需要新增 RevenueCat webhook、sync-trigger、后续 reconcile cron 等实现工作。
2. Apple 原生链路在过渡期内仍需保留兼容判断。
3. 管理后台需要补充时间线和重放能力。

### Follow-up

1. 第一阶段先落 `RevenueCat webhook + sync-trigger` 骨架。
2. 第二阶段补齐 webhook 事件表、transaction 表、审计表。
3. 第三阶段补齐 reconcile cron、failed retry、admin resync。
