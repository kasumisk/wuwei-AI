# 智能饮食推荐系统 V7.2 升级方案

> 主题：**评分管道工程化 + 现实策略可配置 + 代码质量治理**
>
> 基于 V7.1 架构增量升级，不重写、不推翻。

---

## 一、能力评估（Step 1）

### 1.1 当前系统已具备能力

| 能力层   | V7.1 现状                                                         | 成熟度 |
| -------- | ----------------------------------------------------------------- | ------ |
| 用户画像 | NutritionProfile + PreferencesProfile + KitchenProfile + 行为推断 | ★★★★   |
| 推荐引擎 | 13维评分 + 3路召回(规则/语义/CF) + Pipeline(recall→rank→rerank)   | ★★★★   |
| 场景系统 | 5级场景解析(explicit→behavior→rule→default) + 厨房设备约束        | ★★★☆   |
| 执行追踪 | 5级语义匹配 + 替换模式挖掘 + 高频替换boost                        | ★★★☆   |
| 可解释性 | 10种洞察类型 + 对比解释 + 可视化V2 + 付费分层                     | ★★★★   |
| 跨餐联动 | 4条营养补偿规则 + 奖惩双向多样性 + 风味/温度追踪                  | ★★★☆   |
| 缓存机制 | Redis L2 + 内存L1(per-request) + 食物池缓存                       | ★★★☆   |
| 健康修正 | 5层惩罚/奖励管道 + 9种健康状况 + 严重度分级                       | ★★★★   |
| 在线学习 | 权重学习(全局+用户+餐次) + Thompson Sampling探索                  | ★★★☆   |

### 1.2 存在问题

#### A. 架构层问题

| 问题                                 | 位置                                     | 影响                                        |
| ------------------------------------ | ---------------------------------------- | ------------------------------------------- |
| **rankCandidates() 过度复杂**        | pipeline-builder.service.ts L285, 400+行 | 15+个boost/penalty顺序耦合，无法独立A/B测试 |
| **PipelineContext 字段膨胀**         | recommendation.types.ts L421, 50+字段    | 测试困难，演化脆弱                          |
| **recommendation.types.ts 职责混杂** | 1717行混合类型/常量/纯函数               | 维护成本高                                  |
| **ExplanationGenerator 过大**        | 1835行混合解释/付费/洞察/对比            | 单一职责违反                                |
| **DietModule 55+providers**          | diet.module.ts                           | 违反单一职责，启动慢                        |
| **RecommendationEngine 28个DI依赖**  | recommendation-engine.service.ts         | God Class                                   |

#### B. 数据层问题

| 问题                              | 位置          | 影响                                    |
| --------------------------------- | ------------- | --------------------------------------- |
| **foods表70+列含3个废弃字段**     | schema.prisma | 存储浪费，新人困惑                      |
| **recommendation_executions缺FK** | schema.prisma | 数据完整性无保障                        |
| **FoodLibrary可选字段过多**       | food.types.ts | 大量 `Number(food.xxx) \|\| 0` 防御代码 |

#### C. 算法/推荐问题

| 问题                            | 影响                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| **现实策略不可配置**            | filterByRealism 6层过滤规则硬编码，无法按用户/场景关闭                           |
| **跨餐补偿规则硬编码**          | 4条规则内联在 DailyPlanContext 中，不可配置                                      |
| **Thompson Sampling先验硬编码** | alpha/beta 固定，无法按用户反馈量调整                                            |
| **可获得性区域代理不准**        | regionalProxy 用 commonalityScore 近似，未用 food_regional_info.local_popularity |

#### D. 工程问题

| 问题                                       | 影响                                                      |
| ------------------------------------------ | --------------------------------------------------------- |
| **PreferenceProfile 内存缓存**             | 多实例不一致                                              |
| **generateStructuredInsights 9个位置参数** | 调用困难，易出错                                          |
| **@deprecated 方法未清理**                 | MealAssembler 80+行废弃代码                               |
| **17个service无测试覆盖**                  | weight-learner, recall-merger, cf-recall 等核心路径零覆盖 |

