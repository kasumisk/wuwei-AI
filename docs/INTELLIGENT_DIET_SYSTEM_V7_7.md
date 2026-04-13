# V7.7 系统架构文档 — 智能饮食推荐系统

> 本文档描述 V7.7 版本的完整后端架构现状，作为 V7.8 升级的基线参考。
> V7.6-V7.7 聚焦于 **目录结构重组** 和 **Facade 拆分**，无新功能引入。

---

## 一、系统概览

### 1.1 技术栈

| 层级   | 技术选型                                |
| ------ | --------------------------------------- |
| 运行时 | Node.js + NestJS v11                    |
| 数据库 | PostgreSQL + pgvector                   |
| ORM    | Prisma                                  |
| 缓存   | Redis (L2) + 内存 LRU (L1) + 请求级缓存 |
| 队列   | BullMQ (7 个队列)                       |
| AI     | LangChain + 多 Provider                 |
| 认证   | JWT + OAuth (Google/Apple/WeChat)       |
| 监控   | Prometheus + 自定义 Metrics             |
| 构建   | pnpm monorepo + Turborepo               |

### 1.2 Monorepo 结构

```
wuwei-AI/
├── apps/
│   ├── api-server/     # NestJS 后端（核心）
│   ├── web/            # Next.js 16 Web 端
│   ├── admin/          # Vite + React 19 管理后台
│   └── miniapp/        # Taro 微信小程序
├── packages/
│   ├── constants/      # 共享常量
│   ├── shared/         # 共享工具
│   ├── types/          # 共享类型
│   └── utils/          # 共享工具函数
└── docs/               # 系统文档
```

---

## 二、后端模块架构

### 2.1 业务模块（17 个）

| 模块         | 职责                               | 状态    |
| ------------ | ---------------------------------- | ------- |
| Auth         | JWT/OAuth 认证、匿名用户           | ✅ 稳定 |
| User         | 用户管理、5 层画像系统、目标管理   | ✅ 成熟 |
| Food         | 食物库管理、AI 分析、食物记录      | ✅ 成熟 |
| Diet         | 推荐引擎、日计划、周计划、营养评分 | ✅ 核心 |
| Coach        | AI 饮食教练对话                    | ✅ 稳定 |
| Recipe       | 菜谱管理、食材关联                 | ✅ 稳定 |
| Gamification | 打卡、成就、徽章、排行榜           | ✅ 稳定 |
| RBAC         | 管理员角色权限                     | ✅ 稳定 |
| Strategy     | 推荐策略管理、A/B 测试             | ✅ 稳定 |
| Subscription | 订阅、Apple IAP、微信支付          | ✅ 稳定 |
| Analytics    | 数据分析、趋势统计                 | ✅ 稳定 |
| Notification | 通知推送                           | ✅ 基础 |
| FeatureFlag  | 功能开关                           | ✅ 稳定 |
| FoodPipeline | 食物数据清洗、外部数据源导入       | ✅ 稳定 |
| Client       | API 客户端注册                     | ✅ 稳定 |
| Provider     | AI Provider 管理                   | ✅ 稳定 |
| AppVersion   | 客户端版本管理                     | ✅ 稳定 |

### 2.2 基础设施模块

| 模块              | 职责                            |
| ----------------- | ------------------------------- |
| Core/Prisma       | 数据库连接池管理                |
| Core/Redis        | 二级缓存服务                    |
| Core/BullMQ       | 7 个异步队列                    |
| Core/Events       | NestJS EventEmitter2 事件总线   |
| Core/Guards       | 12 个守卫（Auth/Rate/Throttle） |
| Core/Middleware   | 3 个中间件                      |
| Core/Interceptors | 2 个拦截器                      |

---

## 三、用户画像系统（5 层架构）

### 3.1 画像层级

