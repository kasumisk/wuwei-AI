# V7.5 升级方案 — 可维护性治理 + 类型安全 + 减法优化

> 基于 V7.4 架构的版本演进，聚焦系统健康度而非新功能

## 一、能力评估（Step 1）

### 1.1 V7.4 已具备能力

| 能力域     | 状态      | 说明                                                                              |
| ---------- | --------- | --------------------------------------------------------------------------------- |
| 用户画像   | ✅ 成熟   | 5 层画像（declared/inferred/observed/shortTerm/contextual）+ 事件驱动增量更新     |
| 推荐管道   | ✅ 成熟   | recall → rank → rerank 三阶段 + 10 个 ScoringFactor + 14 维评分                   |
| 策略引擎   | ✅ 双层   | V6 细粒度 Policy + V7.4 宏观行为策略（explore/exploit/strict_health/scene_first） |
| 场景系统   | ✅ 完整   | 12 种场景 + 4 套 Realism 预设 + acquisitionDifficulty 过滤                        |
| 缓存       | ✅ 三级   | L1 内存 LRU + L2 Redis + 请求级缓存 + 预热                                        |
| 可解释性   | ✅ 深度   | 14 维评分解释 + 对比解释 + 替代解释 + 叙事体 + 多语言                             |
| 食物数据   | ✅ 丰富   | 72 字段 FoodLibrary + 90 道大众菜 + omega3/fiber 精细化                           |
| 自适应学习 | ✅ 持久化 | FactorLearner Redis Hash + 自适应学习率                                           |

### 1.2 现存问题（审计发现）

#### 🔴 严重（架构层）

| #   | 问题                   | 影响                                                                           | 数据                       |
| --- | ---------------------- | ------------------------------------------------------------------------------ | -------------------------- |
| S1  | **God Service 反模式** | recommendation-engine.service.ts 有 **36 个 DI 依赖**，1613 行                 | 违反 SRP，改一处影响全局   |
| S2  | **`as any` 泛滥**      | 推荐模块 **59 处 `as any`**，其中 17 处是访问 FoodLibrary 已有字段             | 类型系统形同虚设           |
| S3  | **两套策略系统共存**   | V6 `strategy.types.ts` 463 行 + V7.4 `recommendation-strategy.types.ts` 292 行 | 认知负担，语义重叠         |
| S4  | **循环依赖**           | **9 个 forwardRef** 跨 3 个 module                                             | 启动顺序不可预测，测试困难 |

#### 🟡 高（工程层）

| #   | 问题                       | 影响                                                            | 数据               |
| --- | -------------------------- | --------------------------------------------------------------- | ------------------ |
| H1  | **核心管道零单元测试**     | engine/pipeline/explanation/scoring-chain 只有集成测试          | 回归风险高         |
| H2  | **超大文件**               | **22 个文件超 500 行**，最大 2450 行（i18n）                    | 可读性差，合并冲突 |
| H3  | **魔数散布**               | 60+ 硬编码阈值/权重散布在 15+ 文件                              | 调参需要改代码     |
| H4  | **死代码**                 | 6 个 `@deprecated` 方法未清理 + 旧策略 API 残留                 | 维护负担           |
| H5  | **FoodLibrary 类型不完整** | `vitaminB6`, `waterContentPercent` 被 `as any` 访问但不在接口上 | 运行时错误风险     |

#### 🟢 中（数据/功能层）

| #   | 问题                                                       | 影响                           |
| --- | ---------------------------------------------------------- | ------------------------------ |
| M1  | recommendation.types.ts 1868 行混合接口/枚举/常量/工具函数 | 定位困难                       |
| M2  | 38 个 providers 全部 export                                | 无封装，外部模块可访问内部实现 |
| M3  | i18n 单文件 2450 行                                        | 按 locale 合并导致冲突         |

---

## 二、核心升级方向（Step 2）— 6 个方向

### 方向 1：RecommendationEngine 拆分（解决 S1）

**为什么需要：** 36 个 DI 依赖的 God Service 是整个系统最大的可维护性风险。任何修改都可能引发连锁问题。

**解决什么问题：**