---

## 二、核心升级方向（Step 2）

### 方向1：评分管道链式化（Scoring Pipeline Chain）

**为什么需要**：当前 `rankCandidates()` 是400+行的顺序boost/penalty堆砌。每新增一个因子（如V7.1的preferenceSignal）都需要改这个巨型方法，风险高、无法独立A/B测试。

**解决什么问题**：

- 每个评分因子可独立启用/禁用/测试
- 新因子即插即用，不改主流程
- 为未来ML模型替换单个因子铺路

**实现方式**：将 rankCandidates 内部的15+个boost/penalty提取为 `ScoringFactor` 接口的实现类，通过 `ScoringChain` 按配置顺序执行。

### 方向2：现实策略可配置化（Configurable Realism）

**为什么需要**：用户明确要求"可以配置是否现实策略"。当前 `filterByRealism()` 的6层过滤规则全部硬编码，无法按用户偏好或场景动态调整。

**解决什么问题**：

- 用户可选择 strict/normal/relaxed/off 四档现实策略
- 每层过滤规则的阈值可配置
- 场景自动适配（外卖场景放宽烹饪时间限制，食堂场景放宽设备限制）

### 方向3：跨餐补偿规则引擎化（Cross-Meal Rule Engine）

**为什么需要**：V7.1的4条跨餐补偿规则内联在代码中，新增规则需要改服务代码。营养补偿是未来差异化的核心能力，需要能快速迭代。

**解决什么问题**：

- 补偿规则声明式定义，支持运行时增删
- 规则间优先级/冲突检测
- 规则命中可追溯（已有 reason 字段，需标准化）

### 方向4：洞察生成器参数对象化 + 解释模块拆分

**为什么需要**：`generateStructuredInsights()` 有9个位置参数，每次扩展都需要改所有调用点。ExplanationGenerator 1835行混合了4种不同职责。

**解决什么问题**：

- 参数对象化：一个 `InsightContext` 替代9个位置参数
- 职责拆分：核心解释 / 结构化洞察 / 付费分层 三个独立服务
- 新增洞察类型零改动主接口

### 方向5：代码质量治理（Technical Debt Cleanup）

**为什么需要**：17个service零测试覆盖；3个废弃schema字段；80+行@deprecated代码；(food as any)类型强转散布各处。

**解决什么问题**：

- 消除技术债务，降低维护成本
- 提升类型安全，减少运行时错误
- 为V8.0架构演进打基础

### 方向6：偏好缓存Redis化 + 批量评分优化

**为什么需要**：PreferenceProfileService 使用内存缓存，多实例部署时不一致。scoreBatch() 是朴素循环，无批量优化。

**解决什么问题**：

- 多实例缓存一致性
- 大食物池（1000+）评分性能提升

---

## 三、架构升级设计（Step 3）

### 3.1 V7.2 架构变更图

```
V7.1 Architecture:
──────────────────
RecommendationEngine (God Class, 28 DI)
  ├── PipelineBuilder.recallCandidates()
  ├── PipelineBuilder.rankCandidates()     ← 400+行顺序boost
  ├── PipelineBuilder.rerankAndSelect()
  ├── FoodScorer.scoreFoodDetailed()
  ├── ExplanationGenerator (1835行, 混合职责)
  └── ...其他27个注入

V7.2 Architecture (变更部分):
──────────────────────────────
PipelineBuilder.rankCandidates()
  └── ScoringChain                         ← 【新增】链式评分管道
        ├── NutritionFactor                ← 提取自 rankCandidates
        ├── PreferenceFactor               ← 提取自 rankCandidates
        ├── DiversityFactor                ← 提取自 rankCandidates
        ├── AvailabilityFactor             ← 提取自 rankCandidates
        ├── FreshnessFactor                ← 提取自 rankCandidates
        ├── RealisticFactor                ← 提取自 rankCandidates
        └── ... (可插拔)

RealisticFilterService
  └── RealismConfig                        ← 【新增】可配置现实策略
        ├── 用户级: strict/normal/relaxed/off
        ├── 场景级: 自动适配
        └── 规则级: 每层阈值可配置

DailyPlanContextService
  └── CrossMealRuleEngine                  ← 【新增】声明式规则引擎
        ├── Rule[]                         ← 声明式规则数组
        ├── evaluate(state, target)
        └── resolveConflicts()

ExplanationGeneratorService (拆分)
  ├── ExplanationGeneratorService          ← 保留核心解释（~800行）
  ├── InsightGeneratorService              ← 【新增】结构化洞察（~500行）
  └── ExplanationTierService               ← 【新增】付费分层（~200行）
```

