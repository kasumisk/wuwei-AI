# API-Server 模块化重构方案

> **核心原则**：所有接口的 path / 入参 / 出参 **零变更**，前端无感知。

---

## 一、现状分析

### 1.1 系统概况

| 维度                | 数值                               |
| ------------------- | ---------------------------------- |
| 模块 (Module)       | 9 个                               |
| 控制器 (Controller) | 23 个                              |
| 服务 (Service)      | 59 个                              |
| 实体 (Entity)       | 50+ 个                             |
| 路由 (Handler)      | 120+ 个                            |
| 认证策略            | 3 套 (AdminJWT / AppJWT / API Key) |

### 1.2 当前目录结构

```
src/
├── admin/          # Admin 后台管理 ✅ 隔离较好
├── app/            # App 用户功能   ⚠️ 内部耦合严重
├── core/           # 基础设施       ✅ 合理
├── gateway/        # AI 网关        ✅ 独立
├── food-pipeline/  # 食物数据管线   ✅ 独立
├── health/         # 健康检查       ✅ 独立
├── langchain/      # LangChain RAG  ✅ 独立
├── compress/       # 图片压缩       ✅ 独立
├── storage/        # 文件存储       ✅ 全局模块
├── entities/       # 实体层         ⚠️ 平铺无分类
└── migrations/     # 数据库迁移     ✅ 正常
```

### 1.3 已识别问题

| 编号 | 问题                                                                                                                 | 严重程度 | 位置                                            |
| ---- | -------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------- |
| P1   | **FoodController 超载**：1 个控制器挂 20 个路由，职责混杂食物记录 / 日计划 / 行为 / 营养 / 画像                      | 🔴 严重  | `app/controllers/food.controller.ts`            |
| P2   | **RecommendationEngineService "上帝服务"**：~1000 行，包揽约束生成 / 评分 / 过滤 / 组装 / 场景推荐                   | 🔴 严重  | `app/services/recommendation-engine.service.ts` |
| P3   | **AnalyzeService 过重**：~800 行，混合 AI 调用 / Prompt 模板 / 用户上下文 / 缓存 / 评分覆盖                          | 🔴 严重  | `app/services/analyze.service.ts`               |
| P4   | **FoodService 循环依赖**：`forwardRef(() => UserProfileService)`，说明职责划分不清                                   | 🔴 严重  | `app/services/food.service.ts`                  |
| P5   | **Admin ContentManagement 越界**：Admin 服务直接注入 App 用户数据表（FoodRecord / DailyPlan / CoachConversation 等） | 🟡 中等  | `admin/services/content-management.service.ts`  |
| P6   | **FoodController 编排逻辑**：`analyzeImage` 编排 StorageService + AnalyzeService，controller 不应做编排              | 🟡 中等  | `app/controllers/food.controller.ts`            |
| P7   | **Entity 平铺无分组**：50+ 实体文件全在 `entities/` 下，无业务领域区分                                               | 🟡 中等  | `entities/`                                     |
| P8   | **GamificationController 挂在 `/api/app`**：成就 / 挑战路由混在 app 根前缀下                                         | 🟢 低    | `app/controllers/gamification.controller.ts`    |

---

## 二、重构方案

### 2.1 目标结构（增量演进，不重写）

