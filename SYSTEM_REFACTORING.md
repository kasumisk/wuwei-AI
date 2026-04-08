# 系统重构总体方案 — Clean Rebuild on Existing Codebase

> **版本**: v1.0 | **日期**: 2026-04-09  
> **范围**: api-server (NestJS) + web (Next.js) 全面重构  
> **依赖文档**: INTELLIGENT_DIET_SYSTEM_V3.md, USER_PROFILING_SYSTEM.md  
> **原则**: 删除冗余 → 重构结构 → 保留必要资产 → 输出全新架构

---

## 目录

- [一、系统重构总体方案](#一系统重构总体方案)
- [二、后端重构方案（NestJS）](#二后端重构方案nestjs)
- [三、前端重构方案（Next.js Web）](#三前端重构方案nextjs-web)
- [四、旧系统清理策略](#四旧系统清理策略)
- [五、数据结构与接口重构](#五数据结构与接口重构)
- [六、推荐系统接入方案](#六推荐系统接入方案)
- [七、渐进式重构执行计划](#七渐进式重构执行计划)
- [八、重构风险与反模式](#八重构风险与反模式)

---

## 一、系统重构总体方案

### 1.1 当前架构诊断

#### 致命结构问题

| # | 问题 | 证据 | 严重度 |
|---|------|------|--------|
| 1 | **God Module — AppClientModule** | `app-client.module.ts` 注册 17 个 Entity、15 个 Service、7 个 Controller，职责无边界 | 🔴 |
| 2 | **God Module — AdminModule** | `admin.module.ts` 注册 28 个 Entity、14 个 Service、16 个 Controller，同样职责无边界 | 🔴 |
| 3 | **Entity 三重注册** | 同一个 Entity（如 `FoodLibrary`）在 `database.module.ts`、`app-client.module.ts`、`admin.module.ts`、`food-pipeline.module.ts` 各注册一次 | 🟠 |
| 4 | **无领域分层** | Service 直接操作 TypeORM Repository，业务逻辑和数据访问混在一起 | 🟠 |
| 5 | **Barrel 文件废弃** | `entities/index.ts` 只导出了约一半的 Entity，其余直接路径导入 | 🟡 |
| 6 | **安全隐患** | JWT secret 硬编码 fallback: `'your-secret-key-change-in-production'` | 🔴 |
| 7 | **Auth Guard 失效** | 全局 Guard 用 Proxy 实现，且 `canActivate` 始终返回 `true`（注释"暂时"） | 🔴 |
| 8 | **模块间无清晰边界** | Admin 和 App 共享相同 Entity 但各自独立注册，无法复用业务逻辑 | 🟠 |
| 9 | **无用模块** | `compress`（图片压缩）、`langchain`（RAG）、`gateway`（AI 多模型网关）与饮食系统核心业务无关 | 🟡 |
| 10 | **前端路由杂乱** | `api-demo`、`gateway-test`、`chat` 等页面是测试/演示页，不属于生产系统 | 🟡 |

#### 当前架构拓扑

```
┌─────────────────────────────────────────────────────┐
│                   AppModule (根)                     │
├─────────────────────────────────────────────────────┤
│                                                     │
│  CoreModule ──┬── ConfigModule                      │
│               ├── DatabaseModule (33 entities 全注册)│
│               └── LoggerModule                      │
│                                                     │
│  AdminModule ─── 28 entities + 14 services (单体)   │
│  AppClientModule ── 17 entities + 15 services (单体)│
│  GatewayModule ── AI 多模型网关 (与核心业务无关)      │
│  LangChainModule ── RAG (与核心业务无关)             │
│  FoodPipelineModule ── 数据管道 (独立，结构OK)        │
│  CompressModule ── 图片压缩 (与核心业务无关)          │
│  StorageModule ── 文件上传 (通用，保留)               │
│  HealthModule ── 健康检查 (保留)                     │
│                                                     │
└─────────────────────────────────────────────────────┘

问题：Admin 和 App 两个巨石模块包揽了所有业务逻辑
```

### 1.2 新系统架构

#### 设计目标

| 维度 | 现状 | 目标 |
|------|------|------|
| 模块化 | 2 个巨石模块 | 8 个领域模块 + 2 个基础模块 |
| 分层 | Service 直连 Repository | Controller → Service → Domain → Repository |
| 可测试 | 无测试 | Domain 逻辑纯函数化，可单元测试 |
| 安全 | Auth Guard 始终 true | 完整的 RBAC + JWT 认证 |
| 耦合度 | Entity 交叉注册 | 每个 Entity 仅属一个模块，跨模块通过 Service 接口 |

#### 新架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        AppModule (根)                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Infrastructure Layer (基础设施)                          │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │    │
│  │  │  Core    │ │ Storage  │ │ Health   │ │ AI Gateway │ │    │
│  │  │ DB/Config│ │ S3/File  │ │ Liveness │ │ OpenRouter │ │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └────────────┘ │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Domain Layer (业务领域)                                   │    │
│  │                                                         │    │
│  │  ┌─────────────┐  ┌───────────────┐  ┌──────────────┐  │    │
│  │  │  Auth       │  │ User Profile  │  │   Food       │  │    │
│  │  │ 认证 + 用户管理│  │ 画像 + 行为追踪 │  │ 食物库 + 管道  │  │    │
│  │  └─────────────┘  └───────────────┘  └──────────────┘  │    │
│  │                                                         │    │
│  │  ┌─────────────┐  ┌───────────────┐  ┌──────────────┐  │    │
│  │  │ Nutrition   │  │Recommendation │  │   Coach      │  │    │
│  │  │ 营养评分引擎  │  │ 推荐引擎       │  │ AI 教练      │  │    │
│  │  └─────────────┘  └───────────────┘  └──────────────┘  │    │
│  │                                                         │    │
│  │  ┌─────────────┐  ┌───────────────┐                    │    │
│  │  │ Meal Plan   │  │ Gamification  │                    │    │
│  │  │ 每日饮食计划  │  │ 成就 + 挑战    │                    │    │
│  │  └─────────────┘  └───────────────┘                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Interface Layer (接口层)                                  │    │
│  │  ┌──────────────────┐  ┌──────────────────────────────┐ │    │
│  │  │  App API (C端)    │  │  Admin API (B端)              │ │    │
│  │  │  /api/app/*       │  │  /api/admin/*                │ │    │
│  │  └──────────────────┘  └──────────────────────────────┘ │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### 模块间依赖关系（DAG，无环）

```
Auth ←──── UserProfile ←──── Recommendation
               ↑                    ↑
               │                    │
           Nutrition ←──── MealPlan─┘
               ↑                    
               │                    
             Food ←──── FoodPipeline
               ↑
               │
           Gamification ←── Coach
```

**规则**：
- 箭头方向 = 依赖方向（A ← B 表示 B 依赖 A）
- **禁止循环依赖**
- 跨模块调用只能通过 exported Service 公开接口

### 1.3 删除清单

| 模块 / 文件 | 决定 | 原因 |
|-------------|------|------|
| `src/compress/` | 🗑️ 删除 | 图片压缩功能与饮食系统无关 |
| `src/langchain/` | 🗑️ 删除 | RAG 功能未实际使用，Coach 模块自行接 AI |
| `src/gateway/` | ⚠️ 精简 | 保留 OpenRouter adapter（Coach 需要），删除 DeepSeek/Qwen/OpenAI adapter、quota/rate-limit guards、capability-router |
| `src/app.controller.ts` (根) | 🗑️ 删除 | 空控制器 |
| `src/app.service.ts` (根) | 🗑️ 删除 | 空服务 |
| `src/vite-env.d.ts` | 🗑️ 删除 | NestJS 项目不需要 Vite 类型 |
| `src/gateway/init-test-data.ts` | 🗑️ 删除 | 测试临时文件 |
| `src/gateway/test-gateway.ts` | 🗑️ 删除 | 测试临时文件 |
| `src/gateway/DEEPSEEK_ADAPTER.md` | 🗑️ 删除 | 文档归档后删除 |
| `src/gateway/TESTING.md` | 🗑️ 删除 | 同上 |
| Web: `src/app/[locale]/api-demo/` | 🗑️ 删除 | 演示页面 |
| Web: `src/app/[locale]/gateway-test/` | 🗑️ 删除 | 测试页面 |
| Web: `src/app/[locale]/chat/` | 🗑️ 删除 | 通用聊天页，与饮食系统无关 |
| Web: `src/pages-component/gateway/` | 🗑️ 删除 | 网关测试组件 |
| Web: `src/lib/ffmpeg/` | 🗑️ 删除 | FFmpeg 功能无用 |
| Web: `src/lib/image-converter/` | 🗑️ 删除 | 图片转换功能无用 |
| Web: `src/lib/pdf/` | 🗑️ 删除 | PDF 功能无用 |
| Web: `src/app/api/chat/` | 🗑️ 删除 | 通用聊天 API route |
| Web: `src/app/api/compress/` | 🗑️ 删除 | 压缩 API route |

---

## 二、后端重构方案（NestJS）

### 2.1 新目录结构

```
apps/api-server/src/
├── main.ts                              # 应用入口
├── app.module.ts                        # 根模块（仅 import 子模块）
│
├── infrastructure/                      # ────── 基础设施层 ──────
│   ├── infrastructure.module.ts
│   ├── config/
│   │   ├── config.module.ts
│   │   ├── configuration.ts             # 环境变量映射
│   │   └── validation.ts                # env schema 校验 (Joi/Zod)
│   ├── database/
│   │   ├── database.module.ts           # TypeORM 连接配置
│   │   ├── data-source.ts              # CLI migration data source
│   │   └── migrations/                  # 所有 migration 文件
│   │       ├── index.ts
│   │       └── *.ts
│   ├── storage/
│   │   ├── storage.module.ts
│   │   ├── storage.service.ts
│   │   └── dto/
│   ├── ai-gateway/                      # 精简后的 AI 网关
│   │   ├── ai-gateway.module.ts
│   │   ├── ai-gateway.service.ts        # 统一对外接口
│   │   └── adapters/
│   │       ├── base.adapter.ts
│   │       └── openrouter.adapter.ts    # 仅保留 OpenRouter
│   ├── health/
│   │   ├── health.module.ts
│   │   └── health.controller.ts
│   └── common/
│       ├── filters/
│       │   └── all-exceptions.filter.ts
│       ├── interceptors/
│       │   └── response.interceptor.ts
│       ├── middlewares/
│       │   └── logger.middleware.ts
│       ├── decorators/
│       │   ├── public.decorator.ts
│       │   └── current-user.decorator.ts
│       └── types/
│           └── response.type.ts
│
├── modules/                             # ────── 业务领域层 ──────
│   │
│   ├── auth/                            # 🔐 认证模块
│   │   ├── auth.module.ts
│   │   ├── controllers/
│   │   │   ├── app-auth.controller.ts   # C端认证 (微信/手机/匿名)
│   │   │   └── admin-auth.controller.ts # B端认证 (邮箱/密码)
│   │   ├── services/
│   │   │   ├── app-auth.service.ts
│   │   │   ├── admin-auth.service.ts
│   │   │   ├── wechat-auth.service.ts
│   │   │   ├── sms.service.ts
│   │   │   └── firebase-admin.service.ts
│   │   ├── guards/
│   │   │   ├── app-jwt-auth.guard.ts
│   │   │   ├── admin-jwt-auth.guard.ts
│   │   │   ├── roles.guard.ts
│   │   │   └── rbac-permission.guard.ts
│   │   ├── strategies/
│   │   │   ├── app-jwt.strategy.ts
│   │   │   └── admin-jwt.strategy.ts
│   │   ├── dto/
│   │   │   ├── app-auth.dto.ts
│   │   │   └── admin-auth.dto.ts
│   │   └── entities/
│   │       ├── app-user.entity.ts
│   │       ├── admin-user.entity.ts
│   │       ├── role.entity.ts
│   │       ├── permission.entity.ts
│   │       ├── role-permission.entity.ts
│   │       ├── user-role.entity.ts
│   │       └── permission-template.entity.ts
│   │
│   ├── user-profile/                    # 👤 用户画像模块
│   │   ├── user-profile.module.ts
│   │   ├── controllers/
│   │   │   ├── profile.controller.ts    # C端画像 CRUD + 引导流
│   │   │   └── profile-admin.controller.ts # B端用户管理
│   │   ├── services/
│   │   │   ├── profile-manage.service.ts    # 声明数据 CRUD
│   │   │   ├── profile-inference.service.ts # 推断引擎
│   │   │   ├── profile-cache.service.ts     # 画像缓存
│   │   │   └── profile-snapshot.service.ts  # 版本快照
│   │   ├── domain/                          # 🎯 纯领域逻辑（可测试）
│   │   │   ├── bmr-calculator.ts            # BMR/TDEE 计算（纯函数）
│   │   │   ├── completeness-calculator.ts   # 数据完整度计算
│   │   │   ├── user-segmentation.ts         # 用户分群
│   │   │   └── goal-transition.ts           # 目标迁移判断
│   │   ├── dto/
│   │   │   ├── onboarding-step.dto.ts
│   │   │   ├── update-profile.dto.ts
│   │   │   └── profile-response.dto.ts
│   │   └── entities/
│   │       ├── user-profile.entity.ts
│   │       ├── user-behavior-profile.entity.ts
│   │       ├── user-inferred-profile.entity.ts  # 新建
│   │       └── profile-snapshot.entity.ts       # 新建
│   │
│   ├── food/                            # 🍎 食物模块
│   │   ├── food.module.ts
│   │   ├── controllers/
│   │   │   ├── food-library.controller.ts   # C端食物查询
│   │   │   ├── food-admin.controller.ts     # B端食物管理
│   │   │   └── food-pipeline.controller.ts  # 数据管道操作
│   │   ├── services/
│   │   │   ├── food-library.service.ts      # 食物库查询
│   │   │   ├── food-admin.service.ts        # 食物库管理
│   │   │   └── food-record.service.ts       # 用户饮食记录
│   │   ├── pipeline/                        # 数据管道（子目录，非独立模块）
│   │   │   ├── food-pipeline-orchestrator.service.ts
│   │   │   ├── food-data-cleaner.service.ts
│   │   │   ├── food-dedup.service.ts
│   │   │   ├── food-conflict-resolver.service.ts
│   │   │   ├── food-ai-label.service.ts
│   │   │   ├── food-ai-translate.service.ts
│   │   │   ├── food-quality-monitor.service.ts
│   │   │   ├── food-sync-scheduler.service.ts
│   │   │   ├── usda-fetcher.service.ts
│   │   │   └── openfoodfacts.service.ts
│   │   ├── domain/
│   │   │   ├── food-rule-engine.ts          # 食物规则（纯函数）
│   │   │   └── food-similarity.ts           # 食物相似度计算
│   │   ├── dto/
│   │   │   ├── food-query.dto.ts
│   │   │   ├── food-create.dto.ts
│   │   │   └── food-record.dto.ts
│   │   └── entities/
│   │       ├── food-library.entity.ts
│   │       ├── food-translation.entity.ts
│   │       ├── food-source.entity.ts
│   │       ├── food-change-log.entity.ts
│   │       ├── food-conflict.entity.ts
│   │       ├── food-regional-info.entity.ts
│   │       ├── food-record.entity.ts
│   │       └── daily-summary.entity.ts
│   │
│   ├── nutrition/                       # 🧪 营养评分模块
│   │   ├── nutrition.module.ts
│   │   ├── services/
│   │   │   └── nutrition-score.service.ts   # 评分编排
│   │   └── domain/                          # 🎯 核心评分逻辑（纯函数）
│   │       ├── scorers/
│   │       │   ├── energy-scorer.ts         # 钟形函数
│   │       │   ├── protein-scorer.ts        # 分段函数
│   │       │   ├── macro-balance-scorer.ts
│   │       │   ├── quality-scorer.ts
│   │       │   ├── satiety-scorer.ts
│   │       │   ├── glycemic-scorer.ts       # sigmoid GL
│   │       │   ├── processing-scorer.ts     # NOVA 阶梯
│   │       │   ├── nutrient-density-scorer.ts # NRF 9.3
│   │       │   ├── inflammation-scorer.ts
│   │       │   └── stability-scorer.ts
│   │       ├── weight-calculator.ts         # 动态权重 (三维叠加)
│   │       ├── penalty-engine.ts            # 惩罚引擎
│   │       └── types.ts                     # 评分类型定义
│   │
│   ├── recommendation/                  # 🎯 推荐引擎模块
│   │   ├── recommendation.module.ts
│   │   ├── controllers/
│   │   │   └── recommendation.controller.ts # 推荐反馈 API
│   │   ├── services/
│   │   │   └── recommendation-engine.service.ts
│   │   ├── domain/                          # 🎯 推荐核心逻辑
│   │   │   ├── recall/
│   │   │   │   ├── hard-filter.ts           # 硬约束过滤
│   │   │   │   ├── tag-recall.ts            # 标签召回
│   │   │   │   └── constraint-generator.ts  # 约束生成器
│   │   │   ├── ranking/
│   │   │   │   ├── food-ranker.ts           # 精排
│   │   │   │   └── similarity-penalty.ts    # 相似度惩罚
│   │   │   ├── reranking/
│   │   │   │   ├── diversity-engine.ts      # 多样性控制
│   │   │   │   ├── exploration-strategy.ts  # Thompson Sampling
│   │   │   │   └── portion-optimizer.ts     # 份量优化
│   │   │   └── types.ts
│   │   ├── dto/
│   │   │   ├── feedback.dto.ts
│   │   │   └── recommendation-response.dto.ts
│   │   └── entities/
│   │       ├── recommendation-feedback.entity.ts
│   │       └── ai-decision-log.entity.ts
│   │
│   ├── meal-plan/                       # 📋 饮食计划模块
│   │   ├── meal-plan.module.ts
│   │   ├── controllers/
│   │   │   └── meal-plan.controller.ts
│   │   ├── services/
│   │   │   └── daily-plan.service.ts
│   │   ├── domain/
│   │   │   ├── meal-budget-allocator.ts     # 餐次热量分配
│   │   │   └── global-calibrator.ts         # 全天营养校准
│   │   ├── dto/
│   │   │   └── daily-plan.dto.ts
│   │   └── entities/
│   │       └── daily-plan.entity.ts
│   │
│   ├── coach/                           # 🤖 AI 教练模块
│   │   ├── coach.module.ts
│   │   ├── controllers/
│   │   │   └── coach.controller.ts
│   │   ├── services/
│   │   │   ├── coach.service.ts
│   │   │   └── behavior.service.ts      # 行为分析
│   │   ├── domain/
│   │   │   ├── coach-prompt-builder.ts  # Prompt 构建（纯函数）
│   │   │   └── risk-detector.ts         # 暴食风险检测
│   │   ├── dto/
│   │   │   └── coach.dto.ts
│   │   └── entities/
│   │       ├── coach-conversation.entity.ts
│   │       └── coach-message.entity.ts
│   │
│   ├── gamification/                    # 🏆 游戏化模块
│   │   ├── gamification.module.ts
│   │   ├── controllers/
│   │   │   ├── gamification.controller.ts
│   │   │   └── gamification-admin.controller.ts
│   │   ├── services/
│   │   │   └── gamification.service.ts
│   │   ├── dto/
│   │   │   └── gamification.dto.ts
│   │   └── entities/
│   │       ├── achievement.entity.ts
│   │       ├── user-achievement.entity.ts
│   │       ├── challenge.entity.ts
│   │       └── user-challenge.entity.ts
│   │
│   └── admin/                           # 🔧 管理后台模块
│       ├── admin.module.ts              # 仅包含 B端特有逻辑
│       ├── controllers/
│       │   ├── analytics.controller.ts
│       │   ├── content-management.controller.ts
│       │   ├── app-version.controller.ts
│       │   └── admin-file.controller.ts
│       ├── services/
│       │   ├── analytics.service.ts
│       │   ├── content-management.service.ts
│       │   ├── app-version.service.ts
│       │   └── app-version-package.service.ts
│       ├── dto/
│       │   ├── analytics.dto.ts
│       │   └── content.dto.ts
│       └── entities/
│           ├── app-version.entity.ts
│           └── app-version-package.entity.ts
│
├── shared/                              # ────── 共享层 ──────
│   ├── constants/
│   │   ├── nutrition.constants.ts       # 营养素 DV/阈值...
│   │   ├── profile.constants.ts         # 字段约束 (heightCm min/max...)
│   │   └── food.constants.ts            # 食物分类/标签映射
│   ├── enums/
│   │   ├── goal-type.enum.ts
│   │   ├── activity-level.enum.ts
│   │   ├── meal-type.enum.ts
│   │   └── discipline.enum.ts
│   ├── interfaces/
│   │   ├── scored-food.interface.ts
│   │   ├── weight-vector.interface.ts
│   │   └── user-context.interface.ts
│   └── utils/
│       ├── math.utils.ts                # gaussian, sigmoid, betaSample
│       └── date.utils.ts
│
└── scripts/                             # 脚本
    ├── seed-admin.ts
    ├── seed-foods.ts
    └── init-system.ts
```

### 2.2 模块划分详解

#### 模块职责矩阵

| 模块 | 拥有的 Entity | 对外暴露的 Service | 依赖的模块 |
|------|-------------|-------------------|-----------|
| **auth** | AppUser, AdminUser, Role, Permission, RolePermission, UserRole, PermissionTemplate | AppAuthService, AdminAuthService | - (无依赖) |
| **user-profile** | UserProfile, UserBehaviorProfile, UserInferredProfile, ProfileSnapshot | ProfileManageService, ProfileCacheService | auth |
| **food** | FoodLibrary, FoodTranslation, FoodSource, FoodChangeLog, FoodConflict, FoodRegionalInfo, FoodRecord, DailySummary | FoodLibraryService, FoodRecordService | ai-gateway (pipeline 用) |
| **nutrition** | (无自有 Entity) | NutritionScoreService | food (需要食物数据) |
| **recommendation** | RecommendationFeedback, AiDecisionLog | RecommendationEngineService | nutrition, user-profile, food |
| **meal-plan** | DailyPlan | DailyPlanService | recommendation, user-profile |
| **coach** | CoachConversation, CoachMessage | CoachService, BehaviorService | user-profile, ai-gateway |
| **gamification** | Achievement, UserAchievement, Challenge, UserChallenge | GamificationService | user-profile |
| **admin** | AppVersion, AppVersionPackage | AnalyticsService | auth, user-profile, food, recommendation |

#### 2.2.1 每个模块内部结构规范

```typescript
// 标准模块结构示例 — nutrition 模块
@Module({
  imports: [
    TypeOrmModule.forFeature([/* 本模块拥有的 Entity */]),
    FoodModule,  // 跨模块依赖通过 import
  ],
  controllers: [/* 本模块的 Controller */],
  providers: [
    // Service 层 — 编排调度
    NutritionScoreService,
    // Domain 层 — 纯业务逻辑（以 Provider 注册使其可注入，但实际是纯函数集合）
    EnergyScorerDomain,
    ProteinScorerDomain,
    // ...
  ],
  exports: [NutritionScoreService],  // 仅暴露 Service，不暴露 Domain
})
export class NutritionModule {}
```

### 2.3 各模块核心代码（伪代码）

#### auth 模块

```typescript
// modules/auth/controllers/app-auth.controller.ts
@Controller('api/app/auth')
export class AppAuthController {
  constructor(private readonly appAuth: AppAuthService) {}

  @Public()
  @Post('login/wechat-mini')
  async loginWechatMini(@Body() dto: WechatMiniLoginDto) {
    return this.appAuth.loginByWechatMini(dto.code);
  }

  @Public()
  @Post('login/phone')
  async loginPhone(@Body() dto: PhoneLoginDto) {
    return this.appAuth.loginByPhone(dto.phone, dto.code);
  }

  @Public()
  @Post('login/anonymous')
  async loginAnonymous() {
    return this.appAuth.loginAnonymous();
  }

  @Get('me')
  @UseGuards(AppJwtAuthGuard)
  async getMe(@CurrentUser() user: AppUser) {
    return user;
  }
}
```

#### user-profile 模块

```typescript
// modules/user-profile/controllers/profile.controller.ts
@Controller('api/app/profile')
@UseGuards(AppJwtAuthGuard)
export class ProfileController {
  constructor(
    private readonly profileManage: ProfileManageService,
    private readonly profileInference: ProfileInferenceService,
  ) {}

  @Post('onboarding/step/:step')
  async saveOnboardingStep(
    @Param('step', ParseIntPipe) step: number,
    @Body() dto: OnboardingStepDto,
    @CurrentUser() user: AppUser,
  ) {
    const result = await this.profileManage.saveOnboardingStep(user.id, step, dto);
    return result;
  }

  @Get('full')
  async getFullProfile(@CurrentUser() user: AppUser) {
    return this.profileManage.getFullProfile(user.id);
  }

  @Patch('declared')
  async updateDeclared(
    @Body() dto: UpdateDeclaredProfileDto,
    @CurrentUser() user: AppUser,
  ) {
    return this.profileManage.updateDeclared(user.id, dto);
  }

  @Get('completion-suggestions')
  async getCompletionSuggestions(@CurrentUser() user: AppUser) {
    return this.profileManage.getCompletionSuggestions(user.id);
  }

  @Post('infer/refresh')
  async refreshInference(@CurrentUser() user: AppUser) {
    return this.profileInference.recompute(user.id);
  }
}

// modules/user-profile/domain/bmr-calculator.ts — 纯函数
export function calculateBMR(params: {
  gender: string;
  weightKg: number;
  heightCm: number;
  age: number;
  bodyFatPercent?: number;
}): number {
  // Katch-McArdle (if bodyFat available)
  if (params.bodyFatPercent) {
    const leanMass = params.weightKg * (1 - params.bodyFatPercent / 100);
    return 370 + 21.6 * leanMass;
  }
  // Harris-Benedict
  if (params.gender === 'male') {
    return 88.362 + 13.397 * params.weightKg + 4.799 * params.heightCm - 5.677 * params.age;
  }
  return 447.593 + 9.247 * params.weightKg + 3.098 * params.heightCm - 4.330 * params.age;
}

export function calculateTDEE(bmr: number, activityLevel: string): number {
  const factors: Record<string, number> = {
    sedentary: 1.2,
    light: 1.375,
    moderate: 1.55,
    active: 1.725,
  };
  return Math.round(bmr * (factors[activityLevel] ?? 1.375));
}

export function calculateRecommendedCalories(
  tdee: number,
  goal: string,
  goalSpeed: string,
): number {
  const deficitMultipliers: Record<string, Record<string, number>> = {
    fat_loss: { aggressive: 0.75, steady: 0.85, relaxed: 0.92 },
    muscle_gain: { aggressive: 1.15, steady: 1.10, relaxed: 1.05 },
    health: { aggressive: 1.0, steady: 1.0, relaxed: 1.0 },
    habit: { aggressive: 1.0, steady: 1.0, relaxed: 1.0 },
  };
  const multiplier = deficitMultipliers[goal]?.[goalSpeed] ?? 1.0;
  return Math.round(tdee * multiplier);
}
```

#### nutrition 模块

```typescript
// modules/nutrition/domain/scorers/energy-scorer.ts — 纯函数
export function scoreEnergy(actual: number, target: number, goalType: string): number {
  if (target <= 0) return 80;
  const sigmaRatio: Record<string, number> = {
    fat_loss: 0.12,
    muscle_gain: 0.20,
    health: 0.15,
    habit: 0.25,
  };
  const sigma = (sigmaRatio[goalType] ?? 0.15) * target;
  const raw = 100 * Math.exp(-Math.pow(actual - target, 2) / (2 * sigma * sigma));

  // 非对称: 超标比不足扣更多
  if (actual > target && goalType === 'fat_loss') {
    const excess = (actual - target) / target;
    return Math.max(0, raw * (1 - excess * 0.5));
  }
  return Math.max(0, Math.round(raw));
}

// modules/nutrition/domain/scorers/glycemic-scorer.ts
export function scoreGlycemic(glycemicIndex: number | null, carbsG: number): number {
  if (!glycemicIndex) return 75; // 无数据给中等分
  const gl = (glycemicIndex * carbsG) / 100;
  return Math.round(100 / (1 + Math.exp(0.3 * (gl - 15))));
}

// modules/nutrition/services/nutrition-score.service.ts
@Injectable()
export class NutritionScoreService {
  computeScore(food: FoodFeatures, context: ScoringContext): ScoredResult {
    // 1. 计算 10 个维度分数
    const scores = {
      energy: scoreEnergy(food.calories, context.targetCalories, context.goalType),
      protein: scoreProtein(food.protein, food.calories, context.goalType),
      macroBalance: scoreMacroBalance(food, context),
      quality: scoreQuality(food),
      satiety: scoreSatiety(food),
      glycemicImpact: scoreGlycemic(food.glycemicIndex, food.carbs),
      processingPenalty: scoreProcessing(food.novaLevel),
      micronutrientDensity: scoreNutrientDensity(food),
      inflammationIndex: scoreInflammation(food),
      stability: scoreStability(context.userBehavior),
    };

    // 2. 计算动态权重
    const weights = computeWeights(context.goalType, context.mealType, context.userStatus);

    // 3. 加权求和
    let total = 0;
    for (const [key, score] of Object.entries(scores)) {
      total += score * (weights[key] ?? 0);
    }

    // 4. 惩罚引擎
    const { finalScore, penalties } = applyPenalties(total, food, context);

    return { score: finalScore, dimensions: scores, penalties };
  }
}
```

#### recommendation 模块

```typescript
// modules/recommendation/domain/recall/hard-filter.ts
export function hardFilter(
  foods: FoodLibrary[],
  constraints: HardConstraints,
): FoodLibrary[] {
  return foods.filter(f => {
    // 过敏原 — 绝对排除
    if (constraints.allergens.length > 0) {
      const foodAllergens = f.allergens ?? [];
      if (constraints.allergens.some(a => foodAllergens.includes(a))) return false;
    }
    // 饮食限制
    if (constraints.dietaryRestrictions.includes('vegetarian') && f.category === 'protein') {
      if (!f.tags?.includes('plant_based')) return false;
    }
    if (constraints.dietaryRestrictions.includes('no_beef') && f.tags?.includes('beef')) {
      return false;
    }
    // 热量上限
    if (f.caloriesPer100g * (f.defaultServingG / 100) > constraints.maxCaloriesPerItem) {
      return false;
    }
    return true;
  });
}

// modules/recommendation/domain/reranking/exploration-strategy.ts
export function thompsonSamplingRerank(
  scored: ScoredFood[],
  explorationStates: Map<string, { alpha: number; beta: number }>,
  explorationWeight: number = 0.2,
): ScoredFood[] {
  return scored.map(sf => {
    const state = explorationStates.get(sf.food.id) ?? { alpha: 1, beta: 1 };
    const sample = betaSample(state.alpha, state.beta);
    const explorationScore = sample * 100;
    return {
      ...sf,
      score: sf.score * (1 - explorationWeight) + explorationScore * explorationWeight,
    };
  }).sort((a, b) => b.score - a.score);
}

// modules/recommendation/services/recommendation-engine.service.ts
@Injectable()
export class RecommendationEngineService {
  constructor(
    private readonly nutritionScore: NutritionScoreService,
    private readonly profileCache: ProfileCacheService,
    private readonly foodLibrary: FoodLibraryService,
    @InjectRepository(RecommendationFeedback)
    private readonly feedbackRepo: Repository<RecommendationFeedback>,
  ) {}

  async recommendMeal(userId: string, mealType: string): Promise<MealRecommendation> {
    // 1. 获取用户画像
    const profile = await this.profileCache.getFullProfile(userId);

    // 2. 构建约束
    const constraints = this.buildConstraints(profile, mealType);

    // 3. Stage 1: 召回
    const allFoods = await this.foodLibrary.getActiveFoods();
    const recalled = hardFilter(allFoods, constraints);

    // 4. Stage 2: 精排
    const ranked = this.rankFoods(recalled, profile, mealType);

    // 5. Stage 3: 重排
    const reranked = this.applyDiversityAndExploration(ranked, profile);

    // 6. 选择 Top-K
    const selected = reranked.slice(0, constraints.itemsPerMeal);

    // 7. 份量优化
    const optimized = optimizePortions(selected, constraints.mealCalorieBudget);

    return { mealType, items: optimized };
  }
}
```

#### meal-plan 模块

```typescript
// modules/meal-plan/services/daily-plan.service.ts
@Injectable()
export class DailyPlanService {
  constructor(
    private readonly recommendation: RecommendationEngineService,
    private readonly profileCache: ProfileCacheService,
    @InjectRepository(DailyPlan)
    private readonly planRepo: Repository<DailyPlan>,
  ) {}

  async generateDailyPlan(userId: string, date: string): Promise<DailyPlan> {
    const profile = await this.profileCache.getFullProfile(userId);

    // 1. 分配每餐热量预算
    const budgets = allocateMealBudgets(
      profile.inferred.recommendedCalories,
      profile.declared.mealsPerDay,
    );

    // 2. 串行生成每餐（后餐感知前餐已选食物）
    const meals: MealRecommendation[] = [];
    const usedFoodIds = new Set<string>();

    for (const [mealType, budget] of Object.entries(budgets)) {
      const meal = await this.recommendation.recommendMeal(userId, mealType);
      meal.items.forEach(item => usedFoodIds.add(item.food.id));
      meals.push(meal);
    }

    // 3. 全局校准
    const calibrated = globalCalibrate(meals, profile);

    // 4. 持久化
    return this.planRepo.save({
      userId,
      date,
      meals: calibrated,
      totalCalories: calibrated.reduce((sum, m) => sum + m.totalCalories, 0),
    });
  }
}
```

### 2.4 数据流

```
用户请求 "生成今日计划"
    │
    ▼
MealPlanController.generatePlan()
    │
    ▼
DailyPlanService.generateDailyPlan()
    ├── ProfileCacheService.getFullProfile()
    │     ├── UserProfile (declared)
    │     ├── UserBehaviorProfile (observed)
    │     └── UserInferredProfile (inferred)
    │
    ├── allocateMealBudgets() [domain/纯函数]
    │
    ├── for each meal:
    │     RecommendationEngineService.recommendMeal()
    │       ├── FoodLibraryService.getActiveFoods()
    │       ├── hardFilter() [domain/recall]
    │       ├── NutritionScoreService.computeScore() × N
    │       │     ├── 10 个 scorer [domain/scorers]
    │       │     ├── computeWeights() [domain/weight-calculator]
    │       │     └── applyPenalties() [domain/penalty-engine]
    │       ├── diversityScore() [domain/reranking]
    │       ├── thompsonSamplingRerank() [domain/reranking]
    │       └── optimizePortions() [domain/reranking]
    │
    ├── globalCalibrate() [domain/纯函数]
    │
    └── PlanRepo.save()

用户反馈 "接受/替换/跳过"
    │
    ▼
RecommendationController.submitFeedback()
    │
    ▼
RecommendationEngineService.processFeedback()
    ├── FeedbackRepo.save()
    ├── BehaviorService.updatePreferences()
    │     ├── loves[]/avoids[] 更新
    │     └── replacementPatterns 更新
    └── ExplorationState 更新 (alpha/beta)
```

### 2.5 根 AppModule 重构

```typescript
// src/app.module.ts — 干净的根模块
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { AuthModule } from './modules/auth/auth.module';
import { UserProfileModule } from './modules/user-profile/user-profile.module';
import { FoodModule } from './modules/food/food.module';
import { NutritionModule } from './modules/nutrition/nutrition.module';
import { RecommendationModule } from './modules/recommendation/recommendation.module';
import { MealPlanModule } from './modules/meal-plan/meal-plan.module';
import { CoachModule } from './modules/coach/coach.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { AdminModule } from './modules/admin/admin.module';
import { LoggerMiddleware } from './infrastructure/common/middlewares/logger.middleware';

@Module({
  imports: [
    // 基础设施
    InfrastructureModule,
    // 业务领域
    AuthModule,
    UserProfileModule,
    FoodModule,
    NutritionModule,
    RecommendationModule,
    MealPlanModule,
    CoachModule,
    GamificationModule,
    AdminModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
```

---

## 三、前端重构方案（Next.js Web）

### 3.1 当前问题

| 问题 | 证据 |
|------|------|
| 测试/演示页面混入生产路由 | `api-demo/`, `gateway-test/`, `chat/` |
| 无用依赖过多 | `@ffmpeg/ffmpeg`, `jspdf`, `jszip`, `pdf-lib`, `pdfjs-dist`, `qr-code-styling`, `cloudconvert` |
| API 层分散 | `lib/api/` 有 10+ 文件，无统一分层 |
| 状态管理不完整 | 仅 `store/auth.ts` + `store/index.ts` |
| 组件层不清晰 | `components/` 和 `pages-component/` 边界不清 |

### 3.2 新目录结构

```
apps/web/src/
├── middleware.ts                         # Next.js 中间件 (i18n + auth)
│
├── app/                                  # ────── Pages ──────
│   ├── layout.tsx                        # 根布局
│   ├── page.tsx                          # 首页 (redirect to [locale])
│   ├── globals.css
│   ├── robots.ts
│   ├── sitemap.ts
│   │
│   ├── [locale]/                         # 国际化路由
│   │   ├── layout.tsx                    # 带导航的布局
│   │   ├── page.tsx                      # 首页/Landing
│   │   │
│   │   ├── (auth)/                       # 认证相关 (无导航布局)
│   │   │   ├── layout.tsx
│   │   │   ├── login/page.tsx
│   │   │   └── onboarding/              # 🆕 四步引导流
│   │   │       ├── page.tsx             # 引导入口/路由
│   │   │       ├── step-1/page.tsx      # 性别 + 年龄
│   │   │       ├── step-2/page.tsx      # 身体 + 目标
│   │   │       ├── step-3/page.tsx      # 饮食习惯
│   │   │       └── step-4/page.tsx      # 行为 + 心理
│   │   │
│   │   ├── (main)/                       # 主应用 (带底部导航)
│   │   │   ├── layout.tsx
│   │   │   ├── dashboard/page.tsx       # 🆕 今日总览 (替代旧首页)
│   │   │   ├── meal-plan/page.tsx       # 每日计划
│   │   │   ├── foods/
│   │   │   │   ├── page.tsx             # 食物库浏览
│   │   │   │   └── [id]/page.tsx        # 食物详情
│   │   │   ├── analyze/page.tsx         # 饮食分析
│   │   │   ├── coach/page.tsx           # AI 教练
│   │   │   └── challenge/page.tsx       # 挑战
│   │   │
│   │   ├── (settings)/                   # 设置类页面
│   │   │   ├── profile/page.tsx         # 个人档案编辑
│   │   │   └── health-profile/page.tsx  # 健康档案详情
│   │   │
│   │   └── (legal)/
│   │       ├── privacy/page.tsx
│   │       └── terms/page.tsx
│   │
│   └── api/                              # API Routes (仅 BFF)
│       └── auth/
│           └── [...nextauth]/route.ts   # (如需要 SSR 认证)
│
├── components/                           # ────── UI 组件 ──────
│   ├── ui/                               # 基础 UI (Radix + Tailwind)
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   ├── select.tsx
│   │   ├── slider.tsx
│   │   ├── switch.tsx
│   │   ├── tabs.tsx
│   │   ├── badge.tsx
│   │   ├── progress.tsx
│   │   ├── skeleton.tsx
│   │   ├── toast.tsx
│   │   ├── alert.tsx
│   │   └── avatar.tsx
│   │
│   ├── common/                           # 通用业务组件
│   │   ├── site-header.tsx
│   │   ├── bottom-nav.tsx               # 🆕 底部导航
│   │   ├── language-toggle.tsx
│   │   ├── theme-toggle.tsx
│   │   ├── error-boundary.tsx
│   │   └── loading-state.tsx            # 🆕 统一加载态
│   │
│   └── features/                         # 业务功能组件
│       ├── onboarding/
│       │   ├── gender-selector.tsx
│       │   ├── year-picker.tsx
│       │   ├── height-weight-slider.tsx
│       │   ├── goal-selector.tsx
│       │   ├── activity-selector.tsx
│       │   ├── allergen-picker.tsx       # 🆕
│       │   ├── tag-cloud.tsx
│       │   ├── step-progress.tsx         # 🆕 四步进度条
│       │   └── bmr-result-card.tsx       # 🆕 Step2 完成展示
│       │
│       ├── meal-plan/
│       │   ├── daily-plan-card.tsx
│       │   ├── meal-section.tsx
│       │   ├── food-item.tsx
│       │   └── feedback-actions.tsx      # 接受/替换/跳过
│       │
│       ├── food/
│       │   ├── food-list.tsx
│       │   ├── food-detail.tsx
│       │   ├── nutrition-chart.tsx
│       │   └── food-search.tsx
│       │
│       ├── profile/
│       │   ├── profile-card.tsx
│       │   ├── completeness-bar.tsx      # 🆕 完整度进度
│       │   ├── goal-progress.tsx
│       │   └── profile-edit-form.tsx
│       │
│       ├── coach/
│       │   ├── chat-bubble.tsx
│       │   ├── coach-input.tsx
│       │   └── proactive-reminder.tsx
│       │
│       ├── gamification/
│       │   ├── achievement-badge.tsx
│       │   ├── streak-counter.tsx
│       │   └── challenge-card.tsx
│       │
│       └── dashboard/                    # 🆕
│           ├── today-summary.tsx
│           ├── nutrition-progress.tsx
│           └── quick-actions.tsx
│
├── lib/                                  # ────── 工具层 ──────
│   ├── utils.ts                          # 通用工具 (cn, formatDate)
│   ├── env.ts                            # 环境变量
│   │
│   ├── api/                              # API 层 (统一)
│   │   ├── http-client.ts               # Axios 实例 + 拦截器
│   │   ├── auth.api.ts                  # 认证 API
│   │   ├── profile.api.ts              # 画像 API
│   │   ├── food.api.ts                  # 食物 API
│   │   ├── meal-plan.api.ts             # 计划 API
│   │   ├── recommendation.api.ts        # 推荐反馈 API
│   │   ├── coach.api.ts                 # 教练 API
│   │   ├── gamification.api.ts          # 游戏化 API
│   │   └── types.ts                     # API 响应类型
│   │
│   ├── hooks/                            # React Hooks
│   │   ├── use-auth.ts                  # 认证状态
│   │   ├── use-profile.ts              # 🆕 画像 CRUD
│   │   ├── use-meal-plan.ts             # 🆕 计划操作
│   │   ├── use-food.ts                  # 食物查询
│   │   ├── use-recommendation.ts        # 🆕 推荐反馈
│   │   ├── use-coach.ts                 # 🆕 教练交互
│   │   ├── use-toast.ts
│   │   └── use-localized-router.ts
│   │
│   ├── constants/
│   │   ├── config.ts
│   │   ├── query-keys.ts               # React Query keys
│   │   └── profile-constraints.ts       # 🆕 与后端共享的字段约束
│   │
│   ├── i18n/
│   │   ├── config.ts
│   │   └── request.ts
│   │
│   ├── react-query/
│   │   └── client.ts                    # QueryClient 配置
│   │
│   ├── seo/
│   │   ├── metadata.ts
│   │   └── structured-data.ts
│   │
│   └── validations/
│       ├── auth.ts
│       └── profile.ts                   # 🆕 画像表单验证 (Zod)
│
├── providers/
│   ├── auth-provider.tsx
│   ├── query-provider.tsx               # 🆕 React Query Provider
│   └── index.tsx                        # 组合所有 Provider
│
├── store/
│   ├── auth.ts                          # Zustand: 认证状态
│   ├── onboarding.ts                    # 🆕 引导流临时状态
│   └── ui.ts                            # 🆕 UI 状态 (侧边栏/弹窗)
│
└── types/
    ├── api.ts                           # API 响应类型
    ├── profile.ts                       # 🆕 画像类型
    ├── food.ts                          # 🆕 食物类型
    └── meal-plan.ts                     # 🆕 计划类型
```

### 3.3 状态管理设计

```
┌─────────────────────────────────────────────────────────┐
│                     状态管理分层                          │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Zustand (客户端状态)                                    │
│  ├── auth store: token, user, isAuthenticated           │
│  ├── onboarding store: currentStep, tempData            │
│  └── ui store: sidebarOpen, activeModal                 │
│                                                         │
│  React Query (服务端状态)                                 │
│  ├── ['profile', userId] → 用户画像                      │
│  ├── ['meal-plan', date] → 每日计划                      │
│  ├── ['foods', filters] → 食物列表                       │
│  ├── ['food', id] → 食物详情                             │
│  ├── ['coach', conversationId] → 教练对话                │
│  └── ['achievements'] → 成就列表                         │
│                                                         │
│  分工原则：                                              │
│  - 来自服务端的数据 → React Query (缓存 + 自动失效)       │
│  - 纯客户端状态 → Zustand (token, UI 状态)               │
│  - 表单临时状态 → react-hook-form (不持久化)              │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 3.4 API 调用模式

```typescript
// lib/api/http-client.ts — 统一 HTTP 客户端
import axios from 'axios';

const httpClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  timeout: 15000,
});

// 请求拦截 — 注入 token
httpClient.interceptors.request.use(config => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 响应拦截 — 统一错误处理
httpClient.interceptors.response.use(
  res => res.data.data,  // 解包 { code, data, message }
  error => {
    if (error.response?.status === 401) {
      useAuthStore.getState().logout();
    }
    return Promise.reject(error);
  },
);

export { httpClient };

// lib/api/profile.api.ts
import { httpClient } from './http-client';

export const profileApi = {
  getFullProfile: () =>
    httpClient.get<FullUserProfile>('/api/app/profile/full'),

  saveOnboardingStep: (step: number, data: OnboardingStepData) =>
    httpClient.post(`/api/app/profile/onboarding/step/${step}`, data),

  skipOnboardingStep: (step: number) =>
    httpClient.post(`/api/app/profile/onboarding/skip/${step}`),

  updateDeclared: (data: Partial<DeclaredProfile>) =>
    httpClient.patch('/api/app/profile/declared', data),

  getCompletionSuggestions: () =>
    httpClient.get('/api/app/profile/completion-suggestions'),
};

// lib/hooks/use-profile.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileApi } from '../api/profile.api';

export function useProfile() {
  return useQuery({
    queryKey: ['profile'],
    queryFn: profileApi.getFullProfile,
    staleTime: 5 * 60 * 1000,  // 5 分钟
  });
}

export function useSaveOnboardingStep() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ step, data }: { step: number; data: OnboardingStepData }) =>
      profileApi.saveOnboardingStep(step, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}
```

### 3.5 删除文件清单

```bash
# 删除演示/测试页面
rm -rf src/app/[locale]/api-demo/
rm -rf src/app/[locale]/gateway-test/
rm -rf src/app/[locale]/chat/

# 删除无用 API Routes
rm -rf src/app/api/chat/
rm -rf src/app/api/compress/
rm -rf src/app/api/users/

# 删除无用页面组件
rm -rf src/pages-component/gateway/

# 删除无用 lib
rm -rf src/lib/ffmpeg/
rm -rf src/lib/image-converter/
rm -rf src/lib/pdf/
rm -rf src/lib/config/tools.tsx
rm src/lib/server-sse-transport.ts

# 删除无用 API 客户端
rm src/lib/api/gateway-client.ts
rm src/lib/api/server-api.ts
rm src/lib/api/services.ts

# 删除旧的 feature 组件
rm src/components/features/users-demo.tsx
rm src/components/features/users-example.tsx
```

### 3.6 无用 npm 依赖清理

```bash
pnpm remove @ffmpeg/ffmpeg @ai-sdk/react ai jspdf jszip pdf-lib pdfjs-dist \
  qr-code-styling react-easy-crop file-saver cloudconvert @nanostores/react
```

---

## 四、旧系统清理策略

### 4.1 识别标准

| 类型 | 识别方法 | 示例 |
|------|---------|------|
| **死代码** | 无引用、无 import | `src/app.service.ts`（空服务） |
| **演示代码** | 路径含 `demo`/`test`/`example` | `api-demo/`, `gateway-test/` |
| **无关业务** | 与饮食系统无直接关系 | `compress/`, `langchain/` |
| **临时方案** | 注释含 "暂时"、"TODO" | Auth Guard `return true // 暂时` |
| **重复逻辑** | Entity 多次注册 | `FoodLibrary` 在 4 个模块注册 |
| **废弃 Barrel** | 导出不完整的 index.ts | `entities/index.ts` 只导出一半 |

### 4.2 渐进替换步骤

**原则: 不能中断线上服务**

```
Phase 0: 准备期（不改动生产代码）
  ├── 在 src/ 下创建 modules/ 和 infrastructure/ 新目录
  ├── 将 shared/ 常量、枚举、接口定义迁出
  └── 新旧代码并存，新模块暂时不注册到 AppModule

Phase 1: 基础设施迁移（低风险）
  ├── core/ → infrastructure/
  ├── storage/ → infrastructure/storage/
  ├── health/ → infrastructure/health/
  └── 验证: API 功能不变

Phase 2: 领域模块逐个迁移
  ├── auth 模块（第一个迁移 — 最基础）
  │   ├── 新建 modules/auth/
  │   ├── 将 entity、service、controller、guard 搬移
  │   ├── 更新 AppModule imports
  │   └── 验证: 登录/注册流程正常
  │
  ├── food 模块（含 pipeline）
  │   ├── 合并 food-pipeline/ + food 相关逻辑
  │   ├── 新建 modules/food/
  │   └── 验证: 食物库查询/管道功能正常
  │
  ├── user-profile 模块
  │   ├── 新建 modules/user-profile/
  │   ├── 迁移 + 新增 InferredProfile、Snapshot entity
  │   └── 验证: 档案 CRUD 正常
  │
  ├── nutrition + recommendation 模块
  │   ├── 拆分 recommendation-engine.service.ts（目前是大杂烩）
  │   ├── 评分逻辑 → modules/nutrition/domain/
  │   ├── 推荐逻辑 → modules/recommendation/domain/
  │   └── 验证: 推荐结果正确性
  │
  ├── meal-plan 模块
  │   ├── daily-plan 相关迁移
  │   └── 验证: 计划生成正常
  │
  ├── coach 模块
  │   ├── coach + behavior 迁移
  │   └── 验证: 教练对话正常
  │
  ├── gamification 模块
  │   ├── 成就 + 挑战迁移
  │   └── 验证: 游戏化功能正常
  │
  └── admin 模块（最后迁移 — 影响面最广）
      ├── 拆分 AdminModule 巨石
      ├── 各子功能使用对应领域模块的 exported service
      └── 验证: 管理后台全部功能正常

Phase 3: 清理
  ├── 删除旧 src/app/ 目录（原 AppClientModule）
  ├── 删除旧 src/admin/ 目录（原 AdminModule）
  ├── 删除 src/compress/, src/langchain/
  ├── 精简 src/gateway/ → infrastructure/ai-gateway/
  ├── 清理 entities/index.ts → 各模块自有 entities/
  └── 删除所有空文件
```

### 4.3 风险点与回滚

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|---------|
| 迁移过程中 Entity 遗漏导致表不被识别 | 高 | 🔴 API 500 | 每次迁移后跑 `TypeORM` 连接测试 |
| 模块间循环依赖 | 中 | 🟠 无法启动 | 迁移前画依赖图，forwardRef 是临时方案，最终消除 |
| JWT Secret 切换导致 token 失效 | 低 | 🟠 用户需重新登录 | 统一 Secret 来源为环境变量，不改值 |
| Migration 数据丢失 | 低 | 🔴 数据不可逆 | 迁移前 pg_dump 备份 |
| 前端路由变更导致 SEO 降级 | 中 | 🟡 搜索排名下降 | 配置 301 redirect 旧路径 → 新路径 |

**回滚策略**:
```
每个 Phase 对应一个 Git Branch:
  refactor/phase-1-infrastructure
  refactor/phase-2-auth
  refactor/phase-2-food
  ...

回滚 = 切回上一个已验证的 branch 并重新部署
不 force push，不 amend，保留完整历史
```

---

## 五、数据结构与接口重构

### 5.1 用户画像统一 Schema

```typescript
// shared/interfaces/user-profile.interface.ts

/** 完整用户画像 — 三层结构 */
export interface FullUserProfile {
  declared: DeclaredProfile;
  observed: ObservedProfile;
  inferred: InferredProfile;
  meta: ProfileMeta;
}

/** Layer 1: 用户声明的数据 */
export interface DeclaredProfile {
  // 基础身体
  gender?: 'male' | 'female' | 'other';
  birthYear?: number;
  heightCm?: number;
  weightKg?: number;
  targetWeightKg?: number;
  bodyFatPercent?: number;
  // 目标
  goal: GoalType;
  goalSpeed: GoalSpeed;
  activityLevel: ActivityLevel;
  dailyCalorieGoal?: number;
  // 饮食
  mealsPerDay: number;
  takeoutFrequency: 'never' | 'sometimes' | 'often';
  canCook: boolean;
  cookingSkillLevel?: 'none' | 'basic' | 'intermediate' | 'advanced';
  foodPreferences: string[];
  dietaryRestrictions: string[];
  allergens: string[];
  // 健康
  healthConditions?: string[];
  // 行为
  weakTimeSlots: string[];
  bingeTriggers: string[];
  discipline: Discipline;
}

/** Layer 2: 系统观测的行为数据 */
export interface ObservedProfile {
  foodPreferences: {
    loves?: string[];
    avoids?: string[];
    frequentFoods?: string[];
  };
  bingeRiskHours: number[];
  failureTriggers: string[];
  avgComplianceRate: number;
  mealTimingPatterns?: Record<string, string>;
  portionTendency?: 'under' | 'normal' | 'over';
  replacementPatterns?: Record<string, number>;
  totalRecords: number;
  healthyRecords: number;
  streakDays: number;
  longestStreak: number;
  coachStyle: string;
}

/** Layer 3: 算法推断的数据 */
export interface InferredProfile {
  estimatedBMR?: number;
  estimatedTDEE?: number;
  recommendedCalories?: number;
  macroTargets?: { proteinG: number; carbG: number; fatG: number };
  userSegment?: string;
  churnRisk: number;
  nutritionGaps?: string[];
  goalProgress?: {
    startWeight?: number;
    currentWeight?: number;
    progressPercent?: number;
    trend?: 'on_track' | 'behind' | 'ahead';
  };
  confidenceScores: Record<string, number>;
}

/** 元数据 */
export interface ProfileMeta {
  profileVersion: number;
  onboardingStep: number;
  onboardingCompleted: boolean;
  dataCompleteness: number;
  lastActiveAt: Date;
}
```

### 5.2 食物数据标准化

```typescript
// shared/interfaces/food.interface.ts

export interface StandardizedFood {
  id: string;
  // 基本信息
  name: string;                     // 英文/标准名
  localizedName?: string;           // 本地化名称
  category: FoodCategory;           // 统一英文枚举
  tags: string[];                   // 统一英文标签
  // 营养成分（per 100g）
  nutrition: {
    caloriesPer100g: number;
    proteinPer100g: number;
    fatPer100g: number;
    carbsPer100g: number;
    fiberPer100g?: number;
    sugarPer100g?: number;
    sodiumMg?: number;
    saturatedFatG?: number;
    transFatG?: number;
  };
  // 扩展营养（V2）
  extendedNutrition?: {
    glycemicIndex?: number;
    glycemicLoad?: number;
    novaLevel?: 1 | 2 | 3 | 4;
    omega3mg?: number;
    omega6mg?: number;
    vitaminA_mcg?: number;
    vitaminC_mg?: number;
    vitaminD_mcg?: number;
    calcium_mg?: number;
    iron_mg?: number;
    potassium_mg?: number;
    magnesium_mg?: number;
  };
  // 份量
  defaultServingG: number;
  servingUnit: string;
  // 食品安全
  allergens: string[];               // milk, eggs, fish, shellfish...
  // 元数据
  source: 'manual' | 'usda' | 'openfoodfacts' | 'ai_generated';
  qualityScore?: number;
  isActive: boolean;
}

// 统一分类枚举 — 修复中英文混杂 Bug
export enum FoodCategory {
  PROTEIN = 'protein',       // 肉蛋奶豆
  GRAIN = 'grain',           // 主食
  VEGETABLE = 'vegetable',   // 蔬菜
  FRUIT = 'fruit',           // 水果
  DAIRY = 'dairy',           // 乳制品
  FAT = 'fat',               // 油脂坚果
  BEVERAGE = 'beverage',     // 饮品
  SNACK = 'snack',           // 零食
  CONDIMENT = 'condiment',   // 调味品
  MIXED = 'mixed',           // 混合菜品
}
```

### 5.3 API 接口设计

#### 规范

- RESTful，路径前缀: C端 `/api/app/`，B端 `/api/admin/`
- 统一响应格式: `{ code: number, data: T, message: string }`
- 分页: `?page=1&limit=20`，响应含 `{ items: T[], total: number, page: number, limit: number }`
- 错误: HTTP status code + `code` 字段 (业务错误码)

#### C端 API 清单

```
# 认证
POST   /api/app/auth/login/wechat-mini     { code }
POST   /api/app/auth/login/phone            { phone, code }
POST   /api/app/auth/login/anonymous
GET    /api/app/auth/me

# 用户画像
POST   /api/app/profile/onboarding/step/:step
POST   /api/app/profile/onboarding/skip/:step
GET    /api/app/profile/full
PATCH  /api/app/profile/declared
GET    /api/app/profile/completion-suggestions
POST   /api/app/profile/infer/refresh
GET    /api/app/profile/goal-transition

# 食物库
GET    /api/app/foods                        ?category=&search=&page=&limit=
GET    /api/app/foods/:id

# 饮食记录
POST   /api/app/food-records                 { foodId, mealType, servings, ... }
GET    /api/app/food-records                 ?date=&mealType=
DELETE /api/app/food-records/:id
GET    /api/app/food-records/daily-summary   ?date=

# 每日计划
POST   /api/app/meal-plan/generate           { date }
GET    /api/app/meal-plan                    ?date=
GET    /api/app/meal-plan/:id

# 推荐反馈
POST   /api/app/recommendation/feedback      { foodId, mealType, action, replacementFoodId? }

# AI 教练
POST   /api/app/coach/message                { message }
GET    /api/app/coach/conversations
GET    /api/app/coach/conversations/:id/messages
GET    /api/app/coach/proactive-check

# 游戏化
GET    /api/app/achievements
GET    /api/app/challenges
POST   /api/app/challenges/:id/join
GET    /api/app/challenges/:id/progress

# 文件
POST   /api/app/files/upload
```

#### B端 API 清单

```
# 认证
POST   /api/admin/auth/login                 { email, password }
GET    /api/admin/auth/me

# 用户管理
GET    /api/admin/users                      ?page=&search=&status=
GET    /api/admin/users/:id
PATCH  /api/admin/users/:id/status           { status }

# 食物库管理
GET    /api/admin/foods                      ?page=&category=&source=
POST   /api/admin/foods
PUT    /api/admin/foods/:id
DELETE /api/admin/foods/:id
POST   /api/admin/foods/pipeline/run         { source, options }

# 数据分析
GET    /api/admin/analytics/overview
GET    /api/admin/analytics/users            ?from=&to=
GET    /api/admin/analytics/recommendations  ?from=&to=

# 内容管理 (成就/挑战)
CRUD   /api/admin/achievements
CRUD   /api/admin/challenges

# 版本管理
CRUD   /api/admin/app-versions
```

### 5.4 DTO 设计示例

```typescript
// modules/user-profile/dto/onboarding-step.dto.ts
import { IsNotEmpty, IsOptional, IsNumber, IsString, IsIn, IsArray, Min, Max, IsInt, IsBoolean, ValidateIf } from 'class-validator';
import { Type } from 'class-transformer';

export class OnboardingStep1Dto {
  @IsNotEmpty()
  @IsIn(['male', 'female', 'other'])
  gender: string;

  @IsNotEmpty()
  @IsInt()
  @Min(1940)
  @Max(2020)
  birthYear: number;
}

export class OnboardingStep2Dto {
  @IsNotEmpty()
  @IsNumber()
  @Min(50)
  @Max(250)
  heightCm: number;

  @IsNotEmpty()
  @IsNumber()
  @Min(20)
  @Max(300)
  weightKg: number;

  @IsNotEmpty()
  @IsIn(['fat_loss', 'muscle_gain', 'health', 'habit'])
  goal: string;

  @IsNotEmpty()
  @IsIn(['sedentary', 'light', 'moderate', 'active'])
  activityLevel: string;

  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(200)
  targetWeightKg?: number;

  @IsOptional()
  @IsNumber()
  @Min(800)
  @Max(5000)
  dailyCalorieGoal?: number;
}

export class OnboardingStep3Dto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(6)
  mealsPerDay?: number;

  @IsOptional()
  @IsIn(['never', 'sometimes', 'often'])
  takeoutFrequency?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergens?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  dietaryRestrictions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  foodPreferences?: string[];
}

export class OnboardingStep4Dto {
  @IsOptional()
  @IsIn(['high', 'medium', 'low'])
  discipline?: string;

  @IsOptional()
  @IsArray()
  weakTimeSlots?: string[];

  @IsOptional()
  @IsArray()
  bingeTriggers?: string[];

  @IsOptional()
  @IsBoolean()
  canCook?: boolean;
}

// 统一包装 — Controller 根据 step 参数选择对应 DTO
export type OnboardingStepDto =
  | OnboardingStep1Dto
  | OnboardingStep2Dto
  | OnboardingStep3Dto
  | OnboardingStep4Dto;
```

---

## 六、推荐系统接入方案

### 6.1 数据流全景

```
┌──────────────────────────────────────────────────────────────────────┐
│                        推荐系统数据流                                 │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────┐                                                        │
│  │ 用户画像 │ ProfileCacheService.getFullProfile()                    │
│  │ Module   │ → { declared, observed, inferred }                     │
│  └────┬────┘                                                        │
│       │                                                              │
│       │  ① 提供目标/约束/偏好                                         │
│       ▼                                                              │
│  ┌─────────────────────────────────┐                                │
│  │      Recommendation Engine       │                                │
│  │                                  │                                │
│  │  ┌─── Recall ────┐              │  ② 从食物模块获取候选           │
│  │  │ hardFilter()   │◄────────────│───── FoodLibraryService         │
│  │  │ tagRecall()    │              │      .getActiveFoods()          │
│  │  └───────┬───────┘              │                                │
│  │          ▼                       │                                │
│  │  ┌─── Ranking ───┐              │  ③ 调用营养评分                  │
│  │  │ for each food: │◄────────────│───── NutritionScoreService      │
│  │  │   score()      │              │      .computeScore()            │
│  │  └───────┬───────┘              │                                │
│  │          ▼                       │                                │
│  │  ┌── Reranking ──┐              │                                │
│  │  │ diversity()    │              │                                │
│  │  │ exploration()  │              │                                │
│  │  │ portions()     │              │                                │
│  │  └───────┬───────┘              │                                │
│  │          ▼                       │                                │
│  │     MealRecommendation           │                                │
│  └──────────┬───────────────────────┘                                │
│             │                                                        │
│             │  ④ 组装每日计划                                        │
│             ▼                                                        │
│  ┌─────────────────────┐                                            │
│  │    MealPlan Module    │                                            │
│  │  dailyPlan.service    │                                            │
│  │  ├── allocateBudgets  │                                            │
│  │  ├── 4× recommendMeal │                                            │
│  │  └── globalCalibrate  │                                            │
│  └──────────┬───────────┘                                            │
│             │                                                        │
│             │  ⑤ 用户反馈回流                                        │
│             ▼                                                        │
│  ┌─────────────────────┐    ┌──────────────────┐                    │
│  │  Feedback Collector  │───►│  BehaviorService  │                    │
│  │  (accepted/replaced/ │    │  更新 loves/avoids │                    │
│  │   skipped)           │    │  更新 exploration  │                    │
│  └──────────────────────┘    │  state (α/β)      │                    │
│                              └────────┬─────────┘                    │
│                                       │                              │
│                                       │  ⑥ 异步更新推断              │
│                                       ▼                              │
│                              ┌──────────────────┐                    │
│                              │ ProfileInference  │                    │
│                              │ .recompute()      │                    │
│                              │ → segment         │                    │
│                              │ → churnRisk       │                    │
│                              │ → nutritionGaps   │                    │
│                              └──────────────────┘                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 6.2 调用链路（时序）

```
Client                MealPlan          Recommendation      Nutrition        UserProfile        Food
  │                      │                    │                │                 │               │
  │ POST /meal-plan/generate                  │                │                 │               │
  │─────────────────────►│                    │                │                 │               │
  │                      │                    │                │                 │               │
  │                      │ getFullProfile()   │                │                 │               │
  │                      │────────────────────│────────────────│────────────────►│               │
  │                      │                    │                │                 │               │
  │                      │◄────────────────────────────────────│─────────────────│               │
  │                      │ { declared, observed, inferred }    │                 │               │
  │                      │                    │                │                 │               │
  │                      │ allocateBudgets()  │                │                 │               │
  │                      │ (pure function)    │                │                 │               │
  │                      │                    │                │                 │               │
  │                      │ for meal in [B,L,D,S]:             │                 │               │
  │                      │                    │                │                 │               │
  │                      │ recommendMeal()    │                │                 │               │
  │                      │───────────────────►│                │                 │               │
  │                      │                    │                │                 │               │
  │                      │                    │ getActiveFoods()                 │               │
  │                      │                    │────────────────│─────────────────│──────────────►│
  │                      │                    │◄───────────────│─────────────────│───────────────│
  │                      │                    │                │                 │               │
  │                      │                    │ hardFilter()   │                 │               │
  │                      │                    │ tagRecall()    │                 │               │
  │                      │                    │                │                 │               │
  │                      │                    │ for each candidate:             │               │
  │                      │                    │ computeScore() │                 │               │
  │                      │                    │───────────────►│                 │               │
  │                      │                    │◄───────────────│                 │               │
  │                      │                    │                │                 │               │
  │                      │                    │ diversity()    │                 │               │
  │                      │                    │ exploration()  │                 │               │
  │                      │                    │ portions()     │                 │               │
  │                      │                    │                │                 │               │
  │                      │◄───────────────────│                │                 │               │
  │                      │ MealRecommendation │                │                 │               │
  │                      │                    │                │                 │               │
  │                      │ end for            │                │                 │               │
  │                      │                    │                │                 │               │
  │                      │ globalCalibrate()  │                │                 │               │
  │                      │ planRepo.save()    │                │                 │               │
  │                      │                    │                │                 │               │
  │◄─────────────────────│                    │                │                 │               │
  │ DailyPlan            │                    │                │                 │               │
```

### 6.3 缓存策略

```
┌─────────────────────────────────────────────────────────┐
│                     缓存策略                              │
├──────────────────┬──────────┬───────────┬───────────────┤
│ 数据              │ TTL      │ 失效策略    │ 存储          │
├──────────────────┼──────────┼───────────┼───────────────┤
│ 食物库全量数据     │ 30 min   │ 管道更新后   │ 进程内 Map    │
│ 用户画像 declared │ 5 min    │ 用户编辑后   │ 进程内 Map    │
│ 用户画像 observed │ 1 min    │ 反馈提交后   │ 进程内 Map    │
│ 用户画像 inferred │ 30 min   │ Cron 更新后  │ 进程内 Map    │
│ 每日计划          │ 当天      │ 重新生成后   │ PostgreSQL   │
│ 推荐评分结果      │ 不缓存    │ —          │ —            │
│ Exploration State │ 7 days   │ 反馈更新后   │ PostgreSQL   │
└──────────────────┴──────────┴───────────┴───────────────┘

注: 当前规模（<10K 用户）使用进程内 Map 足够。
    超过 10K 用户后迁移到 Redis (项目已有 redis 依赖)。
```

**缓存实现**:

```typescript
// modules/user-profile/services/profile-cache.service.ts
@Injectable()
export class ProfileCacheService {
  private cache = new Map<string, { data: FullUserProfile; exp: number }>();

  private readonly TTL = {
    declared: 5 * 60_000,
    observed: 60_000,
    inferred: 30 * 60_000,
  };

  async getFullProfile(userId: string): Promise<FullUserProfile> {
    const cached = this.cache.get(userId);
    if (cached && cached.exp > Date.now()) return cached.data;

    const [declared, observed, inferred] = await Promise.all([
      this.profileRepo.findOne({ where: { userId } }),
      this.behaviorRepo.findOne({ where: { userId } }),
      this.inferredRepo.findOne({ where: { userId } }),
    ]);

    const full: FullUserProfile = {
      declared: declared ?? DEFAULT_DECLARED,
      observed: observed ?? DEFAULT_OBSERVED,
      inferred: inferred ?? DEFAULT_INFERRED,
      meta: this.buildMeta(declared),
    };

    this.cache.set(userId, {
      data: full,
      exp: Date.now() + Math.min(this.TTL.declared, this.TTL.observed),
    });

    return full;
  }

  invalidate(userId: string) {
    this.cache.delete(userId);
  }
}
```

---

## 七、渐进式重构执行计划

### Phase 1: 架构搭建（1 周）

**做什么**:
```
□ 创建 src/infrastructure/ 目录结构
□ 创建 src/modules/ 目录结构（空壳，仅 .module.ts）
□ 创建 src/shared/ （常量、枚举、接口、工具函数）
□ 迁移 core/ → infrastructure/ （Config, Database, Logger）
□ 迁移 storage/ → infrastructure/storage/
□ 迁移 health/ → infrastructure/health/
□ 精简 gateway/ → infrastructure/ai-gateway/ （仅保留 OpenRouter）
□ 删除 compress/ , langchain/
□ 更新 AppModule imports
□ 所有现有功能保持不变
```

**风险**: 低。仅重命名目录和调整 import 路径。

**验证方式**:
```bash
# 1. 编译通过
pnpm build

# 2. 所有现有 API 端点可达
curl http://localhost:3006/api/app/auth/me
curl http://localhost:3006/health

# 3. 数据库连接正常
pnpm typeorm:run-migrations
```

### Phase 2: 核心模块迁移（3-4 周）

按依赖顺序逐个迁移:

#### Week 1: auth + food

```
□ 创建 modules/auth/ 完整结构
  - 从旧 admin/ 迁移: admin-user entity, jwt strategy, auth guards
  - 从旧 app/ 迁移: app-user entity, app-auth service, wechat-auth
  - 统一认证守卫
  - 修复: JWT secret 硬编码 fallback → 必须从环境变量读取
  - 修复: Auth Guard 不再是 Proxy hack
□ 创建 modules/food/ 完整结构
  - 从旧 app/ 迁移: food-library service, food service
  - 合并旧 food-pipeline/ 为 modules/food/pipeline/
  - 统一 Entity: FoodLibrary + FoodTranslation + FoodSource + etc.
  - **修复: ROLE_CATEGORIES 中英文不匹配 Bug**
  - 更新 AppModule
□ 删除 从旧 admin/services/ 和 app/services/ 中已迁出的文件
```

**验证**:
```bash
# 登录流程
curl -X POST http://localhost:3006/api/app/auth/login/anonymous
# 食物库查询
curl http://localhost:3006/api/app/foods
# 管道运行
curl -X POST http://localhost:3006/api/admin/foods/pipeline/run
```

#### Week 2: user-profile + nutrition

```
□ 创建 modules/user-profile/ 完整结构
  - 迁移 UserProfile, UserBehaviorProfile entities
  - 新建 UserInferredProfile, ProfileSnapshot entities
  - 新建 ProfileManageService（含四步引导流）
  - 新建 ProfileInferenceService（BMR/TDEE/分群）
  - 新建 ProfileCacheService
  - domain/: bmr-calculator, completeness-calculator (纯函数)
  - **修复: bingeTriggers entity 有但 API 不收集**
  - **新增: allergens 字段**
  - 运行 migration
□ 创建 modules/nutrition/ 完整结构
  - 从旧 nutrition-score.service.ts 中提取评分逻辑
  - 拆分为 10 个独立 scorer (domain/scorers/)
  - 新建 weight-calculator, penalty-engine (domain/)
  - 旧 nutrition-score.service.ts 改为调用新 domain 函数
```

**验证**:
```bash
# 引导流
curl -X POST http://localhost:3006/api/app/profile/onboarding/step/1 -d '{"gender":"male","birthYear":1995}'
# 画像完整度
curl http://localhost:3006/api/app/profile/full
# 验证 BMR 计算
node -e "const {calculateBMR} = require('./dist/modules/user-profile/domain/bmr-calculator'); console.log(calculateBMR({gender:'male',weightKg:75,heightCm:178,age:31}))"
```

#### Week 3: recommendation + meal-plan

```
□ 创建 modules/recommendation/ 完整结构
  - 拆分旧 recommendation-engine.service.ts 巨石服务
  - domain/recall/: hard-filter, tag-recall, constraint-generator
  - domain/ranking/: food-ranker, similarity-penalty
  - domain/reranking/: diversity-engine, exploration-strategy, portion-optimizer
  - **修复: MEAL_PREFERENCES 中英文标签不匹配**
  - **升级: 从 ε-greedy 到 Thompson Sampling**
□ 创建 modules/meal-plan/ 完整结构
  - 迁移 daily-plan service
  - 新建 domain/meal-budget-allocator, global-calibrator
  - 连接 recommendation 模块
□ 验证推荐结果与旧系统一致（或更好）
```

#### Week 4: coach + gamification + admin

```
□ 创建 modules/coach/
  - 迁移 coach service, behavior service
  - 迁移 CoachConversation, CoachMessage entities
□ 创建 modules/gamification/
  - 迁移 gamification service
  - 迁移 Achievement, Challenge 相关 entities
□ 创建 modules/admin/ (精简版)
  - 仅包含 B端特有逻辑 (analytics, content-management, app-version)
  - 引用各领域模块的 exported service 来操作数据
  - 不再直接注册所有 Entity
```

### Phase 3: 旧系统下线（1 周）

```
□ 删除 src/app/ 目录（旧 AppClientModule 已被各 modules 替代）
□ 删除 src/admin/ 目录（旧 AdminModule 已被各 modules 替代）
□ 删除 src/compress/
□ 删除 src/langchain/
□ 清理 src/entities/index.ts（不再需要全局 barrel — 各模块自有）
□ 删除 src/gateway/ 残余文件（已精简到 infrastructure/ai-gateway/）
□ 删除空文件: src/app.controller.ts, src/app.service.ts
□ 清理 package.json 无用依赖
□ 全面回归测试
```

**验证**:
```bash
# 编译无错误
pnpm build
# 全部 API 端点测试
pnpm test:e2e
# 数据库完整性校验
pnpm typeorm query "SELECT table_name FROM information_schema.tables WHERE table_schema='public'"
```

### Phase 4: 优化与增强（2-3 周）

```
□ 补充单元测试（domain/ 纯函数，覆盖率 > 80%）
□ 实现 V3 新增评分维度 (glycemic, processing, nutrient-density, inflammation)
□ 实现 ProfileInferenceService Cron Jobs
□ 实现前端引导流四步 UI
□ 性能优化: 添加缓存层
□ API 文档: Swagger 完善
□ 监控: 推荐质量指标采集
□ 前端: 清理无用依赖和页面
```

### Phase 时间线总览

```
┌─────────┬──────────────────────────────────────────────────────────┐
│  Week   │  里程碑                                                  │
├─────────┼──────────────────────────────────────────────────────────┤
│  W1     │ Phase 1: 架构搭建 + 垃圾清理                             │
│  W2     │ Phase 2a: auth + food 模块迁移                           │
│  W3     │ Phase 2b: user-profile + nutrition 模块迁移              │
│  W4     │ Phase 2c: recommendation + meal-plan 模块迁移            │
│  W5     │ Phase 2d: coach + gamification + admin 模块迁移          │
│  W6     │ Phase 3: 旧系统下线 + 清理 + 回归测试                     │
│  W7-8   │ Phase 4a: 单元测试 + V3 评分新维度                        │
│  W9-10  │ Phase 4b: 前端重构 + 引导流 + 缓存优化                    │
└─────────┴──────────────────────────────────────────────────────────┘
```

---

## 八、重构风险与反模式

### 8.1 常见重构失败原因（结合本项目）

| # | 失败原因 | 本项目风险点 | 预防措施 |
|---|---------|-------------|---------|
| 1 | **重构范围过大，一次性推翻** | 尝试同时重构 admin + app + gateway → 无法部署 | 按模块逐个迁移，每个模块完成后立即部署验证 |
| 2 | **缺少回归测试** | 当前无自动化测试 → 改了不知道是否破坏了旧功能 | 每个模块迁移前先写核心 API 的集成测试 |
| 3 | **低估数据迁移复杂度** | Entity 新增字段（allergens, InferredProfile）需要 migration | migration 先在 dev 环境跑通，再上 prod |
| 4 | **过度设计** | "顺便"加 Redis 集群、消息队列、Docker K8s → 工期爆炸 | 保持 Phase 1-3 "迁移 only"，Phase 4 再优化 |
| 5 | **文件移动导致 Git 历史丢失** | `git mv` 才能保留文件历史 | 使用 `git mv` 而非 delete + create |

### 8.2 绝对不能"边改边用"的模块

| 模块 | 原因 | 策略 |
|------|------|------|
| **auth (认证)** | 改动中若 JWT 验证失败 → 全站 401 | 完整迁移 + 切换，不做partial |
| **database (TypeORM 连接)** | Entity 漏注册 → 表不识别 → 500 | infrastructure/ 搬完 + Entity 列表全检查后一次切换 |
| **recommendation-engine** | 评分/召回/重排三阶段相互耦合 | 整体迁移 + 新旧对比测试 |

### 8.3 可以渐进替换的模块

| 模块 | 原因 | 策略 |
|------|------|------|
| **food (食物库)** | 纯 CRUD，新旧可以并存 | 新接口 → 灰度 → 全量 → 删旧接口 |
| **gamification** | 相对独立，不影响核心推荐 | 随时迁移 |
| **coach** | AI 教练独立，不影响推荐/计划 | 随时迁移 |
| **admin** | B端功能不影响 C端 | 最后迁移，引用各领域模块 service |
| **前端组件** | 组件化，可逐个替换 | 旧组件上加 `@deprecated` 注释，新页面用新组件 |

### 8.4 如何保证代码"越来越干净"

```
┌───────────────────────────────────────────────────────────────┐
│                   代码卫生持续治理                              │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│  👮 门禁机制 (每次 PR 检查)                                     │
│  ├── ✅ ESLint: no-unused-vars, no-console                    │
│  ├── ✅ 模块边界: 禁止 modules/A/ 直接 import modules/B/entities│
│  │     (只能 import B module 的 exported service)              │
│  ├── ✅ 循环依赖检测: depcheck / madge                         │
│  └── ✅ 无 barrel re-export (避免废弃的 index.ts 文件)          │
│                                                               │
│  📏 架构规则 (文档 + Code Review)                               │
│  ├── Controller 不含业务逻辑（仅调用 Service）                   │
│  ├── Service 不含数据访问（通过 Repository 或其他 Service）       │
│  ├── Domain 纯函数（不依赖 NestJS、不注入依赖）                   │
│  ├── 新增 Entity 必须属于且仅属于一个模块                        │
│  └── 跨模块通信只能通过 Module exports                          │
│                                                               │
│  🔍 定期检查 (每两周)                                          │
│  ├── 运行 `npx depcheck` 检测无用依赖                           │
│  ├── 运行 `npx madge --circular src/` 检测循环依赖              │
│  ├── 检查 TODO/FIXME/HACK 数量趋势                             │
│  └── Entity 重复注册检查（同一 Entity 不应出现在多个 Module）     │
│                                                               │
│  🧹 清理日 (每月一次)                                           │
│  ├── 清理无引用的 Service / Controller                          │
│  ├── 合并重复的 DTO                                             │
│  ├── 更新过时的注释                                              │
│  └── 清理 dead code (coverage report)                          │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 8.5 模块边界 ESLint 规则（示例）

```javascript
// eslint.config.mjs — 模块边界规则
export default [
  {
    // 禁止跨模块直接 import entity
    files: ['src/modules/*/services/**/*.ts', 'src/modules/*/controllers/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['../../../modules/*/entities/*'],
            message: '不要跨模块直接 import entity，请通过目标模块的 exported service 访问数据',
          },
          {
            group: ['../../entities/*'],
            message: 'Entity 已迁移到各模块内部，请从本模块的 entities/ 导入',
          },
        ],
      }],
    },
  },
  {
    // domain/ 下的文件不能 import NestJS
    files: ['src/modules/*/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['@nestjs/*'],
            message: 'Domain 层必须是纯函数，不能依赖 NestJS 框架',
          },
          {
            group: ['typeorm'],
            message: 'Domain 层必须是纯函数，不能依赖 TypeORM',
          },
        ],
      }],
    },
  },
];
```

---

> **总结**: 本重构方案将 api-server 从 "2 个 God Module + 33 个扁平 Entity" 的单体结构，重构为 "8 个领域模块 + 分层 Domain 模式" 的清洁架构。核心修复包括：Auth Guard 安全漏洞、中英文标签不匹配致命 Bug、Entity 三重注册冗余、推荐引擎巨石服务拆分。前端从包含测试页面和无用依赖的臃肿结构，精简为专注饮食管理的清洁应用。渐进式执行计划确保线上服务不中断。