### 3.2 新增/变更模块清单

| 模块                      | 类型 | 说明                                                 |
| ------------------------- | ---- | ---------------------------------------------------- |
| `ScoringChain`            | 新增 | 链式评分管道，管理ScoringFactor执行顺序              |
| `ScoringFactor` (接口)    | 新增 | 评分因子接口：`apply(food, ctx) → ScoringAdjustment` |
| `RealismConfig` (类型)    | 新增 | 现实策略配置：level + 每层阈值                       |
| `CrossMealRule` (接口)    | 新增 | 声明式跨餐规则：`condition + action + priority`      |
| `InsightGeneratorService` | 新增 | 从ExplanationGenerator拆出的洞察服务                 |
| `ExplanationTierService`  | 新增 | 从ExplanationGenerator拆出的付费分层服务             |
| `InsightContext` (类型)   | 新增 | 替代 generateStructuredInsights 的9个位置参数        |

---

## 四、模块级升级设计（Step 4）

### 4.1 Recommendation 模块 — 评分管道链式化

#### 4.1.1 ScoringFactor 接口

```typescript
// === recommendation/scoring-chain/scoring-factor.interface.ts ===

/** 单个评分因子的调整结果 */
export interface ScoringAdjustment {
  /** 乘法因子（默认1.0，>1加分，<1减分） */
  multiplier: number;
  /** 加法偏移（默认0，用于bonus/penalty） */
  additive: number;
  /** 调整原因（用于解释性） */
  reason: string;
  /** 因子名称 */
  factorName: string;
}

/** 评分因子上下文 — 从 PipelineContext 投影出因子需要的字段 */
export interface ScoringFactorContext {
  goalType: string;
  mealType?: string;
  sceneContext: SceneContext;
  dailyPlanState?: DailyPlanState;
  preferenceSignal?: PreferenceSignal;
  preferencesProfile?: PreferencesProfile;
  crossMealAdjustment?: CrossMealAdjustment;
  kitchenProfile?: KitchenProfile;
  substitutions?: SubstitutionPattern[];
  scoringConfig?: ScoringConfigSnapshot;
}

/** 评分因子接口 */
export interface ScoringFactor {
  /** 因子唯一标识 */
  readonly name: string;
  /** 执行优先级（数字越小越先执行） */
  readonly order: number;
  /** 是否启用（可运行时切换） */
  isEnabled(ctx: ScoringFactorContext): boolean;
  /** 计算调整值 */
  apply(food: FoodLibrary, baseScore: number, ctx: ScoringFactorContext): ScoringAdjustment;
}
```

#### 4.1.2 ScoringChain 服务

```typescript
// === recommendation/scoring-chain/scoring-chain.service.ts ===

export interface ScoringChainResult {
  finalScore: number;
  adjustments: ScoringAdjustment[];
}

@Injectable()
export class ScoringChainService {
  private factors: ScoringFactor[] = [];

  registerFactor(factor: ScoringFactor): void;
  removeFactor(name: string): void;
  execute(food: FoodLibrary, baseScore: number, ctx: ScoringFactorContext): ScoringChainResult;
}
```

#### 4.1.3 从 rankCandidates 提取的因子

