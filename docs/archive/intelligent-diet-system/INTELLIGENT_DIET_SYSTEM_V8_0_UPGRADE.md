# AI 智能饮食推荐系统 V8.0 升级方案

> 基于 V7.9 架构的增量演进升级，不推翻已有设计，不新增非必要模块。
> 聚焦：可维护性、可执行性、做减法、策略完善、性能优化。

---

## 一、能力评估（Step 1）

### 1.1 当前系统已具备能力

| 能力       | 成熟度 | 说明                                                                                       |
| ---------- | ------ | ------------------------------------------------------------------------------------------ |
| 用户画像   | ★★★★☆  | 五层画像聚合（declared/observed/inferred/shortTerm/contextual），三表架构 + Redis 短期画像 |
| 推荐管道   | ★★★★☆  | 三阶段管道（Recall→Rank→Rerank），14维评分 + 10因子链式评分                                |
| 策略引擎   | ★★★★☆  | 10套预设策略，4层合并（Global→GoalType→Context→User），9维策略配置                         |
| 缓存机制   | ★★★★☆  | TieredCache（L1 LRU + L2 Redis + Singleflight），健康修正双层缓存                          |
| 现实性过滤 | ★★★☆☆  | 6条规则 + 场景动态调整 + 用户端覆盖，但与管道耦合度高                                      |
| 可解释性   | ★★★★☆  | 8个解释服务，正向+反向解释，自适应深度，A/B 追踪                                           |
| 调试能力   | ★★★☆☆  | V7.9 新增 Trace 和调试端点，但推荐引擎入口仍是 God Class                                   |
| 行为推断   | ★★★☆☆  | 偏好增量更新（事件驱动），但推断逻辑分散                                                   |
| 分析能力   | ★★★☆☆  | 转化漏斗、推荐质量仪表盘，但策略效果分析偏基础                                             |

### 1.2 存在问题

#### A. 架构层问题（高优先级）

| #   | 问题                                                                                                | 影响                                                          | 严重度 |
| --- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| A1  | **RecommendationEngineService 仍是 God Class**（1349行，24个DI依赖）                                | 可维护性差，难以测试，每次修改风险高                          | 高     |
| A2  | **PipelineContext 构建代码重复**（两处几乎相同的 40 字段赋值，行 709-740 和 813-845）               | 修改遗漏风险，维护成本高                                      | 高     |
| A3  | **recommendByScenario 完全绕过 PipelineBuilder**（独立的过滤-评分-组装流程，~250行）                | 场景推荐不享受链式评分、现实性过滤、Trace追踪、模板填充等能力 | 高     |
| A4  | **recallCandidates 中 7 处重复的兜底逻辑**                                                          | 代码冗余，修改一处容易遗漏其他                                | 中     |
| A5  | **PipelineContext 字段膨胀**（约 40 个字段，`(ctx.trace as any)._lastXxxDetails` 模式破坏类型安全） | 类型安全缺失，新增字段无编译期检查                            | 中     |

#### B. 工程问题

| #   | 问题                                                                                     | 影响                             | 严重度 |
| --- | ---------------------------------------------------------------------------------------- | -------------------------------- | ------ |
| B1  | **版本注释过重**（几乎每行都有 `// V6.3 P2-8:` 标签）                                    | 代码可读性下降，注释噪音大于信号 | 中     |
| B2  | **StrategyService 返回值全是 `Promise<any>`**（15+处）                                   | 类型安全缺失，重构困难           | 中     |
| B3  | **评分配置三层分散**（ScoringConfig 42参数 + TuningConfig 60常量 + StrategyConfig.rank） | 参数含义重叠，调参困难           | 中     |
| B4  | **constraintGenerator 在 PipelineBuilder 中注入但未直接使用**                            | 冗余依赖                         | 低     |

#### C. 功能差距

