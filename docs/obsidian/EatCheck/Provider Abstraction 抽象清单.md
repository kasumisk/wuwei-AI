---
title: Provider Abstraction 抽象清单
type: architecture
status: draft
created: 2026-05-13
tags:
  - EatCheck
  - provider-abstraction
  - architecture
---

# Provider Abstraction 抽象清单

## 总原则

核心业务不认识具体供应商。业务模块只表达能力需求，例如：

- `food_image_analysis`
- `coach_chat`
- `food_enrichment`
- `subscription_checkout`
- `sms_verification`
- `content_moderation`

供应商选择由 [[Region Strategy 落地方案]] 和 provider registry 决定。

## AIProvider

当前已有基础：

- `apps/api-server/src/core/ai-runtime/adapters/base.adapter.ts`
- `OpenAIAdapter`
- `OpenRouterAdapter`
- `DeepSeekAdapter`
- `QwenAdapter`
- `AiModelRouter`
- `AiRuntimeService`

当前进展：

- `AiRuntimeService.chatRouted()` 已新增
- `AiModelRouter.route()` 已增加 `region` 参数
- Provider `metadata` 与 Model `configMetadata` 已支持 `regions`、`blockedRegions`
- `seed-data.ts` 已为 OpenAI、Anthropic、DeepSeek、Qwen、OpenRouter 写入默认 region metadata
- `seed-data.ts` 已初始化项目当前使用的模型：
  - `TEXT_ANALYSIS_MODEL=deepseek-chat`
  - `VISION_MODEL=qwen/qwen3-vl-32b-instruct`
  - `VISION_MODEL_FALLBACK=qwen/qwen-vl-plus`
- `RegionStrategyService` 已输出 `aiModelRouting`，后台可按 region 配置文本分析与视觉分析的 provider / primary model / fallback model
- `RegionAiModelRoutingService` 已新增，负责把 region profile 的模型路由解析为业务可直接调用的 provider / model / fallback / apiKey / baseUrl
- AI 管理能力类型已统一到 `@ai-platform/shared` 的 canonical `CapabilityType`；后台不再展示或提交 `text.food_analysis`、`text.recipe_generation`、`text.rerank_embedding` 等旧业务伪能力值
- 视觉模型作为 UI 虚拟选项处理：保存为 `text.generation` + `features.vision=true`，避免新增与 Gateway capability 不一致的枚举
- `TextFoodAnalysisService` 已接入 `RegionAiModelRoutingService.resolveFoodTextAnalysis()`，实际文本食物分析不再只读固定 env model
- `VisionApiClient` 已接入 `RegionAiModelRoutingService.resolveFoodImageAnalysis()`，实际图片食物分析的主模型和 fallback 由 Region Strategy 控制
- `ImageNutritionFillService` 已接入 `RegionAiModelRoutingService.resolveFoodTextAnalysis()`，图片后的营养补全复用文本分析模型策略
- `EnrichmentAiClient` 已支持可选 routed mode，作为第一条业务 AI 迁移链路
- 后续再评估是否将 `regions`、`blockedRegions`、`complianceTags` 字段从 JSON 提升为 Prisma schema 显式字段
- 业务模块停止新增直连 OpenAI/OpenRouter 代码

已实现的最小约定：

```json
{
  "regions": ["CN"],
  "blockedRegions": ["GLOBAL"]
}
```

该配置可以放在：

- `providers.metadata`
- `model_configs.configMetadata`

Router 会同时检查 provider 和 model 两层配置，任意一层 blocked 或不包含目标 region，都会被过滤。

Food enrichment 当前开关：

```bash
LLM_ROUTED_CLIENT_ID=app-client
LLM_ROUTED_REGION=CN
LLM_ROUTED_MODEL=qwen-plus
```

不设置 `LLM_ROUTED_CLIENT_ID` 时继续使用原 DeepSeek 直连路径，便于灰度。

Recipe generation 当前开关：

```bash
RECIPE_LLM_ROUTED_CLIENT_ID=app-client
RECIPE_LLM_ROUTED_REGION=CN
RECIPE_LLM_ROUTED_MODEL=qwen-plus
```