| 因子名                     | 来源位置                | 功能           | order |
| -------------------------- | ----------------------- | -------------- | ----- |
| `NutritionGapFactor`       | rankCandidates L340-370 | 营养缺口boost  | 10    |
| `RecentPenaltyFactor`      | rankCandidates L375-395 | 近期重复惩罚   | 20    |
| `CrossMealDiversityFactor` | rankCandidates L400-420 | 跨餐多样性奖惩 | 30    |
| `PreferenceSignalFactor`   | rankCandidates L425-445 | 偏好信号乘数   | 40    |
| `AvailabilityTimeFactor`   | rankCandidates L450-470 | 时段可获得性   | 50    |
| `RealisticAdjustFactor`    | rankCandidates L475-495 | 现实性微调     | 60    |
| `FreshnessFactor`          | rankCandidates L500-520 | 新鲜度/时令    | 70    |
| `LifestyleBoostFactor`     | rankCandidates L525-540 | 生活方式加分   | 80    |

> 注：具体行号为估计值，实施时按实际代码提取。

### 4.2 现实策略可配置化

#### 4.2.1 RealismConfig 类型

```typescript
// === recommendation.types.ts 新增 ===

export type RealismLevel = 'strict' | 'normal' | 'relaxed' | 'off';

export interface RealismConfig {
  /** 现实策略级别 */
  level: RealismLevel;
  /** 各层过滤阈值（仅 level='custom' 时使用，预留） */
  thresholds?: {
    /** 最低大众化分数（0-1, 默认0.3） */
    minPopularityScore?: number;
    /** 最大烹饪时间（分钟, 默认60） */
    maxCookingTimeMinutes?: number;
    /** 最低技能要求（1-5, 默认3） */
    maxSkillLevel?: number;
    /** 是否启用设备约束 */
    enableEquipmentFilter?: boolean;
    /** 是否启用预算过滤 */
    enableBudgetFilter?: boolean;
    /** 是否启用食堂模式 */
    enableCanteenMode?: boolean;
  };
}

export const DEFAULT_REALISM_CONFIG: RealismConfig = { level: 'normal' };

/** 场景→默认现实级别映射 */
export const SCENE_REALISM_DEFAULTS: Record<string, RealismLevel> = {
  HOME_COOK: 'normal',
  RESTAURANT: 'relaxed',
  DELIVERY: 'relaxed',
  CANTEEN: 'strict',
  CONVENIENCE: 'strict',
  UNKNOWN: 'normal',
};
```

#### 4.2.2 RealismLevel 预设

| Level   | 大众化过滤 | 预算过滤 | 烹饪时间 | 食堂模式 | 技能限制 | 设备约束 |
| ------- | ---------- | -------- | -------- | -------- | -------- | -------- |
| strict  | ≥0.4       | 启用     | ≤45min   | 启用     | ≤2       | 启用     |
| normal  | ≥0.3       | 启用     | ≤60min   | 启用     | ≤3       | 启用     |
| relaxed | ≥0.1       | 禁用     | ≤120min  | 禁用     | ≤5       | 禁用     |
| off     | 不过滤     | 禁用     | 不限     | 禁用     | 不限     | 禁用     |

#### 4.2.3 用户配置入口

在 `user_profiles` 表的 `recommendation_preferences` JSON 字段中新增 `realismLevel` 字段。

UserProfileService.getRecommendationPreferences() 读取后传入 PipelineContext。

### 4.3 跨餐补偿规则引擎化

#### 4.3.1 CrossMealRule 接口

```typescript
// === recommendation/cross-meal-rules.ts 新增 ===

export interface CrossMealRule {
  /** 规则唯一标识 */
  id: string;
  /** 规则名称（用于日志/解释） */
  name: string;
  /** 优先级（数字越小越高） */
  priority: number;
  /** 条件判断 */
  condition: (
    state: DailyPlanState,
    mealIndex: number,
    dailyTarget: { calories: number; protein: number }
  ) => boolean;
  /** 执行动作（返回对 CrossMealAdjustment 的增量修改） */
  action: (
    state: DailyPlanState,
    mealIndex: number,
    dailyTarget: { calories: number; protein: number }
  ) => Partial<CrossMealAdjustment>;
}
```