| #   | 问题                                                                                                                           | 影响                                 | 严重度 |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ------ |
| C1  | **策略种子数据不完整** — 10套策略的 rank.baseWeights 缺少 acquisition 维度（14维中第14维），SCORE_DIMENSION_NAMES 只列了 13 维 | 策略权重与实际评分维度不匹配         | 高     |
| C2  | **场景推荐能力残缺** — recommendByScenario 没有 Trace、没有现实性过滤、没有 Factor 链                                          | 场景推荐质量和可调试性远低于标准推荐 | 高     |
| C3  | **缺少自动化测试** — 推荐管道核心逻辑（PipelineBuilder 1333行、ScoringChain 10因子）无测试保障                                 | 重构风险高，回归验证困难             | 高     |

---

## 二、核心升级方向（Step 2）

### 升级方向 1：推荐引擎架构做减法（RecommendationEngine 瘦身）

**为什么需要**：RecommendationEngineService 是 1349 行的 God Class，注入 24 个依赖，承担了画像聚合、策略解析、场景解析、PipelineContext 构建、管道执行委托、结果后处理等过多职责。每次修改都有高风险，且 PipelineContext 构建代码重复了两次。

**解决什么问题**：

- 消除 PipelineContext 构建的代码重复
- 将 God Class 拆分为职责单一的服务
- 让 recommendByScenario 走标准管道（消除能力残缺）
- 提高可测试性和可维护性

### 升级方向 2：recallCandidates 兜底逻辑统一

**为什么需要**：recallCandidates() 中有 7 处几乎相同的兜底逻辑（`if (candidates.length < 3 && beforeCount >= 3) { ... }`），修改一处容易遗漏其他。

**解决什么问题**：

- 消除代码重复
- 统一兜底策略，降低维护成本

### 升级方向 3：Trace 临时字段类型安全化

**为什么需要**：V7.9 引入的 `(ctx.trace as any)._lastXxxDetails` 模式（4处）绕过了 TypeScript 类型检查，依赖字符串命名约定传递数据，容易出错且不可搜索。

**解决什么问题**：

- 恢复类型安全
- 消除 `as any` 类型转换
- 让 trace 数据流可追踪

### 升级方向 4：策略种子数据完善 + 类型修正

**为什么需要**：10 套策略的 rank.baseWeights 缺少第 14 维（acquisition），SCORE_DIMENSION_NAMES 常量只列了 13 维（缺 acquisition）。策略权重与实际评分维度不匹配，导致 acquisition 维度在所有策略中权重为 0。

**解决什么问题**：

- 修正策略种子数据，覆盖全部 14 维
- 修正 SCORE_DIMENSION_NAMES 常量
- 确保新创建的策略默认包含正确维度

### 升级方向 5：版本注释清理 + StrategyService 类型安全

**为什么需要**：几乎每行代码都有 `// V6.3 P2-8:` 等版本标签，注释噪音远大于信号。StrategyService 的 15+ 处返回值标注为 `Promise<any>`，缺乏类型安全。

**解决什么问题**：

- 提高代码可读性
- 恢复 StrategyService 的类型安全
- 降低维护成本

### 升级方向 6：评分配置统一化

**为什么需要**：评分参数分散在三层（ScoringConfigService 42 参数 + RecommendationTuningConfig 60 常量 + StrategyConfig.rank），部分参数含义重叠，调参时不清楚该改哪一层。

**解决什么问题**：

- 统一评分参数为两层：策略层（StrategyConfig）+ 系统默认层（ScoringConfig，含 TuningConfig）
- 消除参数重叠和歧义

---

## 三、架构升级设计（Step 3）

### 3.1 架构变更概览