```
┌─────────────────────────────────────────────┐
│           EnrichedProfileContext             │
│  ┌───────────┬──────────┬──────────────┐    │
│  │ Declared  │ Inferred │  Observed    │    │
│  │ (用户填写) │ (系统推算)│ (行为聚合)   │    │
│  └───────────┴──────────┴──────────────┘    │
│  ┌───────────┬──────────────────────────┐    │
│  │ ShortTerm │     Contextual           │    │
│  │ (Redis 7天)│ (实时场景)               │    │
│  └───────────┴──────────────────────────┘    │
│  ┌──────────────────────────────────────┐    │
│  │       LifestyleProfile               │    │
│  │ (V6.5: 口味/菜系/预算/技能/家庭)     │    │
│  └──────────────────────────────────────┘    │
│  ┌──────────────────────────────────────┐    │
│  │     DomainProfiles (V7.0)            │    │
│  │ NutritionProfile + PreferencesProfile │    │
│  └──────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### 3.2 画像层数据来源

| 层级       | 存储       | 更新方式         | TTL  |
| ---------- | ---------- | ---------------- | ---- |
| Declared   | PostgreSQL | 用户主动填写     | 永久 |
| Inferred   | PostgreSQL | 定时 Cron 推算   | 永久 |
| Observed   | PostgreSQL | 定时 Cron 聚合   | 永久 |
| ShortTerm  | Redis      | 事件驱动实时更新 | 7 天 |
| Contextual | 无（计算） | 每次推荐实时计算 | 无   |

### 3.3 user_profiles 模型核心字段

| 字段                       | 类型        | 说明                                | 版本     |
| -------------------------- | ----------- | ----------------------------------- | -------- |
| gender                     | Varchar     | 性别                                | V1       |
| birth_year                 | Int         | 出生年份                            | V1       |
| height_cm                  | Decimal     | 身高 cm                             | V1       |
| weight_kg                  | Decimal     | 体重 kg                             | V1       |
| target_weight_kg           | Decimal     | 目标体重                            | V1       |
| **activity_level**         | **Enum**    | **sedentary/light/moderate/active** | **V1**   |
| daily_calorie_goal         | Int         | 每日热量目标 kcal                   | V1       |
| goal                       | Varchar     | 健康目标                            | V1       |
| goal_speed                 | Varchar     | 目标速度                            | V1       |
| body_fat_percent           | Decimal     | 体脂率                              | V1       |
| meals_per_day              | Int         | 每日用餐次数                        | V1       |
| takeout_frequency          | Varchar     | 外卖频率                            | V1       |
| can_cook                   | Boolean     | 是否会做饭                          | V1       |
| food_preferences           | Json        | 口味偏好                            | V1       |
| dietary_restrictions       | Json        | 饮食禁忌                            | V1       |
| allergens                  | Json        | 过敏原                              | V2       |
| health_conditions          | Json        | 健康状况                            | V2       |
| exercise_profile           | Json        | 运动档案                            | V3       |
| exercise_schedule          | Json        | 每周运动计划                        | V6.3     |
| cooking_skill_level        | Varchar     | 烹饪技能                            | V3       |
| taste_intensity            | Json        | 口味浓淡偏好                        | V3       |
| cuisine_preferences        | Json        | 菜系偏好                            | V3       |
| budget_level               | Varchar     | 预算等级                            | V3       |
| kitchen_profile            | JsonB       | 厨房设备画像                        | V7.1     |
| sleep_quality              | Text        | 睡眠质量                            | V6.6     |
| stress_level               | Text        | 压力水平                            | V6.6     |
| **exercise_intensity**     | **Varchar** | **none/light/moderate/high**        | **V6.8** |
| alcohol_frequency          | Varchar     | 饮酒频率                            | V6.8     |
| compound_goal              | JsonB       | 复合目标                            | V7.0     |
| recommendation_preferences | Json        | 推荐偏好配置                        | V6.5     |

#### ⚠️ 冗余分析：activity_level vs exercise_intensity

| 维度     | activity_level                            | exercise_intensity                    |
| -------- | ----------------------------------------- | ------------------------------------- |
| 引入版本 | V1                                        | V6.8                                  |
| 类型     | Enum（数据库约束）                        | Varchar（无约束）                     |
| 值域     | sedentary/light/moderate/active           | none/light/moderate/high              |
| 语义     | 整体活动水平（含日常活动+运动）           | 运动专项强度                          |
| 使用处   | **30 处**（TDEE 计算、AI prompt、仪表盘） | **10 处**（生活方式评分、管道上下文） |
| 重叠度   | **高** — 值域几乎相同，语义边界模糊       | 同左                                  |

**结论**：存在冗余。两个字段的值域和语义高度重叠。`exercise_intensity` 的"运动强度"实际上可通过 `exercise_profile`（含运动类型+频率+时长）更精确地推断，`activity_level` 足以覆盖 TDEE 计算需求。

---

## 四、推荐引擎架构

### 4.1 三阶段管道

```
┌─────────────────────────────────────────────────────────────────┐
│                    RecommendationEngineService                   │
│                       (薄门面, ~5 DI)                            │
│  ┌──────────────────┬─────────────────┬──────────────────┐      │
│  │ MealRecommend    │ ScenarioRecommend│ DailyPlan       │      │
│  │ Facade           │ Facade           │ Facade          │      │
│  └──────┬───────────┴────────┬────────┴────────┬────────┘      │
│         │                    │                  │               │
│  ┌──────▼────────────────────▼──────────────────▼───────┐      │
│  │              PipelineBuilderService                    │      │
│  │  ┌──────────┐   ┌───────────┐   ┌─────────────┐      │      │
│  │  │ Recall   │──▶│   Rank    │──▶│   Rerank    │      │      │
│  │  │ (三路)   │   │ (14维评分) │   │ (健康修正)  │      │      │
│  │  └──────────┘   └───────────┘   └─────────────┘      │      │
│  └──────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 召回阶段（Recall）

