---
title: Region Strategy 落地方案
type: architecture
status: implemented
created: 2026-05-13
tags:
  - EatCheck
  - region-strategy
  - architecture
---

# Region Strategy 落地方案

## 目标

新增统一区域策略服务，建议位置：

`apps/api-server/src/core/region/region-strategy.service.ts`

职责：

- 根据用户档案、请求 header、locale、timezone、IP 推断运行区域
- 输出当前请求可用能力表
- 为 Auth、AI、Billing、Storage、Push、SMS、Moderation 提供 provider 选择依据
- 支持灰度、强制覆盖和后台配置
- 提供后台管理能力，用于查看默认策略、配置 region override、重置 region override

## RuntimeRegion

```ts
type RuntimeRegion = 'GLOBAL' | 'CN';
```

Phase 1 默认：

- `GLOBAL` 为默认运行区域
- `CN` 仅作为能力配置存在
- 不默认启用 CN 正式生产流量
- 允许通过后台配置或环境变量把测试用户强制切到 CN profile

## Capability Profile

```ts
interface RegionCapabilityProfile {
  region: RuntimeRegion;
  countryCode?: string;
  locale?: string;
  timezone?: string;
  authMethods: string[];
  aiProviders: string[];
  aiModelRouting: {
    foodTextAnalysis: {
      provider: string;
      primaryModel: string;
      fallbackModel?: string;
    };
    foodImageAnalysis: {
      provider: string;
      primaryModel: string;
      fallbackModel?: string;
    };
  };
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

## 新增 API

`GET /api/app/capabilities`

客户端启动后调用，返回当前区域能力表。

Global 示例：

```json
{
  "region": "GLOBAL",
  "countryCode": "US",
  "locale": "en-US",
  "timezone": "America/New_York",
  "authMethods": ["apple", "google", "email", "anonymous"],
  "billingMethods": ["apple_iap", "google_play", "revenuecat"],
  "aiModelRouting": {
    "foodTextAnalysis": {
      "provider": "deepseek",
      "primaryModel": "deepseek-chat"
    },
    "foodImageAnalysis": {
      "provider": "openrouter",
      "primaryModel": "qwen/qwen3-vl-32b-instruct",
      "fallbackModel": "qwen/qwen-vl-plus"
    }
  },
  "compliance": {
    "medicalDisclaimerRequired": true,
    "contentModerationRequired": false,
    "dataResidencyRequired": false
  }
}
```

CN 示例：

```json
{
  "region": "CN",
  "countryCode": "CN",
  "locale": "zh-CN",
  "timezone": "Asia/Shanghai",
  "authMethods": ["phone", "wechat"],
  "billingMethods": ["revenuecat"],
  "aiModelRouting": {
    "foodTextAnalysis": {
      "provider": "deepseek",
      "primaryModel": "deepseek-chat"
    },
    "foodImageAnalysis": {
      "provider": "openrouter",
      "primaryModel": "qwen/qwen3-vl-32b-instruct",
      "fallbackModel": "qwen/qwen-vl-plus"
    }
  },
  "compliance": {
    "piplMode": true,
    "medicalDisclaimerRequired": true,
    "contentModerationRequired": true,
    "dataResidencyRequired": true
  }
}
```

## 后台管理 API

管理后台接口前缀：

`/api/admin/region-strategy`

权限：

- `JwtAuthGuard`
- `RolesGuard`
- `admin` / `super_admin`

接口：

| Method | Path | 用途 |
|---|---|---|
| GET | `/api/admin/region-strategy` | 查看全部 region 的默认配置、override、effective profile |
| GET | `/api/admin/region-strategy/:region` | 查看单个 region 配置 |
| PUT | `/api/admin/region-strategy/:region` | 更新 region override |
| DELETE | `/api/admin/region-strategy/:region` | 重置 region override |

支持 region：

- `GLOBAL`
- `CN`

`PUT /api/admin/region-strategy/CN` 示例：

```json
{
  "aiProviders": ["qwen"],
  "aiModelRouting": {
    "foodTextAnalysis": {
      "provider": "deepseek",
      "primaryModel": "deepseek-chat"
    },
    "foodImageAnalysis": {
      "provider": "openrouter",
      "primaryModel": "qwen/qwen3-vl-32b-instruct",
      "fallbackModel": "qwen/qwen-vl-plus"
    }
  },
  "storageProvider": "oss",
  "pushProviders": ["apns", "jpush"],
  "smsProvider": "aliyun",
  "moderationProvider": "aliyun",
  "compliance": {
    "contentModerationRequired": true,
    "dataResidencyRequired": true
  }
}
```

可配置字段：

- `countryCode`
- `locale`
- `timezone`
- `authMethods`
- `billingMethods`
- `aiFeatures`
- `aiProviders`
- `aiModelRouting`
- `storageProvider`
- `pushProviders`
- `smsProvider`
- `moderationProvider`
- `compliance`

规则：

- 默认 profile 仍由代码提供，保证无后台配置时行为稳定。
- 后台只保存 override，不直接改默认 profile。
- effective profile = default profile + override。
- `aiFeatures`、`aiModelRouting` 与 `compliance` 支持局部覆盖。
- `authMethods` / `billingMethods` 未配置 override 时，`/api/app/capabilities` 使用 provider registry 默认值。
- `authMethods` / `billingMethods` 一旦配置 override，`/api/app/capabilities` 优先返回后台配置。
- 当前 override 使用 Redis 持久化，并在内存中保留运行时副本；Redis 不可用时仍可在当前进程内生效。

## 后台管理页面

页面路径：

`/system/region-strategy`

菜单位置：

- 系统管理
- Region Strategy

页面能力：

- 展示 `GLOBAL` / `CN` 两个 region 卡片。
- 查看每个 region 的 effective profile。
- 查看当前 override JSON。
- 编辑 region override。
- 重置 region override。
- 刷新后台配置。

编辑表单包含：

- Country Code
- Locale
- Timezone
- Auth Methods
- Billing Methods
- AI Providers
- AI Model Routing：text provider、text primary model、text fallback model、vision provider、vision primary model、vision fallback model
- Push Providers
- Storage Provider
- SMS Provider
- Moderation Provider
- AI Features：food image analysis、coach chat、streaming
- Compliance：PIPL、data residency、content moderation、medical disclaimer

页面实现：

- `apps/admin/src/services/regionStrategyService.ts`
- `apps/admin/src/pages/system/region-strategy/index.tsx`
- `apps/admin/src/services/path.ts`

页面流程：

1. 进入 `/system/region-strategy`。
2. 查看 `GLOBAL` / `CN` 的当前 effective profile。
3. 点击“编辑”，修改 region override。
4. 保存后后台写入 `/api/admin/region-strategy/:region`。
5. App capabilities 读取新的 effective profile。
6. 如需恢复默认，点击“重置”，调用 `DELETE /api/admin/region-strategy/:region`。

## AI 模型路由运行时接入

当前已新增：

- `RegionAiModelRoutingService`
- `resolveFoodTextAnalysis(context)`
- `resolveFoodImageAnalysis(context)`

运行时解析内容：

- `region`
- `provider`
- `model`
- `fallbackModel`
- `apiKey`
- `baseUrl`

已接入业务链路：

- `TextFoodAnalysisService`：LLM 补位解析使用 `foodTextAnalysis` route。
- `VisionApiClient`：图片识别主模型与 fallback 使用 `foodImageAnalysis` route。
- `ImageNutritionFillService`：图片分析后的营养补全使用 `foodTextAnalysis` route。
- 本地测试入口：`POST /api/dev/food/analyze-text`，无 App 登录、无额度扣减、无分析记录持久化，仅在非 production 且 `ENABLE_TEXT_ANALYSIS_TEST_ENDPOINT=true` 时启用。

当前 context 来源：

- 优先使用调用方传入的 `locale` 解析 region。
- `zh-CN` 会落到 `CN`。
- 其它 locale 默认落到 `GLOBAL`。

强制地区策略：

```bash
REGION_STRATEGY_FORCE_REGION=GLOBAL
# 或
REGION_STRATEGY_FORCE_REGION=CN
```

规则：

- 配置后优先级最高，覆盖 `locale` / `regionCode` 推断。
- `GLOBAL` 会固定使用 Global capability profile。
- `CN` 会固定使用 China capability profile。
- 未配置或配置非法值时，继续使用现有自动推断逻辑。

## 文本分析本地测试

环境开关：

```bash
REGION_STRATEGY_FORCE_REGION=GLOBAL
ENABLE_TEXT_ANALYSIS_TEST_ENDPOINT=true
```

启动 API：

```bash
PORT=3007 pnpm --dir apps/api-server dev
```

食物库 + LLM 拆分链路测试：

```bash
curl -sS -X POST http://127.0.0.1:3007/api/dev/food/analyze-text \
  -H 'Content-Type: application/json' \
  -d '{"text":"一碗米饭 一个鸡蛋","mealType":"lunch","locale":"zh-CN"}'
