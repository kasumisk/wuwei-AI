# 智能饮食推荐系统 V6.2 — 升级设计方案

> 版本: V6.2 设计稿
> 日期: 2026-04-11
> 定位: 基于 V6.1 代码审计，修正架构缺陷、强化推荐精度、补齐事件链路、提升工程可靠性
> 原则: 不推翻 V6.1 架构，只做增强、补齐、修正；优先修复安全和正确性问题

---

## 目录

- [1. V6.1 现状评估](#1-v61-现状评估)
- [2. 核心升级方向（7 个）](#2-核心升级方向)
- [3. 架构升级设计](#3-架构升级设计)
- [4. 模块级升级设计](#4-模块级升级设计)
- [5. 技术路线图](#5-技术路线图)
- [6. 数据迁移](#6-数据迁移)
- [7. 文档变更说明](#7-文档变更说明)

---

## 1. V6.1 现状评估

### 1.1 代码规模

| 模块     | 核心文件数 | 总行数 | 评价                                |
| -------- | ---------- | ------ | ----------------------------------- |
| 推荐引擎 | 13         | ~6927  | 功能完整，但主服务 1421 行过于臃肿  |
| 用户画像 | 8+         | ~3500  | 三层 + 短期 + 上下文，设计完善      |
| 订阅系统 | 10+        | ~4000  | 双渠道支付 + 三级门控 + 配额 + 裁剪 |
| 食物分析 | 6+         | ~3500  | 文本 + 图片双链路，统一输出结构     |
| 缓存系统 | 4          | ~800   | L1+L2 双层，Refresh-ahead           |
| 事件系统 | 3          | ~500   | EventEmitter2，13 个事件定义        |

### 1.2 已具备能力

| 能力域   | 状态 | 详情                                               |
| -------- | ---- | -------------------------------------------------- |
| 推荐管道 | 完整 | 10 维评分 + 6 层修正 + 健康修正 + 多样性去重       |
| 三层画像 | 完整 | 声明 + 行为 + 推断 + 短期(Redis) + 上下文(内存)    |
| 订阅门控 | 完整 | 等级检查 + 配额扣减 + 结果裁剪 + 付费墙触发        |
| 食物分析 | 完整 | 文本(ERNIE 4.5) + 图片(ERNIE VL) + BullMQ 异步     |
| 缓存架构 | 完整 | TieredCacheManager + RedisCacheService             |
| 事件驱动 | 部分 | 13 个事件定义，仅 5 个有 listener                  |
| A/B 实验 | 基础 | 策略引擎 + 实验桶，未深度集成                      |
| 向量搜索 | 存在 | pgvector 96 维，仅用于推荐相似性，未用于食物库搜索 |

### 1.3 审计发现的问题（按严重性排序）

#### 安全/正确性（P0）

| #   | 问题                                                                           | 影响                                |
| --- | ------------------------------------------------------------------------------ | ----------------------------------- |
| S1  | Apple IAP JWS 签名未验证根证书链                                               | 攻击者可伪造交易获取免费订阅        |
| S2  | 微信支付通知签名验证未实现（TODO）                                             | 攻击者可伪造支付回调                |
| S3  | `getActiveSubscription` 查询条件 bug：CANCELLED 状态 `expires_at` 比较方向错误 | 已过期订阅可能被当作有效            |
| S4  | `food.service.ts:273` 的 `recommendMeal()` 未传 `userConstraints`              | 通过此路径的推荐不做过敏原/忌口过滤 |
| S5  | `vector-search.service.ts` 15 处 `$queryRawUnsafe`                             | pgvector SQL 注入风险               |

#### 架构缺陷（P1）

| #   | 问题                                                            | 影响                                                                    |
| --- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A1  | 8/13 个事件无 listener（孤儿事件）                              | `SUBSCRIPTION_CHANGED`、`RECOMMENDATION_GENERATED` 等 emit 后无任何响应 |
| A2  | 3/6 个 BullMQ 队列无 Processor                                  | `profile-update`、`feedback-process`、`export` 入队后永不消费           |
| A3  | ProfileCacheService 未被 `PROFILE_UPDATED` 事件自动失效         | 画像更新后缓存可能滞后 2 分钟                                           |
| A4  | 上下文画像（ContextualProfile）未接入主推荐路径                 | 场景化推荐（工作日早餐 vs 周末晚餐）未生效                              |
| A5  | 短期画像 `categoryPreferences` 用 `mealType` 作 key，非食物品类 | 品类级偏好学习失效                                                      |
| A6  | 同步事件 listener 阻塞请求线程                                  | `FEEDBACK_SUBMITTED`、`MEAL_RECORDED` handler 中 Redis I/O 阻塞         |
| A7  | Apple 通知去重用内存 Set（max 10000）                           | 重启丢失 + 集群不共享                                                   |

#### 功能缺失（P2）

| #   | 问题                                                    | 影响                                                                                          |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| F1  | `UserProfileConstraints` 未传递声明画像中大量有价值字段 | `food_preferences`、`budget_level`、`cooking_skill_level`、`cuisine_preferences` 等未影响推荐 |
| F2  | 行为画像多个字段空转                                    | `coach_style`、`failure_triggers`、`replacement_patterns`、`portion_tendency` 无消费方        |
| F3  | 行为画像创建时机不明确                                  | 新用户可能无行为画像记录，Cron 只处理已存在记录                                               |
| F4  | 食物库搜索仅 ILIKE 模糊匹配                             | 已有 pgvector 向量搜索能力未被利用                                                            |
| F5  | 微信支付计划匹配通过金额                                | 多个同价计划时产生歧义                                                                        |

---

## 2. 核心升级方向

### 方向 1: 安全加固

**为什么需要**: 支付系统存在可被利用的安全漏洞（S1-S3），过敏原过滤存在遗漏（S4），SQL 注入风险（S5）。这些是上线前必须修复的问题。

**解决什么问题**:

- Apple/微信支付伪造攻击
- 过敏用户安全风险
- SQL 注入攻击面

### 方向 2: 事件链路补齐

**为什么需要**: 系统设计了 13 个领域事件，但 8 个无 listener，3 个队列无 Processor。事件驱动架构名存实亡，模块间解耦只是纸面设计。

**解决什么问题**:

- 订阅变更后缓存/权限不刷新
- 推荐生成后无法统计/学习
- 分析保存、候选创建后无后续流程
- 画像缓存与真实数据不一致

### 方向 3: 推荐精度提升

**为什么需要**: 推荐管道虽然有 10 维评分 + 6 层修正，但上下文画像（场景化推荐）未接入、短期画像品类维度错误、声明画像大量字段未传入推荐引擎。推荐结果缺乏场景感知和个性化深度。

**解决什么问题**:

- 工作日早餐 vs 周末晚餐无差异化
- 用户声明的烹饪能力/预算/菜系偏好不影响推荐
- 品类偏好学习用错维度

### 方向 4: 画像利用率提升

**为什么需要**: 三层画像设计完善，但实际利用率不到 60%。声明画像 30+ 字段中约 10 个未传入推荐引擎；行为画像 13 个字段中 5 个空转；推断画像的 `preference_weights` 衰减机制已实现但推荐引擎消费方式不完整。

**解决什么问题**:

- 用户填了信息但系统没用
- 行为数据采集了但不影响推荐
- 画像投资回报低

### 方向 5: 食物库搜索升级

**为什么需要**: 当前食物库搜索仅用 `ILIKE '%keyword%'`，无法处理同义词、近义词、语义搜索。但系统中已有 pgvector 96 维嵌入和 `pg_trgm` 索引的基础设施，只是没有用于搜索。

**解决什么问题**:

- 搜索"鸡排"找不到"炸鸡排"
- 搜索体验远低于用户预期
- 已有向量能力被浪费

### 方向 6: 缓存一致性与性能

**为什么需要**: 缓存策略碎片化（2 个服务用 TieredCache，8 个直接用 Redis），画像缓存不自动失效，同步事件 listener 阻塞请求线程。

**解决什么问题**:

- 画像更新后推荐用旧数据
- 事件处理阻塞用户请求
- 缓存管理不统一导致 TTL/失效策略难以维护

### 方向 7: 工程可靠性

**为什么需要**: 无 Processor 的队列、非标准事件名、版本号并发冲突、Cron 全量加载无分页等工程债务会随用户增长暴露。

**解决什么问题**:

- 僵尸队列占用资源
- 代码不一致增加维护成本
- 用户增长后 Cron 内存溢出

---

## 3. 架构升级设计

### 3.1 V6.1 → V6.2 架构差异图

```
V6.1 架构:
┌──────────────────────────────────────────────────────┐
│ Controller 层                                        │
│  Guards → Controller → Service → Repository/Prisma   │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────┐   ┌──────────────────────────┐
│ 推荐引擎              │   │ 事件系统                  │
│ (monolithic 1421行)   │   │ (13事件, 5有listener)     │
│                      │   │ 8个孤儿事件               │
│ 上下文画像 ❌ 未接入   │   │ 3个僵尸队列               │
│ 声明画像 ⚠️ 部分传入   │   │                          │
│ 短期画像 ⚠️ 维度错误   │   │                          │
└──────────────────────┘   └──────────────────────────┘
```

```
V6.2 架构:
┌──────────────────────────────────────────────────────┐
│ Controller 层                                        │
│  Guards → Controller → Service → Repository/Prisma   │
└──────────┬───────────────────────────────────────────┘
           │
           ▼
┌──────────────────────┐   ┌──────────────────────────┐
│ 推荐引擎              │   │ 事件系统                  │
│ ┌──────────────────┐ │   │ ┌──────────────────────┐ │
│ │ ProfileResolver  │ │   │ │ SubscriptionListener │ │ ← 新增
│ │ (统一画像解析)    │ │   │ │ RecommendationLogger │ │ ← 新增
│ └────────┬─────────┘ │   │ │ AnalysisSaveListener │ │ ← 新增
│          ▼           │   │ │ PaywallAnalytics     │ │ ← 新增
│ 约束→过滤→评分→组装  │   │ └──────────────────────┘ │
│ + 上下文画像 ✅       │   │                          │
│ + 完整声明画像 ✅     │   │ 队列: 清理或实现          │
│ + 修正短期画像 ✅     │   │ 全部 listener async ✅   │
└──────────────────────┘   └──────────────────────────┘
           │
           ▼
┌──────────────────────────────────────────────────────┐
│ 新增: ProfileResolverService                         │
│ 统一从 5 层画像（声明+行为+推断+短期+上下文）         │
│ 构建 EnrichedProfileContext 传入推荐管道              │
└──────────────────────────────────────────────────────┘
```

### 3.2 新增/增强模块

| 模块                          | 类型 | 职责                                                |
| ----------------------------- | ---- | --------------------------------------------------- |
| `ProfileResolverService`      | 新增 | 统一聚合 5 层画像为 `EnrichedProfileContext`        |
| `SubscriptionEventListener`   | 新增 | 监听 `SUBSCRIPTION_CHANGED`，刷新缓存+权限          |
| `RecommendationEventListener` | 新增 | 监听 `RECOMMENDATION_GENERATED`，统计+学习          |
| `AnalysisSaveEventListener`   | 新增 | 监听 `ANALYSIS_SAVED_TO_RECORD`，关联分析与饮食记录 |
| `PaywallEventListener`        | 新增 | 监听 `PAYWALL_TRIGGERED`，转化漏斗分析              |
| `FoodSearchService` (增强)    | 增强 | 引入 pg_trgm + pgvector 混合搜索                    |
| `SecurityService` (增强)      | 增强 | Apple JWS 验证 + 微信签名验证                       |

---

## 4. 模块级升级设计

### 4.1 Profile 模块（用户画像）

#### 问题

1. 推荐引擎只接收 `UserProfileConstraints`（6 个字段），声明画像 30+ 字段中大量未传入
2. 上下文画像已实现但未接入主推荐路径
3. 短期画像 `categoryPreferences` 用 `mealType` 而非食物 `category` 作为 key
4. 行为画像 5 个字段无消费方
5. 行为画像创建时机不明确

#### 升级方案

**4.1.1 新增 `ProfileResolverService` — 统一画像聚合**

```typescript
// 新增文件: apps/api-server/src/modules/user/app/profile-resolver.service.ts

interface EnrichedProfileContext {
  // 声明画像（全量传入）
  declared: {
    gender: string;
    birthYear: number;
    heightCm: number;
    weightKg: number;
    targetWeightKg?: number;
    activityLevel: string;
    goal: string;
    goalSpeed: string;
    dailyCalorieGoal: number;
    mealsPerDay: number;
    takeoutFrequency: string;
    canCook: boolean;
    cookingSkillLevel?: string; // ← V6.1 未传
    budgetLevel?: string; // ← V6.1 未传
    familySize: number; // ← V6.1 未传
    cuisinePreferences: string[]; // ← V6.1 未传
    foodPreferences: string[]; // ← V6.1 未传
    dietaryRestrictions: string[];
    allergens: string[];
    healthConditions: string[];
    weakTimeSlots: string[];
    bingeTriggers: string[];
    discipline: string;
    regionCode: string;
    timezone: string;
  };

  // 推断画像
  inferred: {
    estimatedBmr: number;
    estimatedTdee: number;
    recommendedCalories: number;
    macroTargets: MacroTargets;
    userSegment?: string;
    churnRisk: number;
    optimalMealCount?: number;
    nutritionGaps: string[];
    preferenceWeights?: Record<string, number>;
  };

  // 行为画像
  observed: {
    avgComplianceRate: number;
    totalRecords: number;
    streakDays: number;
    mealTimingPatterns: Record<string, any>;
    portionTendency: string;
  };

  // 短期画像（Redis 7天滑窗）
  shortTerm: ShortTermProfile;

  // 上下文画像（请求时实时计算）
  contextual: ContextualProfile;
}

@Injectable()
export class ProfileResolverService {
  /**
   * 聚合所有画像层为统一上下文
   * 推荐引擎只需要调用这一个方法
   */
  async resolve(userId: string): Promise<EnrichedProfileContext> {
    const [declared, observed, inferred, shortTerm, contextual] = await Promise.all([
      this.profileCache.getDeclaredProfile(userId),
      this.profileCache.getObservedProfile(userId),
      this.profileCache.getInferredProfile(userId),
      this.realtimeProfile.getShortTermProfile(userId),
      this.contextualProfile.buildContextualProfile(userId),
    ]);
    return { declared, observed, inferred, shortTerm, contextual };
  }
}
```

**4.1.2 修复短期画像 categoryPreferences 维度**

```
// 修改: realtime-profile.service.ts handleFeedbackSubmitted()

// 修改前（错误）：
categoryPreferences[payload.mealType].accepted++

// 修改后（正确）：
// 使用食物的 category（protein/grain/veggie）作为 key
for (const food of payload.foods) {
  categoryPreferences[food.category] = categoryPreferences[food.category] || { accepted: 0, rejected: 0, replaced: 0 };
  if (payload.type === 'accept') categoryPreferences[food.category].accepted++;
  if (payload.type === 'reject') categoryPreferences[food.category].rejected++;
}
```

**4.1.3 行为画像自动创建**

在 Onboarding 完成时（Step 4 或跳过后），自动创建 `user_behavior_profiles` 和 `user_inferred_profiles` 记录，确保 Cron 能处理到。

```typescript
// 修改: user-profile.service.ts saveOnboardingStep()
// 当 onboarding_completed = true 时：
await this.ensureBehaviorProfile(userId);
await this.syncInferredProfile(userId);
```

**4.1.4 清理空转行为字段**

| 字段                   | 决策                         | 理由                         |
| ---------------------- | ---------------------------- | ---------------------------- |
| `coach_style`          | 保留但接入教练模块           | 已有字段定义，教练模块应读取 |
| `failure_triggers`     | 保留但 Phase 2 实现写入      | 需要更多行为数据积累         |
| `replacement_patterns` | 保留但 Phase 2 实现写入      | 替代食物反馈事件已有数据源   |
| `portion_tendency`     | 接入推荐（作为份量调整因子） | Cron 已写入，推荐引擎应消费  |

---

### 4.2 Recommendation 模块（推荐引擎）

#### 问题

1. 主服务 `recommendation-engine.service.ts` 1421 行，`recommendMealFromPool` 方法 18 个参数
2. 上下文画像未接入
3. `food.service.ts:273` 未传 `userConstraints`
4. 声明画像传入不完整
5. 评分权重硬编码

#### 升级方案

**4.2.1 推荐入口统一使用 `EnrichedProfileContext`**

```typescript
// 修改: recommendation-engine.service.ts

// 新增 Request 对象，替代 18 个参数
interface MealRecommendationRequest {
  userId: string;
  mealType: string;
  goalType: string;
  consumed: ConsumedMeals;
  budget: number;
  dailyTarget: DailyTarget;
  profile: EnrichedProfileContext;  // ← 统一画像上下文
  strategy?: ResolvedStrategy;
}

// 修改 recommendMeal 方法签名
async recommendMeal(req: MealRecommendationRequest): Promise<MealRecommendation>
```

**4.2.2 接入上下文画像**

```typescript
// 在 recommendMealFromPool 中注入场景感知

// 1. 场景影响评分维度权重
const sceneModifiers = req.profile.contextual.sceneWeightModifiers;
// 应用到 scoreFoodDetailed 的各维度权重

// 2. 场景影响约束
const sceneHints = req.profile.contextual.constraintHints;
// 场景标签加入 preferTags/avoidTags
// 场景热量系数影响 budget
```

**4.2.3 声明画像字段全量接入**

| 新接入字段           | 影响环节     | 作用                       |
| -------------------- | ------------ | -------------------------- |
| `cookingSkillLevel`  | 过滤 + 评分  | 技能不足时过滤复杂菜品     |
| `budgetLevel`        | 评分         | 低预算时降低高成本食材权重 |
| `cuisinePreferences` | 评分 boost   | 偏好菜系的食物加分         |
| `foodPreferences`    | 过滤 + boost | 喜好食物类型加分           |
| `familySize`         | 份量建议     | 影响份量推荐而非评分       |
| `takeoutFrequency`   | 场景匹配     | 高频外卖用户推荐便利食物   |

**4.2.4 修复 food.service.ts 未传 userConstraints**

```typescript
// 修改: food.service.ts:273
// 添加缺失的 userConstraints 参数
const userConstraints = {
  dietaryRestrictions: profile.dietary_restrictions || [],
  allergens: profile.allergens || [],
  healthConditions: profile.health_conditions || [],
  regionCode: profile.region_code || 'CN',
  timezone: profile.timezone || 'Asia/Shanghai',
};
```

---

### 4.3 Nutrition / Scoring 模块

#### 问题

1. `addedSugar` vs `naturalSugar` 在 schema 中已有字段，但评分模型未区分
2. 评分权重全部硬编码
3. `portionTendency` 已计算但评分未消费

#### 升级方案

**4.3.1 区分 addedSugar 评分**

```typescript
// 增强: food-scorer.service.ts calcProcessingScore()

// V6.1: 仅用 isProcessed + isFried + processingLevel
// V6.2: 加入 addedSugar 惩罚
const addedSugarPenalty = food.addedSugar
  ? Math.min(Number(food.addedSugar) / 10, 1) * -15 // 每10g扣15分，上限-15
  : 0;
```

**4.3.2 评分权重可配置**

```typescript
// 新增: recommendation.config.ts

// 权重从硬编码改为可配置
interface ScoringWeights {
  energy: number; // 默认 25
  protein: number; // 默认 20
  processing: number; // 默认 15
  satiety: number; // 默认 10
  variety: number; // 默认 10
  glycemic: number; // 默认 8
  microNrf: number; // 默认 7
  fiberBonus: number; // 默认 5
}

// 不同目标类型的权重配置
const GOAL_WEIGHTS: Record<string, Partial<ScoringWeights>> = {
  weight_loss: { protein: 25, satiety: 15 },
  muscle_gain: { protein: 30, energy: 20 },
  health: { microNrf: 12, processing: 18 },
};
```

**4.3.3 portionTendency 接入份量调整**

```typescript
// 增强: meal-assembler.service.ts adjustPortions()

// 根据用户的份量倾向调整
const portionMultiplier =
  {
    small: 0.85,
    normal: 1.0,
    large: 1.15,
  }[profile.observed.portionTendency] || 1.0;
```

---

### 4.4 Cache / 性能模块

#### 问题

1. ProfileCacheService 不被事件自动失效
2. 同步事件 listener 阻塞请求
3. 8 个服务直接用 Redis，仅 2 个用 TieredCache
4. 短期画像 Redis 逐个 get 无 pipeline

#### 升级方案

**4.4.1 ProfileCacheService 事件驱动失效**

```typescript
// 新增 listener: profile-cache-invalidation.listener.ts

@Injectable()
export class ProfileCacheInvalidationListener {
  @OnEvent(DomainEvents.PROFILE_UPDATED, { async: true })
  async handleProfileUpdated(payload: { userId: string }) {
    await this.profileCacheService.invalidate(payload.userId);
  }
}
```

**4.4.2 所有事件 listener 统一异步**

```typescript
// 修改所有 @OnEvent 装饰器添加 { async: true }

// realtime-profile.service.ts
@OnEvent(DomainEvents.FEEDBACK_SUBMITTED, { async: true })  // ← 加 async
handleFeedbackSubmitted(payload) { ... }

@OnEvent(DomainEvents.MEAL_RECORDED, { async: true })  // ← 加 async
handleMealRecorded(payload) { ... }

// precompute.service.ts
@OnEvent(DomainEvents.PROFILE_UPDATED, { async: true })  // ← 加 async
handleProfileUpdated(payload) { ... }
```

**4.4.3 Redis 批量读取优化**

```typescript
// 增强: redis-cache.service.ts

// 新增 mget 方法
async mget<T>(keys: string[]): Promise<(T | null)[]> {
  if (!this.isConnected || keys.length === 0) return keys.map(() => null);
  const results = await this.client.mget(keys);
  return results.map(v => v ? JSON.parse(v) : null);
}

// realtime-profile.service.ts 使用 mget 批量获取短期画像
async getShortTermProfiles(userIds: string[]): Promise<Map<string, ShortTermProfile>> {
  const keys = userIds.map(id => `short_term_profile:${id}`);
  const results = await this.redis.mget<ShortTermProfile>(keys);
  // ...
}
```

---

### 4.5 事件与数据流模块

#### 问题

8/13 个事件无 listener，模块间解耦只是纸面设计。

#### 升级方案

**4.5.1 补齐所有事件 listener**

| 事件                       | 新增 Listener                 | 职责                                           |
| -------------------------- | ----------------------------- | ---------------------------------------------- |
| `SUBSCRIPTION_CHANGED`     | `SubscriptionEventListener`   | 刷新用户缓存 + 刷新配额 + 通知推荐引擎策略变更 |
| `RECOMMENDATION_GENERATED` | `RecommendationEventListener` | 统计推荐次数 + 记录策略使用 + 预缓存学习       |
| `ANALYSIS_SAVED_TO_RECORD` | `AnalysisSaveListener`        | 关联 analysis_food_link + 更新食物命中计数     |
| `ANALYSIS_SUBMITTED`       | `AnalysisTrackingListener`    | 记录分析行为到行为画像                         |
| `CANDIDATE_CREATED`        | `CandidateTrackingListener`   | 更新候选统计 + 检查是否达到审核阈值            |
| `PAYWALL_TRIGGERED`        | `PaywallAnalyticsListener`    | 转化漏斗分析 + A/B 实验记录                    |
| `GOAL_ACHIEVED`            | Phase 2 实现                  | 游戏化系统触发                                 |
| `CANDIDATE_PROMOTED`       | Phase 2 实现                  | 候选食物合并入主库                             |

**4.5.2 统一事件命名**

```typescript
// 修复: apple-iap.service.ts
// 修改前: this.eventEmitter.emit('subscription.apple.expired', ...)
// 修改后: this.eventEmitter.emit(DomainEvents.SUBSCRIPTION_CHANGED, { ...payload, subType: 'expired' })
```

**4.5.3 清理僵尸队列**

| 队列               | 决策                   | 理由                                               |
| ------------------ | ---------------------- | -------------------------------------------------- |
| `profile-update`   | 移除注册               | 画像更新已通过事件驱动 + Cron 实现，不需要独立队列 |
| `feedback-process` | 移除注册               | 反馈处理已在 feedback.service.ts 同步完成          |
| `export`           | Phase 2 实现 Processor | 导出功能是 Premium 能力，后续实现                  |

**4.5.4 完整事件流架构（V6.2）**

```
用户操作
  │
  ├─ 记录饮食 ──emit──▶ MEAL_RECORDED
  │                      ├─▶ RealtimeProfileService (短期画像更新)
  │                      └─▶ ProfileCacheInvalidationListener (缓存失效)
  │
  ├─ 提交反馈 ──emit──▶ FEEDBACK_SUBMITTED
  │                      └─▶ RealtimeProfileService (偏好学习)
  │
  ├─ 更新画像 ──emit──▶ PROFILE_UPDATED
  │                      ├─▶ ProfileChangeLogService (变更日志)
  │                      ├─▶ PrecomputeService (删除预计算)
  │                      └─▶ ProfileCacheInvalidationListener (缓存失效) ← 新增
  │
  ├─ 食物分析 ──emit──▶ ANALYSIS_COMPLETED
  │                      ├─▶ AnalysisEventListener (分析画像)
  │                      └─▶ AnalysisIngestionService (入库编排)
  │
  ├─ 保存分析 ──emit──▶ ANALYSIS_SAVED_TO_RECORD
  │                      └─▶ AnalysisSaveListener (关联+命中计数) ← 新增
  │
  ├─ 获取推荐 ──emit──▶ RECOMMENDATION_GENERATED
  │                      └─▶ RecommendationEventListener (统计+学习) ← 新增
  │
  ├─ 订阅变更 ──emit──▶ SUBSCRIPTION_CHANGED
  │                      └─▶ SubscriptionEventListener (缓存+权限刷新) ← 新增
  │
  └─ 付费墙碰壁 ──emit─▶ PAYWALL_TRIGGERED
                         └─▶ PaywallAnalyticsListener (转化分析) ← 新增
```

---

## 5. 技术路线图

### Phase 1: 安全修复 + 正确性保障（短期，1-2 周）

**目标**: 修复所有安全漏洞和正确性 bug，确保系统可安全上线。

| #   | 任务                                                       | 优先级 | 风险 | 预估工时 |
| --- | ---------------------------------------------------------- | ------ | ---- | -------- |
| 1.1 | 修复 `food.service.ts:273` 未传 `userConstraints`          | P0     | 低   | 0.5 天   |
| 1.2 | 实现 Apple JWS 根证书链验证                                | P0     | 中   | 2 天     |
| 1.3 | 实现微信支付通知签名验证                                   | P0     | 中   | 1 天     |
| 1.4 | 修复 `getActiveSubscription` CANCELLED 状态查询条件        | P0     | 低   | 0.5 天   |
| 1.5 | `vector-search.service.ts` $queryRawUnsafe → $queryRaw     | P0     | 低   | 1 天     |
| 1.6 | 修复短期画像 categoryPreferences 维度（mealType→category） | P1     | 低   | 0.5 天   |
| 1.7 | Apple 通知去重迁移至 Redis                                 | P1     | 低   | 0.5 天   |
| 1.8 | 微信支付计划匹配改为 plan_id 关联                          | P1     | 低   | 0.5 天   |
| 1.9 | 行为画像 Onboarding 完成时自动创建                         | P1     | 低   | 0.5 天   |

**总预估**: ~7 天

**验证方式**:

- 支付: 模拟 Apple/微信 webhook，验证签名校验拦截伪造请求
- 推荐: 创建有过敏原的测试用户，通过 `food.service` 路径请求推荐，确认过敏食物被过滤
- 画像: 提交反馈后检查 Redis 中 categoryPreferences 的 key 是否为食物品类

---

### Phase 2: 事件链路补齐 + 画像增强（中期，2-3 周）

**目标**: 让事件驱动架构真正运转，画像数据被充分利用。

| #    | 任务                                                     | 优先级 | 风险 | 预估工时 |
| ---- | -------------------------------------------------------- | ------ | ---- | -------- |
| 2.1  | 实现 `SubscriptionEventListener`                         | P1     | 低   | 1 天     |
| 2.2  | 实现 `RecommendationEventListener`                       | P1     | 低   | 1 天     |
| 2.3  | 实现 `AnalysisSaveListener`                              | P2     | 低   | 0.5 天   |
| 2.4  | 实现 `PaywallAnalyticsListener`                          | P2     | 低   | 0.5 天   |
| 2.5  | 实现 `AnalysisTrackingListener`                          | P2     | 低   | 0.5 天   |
| 2.6  | 所有 @OnEvent 改为 `{ async: true }`                     | P1     | 低   | 0.5 天   |
| 2.7  | ProfileCacheService 事件驱动失效                         | P1     | 低   | 0.5 天   |
| 2.8  | 清理/移除 3 个僵尸队列（或实现 export Processor）        | P2     | 低   | 0.5 天   |
| 2.9  | 统一事件命名（Apple expired 事件）                       | P2     | 低   | 0.5 天   |
| 2.10 | 新增 `ProfileResolverService` 统一画像聚合               | P1     | 中   | 2 天     |
| 2.11 | 扩展 `UserProfileConstraints` → `EnrichedProfileContext` | P1     | 中   | 1 天     |
| 2.12 | 接入上下文画像到主推荐路径                               | P1     | 中   | 1.5 天   |
| 2.13 | Redis mget 批量读取优化                                  | P2     | 低   | 0.5 天   |
| 2.14 | `portionTendency` 接入推荐份量调整                       | P2     | 低   | 0.5 天   |

**总预估**: ~11 天

**验证方式**:

- 事件: 订阅变更后检查缓存是否立即失效
- 画像: 推荐请求日志中确认 `EnrichedProfileContext` 包含完整字段
- 性能: 对比 mget vs 逐个 get 的响应时间

---

### Phase 3: 推荐精度 + 搜索升级 + 工程优化（中长期，3-4 周）

**目标**: 提升推荐个性化深度和搜索体验，消除工程债务。

| #    | 任务                                                      | 优先级 | 风险 | 预估工时 |
| ---- | --------------------------------------------------------- | ------ | ---- | -------- |
| 3.1  | 推荐引擎 `recommendMealFromPool` 参数 Request 对象化      | P2     | 中   | 2 天     |
| 3.2  | 评分权重可配置化（按目标类型）                            | P2     | 中   | 1.5 天   |
| 3.3  | addedSugar 区分评分                                       | P2     | 低   | 0.5 天   |
| 3.4  | 声明画像新字段接入推荐（cooking/budget/cuisine）          | P2     | 中   | 2 天     |
| 3.5  | 食物库搜索升级（pg_trgm + 可选 pgvector 语义）            | P2     | 中   | 3 天     |
| 3.6  | Cron 批量处理改为游标分页                                 | P3     | 低   | 1 天     |
| 3.7  | 版本号并发安全（DB 序列 + UNIQUE 约束）                   | P3     | 低   | 0.5 天   |
| 3.8  | 实现 `GOAL_ACHIEVED` / `CANDIDATE_PROMOTED` 事件 listener | P3     | 低   | 1 天     |
| 3.9  | 统一更多 Redis 使用者到 TieredCacheManager                | P3     | 中   | 2 天     |
| 3.10 | 实现 `export` 队列 Processor                              | P3     | 低   | 1.5 天   |

**总预估**: ~15 天

**验证方式**:

- 推荐: A/B 对比有无 cooking/budget 字段的推荐质量差异
- 搜索: 测试同义词搜索（"鸡排" → "炸鸡排"/"香煎鸡排"）命中率
- 性能: Cron 任务在 10000 用户下的内存占用

---

### 总工时估算

| Phase    | 工时       | 定位             |
| -------- | ---------- | ---------------- |
| Phase 1  | ~7 天      | 上线前必做       |
| Phase 2  | ~11 天     | 上线后第一轮迭代 |
| Phase 3  | ~15 天     | 持续优化         |
| **总计** | **~33 天** |                  |

---

## 6. 数据迁移

### 6.1 Schema 变更

V6.2 **不新增数据库表**。所有变更在应用层完成。

### 6.2 数据初始化

**行为画像补建**

对已完成 Onboarding 但无 `user_behavior_profiles` 记录的用户，需要批量创建空行为画像。

```sql
-- 数据迁移脚本: 为已完成 onboarding 但缺失行为画像的用户创建空记录
INSERT INTO user_behavior_profiles (id, user_id, created_at, updated_at)
SELECT
  uuid_generate_v4(),
  up.user_id,
  NOW(),
  NOW()
FROM user_profiles up
LEFT JOIN user_behavior_profiles ubp ON ubp.user_id = up.user_id
WHERE up.onboarding_completed = true
  AND ubp.id IS NULL;

-- 同样为缺失推断画像的用户创建
INSERT INTO user_inferred_profiles (id, user_id, created_at, updated_at)
SELECT
  uuid_generate_v4(),
  up.user_id,
  NOW(),
  NOW()
FROM user_profiles up
LEFT JOIN user_inferred_profiles uip ON uip.user_id = up.user_id
WHERE up.onboarding_completed = true
  AND uip.id IS NULL;
```

**短期画像 key 迁移**

`categoryPreferences` 从 mealType key 改为 category key 后，Redis 中旧数据格式不兼容。但 TTL 为 7 天，自然过期即可。不需要迁移脚本。

### 6.3 Redis 数据

**Apple 通知去重 Set**

从内存 Set 迁移到 Redis。首次部署后内存 Set 为空，Redis 也为空。已处理过的旧通知如果再次到达会被重复处理一次，但 Apple 通知处理是幂等的（upsert 模式），所以安全。不需要迁移脚本。

---

## 7. 文档变更说明

### 7.1 新增章节

| 文件   | 新增内容          |
| ------ | ----------------- |
| 本文档 | V6.2 完整升级设计 |

### 7.2 需要更新的现有文档

| 文件                                           | 修改内容                                       |
| ---------------------------------------------- | ---------------------------------------------- |
| `系统架构总览.md`                              | 更新事件驱动架构部分，补充新增的 6 个 listener |
| `系统架构总览.md`                              | 更新模块关系图，标注 ProfileResolverService    |
| `INTELLIGENT_DIET_SYSTEM_V6_1_OPTIMIZATION.md` | 标注已发现的 bug（S1-S5、A1-A7），引用本文档   |

### 7.3 无需删除的内容

V6.2 不推翻任何 V6.1 设计，所有 V6.1 文档继续有效。本文档为增量补充。

---

## 附录 A: 审计数据来源

本升级方案基于以下代码审计：

| 审计范围       | 文件数 | 行数  | 审计内容                             |
| -------------- | ------ | ----- | ------------------------------------ |
| 推荐引擎       | 13     | ~6927 | 评分模型、管道流程、A/B、策略        |
| 用户画像       | 8+     | ~3500 | 三层画像、更新机制、缓存、Onboarding |
| 订阅系统       | 10+    | ~4000 | 支付安全、门控、配额、裁剪           |
| 缓存/事件/性能 | 10+    | ~3000 | 缓存架构、事件流、队列、索引         |

## 附录 B: 推荐引擎 10 维评分模型参考

| 维度     | 权重 | 计算方式                                |
| -------- | ---- | --------------------------------------- |
| 能量匹配 | 25   | 目标卡路里偏差惩罚                      |
| 蛋白质   | 20   | 每卡蛋白密度评分                        |
| 加工度   | 15   | isProcessed + isFried + processingLevel |
| 饱腹感   | 10   | satietyScore + 纤维 + 蛋白因子          |
| 多样性   | 10   | 最近食物去重距离                        |
| 血糖影响 | 8    | GI + GL + 碳水比                        |
| 微量NRF  | 7    | NRF 9.3 评分                            |
| 纤维奖励 | 5    | 每份纤维含量                            |
| 质量置信 | -    | 数据可信度乘数                          |
| 偏好匹配 | -    | Thompson Sampling 四维加权              |

## 附录 C: 全部审计问题索引

| 编号 | 类型 | 严重度 | Phase | 描述                                                |
| ---- | ---- | ------ | ----- | --------------------------------------------------- |
| S1   | 安全 | P0     | 1     | Apple IAP JWS 签名未验证根证书链                    |
| S2   | 安全 | P0     | 1     | 微信支付通知签名验证未实现                          |
| S3   | 安全 | P0     | 1     | getActiveSubscription CANCELLED 状态查询条件 bug    |
| S4   | 安全 | P0     | 1     | food.service 推荐未传 userConstraints（过敏原遗漏） |
| S5   | 安全 | P0     | 1     | vector-search 15处 $queryRawUnsafe SQL注入风险      |
| A1   | 架构 | P1     | 2     | 8/13 事件无 listener                                |
| A2   | 架构 | P1     | 2     | 3/6 队列无 Processor                                |
| A3   | 架构 | P1     | 2     | ProfileCache 不被事件自动失效                       |
| A4   | 架构 | P1     | 2     | 上下文画像未接入主推荐                              |
| A5   | 架构 | P1     | 1     | 短期画像 categoryPreferences 维度错误               |
| A6   | 架构 | P1     | 2     | 同步事件 listener 阻塞请求                          |
| A7   | 架构 | P1     | 1     | Apple 通知去重用内存 Set                            |
| F1   | 功能 | P2     | 2     | UserProfileConstraints 字段不足                     |
| F2   | 功能 | P2     | 2     | 行为画像 5 字段空转                                 |
| F3   | 功能 | P2     | 1     | 行为画像创建时机不明确                              |
| F4   | 功能 | P2     | 3     | 食物库搜索仅 ILIKE                                  |
| F5   | 功能 | P2     | 1     | 微信支付计划匹配通过金额                            |
