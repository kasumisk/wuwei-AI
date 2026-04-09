# API Server — 模块化重构后项目文档

> 更新日期: 2026-04-09 | NestJS 11 + TypeORM + PostgreSQL

---

## 一、项目概览

```
apps/api-server/src/
├── main.ts                     # 启动入口 (Fastify/Express)
├── app.module.ts               # 根模块
├── app.controller.ts           # 根路由 GET /api
├── app.service.ts              # 根服务
│
├── core/                       # 基础设施 (CoreModule)
├── common/                     # 共享类型/工具
├── storage/                    # 文件存储 (StorageModule, @Global)
├── compress/                   # 媒体压缩 (CompressModule)
├── health/                     # 健康检查 (HealthModule)
├── gateway/                    # AI 网关 (GatewayModule)
├── langchain/                  # LLM/RAG (LangChainModule)
├── food-pipeline/              # 食物数据 ETL (FoodPipelineModule)
├── migrations/                 # TypeORM 数据库迁移
├── scripts/                    # 种子脚本
│
└── modules/                    # ★ 12 个领域模块
    ├── auth/                   # AuthModule - 认证
    ├── user/                   # UserModule - 用户
    ├── food/                   # FoodModule - 食物库
    ├── diet/                   # DietModule - 饮食/营养
    ├── coach/                  # CoachModule - AI 教练
    ├── gamification/           # GamificationModule - 游戏化
    ├── rbac/                   # RbacModule - 角色权限
    ├── client/                 # ClientModule - API 客户端
    ├── provider/               # ProviderModule - AI 提供商
    ├── app-version/            # AppVersionModule - 版本管理
    ├── analytics/              # AnalyticsModule - 数据分析
    └── file/                   # FileModule - 文件上传
```

---

## 二、AppModule 顶层导入

```typescript
AppModule
├── CoreModule                  // 基础设施: ConfigModule + DatabaseModule + LoggerModule
├── StorageModule               // @Global — S3/本地文件存储
│
├── AuthModule                  // 认证 (JWT, 微信, 手机, 邮箱)
├── UserModule                  // 用户档案 & 管理
├── FoodModule                  // 食物库 CRUD & AI 分析
├── DietModule                  // 饮食记录 & 计划 & 推荐引擎
├── CoachModule                 // AI 教练对话
├── GamificationModule          // 成就 & 挑战
├── RbacModule                  // 角色 & 权限 & 模板
├── ClientModule                // API 客户端管理
├── ProviderModule              // AI 提供商 & 模型配置
├── AppVersionModule            // App 版本管理
├── AnalyticsModule             // 使用统计分析
├── FileModule                  // 文件上传 (Admin/App)
│
├── HealthModule                // 健康检查
├── GatewayModule               // AI 模型网关路由
├── LangChainModule             // LLM 编排 (RAG)
├── CompressModule              // 媒体压缩
└── FoodPipelineModule          // 食物数据 ETL
```

---

## 三、12 个领域模块详情

### 每个模块统一目录约定

```
modules/<domain>/
├── <domain>.module.ts            # 模块定义
├── entities/                     # TypeORM 实体
├── admin/                        # Admin 端 (controller + service + dto)
└── app/                          # App 端 (controller + service + dto)
```

---

### 1. AuthModule (`modules/auth/`)