三路召回 + 合并去重：

| 召回路       | 来源              | 说明                |
| ------------ | ----------------- | ------------------- |
| 规则召回     | FoodFilterService | 品类+标签+渠道过滤  |
| 语义召回     | SemanticRecall    | pgvector 向量相似度 |
| 协同过滤召回 | CFRecall          | 相似用户行为模式    |

### 4.3 排序阶段（Rank）— 14 维评分

14 个评分维度：

```
calories, protein, carbs, fat, quality, satiety, glycemic,
nutrientDensity, inflammation, fiber, seasonality,
executability, popularity, acquisition
```

10 个 ScoringFactor（评分链）：

1. RuleWeightFactor — 规则权重
2. PreferenceSignalFactor — 偏好信号
3. PopularityFactor — 大众化评分
4. RegionalBoostFactor — 地域加分
5. SceneContextFactor — 场景上下文
6. CollaborativeFilteringFactor — 协同过滤
7. ReplacementFeedbackFactor — 替换反馈
8. AnalysisProfileFactor — 分析画像
9. LifestyleBoostFactor — 生活方式加分
10. ShortTermProfileFactor — 短期行为加分

### 4.4 重排阶段（Rerank）

- HealthModifierEngineService — 5 层健康惩罚/奖励
- LifestyleScoringAdapterService — 生活方式营养素优先级调整
- GlobalOptimizer — 全局营养均衡优化
- MultiObjectiveOptimizer — 多目标帕累托优化

### 4.5 场景系统

**12 种场景类型**：quick_breakfast, leisurely_brunch, office_lunch, home_cooking, eating_out, convenience_meal, canteen_meal, post_workout, late_night_snack, family_dinner, meal_prep, general

**6 种渠道**：home_cook, restaurant, delivery, convenience, canteen, unknown

**4 档现实策略**（RealismLevel）：strict, normal, relaxed, off

### 4.6 策略系统（双层）

| 层级         | 来源                   | 粒度       |
| ------------ | ---------------------- | ---------- |
| 宏观行为策略 | RecommendationStrategy | 4 预设     |
| 细粒度策略   | Strategy 表（V6 引擎） | 可配置权重 |

宏观策略：explore（探索新食物）/ exploit（偏好优先）/ strict_health（严格健康）/ scene_first（场景优先）

---

## 五、缓存架构（三级）

```
请求 → L0 请求级缓存 → L1 内存 LRU → L2 Redis → 数据库
```

| 级别 | 实现               | TTL          | 用途            |
| ---- | ------------------ | ------------ | --------------- |
| L0   | RequestScopedCache | 请求生命周期 | 同一请求去重    |
| L1   | 内存 LRU           | 5-30 分钟    | 热点数据        |
| L2   | Redis              | 小时-天级    | 画像/推荐预计算 |

