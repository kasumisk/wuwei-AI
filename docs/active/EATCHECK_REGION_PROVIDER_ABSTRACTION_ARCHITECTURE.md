# EatCheck 全球主架构 + 中国区域化适配层：Provider Abstraction 落地方案

## 文档目的

本文用于启动 EatCheck 的项目文档管理，并把“中国大陆兼容架构”从调研结论转成可执行工程方案。

核心结论：EatCheck 现在不应该重写中国版，也不应该立即投入 ICP、国内支付、国内 AI、双集群和双数据库。当前最优路线是继续优先推进海外全球版，同时在现有 NestJS/Prisma/Flutter 架构上补齐 Provider Abstraction 与 Region Strategy，让系统未来可以接入中国能力而不拖死全球主架构。

## 当前项目状态

根据当前仓库检查，EatCheck 已具备做“全球主架构 + 中国区域化适配层”的基础：

- 后端为 NestJS + Prisma + PostgreSQL，位于 `apps/api-server`。
- AI Gateway 已存在，位于 `apps/api-server/src/gateway`，并已有 `OpenAIAdapter`、`OpenRouterAdapter`、`DeepSeekAdapter`、`QwenAdapter`。
- AI provider/model 管理已存在，位于 `apps/api-server/src/modules/provider`，Prisma 中已有 `Providers`、`ModelConfigs`、`ClientCapabilityPermissions` 等模型。
- 统一 LLM 调用入口已存在，位于 `apps/api-server/src/core/llm/llm.service.ts`，当前仍偏“直连模式”，注释中也标明路由模式待后续实现。
- 用户区域、时区、语言概念已存在，位于 `apps/api-server/src/common/config/regional-defaults.ts`、`timezone.util.ts`、`locale-region.util.ts`。
- 推荐链路已经开始传递 `regionCode`，并有 `FoodRegionalInfo`、季节性、地域 boost、渠道可获得性等区域化能力。
- Auth 侧已有 Firebase、Google token fallback、手机号、微信、小程序、邮箱等能力，但目前集中在 `AppAuthService`，尚未抽象为区域可替换 provider。
- 订阅侧已有 RevenueCat、Apple/Google 订阅域模型、微信支付服务、支付记录与权益系统，但还没有清晰的 `BillingProvider` 边界。

这意味着当前最应该做的不是“从 0 搭中国版”，而是把已有能力整理成可路由、可灰度、可按区域替换的基础设施抽象层。

## 架构原则

### 1. 核心业务统一

以下能力必须保持全球统一，不按中国/海外拆两套：

- 推荐系统
- 饮食决策系统
- AI Prompt 与解释逻辑
- 用户画像与行为画像
- 食物数据库与 Prisma schema 主体
- 订阅权益语义
- 营养计算、评分、推荐过滤、反馈闭环

原因：这些是 EatCheck 的产品壁垒。拆成两套会让 AI 产品、数据口径、推荐质量和运营实验全部失控。

### 2. 基础设施区域化

以下能力允许按区域替换 provider：

- Auth：Global 使用 FirebaseAuthProvider；CN 增加 PhoneSmsAuthProvider / WechatAuthProvider
- AI：OpenAI / OpenRouter / DeepSeek / Qwen
- Billing：统一使用 RevenueCatBillingProvider；不拆独立 AppleIap provider
- Storage：GCP Storage / S3 / OSS / COS
- Push：FCM/APNs / 极光/个推
- SMS：Twilio / 阿里云短信 / 腾讯云短信
- Moderation：OpenAI moderation / 阿里云内容安全 / 腾讯内容安全
- Deployment：Cloud Run / 中国云节点

### 3. App 单包，服务端按 Region Strategy 切换

Flutter 不应该直接决定所有供应商。客户端只携带必要上下文：`regionCode`、`locale`、`timezone`、`platform`、`store`、`appVersion`、`capabilityHints`。真正的 provider 选择应由后端 Region Strategy 和 Gateway 决策。

## 目标架构

```text
Global Flutter App / Web / Miniapp
        |
        v
API Gateway / BFF
        |
        v
Region Strategy Resolver
        |
        +--------------------+--------------------+
        |                    |                    |
   Global Runtime       China Runtime        Future Runtime
        |                    |                    |
 Firebase/OpenAI      SMS/WeChat/Qwen       EU-specific stack
 RevenueCat/GCP       WeChat/Alipay/OSS     Data residency layer
        |
        v
Unified Core Domain
Recommendation / Profile / Food DB / Subscription Entitlements / Analytics
```

长期目标可以演进为：

```text
CDN / Edge / Gateway
    |
Region Router
    |
    +--> Global BFF / Cloud Run / Global Postgres
    |
    +--> China BFF / China Cloud / China Provider Layer
```