```
src/
├── admin/                      # ✅ 基本保持不变
│   ├── admin.module.ts
│   ├── admin.controller.ts     # /auth/*
│   ├── controllers/            # /api/admin/*
│   ├── services/
│   ├── guards/
│   ├── strategies/
│   └── dto/
│
├── app/                        # ⭐ 主要重构区域
│   ├── app-client.module.ts    # 统一注册入口
│   ├── app.controller.ts       # /api/app/auth/*
│   │
│   ├── controllers/
│   │   ├── food-record.controller.ts     # 从 food.controller 拆出
│   │   ├── food-analyze.controller.ts    # 从 food.controller 拆出
│   │   ├── daily-plan.controller.ts      # 从 food.controller 拆出
│   │   ├── behavior.controller.ts        # 从 food.controller 拆出
│   │   ├── nutrition.controller.ts       # 从 food.controller 拆出
│   │   ├── food-library.controller.ts    # 不变
│   │   ├── user-profile.controller.ts    # 不变
│   │   ├── coach.controller.ts           # 不变
│   │   ├── gamification.controller.ts    # 不变
│   │   ├── update.controller.ts          # 不变
│   │   └── file.controller.ts            # 不变
│   │
│   ├── services/
│   │   ├── app-auth.service.ts                  # 不变
│   │   ├── food-record.service.ts               # 从 food.service 拆出 CRUD
│   │   ├── food-analyze-orchestrator.service.ts  # 从 controller + analyze.service 拆出编排
│   │   ├── food-analyze.service.ts              # 保留纯 AI 分析逻辑
│   │   ├── daily-summary.service.ts             # 从 food.service 拆出汇总
│   │   ├── daily-plan.service.ts                # 不变
│   │   ├── user-profile.service.ts              # 不变
│   │   ├── coach.service.ts                     # 不变
│   │   ├── behavior.service.ts                  # 不变
│   │   ├── gamification.service.ts              # 不变
│   │   ├── nutrition-score.service.ts           # 不变
│   │   ├── food-library.service.ts              # 不变
│   │   ├── profile-inference.service.ts         # 不变
│   │   ├── profile-cache.service.ts             # 不变
│   │   ├── profile-cron.service.ts              # 不变
│   │   ├── collection-trigger.service.ts        # 不变
│   │   ├── recommendation/                       # ⭐ 从 recommendation-engine.service 拆出
│   │   │   ├── constraint-generator.service.ts   # 用户画像 → 约束条件
│   │   │   ├── food-scorer.service.ts            # 多维评分（高斯能量 / 蛋白质 / 碳水）
│   │   │   ├── food-filter.service.ts            # 过敏原 / 标签过滤
│   │   │   ├── meal-assembler.service.ts         # 餐食组装 + 多样化
│   │   │   └── recommendation-engine.service.ts  # 精简为编排入口
│   │   └── ...
│   │
│   ├── guards/
│   ├── strategies/
│   └── dto/
│
├── shared/                      # ⭐ 新增：跨模块共享层
│   ├── shared.module.ts
│   ├── services/
│   │   └── app-data-query.service.ts   # Admin 查 App 数据的统一入口
│   └── interfaces/
│       └── user-context.interface.ts   # 用户上下文标准接口
│
├── entities/                    # ⭐ 增加分组子目录 (可选, 用 barrel export)
│   ├── index.ts                 # 统一导出
│   ├── user/                    # AppUser, UserProfile, UserBehaviorProfile ...
│   ├── food/                    # FoodRecord, FoodLibrary, DailySummary ...
│   ├── coaching/                # CoachConversation, CoachMessage ...
│   ├── gamification/            # Achievement, Challenge ...
│   ├── admin/                   # AdminUser, Role, Permission ...
│   ├── gateway/                 # Client, Provider, ModelConfig ...
│   └── system/                  # AppVersion, AiDecisionLog ...
│
├── core/           # 不变
├── gateway/        # 不变
├── food-pipeline/  # 不变
├── health/         # 不变
├── langchain/      # 不变
├── compress/       # 不变
└── storage/        # 不变
```

---

## 三、分步执行计划

### Phase 1：FoodController 拆分（最高优先级）

**风险等级**：🟡 中等（路由多但逻辑在 service 层）

**约束**：所有接口 URL 严格不变，靠 `@Controller('api/app/food')` 前缀 + 具体路由装饰器保证。

#### Step 1.1：拆出 FoodRecordController

**原位置**：`food.controller.ts` 中的 6 个路由

