# API Server 项目目录结构优化方案

> 生成时间: 2026-04-12
> 当前状态: 424 个文件，101 个目录，6 个空目录

---

## 一、当前问题诊断

### 1.1 严重问题：文件堆积目录

| 目录                       | 直接文件数 | 严重性  | 问题描述                                            |
| -------------------------- | ---------- | ------- | --------------------------------------------------- |
| `diet/app/recommendation/` | **71**     | 🔴 严重 | 类型定义、召回、评分、解释、优化、反馈、ML 全部打平 |
| `diet/app/`                | **20**     | 🟠 高   | 控制器、服务、DTO、处理器、监听器混放               |
| `food/app/`                | **18**     | 🟠 高   | 分析相关和食物库相关文件混放                        |
| `subscription/app/`        | **17**     | 🟠 高   | 苹果/微信支付、订阅核心、配额、paywall 混放         |
| `diet/admin/`              | **15**     | 🟠 高   | 所有后台管理服务和控制器打平                        |
| `user/app/`                | **15**     | 🟠 高   | 用户画像、流失预测、目标追踪混放                    |
| `food-pipeline/services/`  | **14**     | 🟡 中   | 数据源、清洗、AI、调度全部打平                      |
| `scripts/`                 | **12**     | 🟡 中   | 种子脚本和工具脚本混放                              |

### 1.2 其他问题

- **6 个空目录**: `diet/app/controller/`, `diet/app/dto/`, `diet/app/services/`, `food/app/dto/`, `user/app/controller/`, `user/app/services/` — 废弃的重构痕迹
- **DTO 位置不一致**: 部分 DTO 在 `dto/` 子目录，部分直接放在 `app/` 层级（如 `food.dto.ts`, `analyze-text.dto.ts`）
- **类型文件位置不一致**: 部分 `.types.ts` 在模块根目录，部分在 `app/` 层级，71 个在 `recommendation/` 打平

---

## 二、优化后的目录结构

> 约定:
>
> - `[+]` = 新增目录
> - `[M]` = 文件移入（从其他位置迁移）
> - `[K]` = 保持不变
> - 只展示变动部分，未提及的文件保持原位

