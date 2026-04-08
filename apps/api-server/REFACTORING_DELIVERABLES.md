# 系统重构交付文档

## 一、项目结构总览 (122 files)

```
apps/api-server/src/
├── app.module.ts                           # 根模块 → 导入 Infrastructure + 9 Domain Modules
├── main.ts                                 # 入口 → Winston + ValidationPipe + CORS + Swagger
│
├── shared/                                 # 共享层 (14 files)
│   ├── enums/                              # GoalType, ActivityLevel, MealType, Discipline
│   ├── constants/                          # nutrition, profile, food 常量
│   ├── interfaces/                         # ScoredFood, WeightVector, UserContext
│   └── utils/                              # math (gaussian, sigmoid, betaSample), date
│
├── infrastructure/                         # 基础设施层 (17 files)
│   ├── config/                             # ConfigModule (Joi校验) + Config接口
│   ├── database/                           # TypeORM (autoLoadEntities) + DataSource (CLI)
│   ├── storage/                            # S3 StorageService (@Global)
│   ├── ai-gateway/                         # OpenRouter适配器 + AiGatewayService (@Global)
│   ├── health/                             # /health, /health/ready, /health/live
│   ├── common/                             # AllExceptionsFilter, ResponseInterceptor, Logger, Decorators
│   ├── logger/                             # Winston (console + file)
│   ├── swagger/                            # Swagger (dual auth: app-jwt + admin-jwt)
│   └── infrastructure.module.ts            # 根基础设施,提供 APP_FILTER + APP_INTERCEPTOR
│
└── modules/                                # 领域模块层 (91 files)
    ├── auth/          (18 files)           # 双JWT认证 + RBAC权限
    ├── food/          (12 files)           # 食物库 + 翻译/来源/冲突/区域
    ├── user-profile/  (7 files)            # 用户画像 + 行为画像
    ├── nutrition/     (8 files)            # 饮食记录 + 10维营养评分
    ├── recommendation/(7 files)            # 3阶段推荐 (Recall→Ranking→Re-ranking)
    ├── meal-plan/     (4 files)            # 每日膳食计划
    ├── coach/         (6 files)            # AI教练对话
    ├── gamification/  (8 files)            # 成就 + 挑战
    └── admin/         (6 files)            # App版本管理
```

## 二、文档→代码映射表

### SYSTEM_REFACTORING.md → 架构实现

| 文档要求 | 代码位置 | 状态 |
|---------|---------|------|
| 三层架构 (Shared, Infrastructure, Domain) | `shared/`, `infrastructure/`, `modules/` | ✅ |
| 2个God Module → 8+领域模块 | `modules/` 下9个独立模块 | ✅ |
| 移除 LangChain/Compress/FoodPipeline | 已删除，不存在 | ✅ |
| autoLoadEntities | `infrastructure/database/database.module.ts` | ✅ |
| 只保留 OpenRouter | `infrastructure/ai-gateway/adapters/openrouter.adapter.ts` | ✅ |
| @Global AiGateway/Storage | `ai-gateway.module.ts`, `storage.module.ts` | ✅ |
| DAG依赖顺序 | Auth←UserProfile←Recommendation 等 | ✅ |

### INTELLIGENT_DIET_SYSTEM_V3.md → 核心系统

| 文档要求 | 代码位置 | 状态 |
|---------|---------|------|
| 10维营养评分 | `nutrition/services/nutrition-scoring.service.ts` | ✅ |
| 3阶段推荐 (Recall→Ranking→Re-ranking) | `recommendation/services/recommendation.service.ts` | ✅ |
| Thompson Sampling (Beta分布) | `recommendation/services/recommendation.service.ts` + `shared/utils/math.utils.ts` | ✅ |
| 4种目标权重 (fat_loss/muscle_gain/health/habit) | `shared/constants/nutrition.constants.ts` BASE_WEIGHTS | ✅ |
| 餐次权重修正 | `shared/constants/nutrition.constants.ts` MEAL_WEIGHT_MODIFIERS | ✅ |
| 6条惩罚规则 | `shared/constants/nutrition.constants.ts` PENALTY_RULES | ✅ |
| AI教练对话 | `coach/services/coach.service.ts` | ✅ |