| 层           | 文件                                                                             | 说明                            |
| ------------ | -------------------------------------------------------------------------------- | ------------------------------- |
| **Admin**    | `admin-auth.controller.ts`                                                       | Admin 登录/注册 (`/api/auth`)   |
|              | `admin-auth.service.ts`                                                          | Admin 认证逻辑                  |
|              | `jwt-auth.guard.ts`                                                              | Admin JWT 守卫                  |
|              | `jwt.strategy.ts`                                                                | Admin JWT 策略                  |
|              | `current-user.decorator.ts`                                                      | `@CurrentUser()` 装饰器         |
|              | `rbac-permission.guard.ts`                                                       | RBAC 权限守卫 (委托 RbacModule) |
|              | `roles.guard.ts`                                                                 | 角色守卫 (旧版兼容)             |
| **App**      | `app-auth.controller.ts`                                                         | App 用户登录 (`/api/app/auth`)  |
|              | `app-auth.service.ts`                                                            | App 认证 (匿名/手机/微信/邮箱)  |
|              | `app-jwt-auth.guard.ts`                                                          | App JWT 守卫                    |
|              | `app-jwt.strategy.ts`                                                            | App JWT 策略 (`app-jwt`)        |
|              | `current-app-user.decorator.ts`                                                  | `@CurrentAppUser()` 装饰器      |
|              | `wechat-auth.service.ts`                                                         | 微信公众号 & 小程序登录         |
|              | `sms.service.ts`                                                                 | 短信验证码                      |
|              | `firebase-admin.service.ts`                                                      | Firebase Admin 集成             |
| **Entities** | `AppUser`, `AdminUser`                                                           | (引用自 UserModule)             |
| **Exports**  | `AppAuthService`, `AdminService`, `AppJwtAuthGuard`, `JwtAuthGuard`, `JwtModule` |

**API 路由:**

- `POST /api/app/auth/anonymous` — 匿名登录
- `POST /api/app/auth/phone/send-code` / `verify` — 手机登录
- `POST /api/app/auth/wechat/login` / `mini-login` / `auth-url` — 微信登录
- `POST /api/app/auth/email/register` / `login` / `code-login` — 邮箱登录
- `GET  /api/app/auth/profile` / `PUT` — 个人信息
- `POST /api/app/auth/upgrade` / `refresh` / `logout`
- `POST /api/auth/login` / `login/phone` / `register` — Admin 登录
- `GET  /api/auth/info` — Admin 信息

---

### 2. UserModule (`modules/user/`)

| 层           | 文件                                                                                                                | 说明                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Admin**    | `admin-user.controller.ts`                                                                                          | Admin 用户 CRUD (`/api/admin/users`)  |
|              | `admin-user.service.ts`                                                                                             | Admin 用户管理                        |
|              | `app-user-management.controller.ts`                                                                                 | App 用户管理 (`/api/admin/app-users`) |
|              | `app-user-management.service.ts`                                                                                    | App 用户封禁/统计                     |
| **App**      | `user-profile.controller.ts`                                                                                        | 用户档案 (`/api/app/user-profile`)    |
|              | `user-profile.service.ts`                                                                                           | 档案 CRUD/分步引导                    |
|              | `profile-inference.service.ts`                                                                                      | 档案推断 (从行为数据推断偏好)         |
|              | `profile-cache.service.ts`                                                                                          | 档案缓存                              |
|              | `profile-cron.service.ts`                                                                                           | 定时任务 (批量推断)                   |
|              | `collection-trigger.service.ts`                                                                                     | 数据收集触发器                        |
| **Entities** | `AppUser`, `AdminUser`, `UserProfile`, `UserInferredProfile`, `UserBehaviorProfile`, `ProfileSnapshot`              |
| **Exports**  | `UserProfileService`, `ProfileInferenceService`, `ProfileCacheService`, `CollectionTriggerService`, `TypeOrmModule` |

**API 路由:**

- `POST /api/app/user-profile/onboarding/step/:step` — 分步引导
- `GET  /api/app/user-profile/full` — 完整档案
- `PATCH /api/app/user-profile/declared` — 更新声明档案
- `GET  /api/app/user-profile/completion-suggestions` — 完善建议
- `POST /api/app/user-profile/infer/refresh` — 刷新推断
- `GET  /api/admin/users` / `POST` / `PUT` / `DELETE` — CRUD
- `GET  /api/admin/app-users` / `statistics` / `ban` / `unban`

---

### 3. FoodModule (`modules/food/`)