```
apps/api-server/src/
├── main.ts                                    [K]
├── app.module.ts                              [K]
├── app.controller.ts                          [K]
├── app.controller.spec.ts                     [K]
├── app.service.ts                             [K]
│
├── common/                                    [K] 通用工具
│   ├── types/
│   │   └── response.type.ts
│   └── utils/
│       └── timezone.util.ts
│
├── core/                                      [K] 基础设施 (保持现有结构)
│   ├── core.module.ts
│   ├── cache/
│   ├── circuit-breaker/
│   ├── config/
│   ├── context/
│   ├── decorators/
│   ├── events/
│   ├── filters/
│   ├── i18n/
│   ├── interceptors/
│   ├── logger/
│   ├── metrics/
│   ├── middlewares/
│   ├── prisma/
│   ├── queue/
│   ├── redis/
│   ├── swagger/
│   └── throttle/
│
├── compress/                                  [K] 压缩服务
│   ├── compress.module.ts
│   ├── compress.controller.ts
│   └── compress.service.ts
│
├── health/                                    [K] 健康检查
│   ├── health.module.ts
│   └── health.controller.ts
│
├── storage/                                   [K] 文件存储
│   ├── storage.module.ts
│   ├── storage.service.ts
│   ├── index.ts
│   └── dto/
│       └── upload.dto.ts
│
├── gateway/                                   [K] AI 网关 (结构已合理)
│   ├── gateway.module.ts
│   ├── gateway.controller.ts
│   ├── gateway.service.ts
│   ├── adapters/
│   ├── dto/
│   ├── guards/
│   └── services/
│
├── langchain/                                 [K] LangChain 集成
│   ├── langchain.module.ts
│   ├── langchain.controller.ts
│   ├── langchain.service.ts
│   └── services/
│       └── rag.service.ts
│
├── food-pipeline/                             食物数据管线
│   ├── food-pipeline.module.ts                [K]
│   ├── food-enrichment.processor.ts           [K]
│   │
│   ├── controllers/                           [+] 控制器目录
│   │   ├── food-pipeline.controller.ts        [M] ← 原 food-pipeline.controller.ts
│   │   └── food-enrichment.controller.ts      [M] ← 原 food-enrichment.controller.ts
│   │
│   └── services/
│       ├── fetchers/                          [+] 数据源抓取
│       │   ├── usda-fetcher.service.ts        [M]
│       │   ├── openfoodfacts.service.ts        [M]
│       │   └── cn-food-composition-importer.service.ts [M]
│       │
│       ├── processing/                        [+] 数据清洗处理
│       │   ├── food-data-cleaner.service.ts   [M]
│       │   ├── food-dedup.service.ts          [M]
│       │   ├── food-conflict-resolver.service.ts [M]
│       │   └── food-rule-engine.service.ts    [M]
│       │
│       ├── ai/                                [+] AI 增强
│       │   ├── food-ai-label.service.ts       [M]
│       │   ├── food-ai-translate.service.ts   [M]
│       │   └── food-image-recognition.service.ts [M]
│       │
│       ├── food-pipeline-orchestrator.service.ts [K] 编排器
│       ├── food-enrichment.service.ts         [K]
│       ├── food-sync-scheduler.service.ts     [K]
│       └── food-quality-monitor.service.ts    [K]
│
├── scripts/                                   脚本
│   ├── seeds/                                 [+] 种子数据
│   │   ├── seed-admin.ts                      [M]
│   │   ├── seed-permissions.ts                [M]
│   │   ├── seed-foods.ts                      [M]
│   │   ├── seed-foods.data.ts                 [M]
│   │   ├── seed-data.ts                       [M]
│   │   ├── seed-test-client.ts                [M]
│   │   ├── seed-app-versions.ts               [M]
│   │   ├── seed-subscription-plans.ts         [M]
│   │   └── seed-subscription-plans.shared.ts  [M]
│   │
│   ├── tools/                                 [+] 工具脚本
│   │   ├── recalc-streak-compliance.ts        [M]
│   │   └── import-json-vision.ts              [M]
│   │
│   └── init-system.ts                         [K] 入口
│
│
│
└── modules/
    │
    ├── analytics/                             [K] 分析 (结构已合理)
    │   ├── analytics.module.ts
    │   └── admin/
    │       ├── analytics.service.ts
    │       ├── analytics.controller.ts
    │       ├── conversion-funnel.service.ts
    │       ├── conversion-funnel.controller.ts
    │       └── dto/
    │
    ├── app-version/                           [K] 版本管理 (结构已合理)
    │   ├── app-version.module.ts
    │   ├── app-version.types.ts
    │   ├── admin/
    │   └── app/
    │
    ├── auth/                                  [K] 认证 (结构已合理)
    │   ├── auth.module.ts
    │   ├── admin/
    │   └── app/
    │
    ├── client/                                [K] 客户端管理 (结构已合理)
    │   ├── client.module.ts
    │   └── admin/
    │
    ├── coach/                                 [K] AI 教练 (结构已合理)
    │   ├── coach.module.ts
    │   └── app/
    │
    ├── feature-flag/                          [K] 功能开关 (结构已合理)
    │   ├── feature-flag.module.ts
    │   ├── feature-flag.service.ts
    │   ├── feature-flag.types.ts
    │   └── admin/
    │
    ├── file/                                  [K] 文件 (结构已合理)
    │   ├── file.module.ts
    │   ├── app/
    │   └── admin/
    │
    ├── gamification/                          [K] 游戏化 (结构已合理)
    │   ├── gamification.module.ts
    │   ├── app/
    │   └── admin/
    │
    ├── notification/                          [K] 通知 (结构已合理)
    │   ├── notification.module.ts
    │   ├── notification.types.ts
    │   └── app/
    │
    ├── provider/                              [K] AI 提供商 (结构已合理)
    │   ├── provider.module.ts
    │   └── admin/
    │
    ├── rbac/                                  [K] 权限 (结构已合理)
    │   ├── rbac.module.ts
    │   ├── rbac.types.ts
    │   └── admin/
    │
    ├── recipe/                                [K] 食谱 (结构已合理)
    │   ├── recipe.module.ts
    │   ├── recipe.types.ts
    │   ├── app/
    │   └── admin/
    │
    ├── strategy/                              [K] 策略 (结构已合理)
    │   ├── strategy.module.ts
    │   ├── strategy.types.ts
    │   ├── app/
    │   └── admin/
    │
    │
    │
    │   ┌─────────────────────────────────────┐
    │   │  以下 4 个模块为重点重构对象         │
    │   └─────────────────────────────────────┘
    │
    │
    ├── diet/                                  🔴 饮食推荐 (重点重构)
    │   ├── diet.module.ts                     [K]
    │   ├── diet.types.ts                      [K]
    │   ├── recommendation.module.ts           [K]
    │   ├── tracking.module.ts                 [K]
    │   ├── explanation.module.ts              [K]
    │   │
    │   ├── admin/
    │   │   ├── controllers/                   [+]
    │   │   │   ├── scoring-config.controller.ts           [M]
    │   │   │   ├── binge-intervention.controller.ts       [M]
    │   │   │   ├── thompson-sampling.controller.ts        [M]
    │   │   │   ├── strategy-effectiveness.controller.ts   [M]
    │   │   │   ├── content-management.controller.ts       [M]
    │   │   │   ├── recommendation-debug.controller.ts     [M]
    │   │   │   └── ab-experiment-management.controller.ts [M]
    │   │   │
    │   │   ├── services/                      [+]
    │   │   │   ├── binge-intervention.service.ts          [M]
    │   │   │   ├── thompson-sampling.service.ts           [M]
    │   │   │   ├── strategy-effectiveness.service.ts      [M]
    │   │   │   ├── content-management.service.ts          [M]
    │   │   │   ├── recommendation-debug.service.ts        [M]
    │   │   │   ├── recommendation-quality.service.ts      [M]
    │   │   │   ├── ab-experiment-management.service.ts    [M]
    │   │   │   └── app-data-query.service.ts              [M]
    │   │   │
    │   │   └── dto/                           [K]
    │   │       ├── ab-experiment-management.dto.ts
    │   │       ├── recommendation-debug.dto.ts
    │   │       └── content-management.dto.ts
    │   │
    │   └── app/
    │       ├── controllers/                   [+] (利用已有空目录 controller/ → 改名)
    │       │   ├── food-record.controller.ts           [M]
    │       │   ├── food-plan.controller.ts             [M]
    │       │   ├── food-nutrition.controller.ts        [M]
    │       │   ├── food-summary.controller.ts          [M]
    │       │   └── food-behavior.controller.ts         [M]
    │       │
    │       ├── services/                      [+] (利用已有空目录)
    │       │   ├── food.service.ts                     [M]
    │       │   ├── food-i18n.service.ts                [M]
    │       │   ├── food-record.service.ts              [M]
    │       │   ├── daily-plan.service.ts               [M]
    │       │   ├── weekly-plan.service.ts              [M]
    │       │   ├── daily-summary.service.ts            [M]
    │       │   ├── behavior.service.ts                 [M]
    │       │   ├── nutrition-score.service.ts          [M]
    │       │   ├── precompute.service.ts               [M]
    │       │   ├── export.service.ts                   [M]
    │       │   └── recommendation-engine.service.ts    [M]
    │       │
    │       ├── dto/                            [+] (利用已有空目录)
    │       │   └── food.dto.ts                         [M]
    │       │
    │       ├── listeners/                     [+]
    │       │   └── recommendation-event.listener.ts    [M]
    │       │
    │       ├── processors/                    [+]
    │       │   ├── precompute.processor.ts             [M]
    │       │   └── export.processor.ts                 [M]
    │       │
    │       └── recommendation/                🔴🔴 核心推荐引擎 (71→0 打平文件)
    │           │
    │           ├── types/                     [+] 类型定义 (13个文件)
    │           │   ├── recommendation.types.ts
    │           │   ├── recommendation-strategy.types.ts
    │           │   ├── scoring.types.ts
    │           │   ├── scene.types.ts
    │           │   ├── scene-scoring.types.ts
    │           │   ├── health.types.ts
    │           │   ├── meal.types.ts
    │           │   ├── meal-template.types.ts
    │           │   ├── insight.types.ts
    │           │   ├── explanation.types.ts
    │           │   ├── config.types.ts
    │           │   ├── pipeline.types.ts
    │           │   └── scoring-explanation.interface.ts
    │           │
    │           ├── pipeline/                  [+] 核心管线 (9个文件)
    │           │   ├── food-scorer.service.ts
    │           │   ├── constraint-generator.service.ts
    │           │   ├── recommendation-strategy-resolver.service.ts
    │           │   ├── strategy-resolver-facade.service.ts
    │           │   ├── recommendation.config.ts
    │           │   ├── pipeline-builder.service.ts
    │           │   ├── food-filter.service.ts
    │           │   ├── food-pool-cache.service.ts
    │           │   └── nutrition-target.service.ts
    │           │
    │           ├── scoring-chain/             [K] 评分链 (已有子目录, 保持)
    │           │   ├── index.ts
    │           │   ├── scoring-chain.service.ts
    │           │   ├── scoring-factor.interface.ts
    │           │   └── factors/               [K] 11个评分因子
    │           │       ├── index.ts
    │           │       ├── popularity.factor.ts
    │           │       ├── short-term-profile.factor.ts
    │           │       ├── lifestyle-boost.factor.ts
    │           │       ├── preference-signal.factor.ts
    │           │       ├── analysis-profile.factor.ts
    │           │       ├── scene-context.factor.ts
    │           │       ├── collaborative-filtering.factor.ts
    │           │       ├── rule-weight.factor.ts
    │           │       ├── replacement-feedback.factor.ts
    │           │       └── regional-boost.factor.ts
    │           │
    │           ├── recall/                    [+] 召回层 (6个文件)
    │           │   ├── collaborative-filtering.service.ts
    │           │   ├── cf-recall.service.ts
    │           │   ├── semantic-recall.service.ts
    │           │   ├── recall-merger.service.ts
    │           │   ├── vector-search.service.ts
    │           │   └── food-embedding.ts
    │           │
    │           ├── embedding/                 [+] 向量嵌入 (2个文件)
    │           │   ├── embedding-generation.service.ts
    │           │   └── embedding-generation.processor.ts
    │           │
    │           ├── meal/                      [+] 套餐组装 (4个文件)
    │           │   ├── meal-assembler.service.ts
    │           │   ├── meal-template.service.ts
    │           │   ├── recipe-assembler.service.ts
    │           │   └── meal-composition-scorer.service.ts
    │           │
    │           ├── explanation/               [+] 解释生成 (8个文件)
    │           │   ├── explanation-generator.service.ts
    │           │   ├── natural-language-explainer.service.ts
    │           │   ├── comparison-explanation.service.ts
    │           │   ├── meal-explanation.service.ts
    │           │   ├── adaptive-explanation-depth.service.ts
    │           │   ├── explanation-ab-tracker.service.ts
    │           │   ├── explanation-tier.service.ts
    │           │   └── insight-generator.service.ts
    │           │
    │           ├── profile/                   [+] 用户画像聚合 (6个文件)
    │           │   ├── profile-aggregator.service.ts
    │           │   ├── preference-profile.service.ts
    │           │   ├── preference-updater.service.ts
    │           │   ├── profile-event-listener.service.ts
    │           │   ├── profile-event-bus.service.ts
    │           │   └── profile-scoring-mapper.ts
    │           │
    │           ├── optimization/              [+] 排序优化与学习 (5个文件)
    │           │   ├── learned-ranking.service.ts
    │           │   ├── factor-learner.service.ts
    │           │   ├── weight-learner.service.ts
    │           │   ├── multi-objective-optimizer.ts
    │           │   └── global-optimizer.ts
    │           │
    │           ├── context/                   [+] 场景上下文 (3个文件)
    │           │   ├── scene-resolver.service.ts
    │           │   ├── daily-plan-context.service.ts
    │           │   └── scoring-config.service.ts
    │           │
    │           ├── feedback/                  [+] 反馈与追踪 (4个文件)
    │           │   ├── feedback.service.ts
    │           │   ├── replacement-feedback-injector.service.ts
    │           │   ├── replacement-pattern.service.ts
    │           │   └── execution-tracker.service.ts
    │           │
    │           ├── filter/                    [+] 过滤与替代 (3个文件)
    │           │   ├── substitution.service.ts
    │           │   ├── realistic-filter.service.ts
    │           │   └── allergen-filter.util.ts
    │           │
    │           ├── modifier/                  [+] 健康/生活方式修正 (2个文件)
    │           │   ├── health-modifier-engine.service.ts
    │           │   └── lifestyle-scoring-adapter.service.ts
    │           │
    │           ├── experiment/                [+] A/B 实验 (1个文件)
    │           │   └── ab-testing.service.ts
    │           │
    │           ├── tracing/                   [+] 调试追踪 (1个文件)
    │           │   └── recommendation-trace.service.ts
    │           │
    │           └── utils/                     [+] 工具与规则 (4个文件)
    │               ├── cross-meal-rules.ts
    │               ├── availability-scorer.service.ts
    │               ├── seasonality.service.ts
    │               └── i18n-messages.ts
    │
    │
    ├── food/                                  🟠 食物分析 (重构)
    │   ├── food.module.ts                     [K]
    │   ├── food.types.ts                      [K]
    │   │
    │   ├── admin/                             [K] (结构已合理)
    │   │   ├── food-library-management.service.ts
    │   │   ├── food-library-management.controller.ts
    │   │   ├── analysis-record-management.service.ts
    │   │   ├── analysis-record-management.controller.ts
    │   │   └── dto/
    │   │
    │   └── app/
    │       ├── controllers/                   [+]
    │       │   ├── food-library.controller.ts          [M]
    │       │   └── food-analyze.controller.ts          [M]
    │       │
    │       ├── services/                      [+]
    │       │   ├── food-library.service.ts             [M]
    │       │   ├── analyze.service.ts                  [M]
    │       │   ├── text-food-analysis.service.ts       [M]
    │       │   ├── image-food-analysis.service.ts      [M]
    │       │   ├── analysis-ingestion.service.ts       [M]
    │       │   ├── data-quality.service.ts             [M]
    │       │   ├── candidate-aggregation.service.ts    [M]
    │       │   └── channel-migration.service.ts        [M]
    │       │
    │       ├── dto/                            [+] (利用已有空目录)
    │       │   ├── analyze-text.dto.ts                 [M]
    │       │   └── save-analysis.dto.ts                [M]
    │       │
    │       ├── listeners/                     [+]
    │       │   ├── analysis-event.listener.ts          [M]
    │       │   ├── analysis-save.listener.ts           [M]
    │       │   ├── analysis-tracking.listener.ts       [M]
    │       │   └── candidate-promoted.listener.ts      [M]
    │       │
    │       ├── processors/                    [+]
    │       │   └── food-analysis.processor.ts          [M]
    │       │
    │       └── types/                         [+]
    │           └── analysis-result.types.ts            [M]
    │
    │
    ├── subscription/                          🟠 订阅与支付 (重构)
    │   ├── subscription.module.ts             [K]
    │   ├── subscription.types.ts              [K]
    │   │
    │   ├── admin/                             [K] (结构已合理)
    │   │   ├── subscription-management.service.ts
    │   │   ├── subscription-management.controller.ts
    │   │   └── dto/
    │   │
    │   └── app/
    │       ├── controllers/                   [+]
    │       │   ├── subscription-plans.controller.ts    [M]
    │       │   ├── apple-iap.controller.ts             [M]
    │       │   └── wechat-pay.controller.ts            [M]
    │       │
    │       ├── services/                      [+]
    │       │   ├── subscription.service.ts             [M]
    │       │   ├── quota.service.ts                    [M]
    │       │   ├── quota-gate.service.ts               [M]
    │       │   ├── plan-entitlement-resolver.service.ts [M]
    │       │   ├── result-entitlement.service.ts       [M]
    │       │   └── paywall-trigger.service.ts          [M]
    │       │
    │       ├── payment/                       [+] 支付集成
    │       │   ├── apple-iap.service.ts                [M]
    │       │   ├── apple-iap.types.ts                  [M]
    │       │   ├── wechat-pay.service.ts               [M]
    │       │   └── wechat-pay.types.ts                 [M]
    │       │
    │       ├── guards/                        [+]
    │       │   └── subscription.guard.ts               [M]
    │       │
    │       ├── decorators/                    [+]
    │       │   └── require-subscription.decorator.ts   [M]
    │       │
    │       └── listeners/                     [+]
    │           ├── subscription-event.listener.ts      [M]
    │           └── paywall-analytics.listener.ts       [M]
    │
    │
    └── user/                                  🟠 用户 (重构)
        ├── user.module.ts                     [K]
        ├── user.types.ts                      [K]
        │
        ├── domain/                            [K] (结构已合理)
        │   ├── profile-factory.ts
        │   ├── preferences-profile.ts
        │   └── nutrition-profile.ts
        │
        ├── admin/                             [K] (结构已合理)
        │   ├── admin-user.service.ts
        │   ├── admin-user.controller.ts
        │   ├── app-user-management.service.ts
        │   ├── app-user-management.controller.ts
        │   ├── user-profile-dashboard.service.ts
        │   ├── user-profile-dashboard.controller.ts
        │   ├── churn-prediction.controller.ts
        │   └── dto/
        │
        └── app/
            ├── controllers/                   [+] (利用已有空目录 controller/ → 改名)
            │   └── user-profile.controller.ts         [M]
            │
            ├── services/                      [+] (利用已有空目录)
            │   ├── profile/                   [+] 用户画像核心
            │   │   ├── user-profile.service.ts        [M]
            │   │   ├── profile-inference.service.ts   [M]
            │   │   ├── profile-cache.service.ts       [M]
            │   │   ├── profile-resolver.service.ts    [M]
            │   │   ├── realtime-profile.service.ts    [M]
            │   │   ├── contextual-profile.service.ts  [M]
            │   │   ├── profile-change-log.service.ts  [M]
            │   │   └── collection-trigger.service.ts  [M]
            │   │
            │   ├── goal/                      [+] 目标追踪
            │   │   ├── goal-tracker.service.ts        [M]
            │   │   └── goal-phase.service.ts          [M]
            │   │
            │   ├── churn-prediction.service.ts        [M]
            │   └── segmentation.util.ts               [M]
            │
            ├── dto/                           [K]
            │   └── user-profile.dto.ts
            │
            ├── listeners/                     [+]
            │   └── goal-achieved.listener.ts          [M]
            │
            └── cron/                          [+]
                └── profile-cron.service.ts            [M]
```