| 原路由                                    | 迁移目标               |
| ----------------------------------------- | ---------------------- |
| `POST /api/app/food/records`              | `FoodRecordController` |
| `POST /api/app/food/records/from-library` | `FoodRecordController` |
| `GET /api/app/food/records/today`         | `FoodRecordController` |
| `GET /api/app/food/records`               | `FoodRecordController` |
| `PUT /api/app/food/records/:id`           | `FoodRecordController` |
| `DELETE /api/app/food/records/:id`        | `FoodRecordController` |
| `GET /api/app/food/frequent-foods`        | `FoodRecordController` |

**操作**：

```typescript
// 新文件：app/controllers/food-record.controller.ts
@Controller('api/app/food')
@UseGuards(AppJwtAuthGuard)
export class FoodRecordController {
  // 直接搬运 food.controller.ts 中对应的 handler 方法
  // 注入 FoodService（后续 Phase 2 拆分后改注入 FoodRecordService）

  @Post('records')
  async saveFoodRecord(...) { ... }  // 代码原样搬运

  @Get('records/today')
  async getTodayRecords(...) { ... }

  // ... 其余路由
}
```

#### Step 1.2：拆出 FoodAnalyzeController

| 原路由                       | 迁移目标                |
| ---------------------------- | ----------------------- |
| `POST /api/app/food/analyze` | `FoodAnalyzeController` |

**操作要点**：

- 新建 `FoodAnalyzeOrchestratorService`，把 controller 里的 storage + analyze 编排逻辑下沉
- controller 只调用 `orchestratorService.analyzeAndSave(userId, file)`

#### Step 1.3：拆出 DailyPlanController

| 原路由                                     | 迁移目标              |
| ------------------------------------------ | --------------------- |
| `GET /api/app/food/daily-plan`             | `DailyPlanController` |
| `POST /api/app/food/daily-plan/adjust`     | `DailyPlanController` |
| `POST /api/app/food/daily-plan/regenerate` | `DailyPlanController` |
| `GET /api/app/food/meal-suggestion`        | `DailyPlanController` |

**关键**：`@Controller('api/app/food')` 保持前缀一致。

#### Step 1.4：拆出 BehaviorController

| 原路由                                 | 迁移目标             |
| -------------------------------------- | -------------------- |
| `GET /api/app/food/behavior-profile`   | `BehaviorController` |
| `GET /api/app/food/proactive-check`    | `BehaviorController` |
| `POST /api/app/food/decision-feedback` | `BehaviorController` |

#### Step 1.5：拆出 NutritionController

| 原路由                              | 迁移目标              |
| ----------------------------------- | --------------------- |
| `GET /api/app/food/summary/today`   | `NutritionController` |
| `GET /api/app/food/summary/recent`  | `NutritionController` |
| `GET /api/app/food/nutrition-score` | `NutritionController` |

#### Step 1.6：保留 FoodController（最小化）

重构后 `food.controller.ts` 只保留：

| 路由                        | 说明                     |
| --------------------------- | ------------------------ |
| `GET /api/app/food/profile` | 获取用户画像（向后兼容） |
| `PUT /api/app/food/profile` | 更新用户画像（向后兼容） |

> 这两个 profile 路由是历史遗留，语义上应该在 UserProfileController。但为**保证接口零变更**，继续保留在 `/api/app/food/profile` 路径下，仅内部转发到 UserProfileService。

#### Step 1.7：更新 Module 注册

```typescript
// app-client.module.ts — controllers 数组
controllers: [
  AppAuthController,
  FoodRecordController, // 新增
  FoodAnalyzeController, // 新增
  DailyPlanController, // 新增 (路由前缀 api/app/food)
  BehaviorController, // 新增
  NutritionController, // 新增
  FoodController, // 保留（仅 profile 路由）
  UserProfileController,
  CoachController,
  FoodLibraryController,
  GamificationController,
  AppFileController,
  AppUpdateController,
];
```