#### 4.3.2 内置规则（从 computeCrossMealAdjustment 提取）

```typescript
export const BUILT_IN_CROSS_MEAL_RULES: CrossMealRule[] = [
  {
    id: 'light_breakfast',
    name: '轻早餐热量补偿',
    priority: 10,
    condition: (state, mealIndex, target) => {
      if (mealIndex < 1) return false;
      const breakfastRatio = state.accumulatedNutrition.calories / target.calories;
      return breakfastRatio < 0.2 && mealIndex === 1;
    },
    action: (state, _mi, target) => ({
      calorieMultiplier: 1.1,
      reason: `light_breakfast(${Math.round((state.accumulatedNutrition.calories / target.calories) * 100)}%<20%)`,
    }),
  },
  {
    id: 'high_carb_prev',
    name: '高碳上餐碳水降权',
    priority: 20,
    condition: (state, mealIndex) => {
      /* ... */
    },
    action: () => ({ weightOverrides: { carbs: 1.3 } }),
  },
  {
    id: 'protein_deficit',
    name: '蛋白质缺口补偿',
    priority: 30,
    condition: (state, mealIndex, target) => {
      /* ... */
    },
    action: () => ({ weightOverrides: { protein: 1.4 } }),
  },
  {
    id: 'cuisine_monotony',
    name: '菜系单一性奖励',
    priority: 40,
    condition: (state, mealIndex) => {
      /* ... */
    },
    action: () => ({ cuisineDiversityBonus: 0.05 }),
  },
];
```

### 4.4 洞察生成器参数对象化 + 解释模块拆分

#### 4.4.1 InsightContext 类型

```typescript
// === recommendation/insight.types.ts 新增 ===

export interface InsightContext {
  /** 已选食物（含评分） */
  scoredFoods: ScoredFood[];
  /** 餐次营养目标 */
  mealTarget: MealTarget;
  /** 当前有效目标 */
  effectiveGoal?: EffectiveGoal | null;
  /** 目标进度 */
  goalProgress?: GoalProgress | null;
  /** 每日计划状态 */
  dailyPlanState?: DailyPlanState | null;
  /** 评分配置 */
  scoringConfig?: ScoringConfigSnapshot | null;
  /** 跨餐调整 */
  crossMealAdjustment?: CrossMealAdjustment | null;
  /** 替换模式 */
  substitutions?: SubstitutionPattern[] | null;
}
```

#### 4.4.2 拆分后的服务

| 服务                          | 来源行号   | 职责                                     |
| ----------------------------- | ---------- | ---------------------------------------- |
| `ExplanationGeneratorService` | L1-1060    | 核心解释(generate/V2/batch/whyNot/delta) |
| `InsightGeneratorService`     | L1454-1835 | 结构化洞察(generateStructuredInsights)   |
| `ExplanationTierService`      | L958-1060  | 付费分层(applyUpgradeTeaser)             |

### 4.5 代码质量治理

| 任务                                 | 改动                                                              |
| ------------------------------------ | ----------------------------------------------------------------- |
| 清理 @deprecated 方法                | MealAssembler.addExploration + sampleBeta/Gamma/StdNormal (~80行) |
| 清理废弃Schema字段                   | foods: fiber_per_100g, sugar_per_100g, sodium_per_100g            |
| PreferenceProfile缓存Redis化         | 内存Map → Redis hash, TTL=5min                                    |
| generateStructuredInsights参数对象化 | 9个位置参数 → InsightContext                                      |

### 4.6 数据流（无变更）

V7.2 不引入新的事件流。现有数据流保持：

```
user action → API → RecommendationEngine → Pipeline → response
                 → ExecutionTracker.recordExecution() → DB
                 → WeightLearner (异步, 已有)
```

---

## 五、技术路线图（Step 5）

### Phase 1：基础扩展（类型 + 配置 + 迁移）