```
V7.9 架构:
  RecommendationEngineService (God Class, 1349行, 24 DI)
    ├── 画像聚合 (ProfileAggregator)
    ├── 策略解析 (StrategyResolverFacade)
    ├── 场景解析 (SceneResolver)
    ├── PipelineContext 构建 (内联，重复两次)
    ├── recommendByScenario (绕过 PipelineBuilder)
    ├── 管道执行委托 (PipelineBuilder)
    ├── 结果后处理 (菜谱/多语言/洞察/Trace)
    └── 反向解释 (Why Not)

V8.0 架构:
  RecommendationEngineService (瘦身为协调层, ~400行, ~12 DI)
    ├── PipelineContextFactory (新提取, ~300行)          ← P1
    │     构建 PipelineContext, 消除重复
    ├── RecommendationResultProcessor (新提取, ~250行)   ← P1
    │     菜谱组装 + 多语言 + 洞察 + Trace持久化
    ├── recommendByScenario → 走 PipelineBuilder         ← P2
    │     通过 SceneContext 控制差异，不再独立流程
    └── PipelineBuilder (不变)
         ├── recallCandidates (兜底逻辑统一)              ← P1
         ├── Trace: StageTrace 替代 _lastXxxDetails      ← P1
         └── ScoringChain (不变)

  StrategyService (类型安全化)                             ← P2
    └── Promise<StrategyEntity> 替代 Promise<any>

  strategy-seed.service.ts (种子数据完善)                   ← P1
    └── 10套策略 baseWeights 补全14维

  ScoringConfigService + TuningConfig → 合并               ← P2
    └── 统一为 ScoringConfig (含 tuning 子对象)
```

### 3.2 不新增的模块

以下明确不新增：

- 不新增"特征工程层" — 已有 ProfileScoringMapper + LifestyleScoringAdapter 满足需求
- 不新增"事件总线模块" — 已有 EventEmitter2 + ProfileEventBus 满足需求
- 不新增"ML/AI 推理层" — 当前规则+链式评分已足够，不引入理想化 AI
- 不新增"国际化模块" — 已有 i18n-messages + FoodI18nService

---

## 四、模块级升级设计（Step 4）

### 4.1 RecommendationEngine 模块（做减法）

#### 4.1.1 提取 PipelineContextFactory

**当前问题**：PipelineContext 在 `recommendMealFromPool` 中内联构建了两次（行 709-740 和 813-845），约 40 个字段几乎相同。

**升级方案**：

- 新建 `pipeline-context-factory.service.ts`
- 提取 `buildContext(req: MealFromPoolRequest, extras: ContextExtras): PipelineContext` 方法
- 所有 PipelineContext 构建统一走这个工厂
- 菜谱模式和常规模式的差异通过 `ContextExtras` 参数控制

```typescript
// pipeline-context-factory.service.ts
interface ContextExtras {
  replacementWeightMap?: Map<string, number>;
  picks?: ScoredFood[];
  scoredRecipes?: ScoredRecipe[];
}

@Injectable()
export class PipelineContextFactory {
  buildContext(req: MealFromPoolRequest, extras?: ContextExtras): PipelineContext;
}
```

#### 4.1.2 提取 RecommendationResultProcessor

**当前问题**：`recommendMealFromPool` 在管道执行后有约 250 行的后处理逻辑（菜谱组装、份量调整、洞察生成、多语言覆盖、Trace 持久化）。

**升级方案**：

- 新建 `recommendation-result-processor.service.ts`
- 提取 `processResult(pipelineResult, ctx, req): MealRecommendation` 方法
- RecommendationEngineService 只负责：调用 PipelineContextFactory → 调用 PipelineBuilder → 调用 ResultProcessor

#### 4.1.3 recommendByScenario 走标准管道

**当前问题**：`recommendByScenario`（~250行）完全绕过 PipelineBuilder，采用独立的过滤-评分-组装流程，不享受链式评分、现实性过滤、Trace 追踪等能力。

**升级方案**：

- 删除 `recommendByScenario` 中的独立过滤/评分逻辑
- 改为三次调用标准管道（每次设置不同的 `ctx.channel` 和 `ctx.sceneContext`）
- 通过 PipelineContext 的 `channel` 字段控制场景差异（delivery / convenience / home_cook）
- 跨场景去重通过 `ctx.usedNames` 累积实现
- 这样场景推荐自动享受全部管道能力（Factor 链、现实性过滤、Trace、洞察等）