| 层           | 文件                                                                                                | 说明                                   |
| ------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Admin**    | `food-library-management.controller.ts`                                                             | 食物库管理 (`/api/admin/food-library`) |
|              | `food-library-management.service.ts`                                                                | 后台 CRUD + 批量导入                   |
| **App**      | `food-library.controller.ts`                                                                        | 食物搜索 (`/api/foods`)                |
|              | `food-library.service.ts`                                                                           | 搜索/热门/分类                         |
|              | `food-analyze.controller.ts`                                                                        | AI 食物分析 (`/api/app/food/analyze`)  |
|              | `analyze.service.ts`                                                                                | AI 图片识别 (OpenRouter ERNIE-4.5)     |
| **Entities** | `FoodLibrary`, `FoodTranslation`, `FoodSource`, `FoodChangeLog`, `FoodConflict`, `FoodRegionalInfo` |
| **Exports**  | `FoodLibraryService`, `AnalyzeService`, `TypeOrmModule`                                             |
| **依赖**     | `forwardRef(DietModule)`, `forwardRef(UserModule)`                                                  |

**API 路由:**

- `GET  /api/foods/search` / `popular` / `categories` / `:id`
- `POST /api/app/food/analyze` — AI 图片分析
- `GET  /api/admin/food-library` / `statistics` / `conflicts`
- `POST /api/admin/food-library` / `batch-import`

---

### 4. DietModule (`modules/diet/`)

| 层           | 文件                                                                                                                                                             | 说明                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| **Admin**    | `content-management.controller.ts`                                                                                                                               | 内容管理 (`/api/admin/content`)  |
|              | `content-management.service.ts`                                                                                                                                  | 食物记录/计划/对话查询           |
|              | `app-data-query.service.ts`                                                                                                                                      | App 数据查询辅助                 |
| **App**      | `food.controller.ts`                                                                                                                                             | 饮食主入口 (`/api/app/food`)     |
|              | `food.service.ts`                                                                                                                                                | 膳食建议 & 搜索                  |
|              | `food-record.controller.ts`                                                                                                                                      | 饮食记录 CRUD                    |
|              | `food-record.service.ts`                                                                                                                                         | 记录逻辑                         |
|              | `food-summary.controller.ts`                                                                                                                                     | 饮食汇总                         |
|              | `food-plan.controller.ts`                                                                                                                                        | 饮食计划                         |
|              | `daily-plan.service.ts`                                                                                                                                          | 每日计划生成/调整                |
|              | `daily-summary.service.ts`                                                                                                                                       | 每日汇总计算                     |
|              | `food-behavior.controller.ts`                                                                                                                                    | 行为建模                         |
|              | `behavior.service.ts`                                                                                                                                            | 行为分析 (暴食风险/触发器)       |
|              | `food-nutrition.controller.ts`                                                                                                                                   | 营养档案                         |
|              | `nutrition-score.service.ts`                                                                                                                                     | 营养评分                         |
|              | `recommendation-engine.service.ts`                                                                                                                               | ★ 核心推荐引擎                   |
|              | `recommendation/`                                                                                                                                                | 推荐子模块 (约束/过滤/评分/组装) |
| **Entities** | `FoodRecord`, `DailyPlan`, `DailySummary`, `AiDecisionLog`, `RecommendationFeedback`                                                                             |
| **Exports**  | `FoodService`, `FoodRecordService`, `DailySummaryService`, `BehaviorService`, `NutritionScoreService`, `RecommendationEngineService`, `ContentManagementService` |
| **依赖**     | `UserModule`, `forwardRef(FoodModule)`                                                                                                                           |

**API 路由:**

- `POST /api/app/food/records` — 记录饮食
- `GET  /api/app/food/records/today` / `history`
- `GET  /api/app/food/suggestion` — 实时膳食建议
- `GET  /api/app/food/plan/today` — 今日计划
- `POST /api/app/food/plan/generate` — 生成计划
- `GET  /api/app/food/summary/today` / `weekly`
- `GET  /api/app/food/behavior/profile` — 行为画像
- `POST /api/app/food/behavior/proactive-check` — 主动干预
- `GET  /api/app/food/nutrition/profile` — 营养档案
- `GET  /api/admin/content/food-records` / `daily-plans` / `conversations`

---

### 5. CoachModule (`modules/coach/`)

| 层           | 文件                                | 说明                           |
| ------------ | ----------------------------------- | ------------------------------ |
| **App**      | `coach.controller.ts`               | AI 教练 (`/api/app/coach`)     |
|              | `coach.service.ts`                  | 对话服务 (DeepSeek + 人格系统) |
| **Entities** | `CoachConversation`, `CoachMessage` |
| **Exports**  | `CoachService`                      |
| **依赖**     | `UserModule`, `DietModule`          |