**验证方法**：

```bash
# 启动后用 curl 验证每个接口的 path 不变
curl -s http://localhost:3006/api/app/food/records | jq .
curl -s http://localhost:3006/api/app/food/daily-plan | jq .
# ... 全部 20 个路由
```

---

### Phase 2：FoodService 拆分 + 消除循环依赖

**风险等级**：🟡 中等

#### Step 2.1：拆出 FoodRecordService

从 `food.service.ts` 提取纯 CRUD 逻辑：

```
FoodRecordService 职责：
  - saveRecord()
  - getRecords() / getTodayRecords() / getRecordById()
  - updateRecord()
  - deleteRecord()
  - getFrequentFoods()

依赖：FoodRecord Repository, FoodLibrary Repository
```

#### Step 2.2：拆出 DailySummaryService

从 `food.service.ts` 提取汇总逻辑：

```
DailySummaryService 职责：
  - getTodaySummary()
  - getRecentSummaries()
  - updateDailySummary()   ← 营养聚合 + 评分计算

依赖：DailySummary Repository, NutritionScoreService
```

#### Step 2.3：精简 FoodService

重构后 `food.service.ts` 变为薄编排层：

```
FoodService（精简后）职责：
  - analyzeAndSave() — 编排分析 + 保存 + 汇总更新（后续可进一步 Phase 拆到 Orchestrator）
  - getMealSuggestion() — 编排推荐（调用 RecommendationEngine + DailySummaryService）

依赖：FoodRecordService, DailySummaryService, RecommendationEngineService
无需 forwardRef，循环依赖消除
```

#### Step 2.4：消除 forwardRef 循环依赖

```
当前循环：FoodService → UserProfileService → ? → FoodService
解法：FoodService 不再直接依赖 UserProfileService
       改由 Controller 层注入 UserProfileService 传入上下文
       或者通过 DailySummaryService 间接获取 profile 数据
```

---

### Phase 3：RecommendationEngineService 拆分

**风险等级**：🟢 低（内部拆分，对外接口不变）

#### Step 3.1：拆出 ConstraintGeneratorService

```
ConstraintGeneratorService 职责：
  - generateConstraints(userProfile, healthConditions, allergens)
  - 返回标准化 RecommendationConstraints 对象

行数预估：~100 行（从原 ~1000 行抽出）
```

#### Step 3.2：拆出 FoodScorerService

```
FoodScorerService 职责：
  - scoreFood(food, constraints, feedbackWeights)
  - 内部：gaussianEnergyScore / segmentedProteinScore / rangeFatScore / rangeCarbScore
  - macroBalancePenalty / diversityBonus

行数预估：~250 行
```

#### Step 3.3：拆出 FoodFilterService

```
FoodFilterService 职责：
  - filterFoods(foods, constraints, userAllergens)
  - 标签过滤 + 过敏原直匹配

行数预估：~80 行
```

#### Step 3.4：拆出 MealAssemblerService

```
MealAssemblerService 职责：
  - assembleMeal(scoredFoods, mealType, calorieTarget)
  - diversify(selectedFoods, recentFoods)

行数预估：~150 行
```

#### Step 3.5：RecommendationEngineService 变为 Facade

```typescript
// 重构后的 recommendation-engine.service.ts（~150 行）
@Injectable()
export class RecommendationEngineService {
  constructor(
    private readonly constraintGenerator: ConstraintGeneratorService,
    private readonly foodFilter: FoodFilterService,
    private readonly foodScorer: FoodScorerService,
    private readonly mealAssembler: MealAssemblerService,
  ) {}

  // 对外接口签名完全不变
  async recommendMeal(...sameParams) { ... }
  async recommendMealFromPool(...sameParams) { ... }
  async recommendByScenario(...sameParams) { ... }
}
```

---

### Phase 4：Admin ContentManagement 解耦

**风险等级**：🟢 低