不设置 recipe 专属变量时可回退读取全局 `LLM_ROUTED_*`；完全不设置时继续使用原 OpenRouter/OpenAI key 路径。

建议策略：

| Region | 默认文本模型 | 视觉/图像分析 | 兜底 |
|---|---|---|---|
| Global | DeepSeek `deepseek-chat` | OpenRouter `qwen/qwen3-vl-32b-instruct` | OpenRouter `qwen/qwen-vl-plus` |
| CN | DeepSeek `deepseek-chat` | OpenRouter `qwen/qwen3-vl-32b-instruct` | OpenRouter `qwen/qwen-vl-plus`，正式中国区上线前需替换为合规国内链路 |

## AuthProvider

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

- `FirebaseAuthProvider`
- `PhoneSmsAuthProvider`
- `WechatAuthProvider`

当前决策：

- Global 只抽象为 `FirebaseAuthProvider`。
- Apple、Google、Email、Anonymous 都作为 FirebaseAuthProvider 支持的登录 method，不再拆独立 provider。
- CN 增加 `PhoneSmsAuthProvider` 与 `WechatAuthProvider`。
- CN 暂不把 Firebase/Google/Apple 作为必需登录链路。

短期做法：

- 保留现有 `/api/app/auth/*`
- 内部逐步改为 `AuthProviderRegistry`
- 登录页通过 `/api/app/capabilities` 展示可用登录方式

当前进展：

- `AppAuthProviderRegistry` 已新增。
- `/api/app/capabilities` 的 `authMethods` 已从 registry 输出。
- Global provider：`firebase_auth`，methods：Apple、Google、Email、Anonymous。
- CN providers：`phone_sms`、`wechat`，methods：Phone、WeChat。
- 现有登录流程暂不重写，先完成能力抽象与客户端展示入口收敛。

## BillingProvider

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

- `RevenueCatBillingProvider`
- `WechatPayBillingProvider`
- `AlipayBillingProvider`

当前决策：

- IAP 不拆独立 `AppleIapBillingProvider`。
- App Store / Google Play 统一由 `RevenueCatBillingProvider` 承接。
- CN Phase 1 也统一暴露 RevenueCat，不在当前阶段启用 WeChat Pay / Alipay 作为 capability。
- WeChat Pay / Alipay 作为未来中国 Android / 小程序商业化预留，不进入当前默认能力表。

关键规则：

- 订阅权益语义统一
- 支付 provider 只负责交易和回调
- IAP 统一走 RevenueCat 抽象，不在业务层区分 Apple IAP provider
- Android 中国发行需要单独决策后再启用微信/支付宝
- `SubscriptionService` 继续作为订阅状态真相源

当前进展：

- `BillingProviderRegistry` 已新增。
- `/api/app/capabilities` 的 `billingMethods` 已从 registry 输出。
- Global provider：`revenuecat`，methods：Apple IAP、Google Play、RevenueCat。
- CN provider：`revenuecat`，method：RevenueCat。
- 现有 RevenueCat webhook、订阅权益同步暂不重写，先完成能力抽象与客户端展示入口收敛。

## StorageProvider

建议接口：

```ts
interface StorageProvider {
  putObject(input: PutObjectInput): Promise<StoredObject>;
  getSignedUrl(input: SignedUrlInput): Promise<string>;
  deleteObject(key: string): Promise<void>;
}
```

策略：

- Global：GCP Storage 或兼容 S3
- CN：OSS/COS

文件表不要存云厂商 URL，只存逻辑 key、region、bucket scope。

## ModerationProvider

建议接口：

```ts
interface ModerationProvider {
  moderateText(input: ModerationTextInput): Promise<ModerationResult>;
  moderateImage(input: ModerationImageInput): Promise<ModerationResult>;
}
```

使用点：

- 用户输入的食物描述
- 聊天内容
- AI 输出健康建议
- 图片上传和识别结果

CN 区应强制启用，Global 可按风险启用。