**API 路由:**

- `POST /api/app/coach/chat` — 对话
- `GET  /api/app/coach/conversations` — 会话列表
- `GET  /api/app/coach/conversations/:id/messages` — 消息历史
- `POST /api/app/coach/conversations` — 新建会话
- `PUT  /api/app/coach/conversations/:id/persona` — 切换人格

---

### 6. GamificationModule (`modules/gamification/`)

| 层           | 文件                                                           | 说明                               |
| ------------ | -------------------------------------------------------------- | ---------------------------------- |
| **Admin**    | `gamification-management.controller.ts`                        | 成就/挑战管理                      |
| **App**      | `gamification.controller.ts`                                   | 用户成就 (`/api/app/gamification`) |
|              | `gamification.service.ts`                                      | 积分/成就/挑战逻辑                 |
| **Entities** | `Achievement`, `UserAchievement`, `Challenge`, `UserChallenge` |
| **Exports**  | `GamificationService`                                          |
| **依赖**     | `DietModule`                                                   |

**API 路由:**

- `GET  /api/app/gamification/achievements` — 成就列表
- `GET  /api/app/gamification/challenges` — 挑战列表
- `POST /api/app/gamification/challenges/:id/join` — 加入挑战
- `GET  /api/app/gamification/dashboard` — 仪表盘

---

### 7. RbacModule (`modules/rbac/`)

| 层           | 文件                                                                                                     | 说明                                         |
| ------------ | -------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Admin**    | `role.controller.ts`                                                                                     | 角色管理 (`/api/admin/roles`)                |
|              | `role.service.ts`                                                                                        | 角色 CRUD & 模板应用                         |
|              | `rbac-permission.controller.ts`                                                                          | 权限管理 (`/api/admin/permissions`)          |
|              | `rbac-permission.service.ts`                                                                             | 权限 CRUD & 检查                             |
|              | `permission-template.controller.ts`                                                                      | 模板管理 (`/api/admin/permission-templates`) |
|              | `permission-template.service.ts`                                                                         | 模板 CRUD & 预览                             |
|              | `rbac-permission.guard.ts`                                                                               | RBAC 权限守卫                                |
|              | `roles.guard.ts`                                                                                         | 角色守卫                                     |
|              | `roles.decorator.ts`                                                                                     | `@Roles()` 装饰器                            |
|              | `require-permission.decorator.ts`                                                                        | `@RequirePermission()` 装饰器                |
| **Entities** | `Role`, `Permission`, `PermissionTemplate`, `UserRole`, `RolePermission`                                 |
| **Exports**  | `RoleService`, `RbacPermissionService`, `PermissionTemplateService`, `RolesGuard`, `RbacPermissionGuard` |

**API 路由:**

- `GET  /api/admin/roles` / `POST` / `PUT` / `DELETE`
- `POST /api/admin/roles/:id/assign-permissions` / `apply-template`
- `GET  /api/admin/permissions` / `POST` / `PUT` / `DELETE`
- `GET  /api/admin/permission-templates` / `POST` / `PUT` / `DELETE`

---

### 8. ClientModule (`modules/client/`)

| 层           | 文件                                                  | 说明                                              |
| ------------ | ----------------------------------------------------- | ------------------------------------------------- |
| **Admin**    | `client.controller.ts`                                | 客户端管理 (`/api/admin/clients`)                 |
|              | `client.service.ts`                                   | 客户端 CRUD                                       |
|              | `permission.controller.ts`                            | 客户端权限 (`/api/admin/clients/:id/permissions`) |
|              | `permission.service.ts`                               | 能力权限管理                                      |
| **Entities** | `Client`, `ClientCapabilityPermission`                |
| **Exports**  | `ClientService`, `PermissionService`, `TypeOrmModule` |

**API 路由:**

- `GET  /api/admin/clients` / `POST` / `PUT` / `DELETE`
- `POST /api/admin/clients/:id/regenerate-secret`
- `GET  /api/admin/clients/:id/permissions` / `POST` / `PUT` / `DELETE`

