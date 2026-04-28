# 智能饮食推荐系统 V7.0 升级方案

> **版本**: V7.0 — AI 驱动智能推荐 + 深度画像 + 可解释性增强
> **基于**: V6.9 架构增量演进（不重写已有模块）
> **设计原则**: 工程可实现、增量迭代、每轮只做一个目标

---

## 1. Step 2: V7.0 核心升级方向

### 1.1 方向概述

基于 Step 1 能力评估发现的 9 大缺口，V7.0 聚焦以下 4 个核心方向：

| #   | 方向                              | 核心目标                                            | 覆盖缺口                             |
| --- | --------------------------------- | --------------------------------------------------- | ------------------------------------ |
| D1  | **富领域画像模型**                | 从 flat Prisma 记录 + any 转换 → 强类型领域实体     | 画像领域模型、类型安全、用户偏好深度 |
| D2  | **多目标分阶段系统**              | 从 4 种静态目标 → 多目标 + 分阶段 + 进度追踪        | 目标系统                             |
| D3  | **上下文感知策略**                | 从 scope 分配 → 时段/工作日周末/季节/生命周期感知   | 策略个性化、渠道智能、评分配置       |
| D4  | **食物模型结构化 + 评分维度同步** | FoodLibrary 分组子接口 + SCORE_DIMENSION_NAMES 同步 | 食物类型结构、季节性粒度、类型不同步 |

### 1.2 方向定义矩阵

#### D1: 富领域画像模型

**现状**:

- `UserProfileService`（1275行）直接操作 Prisma 记录，大量 `any` 类型转换
- `EnrichedProfileContext` 是 flat 结构，5 层画像用 `| null` 嵌套
- `RecommendationPreferences` 仅 3 维（popularity/cooking/budget）
- GoalType 仅 4 种，无阶段概念

**目标**:

- 定义领域层画像实体（NutritionProfile, LifestyleProfile, BehavioralProfile, PreferencesProfile）
- 扩展偏好维度：+菜系偏好深度（权重而非列表）、+多样性容忍度、+饮食哲学、+用餐时间偏好
- 强类型贯穿 profile → strategy → scoring 管道
- 画像实体自带验证 + 默认值工厂

#### D2: 多目标分阶段系统

**现状**:

- GoalType 仅 4 种（fat_loss/muscle_gain/health/habit），单一活跃目标
- 无目标进度追踪，无阶段转换逻辑
- SCORE_WEIGHTS 按 GoalType 静态映射

**目标**:

- 支持复合目标（如"减脂为主 + 改善睡眠为辅"）
- 支持分阶段目标（如增肌期 → 减脂期 → 维持期）
- 目标进度追踪（基于行为画像的 complianceRate/weightTrend）
- 阶段自动转换建议（不自动切换，仅推荐）

#### D3: 上下文感知策略

**现状**:

- StrategyScope: global/goal_type/experiment/user，4 层优先级
- 策略解析不考虑时间、季节、用户生命周期阶段
- ScoringConfigSnapshot 90+ 参数单一全局快照

**目标**:

- 新增 StrategyScope: `context`（时段 × 工作日/周末 × 季节）
- 策略解析增加上下文维度匹配
- 评分配置支持按目标/按上下文分片（不是每个参数都 A/B，而是配置组级别）
- 渠道推断增加行为学习权重（复用 SceneResolver 的 Redis 历史）

#### D4: 食物模型结构化 + 类型同步

**现状**:

- FoodLibrary 70+ 字段平铺，无分组
- `SCORE_DIMENSION_NAMES`（strategy.types.ts）仅 12 维，缺少 `popularity`
- 季节性数据品类级，硬编码中国农业季节

**目标**:

- FoodLibrary 保持平铺（DB 兼容），新增类型辅助接口（NutritionData, CookingData, MetaData）
- 同步 `SCORE_DIMENSION_NAMES` 到 13 维
- 食物级季节数据（在 food_regional_info 表扩展月份权重）

### 1.3 排除范围（V7.0 不做）

以下能力在 V6.9 文档中作为"V7.0 方向预告"提及，但本次 V7.0 不实施：

| 特性                         | 排除原因                                                           |
| ---------------------------- | ------------------------------------------------------------------ |
| LightGBM / small transformer | 需要训练数据积累 + 模型训练基础设施，当前优先级是画像和策略增强    |
| 食物图片识别→推荐闭环        | 已有图片分析链路，推荐闭环需要前端配合，推迟到 V7.1                |
| 预算感知推荐（电商 API）     | 外部依赖过重，V7.0 先用 estimatedCostLevel 静态数据                |
| 社交饮食场景                 | 需要社交关系图数据，V7.0 SceneType 已有 family_dinner 覆盖部分场景 |
| 多语言食物数据库             | 国际化是产品决策，V7.0 先完善核心推荐能力                          |