---

## 六、数据库模型摘要（核心表）

### 6.1 用户域

- `app_users` — 用户账户
- `user_profiles` — 声明画像（40+ 字段）
- `user_inferred_profiles` — 推断画像（BMR/TDEE/segment/churnRisk）
- `user_behavior_profiles` — 行为画像（compliance/streak/binge/portion）
- `profile_snapshots` — 画像变更快照

### 6.2 食物域

- `foods` — 食物库（100+ 字段，含宏量/微量/GI/GL/质量/饱腹/嵌入向量）
- `food_records` — 用户进食记录
- `food_analysis_record` — AI 食物分析记录
- `food_candidate` — 未验证食物候选
- `food_regional_info` — 区域化信息（流行度/价格/季节性）
- `food_translations` — 食物翻译

### 6.3 推荐域

- `daily_plans` — 日计划
- `daily_plan_items` — 日计划食物项（V7.3 新增，结构化）
- `daily_summaries` — 每日营养汇总
- `precomputed_recommendations` — 预计算推荐缓存
- `recommendation_feedbacks` — 推荐反馈
- `feedback_details` — 多维度反馈详情
- `recommendation_traces` — 管道追踪快照
- `recommendation_executions` — 推荐执行追踪（推荐 vs 实际）
- `replacement_patterns` — A→B 食物替换模式

### 6.4 策略域

- `strategy` — 策略配置（scope/config/context_condition）
- `strategy_assignment` — 用户策略绑定
- `strategy_tuning_log` — 策略调优日志
- `ab_experiments` — A/B 实验

### 6.5 菜谱域

- `recipes` — 菜谱定义
- `recipe_ingredients` — 菜谱食材
- `recipe_translations` — 菜谱翻译
- `recipe_ratings` — 菜谱评分

---

## 七、V7.6-V7.7 变更记录

### V7.6（ProfileAggregator Facade）

- **新增 `ProfileAggregatorService`** — 将 RecommendationEngine 中 9 个画像 DI 聚合为单一 Facade
  - 减少 Engine 构造函数参数（31 → 23 DI）
  - 暴露 3 个方法：aggregateForRecommendation / aggregateForScenario / getShortTermProfile
- **新增 `StrategyResolverFacadeService`** — 策略解析 Facade

### V7.7（目录结构重组）

- **Diet 模块**：services/dto/listeners/processors 分子目录；recommendation 拆分为 14 个子目录
- **Food 模块**：controllers/services/dto/listeners/processors/types 分子目录
- **Subscription 模块**：controllers/services/payment/guards/decorators/listeners 分子目录
- **User 模块**：controllers + services/profile + services/goal + cron/listeners 分子目录
- **FoodPipeline 模块**：controllers + services/fetchers + services/ai + services/processing 分子目录
- **Scripts**：seeds/ + tools/ 分子目录

**总计**：218 个文件重新组织，零逻辑变更。

---

## 八、已知问题与技术债

| #   | 问题                                      | 严重度 | 说明                                                   |
| --- | ----------------------------------------- | ------ | ------------------------------------------------------ |
| 1   | activity_level 与 exercise_intensity 冗余 | 中     | 值域和语义高度重叠，增加认知负担                       |
| 2   | 食物种子数据偏原材料                      | 高     | 缺少大众化菜品（如番茄炒蛋、宫保鸡丁等常见菜）         |
| 3   | 策略种子数据不完整                        | 中     | 仅 4 个预设策略，场景覆盖不足                          |
| 4   | 食物分类缺少 fat/condiment 种子数据       | 中     | category 覆盖不全                                      |
| 5   | food_form 字段使用不足                    | 低     | ingredient/dish/semi_prepared 分类存在但推荐未充分利用 |
| 6   | 推荐结果不够贴近现实                      | 高     | 常推荐用户难获取或不常见的食物                         |
| 7   | 国际化种子数据缺失                        | 低     | food_translations 表为空                               |
| 8   | 部分 `as any` 残留                        | 中     | V7.5 后仍有少量 `as any`                               |