**目标**：新增类型定义、配置结构、数据迁移，为 Phase 2 的逻辑实现铺路。

| 任务                                                    | 改动文件                                         | 依赖   |
| ------------------------------------------------------- | ------------------------------------------------ | ------ |
| P1-A: 新增 ScoringFactor 接口 + ScoringAdjustment 类型  | 新增 `scoring-chain/scoring-factor.interface.ts` | 无     |
| P1-B: 新增 RealismConfig + RealismLevel 类型            | `recommendation.types.ts`                        | 无     |
| P1-C: 新增 CrossMealRule 接口 + 内置规则常量            | 新增 `cross-meal-rules.ts`                       | 无     |
| P1-D: 新增 InsightContext 类型                          | 新增 `insight.types.ts`                          | 无     |
| P1-E: Schema清理（废弃字段移除）+ 数据迁移              | `schema.prisma` + 迁移SQL                        | 无     |
| P1-F: RecommendationPreferences扩展（realismLevel字段） | `user.types.ts`                                  | P1-B   |
| P1-G: 编译验证                                          | —                                                | P1-A~F |

### Phase 2：核心逻辑实现

**目标**：实现评分链、现实策略配置化、跨餐规则引擎化、解释模块拆分。

| 任务                                  | 改动文件                                                                   | 依赖       |
| ------------------------------------- | -------------------------------------------------------------------------- | ---------- |
| P2-A: ScoringChainService 实现        | 新增 `scoring-chain/scoring-chain.service.ts`                              | P1-A       |
| P2-B: 提取 8 个 ScoringFactor 实现    | 新增 `scoring-chain/factors/*.ts`                                          | P1-A, P2-A |
| P2-C: RealisticFilter 配置化改造      | `realistic-filter.service.ts`                                              | P1-B       |
| P2-D: DailyPlanContext 规则引擎化     | `daily-plan-context.service.ts`                                            | P1-C       |
| P2-E: InsightGeneratorService 拆分    | 新增 `insight-generator.service.ts`, 改 `explanation-generator.service.ts` | P1-D       |
| P2-F: ExplanationTierService 拆分     | 新增 `explanation-tier.service.ts`, 改 `explanation-generator.service.ts`  | P2-E       |
| P2-G: @deprecated 代码清理            | `meal-assembler.service.ts`                                                | 无         |
| P2-H: PreferenceProfile 缓存 Redis 化 | `preference-profile.service.ts`                                            | 无         |

### Phase 3：管道集成 + 验证

**目标**：将 Phase 2 的能力集成到推荐管道，编写测试。

| 任务                                             | 改动文件                                                      | 依赖       |
| ------------------------------------------------ | ------------------------------------------------------------- | ---------- |
| P3-A: PipelineBuilder 集成 ScoringChain          | `pipeline-builder.service.ts`                                 | P2-A, P2-B |
| P3-B: RecommendationEngine 集成 RealismConfig    | `recommendation-engine.service.ts`, `user-profile.service.ts` | P2-C       |
| P3-C: RecommendationEngine 集成 InsightGenerator | `recommendation-engine.service.ts`                            | P2-E       |
| P3-D: DietModule 注册新服务                      | `diet.module.ts`                                              | P2-A~F     |
| P3-E: 集成测试                                   | 新增 `test/v7.2-integration.spec.ts`                          | P3-A~D     |
| P3-F: 编译验证 + 全量回归                        | —                                                             | P3-A~E     |

---

## 六、类型定义清单（Phase 1 输出物）

### 新增类型