---

## 2. Step 3: 架构升级设计

### 2.1 模块边界变更

```
apps/api-server/src/modules/
├── diet/
│   └── app/
│       └── recommendation/
│           ├── recommendation.types.ts        [扩展] +GoalPhase, +CompoundGoal, +ContextStrategyScope
│           ├── recommendation-engine.service.ts [轻度] +GoalPhaseContext 传递
│           ├── food-scorer.service.ts          [轻度] +上下文感知权重
│           ├── pipeline-builder.service.ts     [轻度] +上下文策略注入
│           ├── scoring-config.service.ts       [中度] +按上下文分片配置
│           └── seasonality.service.ts          [轻度] +食物级季节权重
├── user/
│   ├── user.types.ts                          [重度] +偏好扩展, +GoalPhase, +CompoundGoal
│   ├── app/
│   │   ├── user-profile.service.ts            [中度] +领域模型转换层
│   │   ├── profile-resolver.service.ts        [轻度] +领域模型输出
│   │   ├── goal-tracker.service.ts            [新增] 目标进度追踪
│   │   └── goal-phase.service.ts              [新增] 分阶段目标管理
│   └── domain/                                [新增] 领域模型目录
│       ├── nutrition-profile.ts               [新增] 营养画像领域实体
│       ├── preferences-profile.ts             [新增] 偏好画像领域实体
│       └── profile-factory.ts                 [新增] 画像工厂（默认值+验证）
├── strategy/
│   ├── strategy.types.ts                      [中度] +SCORE_DIMENSION_NAMES 同步, +ContextScope
│   └── app/
│       └── strategy-resolver.service.ts       [中度] +上下文维度匹配
└── food/
    └── food.types.ts                          [轻度] +类型辅助接口
```

### 2.2 新增模块/文件

| 文件                                 | 职责                                                  | 依赖                                   |
| ------------------------------------ | ----------------------------------------------------- | -------------------------------------- |
| `user/domain/nutrition-profile.ts`   | 营养画像领域实体：BMR/TDEE/宏量素目标/微量素缺口      | 无外部依赖（纯值对象）                 |
| `user/domain/preferences-profile.ts` | 偏好画像领域实体：扩展偏好维度（8维）                 | 无外部依赖                             |
| `user/domain/profile-factory.ts`     | 画像工厂：从 Prisma 记录→领域实体 + 默认值填充 + 验证 | nutrition-profile, preferences-profile |
| `user/app/goal-tracker.service.ts`   | 目标进度追踪：基于 14 天行为数据计算达成率            | PrismaService, RedisCacheService       |
| `user/app/goal-phase.service.ts`     | 分阶段目标管理：阶段定义 + 转换建议 + 当前阶段解析    | PrismaService, goal-tracker            |
| 无新增 strategy 文件                 | 上下文策略在现有 strategy-resolver 中扩展             | —                                      |

### 2.3 依赖关系图

```
RecommendationEngine
  ├── ProfileResolver  ──→ ProfileFactory (新增) ──→ NutritionProfile, PreferencesProfile
  ├── GoalPhaseService (新增) ──→ GoalTracker (新增)
  ├── StrategyResolver ──→ +ContextScope 匹配逻辑
  ├── FoodScorer       ──→ ScoringConfigService (+上下文分片)
  └── PipelineBuilder  ──→ 无直接变更，通过 PipelineContext 传递新上下文
```

### 2.4 数据流变更

**V6.9 数据流**:

```
UserProfile (Prisma record) → ProfileResolver → EnrichedProfileContext → RecommendationEngine → ...
```

**V7.0 数据流**:

```
UserProfile (Prisma record) → ProfileFactory (新增) → DomainProfile (强类型)
  → ProfileResolver → EnrichedProfileContext (扩展) → RecommendationEngine
  → GoalPhaseService.getCurrentPhase() → GoalPhaseContext
  → StrategyResolver (+context scope) → ResolvedStrategy (含上下文)
  → FoodScorer/PipelineBuilder (无签名变更，通过 context 传递)
```

---

## 3. Step 4: 模块级升级设计

### 3.1 用户画像模块（user/）

#### 3.1.1 新增领域模型

**`user/domain/nutrition-profile.ts`**:

```typescript
/**
 * V7.0: 营养画像领域实体
 *
 * 从 UserProfileService 的 BMR/TDEE/推荐热量计算中提取，
 * 封装为不可变值对象，自带验证逻辑。
 */
export interface NutritionProfile {
  /** BMR (kcal/day) */
  bmr: number;
  /** TDEE (kcal/day) */
  tdee: number;
  /** 推荐每日热量 (kcal/day) */
  recommendedCalories: number;
  /** 宏量素目标 (g/day) */
  macroTargets: {
    protein: number;
    carbs: number;
    fat: number;
    fiber: number;
  };
  /** 微量素缺口（从行为画像推断） */
  nutritionGaps: string[];
  /** 计算方式 */
  calculationMethod: 'harris_benedict' | 'katch_mcardle';
  /** 计算时间戳 */
  calculatedAt: number;
}
```

