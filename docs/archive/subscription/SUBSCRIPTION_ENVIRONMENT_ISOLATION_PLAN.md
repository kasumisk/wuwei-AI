# EatCheck 订阅环境隔离方案

> 目标：明确正式生产环境与提审环境的订阅隔离边界
> 
> 适用范围：Flutter 客户端 + RevenueCat + Apple App Store / Google Play + NestJS 后端

## 1. 结论

既然匿名模式只用于提审，不用于正式生产，那么问题的重点不是“能不能匿名”，而是：

1. 提审路径是否会污染正式 RevenueCat 数据。
2. 提审路径是否会打到正式后端订阅状态。
3. 提审包是否仍可能触发正式 webhook、正式订阅归属、正式用户权限变更。

推荐方案：

1. 正式生产环境与提审环境必须做订阅链路隔离。
2. 提审环境最多允许“审核演示能力”，不允许进入正式 production subscription flow。
3. Flutter 继续沿用现有 `APP_ENV` 多环境机制，不另起一套环境系统。

## 2. 隔离原则

### 2.1 必须隔离的 6 个维度

1. Flutter 构建环境
2. Bundle ID / Application ID
3. RevenueCat Project
4. Store Product / Subscription Group
5. Backend API Base URL
6. Webhook Endpoint

只隔离其中一两个维度不够，必须整链路隔离。

## 3. 推荐环境划分

### 3.1 环境定义

#### Production

正式上架环境。

用途：

1. App Store / Google Play 正式用户
2. 正式订阅
3. 正式 RevenueCat 项目
4. 正式后端判权

#### Review

提审 / 审核专用环境。

用途：

1. App 审核演示
2. 沙盒订阅演示
3. 审核专用 RevenueCat 项目或最小隔离链路
4. 独立后端或至少独立 subscription namespace

#### Staging

开发联调 / QA 环境。

用途：

1. 工程联调
2. 回归测试
3. 订阅回放测试

### 3.2 你现有 Flutter 多环境的利用方式

当前 `flutter-scaffold/lib/config/env_config.dart` 已支持：

1. `APP_ENV=dev|staging|prod`
2. `API_BASE_URL`
3. `SEALED`

推荐直接扩展为：

1. `APP_ENV=staging` 可继续作为联调环境
2. 提审包使用 `APP_ENV=staging` 或新增 `review` flavor
3. `SEALED=true` 用于关闭开发工具，适配提审

如果你想最小改动：

1. 保持 `dev / staging / prod`
2. 把提审包放在 `staging + SEALED=true`
3. 但订阅相关配置必须和普通 staging 再隔一层

结论：提审环境不要直接等同于普通 staging。

## 4. RevenueCat 隔离方案

### 4.1 最优方案

为提审环境单独创建一个 RevenueCat project。

理由：

1. webhook 完全隔离
2. customer / entitlement / event 数据完全隔离
3. 不会污染正式图表、漏斗、转化分析
4. 审核包出现匿名 alias 也不会污染正式用户

### 4.2 备选方案

如果短期不想新建 RevenueCat project，至少要做到：

1. 提审包使用独立 `appUserID` 命名空间，如 `review:<id>`
2. 提审包只连 review backend
3. webhook 进 review endpoint
4. 所有提审订阅商品使用 review SKU

注意：这仍不如独立 RevenueCat project 干净。

### 4.3 明确不推荐的方案

不要这样做：

1. 提审包和正式包共用 RevenueCat project
2. 提审包和正式包共用同一批 product id
3. 提审包打正式 backend
4. 提审包 webhook 回正式订阅处理链

这会导致：

1. 正式用户时间线被审核事件污染
2. 正式订阅统计偏差
3. 正式 webhook 里混入 review 数据
4. 误开权限、误写审计记录

## 5. Store 隔离方案

### 5.1 iOS

推荐：

1. 正式包：正式 Bundle ID
2. 提审包：独立 Bundle ID，例如 `com.eatcheck.app.review`
3. 提审包绑定独立 IAP 商品

如果审核必须使用正式 Bundle ID：

1. 仍建议至少隔离 RevenueCat project 和 backend
2. 提审账号不要复用正式用户账号
3. 审核商品尽量使用 sandbox / review 专用 SKU

### 5.2 Android

推荐：

1. 正式包：正式 applicationId
2. 提审包：独立 applicationIdSuffix 或独立 app id
3. Play Console 商品与正式商品分离

## 6. Backend 隔离方案

### 6.1 最优方案

提审环境使用独立 backend 环境：

1. 独立 API base URL
2. 独立数据库
3. 独立 RevenueCat webhook endpoint
4. 独立日志与监控

示例：

1. Production: `https://api.eatcheck.com/api`
2. Review: `https://review-api.eatcheck.com/api`

### 6.2 次优方案

如果短期不能独立数据库，至少要做到：

1. 所有 review 订阅事件打独立 endpoint，如 `/billing/revenuecat/review-webhook`
2. review 数据带 `environment = review`
3. 内部表强制带 `runtime_env`
4. 管理后台默认过滤正式数据和 review 数据

但这个方案会让长期维护复杂化，不建议作为长期形态。

## 7. Flutter 提审包推荐配置

### 7.1 新增或明确以下 dart-define

1. `APP_ENV=staging`
2. `SEALED=true`
3. `API_BASE_URL=https://review-api.../api`
4. `RC_API_KEY_IOS=...`
5. `RC_API_KEY_ANDROID=...`
6. `RC_PROJECT_ENV=review`
7. `ENABLE_SUBSCRIPTION_REVIEW_MODE=true`

### 7.2 不要继续硬编码 RevenueCat key

当前 `flutter-scaffold/lib/modules/subscription/services/purchases_service.dart` 里直接硬编码了：

1. `_apiKeyIos`
2. `_apiKeyAndroid`

建议改成 `dart-define` 注入。

原因：

1. review / production key 可以清晰切换
2. 减少误发版风险
3. 更符合多环境构建流程

## 8. 提审包的功能边界

### 8.1 可以保留的能力

1. 匿名浏览
2. 演示 paywall
3. 演示购买页面
4. 演示 restore 页面
5. 演示会员 UI 变化

### 8.2 不应进入正式链路的能力

1. 正式 webhook
2. 正式 subscription 状态更新
3. 正式用户 entitlement 变更
4. 正式转化报表
5. 正式客服审计时间线

## 9. 管理后台要求

管理后台必须能区分：

1. `runtime_env = production`
2. `runtime_env = review`
3. `runtime_env = staging`

建议新增：

1. 环境筛选器
2. review 数据默认隐藏
3. review 数据不进入正式营收概览

## 10. 具体落地建议

### 10.1 一周内必须完成

1. RevenueCat key 改为环境注入
2. 提审包 API 指向独立 review backend
3. review webhook 独立 endpoint
4. review 事件不写入 production subscription aggregate

### 10.2 两周内完成

1. 提审 / 正式商品映射分离
2. 管理后台按环境过滤
3. 订阅表新增 `runtime_env`
4. 所有审计日志新增 `runtime_env`

## 11. 最终推荐

最稳的方案是：

1. Production 一套完整订阅链
2. Review 一套轻量隔离订阅链
3. Flutter 用现有 `APP_ENV` / `API_BASE_URL` / `SEALED` 承载构建切换
4. 不让提审匿名路径进入 production webhook 和 production 判权

这能满足两个目标：

1. 提审时可保留匿名演示能力
2. 正式生产数据不被污染