- 降低单文件认知负担（1613 行 → 多个 <400 行的服务）
- 每个子服务可独立测试
- 减少 DI 依赖数到 <8 个/服务

**方案：** 按职责拆分为 3 个 Facade 服务：

- `MealRecommendationFacade` — 单餐推荐入口（`recommendMeal`, `recommendMealFromPool`）
- `ScenarioRecommendationFacade` — 场景推荐入口（`recommendByScenario`）
- `DailyPlanFacade` — 日计划推荐入口（`generateDailyPlan`）
- `RecommendationEngineService` 退化为薄门面层（<200 行），仅做路由分发

### 方向 2：类型安全治理（解决 S2, H5）

**为什么需要：** 59 处 `as any` 意味着 TypeScript 类型检查在这些位置完全失效。其中 17 处是访问 FoodLibrary 已有字段，纯粹是历史遗留。

**解决什么问题：**

- 消除运行时类型错误风险
- 让编译器真正能捕获 bug
- `vitaminB6`, `waterContentPercent` 补充到 FoodLibrary 接口

**方案：** 分批消除 `as any`，按类别处理：

- A类（17处）：删除不必要的 `as any`（字段已在接口上）
- B类（2处）：补充缺失字段到 FoodLibrary（`vitaminB6`, `waterContentPercent`）
- C类（6处）：策略 config 类型补全
- D类（其余）：使用 branded type 或类型守卫替代

### 方向 3：死代码清理 + 策略系统统一（解决 S3, H4）

**为什么需要：** 两套策略系统共存增加认知负担。`@deprecated` 方法残留增加维护成本。

**解决什么问题：**

- 统一策略语义（V7.4 RecommendationStrategy 作为唯一用户侧策略入口）
- V6 StrategyAutoTuner 仅作为内部实现细节
- 清理 `@deprecated` 方法

**方案：**

- 删除 engine 中 6 个 `@deprecated` 委托方法
- 标注 V6 策略引擎为 `@internal`，明确其为实现层
- 统一对外策略 API 为 RecommendationStrategy 4 预设

### 方向 4：魔数配置化（解决 H3）

**为什么需要：** 60+ 硬编码阈值散布在 15+ 文件，调参需要修改源码并重新部署。

**解决什么问题：**

- 运营可调参（不需要开发介入）
- 支持不同环境不同配置（dev/staging/prod）
- A/B 测试时可动态切换参数

**方案：** 创建 `RecommendationTuningConfig` 集中配置类：

- 评分因子参数（lovesMultiplier, cfBoostCap, etc.）
- 学习参数（learningRate, decayHalfLife, coldStartThreshold）
- 管道参数（optimizerCandidateLimit, maxRetryRounds）
- 从环境变量 / 数据库 config 表加载，支持运行时热更新

### 方向 5：recommendation.types.ts 拆分（解决 M1）

**为什么需要：** 1868 行单文件混合了接口定义、枚举、常量数组、工具函数，定位任何类型都需要在近 2000 行中搜索。

**解决什么问题：**

- 按职责域拆分，提高可读性
- 减少合并冲突（多人协作时）
- 导入路径更清晰

**方案：** 拆分为 4 个文件：

- `scoring.types.ts` — SCORE_DIMENSIONS, SCORE_WEIGHTS, ScoringContext, ScoringExplanation
- `pipeline.types.ts` — PipelineContext, PipelineConfig, ResolvedStrategy
- `meal.types.ts` — MealRecommendation, MealFromPoolRequest, DietaryConstraint
- `recommendation.types.ts` — 保留为聚合 re-export（向后兼容）

### 方向 6：forwardRef 消除 + 模块边界明确化（解决 S4, M2）

**为什么需要：** 9 个 forwardRef 表明模块间存在循环依赖，这会导致启动顺序不确定、测试 mock 困难、运行时初始化错误。

**解决什么问题：**

- 消除循环依赖
- 明确模块公开接口 vs 内部实现
- 38 个 provider 不应全部 export

**方案：**

- 提取共享接口到 `@diet/shared` barrel
- 仅 export 外部模块需要的服务（<10 个）
- 通过事件解耦 Recommendation → Tracking 的直接依赖

---

## 三、架构升级设计（Step 3）