### 4.2 PipelineBuilder 模块

#### 4.2.1 recallCandidates 兜底逻辑统一

**当前问题**：7 处几乎相同的兜底代码：

```typescript
if (candidates.length < 3 && beforeCount >= 3) {
  candidates = ctx.allFoods
    .filter((f) => roleCategories.includes(f.category) && !ctx.usedNames.has(f.name))
    .slice(0, 10);
}
```

**升级方案**：

- 提取为 `private ensureMinCandidates(candidates, ctx, roleCategories, minCount = 3, fallbackSize = 10): FoodLibrary[]`
- 所有兜底逻辑统一调用此方法

#### 4.2.2 Trace 临时字段类型安全化

**当前问题**：4 处 `(ctx.trace as any)._lastXxxDetails` 模式。

**升级方案**：

- 在 `PipelineTrace` 类型中新增 `stageBuffer: Map<string, unknown>` 字段
- 各子服务通过 `ctx.trace.stageBuffer.set('realisticFilter', details)` 写入
- `executeRolePipeline` 通过 `ctx.trace.stageBuffer.get('realisticFilter')` 读取并合并到 stage trace
- 消除所有 `as any` 类型转换

### 4.3 Strategy 模块

#### 4.3.1 种子数据完善

**当前问题**：10 套策略缺少 acquisition 维度权重。

**升级方案**：

- 更新 `strategy-seed.service.ts`，所有 `baseWeights` 从 13 维扩展到 14 维（补充 acquisition）
- 修正 `SCORE_DIMENSION_NAMES` 常量（如果缺少 acquisition）
- 根据策略特性设定 acquisition 权重：
  - `warm_start`/`discovery`: 0.04（新用户不过多考虑可获得性）
  - `precision`/`diabetes`/`gout`: 0.02（健康优先）
  - `takeout_focused`/`canteen_optimized`: 0.08（场景化策略更看重可获得性）
  - `budget_conscious`: 0.06（预算用户重视可获得性）
  - `re_engage`/`vegetarian`: 0.04（中等）

#### 4.3.2 StrategyService 类型安全化

**当前问题**：15+ 处 `Promise<any>` 返回值。

**升级方案**：

- 定义 `StrategyEntity` 接口包装 Prisma 返回类型
- 替换所有 `Promise<any>` 为 `Promise<StrategyEntity>` / `Promise<StrategyEntity[]>` / `Promise<StrategyEntity | null>`

### 4.4 Cache / 性能

**当前状态**：V7.9 已完成主要性能优化（computeWeights 缓存、ScoringChain 短路、RealisticFilter 预过滤、HealthModifier 预计算）。

**V8.0 不新增缓存层**，但做以下优化：

- `FoodScorerService.clearWeightsCache()` 确保在每轮评分开始时被调用（防止跨请求缓存污染）
- 确认 `foodPoolCache` 的刷新机制在食物库更新时触发

### 4.5 数据流

**不引入新的事件流**。当前 EventEmitter2 + ProfileEventBus + `@OnEvent` 监听器已满足需求：

- `FEEDBACK_SUBMITTED` → 偏好增量更新
- 画像变更 → 缓存失效 → 重建

### 4.6 评分配置统一化

**当前问题**：ScoringConfigService（42参数）+ RecommendationTuningConfig（60常量）+ StrategyConfig.rank 三层交叉控制。

**升级方案**：

- 将 `RecommendationTuningConfig` 合并为 `ScoringConfigSnapshot.tuning` 的子对象（已在 V7.5 部分实现）
- 明确优先级：`StrategyConfig.rank` > `ScoringConfigSnapshot` > 硬编码默认值
- 在 ScoringConfigService 文档中明确三层的职责边界

---

## 五、技术路线图（Step 5）

### Phase 1（短期）— 可维护性 + 做减法 + 种子数据