```typescript
// === scoring-chain/scoring-factor.interface.ts ===

export interface ScoringAdjustment {
  multiplier: number;
  additive: number;
  reason: string;
  factorName: string;
}

export interface ScoringFactorContext {
  goalType: string;
  mealType?: string;
  sceneContext: SceneContext;
  dailyPlanState?: DailyPlanState;
  preferenceSignal?: PreferenceSignal;
  preferencesProfile?: PreferencesProfile;
  crossMealAdjustment?: CrossMealAdjustment;
  kitchenProfile?: KitchenProfile;
  substitutions?: SubstitutionPattern[];
  scoringConfig?: ScoringConfigSnapshot;
  recentFoodNames?: Set<string>;
  nutritionGaps?: string[];
}

export interface ScoringFactor {
  readonly name: string;
  readonly order: number;
  isEnabled(ctx: ScoringFactorContext): boolean;
  apply(food: FoodLibrary, baseScore: number, ctx: ScoringFactorContext): ScoringAdjustment;
}

// === recommendation.types.ts 新增 ===

export type RealismLevel = 'strict' | 'normal' | 'relaxed' | 'off';

export interface RealismConfig {
  level: RealismLevel;
  thresholds?: {
    minPopularityScore?: number;
    maxCookingTimeMinutes?: number;
    maxSkillLevel?: number;
    enableEquipmentFilter?: boolean;
    enableBudgetFilter?: boolean;
    enableCanteenMode?: boolean;
  };
}

export const DEFAULT_REALISM_CONFIG: RealismConfig = { level: 'normal' };

export const SCENE_REALISM_DEFAULTS: Record<string, RealismLevel> = {
  HOME_COOK: 'normal',
  RESTAURANT: 'relaxed',
  DELIVERY: 'relaxed',
  CANTEEN: 'strict',
  CONVENIENCE: 'strict',
  UNKNOWN: 'normal',
};

export const REALISM_PRESETS: Record<
  RealismLevel,
  Required<NonNullable<RealismConfig['thresholds']>>
> = {
  strict: {
    minPopularityScore: 0.4,
    maxCookingTimeMinutes: 45,
    maxSkillLevel: 2,
    enableEquipmentFilter: true,
    enableBudgetFilter: true,
    enableCanteenMode: true,
  },
  normal: {
    minPopularityScore: 0.3,
    maxCookingTimeMinutes: 60,
    maxSkillLevel: 3,
    enableEquipmentFilter: true,
    enableBudgetFilter: true,
    enableCanteenMode: true,
  },
  relaxed: {
    minPopularityScore: 0.1,
    maxCookingTimeMinutes: 120,
    maxSkillLevel: 5,
    enableEquipmentFilter: false,
    enableBudgetFilter: false,
    enableCanteenMode: false,
  },
  off: {
    minPopularityScore: 0,
    maxCookingTimeMinutes: Infinity,
    maxSkillLevel: Infinity,
    enableEquipmentFilter: false,
    enableBudgetFilter: false,
    enableCanteenMode: false,
  },
};

// === cross-meal-rules.ts ===

export interface CrossMealRule {
  id: string;
  name: string;
  priority: number;
  condition: (
    state: DailyPlanState,
    mealIndex: number,
    dailyTarget: { calories: number; protein: number }
  ) => boolean;
  action: (
    state: DailyPlanState,
    mealIndex: number,
    dailyTarget: { calories: number; protein: number }
  ) => Partial<CrossMealAdjustment>;
}

// === insight.types.ts ===

export interface InsightContext {
  scoredFoods: ScoredFood[];
  mealTarget: MealTarget;
  effectiveGoal?: EffectiveGoal | null;
  goalProgress?: GoalProgress | null;
  dailyPlanState?: DailyPlanState | null;
  scoringConfig?: ScoringConfigSnapshot | null;
  crossMealAdjustment?: CrossMealAdjustment | null;
  substitutions?: SubstitutionPattern[] | null;
}
```

### 修改类型

```typescript
// === user.types.ts 修改 ===

export interface RecommendationPreferences {
  // ... 已有字段保持不变 ...
  /** V7.2: 现实策略级别 */
  realismLevel?: RealismLevel;
}
```

---

## 七、测试计划

### V7.2 集成测试（v7.2-integration.spec.ts）