### 3.1 当前架构（V7.4）

```
RecommendationEngineService (36 DI, 1613 行)
  ├── PipelineBuilderService (15 DI, 1124 行)
  │     ├── ScoringChainService ← 10 ScoringFactors
  │     ├── FoodScorerService (14 维评分)
  │     ├── RecallMergerService
  │     └── RealisticFilterService
  ├── MealAssemblerService
  ├── DailyPlanContextService
  ├── HealthModifierEngineService
  ├── SubstitutionService
  ├── ABTestingService
  ├── CollaborativeFilteringService
  ├── ... (30+ 其他服务)
  └── [所有服务平铺在同一层]
```

### 3.2 升级后架构（V7.5）

```
RecommendationEngineService (瘦门面, <200 行, ~5 DI)
  ├── MealRecommendationFacade (<400 行, ~10 DI)
  │     ├── PipelineBuilderService
  │     ├── MealAssemblerService
  │     ├── HealthModifierEngineService
  │     └── SubstitutionService
  ├── ScenarioRecommendationFacade (<300 行, ~8 DI)
  │     ├── SceneResolverService
  │     ├── PipelineBuilderService
  │     └── RealisticFilterService
  └── DailyPlanFacade (<300 行, ~8 DI)
        ├── DailyPlanContextService
        ├── PipelineBuilderService
        └── NutritionTargetService

RecommendationTuningConfig (新增, 集中配置)
  └── 所有魔数 → 配置化

类型文件:
  scoring.types.ts (新增)
  pipeline.types.ts (新增)
  meal.types.ts (新增)
  recommendation.types.ts (保留为 re-export hub)
```

### 3.3 新增 / 修改模块

| 模块                           | 类型 | 说明                                   |
| ------------------------------ | ---- | -------------------------------------- |
| `MealRecommendationFacade`     | 新增 | 从 engine 拆分出的单餐推荐服务         |
| `ScenarioRecommendationFacade` | 新增 | 从 engine 拆分出的场景推荐服务         |
| `DailyPlanFacade`              | 新增 | 从 engine 拆分出的日计划服务           |
| `RecommendationTuningConfig`   | 新增 | 集中管理推荐参数的配置服务             |
| `scoring.types.ts`             | 新增 | 从 recommendation.types.ts 拆分        |
| `pipeline.types.ts`            | 新增 | 从 recommendation.types.ts 拆分        |
| `meal.types.ts`                | 新增 | 从 recommendation.types.ts 拆分        |
| `RecommendationEngineService`  | 修改 | 从 1613 行 God Service → <200 行薄门面 |
| `FoodLibrary`                  | 修改 | 补充 vitaminB6, waterContentPercent    |
| 15+ 文件                       | 修改 | 消除 `as any`                          |

---

## 四、模块级升级设计（Step 4）

### 4.1 Profile 模块

**当前状态：** 已有事件驱动（ProfileEventBus），无需改动。
**V7.5 动作：** 无。保持现状。

### 4.2 Recommendation 模块

**当前问题：** Engine 36 DI → 拆分为 3 个 Facade
**V7.5 动作：**

1. 创建 `MealRecommendationFacade`，迁移 `recommendMeal` + `recommendMealFromPool` 逻辑
2. 创建 `ScenarioRecommendationFacade`，迁移 `recommendByScenario` 逻辑
3. 创建 `DailyPlanFacade`，迁移 `generateDailyPlan` 逻辑
4. Engine 退化为路由分发（<200 行）
5. 删除 6 个 `@deprecated` 方法

### 4.3 Nutrition / Scoring

**当前问题：** LifestyleBoostFactor 12 个 `as any`，FoodLibrary 缺少 `vitaminB6` + `waterContentPercent`
**V7.5 动作：**

1. FoodLibrary 接口补充 `vitaminB6?` 和 `waterContentPercent?`
2. Prisma schema 补充对应字段
3. 消除 LifestyleBoostFactor 中 12 个 `as any`
4. 消除其他 FoodLibrary 相关 `as any`（17 处）

### 4.4 Cache / 性能

**当前状态：** 三级缓存已完整，无需改动。
**V7.5 动作：** 无。保持现状。