但 Phase 1 不做双集群，只先完成抽象与配置化路由。

## 需要新增的核心抽象

### 1. Region Strategy

新增统一区域策略服务，建议位置：

`apps/api-server/src/core/region/region-strategy.service.ts`

职责：

- 根据用户档案、请求 header、locale、timezone、IP 推断运行区域。
- 输出当前请求可用能力表。
- 为 Auth、AI、Billing、Storage、Push、SMS、Moderation 提供统一 provider 选择依据。
- 支持灰度、强制覆盖和后台配置。

建议类型：

```ts
type RuntimeRegion = 'GLOBAL' | 'CN';

type CapabilityKey =
  | 'auth'
  | 'ai.text'
  | 'ai.vision'
  | 'billing'
  | 'storage'
  | 'push'
  | 'sms'
  | 'moderation';

interface RegionCapabilityProfile {
  region: RuntimeRegion;
  countryCode?: string;
  locale?: string;
  timezone?: string;
  authMethods: string[];
  aiProviders: string[];
  billingProviders: string[];
  storageProvider: string;
  pushProviders: string[];
  smsProvider?: string;
  moderationProvider?: string;
  complianceFlags: {
    piplMode: boolean;
    dataResidencyRequired: boolean;
    contentModerationRequired: boolean;
    medicalDisclaimerRequired: boolean;
  };
}
```

Phase 1 默认策略：

- `GLOBAL` 为默认运行区域。
- `CN` 仅作为能力配置存在，不默认启用正式生产流量。
- 允许通过 admin/config 或环境变量强制特定测试用户进入 `CN` profile。

### 2. AIProvider / AI Gateway 统一化

现状：AI Gateway adapter 已有，`BaseCapabilityAdapter` 已定义生成文本、流式文本、图像生成、音频转文本等能力。下一步不是新写一套 AI 抽象，而是把业务模块统一收敛到 Gateway/LLM Router。

目标：

```text
Food Analyze / Coach / Enrichment / Recommendation Explain
        |
        v
LlmRouterService / AI Gateway
        |
        v
CapabilityRouter + RegionStrategy
        |
        v
OpenAI / OpenRouter / DeepSeek / Qwen
```

需要补齐：

- `LlmService` 增加 routed 模式，避免业务模块直接传 `apiKey/baseUrl/model`。
- `CapabilityRouter.route()` 增加 `region`、`locale`、`feature`、`dataSensitivity` 参数。
- `Providers` / `ModelConfigs` 增加区域适用范围字段，例如 `regions`、`blockedRegions`、`dataResidencyMode`。
- 业务模块只表达能力需求，例如 `food_image_analysis`、`coach_chat`、`food_enrichment`，不关心供应商。

建议 Provider 策略：

| 区域 | 默认文本 | 视觉/图像分析 | 兜底 |
|---|---|---|---|
| Global | OpenAI/OpenRouter | OpenAI/OpenRouter | DeepSeek 可作为低成本兜底 |
| CN | Qwen/DeepSeek | Qwen-VL 或国内视觉模型 | 不回退到境外模型，除非合规明确允许 |

### 3. AuthProvider

现状：`AppAuthService` 已聚合 Firebase、手机号、微信、邮箱等逻辑。短期可以不大拆 controller，但需要把 provider 能力从 service 中抽出。

建议接口：

```ts
interface AuthProvider {
  readonly name: string;
  readonly supportedRegions: RuntimeRegion[];
  verifyCredential(input: AuthCredentialInput): Promise<VerifiedIdentity>;
  linkIdentity(userId: string, identity: VerifiedIdentity): Promise<void>;
}
```

建议 provider：

- `FirebaseAuthProvider`：Global 唯一认证 provider，承载 Apple / Google / Email / Anonymous 等登录 method。
- `PhoneSmsAuthProvider`：CN 必备。
- `WechatAuthProvider`：CN 必备，小程序和微信生态。

落地方式：

- 保留现有 `/api/app/auth/*` 路由，内部改为调用 `AuthProviderRegistry`。
- App 启动或登录页先请求 `/api/app/capabilities`，根据 region 返回可展示登录方式。
- Flutter 不直接依赖 Firebase 作为唯一认证入口。Firebase 只是 Global 区域的认证 provider，CN 通过 PhoneSms / WeChat provider 承接。

### 4. BillingProvider

现状：订阅域模型和权益系统较完整，已有 RevenueCat sync、微信支付服务、StoreProduct、PaymentRecords。下一步要把支付渠道升级成 provider 体系。

建议接口：

```ts
interface BillingProvider {
  readonly name: string;
  readonly supportedRegions: RuntimeRegion[];
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  verifyWebhook(input: WebhookInput): Promise<BillingEvent[]>;
  syncCustomer(userId: string): Promise<void>;
}
```