| 测试组                      | 测试点                                                            | 数量    |
| --------------------------- | ----------------------------------------------------------------- | ------- |
| ScoringChain                | 空链返回baseScore, 单因子乘法, 多因子组合, 禁用因子跳过, 排序执行 | 5       |
| ScoringFactor               | 8个因子各1个基本测试                                              | 8       |
| RealismConfig               | strict/normal/relaxed/off 四档过滤效果                            | 4       |
| 场景现实适配                | 外卖→relaxed, 食堂→strict, 自动映射                               | 3       |
| CrossMealRuleEngine         | 规则注册/执行/优先级/冲突/空规则                                  | 5       |
| InsightContext              | 参数对象化调用, 向后兼容, 新增洞察                                | 3       |
| 解释模块拆分                | InsightGenerator独立调用, TierService独立调用                     | 2       |
| 代码清理                    | @deprecated方法已移除, 类型安全                                   | 2       |
| PreferenceProfile Redis缓存 | 缓存命中/失效/多实例一致性                                        | 3       |
| 类型兼容性                  | 新类型字段验证                                                    | 5       |
| **总计**                    |                                                                   | **~40** |

---

## 八、依赖关系图

```
Phase 1（基础）
  P1-A: ScoringFactor 接口
  P1-B: RealismConfig 类型
  P1-C: CrossMealRule 接口
  P1-D: InsightContext 类型
  P1-E: Schema 清理 + 迁移
  P1-F: RecommendationPreferences 扩展  ← P1-B
  P1-G: 编译验证                        ← P1-A~F

Phase 2（核心逻辑）
  P2-A: ScoringChainService              ← P1-A
  P2-B: 8个 ScoringFactor 实现           ← P1-A, P2-A
  P2-C: RealisticFilter 配置化           ← P1-B
  P2-D: DailyPlanContext 规则引擎化      ← P1-C
  P2-E: InsightGenerator 拆分            ← P1-D
  P2-F: ExplanationTier 拆分             ← P2-E
  P2-G: @deprecated 清理                 ← 独立
  P2-H: PreferenceProfile Redis化        ← 独立

Phase 3（集成 + 验证）
  P3-A: PipelineBuilder 集成 ScoringChain  ← P2-A, P2-B
  P3-B: Engine 集成 RealismConfig          ← P2-C
  P3-C: Engine 集成 InsightGenerator       ← P2-E
  P3-D: DietModule 注册                    ← P2-A~F
  P3-E: 集成测试                           ← P3-A~D
  P3-F: 编译验证 + 全量回归                ← P3-A~E
```

---

## 九、数据迁移（Step 6）

### 9.1 Schema 清理迁移

```sql
-- Migration: Remove deprecated food columns
-- 这3个字段在 V5 中被 fiber/sugar/sodium 的标准字段替代，但未清理

ALTER TABLE foods DROP COLUMN IF EXISTS fiber_per_100g;
ALTER TABLE foods DROP COLUMN IF EXISTS sugar_per_100g;
ALTER TABLE foods DROP COLUMN IF EXISTS sodium_per_100g;
```

### 9.2 RecommendationPreferences 默认值

无需数据迁移。`realismLevel` 是可选字段，缺失时使用 `DEFAULT_REALISM_CONFIG`。

---

## 十、文档升级（Step 7）

### 新增章节

1. 本文档 (`INTELLIGENT_DIET_SYSTEM_V7_2_UPGRADE.md`)

### 修改内容

无（V7.1文档保持不变，V7.2作为独立增量文档）

### 删除内容

无

---

## 十一、总结

V7.2 是 V7.1 的**工程化升级**，核心改进：

1. **评分管道链式化**：从400+行顺序堆砌 → 可插拔ScoringFactor链，支持独立A/B测试
2. **现实策略可配置**：从硬编码过滤 → 4档preset + 场景自动适配 + 用户可选
3. **跨餐规则引擎化**：从内联4条规则 → 声明式规则数组，支持运行时增删
4. **解释模块拆分**：从1835行God Service → 3个独立服务，职责清晰
5. **代码质量治理**：清理废弃代码/字段，缓存Redis化，参数对象化

全部改动保持向后兼容，新类型有默认值，不影响 V7.1 已有接口和测试。