> 目标：消除代码重复，提高可维护性，完善策略种子数据。

| 编号  | 任务                                    | 涉及文件                                                                                                                                                | 预估行数   |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| P1-01 | 提取 PipelineContextFactory             | 新建 `pipeline-context-factory.service.ts`，修改 `recommendation-engine.service.ts`                                                                     | +300, -80  |
| P1-02 | 提取 RecommendationResultProcessor      | 新建 `recommendation-result-processor.service.ts`，修改 `recommendation-engine.service.ts`                                                              | +250, -250 |
| P1-03 | recallCandidates 兜底逻辑统一           | 修改 `pipeline-builder.service.ts`                                                                                                                      | +15, -50   |
| P1-04 | Trace stageBuffer 替代 \_lastXxxDetails | 修改 `pipeline.types.ts`, `pipeline-builder.service.ts`, `realistic-filter.service.ts`, `scoring-chain.service.ts`, `health-modifier-engine.service.ts` | +20, -30   |
| P1-05 | 策略种子数据完善（14维 baseWeights）    | 修改 `strategy-seed.service.ts`                                                                                                                         | +30, -10   |
| P1-06 | SCORE_DIMENSION_NAMES 修正              | 修改 `scoring.types.ts`                                                                                                                                 | +1, -1     |
| P1-07 | clearWeightsCache 调用确认              | 修改 `recommendation-engine.service.ts` 或 `pipeline-builder.service.ts`                                                                                | +3, -0     |
| P1-08 | DietModule 注册新服务                   | 修改 `diet.module.ts` 或 `recommendation.module.ts`                                                                                                     | +5, -0     |
| P1-09 | 构建验证                                | 运行 `pnpm run --filter "@ai-platform/server" build`                                                                                                    | 0          |

**Phase 1 预估**：新增 ~624 行，修改/删除 ~421 行，涉及 ~12 个文件

### Phase 2（中期）— 架构增强 + 类型安全

> 目标：消除 recommendByScenario 的独立路径，恢复类型安全。

| 编号  | 任务                                         | 涉及文件                                        | 预估行数  |
| ----- | -------------------------------------------- | ----------------------------------------------- | --------- |
| P2-01 | recommendByScenario 走标准管道               | 修改 `recommendation-engine.service.ts`         | +80, -250 |
| P2-02 | StrategyService 类型安全化（StrategyEntity） | 修改 `strategy.service.ts`, `strategy.types.ts` | +30, -15  |
| P2-03 | StrategyResolver 类型安全化                  | 修改 `strategy-resolver.service.ts`             | +10, -10  |
| P2-04 | 评分配置层级文档化                           | 修改 `scoring-config.service.ts` 注释           | +20, -5   |
| P2-05 | 版本注释精简（RecommendationEngineService）  | 修改 `recommendation-engine.service.ts`         | +0, -60   |
| P2-06 | 版本注释精简（PipelineBuilderService）       | 修改 `pipeline-builder.service.ts`              | +0, -80   |
| P2-07 | 版本注释精简（FoodScorerService）            | 修改 `food-scorer.service.ts`                   | +0, -50   |
| P2-08 | PipelineBuilder 冗余依赖清理                 | 修改 `pipeline-builder.service.ts`              | +0, -3    |
| P2-09 | 构建验证                                     | 运行 build                                      | 0         |

**Phase 2 预估**：新增 ~140 行，修改/删除 ~473 行，涉及 ~8 个文件

### Phase 3（长期）— 健壮性 + 可观测性

> 目标：补充关键测试，增强生产运行信心。

| 编号  | 任务                                   | 涉及文件          | 预估行数 |
| ----- | -------------------------------------- | ----------------- | -------- |
| P3-01 | PipelineContextFactory 单元测试        | 新建测试文件      | +150     |
| P3-02 | recallCandidates 单元测试              | 新建测试文件      | +200     |
| P3-03 | ScoringChain 集成测试（10因子）        | 新建测试文件      | +250     |
| P3-04 | StrategyResolver 合并逻辑单元测试      | 新建测试文件      | +150     |
| P3-05 | recommendByScenario 走管道后的集成验证 | 新建测试文件      | +100     |
| P3-06 | 构建验证                               | 运行 build + test | 0        |