#### Step 4.1：创建 AppDataQueryService（共享层）

```typescript
// shared/services/app-data-query.service.ts
@Injectable()
export class AppDataQueryService {
  // 提供 Admin 查看 App 数据的只读接口
  async findFoodRecords(filters): Promise<PaginatedResult<FoodRecord>> { ... }
  async findDailyPlans(filters): Promise<PaginatedResult<DailyPlan>> { ... }
  async findConversations(filters): Promise<PaginatedResult<CoachConversation>> { ... }
  async findFeedback(filters): Promise<PaginatedResult<RecommendationFeedback>> { ... }
  async findAiLogs(filters): Promise<PaginatedResult<AiDecisionLog>> { ... }
}
```

#### Step 4.2：重构 ContentManagementService

```
Before: ContentManagementService 直接注入 8 个 App Repository
After:  ContentManagementService 仅依赖 AppDataQueryService（只读）

效果：Admin ← AppDataQueryService → App Repositories
       Admin 不再直接持有 App 实体的 Repository
```

---

### Phase 5：Entity 分组（可选，低优先级）

将 `entities/` 下的 50+ 文件按业务领域分到子目录，通过 `index.ts` barrel export 保持导入路径 backward compatible：

```
entities/
├── index.ts                    # re-export 所有实体，旧导入路径不变
├── user/
│   ├── app-user.entity.ts
│   ├── user-profile.entity.ts
│   ├── user-behavior-profile.entity.ts
│   ├── user-inferred-profile.entity.ts
│   └── profile-snapshot.entity.ts
├── food/
│   ├── food-record.entity.ts
│   ├── food-library.entity.ts
│   ├── daily-summary.entity.ts
│   ├── daily-plan.entity.ts
│   └── recommendation-feedback.entity.ts
├── coaching/
│   ├── coach-conversation.entity.ts
│   ├── coach-message.entity.ts
│   └── ai-decision-log.entity.ts
├── gamification/
│   ├── achievement.entity.ts
│   ├── user-achievement.entity.ts
│   ├── challenge.entity.ts
│   └── user-challenge.entity.ts
├── admin/
│   ├── admin-user.entity.ts
│   ├── role.entity.ts
│   ├── permission.entity.ts
│   └── ...
└── gateway/
    ├── client.entity.ts
    ├── provider.entity.ts
    └── model-config.entity.ts
```

**兼容方案**：`entities/index.ts` 中 `export * from './user/app-user.entity'` 等，旧的 `import { AppUser } from '../../entities/app-user.entity'` 仍然可用（文件不删，只加子目录拷贝后留 re-export stub）。

---

## 四、执行优先级与风险矩阵

| Phase       | 内容                                  | 优先级 | 风险  | 预估工作量 | 前端影响 |
| ----------- | ------------------------------------- | ------ | ----- | ---------- | -------- |
| **Phase 1** | FoodController 拆分 5→6 个 Controller | 🔴 P0  | 🟡 中 | 2-3 天     | **零**   |
| **Phase 2** | FoodService 拆分 + 消除循环依赖       | 🔴 P0  | 🟡 中 | 2-3 天     | **零**   |
| **Phase 3** | RecommendationEngine 内部拆分         | 🟡 P1  | 🟢 低 | 1-2 天     | **零**   |
| **Phase 4** | Admin ContentManagement 解耦          | 🟡 P1  | 🟢 低 | 1 天       | **零**   |
| **Phase 5** | Entity 目录重组                       | 🟢 P2  | 🟢 低 | 0.5 天     | **零**   |

---

## 五、每个 Phase 的验证清单

### Phase 1 验证