---

### 9. ProviderModule (`modules/provider/`)

| 层           | 文件                                               | 说明                                   |
| ------------ | -------------------------------------------------- | -------------------------------------- |
| **Admin**    | `provider.controller.ts`                           | AI 提供商管理 (`/api/admin/providers`) |
|              | `provider.service.ts`                              | 提供商 CRUD & 健康检查                 |
|              | `model.controller.ts`                              | 模型配置 (`/api/admin/models`)         |
|              | `model.service.ts`                                 | 模型 CRUD & 测试                       |
| **Entities** | `Provider`, `ModelConfig`, `UsageRecord`           |
| **Exports**  | `ProviderService`, `ModelService`, `TypeOrmModule` |

**API 路由:**

- `GET  /api/admin/providers` / `POST` / `PUT` / `DELETE`
- `POST /api/admin/providers/test`
- `GET  /api/admin/providers/:id/health`
- `GET  /api/admin/models` / `POST` / `PUT` / `DELETE`

---

### 10. AppVersionModule (`modules/app-version/`)

| 层           | 文件                                                                | 说明                                 |
| ------------ | ------------------------------------------------------------------- | ------------------------------------ |
| **Admin**    | `app-version.controller.ts`                                         | 版本管理 (`/api/admin/app-versions`) |
|              | `app-version.service.ts`                                            | 版本 CRUD                            |
|              | `app-version-package.controller.ts`                                 | 安装包管理                           |
|              | `app-version-package.service.ts`                                    | 安装包 CRUD                          |
| **App**      | `update.controller.ts`                                              | 更新检查 (`/api/app/update`)         |
|              | `app-update.service.ts`                                             | 版本检查逻辑                         |
| **Entities** | `AppVersion`, `AppVersionPackage`                                   |
| **Exports**  | `AppUpdateService`, `AppVersionService`, `AppVersionPackageService` |

**API 路由:**

- `POST /api/app/update/check` — 检查更新
- `GET  /api/app/update/latest` / `history`
- `GET  /api/admin/app-versions` / `POST` / `PUT` / `DELETE`
- `POST /api/admin/app-versions/:id/publish` / `archive`

---

### 11. AnalyticsModule (`modules/analytics/`)

| 层           | 文件                           | 说明                              |
| ------------ | ------------------------------ | --------------------------------- |
| **Admin**    | `analytics.controller.ts`      | 数据分析 (`/api/admin/analytics`) |
|              | `analytics.service.ts`         | 使用量/成本/错误分析              |
| **Entities** | (引用) `UsageRecord`, `Client` |
| **Exports**  | `AnalyticsService`             |

**API 路由:**

- `GET /api/admin/analytics/overview` / `top-clients` / `capability-usage`
- `GET /api/admin/analytics/time-series` / `cost-analysis` / `error-analysis`
- `GET /api/admin/analytics/dashboard`

---

### 12. FileModule (`modules/file/`)

| 层        | 文件                            | 说明                                |
| --------- | ------------------------------- | ----------------------------------- |
| **Admin** | `file.controller.ts`            | Admin 文件上传 (`/api/admin/files`) |
| **App**   | `file.controller.ts`            | App 文件上传 (`/api/app/files`)     |
| **依赖**  | 注入 `StorageService` (@Global) |

**API 路由:**

- `POST /api/app/files/upload` / `presigned-url`
- `POST /api/admin/files/upload` / `presigned-url`
- `DELETE /api/admin/files/*key`

---

## 四、6 个基础设施模块

### CoreModule (`core/`)

```
core/
├── core.module.ts              # 聚合 Config + Database + Logger
├── config/
│   ├── config.module.ts        # @nestjs/config
│   └── configuration.ts       # 环境变量映射
├── database/
│   ├── database.module.ts      # TypeORM forRootAsync (autoLoadEntities)
│   ├── data-source.ts          # CLI 数据源
│   └── data-source-dev.ts      # 开发数据源
├── decorators/
│   ├── public.decorator.ts     # @Public()
│   └── ignore-response-interceptor.decorator.ts
├── filters/
│   └── all-exceptions.filter.ts  # 全局异常过滤
├── interceptors/
│   └── response.interceptor.ts   # 统一响应格式
├── middlewares/
│   └── logger.middleware.ts      # 请求日志
├── logger/
│   └── logger.module.ts          # Winston
└── swagger/
    └── swagger.config.ts         # Swagger 配置
```

