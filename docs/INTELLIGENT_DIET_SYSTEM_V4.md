# 智能饮食推荐系统 V4 升级设计文档

> **版本**: V4.0 | **日期**: 2026-04-09  
> **定位**: 基于 V3 系统代码逆向分析，渐进式升级设计  
> **升级策略**: 不重写、不破坏现有功能，渐进式演进  
> **覆盖范围**: 正确性修复 · 推荐引擎拆分 · 性能优化 · 学习层闭环 · 评分透明化

---

## 目录

- [总览：V3→V4 升级全景](#总览v3v4-升级全景)
- [一、V3 系统评估](#一v3-系统评估)
- [二、V4 升级核心目标](#二v4-升级核心目标)
- [三、Critical Bug 修复清单](#三critical-bug-修复清单)
- [四、模块优化方案](#四模块优化方案)
- [五、技术路线图](#五技术路线图)
- [六、风险与权衡](#六风险与权衡)
- [七、五层架构 V4 目标状态](#七五层架构-v4-目标状态)
- [附录：核心文件索引](#附录核心文件索引)

---

## 总览：V3→V4 升级全景

### 代码逆向分析覆盖范围

| 子系统     | 分析文件数 | 总代码行数 | 关键发现                    |
| ---------- | :--------: | :--------: | --------------------------- |
| 推荐引擎   |     7      |   ~2,200   | 955 行单体编排器需拆分      |
| 评分系统   |     2      |    ~750    | 碳水/脂肪评分不区分目标     |
| 行为追踪   |     1      |    ~420    | 3 个 Critical 数据计算 Bug  |
| 每日计划   |     1      |    ~520    | 餐次比例硬编码              |
| 用户画像   |     6      |   ~1,000   | 内存缓存不支持多实例        |
| 食物数据库 |     10     |   ~1,550   | compatibility 字段未消费    |
| **合计**   |   **27**   | **~6,440** | 7 Critical Bug + 7 架构问题 |

### V4 升级分层定位

```
V3 实际状态                           V4 升级目标
────────────────────────────────────────────────────────
L5 · 学习层    ⬛⬛⬛⬜⬜ 55%  →  ⬛⬛⬛⬛⬜ 85%
  FeedbackCollector     ✅            ✅ 保持
  PreferenceUpdater     ⚠️ 部分      ✅ 自动更新管线
  WeightDecayScheduler  ❌            ✅ 权重衰减调度器
  ScoringExplainer      ❌            ✅ [V4新增] 评分透明化

L4 · 推荐层    ⬛⬛⬛⬛⬛ 95%  →  ⬛⬛⬛⬛⬛ 98%
  MealPlanner           ✅            ✅ 餐次比例自适应
  DiversityEngine       ✅            ✅ + 食物搭配关系
  ExplorationStrategy   ✅            ✅ 保持
  SubstitutionEngine    ✅            ✅ + 跨品类替代

L3 · 评分层    ⬛⬛⬛⬛⬜ 90%  →  ⬛⬛⬛⬛⬛ 97%
  NutrientScorer        ✅            ✅ 宏量评分自适应
  PenaltyEngine         ✅            ✅ 命名统一
  ContextModifier       ✅            ✅ + 时区修复

L2 · 特征层    ⬛⬛⬛⬜⬜ 45%  →  ⬛⬛⬛⬜⬜ 65%
  FoodPoolCache         ❌            ✅ [V4新增] 食物池缓存
  ScoringExplanation    ❌            ✅ [V4新增] 评分解释结构

L1 · 数据层    ⬛⬛⬛⬛⬜ 80%  →  ⬛⬛⬛⬛⬜ 90%
  FK 约束完整性         ⚠️            ✅ 补全外键
  行为数据正确性        ❌            ✅ streak/compliance 修复
```

---

## 一、V3 系统评估

### 1.1 优点（保留的设计）

| 设计                  | 评价                                                  | 代码位置                           |
| --------------------- | ----------------------------------------------------- | ---------------------------------- |
| **三阶段 Pipeline**   | 工业级 Recall→Rank→Rerank，各阶段职责清晰             | `recommendation-engine.service.ts` |
| **9 维非线性评分**    | 高斯/Sigmoid/对数/分段函数选型合理                    | `food-scorer.service.ts`           |
| **三维权重叠加**      | 目标×餐次×状态，`computeWeights()` 归一化             | `recommendation.types.ts`          |
| **Thompson Sampling** | Beta 分布采样完整实现（含 Gamma/Box-Muller）          | `meal-assembler.service.ts`        |
| **独立惩罚引擎**      | 硬否决 + 软惩罚分层，与评分解耦                       | `penalty-engine.service.ts`        |
| **三层用户画像**      | 声明/行为/推断分离，关注点清晰                        | `user/entities/*.entity.ts`        |
| **食物数据库**        | 59 字段、6 关联表、完整 ETL 管线                      | `food/entities/*.entity.ts`        |
| **跨餐补偿**          | 偏差>10% 自动补偿晚餐                                 | `daily-plan.service.ts`            |
| **食物替代**          | 四维评分（相似度×0.35+营养×0.30+历史×0.20+偏好×0.15） | `recommendation-engine.service.ts` |

### 1.2 发现的问题

#### A. 正确性 Bug（7 个 Critical）

| #      | Bug                                       | 位置                                   | 影响                                 | 根因                                         |
| ------ | ----------------------------------------- | -------------------------------------- | ------------------------------------ | -------------------------------------------- |
| **B1** | Streak 按记录递增而非按天                 | `behavior.service.ts:106-116`          | streakDays 一天可递增多次，严重膨胀  | `updateStreak` 在每条 food record 保存后调用 |
| **B2** | Streak 永不重置                           | `behavior.service.ts`                  | 超标日 streak 仅跳过递增，不归零     | 无 `streakDays = 0` 的代码路径               |
| **B3** | healthyRecords 按记录计数而非按天         | `behavior.service.ts:107`              | avgComplianceRate 严重失真           | 早上记录总是"健康的"（还没吃够）             |
| **B4** | estimatedWeeksLeft 从未计算               | `profile-inference.service.ts`         | 目标迁移建议的"长期停滞"规则是死代码 | refreshInference 中只计算了 progressPercent  |
| **B5** | Health condition 命名不一致               | constraint-generator vs penalty-engine | 约束生成和惩罚引擎不同步             | 前者用 `diabetes_type2`，后者用 `diabetes`   |
| **B6** | 弱时段检测用服务器时间                    | `constraint-generator.service.ts`      | 非服务器时区用户约束错误             | `new Date().getHours()` 用服务器时区         |
| **B7** | Collection trigger 用 totalRecords 当天数 | `collection-trigger.service.ts`        | 一天记 7 餐 = 7 天使用，触发时机错误 | `usageDays = behavior?.totalRecords \|\| 0`  |

#### B. 架构问题（7 个）

| #      | 问题                           | 位置                                             | 影响                                    |
| ------ | ------------------------------ | ------------------------------------------------ | --------------------------------------- |
| **A1** | 推荐引擎单体 955 行            | `recommendation-engine.service.ts`               | 编排+数据访问+替代+反馈+偏好混在一起    |
| **A2** | 无食物池缓存                   | `getAllFoods()`                                  | 每次推荐全表扫描                        |
| **A3** | 内存缓存不支持多实例           | `profile-cache.service.ts`                       | 多 Pod 部署缓存不一致                   |
| **A4** | 分段逻辑重复                   | `ProfileInferenceService` + `ProfileCronService` | 两份 `inferUserSegment`，修一处忘另一处 |
| **A5** | `toMealPlan` 转换重复          | `daily-plan.service.ts`                          | 两份几乎相同的实现                      |
| **A6** | 三层过敏原过滤冗余             | food-filter + recall + penalty-engine            | 不一致风险                              |
| **A7** | ProfileCache 不传递 regionCode | `profile-cache.service.ts`                       | 推荐引擎无法通过缓存获取地区            |

#### C. 扩展性问题（7 个）

| #      | 问题                                    | 影响                               |
| ------ | --------------------------------------- | ---------------------------------- |
| **E1** | 评分权重/公式全部硬编码                 | 无法 A/B 测试                      |
| **E2** | 碳水/脂肪评分不区分目标                 | fat_loss 和 muscle_gain 用相同范围 |
| **E3** | 餐次比例固定 `{0.25, 0.35, 0.30, 0.10}` | 不随目标/用户调整                  |
| **E4** | 跨餐补偿只改晚餐                        | 如果早餐偏差最大，改晚餐无效       |
| **E5** | `compatibility`（搭配关系）从未被使用   | 食物数据浪费                       |
| **E6** | Tip 生成硬编码中文                      | 无 i18n 支持                       |
| **E7** | 食物替代只限同 category                 | 无法跨品类替代                     |

#### D. 性能瓶颈

| #      | 问题                          | 当前影响             | 规模化影响        |
| ------ | ----------------------------- | -------------------- | ----------------- |
| **P1** | 每次推荐全表加载              | ~500ms@1000 食物     | 不可接受@10K 食物 |
| **P2** | O(N\*M) 评分                  | ~100ms@3\*1000       | 线性增长          |
| **P3** | 同步 CPU 密集评分阻塞事件循环 | 低并发可接受         | 高并发 P99 飙升   |
| **P4** | `adjustPlan` 重复加载全表     | 两次 `getAllFoods()` | 浪费              |

#### E. 技术债

| #      | 问题                                                   |
| ------ | ------------------------------------------------------ |
| **D1** | `profile: any` 丢失类型安全                            |
| **D2** | `undefined as any` 可能导致 DB NOT NULL 违反           |
| **D3** | DailyPlan/RecommendationFeedback 无 FK 约束            |
| **D4** | RecommendationFeedback.userId 类型为 varchar 而非 uuid |
| **D5** | 零测试覆盖 — 核心评分公式无单元测试                    |
| **D6** | bodyFatPercent 仅影响置信度，未用于 Katch-McArdle BMR  |
| **D7** | profileVersion 永远为 1，无迁移逻辑                    |
| **D8** | 评分原因不持久化，推荐解释不可查                       |

---

## 二、V4 升级核心目标

| #      | 目标                 | 动机                                                            | 预期价值                             |
| ------ | -------------------- | --------------------------------------------------------------- | ------------------------------------ |
| **G1** | **正确性修复**       | 行为数据（streak/compliance）严重失真 → 影响用户分段 → 推荐权重 | 数据可信度从"不可用"→"可信赖"        |
| **G2** | **推荐引擎可观测性** | 推荐是黑箱，无法调试/量化质量                                   | 支撑 A/B 测试、运营调参、用户信任    |
| **G3** | **性能与缓存架构**   | 每次推荐全表扫描 + 内存缓存无法多实例                           | P99 从 ~500ms → <100ms，支撑水平扩展 |
| **G4** | **推荐精度提升**     | 碳水/脂肪评分不区分目标 + 搭配关系浪费 + 替代局限               | 推荐接受率预期提升 15-20%            |
| **G5** | **学习层闭环**       | L5 学习层 55% 是系统最大短板                                    | 推荐越用越准的正循环                 |

---

## 三、Critical Bug 修复清单

### 3.1 Streak 逻辑重写（B1 + B2 + B3）

**文件**: `behavior.service.ts`

**当前逻辑（有 Bug）**:

```typescript
// 每条食物记录保存后调用
async updateStreak(userId) {
  const summary = await getDailySummary(userId, today);
  const profile = await getProfile(userId);
  if (totalCalories > 0 && totalCalories <= goal) {
    profile.healthyRecords += 1;  // Bug B3: 按记录计数
    profile.streakDays += 1;       // Bug B1: 一天多次递增
    profile.longestStreak = Math.max(...);
  }
  // Bug B2: 无 else { streakDays = 0 }
  profile.avgComplianceRate = healthyRecords / totalRecords;
}
```

**V4 修复方案**:

```typescript
async updateStreak(userId: string) {
  const profile = await this.getProfile(userId);
  const today = new Date().toISOString().slice(0, 10);

  // 防止同一天重复处理
  if (profile.lastStreakDate === today) return;

  // 查询昨日摘要判断是否达标
  const yesterday = /* today - 1 day */;
  const yesterdaySummary = await this.dailySummaryRepo.findOne({
    where: { userId, date: yesterday },
  });

  if (yesterdaySummary) {
    const goal = yesterdaySummary.calorieGoal || 2000;
    const actual = yesterdaySummary.totalCalories || 0;
    const isCompliant = actual > 0
      && actual >= goal * 0.8
      && actual <= goal * 1.1;

    if (isCompliant) {
      profile.streakDays += 1;
      profile.longestStreak = Math.max(profile.longestStreak, profile.streakDays);
    } else {
      profile.streakDays = 0;  // 修复 B2: 不达标归零
    }
  }

  // 修复 B3: 合规率按天计算
  const [result] = await this.dailySummaryRepo.query(`
    SELECT
      COUNT(*) as total_days,
      SUM(CASE WHEN total_calories > 0
        AND total_calories >= calorie_goal * 0.8
        AND total_calories <= calorie_goal * 1.1
        THEN 1 ELSE 0 END) as healthy_days
    FROM daily_summaries
    WHERE user_id = $1
      AND date >= CURRENT_DATE - INTERVAL '30 days'
  `, [userId]);

  profile.avgComplianceRate = result.total_days > 0
    ? Number(result.healthy_days) / Number(result.total_days)
    : 0;

  profile.lastStreakDate = today;
  await this.behaviorRepo.save(profile);
}
```

**需新增字段**: `UserBehaviorProfile.lastStreakDate` (varchar(10), nullable)

### 3.2 Health Condition 命名统一（B5）

**当前不一致**:

| constraint-generator | penalty-engine   | 标准值（V4）      |
| -------------------- | ---------------- | ----------------- |
| `diabetes_type2`     | `diabetes`       | `diabetes_type2`  |
| `high_cholesterol`   | `hyperlipidemia` | `hyperlipidemia`  |
| `hypertension`       | `hypertension`   | `hypertension` ✅ |
| `gout`               | —                | `gout`            |
| `kidney_disease`     | —                | `kidney_disease`  |
| `fatty_liver`        | —                | `fatty_liver`     |

**V4 方案**: 定义标准枚举 + 两侧统一

```typescript
// recommendation.types.ts 新增
export enum HealthCondition {
  DIABETES_TYPE2 = 'diabetes_type2',
  HYPERTENSION = 'hypertension',
  HYPERLIPIDEMIA = 'hyperlipidemia',
  GOUT = 'gout',
  KIDNEY_DISEASE = 'kidney_disease',
  FATTY_LIVER = 'fatty_liver',
}
```

### 3.3 Collection Trigger 用日历天数（B7）

**当前**: `usageDays = behavior?.totalRecords || 0`
**修复**: `usageDays = Math.floor((Date.now() - profile.createdAt.getTime()) / 86400000)`

### 3.4 时区修复（B6）

**当前**: `new Date().getHours()` — 服务器时区
**修复**: 从 `UserProfile` 或请求头获取用户时区偏移

```typescript
// constraint-generator.service.ts
const userHour = userProfile?.timezoneOffset
  ? (new Date().getUTCHours() + userProfile.timezoneOffset + 24) % 24
  : new Date().getHours(); // fallback 服务器时间
```

### 3.5 estimatedWeeksLeft 计算（B4）

**文件**: `profile-inference.service.ts`

```typescript
// 在 refreshInference.goalProgress 计算块中新增:
const recentWeights = await this.getRecentWeightRecords(userId, 28); // 近 4 周
const weeklyChange = this.calcWeeklyWeightTrend(recentWeights);

if (weeklyChange !== 0 && profile.targetWeightKg) {
  const remaining = Math.abs(profile.targetWeightKg - profile.weightKg);
  goalProgress.estimatedWeeksLeft = Math.ceil(remaining / Math.abs(weeklyChange));
} else {
  goalProgress.estimatedWeeksLeft = 999; // 停滞
}
```

### 3.6 ProfileCache 传递 regionCode（A7）

**文件**: `profile-cache.service.ts`

在 `getUserConstraints()` 返回对象中添加:

```typescript
regionCode: declared?.regionCode || 'CN',
```

---

## 四、模块优化方案

### 4.1 推荐引擎拆分（A1）

**当前**: `recommendation-engine.service.ts` 955 行 = 编排 + 数据访问 + 替代 + 反馈 + 偏好

**V4 拆分为 5 个服务**:

```
recommendation-engine.service.ts (保留, ~350行)
  └── 纯 Pipeline 编排: Recall → Rank → Rerank → Assemble

substitution.service.ts (新增, ~150行)
  └── findSubstitutes, similarity 计算

feedback.service.ts (新增, ~80行)
  └── submitFeedback, getUserFeedbackStats

preference-profile.service.ts (新增, ~100行)
  └── getUserPreferenceProfile, getRegionalBoostMap

food-pool-cache.service.ts (新增, ~80行)
  └── getVerifiedFoods (带 TTL 缓存)
```

**拆分策略**: 两步走

1. 第一步：提取代码到新文件，原文件保留 wrapper 方法（向后兼容）
2. 第二步：确认无外部调用后删除 wrapper

### 4.2 评分解释结构化（D8）

**新增接口**:

```typescript
interface ScoringExplanation {
  dimensions: {
    calories: { raw: number; weighted: number };
    protein: { raw: number; weighted: number };
    carbs: { raw: number; weighted: number };
    fat: { raw: number; weighted: number };
    quality: { raw: number; weighted: number };
    satiety: { raw: number; weighted: number };
    glycemic: { raw: number; weighted: number };
    nutrientDensity: { raw: number; weighted: number };
    inflammation: { raw: number; weighted: number };
  };
  novaPenalty: number;
  penaltyResult: { multiplier: number; reasons: string[]; vetoed: boolean };
  preferenceBoost: number;
  regionalBoost: number;
  explorationMultiplier: number;
  finalScore: number;
}
```

**`ScoredFood` 扩展**:

```typescript
interface ScoredFood {
  food: FoodLibrary;
  score: number;
  servingMultiplier: number;
  explanation?: ScoringExplanation; // V4 新增, optional
}
```

### 4.3 食物池缓存（P1, P4）

```typescript
@Injectable()
export class FoodPoolCacheService {
  private cache: { data: FoodLibrary[]; expiry: number } | null = null;
  private readonly TTL = 5 * 60 * 1000; // 5 分钟

  async getVerifiedFoods(repo: Repository<FoodLibrary>): Promise<FoodLibrary[]> {
    if (this.cache && Date.now() < this.cache.expiry) {
      return this.cache.data;
    }
    const foods = await repo.find({
      where: { status: 'active', isVerified: true },
    });
    this.cache = { data: foods, expiry: Date.now() + this.TTL };
    return foods;
  }

  invalidate(): void {
    this.cache = null;
  }
}
```

### 4.4 目标自适应宏量评分（E2）

**当前**: 碳水/脂肪评分固定范围 `[0.4, 0.55]` / `[0.2, 0.35]`

**V4**: 按目标类型差异化

```typescript
const MACRO_RANGES: Record<
  GoalType,
  {
    carb: [number, number];
    fat: [number, number];
  }
> = {
  fat_loss: { carb: [0.3, 0.45], fat: [0.2, 0.35] },
  muscle_gain: { carb: [0.4, 0.6], fat: [0.15, 0.3] },
  health: { carb: [0.45, 0.55], fat: [0.2, 0.3] },
  habit: { carb: [0.4, 0.55], fat: [0.2, 0.35] },
};
```

### 4.5 目标自适应餐次比例（E3）

**当前**: 硬编码 `{ morning: 0.25, lunch: 0.35, dinner: 0.30, snack: 0.10 }`

**V4**:

```typescript
const MEAL_RATIOS: Record<GoalType, Record<string, number>> = {
  fat_loss: { morning: 0.3, lunch: 0.35, dinner: 0.25, snack: 0.1 },
  muscle_gain: { morning: 0.25, lunch: 0.3, dinner: 0.25, snack: 0.2 },
  health: { morning: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 },
  habit: { morning: 0.25, lunch: 0.35, dinner: 0.3, snack: 0.1 },
};
```

### 4.6 食物搭配关系消费（E5）

**当前**: `FoodLibrary.compatibility` 存储了 `goodWith/badWith` 但未使用

**V4**: 在 `MealAssemblerService` 角色选择循环中，每选一个食物后应用搭配修正:

- 已选食物 A 的 `goodWith` 包含候选 B → B 得分 `*= 1.10`
- 已选食物 A 的 `badWith` 包含候选 B → B 得分 `*= 0.80`

### 4.7 跨品类食物替代（E7）

**当前**: `findSubstitutes` 硬过滤 `food.category === original.category`

**V4**: 两阶段替代

1. 优先返回同品类候选
2. 如果同品类候选 < 3 个，扩展到相关品类（如 protein 类中的不同 foodGroup）
3. 跨品类替代标注 `{ crossCategory: true }` 供前端展示

### 4.8 偏好自动更新管线（G5）

**新增服务**: `preference-updater.service.ts`

**更新触发点**:

1. **即时更新**（submitFeedback 调用后）:
   - accepted → 对应 category 权重 `+= 0.05`
   - skipped → 对应 category 权重 `-= 0.03`
   - replaced → 原食物 category `-= 0.02`，替代食物 `+= 0.04`

2. **批量衰减**（双周 cron，与 tastePrefVector 同步）:

   ```
   newWeight = currentWeight * 0.9 + recentWeight * 0.1
   ```

3. **权重归一化**: 更新后所有权重重新归一化到 `[0.3, 1.5]`

### 4.9 权重衰减调度器

**新增服务**: `weight-decay-scheduler.service.ts`

**策略**: 对所有偏好维度每两周应用时间衰减因子 `decay = 0.95`，防止远古偏好长期主导。

### 4.10 分段逻辑去重（A4）

**当前**: `inferUserSegment` 在 `ProfileInferenceService` 和 `ProfileCronService` 各有一份

**V4**: 提取到共享方法

```typescript
// user/shared/segmentation.util.ts
export function inferUserSegment(
  profile: UserProfile,
  behavior: UserBehaviorProfile,
): string { ... }
```

### 4.11 过敏原过滤统一（A6）

**当前**: 三处独立检查（food-filter + recallCandidates + penalty-engine）

**V4**: 统一入口

- `FoodFilterService.filterFoods` 作为唯一过敏原过滤点
- `recallCandidates` 中删除过敏原过滤（委托给 filter）
- `PenaltyEngine` 中保留过敏原否决（作为兜底安全网，但不再是主要过滤层）

### 4.12 跨餐补偿增强（E4）

**当前**: 偏差>10% 时只重生成晚餐

**V4**: 选择偏差贡献最大的一餐重生成

```typescript
// 找出每餐与理想值的偏差
const deviations = meals.map((m) => ({
  mealType: m.type,
  deviation: Math.abs(m.calories - idealCalories[m.type]),
}));
// 选偏差最大的一餐重生成（排除已达标的）
const worstMeal = deviations.sort((a, b) => b.deviation - a.deviation)[0];
```

### 4.13 类型安全修复（D1, D2）

**当前**: `profile: any` 出现在多处

**V4**:

- `nutrition-score.service.ts` 的 `calculateDailyGoals(profile: any)` → `calculateDailyGoals(profile: UserProfile)`
- `daily-plan.service.ts` 的 `buildStrategy(goal, profile, goalType)` → 明确类型
- `undefined as any` → 使用 optional field 或 `?? null`

### 4.14 FK 约束补全（D3, D4）

**需添加 FK 的实体**:

- `DailyPlan.userId` → `@ManyToOne(() => AppUser)` + unique constraint `(userId, date)`
- `RecommendationFeedback.userId` → 类型从 `varchar` 改为 `uuid`
- `AiDecisionLog.recordId` → `@ManyToOne(() => FoodRecord, { nullable: true })`

### 4.15 核心评分公式单元测试（D5）

**测试覆盖目标**:

| 服务                         | 测试文件                               | 关键测试用例                                     |
| ---------------------------- | -------------------------------------- | ------------------------------------------------ |
| `FoodScorerService`          | `food-scorer.service.spec.ts`          | 9 维评分边界值、NOVA 惩罚、不同目标权重          |
| `PenaltyEngineService`       | `penalty-engine.service.spec.ts`       | 过敏原否决、健康状况惩罚、惩罚堆叠               |
| `MealAssemblerService`       | `meal-assembler.service.spec.ts`       | Thompson Sampling 统计分布、多样性控制、份量调整 |
| `ConstraintGeneratorService` | `constraint-generator.service.spec.ts` | 不同目标/状态的约束生成                          |

### 4.16 Katch-McArdle BMR（D6）

**当前**: `bodyFatPercent` 仅影响置信度分数

**V4**: 当 `bodyFatPercent` 存在时使用 Katch-McArdle 公式:

```typescript
if (profile.bodyFatPercent) {
  const leanMass = profile.weightKg * (1 - profile.bodyFatPercent / 100);
  bmr = 370 + 21.6 * leanMass; // Katch-McArdle
} else {
  // 保持 Harris-Benedict
}
```

---

## 五、技术路线图

### Phase 1：正确性修复 + 快速收益（1-2 周）

> **原则**: 风险低，不改变架构，修复影响数据质量的 Bug + 评分精度提升

| #    | 任务                                | 优先级 | 工作量 | 依赖 | 改动文件                                                                | 状态 |
| ---- | ----------------------------------- | :----: | :----: | ---- | ----------------------------------------------------------------------- | :--: |
| 1.1  | Streak 逻辑重写（B1+B2+B3）         |   P0   |   1d   | 无   | `behavior.service.ts`                                                   |  ⬜  |
| 1.2  | Health condition 命名统一（B5）     |   P0   |  0.5d  | 无   | `penalty-engine.service.ts` + `constraint-generator.service.ts` + types |  ⬜  |
| 1.3  | Collection trigger 用日历天数（B7） |   P0   |  0.5d  | 无   | `collection-trigger.service.ts`                                         |  ⬜  |
| 1.4  | 时区修复（B6）                      |   P1   |  0.5d  | 无   | `constraint-generator.service.ts`                                       |  ⬜  |
| 1.5  | estimatedWeeksLeft 计算（B4）       |   P1   |   1d   | 无   | `profile-inference.service.ts`                                          |  ⬜  |
| 1.6  | ProfileCache 传递 regionCode（A7）  |   P0   |  0.5h  | 无   | `profile-cache.service.ts`                                              |  ⬜  |
| 1.7  | 目标自适应宏量评分范围（E2）        |   P1   |  0.5d  | 无   | `food-scorer.service.ts` + types                                        |  ⬜  |
| 1.8  | 目标自适应餐次比例（E3）            |   P1   |  0.5d  | 无   | `daily-plan.service.ts` + types                                         |  ⬜  |
| 1.9  | 类型安全修复（D1+D2）               |   P2   |   1d   | 无   | 多文件 `any` → 具体类型                                                 |  ⬜  |
| 1.10 | FK 约束补全（D3+D4）                |   P2   |   1d   | 无   | Entity 文件 + migration                                                 |  ⬜  |
| 1.11 | 旧 streak/compliance 数据重算脚本   |   P1   |  0.5d  | 1.1  | migration script                                                        |  ⬜  |

**Phase 1 交付物**:

- 行为数据（streak/compliance）可信赖
- 健康状况在整个推荐管线中一致处理
- 宏量评分和餐次比例按目标自适应
- 类型安全 + FK 约束完整

---

### Phase 2：架构增强 + 性能优化（2-3 周）

> **原则**: 拆分单体服务，引入缓存，建立可观测性基础

| #   | 任务                       | 优先级 | 工作量 | 依赖 | 改动范围                           | 状态 |
| --- | -------------------------- | :----: | :----: | ---- | ---------------------------------- | :--: |
| 2.1 | 食物池缓存服务（P1+P4）    |   P0   |   1d   | 无   | 新增 `food-pool-cache.service.ts`  |  ⬜  |
| 2.2 | 推荐引擎拆分（A1）         |   P1   |   3d   | 无   | 提取 4 个子服务                    |  ⬜  |
| 2.3 | 评分解释结构（D8）         |   P1   |   2d   | 2.2  | `ScoringExplanation` + scorer 变更 |  ⬜  |
| 2.4 | 过敏原过滤统一（A6）       |   P1   |   1d   | 2.2  | 合并三处过滤                       |  ⬜  |
| 2.5 | 分段逻辑去重（A4）         |   P1   |  0.5d  | 无   | 提取共享方法                       |  ⬜  |
| 2.6 | `toMealPlan` 去重（A5）    |   P2   |  0.5d  | 无   | 提取工具方法                       |  ⬜  |
| 2.7 | 食物搭配关系消费（E5）     |   P1   |   1d   | 无   | `meal-assembler.service.ts`        |  ⬜  |
| 2.8 | 核心评分公式单元测试（D5） |   P1   |   3d   | 无   | 新增 4 个 spec 文件                |  ⬜  |
| 2.9 | 跨品类食物替代（E7）       |   P2   |   2d   | 2.2  | `substitution.service.ts`          |  ⬜  |

**Phase 2 交付物**:

- 推荐引擎从 955 行拆分为 5 个独立服务
- 推荐延迟 P99 降至 <100ms（缓存命中率 >95%）
- 评分解释可查询
- 核心算法有测试覆盖

---

### Phase 3：智能化 + 学习闭环（3-4 周）

> **原则**: 完成 L5 学习层，引入更高级的个性化能力

| #   | 任务                         | 优先级 | 工作量 | 依赖    | 改动范围                                 | 状态 |
| --- | ---------------------------- | :----: | :----: | ------- | ---------------------------------------- | :--: |
| 3.1 | 偏好自动更新管线（G5）       |   P1   |   3d   | Phase 2 | 新增 `preference-updater.service.ts`     |  ⬜  |
| 3.2 | 权重衰减调度器               |   P2   |   2d   | 3.1     | 新增 `weight-decay-scheduler.service.ts` |  ⬜  |
| 3.3 | Katch-McArdle BMR（D6）      |   P2   |   1d   | 无      | `user-profile.service.ts`                |  ⬜  |
| 3.4 | 跨餐补偿增强（E4）           |   P1   |   2d   | 无      | `daily-plan.service.ts`                  |  ⬜  |
| 3.5 | Tip/反馈 i18n（E6）          |   P2   |   3d   | 无      | 提取文案到 i18n 资源                     |  ⬜  |
| 3.6 | 推荐质量仪表盘               |   P2   |   3d   | 2.3     | 基于 ScoringExplanation 的后台           |  ⬜  |
| 3.7 | Collection trigger 补全      |   P2   |   2d   | Phase 1 | 3 条未实现规则                           |  ⬜  |
| 3.8 | A/B 测试基础设施             |   P2   |   3d   | 2.3     | 评分权重按实验组动态加载                 |  ⬜  |
| 3.9 | Redis 缓存替换内存缓存（A3） |   P1   |   2d   | 2.1     | `food-pool-cache` + `profile-cache`      |  ⬜  |

**Phase 3 交付物**:

- L5 学习层完成度 55% → 85%
- 推荐系统具备自学习能力
- 支持多实例水平扩展（Redis）
- 运营团队可监控推荐质量

---

### Phase 4：高级特性（长期，按需）

| #   | 任务                       | 优先级 | 说明                    | 状态 |
| --- | -------------------------- | :----: | ----------------------- | :--: |
| 4.1 | Food Embedding (64维)      |   P3   | 手工特征向量 → 向量召回 |  ⬜  |
| 4.2 | 全局约束优化（背包/LP）    |   P3   | 替代逐餐贪心            |  ⬜  |
| 4.3 | 周计划生成                 |   P3   | 跨天多样性 + 营养周期化 |  ⬜  |
| 4.4 | 协同过滤                   |   P3   | 用户-食物交互矩阵       |  ⬜  |
| 4.5 | pgvector 集成              |   P3   | 向量数据库加速          |  ⬜  |
| 4.6 | purine/phosphorus 字段     |   P3   | 痛风/肾病量化约束       |  ⬜  |
| 4.7 | addedSugar vs naturalSugar |   P3   | NRF 9.3 精度提升        |  ⬜  |

---

## 六、风险与权衡

### 6.1 风险评估矩阵

| 任务                        | 风险等级 | 风险描述                           | 缓解措施                                                               |
| --------------------------- | :------: | ---------------------------------- | ---------------------------------------------------------------------- |
| Streak 逻辑重写 (1.1)       |    中    | 旧数据不一致，用户看到 streak 骤降 | 先运行重算脚本；客户端展示"系统校准"提示                               |
| Health condition 统一 (1.2) |    中    | DB migration 修改已存储值          | 写双向兼容映射层；保留旧值兼容 1 版本                                  |
| 推荐引擎拆分 (2.2)          |  **高**  | 最大改动，影响推荐核心流程         | 先提取后删除（两步走）；保留 wrapper 方法；100% 测试覆盖后才删除旧方法 |
| 偏好自动更新 (3.1)          |    中    | 自动调参导致推荐不稳定             | 权重变化上限（每次 +-5%）；保留手动 reset；灰度发布                    |
| Redis 缓存迁移 (3.9)        |    中    | 新增基础设施依赖                   | 保留内存缓存作为 fallback；Redis 不可用时降级                          |

### 6.2 数据迁移需求

| 迁移                    |  Phase  | 说明                             |          可逆性           |
| ----------------------- | :-----: | -------------------------------- | :-----------------------: |
| Streak/Compliance 重算  | Phase 1 | 遍历 DailySummary 重新计算       |           可逆            |
| HealthCondition 值转换  | Phase 1 | `diabetes` → `diabetes_type2` 等 |           可逆            |
| FK 约束添加             | Phase 1 | DailyPlan/Feedback 添加外键      |           可逆            |
| userId 类型转换         | Phase 1 | Feedback 的 varchar → uuid       | 不可逆（需确认无非 UUID） |
| lastStreakDate 字段新增 | Phase 1 | BehaviorProfile 新增字段         |           可逆            |

### 6.3 灰度策略

| 任务             | 建议                              |
| ---------------- | --------------------------------- |
| Phase 1 Bug 修复 | 直接全量（正确性修复不适合灰度）  |
| Phase 2 引擎拆分 | 影子模式：新旧同时运行，比较输出  |
| Phase 3 偏好更新 | 10% → 30% → 100%，每阶段观察 3 天 |
| Phase 3 Redis    | 双写：内存 + Redis，读 Redis 优先 |

### 6.4 关键权衡

| 权衡点                 | 取舍                                      |
| ---------------------- | ----------------------------------------- |
| 评分解释 vs 性能       | 仅在 Top-K 食物（Rerank 后）生成解释      |
| 偏好自动更新 vs 可控性 | 提供偏好重置按钮 + 变更通知               |
| 跨餐补偿范围           | 最多重生成 1 个餐次，不做迭代收敛         |
| 跨品类替代 vs 用户预期 | 仅同品类不足时触发，UI 标注"营养等价替代" |

---

## 七、五层架构 V4 目标状态

```
V4 目标状态
────────────────────────────────────────────────────────
L5 · 学习层 (Learning Layer)          ⬛⬛⬛⬛⬜ 85%
  FeedbackCollector                   ✅ 保持
  PreferenceUpdater                   ✅ 自动更新管线 + 即时反馈 (Phase 3.1)
  WeightDecayScheduler                ✅ 双周衰减调度 (Phase 3.2)
  ScoringExplainer                    ✅ [新增] 评分透明化 (Phase 2.3)

L4 · 推荐层 (Recommendation Layer)    ⬛⬛⬛⬛⬛ 98%
  MealPlanner                        ✅ + 目标自适应餐次比例 (Phase 1.8)
  DiversityEngine                    ✅ + 食物搭配关系 (Phase 2.7)
  ExplorationStrategy                ✅ 保持 Thompson Sampling
  SubstitutionEngine                 ✅ + 跨品类替代 (Phase 2.9)
  CrossMealCalibration               ✅ + 智能选择补偿餐次 (Phase 3.4)

L3 · 评分层 (Scoring Layer)           ⬛⬛⬛⬛⬛ 97%
  NutrientScorer                     ✅ + 目标自适应宏量范围 (Phase 1.7)
  NovaPenalty                        ✅ 保持
  NRF9.3                             ✅ 保持
  InflammationIndex                  ✅ 保持
  PenaltyEngine                      ✅ + 命名统一 (Phase 1.2)
  ContextModifier                    ✅ + 时区修复 (Phase 1.4)

L2 · 特征层 (Feature Layer)           ⬛⬛⬛⬜⬜ 65%
  FoodPoolCache                      ✅ [新增] 食物池缓存 (Phase 2.1)
  ScoringExplanation                 ✅ [新增] 评分解释结构 (Phase 2.3)
  FoodFeatureStore                   ⚠️ 字段完整但无特征向量 (Phase 4)
  UserFeatureStore                   ⚠️ 偏好画像改善 (Phase 3.1)
  ContextFeatures                    ✅ 地区+时区 (Phase 1.4, 1.6)

L1 · 数据层 (Data Layer)              ⬛⬛⬛⬛⬜ 90%
  Foods + Translations               ✅ 保持
  UserProfile + BehaviorProfile       ✅ + 行为数据修复 (Phase 1.1)
  FK Constraints                     ✅ 补全 (Phase 1.10)
  Type Safety                        ✅ 修复 (Phase 1.9)
```

---

## 附录：核心文件索引（V4 更新）

### 现有文件（需修改）

| 系统         | 文件                                                      | V4 变更内容                                                        |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------------ |
| **行为追踪** | `diet/app/behavior.service.ts`                            | Streak 重写 + 合规率按天计算 (Phase 1.1)                           |
| **惩罚引擎** | `diet/app/recommendation/penalty-engine.service.ts`       | 健康状况命名统一 (Phase 1.2)                                       |
| **约束生成** | `diet/app/recommendation/constraint-generator.service.ts` | 命名统一 + 时区修复 (Phase 1.2, 1.4)                               |
| **渐进收集** | `user/app/collection-trigger.service.ts`                  | 用日历天数 (Phase 1.3)                                             |
| **推断引擎** | `user/app/profile-inference.service.ts`                   | estimatedWeeksLeft 计算 (Phase 1.5)                                |
| **画像缓存** | `user/app/profile-cache.service.ts`                       | 传递 regionCode (Phase 1.6)                                        |
| **食物评分** | `diet/app/recommendation/food-scorer.service.ts`          | 目标自适应宏量范围 (Phase 1.7)                                     |
| **每日计划** | `diet/app/daily-plan.service.ts`                          | 目标自适应餐次比例 + 跨餐增强 + 单餐替换 (Phase 1.8, 3.4, Post-V4) |
| **推荐引擎** | `diet/app/recommendation-engine.service.ts`               | 拆分为 5 个服务 + 场景推荐修复 (Phase 2.2, Post-V4)                |
| **餐食组装** | `diet/app/recommendation/meal-assembler.service.ts`       | 搭配关系消费 (Phase 2.7)                                           |
| **推荐类型** | `diet/app/recommendation/recommendation.types.ts`         | HealthCondition 枚举 + MACRO_RANGES + MEAL_RATIOS                  |

### 新增文件（V4）

| 系统         | 文件                                                        | 说明            | Phase |
| ------------ | ----------------------------------------------------------- | --------------- | :---: |
| **食物缓存** | `diet/app/recommendation/food-pool-cache.service.ts`        | 食物池 TTL 缓存 |  2.1  |
| **替代引擎** | `diet/app/recommendation/substitution.service.ts`           | 从推荐引擎提取  |  2.2  |
| **反馈服务** | `diet/app/recommendation/feedback.service.ts`               | 反馈写入+统计   |  2.2  |
| **偏好画像** | `diet/app/recommendation/preference-profile.service.ts`     | 偏好构建+地区   |  2.2  |
| **评分解释** | `diet/app/recommendation/scoring-explanation.interface.ts`  | 解释接口定义    |  2.3  |
| **偏好更新** | `diet/app/recommendation/preference-updater.service.ts`     | 自动偏好更新    |  3.1  |
| **权重衰减** | `diet/app/recommendation/weight-decay-scheduler.service.ts` | 双周衰减        |  3.2  |
| **分段工具** | `user/shared/segmentation.util.ts`                          | 共享分段逻辑    |  2.5  |
| **测试文件** | `diet/app/recommendation/*.spec.ts`                         | 4 个测试文件    |  2.8  |

### 数据库变更

| 变更                                                         | 类型           | Phase |
| ------------------------------------------------------------ | -------------- | :---: |
| `user_behavior_profiles` 新增 `last_streak_date` varchar(10) | ADD COLUMN     |  1.1  |
| `recommendation_feedbacks.user_id` varchar → uuid            | ALTER COLUMN   | 1.10  |
| `daily_plans` 添加 FK + unique(userId, date)                 | ADD CONSTRAINT | 1.10  |
| `ai_decision_logs.record_id` 添加 FK                         | ADD CONSTRAINT | 1.10  |
| Streak/Compliance 数据重算                                   | DATA MIGRATION | 1.11  |
| HealthCondition 值标准化                                     | DATA MIGRATION |  1.2  |

---

## Post-V4 补充实施

### 数据库迁移文件

以下迁移文件补全了 Phase 4 中新增的实体/列，确保 `synchronize: false` 环境下 schema 与实体一致：

| 迁移文件                                    | 说明                                                                                                              | 涉及表           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------- |
| `1755000000000-AddFoodLibraryV4Columns.ts`  | 新增 6 列: `added_sugar`, `natural_sugar`, `purine`, `phosphorus`, `embedding` (float4[]), `embedding_updated_at` | `foods`          |
| `1755100000000-CreateABExperimentsTable.ts` | 新建 `ab_experiments` 表 + `ab_experiments_status_enum` 枚举类型                                                  | `ab_experiments` |

运行方式：

```bash
cd apps/api-server
npx typeorm migration:run -d src/core/database/data-source.ts
```

### Bug 修复: 场景推荐三场景返回相同结果

**根因分析**:

1. `takeout` 场景使用 `['takeout', 'fast_food']` 标签，但食物库中无任何食物拥有这些标签
2. `convenience` 和 `homeCook` 使用的标签（`natural`, `protein`, `low_calorie`）过于宽泛，匹配几乎所有食物
3. 三次回退后全部收敛到无过滤池，评分参数完全相同，因此结果一致

**修复方案**: 改用**结构化过滤**替代标签过滤（`recommendation-engine.service.ts:169-340`）

| 场景   | 过滤策略                                                                                 | 评分偏移                                                 |
| ------ | ---------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 外卖   | `category=composite` 或 `processingLevel>=2` 或含 `quick_prep`/`meal_prep_friendly` 标签 | composite +20%, 高加工 +10%                              |
| 便利店 | `category in [snack,beverage,fruit,dairy]` 或小份量(`standardServingG<=200`)             | fruit/dairy +10%, 小份量 +15%, low_calorie +10%          |
| 在家做 | `!isProcessed && processingLevel<=2` 或天然食材类                                        | veggie/protein +15%, processingLevel=1 +10%, natural +5% |

额外差异化: 三个场景串行构建，每个场景选出的食物会加入跨场景排除集（`usedAcrossScenarios`），确保后续场景不会重复选择相同食物。

### Bug 修复: 单餐替换导致全天计划重生成

**根因分析**:

- `regeneratePlan(userId)` 方法先 `DELETE` 整日计划再 `generatePlan()` 重新生成全部 4 餐
- 无 `mealType` 参数，前端无法指定仅替换某一餐

**修复方案**: 新增 `regenerateMeal(userId, mealType)` 方法（`daily-plan.service.ts:112-230`）

流程:

1. 加载现有计划（不存在则先生成）
2. 收集其他餐的食物名作为排除集，避免跨餐重复
3. 使用推荐引擎重新生成指定餐次
4. 仅更新对应的 plan 字段（`morningPlan`/`lunchPlan`/`dinnerPlan`/`snackPlan`），其他餐保持不变
5. 保存并返回完整计划

API 变更（**向后兼容**）:

```
POST /api/app/food/daily-plan/regenerate

// 重新生成全部（原有行为）
body: {} 或 body: { mealType: undefined }

// 仅替换指定餐（新增）
body: { mealType: "breakfast" | "lunch" | "dinner" | "snack" }
```
