# API Server 模块化重构方案

> **版本**: v1.0 | **日期**: 2026-04-09  
> **定位**: 渐进式模块化拆分，保持所有 API path 不变，零功能回退  
> **前提**: 基于当前生产代码逆向分析，非推翻式重写

---

## 目录

- [一、现状架构分析](#一现状架构分析)
- [二、核心问题诊断](#二核心问题诊断)
- [三、目标模块划分](#三目标模块划分)
- [四、完整 API 路由清单](#四完整-api-路由清单)
- [五、模块依赖关系图](#五模块依赖关系图)
- [六、分阶段执行方案](#六分阶段执行方案)
- [七、文件迁移清单](#七文件迁移清单)
- [八、验证方案](#八验证方案)
- [九、回滚策略](#九回滚策略)
- [十、决策记录](#十决策记录)

---

## 一、现状架构分析

### 1.1 当前模块结构

```
AppModule (根)
├── CoreModule                    ✅ 合理 — Config + Database + Logger
│   ├── ConfigModule              (全局配置)
│   ├── DatabaseModule            (PostgreSQL + TypeORM, 35实体手动列表)
│   └── LoggerModule              (Winston日志)
├── StorageModule                 ✅ 合理 — @Global S3存储
├── GatewayModule                 ✅ 合理 — AI网关 (1 ctrl + 7 svc + 5 entity)
├── LangChainModule               ✅ 合理 — RAG向量检索 (1 ctrl + 2 svc)
├── FoodPipelineModule            ✅ 合理 — 食物数据管道 (1 ctrl + 12 svc)
├── HealthModule                  ✅ 合理 — 健康检查 (1 ctrl)
├── CompressModule                ✅ 合理 — 图片压缩 (1 ctrl + 1 svc)
├── AdminModule                   🔴 巨型模块 — 16 ctrl + 14 svc + 31 entity
└── AppClientModule               🔴 巨型模块 — 13 ctrl + 18 svc + 19 entity
```

### 1.2 代码规模统计

| 模块               | 控制器 | 服务   | 实体   | API端点   |
| ------------------ | ------ | ------ | ------ | --------- |
| AppClientModule    | 13     | 18     | 19     | ~60       |
| AdminModule        | 16     | 14     | 31     | ~120      |
| GatewayModule      | 1      | 7      | 5      | 2         |
| FoodPipelineModule | 1      | 12     | 6      | 11        |
| LangChainModule    | 1      | 2      | 0      | 4         |
| HealthModule       | 1      | 0      | 1      | 3         |
| CompressModule     | 1      | 1      | 0      | 2         |
| **Total**          | **36** | **54** | **35** | **~190+** |

### 1.3 目录结构现状

```
src/
├── main.ts                           启动入口
├── app.module.ts                     根模块（imports 9 个模块）
├── app.controller.ts                 根路由 GET /
├── app.service.ts
│
├── app/                              🔴 AppClientModule
│   ├── app-client.module.ts          13ctrl + 18svc + 19entity 注册
│   ├── app.controller.ts             App端认证 (AppAuthController)
│   ├── controllers/                  12个控制器文件平铺
│   ├── services/                     18个服务文件平铺
│   ├── dto/                          5个DTO文件
│   ├── guards/                       AppJwtAuthGuard
│   ├── strategies/                   AppJwtStrategy
│   └── decorators/                   CurrentAppUser
│
├── admin/                            🔴 AdminModule
│   ├── admin.module.ts               16ctrl + 14svc + 31entity 注册
│   ├── admin.controller.ts           Admin认证 (AdminController)
│   ├── admin.service.ts              Admin认证服务
│   ├── controllers/                  15个控制器文件平铺
│   ├── services/                     14个服务文件平铺
│   ├── dto/                          12个DTO文件
│   ├── guards/                       JwtAuthGuard, RolesGuard, RbacPermissionGuard
│   ├── strategies/                   JwtStrategy
│   └── decorators/                   CurrentUser, Roles, RequirePermission
│
├── core/                             ✅ 基础设施层
│   ├── config/                       配置管理
│   ├── database/                     数据库连接 (手动注册35实体)
│   ├── logger/                       Winston日志
│   ├── filters/                      AllExceptionsFilter
│   ├── interceptors/                 ResponseInterceptor
│   ├── middlewares/                  LoggerMiddleware
│   ├── decorators/                   @Public, @IgnoreResponseInterceptor
│   └── swagger/                      Swagger配置
│
├── entities/                         35个实体文件平铺 + index.ts (部分导出)
├── gateway/                          ✅ AI网关
├── langchain/                        ✅ RAG服务
├── food-pipeline/                    ✅ 食物数据管道
├── health/                           ✅ 健康检查
├── compress/                         ✅ 图片压缩
├── storage/                          ✅ 文件存储
├── common/                           通用类型定义
├── scripts/                          数据初始化脚本
└── migrations/                       数据库迁移 (35+文件)
```

---

## 二、核心问题诊断

### 2.1 技术债清单

| #   | 问题                      | 严重度  | 代码证据                                                                                                                                                       | 影响                                      |
| --- | ------------------------- | :-----: | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 1   | **God Module**            | 🔴 致命 | `AppClientModule`：19实体 + 13控制器 + 18服务注册在一个 module 中；`AdminModule`：31实体 + 16控制器 + 14服务                                                   | 无法独立测试、替换或横向扩展任何业务模块  |
| 2   | **实体三重注册**          | 🟠 严重 | 同一实体（如 `FoodLibrary`）在 `DatabaseModule.entities[]` + `AdminModule.forFeature()` + `AppClientModule.forFeature()` 中重复注册                            | Repository 作用域混乱，TypeORM 警告       |
| 3   | **扁平目录**              | 🟠 严重 | `app/controllers/` 12个、`app/services/` 18个、`admin/controllers/` 15个文件无分组平铺                                                                         | 开发者认知负担大，PR review 困难          |
| 4   | **跨域服务耦合**          | 🟡 中等 | `FoodService` 依赖 `FoodRecordService` + `DailySummaryService` + `NutritionScoreService` + `UserProfileService` + `RecommendationEngineService`（5个跨域依赖） | 修改一个领域可能连锁影响多个领域          |
| 5   | **JWT 硬编码**            | 🟡 中等 | `JwtModule.register({ secret: process.env.JWT_SECRET \|\| 'your-secret-key-change-in-production' })` 出现在 2 处                                               | 安全隐患 + 配置不走 ConfigModule 统一管理 |
| 6   | **全局 Guard Proxy 失效** | 🟡 中等 | `app.module.ts` 的 `APP_GUARD` 使用 `Proxy` 实现但始终 `return true`，注释写"暂时返回 true，稍后完善"                                                          | 全局鉴权形同虚设                          |
| 7   | **无 barrel 导出**        | 🟢 轻微 | `entities/index.ts` 仅导出 3 个实体（Client 相关），其余 32 个需 `../../entities/xxx.entity` 长路径导入                                                        | 代码冗长，重构时批量修改路径麻烦          |

### 2.2 架构不一致分析（对比设计文档）

| 设计文档要求                          | 当前实现                                                           | Gap                                     |
| ------------------------------------- | ------------------------------------------------------------------ | --------------------------------------- |
| 五层架构（数据→特征→评分→推荐→学习）  | 扁平服务无分层                                                     | 评分/推荐/学习逻辑散落在多个 service 中 |
| 10维非线性营养评分系统                | `NutritionScoreService` 单文件实现                                 | 需后续按文档重构评分算法                |
| 三阶段推荐 Pipeline（召回→精排→重排） | `RecommendationEngineService` 内部已有子服务拆分                   | 结构可复用，需模块化封装                |
| 用户画像系统（声明+推断+行为三层）    | 已有 `UserProfile` + `UserInferredProfile` + `UserBehaviorProfile` | 实体已对齐，服务需解耦                  |
| 动态权重系统                          | 未实现                                                             | 后续迭代                                |
| 反馈闭环学习层                        | `RecommendationFeedback` 实体已有                                  | 已具备基础能力，需加强                  |

---

## 三、目标模块划分

### 3.1 12 个业务模块

将 `AppClientModule` 和 `AdminModule` 拆分为按**业务领域**组织的 12 个独立模块，每个模块同时包含 App 端和 Admin 端（如有）：

```
src/
├── main.ts
├── app.module.ts
├── app.controller.ts / app.service.ts
│
├── core/                              ← 保持不变（启用 autoLoadEntities）
│
├── modules/                           ← 新：业务模块根目录
│   ├── auth/                          认证模块（App + Admin JWT）
│   ├── user/                          用户管理模块
│   ├── food/                          食物库核心模块
│   ├── diet/                          饮食领域模块（记录/计划/汇总/评分/行为/推荐）
│   ├── coach/                         AI教练模块
│   ├── gamification/                  成就挑战模块
│   ├── rbac/                          角色权限模块（Admin专属）
│   ├── client/                        客户端管理模块（Admin专属）
│   ├── provider/                      AI提供商管理模块（Admin专属）
│   ├── app-version/                   版本管理模块
│   ├── analytics/                     数据分析模块（Admin专属）
│   └── file/                          文件管理模块
│
├── gateway/                           ← 保持不变（更新 imports）
├── langchain/                         ← 保持不变
├── food-pipeline/                     ← 保持不变（更新 imports）
├── health/                            ← 保持不变
├── compress/                          ← 保持不变
├── storage/                           ← 保持不变
├── common/                            ← 保持不变
├── scripts/                           ← 保持不变
└── migrations/                        ← 保持不变
```

### 3.2 各模块职责

| 模块                   | 职责                                               | 实体                                                                                       |   App端   |  Admin端  |
| ---------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------ | :-------: | :-------: |
| **AuthModule**         | App/Admin 认证、JWT 策略、登录注册                 | AppUser, AdminUser                                                                         | ✅ 13路由 | ✅ 8路由  |
| **UserModule**         | 用户画像、推断、行为、快照、Admin用户管理          | AppUser, AdminUser, UserProfile, UserInferredProfile, UserBehaviorProfile, ProfileSnapshot | ✅ 8路由  | ✅ 15路由 |
| **FoodModule**         | 食物库 CRUD、搜索、翻译、来源、食物分析            | FoodLibrary, FoodTranslation, FoodSource, FoodChangeLog, FoodConflict, FoodRegionalInfo    | ✅ 7路由  | ✅ 19路由 |
| **DietModule**         | 饮食记录、计划、汇总、营养评分、行为建模、推荐引擎 | FoodRecord, DailySummary, DailyPlan, AiDecisionLog, RecommendationFeedback                 | ✅ 18路由 | ✅ 14路由 |
| **CoachModule**        | AI教练对话、消息历史                               | CoachConversation, CoachMessage                                                            | ✅ 6路由  |     —     |
| **GamificationModule** | 成就、挑战、连胜状态                               | Achievement, UserAchievement, Challenge, UserChallenge                                     | ✅ 4路由  | ✅ 9路由  |
| **RbacModule**         | 角色、权限、权限模板                               | Role, Permission, PermissionTemplate, UserRole, RolePermission                             |     —     | ✅ 23路由 |
| **ClientModule**       | 客户端管理、权限分配                               | Client, ClientCapabilityPermission                                                         |     —     | ✅ 12路由 |
| **ProviderModule**     | AI提供商、模型配置、使用记录                       | Provider, ModelConfig, UsageRecord                                                         |     —     | ✅ 16路由 |
| **AppVersionModule**   | 版本管理、渠道包、更新检查                         | AppVersion, AppVersionPackage                                                              | ✅ 3路由  | ✅ 14路由 |
| **AnalyticsModule**    | 数据分析仪表盘                                     | (查询其他实体)                                                                             |     —     | ✅ 7路由  |
| **FileModule**         | 文件上传/删除/预签名                               | —                                                                                          | ✅ 2路由  | ✅ 3路由  |

### 3.3 每个模块内部结构

```
modules/<name>/
├── <name>.module.ts                   模块定义
├── entities/                          本领域实体
│   └── *.entity.ts
├── app/                               App端（如有）
│   ├── *.controller.ts
│   ├── *.service.ts
│   └── dto/
│       └── *.dto.ts
└── admin/                             Admin端（如有）
    ├── *.controller.ts
    ├── *.service.ts
    └── dto/
        └── *.dto.ts
```

---

## 四、完整 API 路由清单

### 4.1 App 端路由（~60 路由）

#### AuthModule — App 认证

| HTTP | 完整路由                             | 描述             | Guard   |
| ---- | ------------------------------------ | ---------------- | ------- |
| POST | `/api/app/auth/anonymous`            | 匿名登录         | @Public |
| POST | `/api/app/auth/phone/send-code`      | 发送短信验证码   | @Public |
| POST | `/api/app/auth/phone/verify`         | 手机号验证码登录 | @Public |
| POST | `/api/app/auth/wechat/auth-url`      | 获取微信授权URL  | @Public |
| POST | `/api/app/auth/wechat/login`         | 微信授权码登录   | @Public |
| POST | `/api/app/auth/wechat/mini-login`    | 微信小程序登录   | @Public |
| GET  | `/api/app/auth/wechat/callback`      | 微信回调         | @Public |
| GET  | `/api/app/auth/wechat/verify`        | 微信签名验证     | @Public |
| POST | `/api/app/auth/email/register`       | 邮箱注册         | @Public |
| POST | `/api/app/auth/email/login`          | 邮箱密码登录     | @Public |
| POST | `/api/app/auth/email/code-login`     | 邮箱验证码登录   | @Public |
| POST | `/api/app/auth/email/send-code`      | 发送邮箱验证码   | @Public |
| POST | `/api/app/auth/email/reset-password` | 重置密码         | @Public |

#### CoachModule — AI教练

| HTTP   | 完整路由                                    | 描述                  | Guard      |
| ------ | ------------------------------------------- | --------------------- | ---------- |
| POST   | `/api/app/coach/chat`                       | AI教练聊天（SSE流式） | AppJwtAuth |
| GET    | `/api/app/coach/conversations`              | 获取对话列表          | AppJwtAuth |
| GET    | `/api/app/coach/conversations/:id/messages` | 获取对话消息          | AppJwtAuth |
| DELETE | `/api/app/coach/conversations/:id`          | 删除对话              | AppJwtAuth |
| GET    | `/api/app/coach/daily-greeting`             | 每日教练问候          | AppJwtAuth |
| PUT    | `/api/app/coach/style`                      | 切换教练风格          | AppJwtAuth |

#### FileModule — 文件上传

| HTTP | 完整路由                       | 描述            | Guard      |
| ---- | ------------------------------ | --------------- | ---------- |
| POST | `/api/app/files/upload`        | 上传文件 (20MB) | AppJwtAuth |
| POST | `/api/app/files/presigned-url` | 获取预签名URL   | AppJwtAuth |

#### FoodModule — 食物库（公开）

| HTTP | 完整路由                   | 描述                 | Guard   |
| ---- | -------------------------- | -------------------- | ------- |
| GET  | `/api/foods/search`        | 搜索食物             | @Public |
| GET  | `/api/foods/popular`       | 获取热门食物         | @Public |
| GET  | `/api/foods/categories`    | 获取分类列表         | @Public |
| GET  | `/api/foods`               | 获取所有食物（分页） | @Public |
| GET  | `/api/foods/by-name/:name` | 按名称获取食物       | @Public |
| GET  | `/api/foods/:id`           | 按ID获取食物         | @Public |

#### FoodModule — 食物分析

| HTTP | 完整路由                | 描述           | Guard      |
| ---- | ----------------------- | -------------- | ---------- |
| POST | `/api/app/food/analyze` | 食物图片AI分析 | AppJwtAuth |

#### DietModule — 行为建模

| HTTP | 完整路由                          | 描述         | Guard      |
| ---- | --------------------------------- | ------------ | ---------- |
| GET  | `/api/app/food/behavior-profile`  | 获取行为画像 | AppJwtAuth |
| GET  | `/api/app/food/proactive-check`   | 主动提醒检查 | AppJwtAuth |
| POST | `/api/app/food/decision-feedback` | AI决策反馈   | AppJwtAuth |

#### DietModule — 营养与档案

| HTTP | 完整路由                        | 描述             | Guard      |
| ---- | ------------------------------- | ---------------- | ---------- |
| GET  | `/api/app/food/nutrition-score` | 获取今日营养评分 | AppJwtAuth |
| GET  | `/api/app/food/profile`         | 获取用户健康档案 | AppJwtAuth |
| PUT  | `/api/app/food/profile`         | 更新用户健康档案 | AppJwtAuth |

#### DietModule — 饮食计划

| HTTP | 完整路由                              | 描述           | Guard      |
| ---- | ------------------------------------- | -------------- | ---------- |
| GET  | `/api/app/food/meal-suggestion`       | 获取下一餐推荐 | AppJwtAuth |
| GET  | `/api/app/food/daily-plan`            | 获取今日计划   | AppJwtAuth |
| POST | `/api/app/food/daily-plan/adjust`     | 调整饮食计划   | AppJwtAuth |
| POST | `/api/app/food/daily-plan/regenerate` | 重新生成计划   | AppJwtAuth |

#### DietModule — 饮食记录

| HTTP   | 完整路由                             | 描述             | Guard      |
| ------ | ------------------------------------ | ---------------- | ---------- |
| POST   | `/api/app/food/records`              | 保存饮食记录     | AppJwtAuth |
| POST   | `/api/app/food/records/from-library` | 从食物库添加记录 | AppJwtAuth |
| GET    | `/api/app/food/frequent-foods`       | 常吃食物排行     | AppJwtAuth |
| GET    | `/api/app/food/records/today`        | 今日饮食记录     | AppJwtAuth |
| GET    | `/api/app/food/records`              | 历史记录（分页） | AppJwtAuth |
| PUT    | `/api/app/food/records/:id`          | 修改饮食记录     | AppJwtAuth |
| DELETE | `/api/app/food/records/:id`          | 删除饮食记录     | AppJwtAuth |

#### DietModule — 饮食汇总

| HTTP | 完整路由                       | 描述         | Guard      |
| ---- | ------------------------------ | ------------ | ---------- |
| GET  | `/api/app/food/summary/today`  | 今日饮食汇总 | AppJwtAuth |
| GET  | `/api/app/food/summary/recent` | 最近N天汇总  | AppJwtAuth |

#### GamificationModule — 成就挑战

| HTTP | 完整路由                       | 描述         | Guard      |
| ---- | ------------------------------ | ------------ | ---------- |
| GET  | `/api/app/achievements`        | 获取成就列表 | AppJwtAuth |
| GET  | `/api/app/challenges`          | 获取挑战列表 | AppJwtAuth |
| POST | `/api/app/challenges/:id/join` | 参加挑战     | AppJwtAuth |
| GET  | `/api/app/streak`              | 获取连胜状态 | AppJwtAuth |

#### AppVersionModule — 版本更新

| HTTP | 完整路由                  | 描述         | Guard   |
| ---- | ------------------------- | ------------ | ------- |
| POST | `/api/app/update/check`   | 检查更新     | @Public |
| GET  | `/api/app/update/latest`  | 最新版本信息 | @Public |
| GET  | `/api/app/update/history` | 版本更新历史 | @Public |

#### UserModule — 用户画像

| HTTP  | 完整路由                                       | 描述           | Guard      |
| ----- | ---------------------------------------------- | -------------- | ---------- |
| POST  | `/api/app/user-profile/onboarding/step/:step`  | 分步引导 (1-4) | AppJwtAuth |
| POST  | `/api/app/user-profile/onboarding/skip/:step`  | 跳过引导 (3-4) | AppJwtAuth |
| GET   | `/api/app/user-profile/full`                   | 获取完整画像   | AppJwtAuth |
| PATCH | `/api/app/user-profile/declared`               | 更新声明数据   | AppJwtAuth |
| GET   | `/api/app/user-profile/completion-suggestions` | 档案补全建议   | AppJwtAuth |
| POST  | `/api/app/user-profile/infer/refresh`          | 触发推断更新   | AppJwtAuth |
| GET   | `/api/app/user-profile/goal-transition`        | 目标迁移建议   | AppJwtAuth |
| GET   | `/api/app/user-profile/collection-triggers`    | 字段收集提醒   | AppJwtAuth |

---

### 4.2 Admin 端路由（~120 路由）

#### AuthModule — Admin 认证

| HTTP | 完整路由                   | 描述             | Guard   |
| ---- | -------------------------- | ---------------- | ------- |
| POST | `/api/auth/login`          | 用户名密码登录   | @Public |
| POST | `/api/auth/login/phone`    | 手机验证码登录   | @Public |
| POST | `/api/auth/login_by_token` | Token登录        | @Public |
| POST | `/api/auth/register`       | 用户注册         | @Public |
| POST | `/api/auth/send_code`      | 发送验证码       | @Public |
| GET  | `/api/auth/info`           | 获取当前用户信息 | JwtAuth |
| PUT  | `/api/auth/profile`        | 更新用户资料     | JwtAuth |
| POST | `/api/auth/logout`         | 退出登录         | JwtAuth |

#### UserModule — Admin 用户管理

| HTTP   | 完整路由                              | 描述             | Guard                  |
| ------ | ------------------------------------- | ---------------- | ---------------------- |
| GET    | `/api/admin/users`                    | 获取管理用户列表 | JwtAuth + Roles(admin) |
| GET    | `/api/admin/users/:id`                | 获取用户详情     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/users`                    | 创建管理用户     | JwtAuth + Roles(admin) |
| PUT    | `/api/admin/users/:id`                | 更新管理用户     | JwtAuth + Roles(admin) |
| DELETE | `/api/admin/users/:id`                | 删除管理用户     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/users/:id/reset-password` | 重置密码         | JwtAuth + Roles(admin) |
| GET    | `/api/admin/users/:id/roles`          | 获取用户角色     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/users/:id/roles`          | 分配用户角色     | JwtAuth + Roles(admin) |

#### UserModule — App 用户管理

| HTTP   | 完整路由                          | 描述            | Guard                              |
| ------ | --------------------------------- | --------------- | ---------------------------------- |
| GET    | `/api/admin/app-users`            | 获取App用户列表 | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/app-users/statistics` | 获取用户统计    | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/app-users/:id`        | 获取App用户详情 | JwtAuth + Roles(admin,super_admin) |
| PUT    | `/api/admin/app-users/:id`        | 更新App用户     | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/app-users/:id/ban`    | 封禁App用户     | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/app-users/:id/unban`  | 解封App用户     | JwtAuth + Roles(admin,super_admin) |
| DELETE | `/api/admin/app-users/:id`        | 删除App用户     | JwtAuth + Roles(admin,super_admin) |

#### AnalyticsModule — 数据分析

| HTTP | 完整路由                                | 描述         | Guard                  |
| ---- | --------------------------------------- | ------------ | ---------------------- |
| GET  | `/api/admin/analytics/overview`         | 总览数据     | JwtAuth + Roles(admin) |
| GET  | `/api/admin/analytics/top-clients`      | 客户端排行   | JwtAuth + Roles(admin) |
| GET  | `/api/admin/analytics/capability-usage` | 能力使用统计 | JwtAuth + Roles(admin) |
| GET  | `/api/admin/analytics/time-series`      | 时间序列数据 | JwtAuth + Roles(admin) |
| GET  | `/api/admin/analytics/cost-analysis`    | 成本分析     | JwtAuth + Roles(admin) |
| GET  | `/api/admin/analytics/error-analysis`   | 错误分析     | JwtAuth + Roles(admin) |
| GET  | `/api/admin/analytics/dashboard`        | 仪表盘聚合   | JwtAuth + Roles(admin) |

#### AppVersionModule — 版本管理

| HTTP   | 完整路由                              | 描述         | Guard                  |
| ------ | ------------------------------------- | ------------ | ---------------------- |
| GET    | `/api/admin/app-versions`             | 获取版本列表 | JwtAuth + Roles(admin) |
| GET    | `/api/admin/app-versions/stats`       | 版本统计     | JwtAuth + Roles(admin) |
| GET    | `/api/admin/app-versions/:id`         | 版本详情     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/app-versions`             | 创建版本     | JwtAuth + Roles(admin) |
| PUT    | `/api/admin/app-versions/:id`         | 更新版本     | JwtAuth + Roles(admin) |
| DELETE | `/api/admin/app-versions/:id`         | 删除版本     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/app-versions/:id/publish` | 发布版本     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/app-versions/:id/archive` | 归档版本     | JwtAuth + Roles(admin) |

#### AppVersionModule — 渠道包管理

| HTTP   | 完整路由                                                     | 描述           | Guard                  |
| ------ | ------------------------------------------------------------ | -------------- | ---------------------- |
| GET    | `/api/admin/app-versions/:versionId/packages`                | 获取渠道包列表 | JwtAuth + Roles(admin) |
| GET    | `/api/admin/app-versions/:versionId/packages/store-defaults` | 商店默认URL    | JwtAuth + Roles(admin) |
| POST   | `/api/admin/app-versions/:versionId/packages`                | 新增渠道包     | JwtAuth + Roles(admin) |
| PUT    | `/api/admin/app-versions/:versionId/packages/:id`            | 更新渠道包     | JwtAuth + Roles(admin) |
| PATCH  | `/api/admin/app-versions/:versionId/packages/:id/toggle`     | 切换启用状态   | JwtAuth + Roles(admin) |
| DELETE | `/api/admin/app-versions/:versionId/packages/:id`            | 删除渠道包     | JwtAuth + Roles(admin) |

#### ClientModule — 客户端管理

| HTTP   | 完整路由                                   | 描述           | Guard                  |
| ------ | ------------------------------------------ | -------------- | ---------------------- |
| GET    | `/api/admin/clients`                       | 获取客户端列表 | JwtAuth + Roles(admin) |
| GET    | `/api/admin/clients/:id`                   | 客户端详情     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/clients`                       | 创建客户端     | JwtAuth + Roles(admin) |
| PUT    | `/api/admin/clients/:id`                   | 更新客户端     | JwtAuth + Roles(admin) |
| DELETE | `/api/admin/clients/:id`                   | 删除客户端     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/clients/:id/regenerate-secret` | 重新生成Secret | JwtAuth + Roles(admin) |
| GET    | `/api/admin/clients/:id/usage`             | 使用统计       | JwtAuth + Roles(admin) |

#### ClientModule — 客户端权限

| HTTP   | 完整路由                                                 | 描述         | Guard                  |
| ------ | -------------------------------------------------------- | ------------ | ---------------------- |
| GET    | `/api/admin/clients/:clientId/permissions`               | 获取权限列表 | JwtAuth + Roles(admin) |
| POST   | `/api/admin/clients/:clientId/permissions`               | 添加权限     | JwtAuth + Roles(admin) |
| PUT    | `/api/admin/clients/:clientId/permissions/:permissionId` | 更新权限     | JwtAuth + Roles(admin) |
| DELETE | `/api/admin/clients/:clientId/permissions/:permissionId` | 删除权限     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/clients/:clientId/permissions/batch`         | 批量更新权限 | JwtAuth + Roles(admin) |

#### DietModule — 内容与日志管理

| HTTP   | 完整路由                                                | 描述           | Guard                              |
| ------ | ------------------------------------------------------- | -------------- | ---------------------------------- |
| GET    | `/api/admin/content/food-records`                       | 饮食记录列表   | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/content/food-records/statistics`            | 饮食记录统计   | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/content/food-records/:id`                   | 饮食记录详情   | JwtAuth + Roles(admin,super_admin) |
| DELETE | `/api/admin/content/food-records/:id`                   | 删除饮食记录   | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/content/daily-plans`                        | 每日计划列表   | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/content/daily-plans/:id`                    | 每日计划详情   | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/content/conversations`                      | AI对话列表     | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/content/conversations/statistics`           | AI对话统计     | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/content/conversations/:id`                  | AI对话详情     | JwtAuth + Roles(admin,super_admin) |
| DELETE | `/api/admin/content/conversations/:id`                  | 删除AI对话     | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/content/recommendation-feedback`            | 推荐反馈列表   | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/content/recommendation-feedback/statistics` | 推荐反馈统计   | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/content/ai-decision-logs`                   | AI决策日志列表 | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/content/ai-decision-logs/statistics`        | AI决策日志统计 | JwtAuth + Roles(admin,super_admin) |

#### FileModule — Admin 文件管理

| HTTP   | 完整路由                         | 描述             | Guard                  |
| ------ | -------------------------------- | ---------------- | ---------------------- |
| POST   | `/api/admin/files/upload`        | 上传文件 (500MB) | JwtAuth + Roles(admin) |
| POST   | `/api/admin/files/presigned-url` | 获取预签名URL    | JwtAuth + Roles(admin) |
| DELETE | `/api/admin/files/*key`          | 删除文件         | JwtAuth + Roles(admin) |

#### FoodModule — Admin 食物库管理

| HTTP   | 完整路由                                                | 描述         | Guard                              |
| ------ | ------------------------------------------------------- | ------------ | ---------------------------------- |
| GET    | `/api/admin/food-library`                               | 食物库列表   | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/food-library/statistics`                    | 食物库统计   | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/food-library/categories`                    | 食物分类列表 | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/food-library/conflicts`                     | 冲突列表     | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/food-library/:id`                           | 食物详情     | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/food-library`                               | 创建食物     | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/food-library/batch-import`                  | 批量导入     | JwtAuth + Roles(admin,super_admin) |
| PUT    | `/api/admin/food-library/:id`                           | 更新食物     | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/food-library/:id/toggle-verified`           | 切换验证状态 | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/food-library/:id/status`                    | 更新食物状态 | JwtAuth + Roles(admin,super_admin) |
| DELETE | `/api/admin/food-library/:id`                           | 删除食物     | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/food-library/:id/translations`              | 翻译列表     | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/food-library/:id/translations`              | 添加翻译     | JwtAuth + Roles(admin,super_admin) |
| PUT    | `/api/admin/food-library/translations/:translationId`   | 更新翻译     | JwtAuth + Roles(admin,super_admin) |
| DELETE | `/api/admin/food-library/translations/:translationId`   | 删除翻译     | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/food-library/:id/sources`                   | 数据来源列表 | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/food-library/:id/sources`                   | 添加数据来源 | JwtAuth + Roles(admin,super_admin) |
| DELETE | `/api/admin/food-library/sources/:sourceId`             | 删除数据来源 | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/food-library/:id/change-logs`               | 变更日志     | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/food-library/conflicts/:conflictId/resolve` | 解决冲突     | JwtAuth + Roles(admin,super_admin) |

#### GamificationModule — Admin 成就/挑战管理

| HTTP   | 完整路由                                               | 描述         | Guard                              |
| ------ | ------------------------------------------------------ | ------------ | ---------------------------------- |
| GET    | `/api/admin/gamification/achievements`                 | 成就列表     | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/gamification/achievements`                 | 创建成就     | JwtAuth + Roles(admin,super_admin) |
| PUT    | `/api/admin/gamification/achievements/:id`             | 更新成就     | JwtAuth + Roles(admin,super_admin) |
| DELETE | `/api/admin/gamification/achievements/:id`             | 删除成就     | JwtAuth + Roles(admin,super_admin) |
| GET    | `/api/admin/gamification/challenges`                   | 挑战列表     | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/gamification/challenges`                   | 创建挑战     | JwtAuth + Roles(admin,super_admin) |
| PUT    | `/api/admin/gamification/challenges/:id`               | 更新挑战     | JwtAuth + Roles(admin,super_admin) |
| POST   | `/api/admin/gamification/challenges/:id/toggle-active` | 切换挑战启用 | JwtAuth + Roles(admin,super_admin) |
| DELETE | `/api/admin/gamification/challenges/:id`               | 删除挑战     | JwtAuth + Roles(admin,super_admin) |

#### ProviderModule — AI 提供商管理

| HTTP   | 完整路由                                | 描述           | Guard                  |
| ------ | --------------------------------------- | -------------- | ---------------------- |
| GET    | `/api/admin/providers`                  | 提供商列表     | JwtAuth + Roles(admin) |
| GET    | `/api/admin/providers/:id`              | 提供商详情     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/providers`                  | 创建提供商     | JwtAuth + Roles(admin) |
| PUT    | `/api/admin/providers/:id`              | 更新提供商     | JwtAuth + Roles(admin) |
| DELETE | `/api/admin/providers/:id`              | 删除提供商     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/providers/test`             | 测试提供商连接 | JwtAuth + Roles(admin) |
| GET    | `/api/admin/providers/:id/health`       | 提供商健康状态 | JwtAuth + Roles(admin) |
| POST   | `/api/admin/providers/health/check-all` | 批量健康检查   | JwtAuth + Roles(admin) |

#### ProviderModule — AI 模型管理

| HTTP   | 完整路由                                       | 描述             | Guard                  |
| ------ | ---------------------------------------------- | ---------------- | ---------------------- |
| GET    | `/api/admin/models`                            | 模型列表         | JwtAuth + Roles(admin) |
| GET    | `/api/admin/models/:id`                        | 模型详情         | JwtAuth + Roles(admin) |
| POST   | `/api/admin/models`                            | 创建模型         | JwtAuth + Roles(admin) |
| PUT    | `/api/admin/models/:id`                        | 更新模型         | JwtAuth + Roles(admin) |
| DELETE | `/api/admin/models/:id`                        | 删除模型         | JwtAuth + Roles(admin) |
| POST   | `/api/admin/models/test`                       | 测试模型         | JwtAuth + Roles(admin) |
| GET    | `/api/admin/models/provider/:providerId`       | 按提供商获取模型 | JwtAuth + Roles(admin) |
| GET    | `/api/admin/models/capability/:capabilityType` | 按能力类型获取   | JwtAuth + Roles(admin) |

#### RbacModule — RBAC 权限管理

| HTTP   | 完整路由                                       | 描述         | Guard                  |
| ------ | ---------------------------------------------- | ------------ | ---------------------- |
| GET    | `/api/admin/rbac-permissions`                  | 权限列表     | JwtAuth + Roles(admin) |
| GET    | `/api/admin/rbac-permissions/tree`             | 权限树       | JwtAuth + Roles(admin) |
| GET    | `/api/admin/rbac-permissions/modules`          | 所有模块     | JwtAuth + Roles(admin) |
| GET    | `/api/admin/rbac-permissions/user/permissions` | 当前用户权限 | JwtAuth + Roles(admin) |
| GET    | `/api/admin/rbac-permissions/:id`              | 权限详情     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/rbac-permissions`                  | 创建权限     | JwtAuth + Roles(admin) |
| PUT    | `/api/admin/rbac-permissions/:id`              | 更新权限     | JwtAuth + Roles(admin) |
| DELETE | `/api/admin/rbac-permissions/:id`              | 删除权限     | JwtAuth + Roles(admin) |

#### RbacModule — 角色管理

| HTTP   | 完整路由                              | 描述         | Guard                  |
| ------ | ------------------------------------- | ------------ | ---------------------- |
| GET    | `/api/admin/roles`                    | 角色列表     | JwtAuth + Roles(admin) |
| GET    | `/api/admin/roles/tree`               | 角色树       | JwtAuth + Roles(admin) |
| GET    | `/api/admin/roles/:id`                | 角色详情     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/roles`                    | 创建角色     | JwtAuth + Roles(admin) |
| PUT    | `/api/admin/roles/:id`                | 更新角色     | JwtAuth + Roles(admin) |
| DELETE | `/api/admin/roles/:id`                | 删除角色     | JwtAuth + Roles(admin) |
| GET    | `/api/admin/roles/:id/permissions`    | 角色权限     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/roles/:id/permissions`    | 分配权限     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/roles/:id/apply-template` | 应用权限模板 | JwtAuth + Roles(admin) |

#### RbacModule — 权限模板管理

| HTTP   | 完整路由                                  | 描述         | Guard                  |
| ------ | ----------------------------------------- | ------------ | ---------------------- |
| GET    | `/api/admin/permission-templates`         | 模板列表     | JwtAuth + Roles(admin) |
| GET    | `/api/admin/permission-templates/:id`     | 模板详情     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/permission-templates`         | 创建模板     | JwtAuth + Roles(admin) |
| PUT    | `/api/admin/permission-templates/:id`     | 更新模板     | JwtAuth + Roles(admin) |
| DELETE | `/api/admin/permission-templates/:id`     | 删除模板     | JwtAuth + Roles(admin) |
| POST   | `/api/admin/permission-templates/preview` | 预览展开权限 | JwtAuth + Roles(admin) |

---

### 4.3 系统服务路由（不在拆分范围内）

| 模块         | HTTP | 完整路由                                         | 描述         | Guard                       |
| ------------ | ---- | ------------------------------------------------ | ------------ | --------------------------- |
| Gateway      | POST | `/api/gateway/text/generation`                   | 文本生成     | ApiKey + 权限 + 限流 + 配额 |
| Gateway      | POST | `/api/gateway/text/generation/stream`            | 流式文本生成 | ApiKey + 权限 + 限流 + 配额 |
| FoodPipeline | POST | `/api/admin/food-pipeline/import/usda`           | USDA导入     | JwtAuth + Roles             |
| FoodPipeline | GET  | `/api/admin/food-pipeline/usda/search`           | USDA搜索     | JwtAuth + Roles             |
| FoodPipeline | GET  | `/api/admin/food-pipeline/barcode/:code`         | 条形码查询   | JwtAuth + Roles             |
| FoodPipeline | GET  | `/api/admin/food-pipeline/openfoodfacts/search`  | OFF搜索      | JwtAuth + Roles             |
| FoodPipeline | POST | `/api/admin/food-pipeline/ai/label`              | AI标注       | JwtAuth + Roles             |
| FoodPipeline | POST | `/api/admin/food-pipeline/ai/translate`          | AI翻译       | JwtAuth + Roles             |
| FoodPipeline | POST | `/api/admin/food-pipeline/rules/apply`           | 规则引擎     | JwtAuth + Roles             |
| FoodPipeline | POST | `/api/admin/food-pipeline/conflicts/resolve-all` | 自动解决冲突 | JwtAuth + Roles             |
| FoodPipeline | POST | `/api/admin/food-pipeline/recognize/image`       | 图片识别     | JwtAuth + Roles             |
| FoodPipeline | POST | `/api/admin/food-pipeline/recognize/url`         | URL识别      | JwtAuth + Roles             |
| FoodPipeline | GET  | `/api/admin/food-pipeline/quality/report`        | 质量报告     | JwtAuth + Roles             |
| LangChain    | POST | `/api/langchain/chat`                            | LLM聊天      | ApiKey                      |
| LangChain    | POST | `/api/langchain/stream`                          | 流式聊天     | ApiKey                      |
| LangChain    | POST | `/api/langchain/rag/query`                       | RAG查询      | ApiKey                      |
| LangChain    | POST | `/api/langchain/rag/upload`                      | 上传文档     | ApiKey                      |
| Health       | GET  | `/api/health`                                    | 健康检查     | @Public                     |
| Health       | GET  | `/api/health/ready`                              | 就绪检查     | @Public                     |
| Health       | GET  | `/api/health/live`                               | 存活检查     | @Public                     |
| Compress     | POST | `/api/compress`                                  | 压缩图片     | @Public                     |
| Compress     | GET  | `/api/compress`                                  | 压缩服务状态 | @Public                     |
| Root         | GET  | `/api/`                                          | 问候信息     | —                           |

---

## 五、模块依赖关系图

```
                          ┌──────────────┐
                          │  CoreModule  │
                          │ (Config/DB/  │
                          │  Logger)     │
                          └──────┬───────┘
                                 │ 全局
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
    ┌─────┴─────┐          ┌─────┴─────┐          ┌─────┴─────┐
    │ Storage   │          │   Auth    │          │   RBAC    │
    │ Module    │          │  Module   │          │  Module   │
    │ (全局)    │          │          │          │          │
    └─────┬─────┘          └─────┬─────┘          └─────┬─────┘
          │                      │                      │
          │                      │ 依赖                  │
          │                ┌─────┴─────┐                │
          │                │   User    │                │
          │                │  Module   │◄───────────────┘
          │                │          │     export Guard
          │                └─────┬─────┘
          │                      │ export UserProfileService
          │         ┌────────────┼────────────┐
          │         │            │            │
          │   ┌─────┴─────┐ ┌───┴───┐ ┌──────┴──────┐
          │   │   Diet    │ │ Coach │ │ Gamification│
          │   │  Module   │ │Module │ │   Module    │
          │   │          │ │       │ │             │
          │   └─────┬─────┘ └───────┘ └─────────────┘
          │         │ 依赖
          │   ┌─────┴─────┐
          │   │   Food    │
          │   │  Module   │◄─── FoodPipelineModule
          │   │          │
          │   └───────────┘
          │
    ┌─────┴─────┐    ┌───────────┐    ┌───────────┐
    │   File    │    │  Client   │    │ Provider  │
    │  Module   │    │  Module   │    │  Module   │
    └───────────┘    └─────┬─────┘    └─────┬─────┘
                           │                │
                           └────────┬───────┘
                                    │
                              ┌─────┴─────┐
                              │  Gateway  │
                              │  Module   │
                              └───────────┘

    ┌───────────┐    ┌───────────┐
    │ Analytics │    │AppVersion │
    │  Module   │    │  Module   │
    │ (查询其他) │    │          │
    └───────────┘    └───────────┘
```

### 5.1 依赖矩阵

| 模块                   | 依赖                          | 被依赖                                                                   | export                                                        |
| ---------------------- | ----------------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------- |
| **AuthModule**         | UserModule                    | —                                                                        | AppJwtAuthGuard, JwtAuthGuard                                 |
| **UserModule**         | RbacModule(Guard)             | AuthModule, DietModule, CoachModule, GamificationModule, AnalyticsModule | UserProfileService, ProfileInferenceService                   |
| **FoodModule**         | —                             | DietModule, FoodPipelineModule                                           | FoodLibraryService, TypeOrmModule(Food实体)                   |
| **DietModule**         | FoodModule, UserModule        | AnalyticsModule                                                          | FoodRecordService, DailySummaryService, NutritionScoreService |
| **CoachModule**        | UserModule                    | —                                                                        | CoachService                                                  |
| **GamificationModule** | UserModule                    | —                                                                        | GamificationService                                           |
| **RbacModule**         | —                             | UserModule                                                               | RbacPermissionGuard, RolesGuard                               |
| **ClientModule**       | —                             | GatewayModule                                                            | ClientService, TypeOrmModule(Client实体)                      |
| **ProviderModule**     | —                             | GatewayModule                                                            | ProviderService, TypeOrmModule(Provider实体)                  |
| **AppVersionModule**   | —                             | —                                                                        | AppUpdateService                                              |
| **AnalyticsModule**    | UserModule, DietModule (查询) | —                                                                        | —                                                             |
| **FileModule**         | StorageModule                 | —                                                                        | —                                                             |

---

## 六、分阶段执行方案

### Phase 0：准备工作（零功能变更）

**目标**：建立 autoLoadEntities 基础，创建目录结构

**改动**：

1. **`database.module.ts`** — 启用 `autoLoadEntities: true`，移除手动实体列表

```typescript
// 改动前：entities: [Client, AppUser, ...35个实体...]
// 改动后：
return {
  type: 'postgres',
  ...dbConfig,
  autoLoadEntities: true, // ← NestJS 自动加载所有 forFeature 注册的实体
  synchronize: dbConfig.synchronize,
};
```

2. **创建 `src/modules/` 目录** — 空目录

3. **创建 `src/entities/index.ts` barrel** — 统一导出所有实体

**风险**：极低  
**回滚**：还原 `database.module.ts` 单文件  
**验证**：`npx nest build` + 应用正常启动

---

### Phase 1：拆分独立模块（低风险，可并行）

**目标**：把与 App/Admin 主模块耦合度最低的 5 个模块先拆出

#### Phase 1a — FileModule

**来源文件**：

- `app/controllers/file.controller.ts` → `modules/file/app/file.controller.ts`
- `admin/controllers/file.controller.ts` → `modules/file/admin/file.controller.ts`

**改动**：

1. 创建 `modules/file/file.module.ts`
2. 移动 2 个控制器
3. 从 `AppClientModule` 移除 `AppFileController`
4. 从 `AdminModule` 移除 `FileController`
5. 在 `app.module.ts` imports 添加 `FileModule`

**API 不变**：`/api/app/files/*`, `/api/admin/files/*`

---

#### Phase 1b — AppVersionModule

**来源文件**：

- `app/controllers/update.controller.ts` → `modules/app-version/app/update.controller.ts`
- `app/services/app-update.service.ts` → `modules/app-version/app/app-update.service.ts`
- `admin/controllers/app-version.controller.ts` → `modules/app-version/admin/`
- `admin/controllers/app-version-package.controller.ts` → `modules/app-version/admin/`
- `admin/services/app-version.service.ts` → `modules/app-version/admin/`
- `admin/services/app-version-package.service.ts` → `modules/app-version/admin/`
- `entities/app-version.entity.ts` → `modules/app-version/entities/`
- `entities/app-version-package.entity.ts` → `modules/app-version/entities/`

**改动**：

1. 创建 `modules/app-version/app-version.module.ts`
2. 移动 2 实体 + 3 控制器 + 3 服务
3. 从 `AppClientModule` / `AdminModule` 移除相关注册
4. DTO 文件按需移动

**API 不变**：`/api/app/update/*`, `/api/admin/app-versions/*`

---

#### Phase 1c — GamificationModule

**来源文件**：

- `app/controllers/gamification.controller.ts` → `modules/gamification/app/`
- `app/services/gamification.service.ts` → `modules/gamification/app/`
- `admin/controllers/gamification-management.controller.ts` → `modules/gamification/admin/`
- `entities/achievement.entity.ts` → `modules/gamification/entities/`
- `entities/user-achievement.entity.ts` → `modules/gamification/entities/`
- `entities/challenge.entity.ts` → `modules/gamification/entities/`
- `entities/user-challenge.entity.ts` → `modules/gamification/entities/`

**注意**：`GamificationService` 依赖 `FoodService`（用于触发成就检查）。需通过 DietModule export 或暂时保留依赖。

**API 不变**：`/api/app/achievements`, `/api/app/challenges/*`, `/api/app/streak`, `/api/admin/gamification/*`

---

#### Phase 1d — CoachModule

**来源文件**：

- `app/controllers/coach.controller.ts` → `modules/coach/app/`
- `app/services/coach.service.ts` → `modules/coach/app/`
- `entities/coach-conversation.entity.ts` → `modules/coach/entities/`
- `entities/coach-message.entity.ts` → `modules/coach/entities/`

**依赖**：`CoachService` 依赖 `FoodService`, `UserProfileService`, `BehaviorService`  
**处理**：通过模块 imports 获取所需服务

**API 不变**：`/api/app/coach/*`

---

#### Phase 1e — AnalyticsModule

**来源文件**：

- `admin/controllers/analytics.controller.ts` → `modules/analytics/admin/`
- `admin/services/analytics.service.ts` → `modules/analytics/admin/`

**依赖**：查询 `UsageRecord`, `Client` 表  
**处理**：通过 `TypeOrmModule.forFeature` 直接注册（因 autoLoadEntities 已启用）

**API 不变**：`/api/admin/analytics/*`

---

### Phase 2：拆分核心业务模块（中风险，顺序执行）

#### Phase 2a — RbacModule

**来源文件**：

- `admin/controllers/role.controller.ts` → `modules/rbac/admin/`
- `admin/controllers/rbac-permission.controller.ts` → `modules/rbac/admin/`
- `admin/controllers/permission-template.controller.ts` → `modules/rbac/admin/`
- `admin/services/role.service.ts` → `modules/rbac/admin/`
- `admin/services/rbac-permission.service.ts` → `modules/rbac/admin/`
- `admin/services/permission-template.service.ts` → `modules/rbac/admin/`
- `admin/guards/rbac-permission.guard.ts` → `modules/rbac/admin/`
- `admin/guards/roles.guard.ts` → `modules/rbac/admin/`
- `admin/decorators/roles.decorator.ts` → `modules/rbac/admin/`
- `admin/decorators/require-permission.decorator.ts` → `modules/rbac/admin/`
- 5 实体：Role, Permission, PermissionTemplate, UserRole, RolePermission

**关键**：`RolesGuard` 和 `RbacPermissionGuard` 需要 **export** 给其他 Admin 端模块使用。

**API 不变**：`/api/admin/roles/*`, `/api/admin/rbac-permissions/*`, `/api/admin/permission-templates/*`

---

#### Phase 2b — ClientModule + ProviderModule

**ClientModule 来源**：

- `admin/controllers/client.controller.ts` + `admin/controllers/permission.controller.ts`
- `admin/services/client.service.ts` + `admin/services/permission.service.ts`
- 实体：Client, ClientCapabilityPermission

**ProviderModule 来源**：

- `admin/controllers/provider.controller.ts` + `admin/controllers/model.controller.ts`
- `admin/services/provider.service.ts` + `admin/services/model.service.ts`
- 实体：Provider, ModelConfig, UsageRecord

**关键**：拆完后 **GatewayModule** 需更新 imports — 从自行注册 5 实体改为 import ClientModule + ProviderModule。

**API 不变**：`/api/admin/clients/*`, `/api/admin/providers/*`, `/api/admin/models/*`

---

#### Phase 2c — UserModule

**来源文件**：

App 端:

- `app/controllers/user-profile.controller.ts` → `modules/user/app/`
- `app/services/user-profile.service.ts` → `modules/user/app/`
- `app/services/profile-inference.service.ts` → `modules/user/app/`
- `app/services/profile-cache.service.ts` → `modules/user/app/`
- `app/services/profile-cron.service.ts` → `modules/user/app/`
- `app/services/collection-trigger.service.ts` → `modules/user/app/`

Admin 端:

- `admin/controllers/admin-user.controller.ts` → `modules/user/admin/`
- `admin/controllers/app-user-management.controller.ts` → `modules/user/admin/`
- `admin/services/admin-user.service.ts` → `modules/user/admin/`
- `admin/services/app-user-management.service.ts` → `modules/user/admin/`

实体 (6个):

- AppUser, AdminUser, UserProfile, UserInferredProfile, UserBehaviorProfile, ProfileSnapshot

**关键**：UserModule 必须 **export** 以下服务供其他模块使用：

- `UserProfileService` → DietModule, CoachModule
- `ProfileInferenceService` → 可选
- `TypeOrmModule` (User 实体) → AuthModule

**API 不变**：`/api/app/user-profile/*`, `/api/admin/users/*`, `/api/admin/app-users/*`

---

#### Phase 2d — AuthModule

**来源文件**：

App 端:

- `app/app.controller.ts` (AppAuthController) → `modules/auth/app/`
- `app/services/app-auth.service.ts` → `modules/auth/app/`
- `app/services/wechat-auth.service.ts` → `modules/auth/app/`
- `app/services/sms.service.ts` → `modules/auth/app/`
- `app/strategies/app-jwt.strategy.ts` → `modules/auth/app/`
- `app/guards/app-jwt-auth.guard.ts` → `modules/auth/app/`
- `app/decorators/current-app-user.decorator.ts` → `modules/auth/app/`

Admin 端:

- `admin/admin.controller.ts` (AdminController) → `modules/auth/admin/`
- `admin/admin.service.ts` → `modules/auth/admin/`
- `admin/strategies/jwt.strategy.ts` → `modules/auth/admin/`
- `admin/guards/jwt-auth.guard.ts` → `modules/auth/admin/`
- `admin/decorators/current-user.decorator.ts` → `modules/auth/admin/`

**关键改进**：

- JWT secret 统一从 `ConfigModule` 注入，移除 `process.env.JWT_SECRET` 硬编码
- AuthModule **export** `AppJwtAuthGuard` + `JwtAuthGuard` 供其他模块使用

**API 不变**：`/api/app/auth/*`, `/api/auth/*`

---

### Phase 3：拆分食物 + 饮食模块（最复杂）

#### Phase 3a — FoodModule

**来源文件**：

App 端:

- `app/controllers/food-library.controller.ts` → `modules/food/app/`
- `app/controllers/food-analyze.controller.ts` → `modules/food/app/`
- `app/services/food-library.service.ts` → `modules/food/app/`
- `app/services/analyze.service.ts` → `modules/food/app/`

Admin 端:

- `admin/controllers/food-library-management.controller.ts` → `modules/food/admin/`
- `admin/services/food-library-management.service.ts` → `modules/food/admin/`

实体 (6个):

- FoodLibrary, FoodTranslation, FoodSource, FoodChangeLog, FoodConflict, FoodRegionalInfo

**关键**：

- FoodModule **export** `FoodLibraryService` + `TypeOrmModule` → 供 DietModule 和 FoodPipelineModule 使用
- FoodPipelineModule 需更新 imports 改为依赖 FoodModule

**API 不变**：`/api/foods/*`, `/api/app/food/analyze`, `/api/admin/food-library/*`

---

#### Phase 3b — DietModule（最大、最后拆）

**来源文件**：

App 端 (8 控制器/服务):

- `app/controllers/food-record.controller.ts` → `modules/diet/app/`
- `app/controllers/food-summary.controller.ts` → `modules/diet/app/`
- `app/controllers/food-plan.controller.ts` → `modules/diet/app/`
- `app/controllers/food-nutrition.controller.ts` → `modules/diet/app/`
- `app/controllers/food-behavior.controller.ts` → `modules/diet/app/`
- `app/controllers/food.controller.ts` → `modules/diet/app/` (如果存在)
- `app/services/food-record.service.ts` → `modules/diet/app/`
- `app/services/daily-summary.service.ts` → `modules/diet/app/`
- `app/services/daily-plan.service.ts` → `modules/diet/app/`
- `app/services/nutrition-score.service.ts` → `modules/diet/app/`
- `app/services/behavior.service.ts` → `modules/diet/app/`
- `app/services/food.service.ts` → `modules/diet/app/`
- `app/services/recommendation-engine.service.ts` → `modules/diet/app/`
- `app/services/collection-trigger.service.ts` → `modules/diet/app/` (或 UserModule)

Admin 端:

- `admin/controllers/content-management.controller.ts` → `modules/diet/admin/`
- `admin/services/content-management.service.ts` → `modules/diet/admin/`

实体 (5个):

- FoodRecord, DailySummary, DailyPlan, AiDecisionLog, RecommendationFeedback

**依赖**：

- imports: `FoodModule` (FoodLibraryService)、`UserModule` (UserProfileService)
- `AuthModule` (AppJwtAuthGuard)

**关键**：DietModule **export** `FoodRecordService`, `NutritionScoreService` → 供 AnalyticsModule 等查询使用

**API 不变**：`/api/app/food/records/*`, `/api/app/food/summary/*`, `/api/app/food/daily-plan/*`, `/api/app/food/nutrition-score`, `/api/app/food/behavior-profile`, `/api/app/food/profile`, `/api/app/food/meal-suggestion`, `/api/admin/content/*`

---

### Phase 4：清理与优化（低风险）

1. **删除空的 `AppClientModule`** — 所有内容已迁出
2. **删除空的 `AdminModule`** — 所有内容已迁出
3. **删除旧的 `src/entities/` 目录** — 实体已分布到各 `modules/*/entities/`（保留 `index.ts` re-export 兼容一段时间），或更新 `entities/index.ts` 为指向新位置的 re-export
4. **更新 `app.module.ts`** — 移除 AdminModule/AppClientModule import
5. **移除 `app.module.ts` 中的 `APP_GUARD` Proxy** — 无效代码
6. **JWT 配置统一** — 已在 Phase 2d 完成
7. **整理 DTO 文件** — 确保随控制器迁移到模块目录
8. **更新 `data-source.ts` / `data-source-dev.ts`** — 实体路径从 `entities/*.entity` 改为 `modules/*/entities/*.entity`
9. **更新 scripts** — 种子数据脚本中的实体引用路径

---

## 七、文件迁移清单

### 7.1 完整迁移映射表

| 源文件                                                    | 目标位置                                                           | Phase |
| --------------------------------------------------------- | ------------------------------------------------------------------ | :---: |
| **FileModule**                                            |                                                                    |       |
| `app/controllers/file.controller.ts`                      | `modules/file/app/file.controller.ts`                              |  1a   |
| `admin/controllers/file.controller.ts`                    | `modules/file/admin/file.controller.ts`                            |  1a   |
| **AppVersionModule**                                      |                                                                    |       |
| `app/controllers/update.controller.ts`                    | `modules/app-version/app/update.controller.ts`                     |  1b   |
| `app/services/app-update.service.ts`                      | `modules/app-version/app/app-update.service.ts`                    |  1b   |
| `admin/controllers/app-version.controller.ts`             | `modules/app-version/admin/app-version.controller.ts`              |  1b   |
| `admin/controllers/app-version-package.controller.ts`     | `modules/app-version/admin/app-version-package.controller.ts`      |  1b   |
| `admin/services/app-version.service.ts`                   | `modules/app-version/admin/app-version.service.ts`                 |  1b   |
| `admin/services/app-version-package.service.ts`           | `modules/app-version/admin/app-version-package.service.ts`         |  1b   |
| `entities/app-version.entity.ts`                          | `modules/app-version/entities/app-version.entity.ts`               |  1b   |
| `entities/app-version-package.entity.ts`                  | `modules/app-version/entities/app-version-package.entity.ts`       |  1b   |
| `app/dto/update.dto.ts`                                   | `modules/app-version/app/dto/update.dto.ts`                        |  1b   |
| `admin/dto/app-version-management.dto.ts`                 | `modules/app-version/admin/dto/app-version-management.dto.ts`      |  1b   |
| **GamificationModule**                                    |                                                                    |       |
| `app/controllers/gamification.controller.ts`              | `modules/gamification/app/gamification.controller.ts`              |  1c   |
| `app/services/gamification.service.ts`                    | `modules/gamification/app/gamification.service.ts`                 |  1c   |
| `admin/controllers/gamification-management.controller.ts` | `modules/gamification/admin/gamification-management.controller.ts` |  1c   |
| `entities/achievement.entity.ts`                          | `modules/gamification/entities/achievement.entity.ts`              |  1c   |
| `entities/user-achievement.entity.ts`                     | `modules/gamification/entities/user-achievement.entity.ts`         |  1c   |
| `entities/challenge.entity.ts`                            | `modules/gamification/entities/challenge.entity.ts`                |  1c   |
| `entities/user-challenge.entity.ts`                       | `modules/gamification/entities/user-challenge.entity.ts`           |  1c   |
| **CoachModule**                                           |                                                                    |       |
| `app/controllers/coach.controller.ts`                     | `modules/coach/app/coach.controller.ts`                            |  1d   |
| `app/services/coach.service.ts`                           | `modules/coach/app/coach.service.ts`                               |  1d   |
| `entities/coach-conversation.entity.ts`                   | `modules/coach/entities/coach-conversation.entity.ts`              |  1d   |
| `entities/coach-message.entity.ts`                        | `modules/coach/entities/coach-message.entity.ts`                   |  1d   |
| `app/dto/coach.dto.ts`                                    | `modules/coach/app/dto/coach.dto.ts`                               |  1d   |
| **AnalyticsModule**                                       |                                                                    |       |
| `admin/controllers/analytics.controller.ts`               | `modules/analytics/admin/analytics.controller.ts`                  |  1e   |
| `admin/services/analytics.service.ts`                     | `modules/analytics/admin/analytics.service.ts`                     |  1e   |
| `admin/dto/analytics.dto.ts`                              | `modules/analytics/admin/dto/analytics.dto.ts`                     |  1e   |
| **RbacModule**                                            |                                                                    |       |
| `admin/controllers/role.controller.ts`                    | `modules/rbac/admin/role.controller.ts`                            |  2a   |
| `admin/controllers/rbac-permission.controller.ts`         | `modules/rbac/admin/rbac-permission.controller.ts`                 |  2a   |
| `admin/controllers/permission-template.controller.ts`     | `modules/rbac/admin/permission-template.controller.ts`             |  2a   |
| `admin/services/role.service.ts`                          | `modules/rbac/admin/role.service.ts`                               |  2a   |
| `admin/services/rbac-permission.service.ts`               | `modules/rbac/admin/rbac-permission.service.ts`                    |  2a   |
| `admin/services/permission-template.service.ts`           | `modules/rbac/admin/permission-template.service.ts`                |  2a   |
| `admin/guards/rbac-permission.guard.ts`                   | `modules/rbac/admin/rbac-permission.guard.ts`                      |  2a   |
| `admin/guards/roles.guard.ts`                             | `modules/rbac/admin/roles.guard.ts`                                |  2a   |
| `admin/decorators/roles.decorator.ts`                     | `modules/rbac/admin/roles.decorator.ts`                            |  2a   |
| `admin/decorators/require-permission.decorator.ts`        | `modules/rbac/admin/require-permission.decorator.ts`               |  2a   |
| `entities/role.entity.ts`                                 | `modules/rbac/entities/role.entity.ts`                             |  2a   |
| `entities/permission.entity.ts`                           | `modules/rbac/entities/permission.entity.ts`                       |  2a   |
| `entities/permission-template.entity.ts`                  | `modules/rbac/entities/permission-template.entity.ts`              |  2a   |
| `entities/user-role.entity.ts`                            | `modules/rbac/entities/user-role.entity.ts`                        |  2a   |
| `entities/role-permission.entity.ts`                      | `modules/rbac/entities/role-permission.entity.ts`                  |  2a   |
| `admin/dto/permission-management.dto.ts`                  | `modules/rbac/admin/dto/permission-management.dto.ts`              |  2a   |
| **ClientModule**                                          |                                                                    |       |
| `admin/controllers/client.controller.ts`                  | `modules/client/admin/client.controller.ts`                        |  2b   |
| `admin/controllers/permission.controller.ts`              | `modules/client/admin/permission.controller.ts`                    |  2b   |
| `admin/services/client.service.ts`                        | `modules/client/admin/client.service.ts`                           |  2b   |
| `admin/services/permission.service.ts`                    | `modules/client/admin/permission.service.ts`                       |  2b   |
| `entities/client.entity.ts`                               | `modules/client/entities/client.entity.ts`                         |  2b   |
| `entities/client-capability-permission.entity.ts`         | `modules/client/entities/client-capability-permission.entity.ts`   |  2b   |
| `admin/dto/client-management.dto.ts`                      | `modules/client/admin/dto/client-management.dto.ts`                |  2b   |
| **ProviderModule**                                        |                                                                    |       |
| `admin/controllers/provider.controller.ts`                | `modules/provider/admin/provider.controller.ts`                    |  2b   |
| `admin/controllers/model.controller.ts`                   | `modules/provider/admin/model.controller.ts`                       |  2b   |
| `admin/services/provider.service.ts`                      | `modules/provider/admin/provider.service.ts`                       |  2b   |
| `admin/services/model.service.ts`                         | `modules/provider/admin/model.service.ts`                          |  2b   |
| `entities/provider.entity.ts`                             | `modules/provider/entities/provider.entity.ts`                     |  2b   |
| `entities/model-config.entity.ts`                         | `modules/provider/entities/model-config.entity.ts`                 |  2b   |
| `entities/usage-record.entity.ts`                         | `modules/provider/entities/usage-record.entity.ts`                 |  2b   |
| `admin/dto/provider-management.dto.ts`                    | `modules/provider/admin/dto/provider-management.dto.ts`            |  2b   |
| `admin/dto/model-management.dto.ts`                       | `modules/provider/admin/dto/model-management.dto.ts`               |  2b   |
| **UserModule**                                            |                                                                    |       |
| `app/controllers/user-profile.controller.ts`              | `modules/user/app/user-profile.controller.ts`                      |  2c   |
| `app/services/user-profile.service.ts`                    | `modules/user/app/user-profile.service.ts`                         |  2c   |
| `app/services/profile-inference.service.ts`               | `modules/user/app/profile-inference.service.ts`                    |  2c   |
| `app/services/profile-cache.service.ts`                   | `modules/user/app/profile-cache.service.ts`                        |  2c   |
| `app/services/profile-cron.service.ts`                    | `modules/user/app/profile-cron.service.ts`                         |  2c   |
| `admin/controllers/admin-user.controller.ts`              | `modules/user/admin/admin-user.controller.ts`                      |  2c   |
| `admin/controllers/app-user-management.controller.ts`     | `modules/user/admin/app-user-management.controller.ts`             |  2c   |
| `admin/services/admin-user.service.ts`                    | `modules/user/admin/admin-user.service.ts`                         |  2c   |
| `admin/services/app-user-management.service.ts`           | `modules/user/admin/app-user-management.service.ts`                |  2c   |
| `entities/app-user.entity.ts`                             | `modules/user/entities/app-user.entity.ts`                         |  2c   |
| `entities/admin-user.entity.ts`                           | `modules/user/entities/admin-user.entity.ts`                       |  2c   |
| `entities/user-profile.entity.ts`                         | `modules/user/entities/user-profile.entity.ts`                     |  2c   |
| `entities/user-inferred-profile.entity.ts`                | `modules/user/entities/user-inferred-profile.entity.ts`            |  2c   |
| `entities/user-behavior-profile.entity.ts`                | `modules/user/entities/user-behavior-profile.entity.ts`            |  2c   |
| `entities/profile-snapshot.entity.ts`                     | `modules/user/entities/profile-snapshot.entity.ts`                 |  2c   |
| `app/dto/user-profile.dto.ts`                             | `modules/user/app/dto/user-profile.dto.ts`                         |  2c   |
| `admin/dto/user-management.dto.ts`                        | `modules/user/admin/dto/user-management.dto.ts`                    |  2c   |
| `admin/dto/app-user-management.dto.ts`                    | `modules/user/admin/dto/app-user-management.dto.ts`                |  2c   |
| **AuthModule**                                            |                                                                    |       |
| `app/app.controller.ts`                                   | `modules/auth/app/app-auth.controller.ts`                          |  2d   |
| `app/services/app-auth.service.ts`                        | `modules/auth/app/app-auth.service.ts`                             |  2d   |
| `app/services/wechat-auth.service.ts`                     | `modules/auth/app/wechat-auth.service.ts`                          |  2d   |
| `app/services/sms.service.ts`                             | `modules/auth/app/sms.service.ts`                                  |  2d   |
| `app/services/firebase-admin.service.ts`                  | `modules/auth/app/firebase-admin.service.ts`                       |  2d   |
| `app/strategies/app-jwt.strategy.ts`                      | `modules/auth/app/app-jwt.strategy.ts`                             |  2d   |
| `app/guards/app-jwt-auth.guard.ts`                        | `modules/auth/app/app-jwt-auth.guard.ts`                           |  2d   |
| `app/decorators/current-app-user.decorator.ts`            | `modules/auth/app/current-app-user.decorator.ts`                   |  2d   |
| `admin/admin.controller.ts`                               | `modules/auth/admin/admin-auth.controller.ts`                      |  2d   |
| `admin/admin.service.ts`                                  | `modules/auth/admin/admin-auth.service.ts`                         |  2d   |
| `admin/strategies/jwt.strategy.ts`                        | `modules/auth/admin/jwt.strategy.ts`                               |  2d   |
| `admin/guards/jwt-auth.guard.ts`                          | `modules/auth/admin/jwt-auth.guard.ts`                             |  2d   |
| `admin/decorators/current-user.decorator.ts`              | `modules/auth/admin/current-user.decorator.ts`                     |  2d   |
| `app/dto/auth.dto.ts`                                     | `modules/auth/app/dto/auth.dto.ts`                                 |  2d   |
| `admin/dto/auth.dto.ts`                                   | `modules/auth/admin/dto/auth.dto.ts`                               |  2d   |
| `admin/dto/auth-response.dto.ts`                          | `modules/auth/admin/dto/auth-response.dto.ts`                      |  2d   |
| **FoodModule**                                            |                                                                    |       |
| `app/controllers/food-library.controller.ts`              | `modules/food/app/food-library.controller.ts`                      |  3a   |
| `app/controllers/food-analyze.controller.ts`              | `modules/food/app/food-analyze.controller.ts`                      |  3a   |
| `app/services/food-library.service.ts`                    | `modules/food/app/food-library.service.ts`                         |  3a   |
| `app/services/analyze.service.ts`                         | `modules/food/app/analyze.service.ts`                              |  3a   |
| `admin/controllers/food-library-management.controller.ts` | `modules/food/admin/food-library-management.controller.ts`         |  3a   |
| `admin/services/food-library-management.service.ts`       | `modules/food/admin/food-library-management.service.ts`            |  3a   |
| `entities/food-library.entity.ts`                         | `modules/food/entities/food-library.entity.ts`                     |  3a   |
| `entities/food-translation.entity.ts`                     | `modules/food/entities/food-translation.entity.ts`                 |  3a   |
| `entities/food-source.entity.ts`                          | `modules/food/entities/food-source.entity.ts`                      |  3a   |
| `entities/food-change-log.entity.ts`                      | `modules/food/entities/food-change-log.entity.ts`                  |  3a   |
| `entities/food-conflict.entity.ts`                        | `modules/food/entities/food-conflict.entity.ts`                    |  3a   |
| `entities/food-regional-info.entity.ts`                   | `modules/food/entities/food-regional-info.entity.ts`               |  3a   |
| `admin/dto/food-library-management.dto.ts`                | `modules/food/admin/dto/food-library-management.dto.ts`            |  3a   |
| **DietModule**                                            |                                                                    |       |
| `app/controllers/food-record.controller.ts`               | `modules/diet/app/food-record.controller.ts`                       |  3b   |
| `app/controllers/food-summary.controller.ts`              | `modules/diet/app/food-summary.controller.ts`                      |  3b   |
| `app/controllers/food-plan.controller.ts`                 | `modules/diet/app/food-plan.controller.ts`                         |  3b   |
| `app/controllers/food-nutrition.controller.ts`            | `modules/diet/app/food-nutrition.controller.ts`                    |  3b   |
| `app/controllers/food-behavior.controller.ts`             | `modules/diet/app/food-behavior.controller.ts`                     |  3b   |
| `app/controllers/food.controller.ts`                      | `modules/diet/app/food.controller.ts`                              |  3b   |
| `app/services/food-record.service.ts`                     | `modules/diet/app/food-record.service.ts`                          |  3b   |
| `app/services/daily-summary.service.ts`                   | `modules/diet/app/daily-summary.service.ts`                        |  3b   |
| `app/services/daily-plan.service.ts`                      | `modules/diet/app/daily-plan.service.ts`                           |  3b   |
| `app/services/nutrition-score.service.ts`                 | `modules/diet/app/nutrition-score.service.ts`                      |  3b   |
| `app/services/behavior.service.ts`                        | `modules/diet/app/behavior.service.ts`                             |  3b   |
| `app/services/food.service.ts`                            | `modules/diet/app/food.service.ts`                                 |  3b   |
| `app/services/recommendation-engine.service.ts`           | `modules/diet/app/recommendation-engine.service.ts`                |  3b   |
| `app/services/collection-trigger.service.ts`              | `modules/diet/app/collection-trigger.service.ts`                   |  3b   |
| `admin/controllers/content-management.controller.ts`      | `modules/diet/admin/content-management.controller.ts`              |  3b   |
| `admin/services/content-management.service.ts`            | `modules/diet/admin/content-management.service.ts`                 |  3b   |
| `entities/food-record.entity.ts`                          | `modules/diet/entities/food-record.entity.ts`                      |  3b   |
| `entities/daily-summary.entity.ts`                        | `modules/diet/entities/daily-summary.entity.ts`                    |  3b   |
| `entities/daily-plan.entity.ts`                           | `modules/diet/entities/daily-plan.entity.ts`                       |  3b   |
| `entities/ai-decision-log.entity.ts`                      | `modules/diet/entities/ai-decision-log.entity.ts`                  |  3b   |
| `entities/recommendation-feedback.entity.ts`              | `modules/diet/entities/recommendation-feedback.entity.ts`          |  3b   |
| `app/dto/food.dto.ts`                                     | `modules/diet/app/dto/food.dto.ts`                                 |  3b   |
| `admin/dto/content-management.dto.ts`                     | `modules/diet/admin/dto/content-management.dto.ts`                 |  3b   |

### 7.2 统计

|   Phase   | 实体移动 | 控制器移动 | 服务移动 | DTO移动 |             其他文件             |
| :-------: | :------: | :--------: | :------: | :-----: | :------------------------------: |
|  1 (a-e)  |    8     |     8      |    7     |    4    |                0                 |
|  2 (a-d)  |    16    |     10     |    14    |    8    | 7 (guards/strategies/decorators) |
|  3 (a-b)  |    11    |     8      |    10    |    3    |                0                 |
| **Total** |  **35**  |   **26**   |  **31**  | **15**  |              **7**               |

---

## 八、验证方案

### 8.1 每步自动化验证

```bash
# 1. 编译检查
npx nest build

# 2. 类型检查
npx tsc --noEmit

# 3. 启动验证
npx nest start  # 确认无运行时错误

# 4. 路由对比
# 重构前导出 Swagger JSON
curl http://localhost:3006/api/docs-json > swagger-before.json

# 重构后导出
curl http://localhost:3006/api/docs-json > swagger-after.json

# 对比
diff swagger-before.json swagger-after.json  # 应无差异
```

### 8.2 每 Phase 手动回归

| 验证项     | 操作                                         | 预期结果       |
| ---------- | -------------------------------------------- | -------------- |
| App 登录   | POST `/api/app/auth/anonymous`               | 返回 JWT token |
| 受保护接口 | GET `/api/app/food/records/today` (带 token) | 返回今日记录   |
| Admin 登录 | POST `/api/auth/login`                       | 返回 Admin JWT |
| RBAC 验证  | GET `/api/admin/users` (admin role token)    | 返回用户列表   |
| 公开接口   | GET `/api/foods/search?q=鸡蛋`               | 返回搜索结果   |
| 食物记录   | POST `/api/app/food/records`                 | 创建成功       |
| AI教练     | POST `/api/app/coach/chat`                   | SSE 流式响应   |
| 版本检查   | POST `/api/app/update/check`                 | 返回版本信息   |
| 数据库     | `psql` 查看表结构                            | 零变化         |

### 8.3 回归测试建议（后续建设）

```
每个新模块添加:
modules/<name>/__tests__/
├── <name>.module.spec.ts        模块加载测试
├── *.controller.spec.ts         路由注册 + Guard 验证
└── *.service.spec.ts            业务逻辑单测
```

---

## 九、回滚策略

### 9.1 Git Tag 策略

每个 Phase 开始前打 tag：

```bash
git tag refactor/phase-0-start
git tag refactor/phase-1-start
git tag refactor/phase-2-start
git tag refactor/phase-3-start
git tag refactor/phase-4-start
```

### 9.2 回滚操作

| 场景             | 操作                                 | 影响范围   |
| ---------------- | ------------------------------------ | ---------- |
| 单个模块拆分失败 | 文件移回原位 + 恢复 Module 注册      | 仅该模块   |
| 整个 Phase 失败  | `git revert <phase-commits>`         | 整个阶段   |
| 紧急回滚         | `git reset --hard <phase-start-tag>` | 回到阶段前 |
| 只回退某些文件   | `git checkout <tag> -- <files>`      | 指定文件   |

### 9.3 兼容性保证

在实体迁移过程中，旧路径保留 re-export：

```typescript
// src/entities/food-library.entity.ts (迁移后保留)
export { FoodLibrary } from '../modules/food/entities/food-library.entity';
```

这样即使有其他文件（如 scripts/、migration/）引用旧路径，也不会断裂。在 Phase 4 统一清理。

---

## 十、决策记录

| #   | 决策                               | 选择                             | 其他方案   | 选择理由                               |
| --- | ---------------------------------- | -------------------------------- | ---------- | -------------------------------------- |
| 1   | 实体放模块内 vs 全局 entities/     | **模块内**                       | 保留全局   | 领域内聚，便于独立测试和未来微服务拆分 |
| 2   | autoLoadEntities vs 手动列表       | **autoLoadEntities**             | 手动列表   | 消除三重注册，NestJS 官方推荐          |
| 3   | App/Admin 控制器放同一模块 vs 分开 | **同模块 app/admin 子目录**      | 独立模块   | 共享实体和业务逻辑，减少跨模块依赖     |
| 4   | 业务模块放 modules/ vs 根目录      | **modules/**                     | 根目录平铺 | 与 core/, gateway/ 等非业务模块区分    |
| 5   | 是否引入 SharedModule              | **否**                           | 引入       | 模块间直接 import，避免过度抽象        |
| 6   | 是否重构 Gateway/FoodPipeline      | **否（仅更新 imports）**         | 一起重构   | 已独立良好，控制范围                   |
| 7   | 实体迁移时旧路径处理               | **保留 re-export，Phase 4 清除** | 直接删除   | 减少过渡期断裂风险                     |
| 8   | `@Controller` 路径是否调整         | **不调整**                       | 统一命名   | API 兼容性最高优先级                   |

---

## 附录 A：最终目标结构

```
src/
├── main.ts
├── app.module.ts
├── app.controller.ts
├── app.service.ts
│
├── core/
│   ├── config/
│   │   ├── config.module.ts
│   │   └── configuration.ts
│   ├── database/
│   │   ├── database.module.ts        (autoLoadEntities: true)
│   │   ├── data-source.ts
│   │   └── data-source-dev.ts
│   ├── logger/
│   │   └── logger.module.ts
│   ├── filters/
│   │   └── all-exceptions.filter.ts
│   ├── interceptors/
│   │   └── response.interceptor.ts
│   ├── middlewares/
│   │   └── logger.middleware.ts
│   ├── decorators/
│   │   ├── public.decorator.ts
│   │   └── ignore-response-interceptor.decorator.ts
│   ├── swagger/
│   │   └── swagger.config.ts
│   └── core.module.ts
│
├── modules/
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── app/
│   │   │   ├── app-auth.controller.ts
│   │   │   ├── app-auth.service.ts
│   │   │   ├── wechat-auth.service.ts
│   │   │   ├── sms.service.ts
│   │   │   ├── firebase-admin.service.ts
│   │   │   ├── app-jwt.strategy.ts
│   │   │   ├── app-jwt-auth.guard.ts
│   │   │   ├── current-app-user.decorator.ts
│   │   │   └── dto/
│   │   └── admin/
│   │       ├── admin-auth.controller.ts
│   │       ├── admin-auth.service.ts
│   │       ├── jwt.strategy.ts
│   │       ├── jwt-auth.guard.ts
│   │       ├── current-user.decorator.ts
│   │       └── dto/
│   │
│   ├── user/
│   │   ├── user.module.ts
│   │   ├── entities/
│   │   │   ├── app-user.entity.ts
│   │   │   ├── admin-user.entity.ts
│   │   │   ├── user-profile.entity.ts
│   │   │   ├── user-inferred-profile.entity.ts
│   │   │   ├── user-behavior-profile.entity.ts
│   │   │   └── profile-snapshot.entity.ts
│   │   ├── app/
│   │   │   ├── user-profile.controller.ts
│   │   │   ├── user-profile.service.ts
│   │   │   ├── profile-inference.service.ts
│   │   │   ├── profile-cache.service.ts
│   │   │   ├── profile-cron.service.ts
│   │   │   ├── collection-trigger.service.ts
│   │   │   └── dto/
│   │   └── admin/
│   │       ├── admin-user.controller.ts
│   │       ├── admin-user.service.ts
│   │       ├── app-user-management.controller.ts
│   │       ├── app-user-management.service.ts
│   │       └── dto/
│   │
│   ├── food/
│   │   ├── food.module.ts
│   │   ├── entities/
│   │   │   ├── food-library.entity.ts
│   │   │   ├── food-translation.entity.ts
│   │   │   ├── food-source.entity.ts
│   │   │   ├── food-change-log.entity.ts
│   │   │   ├── food-conflict.entity.ts
│   │   │   └── food-regional-info.entity.ts
│   │   ├── app/
│   │   │   ├── food-library.controller.ts
│   │   │   ├── food-library.service.ts
│   │   │   ├── food-analyze.controller.ts
│   │   │   ├── analyze.service.ts
│   │   │   └── dto/
│   │   └── admin/
│   │       ├── food-library-management.controller.ts
│   │       ├── food-library-management.service.ts
│   │       └── dto/
│   │
│   ├── diet/
│   │   ├── diet.module.ts
│   │   ├── entities/
│   │   │   ├── food-record.entity.ts
│   │   │   ├── daily-summary.entity.ts
│   │   │   ├── daily-plan.entity.ts
│   │   │   ├── ai-decision-log.entity.ts
│   │   │   └── recommendation-feedback.entity.ts
│   │   ├── app/
│   │   │   ├── food-record.controller.ts
│   │   │   ├── food-record.service.ts
│   │   │   ├── food-summary.controller.ts
│   │   │   ├── daily-summary.service.ts
│   │   │   ├── food-plan.controller.ts
│   │   │   ├── daily-plan.service.ts
│   │   │   ├── food-nutrition.controller.ts
│   │   │   ├── nutrition-score.service.ts
│   │   │   ├── food-behavior.controller.ts
│   │   │   ├── behavior.service.ts
│   │   │   ├── food.controller.ts
│   │   │   ├── food.service.ts
│   │   │   ├── recommendation-engine.service.ts
│   │   │   ├── collection-trigger.service.ts
│   │   │   └── dto/
│   │   └── admin/
│   │       ├── content-management.controller.ts
│   │       ├── content-management.service.ts
│   │       └── dto/
│   │
│   ├── coach/
│   │   ├── coach.module.ts
│   │   ├── entities/
│   │   │   ├── coach-conversation.entity.ts
│   │   │   └── coach-message.entity.ts
│   │   └── app/
│   │       ├── coach.controller.ts
│   │       ├── coach.service.ts
│   │       └── dto/
│   │
│   ├── gamification/
│   │   ├── gamification.module.ts
│   │   ├── entities/
│   │   │   ├── achievement.entity.ts
│   │   │   ├── user-achievement.entity.ts
│   │   │   ├── challenge.entity.ts
│   │   │   └── user-challenge.entity.ts
│   │   ├── app/
│   │   │   ├── gamification.controller.ts
│   │   │   ├── gamification.service.ts
│   │   │   └── dto/
│   │   └── admin/
│   │       ├── gamification-management.controller.ts
│   │       └── dto/
│   │
│   ├── rbac/
│   │   ├── rbac.module.ts
│   │   ├── entities/
│   │   │   ├── role.entity.ts
│   │   │   ├── permission.entity.ts
│   │   │   ├── permission-template.entity.ts
│   │   │   ├── user-role.entity.ts
│   │   │   └── role-permission.entity.ts
│   │   └── admin/
│   │       ├── role.controller.ts
│   │       ├── role.service.ts
│   │       ├── rbac-permission.controller.ts
│   │       ├── rbac-permission.service.ts
│   │       ├── permission-template.controller.ts
│   │       ├── permission-template.service.ts
│   │       ├── rbac-permission.guard.ts
│   │       ├── roles.guard.ts
│   │       ├── roles.decorator.ts
│   │       ├── require-permission.decorator.ts
│   │       └── dto/
│   │
│   ├── client/
│   │   ├── client.module.ts
│   │   ├── entities/
│   │   │   ├── client.entity.ts
│   │   │   └── client-capability-permission.entity.ts
│   │   └── admin/
│   │       ├── client.controller.ts
│   │       ├── client.service.ts
│   │       ├── permission.controller.ts
│   │       ├── permission.service.ts
│   │       └── dto/
│   │
│   ├── provider/
│   │   ├── provider.module.ts
│   │   ├── entities/
│   │   │   ├── provider.entity.ts
│   │   │   ├── model-config.entity.ts
│   │   │   └── usage-record.entity.ts
│   │   └── admin/
│   │       ├── provider.controller.ts
│   │       ├── provider.service.ts
│   │       ├── model.controller.ts
│   │       ├── model.service.ts
│   │       └── dto/
│   │
│   ├── app-version/
│   │   ├── app-version.module.ts
│   │   ├── entities/
│   │   │   ├── app-version.entity.ts
│   │   │   └── app-version-package.entity.ts
│   │   ├── app/
│   │   │   ├── update.controller.ts
│   │   │   ├── app-update.service.ts
│   │   │   └── dto/
│   │   └── admin/
│   │       ├── app-version.controller.ts
│   │       ├── app-version.service.ts
│   │       ├── app-version-package.controller.ts
│   │       ├── app-version-package.service.ts
│   │       └── dto/
│   │
│   ├── analytics/
│   │   ├── analytics.module.ts
│   │   └── admin/
│   │       ├── analytics.controller.ts
│   │       ├── analytics.service.ts
│   │       └── dto/
│   │
│   └── file/
│       ├── file.module.ts
│       ├── app/
│       │   └── file.controller.ts
│       └── admin/
│           └── file.controller.ts
│
├── gateway/                          (保持不变，更新 imports)
├── langchain/                        (保持不变)
├── food-pipeline/                    (保持不变，更新 imports)
├── health/                           (保持不变)
├── compress/                         (保持不变)
├── storage/                          (保持不变)
├── common/                           (保持不变)
├── scripts/                          (保持不变)
└── migrations/                       (保持不变)
```

---

## 附录 B：重构后 app.module.ts 最终形态

```typescript
import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
// 基础设施
import { CoreModule } from './core/core.module';
import { StorageModule } from './storage/storage.module';
// 业务模块
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { FoodModule } from './modules/food/food.module';
import { DietModule } from './modules/diet/diet.module';
import { CoachModule } from './modules/coach/coach.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { ClientModule } from './modules/client/client.module';
import { ProviderModule } from './modules/provider/provider.module';
import { AppVersionModule } from './modules/app-version/app-version.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { FileModule } from './modules/file/file.module';
// 系统服务
import { GatewayModule } from './gateway/gateway.module';
import { LangChainModule } from './langchain/langchain.module';
import { FoodPipelineModule } from './food-pipeline/food-pipeline.module';
import { HealthModule } from './health/health.module';
import { CompressModule } from './compress/compress.module';
// 全局
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter';
import { ResponseInterceptor } from './core/interceptors/response.interceptor';
import { LoggerMiddleware } from './core/middlewares/logger.middleware';

@Module({
  imports: [
    // 基础设施
    CoreModule,
    StorageModule,
    // 业务模块（12个）
    AuthModule,
    UserModule,
    FoodModule,
    DietModule,
    CoachModule,
    GamificationModule,
    RbacModule,
    ClientModule,
    ProviderModule,
    AppVersionModule,
    AnalyticsModule,
    FileModule,
    // 系统服务
    GatewayModule,
    LangChainModule,
    FoodPipelineModule,
    HealthModule,
    CompressModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
```