**`user/domain/preferences-profile.ts`**:

```typescript
/**
 * V7.0: 偏好画像领域实体
 *
 * 扩展 V6.5 的 3 维偏好（popularity/cooking/budget）到 8 维。
 * 新增维度从声明画像 + 行为画像推断。
 */
export interface PreferencesProfile {
  /** V6.5 原有: 大众化偏好 */
  popularityPreference: 'popular' | 'balanced' | 'adventurous';
  /** V6.5 原有: 烹饪投入 */
  cookingEffort: 'quick' | 'moderate' | 'elaborate';
  /** V6.5 原有: 预算敏感度 */
  budgetSensitivity: 'budget' | 'moderate' | 'unlimited';

  // ── V7.0 新增维度 ──

  /** 菜系偏好权重（0-1 表示偏好程度，vs V6.9 的 string[]） */
  cuisineWeights: Record<string, number>;
  /** 多样性容忍度: 用户对重复食物的接受程度 */
  diversityTolerance: 'low' | 'medium' | 'high';
  /** 饮食哲学（无 = 不限制） */
  dietaryPhilosophy: 'omnivore' | 'pescatarian' | 'vegetarian' | 'vegan' | 'none';
  /** 用餐节奏: 少食多餐 vs 标准三餐 vs 间歇性断食 */
  mealPattern: 'frequent_small' | 'standard_three' | 'intermittent_fasting';
  /** 口味敏感度: 对新口味的接受度 */
  flavorOpenness: 'conservative' | 'moderate' | 'adventurous';
}
```

**`user/domain/profile-factory.ts`**:

```typescript
/**
 * V7.0: 画像工厂
 *
 * 从 Prisma 记录转换为强类型领域实体。
 * 所有字段有安全默认值，消除 any 转换。
 */
export class ProfileFactory {
  static createNutritionProfile(raw: {
    estimatedBmr?: number;
    estimatedTdee?: number;
    recommendedCalories?: number;
    macroTargets?: Record<string, number>;
    nutritionGaps?: string[];
  }): NutritionProfile;

  static createPreferencesProfile(raw: {
    recommendation_preferences?: unknown;
    cuisinePreferences?: string[];
    // ... 从 declared 和 observed 层推断
  }): PreferencesProfile;

  /** 从现有 EnrichedProfileContext 平滑迁移 */
  static fromEnrichedContext(ctx: EnrichedProfileContext): {
    nutrition: NutritionProfile;
    preferences: PreferencesProfile;
  };
}
```

#### 3.1.2 扩展 user.types.ts

```typescript
// ── V7.0: 偏好扩展 ──

/** 多样性容忍度 */
export enum DiversityTolerance {
  LOW = 'low', // 喜欢固定搭配
  MEDIUM = 'medium', // 默认
  HIGH = 'high', // 喜欢每天不同
}

/** 饮食哲学 */
export enum DietaryPhilosophy {
  OMNIVORE = 'omnivore',
  PESCATARIAN = 'pescatarian',
  VEGETARIAN = 'vegetarian',
  VEGAN = 'vegan',
  NONE = 'none',
}

/** 用餐模式 */
export enum MealPattern {
  FREQUENT_SMALL = 'frequent_small',
  STANDARD_THREE = 'standard_three',
  INTERMITTENT_FASTING = 'intermittent_fasting',
}

/** 口味开放度 */
export enum FlavorOpenness {
  CONSERVATIVE = 'conservative',
  MODERATE = 'moderate',
  ADVENTUROUS = 'adventurous',
}

/** V7.0: 扩展推荐偏好（向后兼容，新字段可选） */
export interface RecommendationPreferences {
  // V6.5 原有
  popularityPreference?: PopularityPreference;
  cookingEffort?: CookingEffort;
  budgetSensitivity?: BudgetSensitivity;
  // V7.0 新增
  cuisineWeights?: Record<string, number>;
  diversityTolerance?: DiversityTolerance;
  dietaryPhilosophy?: DietaryPhilosophy;
  mealPattern?: MealPattern;
  flavorOpenness?: FlavorOpenness;
}

// ── V7.0: 分阶段目标 ──

/** 目标阶段定义 */
export interface GoalPhase {
  /** 阶段 ID（uuid） */
  id: string;
  /** 目标类型 */
  goalType: GoalType;
  /** 阶段名称 */
  name: string;
  /** 阶段持续周数 */
  durationWeeks: number;
  /** 热量调整比例（1.0 = TDEE，0.8 = 减脂，1.15 = 增肌） */
  calorieMultiplier: number;
  /** 宏量素比例覆盖（可选） */
  macroRatioOverride?: { carb: [number, number]; fat: [number, number] };
  /** 阶段顺序 */
  order: number;
}

/** 复合目标 */
export interface CompoundGoal {
  /** 主目标 */
  primary: GoalType;
  /** 辅目标（影响权重但不改变主方向） */
  secondary?: GoalType;
  /** 辅目标权重 0-0.3（默认 0.15） */
  secondaryWeight?: number;
  /** 阶段列表（按 order 排序） */
  phases?: GoalPhase[];
  /** 当前阶段索引 */
  currentPhaseIndex?: number;
  /** 目标开始日期 */
  startDate?: string;
}
```