```bash
# 1. 编译通过
cd apps/api-server && npx tsc --noEmit

# 2. 所有接口路径不变（对比前后路由表）
curl http://localhost:3006/api/app/food/records         # 200
curl http://localhost:3006/api/app/food/analyze          # 需 auth
curl http://localhost:3006/api/app/food/daily-plan       # 需 auth
curl http://localhost:3006/api/app/food/behavior-profile # 需 auth
curl http://localhost:3006/api/app/food/summary/today    # 需 auth
curl http://localhost:3006/api/app/food/nutrition-score   # 需 auth
curl http://localhost:3006/api/app/food/profile          # 需 auth

# 3. NestJS 路由表打印（开发时在 main.ts 打印）
const server = app.getHttpServer();
const router = server._events.request._router;
# 确认路由数量和路径完全一致
```

### Phase 2 验证

```bash
# 1. forwardRef 搜索为 0
grep -r "forwardRef" src/app/ --include="*.ts"
# 期望结果：无匹配

# 2. FoodService 行数大幅减少
wc -l src/app/services/food.service.ts
# 期望：< 150 行（从 ~550 行降到）

# 3. 功能回归
# 使用 Postman / miniapp 测试食物记录 CRUD + 日汇总 + 推荐
```

### Phase 3 验证

```bash
# 1. RecommendationEngineService 行数
wc -l src/app/services/recommendation/recommendation-engine.service.ts
# 期望：< 200 行（从 ~1000 行降到）

# 2. 推荐结果一致性
# 同一输入，重构前后推荐结果应完全一致（可写 e2e 测试）
```

### Phase 4 验证

```bash
# 1. ContentManagementService 不直接依赖 App Repository
grep -c "InjectRepository" src/admin/services/content-management.service.ts
# 期望：0 或极少（只保留 Admin 自身实体）

# 2. Admin 内容管理接口正常
curl http://localhost:3006/api/admin/content/food-records     # 需 admin auth
curl http://localhost:3006/api/admin/content/conversations     # 需 admin auth
```

---

## 六、关键约束重申

| 约束              | 保障措施                                                                   |
| ----------------- | -------------------------------------------------------------------------- |
| **接口 URL 不变** | 新 controller 使用相同 `@Controller('api/app/food')` 前缀 + 相同路由装饰器 |
| **入参不变**      | 搬运 handler 方法时保留所有 `@Body()`, `@Query()`, `@Param()` 装饰器和 DTO |
| **出参不变**      | service 方法返回类型不变，controller return 结构不变                       |
| **不删接口**      | 旧 `food.controller.ts` 保留，仅把 handler 方法搬到新 controller           |
| **增量重构**      | 每个 Phase 独立提交，可单独回滚                                            |

---

## 七、重构顺序图示

```
当前状态                          重构后
─────────                        ──────

FoodController (20 路由)    →    FoodRecordController (7 路由)
                                 FoodAnalyzeController (1 路由)
                                 DailyPlanController (4 路由)
                                 BehaviorController (3 路由)
                                 NutritionController (3 路由)
                                 FoodController (2 路由: profile)

FoodService (~550 行)       →    FoodRecordService (CRUD ~200 行)
                                 DailySummaryService (汇总 ~150 行)
                                 FoodService (编排 ~100 行)

RecommendationEngine        →    ConstraintGeneratorService (~100 行)
  (~1000 行)                     FoodScorerService (~250 行)
                                 FoodFilterService (~80 行)
                                 MealAssemblerService (~150 行)
                                 RecommendationEngineService (Facade ~150 行)

ContentManagement           →    AppDataQueryService (只读查询 Shared)
  (直接持有 app repo)             ContentManagementService (依赖 Shared)
```

---

## 八、不涉及的范围

以下内容**本次不做**，避免范围蔓延：

- ❌ 不修改任何接口 path
- ❌ 不修改入参 / 出参结构
- ❌ 不新增接口
- ❌ 不重构 Admin 模块（已基本合理）
- ❌ 不重构 Gateway / FoodPipeline / LangChain / Health / Compress 模块
- ❌ 不做数据库 schema 变更
- ❌ 不引入新技术栈（如 Redis / MQ）
- ❌ 不做性能优化