---

## 三、各模块文件数对比

| 模块                       | 问题目录 | 优化前(直接文件数) | 优化后(最大目录文件数)       |
| -------------------------- | -------- | ------------------ | ---------------------------- |
| `diet/app/recommendation/` | 全部打平 | **71**             | ≤9 (pipeline/)               |
| `diet/app/`                | 混放     | **20**             | ≤11 (services/)              |
| `diet/admin/`              | 混放     | **15**             | ≤8 (services/)               |
| `food/app/`                | 混放     | **18**             | ≤8 (services/)               |
| `subscription/app/`        | 混放     | **17**             | ≤6 (services/)               |
| `user/app/`                | 混放     | **15**             | ≤8 (services/profile/)       |
| `food-pipeline/services/`  | 打平     | **14**             | ≤4 (fetchers/processing/ai/) |
| `scripts/`                 | 打平     | **12**             | ≤9 (seeds/)                  |

---

## 四、清理项

### 4.1 删除空目录

```bash
# 这些空目录是废弃的重构痕迹，重构完成后删除
rm -rf src/modules/diet/app/controller/    # 改用 controllers/
rm -rf src/modules/diet/app/dto/           # 已使用新 dto/
rm -rf src/modules/diet/app/services/      # 已使用新 services/
rm -rf src/modules/food/app/dto/           # 已使用新 dto/
rm -rf src/modules/user/app/controller/    # 改用 controllers/
rm -rf src/modules/user/app/services/      # 已使用新 services/
```