#### 3.1.3 新增 GoalTrackerService

```typescript
/**
 * V7.0: 目标进度追踪服务
 *
 * 基于 14 天行为数据（执行率、热量达成率、体重趋势）计算目标达成度。
 * 数据源：recommendation_executions + user_behavior_profiles
 * 缓存：Redis 4h TTL
 */
@Injectable()
export class GoalTrackerService {
  /** 获取用户当前目标进度 */
  async getProgress(userId: string): Promise<GoalProgress>;

  /** 检查是否建议切换阶段（每日预计算调用） */
  async checkPhaseTransition(userId: string): Promise<PhaseTransitionSuggestion | null>;
}

interface GoalProgress {
  /** 热量达成率（14天均值） */
  calorieCompliance: number;
  /** 蛋白质达成率 */
  proteinCompliance: number;
  /** 执行率（14天） */
  executionRate: number;
  /** 连续天数 */
  streakDays: number;
  /** 当前阶段剩余天数（如有） */
  phaseRemainingDays?: number;
  /** 阶段进度百分比 */
  phaseProgress?: number;
}

interface PhaseTransitionSuggestion {
  /** 建议原因 */
  reason: string;
  /** 建议的下一阶段 */
  suggestedPhase: GoalPhase;
  /** 置信度 */
  confidence: number;
}
```

#### 3.1.4 新增 GoalPhaseService

```typescript
/**
 * V7.0: 分阶段目标管理服务
 *
 * 管理 CompoundGoal 的生命周期：创建、当前阶段解析、阶段切换。
 * 存储在 user_profiles.compound_goal JSON 字段中。
 */
@Injectable()
export class GoalPhaseService {
  /** 获取用户当前有效目标（CompoundGoal 或回退到简单 GoalType） */
  async getCurrentGoal(userId: string): Promise<EffectiveGoal>;

  /** 获取当前阶段的权重调整（用于 computeWeights） */
  getPhaseWeightAdjustment(phase: GoalPhase): Partial<Record<ScoreDimension, number>>;

  /** 设置复合目标 */
  async setCompoundGoal(userId: string, goal: CompoundGoal): Promise<void>;

  /** 手动切换阶段 */
  async advancePhase(userId: string): Promise<GoalPhase | null>;
}

interface EffectiveGoal {
  /** 最终生效的目标类型（阶段覆盖 > 主目标） */
  goalType: GoalType;
  /** 复合目标配置（如有） */
  compound?: CompoundGoal;
  /** 当前阶段（如有） */
  currentPhase?: GoalPhase;
  /** 辅目标权重混合后的权重调整 */
  weightAdjustment?: Partial<Record<ScoreDimension, number>>;
}
```

### 3.2 策略模块（strategy/）

#### 3.2.1 同步 SCORE_DIMENSION_NAMES

```typescript
// strategy.types.ts — V7.0: 同步到 13 维
export const SCORE_DIMENSION_NAMES = [
  'calories',
  'protein',
  'carbs',
  'fat',
  'quality',
  'satiety',
  'glycemic',
  'nutrientDensity',
  'inflammation',
  'fiber',
  'seasonality',
  'executability',
  'popularity', // V7.0: 补齐 V6.9 新增维度
] as const;
```

#### 3.2.2 上下文策略 Scope

```typescript
// strategy.types.ts — V7.0: 新增上下文策略

export enum StrategyScope {
  GLOBAL = 'global',
  GOAL_TYPE = 'goal_type',
  EXPERIMENT = 'experiment',
  USER = 'user',
  CONTEXT = 'context', // V7.0: 上下文感知策略
}

/**
 * V7.0: 上下文策略匹配条件
 *
 * 当 scope = CONTEXT 时，策略需要满足以下条件才生效。
 * 所有字段可选 — 缺失字段视为"不限制"（通配）。
 */
export interface ContextStrategyCondition {
  /** 时段: morning/afternoon/evening/night */
  timeOfDay?: string[];
  /** 工作日/周末 */
  dayType?: ('weekday' | 'weekend')[];
  /** 季节 */
  season?: ('spring' | 'summer' | 'autumn' | 'winter')[];
  /** 用户生命周期阶段 */
  userLifecycle?: ('new' | 'active' | 'mature' | 'churning')[];
  /** 目标阶段（如果用户有复合目标） */
  goalPhaseType?: GoalType[];
}
```

