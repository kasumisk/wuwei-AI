# Intelligent Diet Recommendation System V7.4 升级方案

> 主题：**事件驱动画像 + 策略引擎 + 持久化学习 + 食物数据增强 + 精细化营养**
> 原则：基于 V7.3 增量升级，不推翻已有架构，每个改动工程可实现

---

## 目录

1. [能力评估（V7.3 现状）](#1-能力评估)
2. [核心升级方向（6个）](#2-核心升级方向)
3. [架构升级设计](#3-架构升级设计)
4. [模块级升级设计](#4-模块级升级设计)
5. [技术路线图](#5-技术路线图)
6. [数据迁移](#6-数据迁移)
7. [文档差异](#7-文档差异)

---

## 1. 能力评估

### 1.1 V7.3 已具备能力

| 能力层    | 评级  | 说明                                                                                        |
| --------- | ----- | ------------------------------------------------------------------------------------------- |
| 用户画像  | ★★★★☆ | 5层画像（declared/inferred/observed/shortTerm/contextual），60天行为窗口，Thompson Sampling |
| 推荐引擎  | ★★★★½ | 10因子ScoringChain + 13维评分 + 4种目标类型 + 双路径Ranking（Chain + Legacy）               |
| 场景系统  | ★★★★☆ | 12场景 + 6渠道 + 4层优先级解析 + 10个SceneScoringProfile + RealisticFilter                  |
| 食物数据  | ★★★★☆ | 70+字段FoodLibrary + foodForm分类 + 分层缓存 + NRF11.4                                      |
| 模板系统  | ★★★½☆ | 8个MealTemplate + 7种SlotRole + 场景匹配 + 智能填充                                         |
| 可解释性  | ★★★★☆ | V1/V2解释 + NL叙述 + 10种Insight + radarChart + whyNot反向解释                              |
| 健康安全  | ★★★★★ | 5层HealthModifier（veto → heavy → goal → condition → bonus）                                |
| 性能/缓存 | ★★★½☆ | TieredCache(L1+L2) + RequestScopedCache + CacheWarmup + 10分片                              |
| 学习能力  | ★★★☆☆ | FactorLearner因子级学习（但仅内存，重启丢失）                                               |
| 模块治理  | ★★★★☆ | DietModule拆分为3个子模块（Recommendation 32 providers, Explanation 6, Tracking 5）         |
| 食谱组装  | ★★★½☆ | 双阶段（DB匹配 + 智能组装）+ RecipeNutrition聚合 + 自然菜名生成                             |

### 1.2 存在的问题

#### A. 学习能力不持久

- **FactorLearnerService** 仅使用内存 Map 存储，应用重启后所有学习结果丢失
- 学习率固定 0.02，无法根据用户活跃度自适应
- 无法跨请求共享学习状态（RequestScope隔离）

#### B. 画像更新不实时

- 偏好画像 `PreferenceProfileService` 用 Redis 缓存 5 分钟 TTL，但**触发是被动的**（下次推荐时才刷新）
- 用户反馈（accept/replace/skip）提交后，画像不会立即更新
- 缺少事件驱动机制：feedback → profile update → next recommendation 是断裂的

#### C. 推荐策略不可配置

- PipelineBuilder 的 Recall → Rank → Rerank 流程是硬编码的
- 不同用户群体（新用户 vs 老用户、减脂 vs 增肌）应该有不同的策略组合
- Legacy ranking path 与 ScoringChain 双路径共存，增加维护成本

#### D. 食物数据不够大众化

- 种子数据以原材料为主（ingredient），成品菜（dish）偏少
- 缺少常见大众菜品（如：番茄炒蛋、宫保鸡丁、麻婆豆腐等）
- `dishPriority` 字段虽已存在但种子数据中大部分未设置

#### E. 营养精细度不足

- `addedSugar` vs `naturalSugar` 虽有字段但大部分食物数据为 null
- 缺少 Omega-3/Omega-6 脂肪酸比例（对心血管健康关键）
- 膳食纤维未区分可溶性/不可溶性

#### F. ExplanationGenerator DI 问题

- 内部通过 `new` 手动实例化 InsightGeneratorService、ExplanationTierService、NaturalLanguageExplainerService
- 绕过了 NestJS DI 容器，破坏可测试性和生命周期管理

---

## 2. 核心升级方向

### 方向1：事件驱动画像更新（Event-Driven Profile）

**为什么需要：** 当前画像更新是"被动拉取"模式。用户在 14:00 提交了"不喜欢这个推荐"的反馈，但画像可能到 14:05（下次推荐请求时）才刷新。更糟的是，如果用户在 14:01 再次请求推荐，拿到的还是旧画像驱动的结果。

**解决什么问题：**

- 反馈→画像→推荐 的实时联动
- 画像变更可审计（事件日志）
- 为未来 WebSocket 实时推送打基础

**具体方案：**

- 引入 `ProfileEventBus`（基于 NestJS EventEmitter2）
- 定义事件类型：`feedback.submitted`, `profile.updated`, `preference.changed`
- FeedbackService 提交反馈后发射事件 → PreferenceProfileService 监听并增量更新缓存

### 方向2：策略引擎（Strategy Engine）

**为什么需要：** 当前 PipelineBuilder 的推荐流程是一条固定管道。但实际上：

- 新用户需要更多 exploration（多样性优先）
- 老用户需要更多 exploitation（精准匹配）
- 减脂用户需要更严格的热量控制
- 食堂场景需要更强的可获得性过滤

**解决什么问题：**

- 消除 Legacy ranking path（统一到 ScoringChain）
- 不同用户/场景可选择不同策略配置
- 策略可热更新（不需要重新部署）

**具体方案：**

- 定义 `RecommendationStrategy` 接口（recall策略 + rank策略 + rerank策略 + filter链）
- 内置 4 个策略预设：`explore`（新用户）、`exploit`（成熟用户）、`strict_health`（减脂/健康目标）、`scene_first`（场景优先）
- `StrategyResolverService` 根据用户成熟度 + 目标 + 场景自动选择

### 方向3：FactorLearner 持久化 + 自适应学习

**为什么需要：** V7.3 的 FactorLearner 学习结果存在内存中，重启即丢失。14天的用户行为学习成果会因一次部署而清零。

**解决什么问题：**

- 学习状态持久化到 Redis（带TTL自动过期）
- 自适应学习率（活跃用户学得快，低频用户学得慢）
- 学习状态可导出/调试

**具体方案：**

- 将 `factorStrengths` Map 序列化到 Redis Hash（key = `factor-learner:{userId}:{goalType}`）
- 引入 `adaptiveLearningRate(feedbackCount)`：前20次 0.05（快速探索），20-100次 0.02（稳定学习），100+次 0.01（微调）
- 增加 `exportLearnerState()` 和 `importLearnerState()` 方法

### 方向4：食物数据大众化增强

**为什么需要：** 用户看到推荐"鸡胸肉"、"西蓝花"、"糙米"觉得不贴近现实。实际生活中用户想看到的是"番茄炒蛋"、"麻婆豆腐"、"鸡蛋灌饼"这样的成品菜。

**解决什么问题：**

- 提升推荐结果的现实感和可执行性
- 填充 foodForm='dish' 的种子数据
- 让模板系统有足够的成品菜可填充

**具体方案：**

- 新增 80+ 大众成品菜种子数据（覆盖早中晚 + 8大菜系）
- 每个 dish 设置合理的 dishPriority（60-95）
- 补充 cuisine、cookingMethod、prepTimeMinutes 等烹饪维度
- 新增 `acquisitionDifficulty` 字段（1-5，标记食物获取难度）

### 方向5：营养评估精细化

**为什么需要：** 当前 NRF11.4 覆盖了主要宏/微量营养素，但在以下场景不够精细：

- 心血管健康用户需要 Omega-3/Omega-6 比例
- 糖尿病用户需要区分 addedSugar vs naturalSugar 的实际数据
- 肠道健康需要可溶性/不可溶性纤维的区分

**解决什么问题：**

- 面向特定健康条件的精细化营养建议
- 提升 HealthModifierEngine 的判断精度
- 为未来营养报告提供更丰富的数据

**具体方案：**

- FoodLibrary 新增 `omega3`, `omega6`（mg/100g），`solubleFiber`, `insolubleFiber`（g/100g）
- NRF 评分可选扩展到 NRF13.5（+omega3, +solubleFiber / +omega6SatFatRatio）
- 种子数据补充这些字段（优先高频食物）

### 方向6：ExplanationGenerator DI 修复 + 解释能力增强

**为什么需要：** ExplanationGeneratorService 通过 `new` 手动创建依赖，绕过 NestJS DI 容器。这导致：

- 无法在测试中 mock 子依赖
- 子服务的生命周期不受容器管理
- 日志/监控无法追踪子服务

**解决什么问题：**

- 修复 DI 反模式
- 增加"对比解释"能力（为什么选A不选B）
- 增加"替代建议解释"（如果不吃A，推荐B因为...）

**具体方案：**

- 将 InsightGeneratorService、ExplanationTierService、NaturalLanguageExplainerService 改为构造器注入
- 新增 `generateComparisonExplanation(foodA, foodB, context)` 方法
- 新增 `generateSubstitutionExplanation(original, substitute, context)` 方法

---

## 3. 架构升级设计

### V7.3 → V7.4 架构差异

```
V7.3 架构:
┌─────────────────────────────────────────────────────┐
│ RecommendationEngineService                         │
│  ├─ ProfileResolverService (5-layer)                │
│  ├─ SceneResolverService (4-priority)               │
│  ├─ PipelineBuilderService                          │
│  │   ├─ ScoringChain (10 factors)                   │
│  │   ├─ Legacy Ranking Path ← [冗余]               │
│  │   ├─ FoodScorerService (13 dimensions)           │
│  │   └─ RealisticFilterService                      │
│  ├─ MealTemplateService (8 templates)               │
│  ├─ MealAssemblerService                            │
│  ├─ RecipeAssemblerService                          │
│  ├─ InsightGeneratorService                         │
│  ├─ ExplanationGeneratorService                     │
│  │   ├─ NaturalLanguageExplainerService             │
│  │   └─ [手动 new 创建子依赖] ← [问题]              │
│  ├─ FactorLearnerService [内存存储] ← [问题]        │
│  └─ RequestScopedCacheService                       │
└─────────────────────────────────────────────────────┘

V7.4 新增/变更:
┌─────────────────────────────────────────────────────┐
│ RecommendationEngineService                         │
│  ├─ ProfileResolverService (5-layer)                │
│  │   └─ [新] ProfileEventBus ← 事件驱动更新         │
│  ├─ SceneResolverService (4-priority)               │
│  ├─ [新] StrategyResolverService ← 策略引擎         │
│  │   ├─ RecommendationStrategy 接口                 │
│  │   └─ 4个预设策略 (explore/exploit/strict/scene)  │
│  ├─ PipelineBuilderService                          │
│  │   ├─ ScoringChain (10 factors)                   │
│  │   ├─ [删] Legacy Ranking Path ← 统一到Chain      │
│  │   ├─ FoodScorerService (13+2 dimensions)         │
│  │   │   └─ [新] acquisitionScore, omega3Score      │
│  │   └─ RealisticFilterService                      │
│  ├─ MealTemplateService (8+4 templates)             │
│  ├─ MealAssemblerService                            │
│  ├─ RecipeAssemblerService                          │
│  ├─ InsightGeneratorService                         │
│  ├─ ExplanationGeneratorService                     │
│  │   ├─ NaturalLanguageExplainerService [DI注入]    │
│  │   ├─ InsightGeneratorService [DI注入]            │
│  │   ├─ ExplanationTierService [DI注入]             │
│  │   ├─ [新] generateComparisonExplanation()        │
│  │   └─ [新] generateSubstitutionExplanation()      │
│  ├─ FactorLearnerService [Redis持久化]              │
│  │   └─ [新] adaptiveLearningRate()                 │
│  └─ RequestScopedCacheService                       │
│                                                     │
│  [新] ProfileEventBus                               │
│  ├─ feedback.submitted → 增量画像更新               │
│  ├─ profile.updated → 缓存刷新                     │
│  └─ preference.changed → 策略重评估                 │
└─────────────────────────────────────────────────────┘
```

### 新增模块/服务清单

| 组件                      | 类型      | 归属模块             | 说明                                      |
| ------------------------- | --------- | -------------------- | ----------------------------------------- |
| `ProfileEventBus`         | Service   | RecommendationModule | EventEmitter2 包装，画像事件总线          |
| `ProfileEventListener`    | Listener  | RecommendationModule | 监听事件并触发画像更新                    |
| `StrategyResolverService` | Service   | RecommendationModule | 根据用户/场景选择推荐策略                 |
| `RecommendationStrategy`  | Interface | Types                | 策略定义接口                              |
| `4个策略预设`             | Constants | Types                | explore/exploit/strict_health/scene_first |

### 变更模块/服务清单

| 组件                          | 变更内容                                                                  |
| ----------------------------- | ------------------------------------------------------------------------- |
| `FactorLearnerService`        | 内存 → Redis 持久化 + 自适应学习率                                        |
| `ExplanationGeneratorService` | DI 修复 + 新增对比/替代解释方法                                           |
| `PipelineBuilderService`      | 删除 Legacy path + 集成策略引擎                                           |
| `FoodScorerService`           | 新增 acquisitionScore 维度                                                |
| `FoodLibrary`                 | 新增 omega3/omega6/solubleFiber/insolubleFiber/acquisitionDifficulty 字段 |
| `NutritionTargetService`      | 可选 NRF13.5 扩展                                                         |
| `seed-foods.data.ts`          | 新增 80+ 大众成品菜                                                       |

---

## 4. 模块级升级设计

### 4.1 Profile 模块（事件驱动画像）

**当前状态：** 被动拉取，5分钟 Redis TTL 刷新。

**V7.4 升级：**

```typescript
// 新增 ProfileEventBus
@Injectable()
export class ProfileEventBus {
  constructor(private eventEmitter: EventEmitter2) {}

  emitFeedbackSubmitted(event: FeedbackSubmittedEvent): void;
  emitProfileUpdated(event: ProfileUpdatedEvent): void;
  emitPreferenceChanged(event: PreferenceChangedEvent): void;
}

// 新增 ProfileEventListener
@Injectable()
export class ProfileEventListener {
  @OnEvent('feedback.submitted')
  async handleFeedback(event: FeedbackSubmittedEvent): Promise<void> {
    // 1. 增量更新 PreferenceProfile 缓存
    // 2. 触发 FactorLearner 学习
    // 3. 刷新 Redis 缓存
  }
}
```

**关键设计决策：**

- 使用 NestJS 内置的 `@nestjs/event-emitter`（基于 EventEmitter2），不引入外部消息队列
- 事件处理是异步非阻塞的，不影响反馈提交的响应时间
- 画像更新失败不影响主流程（catch + log）

### 4.2 Recommendation 模块（策略引擎）

**当前状态：** PipelineBuilder 硬编码 Recall → Rank → Rerank，双路径（Chain + Legacy）。

**V7.4 升级：**

```typescript
// 策略定义接口
interface RecommendationStrategy {
  name: string;
  description: string;

  // 召回阶段配置
  recall: {
    poolSizeMultiplier: number; // 候选池放大系数（默认1.0）
    diversityBoost: number; // 多样性提升（0-1）
    categorySpread: number; // 品类分散度要求
  };

  // 排序阶段配置
  rank: {
    scoringWeightOverrides: Partial<Record<ScoreDimension, number>>;
    factorStrengthOverrides: Record<string, number>;
    explorationRate: number; // epsilon-greedy 探索率（0-1）
  };

  // 重排阶段配置
  rerank: {
    realismLevel: RealismLevel;
    maxSameCategory: number; // 同品类最大数量
    acquisitionDifficultyMax: number; // 最大获取难度
  };
}

// 4个预设策略
const BUILT_IN_STRATEGIES: Record<string, RecommendationStrategy> = {
  explore: {
    /* 新用户：高多样性、高探索率、低现实约束 */
  },
  exploit: {
    /* 成熟用户：低探索率、高精准匹配、强偏好信号 */
  },
  strict_health: {
    /* 健康目标：严格热量、强健康修正、低糖低脂优先 */
  },
  scene_first: {
    /* 场景优先：强场景评分、高可获得性权重、模板优先 */
  },
};
```

**StrategyResolverService 选择逻辑：**

```
if (feedbackCount < 10)           → explore
else if (goalType in [fat_loss, health] && healthConditions.length > 0) → strict_health
else if (sceneContext.sceneType in [canteen_meal, convenience_meal])     → scene_first
else                               → exploit
```

### 4.3 Nutrition / Scoring

**当前状态：** NRF11.4（11鼓励 + 4限制），13个评分维度。

**V7.4 升级：**

新增字段：

```typescript
// FoodLibrary 新增
omega3?: number;               // mg/100g, EPA+DHA+ALA
omega6?: number;               // mg/100g
solubleFiber?: number;         // g/100g
insolubleFiber?: number;       // g/100g
acquisitionDifficulty?: number; // 1-5（1=超市随处可买, 5=需要特殊渠道）
```

新增评分维度：

```typescript
// SCORE_DIMENSIONS 新增
'acquisition'; // 基于 acquisitionDifficulty 的可获得性评分（越容易获取越高分）
```

**NRF 扩展策略：**

- 默认仍使用 NRF11.4（向后兼容）
- 当用户有心血管相关 healthConditions 时，自动升级到 NRF13.5
- NRF13.5 新增鼓励：omega3, solubleFiber；新增限制：omega6SatFatRatio

### 4.4 Cache / 性能

**当前状态：** TieredCache(L1 30min + L2 60min Redis) + RequestScopedCache + CacheWarmup。

**V7.4 升级：**

FactorLearner 持久化：

```typescript
// Redis Hash 结构
// Key: factor-learner:{userId}:{goalType}
// Fields: {factorName}: {strength}
// TTL: 30天（活跃用户自动续期）

async loadFromRedis(userId: string, goalType: string): Promise<Map<string, number>>;
async saveToRedis(userId: string, goalType: string, strengths: Map<string, number>): Promise<void>;
```

CacheWarmup 增强：

```typescript
// 补全用户画像预热（V7.3 只查了ID没预热画像）
async warmUserProfiles(userIds: string[]): Promise<void> {
  for (const batch of chunk(userIds, 10)) {
    await Promise.all(batch.map(id => this.preferenceProfileService.getOrBuild(id)));
  }
}
```

### 4.5 数据流

**V7.4 事件流设计：**

```
用户反馈提交
    │
    ├─→ FeedbackService.submit()           [同步，返回响应]
    │
    └─→ ProfileEventBus.emit('feedback.submitted')  [异步]
         │
         ├─→ PreferenceProfileService.incrementalUpdate()
         │     └─→ Redis cache invalidate + rebuild
         │
         ├─→ FactorLearnerService.attributeFeedback()
         │     └─→ Redis persistence
         │
         └─→ ReplacementPatternService.recordIfReplacement()
               └─→ DB update
```

---

## 5. 技术路线图

### Phase 1（短期 — 数据增强 + 持久化修复）

优先"可执行性"和"真实场景"，修复最紧迫的数据和工程问题。

| 编号 | 任务                         | 说明                                             | 影响范围                                                |
| ---- | ---------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| P1-A | 食物数据大众化               | 新增 80+ 大众成品菜种子数据（foodForm=dish）     | seed-foods.data.ts                                      |
| P1-B | acquisitionDifficulty 字段   | FoodLibrary + Prisma + 种子数据 + 食物池加载     | food.types.ts, schema.prisma, food-pool-cache           |
| P1-C | FactorLearner Redis 持久化   | 内存 → Redis Hash，自适应学习率                  | factor-learner.service.ts                               |
| P1-D | ExplanationGenerator DI 修复 | 手动 new → 构造器注入                            | explanation-generator.service.ts, explanation.module.ts |
| P1-E | Legacy Ranking Path 清理     | 删除 rankCandidatesLegacy()，统一到 ScoringChain | pipeline-builder.service.ts                             |
| P1-F | CacheWarmup 用户画像预热     | 补全 warmUserProfiles() 实现                     | cache-warmup.service.ts                                 |
| P1-G | 编译验证 + V7.4 集成测试     | tsc --noEmit + 新测试                            | test/v7.4-integration.spec.ts                           |

### Phase 2（中期 — 策略引擎 + 事件驱动 + 解释增强）

架构增强，引入新模块。

| 编号 | 任务                           | 说明                                                            | 影响范围                                  |
| ---- | ------------------------------ | --------------------------------------------------------------- | ----------------------------------------- |
| P2-A | 策略引擎 — 接口 + 4预设        | RecommendationStrategy 接口 + 4个策略定义                       | 新文件: strategy.types.ts                 |
| P2-B | StrategyResolverService        | 根据用户画像/场景自动选策略                                     | 新文件: strategy-resolver.service.ts      |
| P2-C | PipelineBuilder 集成策略       | executeRolePipeline() 接受策略参数                              | pipeline-builder.service.ts               |
| P2-D | 事件驱动画像 — ProfileEventBus | EventEmitter2 包装 + 事件类型定义                               | 新文件: profile-event-bus.service.ts      |
| P2-E | ProfileEventListener           | 监听 feedback.submitted → 增量画像更新                          | 新文件: profile-event-listener.service.ts |
| P2-F | 解释能力增强                   | generateComparisonExplanation + generateSubstitutionExplanation | explanation-generator.service.ts          |
| P2-G | 编译验证 + Phase 2 集成测试    | tsc --noEmit + 新测试追加                                       | test/v7.4-integration.spec.ts             |

### Phase 3（长期 — 营养精细化 + acquisition评分 + 集成验证）

精细化营养评估和全量回归验证。

| 编号 | 任务                 | 说明                                      | 影响范围                                            |
| ---- | -------------------- | ----------------------------------------- | --------------------------------------------------- |
| P3-A | 营养字段扩展         | omega3/omega6/solubleFiber/insolubleFiber | food.types.ts, schema.prisma, food-pool-cache       |
| P3-B | NRF13.5 可选扩展     | 心血管用户自动升级 NRF                    | nutrition-target.service.ts, food-scorer.service.ts |
| P3-C | acquisition 评分维度 | FoodScorer 新增维度 + 权重                | food-scorer.service.ts, recommendation.types.ts     |
| P3-D | 种子数据营养补充     | 高频食物补充 omega3/fiber 细分数据        | seed-foods.data.ts                                  |
| P3-E | i18n 新增消息        | 策略/事件/新维度相关翻译                  | i18n-messages.ts                                    |
| P3-F | 全量回归测试         | V6.9~V7.4 全部通过                        | test/v7.4-integration.spec.ts                       |
| P3-G | 编译验证 + 最终确认  | tsc --noEmit 零错误                       | —                                                   |

---

## 6. 数据迁移

### 6.1 Prisma Schema 变更

```prisma
// foods 表新增字段
model foods {
  // ... 已有字段 ...

  // V7.4 新增
  acquisition_difficulty  Int?       @default(3)    // 1-5, 食物获取难度
  omega3                  Float?                     // mg/100g
  omega6                  Float?                     // mg/100g
  soluble_fiber           Float?                     // g/100g
  insoluble_fiber         Float?                     // g/100g
}
```

### 6.2 种子数据迁移

- 新增 80+ 大众成品菜（foodForm='dish'）
- 现有 ingredient 类食物补充 acquisitionDifficulty 值
- 高频食物补充 omega3/omega6/fiber 细分值

### 6.3 Redis 结构新增

```
factor-learner:{userId}:{goalType}  →  Hash { factorName: strengthValue }
  TTL: 30 days (活跃用户自动续期)
```

---

## 7. 文档差异

### 新增章节

- 4.2 策略引擎设计（Strategy Engine）
- 4.5 事件驱动画像更新（Event-Driven Profile）
- 5.3 Phase 3 营养精细化

### 修改内容

- 1.1 能力评级表更新（学习能力 ★★★☆☆ → ★★★★☆）
- 1.2 问题清单更新（标注已修复项）
- 4.1 FoodLibrary 字段列表扩展
- 4.3 NRF 评分模型升级说明
- 4.4 FactorLearnerService 持久化机制变更

### 删除内容

- Legacy Ranking Path 相关文档说明（统一到 ScoringChain 后不再需要）