**Phase 3 预估**：新增 ~850 行，全部为测试文件，涉及 ~5 个新文件

---

## 六、数据迁移（Step 6）

### V8.0 无数据库 Schema 变更

本版本所有升级均为代码层重构和优化，不涉及：

- 无新增表
- 无新增字段
- 无字段类型变更
- 无索引变更
- 无数据迁移脚本

策略种子数据的 `baseWeights` 更新通过 `StrategySeedService.onModuleInit()` 的幂等逻辑在应用启动时自动完成（需确认 seed 服务对已存在策略的更新逻辑）。

---

## 七、文档升级（Step 7）

### 7.1 新增章节

- 本文档 `INTELLIGENT_DIET_SYSTEM_V8_0_UPGRADE.md`

### 7.2 修改内容

- 无需修改已有文档（V7.9 文档保持不变作为历史记录）

### 7.3 删除内容

- 无

---

## 八、具体实施计划

### Phase 1 任务明细

#### P1-01: 提取 PipelineContextFactory

**目标**：将 `recommendMealFromPool` 中两处重复的 PipelineContext 构建逻辑提取为独立服务。

**实施步骤**：

1. 新建 `apps/api-server/src/modules/diet/app/recommendation/context/pipeline-context-factory.service.ts`
2. 定义 `PipelineContextFactoryInput` 接口（从 `MealFromPoolRequest` + 聚合画像数据中提取必需字段）
3. 实现 `buildContext()` 方法，将行 709-740 / 813-845 的逻辑统一
4. 在 RecommendationEngineService 中注入 PipelineContextFactory，替换两处内联构建
5. 更新 DietModule/RecommendationModule 的 providers

#### P1-02: 提取 RecommendationResultProcessor

**目标**：将管道执行后的后处理逻辑（菜谱组装、多语言、洞察、Trace）提取为独立服务。

**实施步骤**：

1. 新建 `apps/api-server/src/modules/diet/app/services/recommendation-result-processor.service.ts`
2. 从 `recommendMealFromPool` 中提取后处理逻辑
3. 实现 `processResult()` 方法
4. 原有依赖（recipeAssembler, foodI18nService, insightGenerator, traceService 等）迁移到新服务

#### P1-03: recallCandidates 兜底逻辑统一

**目标**：提取 `ensureMinCandidates` 工具方法，替换 7 处重复的兜底代码。

**实施步骤**：

1. 在 PipelineBuilderService 中添加 `private ensureMinCandidates()` 方法
2. 逐一替换 recallCandidates 中的 7 处兜底逻辑

#### P1-04: Trace stageBuffer 替代 \_lastXxxDetails

**目标**：消除 4 处 `(ctx.trace as any)._lastXxxDetails` 类型转换。

**实施步骤**：

1. 在 `PipelineTrace` 类型中新增 `stageBuffer: Map<string, Record<string, unknown>>`
2. 修改 RealisticFilterService：`ctx.trace.stageBuffer.set('realisticFilter', details)`
3. 修改 ScoringChainService：`ctx.trace.stageBuffer.set('scoringChain', details)`
4. 修改 HealthModifierEngineService：`ctx.trace.stageBuffer.set('healthModifier', details)`
5. 修改 RecallMergerService（或 recallCandidates）：`ctx.trace.stageBuffer.set('recallMerge', details)`
6. 修改 executeRolePipeline：从 stageBuffer 读取并合并到 stage trace，然后 clear

#### P1-05: 策略种子数据完善

**目标**：10 套策略的 baseWeights 补全 14 维（添加 acquisition 维度）。

**实施步骤**：