### 4.2 命名统一

- 原有空目录名 `controller/` 统一改为 `controllers/` (复数形式，与 NestJS 惯例一致)
- 新建的子目录全部使用复数: `controllers/`, `services/`, `listeners/`, `processors/`

---

## 五、迁移优先级

| 优先级 | 范围                                        | 涉及文件数 | 预估工作量 | 说明                              |
| ------ | ------------------------------------------- | ---------- | ---------- | --------------------------------- |
| **P0** | `recommendation/` 71 文件拆分为 15 个子目录 | 71         | 大         | 最严重的问题，必须先做            |
| **P1** | `diet/app/` 20 文件拆分                     | 20         | 中         | 控制器/服务/DTO/监听器/处理器分离 |
| **P1** | `diet/admin/` 15 文件拆分                   | 15         | 中         | 控制器/服务分离                   |
| **P2** | `food/app/` 18 文件拆分                     | 18         | 中         | 分析相关与食物库相关分离          |
| **P2** | `subscription/app/` 17 文件拆分             | 17         | 中         | 支付/订阅/配额/Guard 分离         |
| **P2** | `user/app/` 15 文件拆分                     | 15         | 中         | 画像/目标/流失 分离               |
| **P3** | `food-pipeline/services/` 14 文件拆分       | 14         | 小         | 数据源/清洗/AI 分离               |
| **P3** | `scripts/` 12 文件拆分                      | 12         | 小         | seeds/tools 分离                  |
| **P4** | 清理 6 个空目录                             | 0          | 极小       | 删除废弃目录                      |