### GatewayModule (`gateway/`)

- AI 模型网关路由: 文本生成/流式/图像生成
- 多适配器: OpenAI, DeepSeek, Qwen, OpenRouter
- Guards: ApiKey, CapabilityPermission, Quota, RateLimit

### LangChainModule (`langchain/`)

- LLM 服务: Chat, Streaming
- RAG 服务: 文档上传 + 查询

### FoodPipelineModule (`food-pipeline/`)

- 食物数据 ETL: USDA, OpenFoodFacts
- AI 标签/翻译/图片识别
- 数据清洗/去重/冲突解决/质量监控
- 定时同步调度 (`@nestjs/schedule`)

### CompressModule (`compress/`)

- 媒体压缩: 图片 (sharp)

### StorageModule (`storage/`) — `@Global()`

- S3 兼容存储: 上传/下载/预签名 URL

### HealthModule (`health/`)

- `GET /api/health` / `ready` / `live`

---

## 五、Entity 清单 (35 个)

| 模块             | Entity                       | 数据表                          |
| ---------------- | ---------------------------- | ------------------------------- |
| **user**         | `AppUser`                    | `app_users`                     |
|                  | `AdminUser`                  | `admin_users`                   |
|                  | `UserProfile`                | `user_profiles`                 |
|                  | `UserInferredProfile`        | `user_inferred_profiles`        |
|                  | `UserBehaviorProfile`        | `user_behavior_profiles`        |
|                  | `ProfileSnapshot`            | `profile_snapshots`             |
| **rbac**         | `Role`                       | `roles`                         |
|                  | `Permission`                 | `permissions`                   |
|                  | `PermissionTemplate`         | `permission_templates`          |
|                  | `UserRole`                   | `user_roles`                    |
|                  | `RolePermission`             | `role_permissions`              |
| **food**         | `FoodLibrary`                | `foods`                         |
|                  | `FoodTranslation`            | `food_translations`             |
|                  | `FoodSource`                 | `food_sources`                  |
|                  | `FoodChangeLog`              | `food_change_logs`              |
|                  | `FoodConflict`               | `food_conflicts`                |
|                  | `FoodRegionalInfo`           | `food_regional_info`            |
| **diet**         | `FoodRecord`                 | `food_records`                  |
|                  | `DailyPlan`                  | `daily_plans`                   |
|                  | `DailySummary`               | `daily_summaries`               |
|                  | `AiDecisionLog`              | `ai_decision_logs`              |
|                  | `RecommendationFeedback`     | `recommendation_feedbacks`      |
| **coach**        | `CoachConversation`          | `coach_conversations`           |
|                  | `CoachMessage`               | `coach_messages`                |
| **gamification** | `Achievement`                | `achievements`                  |
|                  | `UserAchievement`            | `user_achievements`             |
|                  | `Challenge`                  | `challenges`                    |
|                  | `UserChallenge`              | `user_challenges`               |
| **client**       | `Client`                     | `clients`                       |
|                  | `ClientCapabilityPermission` | `client_capability_permissions` |
| **provider**     | `Provider`                   | `providers`                     |
|                  | `ModelConfig`                | `model_configs`                 |
|                  | `UsageRecord`                | `usage_records`                 |
| **app-version**  | `AppVersion`                 | `app_versions`                  |
|                  | `AppVersionPackage`          | `app_version_packages`          |

---

## 六、模块依赖关系