```

自然语言组合食物测试：

```bash
curl -sS -X POST http://127.0.0.1:3007/api/dev/food/analyze-text \
  -H 'Content-Type: application/json' \
  -d '{"text":"半份巴西莓碗加奇亚籽和花生酱","mealType":"breakfast","locale":"zh-CN","hints":["按常见门店份量估算"]}'
```

当前验证结果：

- 接口返回 `200`。
- 日志显示 `region=GLOBAL provider=deepseek model=deepseek-chat`。
- `persistRecord=false`，不会写入正式分析记录。
- 该入口只用于本地联调；正式 App 仍使用 `POST /api/app/food/analyze-text` 并经过 App JWT、quota、entitlement。

后续需要补强：

- 从 user profile 的 `homeRegion` / `regionCode` 传入 context。
- 后台增加灰度条件，避免模型路由变更直接影响全量用户。

## 数据模型建议

Provider/Model：

- `providers.regions`
- `providers.blockedRegions`
- `providers.complianceTags`
- `model_configs.featureKey`
- `model_configs.regionPriority`

User：

- `app_users.homeRegion`
- 继续使用 `user_profiles.regionCode/timezone/locale`

Subscription：

- 强化 `store_products.provider/store/region/currency`
- `payment_records.region/providerEventId/providerPayload`

File：

- `storageRegion`
- `storageProvider`
- `objectKey`

## 当前实现

已落地：

- `apps/api-server/src/core/region/region-strategy.service.ts`
- `apps/api-server/src/core/region/region-strategy-admin.service.ts`
- `apps/api-server/src/core/region/region-defaults.ts`
- `apps/api-server/src/core/region/region.types.ts`
- `apps/api-server/src/core/region/region.module.ts`
- `apps/api-server/src/modules/capabilities/app/app-capabilities.controller.ts`
- `apps/api-server/src/modules/capabilities/admin/region-strategy-admin.controller.ts`
- `apps/api-server/src/modules/capabilities/admin/dto/region-strategy-admin.dto.ts`
- `apps/api-server/src/modules/capabilities/capabilities.module.ts`

当前能力：

- 默认返回 `GLOBAL` capability profile。
- 当 `regionCode=CN` 或 `locale=zh-CN` 时返回 `CN` capability profile。
- Global 默认登录方式：Apple、Google、Email、Anonymous。
- CN 默认登录方式：Phone、WeChat。
- Global 默认支付方式：Apple IAP、Google Play、RevenueCat。
- CN 默认支付方式：RevenueCat。
- 合规开关已在 capability profile 中表达：PIPL、数据驻留、内容审核、医疗免责声明。
- 后台可查看、更新、重置 `GLOBAL` / `CN` region override。
- 后台 override 会影响 `/api/app/capabilities` 返回的 effective profile。
- `authMethods` / `billingMethods` 默认由 provider registry 输出；后台配置 override 后优先生效。
- 管理后台页面 `/system/region-strategy` 已接入完整查看、编辑、重置流程。
- `AiModelRouter` 已支持按 provider/model 的 region metadata 过滤模型。
- food enrichment 已可通过环境变量进入 routed AI Gateway。

当前 seed 约定：

- OpenAI / Anthropic：`GLOBAL`，并显式 `blockedRegions: ["CN"]`。
- DeepSeek：`GLOBAL` / `CN`。
- Qwen：`CN`。

后续增强：

- 接入用户 `homeRegion` 和 `user_profiles.regionCode/timezone/locale`。
- 增加灰度覆盖、用户白名单、App version 条件和 store 条件。
- 将 IP/请求 header 推断作为低优先级兜底，不作为强制区域切换依据。
- 如果 region strategy 开始承载更复杂运营配置，再将 Redis override 升级为 Prisma 持久表并增加审计日志。