建议 provider：

- `RevenueCatBillingProvider`：Global App Store / Google Play 主入口，CN Phase 1 也统一暴露 RevenueCat。
- `WechatPayBillingProvider`：未来 CN Android / 小程序可选，不进入当前默认 capability。
- `AlipayBillingProvider`：未来 CN Android 可选，不进入当前默认 capability。

关键规则：

- 订阅权益语义统一，支付 provider 只负责交易和回调。
- 不拆独立 `AppleIapBillingProvider`，IAP 统一归 RevenueCat。
- Android 中国支付方式需要单独复评后再启用微信/支付宝。
- `SubscriptionService` 继续作为内部订阅状态真相源，provider 只产生 `BillingEvent`。

### 5. StorageProvider / FileProvider

现状：已有 `storage` module，但需要评估是否强绑定某个云。

建议接口：

```ts
interface StorageProvider {
  putObject(input: PutObjectInput): Promise<StoredObject>;
  getSignedUrl(input: SignedUrlInput): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
```

建议 provider：

- Global：GCP Storage 或兼容 S3。
- CN：OSS/COS。

关键原则：文件 key 和业务表不存云厂商 URL，只存逻辑 key、region、bucket scope。访问 URL 由 provider 临时生成。

### 6. ModerationProvider

因为 EatCheck 是 AI + 健康/营养，未来中国区需要内容安全能力。建议先抽象，不急着接入。

接口：

```ts
interface ModerationProvider {
  moderateText(input: ModerationTextInput): Promise<ModerationResult>;
  moderateImage(input: ModerationImageInput): Promise<ModerationResult>;
}
```

使用点：

- 用户输入的食物描述、聊天内容。
- AI 输出的健康建议。
- 图片上传和识别结果。
- 中国区强制启用，Global 按风险启用。

## 建议新增 API

### `/api/app/capabilities`

客户端启动后调用，返回当前区域能力表。

示例：

```json
{
  "region": "GLOBAL",
  "countryCode": "US",
  "locale": "en-US",
  "timezone": "America/New_York",
  "authMethods": ["apple", "google", "email", "anonymous"],
  "billingMethods": ["apple_iap", "google_play", "revenuecat"],
  "aiFeatures": {
    "foodImageAnalysis": true,
    "coachChat": true,
    "streaming": true
  },
  "compliance": {
    "medicalDisclaimerRequired": true,
    "contentModerationRequired": false,
    "dataResidencyRequired": false
  }
}
```

CN 预期：

```json
{
  "region": "CN",
  "countryCode": "CN",
  "locale": "zh-CN",
  "timezone": "Asia/Shanghai",
  "authMethods": ["phone", "wechat"],
  "billingMethods": ["revenuecat"],
  "compliance": {
    "piplMode": true,
    "medicalDisclaimerRequired": true,
    "contentModerationRequired": true,
    "dataResidencyRequired": true
  }
}
```

## 数据模型建议

### 短期不拆数据库

Phase 1 不做双数据库。继续使用现有 Prisma schema 和 PostgreSQL，把 region 作为业务维度和 provider 路由维度。

### 建议新增或扩展字段

Provider/Model：

- `providers.regions`：允许区域，JSON 或字符串数组。
- `providers.blockedRegions`：禁止区域。
- `providers.complianceTags`：如 `global`, `cn-mainland`, `no-cross-border-health-data`。
- `model_configs.featureKey`：业务能力键，减少直接按 provider/model 写死。
- `model_configs.regionPriority`：区域优先级。

用户：

- `app_users.homeRegion`：用户主运行区，可由 profile 或登录来源确定。
- `user_profiles.regionCode/timezone/locale` 已存在，应继续作为推荐与展示层输入。

订阅：

- `store_products.provider/store/region/currency` 继续强化为前端展示与支付选择依据。
- `payment_records.region/providerEventId/providerPayload` 用于审计与回调幂等。

文件：

- 增加 `storageRegion`、`storageProvider`、`objectKey`，避免写死外部 URL。

## 落地路线图

### Phase 1：现在，做中国兼容架构，不做中国正式上线

目标：不影响海外 PMF 和增长，同时让未来国内能力可插拔。

任务：

- 建立 Notion 项目文档结构：架构总览、决策记录、Provider 抽象、Region Strategy、合规清单、实施任务。
- 新增 `RegionStrategyService` 与 `/api/app/capabilities`。
- 将 AI 业务调用逐步收敛到 routed `LlmService` / AI Gateway。
- 给 `CapabilityRouter` 增加 region/context 参数。
- 梳理 `AuthProviderRegistry`，先包装现有 Firebase、Phone、WeChat 能力，不改变 API 行为。
- 梳理 `BillingProvider`，先包装 RevenueCat 和 WeChatPay，不改变订阅权益模型。
- Provider/model/admin 配置增加 region 维度。
- 建立最小合规开关：medical disclaimer、content moderation required、data residency required。