#### 3.2.3 StrategyResolver 上下文匹配

在现有 `StrategyResolver` 中扩展解析逻辑：

```typescript
// 原有优先级: USER > EXPERIMENT > GOAL_TYPE > GLOBAL
// V7.0 新优先级: USER > CONTEXT > EXPERIMENT > GOAL_TYPE > GLOBAL

// 上下文匹配逻辑（在 resolve 方法中增加一步）:
private matchContextStrategy(
  strategies: Strategy[],
  context: { timeOfDay: string; dayType: string; season: string; lifecycle: string }
): Strategy | null {
  // 从 CONTEXT scope 策略中找最佳匹配（条件字段匹配数最多的）
  // 全部不匹配返回 null（跳过此层）
}
```

### 3.3 推荐引擎模块（diet/recommendation/）

#### 3.3.1 recommendation.types.ts 扩展

```typescript
// V7.0: PipelineContext 扩展
export interface PipelineContext {
  // ... 现有字段保持不变 ...

  /** V7.0: 有效目标（可能包含复合目标 + 当前阶段） */
  effectiveGoal?: EffectiveGoal;
  /** V7.0: 目标进度（用于解释生成） */
  goalProgress?: GoalProgress;
  /** V7.0: 扩展偏好画像 */
  preferencesProfile?: PreferencesProfile;
}

// V7.0: MealRecommendation 扩展
export interface MealRecommendation {
  // ... 现有字段保持不变 ...

  /** V7.0: 目标进度提示 */
  goalProgressTip?: string;
  /** V7.0: 阶段转换建议（如有） */
  phaseTransitionHint?: string;
}

// V7.0: ScoringContext 扩展
export interface ScoringContext {
  // ... 现有字段保持不变 ...

  /** V7.0: 有效目标（阶段覆盖） */
  effectiveGoal?: EffectiveGoal;
  /** V7.0: 扩展偏好画像 */
  preferencesProfile?: PreferencesProfile;
}
```

#### 3.3.2 scoring-config.service.ts 上下文分片

```typescript
// V7.0: ScoringConfigService 扩展

/**
 * V7.0: 评分配置分片键
 *
 * 允许按目标/上下文加载不同的配置组。
 * 配置存储在 feature_flag 表中，key 格式: scoring_config:{shardKey}
 */
export interface ConfigShardKey {
  goalType?: GoalType;
  season?: string;
  dayType?: string;
}

// getConfig() 扩展为 getConfig(shard?: ConfigShardKey)
// 优先级: shard 匹配 > 全局默认
// 实际实现: 先加载全局配置，再深合并 shard 配置（如有）
```

#### 3.3.3 seasonality.service.ts 食物级数据

```typescript
// V7.0: 食物级季节权重

/**
 * V7.0: 食物季节权重
 *
 * 从 food_regional_info 表读取，优先级: 食物级 > 品类级 > 默认
 */
interface FoodSeasonWeight {
  foodId: string;
  /** 12 个月的权重 [0-1]，0=完全不当季, 1=盛产期 */
  monthWeights: number[];
  /** 区域代码 */
  regionCode: string;
}

// SeasonalityService.getSeasonScore() 扩展:
// 1. 查 food_regional_info 是否有该食物的月份权重
// 2. 有 → 用食物级权重（平滑曲线）
// 3. 无 → 回退到品类级峰值月份（现有逻辑）
```

### 3.4 食物模块（food/）

#### 3.4.1 类型辅助接口

```typescript
// food.types.ts — V7.0: 类型辅助（不改变 FoodLibrary 结构）

/** 营养数据视图（从 FoodLibrary 字段中提取） */
export interface FoodNutritionView {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number;
  sugar: number;
  addedSugar: number;
  naturalSugar: number;
  saturatedFat: number;
  transFat: number;
  cholesterol: number;
  sodium: number;
  // ... 微量营养素
}

/** 烹饪数据视图 */
export interface FoodCookingView {
  cookingMethod: string;
  prepTimeMinutes: number;
  cookTimeMinutes: number;
  skillRequired: string;
  estimatedCostLevel: number;
}

/** 元数据视图 */
export interface FoodMetaView {
  primarySource: string;
  dataVersion: number;
  confidence: number;
  isVerified: boolean;
  searchWeight: number;
  popularity: number;
}

/** 从 FoodLibrary 提取视图的辅助函数 */
export function extractNutrition(food: FoodLibrary): FoodNutritionView;
export function extractCooking(food: FoodLibrary): FoodCookingView;
export function extractMeta(food: FoodLibrary): FoodMetaView;
```