### USER_PROFILING_SYSTEM.md → 用户画像

| 文档要求 | 代码位置 | 状态 |
|---------|---------|------|
| 4步引导流程 | `shared/constants/profile.constants.ts` ONBOARDING_STEPS | ✅ |
| Mifflin-St Jeor公式 | `user-profile/services/user-profile.service.ts` calculateCalorieGoal | ✅ |
| 活动系数 (1.2~1.725) | `shared/constants/profile.constants.ts` ACTIVITY_FACTORS | ✅ |
| 目标+速度赤字乘数 | `shared/constants/profile.constants.ts` DEFICIT_MULTIPLIERS | ✅ |
| 行为画像 (打卡/连续/合规率) | `user-profile/entities/user-behavior-profile.entity.ts` | ✅ |
| 完成度计算 | `user-profile/services/user-profile.service.ts` getProfileCompleteness | ✅ |

### NUTRITION_OPTIMIZATION.md → 营养优化

| 文档要求 | 代码位置 | 状态 |
|---------|---------|------|
| 10个评分维度 | `nutrition-scoring.service.ts` calculate10Dimensions | ✅ |
| calorieEfficiency | sigmoid函数, 偏差率计算 | ✅ |
| macroBalance | 四分位方差计算 | ✅ |
| nutrientDensity | NRF (正面-负面) | ✅ |
| satiety | 蛋白质+纤维+水分加权 | ✅ |
| quality | 质量评分直通 | ✅ |
| processingPenalty | 加工惩罚 (100-超加工扣分) | ✅ |
| glycemicControl | GI/GL指数评分 | ✅ |
| inflammationIndex | 抗炎/促炎标签计数 | ✅ |
| diversity | 品类覆盖统计 | ✅ |
| budgetFit | 预算适配 (价格/卡路里效率) | ✅ |

### RECOMMENDATION_ENGINE_OPTIMIZATION.md → 推荐引擎

| 文档要求 | 代码位置 | 状态 |
|---------|---------|------|
| 3阶段Pipeline | `recommendation.service.ts` recommend() | ✅ |
| Recall: 餐次+限制过滤 | recall() 方法 | ✅ |
| Ranking: 10维加权评分 | ranking via scoreFoodForUser | ✅ |
| Re-ranking: Thompson Sampling | rerank() 方法，Beta(α,β) | ✅ |
| 70% score + 30% Thompson | rerank() 混合公式 | ✅ |
| 反馈闭环 (α/β更新) | submitFeedback() accepted→α++, skipped→β++ | ✅ |
| AI决策日志 | `ai-decision-log.entity.ts` + logDecision() | ✅ |

## 三、API路由总览

| 模块 | 前缀 | 认证 | 主要端点 |
|------|------|------|---------|
| Auth (App) | `api/app/auth` | Public | login/anonymous, login/phone, register/email, profile |
| Auth (Admin) | `api/admin/auth` | admin-jwt | login, profile |
| Food (App) | `api/app/food` | Public/app-jwt | search, :id |
| Food (Admin) | `api/admin/food` | admin-jwt | CRUD |
| Profile | `api/app/profile` | app-jwt | profile, onboarding, behavior, completeness |
| Nutrition | `api/app/nutrition` | app-jwt | record, records, summary |
| Recommendation | `api/app/recommendation` | app-jwt | GET /, POST /feedback |
| Meal Plan | `api/app/meal-plan` | app-jwt | today, generate, adjust |
| Coach | `api/app/coach` | app-jwt | conversations, messages |
| Gamification | `api/app/gamification` | app-jwt | achievements, challenges, join, progress |
| App Version | `api/admin/app-versions` | admin-jwt | CRUD, publish, archive, check-update (Public) |
| Health | `health/*` | Public | check, ready, live |