1. 确认 SCORE_DIMENSIONS 数组中 acquisition 的索引位置
2. 为每套策略在 rank.baseWeights 中添加第 14 维权重值
3. 确认 seed 服务对已存在策略的更新逻辑（upsert vs skip）

#### P1-06: SCORE_DIMENSION_NAMES 修正

**目标**：确认并修正 SCORE_DIMENSION_NAMES 常量包含全部 14 维。

#### P1-07: clearWeightsCache 调用确认

**目标**：确保 FoodScorerService.clearWeightsCache() 在每轮推荐开始时被调用。

**实施步骤**：

1. 在 PipelineBuilder.executeRolePipeline 开始时调用 `this.foodScorer.clearWeightsCache()`
2. 或在 RecommendationEngineService.recommendMealFromPool 开始时调用

### Phase 2 任务明细

#### P2-01: recommendByScenario 走标准管道

**目标**：删除独立的过滤-评分-组装逻辑，改为三次调用标准管道。

**实施步骤**：

1. 利用 PipelineContextFactory 构建三个不同 channel 的 PipelineContext
2. 三次调用 PipelineBuilder.executeRolePipeline（delivery → convenience → home_cook）
3. 跨场景去重通过累积 usedNames 实现
4. 三次调用 RecommendationResultProcessor.processResult
5. 删除原有 ~250 行独立逻辑

#### P2-02/P2-03: StrategyService + StrategyResolver 类型安全化

**目标**：消除 15+ 处 `Promise<any>`。

**实施步骤**：

1. 在 `strategy.types.ts` 中定义 `StrategyEntity` 接口
2. 替换 StrategyService 中所有 `Promise<any>` 返回类型
3. 替换 StrategyResolver 中的 `any` 类型

#### P2-05/P2-06/P2-07: 版本注释精简

**目标**：去掉 `// V6.3 P2-8:` 等版本标签注释，保留设计决策注释。

**规则**：

- 删除纯版本标签（`// V6.3 P2-8: xxx`）
- 保留设计决策说明（`// 使用 Sigmoid 是因为 xxx`）
- 保留变更历史注释块（方法顶部的 `变更历史:` 段落可精简为一行）

### Phase 3 任务明细

#### P3-01 ~ P3-05: 关键路径单元/集成测试

**目标**：为重构后的核心逻辑补充测试保障。

**测试策略**：

- 单元测试：PipelineContextFactory（验证字段完整性）、recallCandidates（验证兜底逻辑）、StrategyResolver（验证4层合并）
- 集成测试：ScoringChain（10因子端到端）、recommendByScenario（走管道后的结果验证）

---

## 九、风险评估

| 风险                                 | 可能性 | 影响         | 缓解措施                                     |
| ------------------------------------ | ------ | ------------ | -------------------------------------------- |
| PipelineContextFactory 提取遗漏字段  | 中     | 推荐结果异常 | 对比新旧构建代码，确保 40 个字段无遗漏       |
| recommendByScenario 走管道后性能变化 | 低     | 响应时间变长 | 三个场景并行执行（Promise.all）而非串行      |
| 策略种子更新覆盖用户自定义策略       | 低     | 用户配置丢失 | 确认 seed 服务使用 upsert 逻辑时保留用户修改 |
| 版本注释精简删掉有用信息             | 低     | 历史决策丢失 | 仅删除纯版本标签，保留设计决策注释           |

---

## 十、验收标准

1. `pnpm run --filter "@ai-platform/server" build` 零错误
2. RecommendationEngineService 行数从 1349 降至 ~500 以下
3. RecommendationEngineService DI 依赖数从 24 降至 ~12
4. PipelineContext 构建代码不再重复
5. recommendByScenario 走 PipelineBuilder 标准管道
6. recallCandidates 中无重复兜底逻辑
7. 代码中无 `(ctx.trace as any)._lastXxxDetails` 模式
8. StrategyService 中无 `Promise<any>` 返回类型
9. 10 套策略种子数据覆盖全部 14 维