---

## 4. Step 5: 技术路线图（Phase 1/2/3）

### Phase 1: 基础增强（领域模型 + 类型安全）

> **目标**: 建立强类型基础，消除 any，为 Phase 2/3 铺路

| 子任务 | 描述                                                                                    | 变更文件          | 估计行数 |
| ------ | --------------------------------------------------------------------------------------- | ----------------- | -------- |
| 1-A    | 新增领域模型（NutritionProfile + PreferencesProfile + ProfileFactory）                  | 3 新文件          | ~300     |
| 1-B    | 扩展 user.types.ts（偏好枚举 + CompoundGoal + GoalPhase）                               | user.types.ts     | ~120     |
| 1-C    | 同步 SCORE_DIMENSION_NAMES 到 13 维                                                     | strategy.types.ts | ~5       |
| 1-D    | 新增食物类型辅助接口                                                                    | food.types.ts     | ~80      |
| 1-E    | Prisma schema 扩展（compound_goal 字段 + goal_phases 表 + food_regional_info 月份权重） | schema.prisma     | ~40      |
| 1-F    | 数据库迁移 + Prisma 生成                                                                | migration         | —        |

### Phase 2: 核心功能（目标系统 + 上下文策略）

> **目标**: 实现多目标分阶段 + 上下文感知策略

| 子任务 | 描述                                                             | 变更文件                               | 估计行数 |
| ------ | ---------------------------------------------------------------- | -------------------------------------- | -------- |
| 2-A    | GoalTrackerService 实现                                          | 1 新文件                               | ~200     |
| 2-B    | GoalPhaseService 实现                                            | 1 新文件                               | ~250     |
| 2-C    | StrategyScope.CONTEXT + ContextStrategyCondition + Resolver 扩展 | strategy.types.ts, strategy-resolver   | ~150     |
| 2-D    | ScoringConfigService 上下文分片                                  | scoring-config.service.ts              | ~80      |
| 2-E    | SeasonalityService 食物级权重                                    | seasonality.service.ts                 | ~60      |
| 2-F    | ProfileResolver 输出领域模型 + ProfileFactory 集成               | profile-resolver, user-profile.service | ~100     |

### Phase 3: 管道集成 + 验证

> **目标**: 将 Phase 1/2 能力接入推荐管道，端到端验证

| 子任务 | 描述                                                                 | 变更文件                         | 估计行数 |
| ------ | -------------------------------------------------------------------- | -------------------------------- | -------- |
| 3-A    | RecommendationEngine 集成 GoalPhaseService + 传递 EffectiveGoal      | recommendation-engine.service.ts | ~50      |
| 3-B    | PipelineContext + ScoringContext 扩展字段                            | recommendation.types.ts          | ~30      |
| 3-C    | FoodScorer 支持 EffectiveGoal 阶段权重 + PreferencesProfile 菜系偏好 | food-scorer.service.ts           | ~60      |
| 3-D    | ExplanationGenerator 新增目标进度洞察 + 阶段提示                     | explanation-generator.service.ts | ~80      |
| 3-E    | DietModule 注册新服务                                                | diet.module.ts                   | ~10      |
| 3-F    | 集成测试                                                             | v7.0-integration.spec.ts         | ~400     |

---

## 5. Step 6: 数据迁移方案

### 5.1 Prisma Schema 变更

```prisma
// ── V7.0: user_profiles 扩展 ──

model user_profiles {
  // ... 现有字段保持不变 ...

  // V7.0: 复合目标（JSON）
  compound_goal      Json?   @db.JsonB   // CompoundGoal 结构
}

// ── V7.0: 目标阶段表 ──

model goal_phases {
  id                 String   @id @default(uuid())
  user_id            String
  goal_type          String   // GoalType
  name               String   // 阶段名称
  duration_weeks     Int
  calorie_multiplier Float    @default(1.0)
  macro_ratio_override Json?  @db.JsonB
  phase_order        Int
  is_active          Boolean  @default(false)
  started_at         DateTime?
  completed_at       DateTime?
  created_at         DateTime @default(now())
  updated_at         DateTime @updatedAt

  @@index([user_id, is_active])
  @@index([user_id, phase_order])
}

// ── V7.0: 上下文策略条件 ──

model strategy {
  // ... 现有字段保持不变 ...

  // V7.0: 上下文匹配条件（scope=CONTEXT 时使用）
  context_condition  Json?   @db.JsonB   // ContextStrategyCondition 结构
}

// ── V7.0: food_regional_info 扩展 ──

model food_regional_info {
  // ... 现有字段保持不变 ...

  // V7.0: 食物级月份权重（12 元素数组，0-1）
  month_weights      Json?   @db.JsonB   // number[12]
}

// ── V7.0: 扩展推荐偏好字段（在 user_profiles 的 recommendation_preferences JSON 中） ──
// 无 schema 变更 — recommendation_preferences 已是 Json 字段，新维度直接存入
```