验收标准：

- Global 用户现有登录、AI 分析、订阅不受影响。
- 测试用户可以通过配置拿到 CN capability profile。
- 业务模块不再新增直连 OpenAI/OpenRouter 代码。
- 新 provider 接入只需要新增 adapter/provider 和配置，不需要改核心推荐逻辑。

### Phase 2：产品稳定后，接入中国基础能力试点

前置条件：海外版 AI 分析、推荐、订阅闭环稳定。

任务：

- 接入 CN AI provider 的真实生产 key 与模型策略。
- 手机号/微信登录按 CN profile 默认展示。
- OSS/COS 或中国云存储试点。
- 中国内容审核 provider 试点。
- Android 中国支付接入方式复评，默认仍以 RevenueCat 能力抽象为主。
- 设计中国节点部署方案，但不急于迁移核心数据。

验收标准：

- 小规模中国测试用户可以完成登录、分析、订阅/支付沙箱流程。
- CN 流量不会依赖 Firebase/OpenAI/OpenRouter 作为必需链路。
- 日志和 usage records 能区分 region/provider/model。

### Phase 3：真正中国化

前置条件：明确中国运营主体、发行渠道、合规预算和商业目标。

任务：

- ICP 备案与域名解析策略。
- 中国云节点与数据驻留策略。
- PIPL 个人信息与敏感信息处理规则。
- 国内 Android 渠道发行。
- 小程序或微信生态产品化。
- 内容审核、投诉处理、用户协议、隐私政策中国版本。

## 优先级任务清单

### P0：立即做

- 创建 `RegionStrategyService`。
- 创建 `/api/app/capabilities`。
- AI 调用禁止新增直连 provider，统一走 `LlmService` 或 Gateway。
- Provider/model 配置补 region 字段方案。
- Notion 中建立架构与决策文档入口。

### P1：近期做

- `AuthProviderRegistry` 包装现有认证方式。
- `BillingProvider` 包装 RevenueCat、WeChatPay。
- `StorageProvider` 抽象现有 storage module。
- UsageRecords 增加 region/provider/model 的可观测性检查。
- 管理后台展示 provider 的 region 可用性。

### P2：产品稳定后做

- DeepSeek/Qwen 按 CN 策略正式配置。
- 阿里云/腾讯云短信与内容审核。
- OSS/COS。
- 中国 Android 支付。
- 中国节点 PoC。

## 决策记录

### ADR-001：不做中国版重写

决策：采用“全球主系统 + 中国区域适配层”。

原因：EatCheck 的核心复杂度在 AI 分析、推荐、用户画像、食物数据库和订阅权益。双系统会导致模型质量、数据口径、实验结果、研发节奏全部分裂。

### ADR-002：Phase 1 不做双数据库

决策：当前不做 Global/CN 双数据库。

原因：双数据库会引入数据同步、账号迁移、订阅权益一致性、AI usage 统计和合规边界问题。当前阶段只需要 region-aware provider routing。

### ADR-003：Flutter 单包，能力由服务端下发

决策：Flutter 保持单包，登录方式、支付方式、AI 能力和合规提示由 `/api/app/capabilities` 下发。

原因：客户端 hardcode 区域差异会导致审核、灰度、配置和运营复杂度上升。

### ADR-004：AI 统一走服务端 Gateway

决策：App 不直连 AI provider，业务模块也应逐步避免直连 provider。AI 请求进入 NestJS Gateway/LLM Router 后由 region、capability、quota、cost、fallback 策略决策。

原因：AI 是成本、稳定性、合规和体验的共同风险点，必须服务端集中治理。

## 风险与注意事项

- 不要把 CN 当成默认 region。当前默认仍应服务全球/海外增长。
- 不要让中国合规需求反向污染全球主流程。通过 capability 和 provider strategy 隔离。
- 不要把 RevenueCat、Firebase、OpenAI 当成核心业务依赖，它们都应只是 provider。
- 不要在核心推荐逻辑里写 provider/region 分支。推荐逻辑只消费统一上下文和标准化结果。
- 不要为了未来中国区过早做双集群、双库、双 app。先把抽象边界做对。

## 下一步建议

1. 在 Notion 建立项目文档主页，本文作为“架构决策/区域化适配”首篇。
2. 从 P0 开始开实施任务：Region Strategy、Capabilities API、AI routed mode。
3. 每完成一个抽象，都补一篇 ADR，防止后续研发把 provider 写回业务层。