## 四、Entity 统计 (28个实体)

| 模块 | 实体 | 表名 |
|------|------|------|
| Auth | AppUser, AdminUser, Role, Permission, RolePermission, UserRole, PermissionTemplate | app_users, admin_users, roles, permissions, role_permissions, user_roles, permission_templates |
| Food | FoodLibrary, FoodTranslation, FoodSource, FoodChangeLog, FoodConflict, FoodRegionalInfo | food_library, food_translations, food_sources, food_change_logs, food_conflicts, food_regional_info |
| UserProfile | UserProfile, UserBehaviorProfile | user_profiles, user_behavior_profiles |
| Nutrition | FoodRecord, DailySummary | food_records, daily_summaries |
| Recommendation | RecommendationFeedback, AiDecisionLog | recommendation_feedbacks, ai_decision_logs |
| MealPlan | DailyPlan | daily_plans |
| Coach | CoachConversation, CoachMessage | coach_conversations, coach_messages |
| Gamification | Achievement, UserAchievement, Challenge, UserChallenge | achievements, user_achievements, challenges, user_challenges |
| Admin | AppVersion, AppVersionPackage | app_versions, app_version_packages |

## 五、核心算法清单

### 1. 10维营养评分算法
- 文件: `modules/nutrition/services/nutrition-scoring.service.ts`
- 方法: `scoreFoodForUser(food, goal, mealType, dailyCalorieGoal, consumed) → ScoredFood`
- 核心: `calculate10Dimensions()` → 10维度0-100分 → 加权求和 → `applyPenalties()` → 最终分数

### 2. Thompson Sampling 推荐
- 文件: `modules/recommendation/services/recommendation.service.ts`
- 方法: `rerank(scored, userId)` → Beta(α,β)采样 → 0.7×score + 0.3×thompsonSample
- 依赖: `shared/utils/math.utils.ts` → `betaSample()` (Marsaglia-Tsang gamma sampling)

### 3. Mifflin-St Jeor 热量计算
- 文件: `modules/user-profile/services/user-profile.service.ts`
- 方法: `calculateCalorieGoal(profile)` → BMR × ActivityFactor × DeficitMultiplier

## 六、运行指南

```bash
# 1. 安装依赖
cd /path/to/wuwei-AI
pnpm install

# 2. 配置环境
cp apps/api-server/.env.example apps/api-server/.env
# 编辑 .env 填入数据库和API密钥

# 3. 启动数据库
# 确保 PostgreSQL 运行在 5432 端口

# 4. 启动开发服务器
pnpm --filter api-server dev

# 5. 访问
# API: http://localhost:3000
# Swagger: http://localhost:3000/api/docs
# Health: http://localhost:3000/health
```

## 七、一致性检查

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 实体列字段完整 | ✅ | 所有28个实体1:1复制原有列定义 |
| 枚举值一致 | ✅ | GoalType, ActivityLevel, MealType等无遗漏 |
| 模块依赖DAG无环 | ✅ | Auth→UserProfile→Recommendation, Food→Nutrition→MealPlan, Coach←AiGateway(Global) |
| Import路径正确 | ✅ | 所有entity引用已更新为 modules/*/entities/ |
| Swagger双认证 | ✅ | app-jwt + admin-jwt 分别配置 |
| autoLoadEntities | ✅ | TypeOrmModule.forRoot({autoLoadEntities:true}) |
| 旧代码清除 | ✅ | admin/, app/, core/, entities/ 等已删除 |
| 全局模块 | ✅ | ConfigModule, AiGateway, Storage 均 @Global |
| 响应格式统一 | ✅ | ResponseInterceptor → {code, data, message, success} |
| 异常过滤 | ✅ | AllExceptionsFilter 全局注册 |