### 5.2 迁移脚本

```sql
-- V7.0 Migration: 新增字段和表

-- 1. user_profiles 新增 compound_goal
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS compound_goal JSONB DEFAULT NULL;

-- 2. 新增 goal_phases 表
CREATE TABLE IF NOT EXISTS goal_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  goal_type VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  duration_weeks INT NOT NULL,
  calorie_multiplier FLOAT NOT NULL DEFAULT 1.0,
  macro_ratio_override JSONB DEFAULT NULL,
  phase_order INT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT false,
  started_at TIMESTAMPTZ DEFAULT NULL,
  completed_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_goal_phases_user_active ON goal_phases(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_goal_phases_user_order ON goal_phases(user_id, phase_order);

-- 3. strategy 新增 context_condition
ALTER TABLE strategy ADD COLUMN IF NOT EXISTS context_condition JSONB DEFAULT NULL;

-- 4. food_regional_info 新增 month_weights
ALTER TABLE food_regional_info ADD COLUMN IF NOT EXISTS month_weights JSONB DEFAULT NULL;

-- 5. 现有数据兼容 — 无需数据迁移
-- compound_goal: NULL 表示使用原有简单 GoalType
-- context_condition: NULL 表示非上下文策略
-- month_weights: NULL 表示使用品类级季节数据
```

### 5.3 迁移安全保障

- 所有新字段/表使用 `DEFAULT NULL` 或 `DEFAULT` 值，不影响现有数据
- `compound_goal = NULL` 时系统回退到 `user_profiles.goal_type`（现有行为）
- `context_condition = NULL` 时策略解析跳过 CONTEXT 层（现有行为）
- `month_weights = NULL` 时季节性评分回退到品类级（现有行为）
- 推荐偏好新维度在 JSON 中按需写入，读取时 ProfileFactory 提供默认值

---

## 6. Step 7: 文档升级 / 接口变更汇总

### 6.1 新增类型/接口

| 类型                      | 位置                                            | 说明             |
| ------------------------- | ----------------------------------------------- | ---------------- |
| NutritionProfile          | `user/domain/nutrition-profile.ts`              | 营养画像领域实体 |
| PreferencesProfile        | `user/domain/preferences-profile.ts`            | 偏好画像领域实体 |
| ProfileFactory            | `user/domain/profile-factory.ts`                | 画像工厂         |
| GoalPhase                 | `user/user.types.ts`                            | 目标阶段定义     |
| CompoundGoal              | `user/user.types.ts`                            | 复合目标         |
| EffectiveGoal             | `user/app/goal-phase.service.ts`                | 解析后的有效目标 |
| GoalProgress              | `user/app/goal-tracker.service.ts`              | 目标进度         |
| PhaseTransitionSuggestion | `user/app/goal-tracker.service.ts`              | 阶段转换建议     |
| ContextStrategyCondition  | `strategy/strategy.types.ts`                    | 上下文策略条件   |
| ConfigShardKey            | `diet/recommendation/scoring-config.service.ts` | 配置分片键       |
| FoodNutritionView         | `food/food.types.ts`                            | 营养数据视图     |
| FoodCookingView           | `food/food.types.ts`                            | 烹饪数据视图     |
| FoodMetaView              | `food/food.types.ts`                            | 元数据视图       |
| DiversityTolerance        | `user/user.types.ts`                            | 多样性容忍度枚举 |
| DietaryPhilosophy         | `user/user.types.ts`                            | 饮食哲学枚举     |
| MealPattern               | `user/user.types.ts`                            | 用餐模式枚举     |
| FlavorOpenness            | `user/user.types.ts`                            | 口味开放度枚举   |

### 6.2 新增服务

| 服务               | 位置                               | 注入依赖                          |
| ------------------ | ---------------------------------- | --------------------------------- |
| GoalTrackerService | `user/app/goal-tracker.service.ts` | PrismaService, RedisCacheService  |
| GoalPhaseService   | `user/app/goal-phase.service.ts`   | PrismaService, GoalTrackerService |

### 6.3 扩展接口（向后兼容）

| 接口                      | 新增字段                                                                           | 说明                   |
| ------------------------- | ---------------------------------------------------------------------------------- | ---------------------- |
| RecommendationPreferences | cuisineWeights, diversityTolerance, dietaryPhilosophy, mealPattern, flavorOpenness | 5 个新偏好维度         |
| PipelineContext           | effectiveGoal, goalProgress, preferencesProfile                                    | 传递复合目标/进度/偏好 |
| ScoringContext            | effectiveGoal, preferencesProfile                                                  | 评分上下文扩展         |
| MealRecommendation        | goalProgressTip, phaseTransitionHint                                               | 目标进度展示           |
| StrategyScope             | CONTEXT                                                                            | 新增上下文策略范围     |