### 4.5 数据流

**当前状态：** 事件驱动已建立（feedback → profile → recommendation）。
**V7.5 动作：** 通过事件解耦消除 1-2 个 forwardRef（Recommendation → Tracking）。

---

## 五、技术路线图（Step 5）

### Phase 1（类型安全 + FoodLibrary 补全）

| 编号 | 任务                                                          | 优先级 | 预估行数变更 |
| ---- | ------------------------------------------------------------- | ------ | ------------ |
| P1-A | FoodLibrary 补充 `vitaminB6?`, `waterContentPercent?` 字段    | 高     | +5 行        |
| P1-B | Prisma schema 补充 `vitamin_b6`, `water_content_percent` 字段 | 高     | +10 行       |
| P1-C | food-pool-cache mapRowToFoodLibrary 补充映射                  | 高     | +5 行        |
| P1-D | 消除 A 类 `as any`：FoodLibrary 已有字段的不必要断言（17 处） | 高     | -17 行       |
| P1-E | 消除 B 类 `as any`：LifestyleBoostFactor 补全后消除（12 处）  | 高     | -12 行       |
| P1-F | 消除 C 类 `as any`：策略 config 类型补全（6 处）              | 中     | ~±20 行      |
| P1-G | 编译验证 + 全量测试                                           | 高     | 0            |

### Phase 2（Engine 拆分 + 死代码清理）

| 编号 | 任务                                                            | 优先级 | 预估行数变更  |
| ---- | --------------------------------------------------------------- | ------ | ------------- |
| P2-A | 创建 `MealRecommendationFacade`，迁移单餐推荐逻辑               | 高     | +400 行新文件 |
| P2-B | 创建 `ScenarioRecommendationFacade`，迁移场景推荐逻辑           | 高     | +300 行新文件 |
| P2-C | 创建 `DailyPlanFacade`，迁移日计划逻辑                          | 高     | +300 行新文件 |
| P2-D | RecommendationEngineService 退化为薄门面                        | 高     | -1400 行      |
| P2-E | 删除 6 个 `@deprecated` 方法                                    | 中     | -60 行        |
| P2-F | 删除 `i18n-messages.ts` 中 `@deprecated` 的 setLocale/getLocale | 低     | -20 行        |
| P2-G | recommendation.module.ts 注册新 Facade，收窄 exports            | 中     | ±15 行        |
| P2-H | 编译验证 + 全量测试                                             | 高     | 0             |

### Phase 3（配置化 + types 拆分 + forwardRef 消除）

| 编号 | 任务                                                          | 优先级 | 预估行数变更     |
| ---- | ------------------------------------------------------------- | ------ | ---------------- |
| P3-A | 创建 `RecommendationTuningConfig` 服务，集中 60+ 魔数         | 高     | +200 行新文件    |
| P3-B | 15+ 文件改为从 TuningConfig 读取参数                          | 高     | ±100 行          |
| P3-C | recommendation.types.ts 拆分为 scoring/pipeline/meal.types.ts | 中     | ±0（重组）       |
| P3-D | recommendation.types.ts 保留为 re-export hub                  | 中     | -1800 行 +4 文件 |
| P3-E | 消除 Recommendation → Tracking 的 forwardRef（通过事件解耦）  | 中     | ±30 行           |
| P3-F | 收窄 module exports（38 → <15 个公开服务）                    | 低     | ±10 行           |
| P3-G | 全量回归测试 + 编译验证                                       | 高     | 0                |

---

## 六、数据迁移（Step 6）

### Prisma Schema 变更

新增 2 个字段到 `food_library` 表：

```prisma
vitamin_b6           Decimal?  @db.Decimal(10, 4)  // mg per 100g
water_content_percent Decimal? @db.Decimal(5, 2)    // 含水率 %
```

**迁移方式：** `prisma migrate dev` 自动生成。字段为 nullable，无需数据回填。

---

## 七、文档升级（Step 7）

### 新增章节

- 本文件：`INTELLIGENT_DIET_SYSTEM_V7_5_UPGRADE.md`

### 修改内容

- 无需修改 V7.4 文档（V7.5 是独立升级文档）

### 删除内容

- 无