---

## 六、迁移注意事项

### 6.1 NestJS Module 注册

移动文件后，所有 `*.module.ts` 中的 `import` 路径必须同步更新：

```typescript
// 修改前
import { FoodScorer } from './recommendation/food-scorer.service';

// 修改后
import { FoodScorer } from './recommendation/pipeline/food-scorer.service';
```

### 6.2 barrel export (index.ts)

每个新建的子目录建议添加 `index.ts` 导出，便于外部引用：

```typescript
// recommendation/types/index.ts
export * from './recommendation.types';
export * from './scoring.types';
// ...
```

### 6.3 循环依赖检查

`recommendation/` 内部文件之间存在大量互相引用，拆分到子目录后需要用以下命令检查循环依赖：

```bash
npx madge --circular --extensions ts src/modules/diet/app/recommendation/
```

### 6.4 测试文件

如果存在对应的 `.spec.ts` 测试文件，应与源文件保持在同一目录中，随源文件一起迁移。

---

## 七、设计原则

本方案遵循以下原则：

1. **按职责分目录** — 同一目录内的文件应属于同一抽象层或同一职责域
2. **单目录不超过 10 个文件** — 超过 10 个文件的目录需要进一步拆分子目录
3. **保持 NestJS 惯例** — `controllers/`, `services/`, `dto/`, `guards/`, `decorators/`, `listeners/`, `processors/`
4. **保持 admin/app 二分** — 这是现有的良好实践，继续保持
5. **最小改动原则** — 结构已合理的模块（共 13 个）保持不变，只重构有问题的模块
6. **利用已有空目录** — `diet/app/controller/` 等已有但空的目录直接利用（改名为复数）