### 6.4 数据库变更

| 变更                        | 表                 | 类型            |
| --------------------------- | ------------------ | --------------- |
| 新增 compound_goal 字段     | user_profiles      | JSONB, nullable |
| 新增 goal_phases 表         | —                  | 新表            |
| 新增 context_condition 字段 | strategy           | JSONB, nullable |
| 新增 month_weights 字段     | food_regional_info | JSONB, nullable |

### 6.5 SCORE_DIMENSION_NAMES 同步

```
strategy.types.ts: SCORE_DIMENSION_NAMES 12 → 13 维（+popularity）
strategy.types.ts: StrategyScoreDimension 类型自动同步
strategy.types.ts: RankPolicyConfig.baseWeights 数组长度 12 → 13
```

### 6.6 升级模块汇总

| 模块                    | 变化级别 | 说明                                                    |
| ----------------------- | -------- | ------------------------------------------------------- |
| user.types.ts           | 重度扩展 | +4 枚举, +2 接口, +5 偏好维度                           |
| user/domain/            | 新增     | 3 个领域模型文件                                        |
| GoalTrackerService      | 新增     | 目标进度追踪                                            |
| GoalPhaseService        | 新增     | 分阶段目标管理                                          |
| strategy.types.ts       | 中度扩展 | +CONTEXT scope, +13 维同步                              |
| StrategyResolver        | 中度增强 | +上下文匹配逻辑                                         |
| ScoringConfigService    | 轻度增强 | +按上下文分片                                           |
| SeasonalityService      | 轻度增强 | +食物级月份权重                                         |
| food.types.ts           | 轻度扩展 | +3 视图接口 + 提取函数                                  |
| recommendation.types.ts | 中度扩展 | +PipelineContext/ScoringContext/MealRecommendation 字段 |
| RecommendationEngine    | 轻度增强 | +GoalPhaseService 集成                                  |
| FoodScorer              | 轻度增强 | +阶段权重 + 菜系偏好                                    |
| ExplanationGenerator    | 轻度增强 | +目标进度洞察                                           |
| ProfileResolver         | 轻度增强 | +领域模型输出                                           |
| user-profile.service.ts | 轻度增强 | +领域模型转换                                           |
| Prisma schema           | 中度扩展 | +1 表, +3 字段                                          |

### 6.7 已解决 vs 遗留问题

| 问题 ID | 描述                              | V7.0 状态              | 归属 |
| ------- | --------------------------------- | ---------------------- | ---- |
| V7-1    | 画像无领域模型，大量 any          | ✅ 解决（Phase 1-A）   | —    |
| V7-2    | GoalType 仅 4 种，无阶段          | ✅ 解决（Phase 2-A/B） | —    |
| V7-3    | 偏好仅 3 维                       | ✅ 解决（Phase 1-B）   | —    |
| V7-4    | 策略无上下文感知                  | ✅ 解决（Phase 2-C）   | —    |
| V7-5    | SCORE_DIMENSION_NAMES 不同步      | ✅ 解决（Phase 1-C）   | —    |
| V7-6    | FoodLibrary 平铺无分组            | ✅ 解决（Phase 1-D）   | —    |
| V7-7    | 季节性仅品类级                    | ✅ 解决（Phase 2-E）   | —    |
| V7-8    | 评分配置单一全局                  | ✅ 解决（Phase 2-D）   | —    |
| V8-1    | LightGBM/transformer 替代规则评分 | 遗留 → V8.0            | —    |
| V8-2    | 社交饮食场景                      | 遗留 → V8.0            | —    |
| V8-3    | 预算感知推荐（电商 API）          | 遗留 → V8.0            | —    |
| V8-4    | 食物图片→推荐闭环                 | 遗留 → V7.1            | —    |

---

> **设计原则：**
>
> - 所有升级是 V6.9 的增量演进，不重写已有模块
> - 每个 Phase 任务完成后运行 `pnpm exec tsc --noEmit --project apps/api-server/tsconfig.json` 验证编译
> - Prisma schema 变更后运行 `pnpm prisma validate --schema=apps/api-server/prisma/schema.prisma` 验证
> - 所有新模块以 NestJS `@Injectable()` 注册，通过 DI 注入
> - 所有新参数有默认值，确保零配置可启动
> - CompoundGoal 为 null 时完全回退到 V6.9 简单 GoalType 行为
> - ContextStrategyCondition 为 null 时跳过上下文策略层（现有行为不变）
> - 领域模型通过 ProfileFactory 从 Prisma 记录转换，不影响 DB 读写