```
                    ┌─────────────┐
                    │  CoreModule │
                    │(Config+DB+  │
                    │  Logger)    │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────────┐
              │            │                │
        ┌─────▼─────┐ ┌───▼────┐     ┌─────▼──────┐
        │StorageModule│ │JwtModule│     │TypeOrmModule│
        │ (@Global)  │ │        │     │(autoLoad)   │
        └────────────┘ └───┬────┘     └─────────────┘
                           │
                    ┌──────▼──────┐
                    │  AuthModule  │
                    │ (JWT/微信/SMS)│
                    └──────┬──────┘
                           │ exports: Guards, AuthService
              ┌────────────┼────────────────┐
              │            │                │
        ┌─────▼─────┐ ┌───▼────────┐ ┌─────▼──────┐
        │ UserModule │ │ RbacModule  │ │ClientModule│
        │(档案/推断)  │ │(角色/权限)  │ │(API客户端)  │
        └─────┬──────┘ └────────────┘ └────────────┘
              │
    ┌─────────┼──────────┐
    │         │          │
┌───▼──┐ ┌───▼────┐ ┌───▼────────────┐
│Food  │◄►│ Diet   │ │ GamificationMod│
│Module│  │ Module │ │ (成就/挑战)     │
└──────┘  └───┬────┘ └────────────────┘
              │
        ┌─────▼──────┐
        │ CoachModule │
        │ (AI教练)    │
        └─────────────┘

◄► = forwardRef 循环依赖
```

### 关键依赖:

| 消费方                                      | 提供方 | 关系                  |
| ------------------------------------------- | ------ | --------------------- |
| `FoodModule` ↔ `DietModule`                 | 双向   | `forwardRef` 循环依赖 |
| `DietModule` → `UserModule`                 | 单向   | 直接导入              |
| `FoodModule` → `UserModule`                 | 单向   | `forwardRef`          |
| `CoachModule` → `UserModule` + `DietModule` | 单向   | 直接导入              |
| `GamificationModule` → `DietModule`         | 单向   | 直接导入              |
| `LangChainModule` → `GatewayModule`         | 单向   | 直接导入              |

---

## 七、数据库

- **引擎**: PostgreSQL + TypeORM
- **配置**: `autoLoadEntities: true` (无需手动注册全局 entity 列表)
- **迁移**: `src/migrations/` (共 18 个, 1699–1754)
- **同步**: `synchronize: false` (通过迁移管理)
- **SSL**: 通过 `DB_SSL=true` 启用

---

## 八、Guards & Decorators 引用关系

所有模块统一引用路径:

```typescript
// Admin 控制器
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { CurrentUser } from '../../auth/admin/current-user.decorator';

// App 控制器
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
```

---

## 九、种子脚本 (`scripts/`)

| 脚本                   | 用途                               |
| ---------------------- | ---------------------------------- |
| `seed-admin.ts`        | 初始化 Admin 用户 + 超级管理员角色 |
| `seed-permissions.ts`  | 初始化权限 + 模板                  |
| `seed-data.ts`         | 初始化 Provider + ModelConfig      |
| `seed-test-client.ts`  | 初始化测试客户端                   |
| `seed-foods.ts`        | 导入食物库数据                     |
| `seed-app-versions.ts` | 初始化 App 版本                    |
| `init-system.ts`       | 系统完整初始化                     |

---

## 十、技术栈

| 类别       | 技术                                |
| ---------- | ----------------------------------- |
| **框架**   | NestJS 11, Fastify/Express          |
| **数据库** | PostgreSQL, TypeORM 0.3             |
| **认证**   | JWT, Passport (多策略)              |
| **AI/LLM** | LangChain 0.3, OpenRouter, DeepSeek |
| **存储**   | AWS S3 (@aws-sdk/client-s3)         |
| **图像**   | Sharp 0.34                          |
| **文档**   | Swagger (OpenAPI)                   |
| **限流**   | @nestjs/throttler                   |
| **定时**   | @nestjs/schedule                    |
| **缓存**   | Redis 5.11                          |
| **验证**   | class-validator + class-transformer |
| **日志**   | Winston                             |
| **部署**   | Railway / PM2                       |

---

## 十一、部署

```bash
# 本地构建
cd apps/api-server && pnpm run build

# 服务器部署
git pull && pnpm run build && pm2 restart wuwei-api

# 服务器信息
# Instance: openclaw (GCP asia-east2-a)
# IP: 34.92.33.180
# Port: 3006
```
