# 智能饮食推荐系统 V5 升级设计文档

> **版本**: V5.0 | **日期**: 2026-04-10  
> **定位**: 基于 V4 完整代码分析，面向生产的最优方案升级  
> **升级策略**: 项目未上线，无兼容约束，直接采用最优实现  
> **覆盖范围**: 架构治理 · 推荐智能化 · 动态画像 · 可解释性 · 性能优化 · 生产就绪

---

## 目录

- [Step 1: V4 能力评估](#step-1-v4-能力评估)
- [Step 2: V5 核心升级方向](#step-2-v5-核心升级方向)
- [Step 3: 模块级升级设计](#step-3-模块级升级设计)
- [Step 4: 技术路线图](#step-4-技术路线图)
- [Step 5: 直接替换策略](#step-5-直接替换策略)
- [Step 6: 文档与代码差异清单](#step-4-文档与代码差异清单)
- [Step 7: 风险与权衡](#step-7-风险与权衡)
- [附录 A: 核心文件索引](#附录-a-核心文件索引)
- [附录 B: 数据库 Schema 变更](#附录-b-数据库-schema-变更)

---

## Step 1: V4 能力评估

### 1.1 V4 已具备的能力（保留并增强）

| 能力                                 | 实现质量 | 代码位置                                                 | V5 策略                      |
| ------------------------------------ | :------: | -------------------------------------------------------- | ---------------------------- |
| 三阶段 Pipeline (Recall→Rank→Rerank) |  ★★★★★   | `recommendation-engine.service.ts`                       | 保留架构，增强每个阶段       |
| 9 维非线性评分 (高斯/Sigmoid/对数)   |  ★★★★☆   | `food-scorer.service.ts`                                 | 增加维度，支持权重学习       |
| 4 层惩罚引擎 (硬否决→健康条件)       |  ★★★★☆   | `penalty-engine.service.ts`                              | 增加正向增益 + 条件严重度    |
| Thompson Sampling 探索/利用          |  ★★★★★   | `meal-assembler.service.ts`                              | 保留                         |
| 64 维食物嵌入                        |  ★★★☆☆   | `food-embedding.ts`                                      | 重构为可学习嵌入             |
| 协同过滤 (user-based CF)             |  ★★★☆☆   | `collaborative-filtering.service.ts`                     | 升级为 item-based + 矩阵分解 |
| Redis+内存双层缓存                   |  ★★★★☆   | `profile-cache.service.ts`, `food-pool-cache.service.ts` | 增加分片 + 预热 + LRU        |
| 偏好自动更新 (EMA)                   |  ★★★★☆   | `preference-updater.service.ts`                          | 增加多粒度偏好嵌入           |
| A/B 测试基础设施                     |  ★★★☆☆   | `ab-testing.service.ts`                                  | 增加指标收集 + 统计显著性    |
| 全局优化器 (贪心迭代)                |  ★★★☆☆   | `global-optimizer.ts`                                    | 集成到主流程 + 扩展优化维度  |
| 评分解释接口                         |  ★★★★☆   | `scoring-explanation.interface.ts`                       | 增加自然语言解释生成         |
| i18n 文案系统 (36 条)                |  ★★★★☆   | `i18n-messages.ts`                                       | 保留                         |
| 推荐质量仪表盘 (5 个 admin API)      |  ★★★☆☆   | `recommendation-quality.service.ts`                      | 改用 SQL 聚合，增加指标      |

### 1.2 V4 存在的问题（V5 必须解决）

#### A. 架构缺陷（6 个 HIGH）

| #      | 问题                       | 影响                                                                             | 根因                                               |
| ------ | -------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| **D1** | 19 个重复 API 端点         | FoodController (532行) 与 5 个拆分 Controller 完全重复，NestJS 路由不确定        | 拆分 Controller 后未删除原始 monolithic Controller |
| **D2** | 全局优化器未集成到主流程   | `optimizeDailyPlan()` 存在但从未在 `generatePlan()` 中调用，每日营养一致性无保障 | 独立实现未 wire 进主管线                           |
| **D3** | 周计划跨天多样性未生效     | `weekFoodNames` 收集了但从未传递给 `generatePlanForDate()`                       | 数据收集与消费断裂                                 |
| **D4** | CF 时间衰减定义未实现      | `IMPLICIT_DECAY_DAYS=30` 定义了但 `buildInteractionMatrix()` 未应用              | 配置与代码脱节                                     |
| **D5** | 多个 Entity 字段从未被填充 | `optimalMealCount`, `goalProgress`, `bingeRiskHours`, `portionTendency` 均为空   | 定义了 schema 但无计算逻辑                         |
| **D6** | 用户时区处理不完整         | 部分代码用 `timezoneOffset` 参数，部分用 `new Date().getHours()` 服务器时间      | V4 只修了 constraint-generator，其余遗漏           |

#### B. 性能瓶颈（4 个 MEDIUM）

| #      | 问题                   | 影响                                              | 量化                                |
| ------ | ---------------------- | ------------------------------------------------- | ----------------------------------- |
| **P1** | 周计划 N+1 查询        | 7 天串行生成，每天 8 次 DB 查询                   | 最差 56 次 DB 查询 + 28 次 pipeline |
| **P2** | 反馈统计全表加载       | `getUserFeedbackStats()` 加载所有记录到内存再遍历 | O(n) 内存，应改 SQL GROUP BY        |
| **P3** | Cron 串行处理所有用户  | 日更新任务逐用户串行执行                          | 1 万用户可能需要数小时              |
| **P4** | 向量搜索 O(N) 暴力扫描 | 每次相似度查询遍历全部食物                        | >10K 食物时延迟显著                 |

#### C. 缺失能力（5 个）

| #      | 缺失能力         | 影响                                                             |
| ------ | ---------------- | ---------------------------------------------------------------- |
| **M1** | 无请求限流       | `regeneratePlan`/`adjustPlan` 等重操作无 `@Throttle()`，可被刷爆 |
| **M2** | 无输入验证 DTO   | `FoodPlanController` 多个端点用内联类型，无 `class-validator`    |
| **M3** | 无并发控制       | 两个并发 `getPlan()` 请求可能创建重复计划                        |
| **M4** | 无分布式 Cron 锁 | 多实例部署时 cron 会重复执行                                     |
| **M5** | 无卡路里安全下限 | BMR 计算可产生 <1200kcal 的危险值                                |

#### D. 代码质量（3 个）

| #      | 问题                                                      | 位置                    |
| ------ | --------------------------------------------------------- | ----------------------- |
| **Q1** | `@CurrentAppUser() user: any` 全部无类型                  | 所有 Controller         |
| **Q2** | 餐次命名不一致 (`morningPlan` vs `breakfast`)             | `daily-plan.service.ts` |
| **Q3** | `getMealSuggestion` 用硬编码比例，与 `MEAL_RATIOS` 不一致 | `food.service.ts`       |

### 1.3 V4 五层架构完成度评估

```
                              V4 实际状态              V5 目标状态
────────────────────────────────────────────────────────────────────
L5 · 学习层    ⬛⬛⬛⬛⬜ 80%    →    ⬛⬛⬛⬛⬛ 98%
  FeedbackLoop        ✅ 基础            ✅ 多信号闭环
  PreferenceUpdate    ✅ EMA             ✅ 多粒度偏好嵌入
  WeightDecay         ✅ 基础            ✅ 保留
  ScoringExplainer    ✅ 结构化          ✅ + 自然语言解释
  ABTesting           ⚠️ 无指标收集      ✅ 全链路 A/B
  WeightLearning      ❌                 ✅ [V5新增] 在线权重学习

L4 · 推荐层    ⬛⬛⬛⬛⬛ 95%    →    ⬛⬛⬛⬛⬛ 99%
  MealPlanner         ✅                 ✅ + 全局优化器集成
  DiversityEngine     ✅                 ✅ + 跨天多样性
  ExplorationStrategy ✅                 ✅ 保留
  Substitution        ✅                 ✅ 保留
  GlobalOptimizer     ⚠️ 未集成          ✅ 日/周双层优化

L3 · 评分层    ⬛⬛⬛⬛⬛ 97%    →    ⬛⬛⬛⬛⬛ 99%
  NutrientScorer      ✅                 ✅ + 纤维维度 + 缺失值插补
  PenaltyEngine       ✅ 6 条件          ✅ + 正向增益 + 严重度
  ContextModifier     ⚠️ 部分时区        ✅ 全局时区统一

L2 · 特征层    ⬛⬛⬛⬜⬜ 65%    →    ⬛⬛⬛⬛⬛ 95%
  FoodEmbedding       ✅ 64 维手工       ✅ 96 维 + 可学习
  VectorSearch        ⚠️ 内存暴力        ✅ pgvector ANN
  FoodPoolCache       ✅ 双层            ✅ + 分片 + 预热
  CF                  ⚠️ user-based      ✅ item-based + ALS

L1 · 数据层    ⬛⬛⬛⬛⬜ 90%    →    ⬛⬛⬛⬛⬛ 99%
  Schema 完整性       ✅                 ✅ + 孤儿字段填充
  输入验证            ❌                 ✅ [V5新增] 全量 DTO
  限流/并发           ❌                 ✅ [V5新增] 限流 + 幂等
  Cron 分布式锁       ❌                 ✅ [V5新增] Redis 锁
  API 去重            ❌                 ✅ [V5新增] 删除重复端点
```

---

## Step 2: V5 核心升级方向

### 升级方向总览

| #      | 升级方向           | 核心目标                                             | 优先级 |
| ------ | ------------------ | ---------------------------------------------------- | :----: |
| **U1** | 架构治理与生产就绪 | 消除重复端点、补全验证/限流/并发控制、统一时区       |   P0   |
| **U2** | 推荐智能化         | 全局优化器集成、可学习权重、跨天多样性、pgvector     |   P0   |
| **U3** | 动态用户画像       | 填充孤儿字段、实时偏好更新、Cron 批处理优化          |   P1   |
| **U4** | 可解释性增强       | 自然语言评分解释、推荐理由生成、用户可理解的健康建议 |   P1   |
| **U5** | 性能与可扩展性     | 周计划批量生成、SQL 聚合替代内存遍历、分布式 Cron    |   P1   |

### U1: 架构治理与生产就绪

**为什么需要**：V4 遗留了 19 个重复端点、无输入验证、无限流、无并发控制，这些在上线前必须解决，否则系统不稳定且存在安全风险。

**解决什么问题**：

- D1: 删除 `FoodController`，仅保留拆分后的 5 个 Controller + 新建 `FoodAnalyzeController`
- M1: 所有重操作添加 `@Throttle()`
- M2: 所有端点参数迁移到 class-validator DTO
- M3: 计划生成添加 Redis 分布式锁保证幂等
- M5: BMR 计算添加安全下限（女性 1200kcal，男性 1500kcal）
- Q1: 定义 `AppUser` 接口替代 `any`
- Q2/Q3: 统一餐次命名和比例

**具体改动**：

```typescript
// 1. 删除 apps/api-server/src/modules/diet/app/food.controller.ts（整个文件）
// 2. 将 POST analyze 迁移到新文件或 FoodRecordController

// 3. 新增全局 AppUser 类型
// apps/api-server/src/common/types/app-user.type.ts
export interface AppUser {
  id: string;
  email: string;
  role: string;
}

// 4. 所有 Controller 改为：
@CurrentAppUser() user: AppUser

// 5. 新增验证 DTO 示例
// apps/api-server/src/modules/diet/app/dto/regenerate-plan.dto.ts
export class RegeneratePlanDto {
  @IsOptional()
  @IsEnum(MealType)
  mealType?: MealType;
}

// 6. 限流示例
@Throttle({ default: { limit: 3, ttl: 60000 } })
@Post('daily-plan/regenerate')
async regenerateDailyPlan(...) { ... }

// 7. 幂等锁
async getPlan(userId: string): Promise<DailyPlan> {
  const lockKey = `plan_gen:${userId}:${today}`;
  const acquired = await this.redis.setNX(lockKey, '1', 30000);
  if (!acquired) {
    // 等待已在生成的计划完成
    return this.waitForPlan(userId, today);
  }
  try {
    return await this.generatePlan(userId, today);
  } finally {
    await this.redis.del(lockKey);
  }
}
```

### U2: 推荐智能化

**为什么需要**：V4 的推荐管线有 3 个关键断裂点——全局优化器未集成、周计划跨天多样性未生效、CF 时间衰减未实现。食物嵌入是手工 64 维，无法捕获"舒适食物""鲜味"等隐含模式。

**解决什么问题**：

- D2: 将 `optimizeDailyPlan()` 集成到 `generatePlan()` 主流程
- D3: 周计划生成时传递跨天食物名称集合
- D4: 实现 CF 时间衰减
- 嵌入从 64→96 维，增加菜系/口味/烹饪方式维度
- 支持基于反馈数据的在线权重学习

**具体设计**：

```
V5 推荐管线（改进后）
═══════════════════════════════════════════════════════

输入: userId, date, mealType, excludeNames[]

Stage 0 · 数据准备 [并行]
├── getFoodPool()         ← FoodPoolCacheService（分片缓存）
├── getUserProfile()      ← ProfileCacheService
├── getRecentFoods(7d)    ← 扩大到 7 天窗口
├── getFeedbackStats()    ← SQL GROUP BY（不再内存遍历）
├── getPreferenceProfile()
├── getRegionalBoost()
└── getCFScores()         ← item-based CF + 时间衰减

Stage 1 · Recall [候选召回]
├── 角色类别过滤 (ROLE_CATEGORIES)
├── 餐次兼容过滤 (mealTypes)
├── 过敏原过滤 (allergen-filter.util)
├── 排除标签过滤
├── [V5新增] pgvector ANN 预过滤（Top-200 相似候选）
└── 最小候选保障（<10 则放宽过滤）

Stage 2 · Rank [精排]
├── 10 维评分（V5 新增纤维维度）
├── 用户偏好加权（loves/avoids + preferenceProfile）
├── 区域加权
├── CF 加权（item-based, 时间衰减后）
├── [V5新增] 正向健康增益（如高血脂→Omega-3 加分）
└── [V5新增] 缺失微量营养素插补（品类均值）

Stage 3 · Rerank [重排]
├── Thompson Sampling（保留）
├── 食物搭配 bonus/penalty（goodWith/badWith）
├── 相似度多样性惩罚
└── [V5新增] 跨天多样性惩罚（7 天窗口内重复降权 0.7x）

Stage 4 · 全局优化 [V5新增阶段]
├── 4 餐生成完成后调用 optimizeDailyPlan()
├── 优化维度扩展：calories + protein + fat + carbs + fiber + GI
├── 偏差阈值：>8% 触发优化（从 10% 降低）
└── 迭代次数：最多 12 轮（从 8 提升）

输出: MealPlan[] + ScoringExplanation[] + NaturalLanguageReason
```

### U3: 动态用户画像

**为什么需要**：V4 的 `UserBehaviorProfile` 和 `UserInferredProfile` 有 4 个字段从未被填充（`optimalMealCount`, `goalProgress`, `bingeRiskHours`, `portionTendency`），属于"定义了 schema 但无灵魂"。Cron 串行处理不可扩展。

**解决什么问题**：

- D5: 实现所有孤儿字段的计算逻辑
- P3: Cron 批处理 + 并发限制 + 分布式锁
- 偏好模型从离散权重升级为偏好嵌入向量

**具体设计**：

```typescript
// === 填充 goalProgress ===
// 在 daily cron 中计算：
interface GoalProgress {
  startWeight: number;      // 来自 profile 首次快照
  currentWeight: number;    // 来自最新 profile
  targetWeight: number;     // 来自 profile.targetWeightKg
  progressPercent: number;  // (start - current) / (start - target) * 100
  trend: 'losing' | 'gaining' | 'plateau' | 'fluctuating';
  estimatedWeeksLeft: number; // 基于近 4 周平均速率
  weeklyRateKg: number;     // 近 4 周平均周减/增重量
}

// === 填充 optimalMealCount ===
// 基于 mealTimingPatterns 推断：
// - 如果用户 3 餐都有稳定时间 → 3
// - 如果用户 4 餐（含加餐）都有时间 → 4
// - 低于 3 天数据 → 默认 3

// === 填充 bingeRiskHours ===
// 分析 food_records 的时间戳：
// - 找到卡路里密度 >150% 日均的时段（按小时桶）
// - 连续 3+ 次出现 → 标记为 binge risk hour

// === 填充 portionTendency ===
// 比较实际每餐卡路里 vs 计划每餐卡路里：
// - 实际/计划 > 1.15 → 'large'
// - 实际/计划 < 0.85 → 'small'
// - 否则 → 'normal'

// === Cron 批处理升级 ===
async updateDailyBehavior(): Promise<void> {
  const BATCH_SIZE = 100;
  const CONCURRENCY = 5;
  let offset = 0;

  while (true) {
    const users = await this.behaviorRepo.find({
      skip: offset,
      take: BATCH_SIZE,
    });
    if (users.length === 0) break;

    // 并发处理，限制并发数
    await pMap(users, (user) => this.processUser(user), {
      concurrency: CONCURRENCY,
    });

    offset += BATCH_SIZE;
  }
}
```

### U4: 可解释性增强

**为什么需要**：V4 有 `ScoringExplanation` 结构但只面向开发者/管理员。用户看到的是食物列表，不知道为什么推荐这个食物。可解释性是用户信任和留存的关键。

**解决什么问题**：

- 生成用户可理解的推荐理由
- 惩罚引擎支持正向增益（不只是告诉用户"这个不好"，也要说"这个对你特别好"）
- 健康条件与食物的关联可视化

**具体设计**：

```typescript
// === 推荐理由生成器 ===
// apps/api-server/src/modules/diet/app/recommendation/explanation-generator.service.ts

interface UserFacingExplanation {
  // 主要推荐理由（1-2 句话）
  primaryReason: string;
  // 营养亮点标签（最多 3 个）
  nutritionHighlights: NutritionTag[];
  // 健康相关提示（如果有健康条件）
  healthTip?: string;
  // 评分概览（简化版）
  scoreBreakdown: SimpleScoreBar[];
}

interface NutritionTag {
  label: string; // "高蛋白" | "低GI" | "富含膳食纤维" | "Omega-3 丰富"
  type: 'positive' | 'neutral';
  value: string; // "28g 蛋白质" | "GI 35"
}

interface SimpleScoreBar {
  dimension: string; // "营养匹配" | "口味偏好" | "健康适配"
  score: number; // 0-100
}

// 生成逻辑示例：
function generateExplanation(
  food: FoodLibrary,
  scoring: ScoringExplanation,
  userProfile: UserProfileConstraints
): UserFacingExplanation {
  const reasons: string[] = [];
  const highlights: NutritionTag[] = [];

  // 基于评分最高的维度生成理由
  const topDimensions = scoring.dimensionScores
    .sort((a, b) => b.score * b.weight - a.score * a.weight)
    .slice(0, 2);

  for (const dim of topDimensions) {
    if (dim.name === 'protein' && dim.score > 0.8) {
      reasons.push(`高蛋白含量有助于你的${goalText}目标`);
      highlights.push({ label: '高蛋白', type: 'positive', value: `${food.protein}g` });
    }
    // ... 其他维度
  }

  // 健康条件相关提示
  if (userProfile.healthConditions?.includes('diabetes_type2') && food.glycemicIndex < 55) {
    reasons.push('低升糖指数，适合血糖管理');
    highlights.push({ label: '低GI', type: 'positive', value: `GI ${food.glycemicIndex}` });
  }

  return {
    primaryReason: reasons.join('；'),
    nutritionHighlights: highlights.slice(0, 3),
    healthTip: generateHealthTip(food, userProfile),
    scoreBreakdown: simplifyScoring(scoring),
  };
}
```

### U5: 性能与可扩展性

**为什么需要**：V4 有 4 个明确的性能瓶颈——周计划 N+1、反馈统计全表加载、Cron 串行、向量搜索暴力扫描。这些在用户量增长时会成为系统瓶颈。

**解决什么问题**：

- P1: 周计划共享数据一次加载 + 批量生成
- P2: 反馈统计改用 SQL GROUP BY
- P3: Cron 分页批处理 + 并发 + Redis 分布式锁
- P4: 实现 pgvector 向量搜索

**具体设计**：

```typescript
// === 周计划批量生成优化 ===
async getWeeklyPlan(userId: string): Promise<WeeklyPlan> {
  // 1. 批量查询已有计划
  const existingPlans = await this.planRepo.find({
    where: { userId, date: In(weekDates) },
  });

  // 2. 一次性加载所有共享数据
  const [profile, allFoods, recentFoods, feedbackStats, preferenceProfile, regionalBoost] =
    await Promise.all([
      this.profileCache.getFullProfile(userId),
      this.foodPoolCache.getVerifiedFoods(),
      this.engine.getRecentFoodNames(userId, 7),
      this.engine.getUserFeedbackStats(userId),
      this.engine.getUserPreferenceProfile(userId),
      this.engine.getRegionalBoostMap(userId),
    ]);

  // 3. 收集已有计划的食物名称
  const weekFoodNames = new Set<string>();
  for (const plan of existingPlans) {
    extractFoodNames(plan).forEach((n) => weekFoodNames.add(n));
  }

  // 4. 仅生成缺失日期的计划，传入共享数据 + 跨天排除集
  const missingDates = weekDates.filter(
    (d) => !existingPlans.some((p) => p.date === d),
  );

  for (const date of missingDates) {
    const plan = await this.dailyPlanService.generatePlanWithContext(
      userId,
      date,
      { profile, allFoods, recentFoods, feedbackStats, preferenceProfile, regionalBoost },
      weekFoodNames, // 跨天排除
    );
    extractFoodNames(plan).forEach((n) => weekFoodNames.add(n));
  }
}

// === 反馈统计 SQL 聚合 ===
async getUserFeedbackStats(userId: string): Promise<Map<string, FeedbackStat>> {
  const since = new Date(Date.now() - 30 * 86400000);
  const rows = await this.feedbackRepo
    .createQueryBuilder('f')
    .select('f.food_name', 'foodName')
    .addSelect('SUM(CASE WHEN f.action = \'accepted\' THEN 1 ELSE 0 END)', 'accepted')
    .addSelect('SUM(CASE WHEN f.action != \'accepted\' THEN 1 ELSE 0 END)', 'rejected')
    .where('f.user_id = :userId', { userId })
    .andWhere('f.created_at >= :since', { since })
    .groupBy('f.food_name')
    .getRawMany();

  const map = new Map<string, FeedbackStat>();
  for (const row of rows) {
    map.set(row.foodName, {
      accepted: Number(row.accepted),
      rejected: Number(row.rejected),
    });
  }
  return map;
}

// === pgvector 集成 ===
// 1. 安装 pgvector 扩展
// CREATE EXTENSION IF NOT EXISTS vector;
//
// 2. 添加 vector 列（直接修改 food_library 表）
// ALTER TABLE food_library ADD COLUMN embedding_v5 vector(96);
//
// 3. 创建 HNSW 索引
// CREATE INDEX idx_food_embedding_hnsw
//   ON food_library USING hnsw (embedding_v5 vector_cosine_ops)
//   WITH (m = 16, ef_construction = 200);
//
// 4. 查询示例
// SELECT id, name, 1 - (embedding_v5 <=> $1::vector) AS similarity
// FROM food_library
// WHERE is_verified = true
//   AND category = ANY($2)
// ORDER BY embedding_v5 <=> $1::vector
// LIMIT 200;

// === 分布式 Cron 锁 ===
async runWithLock(lockName: string, ttlMs: number, fn: () => Promise<void>): Promise<void> {
  const lockKey = `cron_lock:${lockName}`;
  const acquired = await this.redis.setNX(lockKey, process.env.HOSTNAME || '1', ttlMs);
  if (!acquired) {
    this.logger.log(`Cron job ${lockName} already running on another instance, skipping.`);
    return;
  }
  try {
    await fn();
  } finally {
    await this.redis.del(lockKey);
  }
}
```

---

## Step 3: 模块级升级设计

### 3.1 Profile 模块

#### 3.1.1 UserProfileService 升级

| 改动                         | 描述                                                                                                   | 优先级 |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | :----: |
| 添加卡路里安全下限           | `recommendedCalories = Math.max(calculated, gender === 'female' ? 1200 : 1500)`                        |   P0   |
| 时区列                       | `UserProfile` 添加 `timezone: string`（IANA 格式如 `Asia/Shanghai`），替代分散的 `timezoneOffset` 参数 |   P0   |
| 体重历史                     | 新建 `weight_history` 表，每次 `weightKg` 变化时记录，支持趋势分析                                     |   P1   |
| 深度相等比较                 | 快照检测从 `JSON.stringify` 改为 `lodash.isEqual`                                                      |   P1   |
| `syncInferredProfile` 异步化 | 从 `saveProfile` 同步调用改为事件驱动异步处理                                                          |   P2   |

```typescript
// weight_history 实体
@Entity('weight_history')
export class WeightHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid')
  userId: string;

  @Column('decimal', { precision: 5, scale: 1 })
  weightKg: number;

  @Column('decimal', { precision: 4, scale: 1, nullable: true })
  bodyFatPercent: number;

  @Column({ type: 'varchar', length: 20, nullable: true })
  source: 'manual' | 'device' | 'onboarding';

  @CreateDateColumn()
  recordedAt: Date;
}
```

#### 3.1.2 ProfileCacheService 升级

| 改动         | 描述                                                              | 优先级 |
| ------------ | ----------------------------------------------------------------- | :----: |
| LRU 淘汰     | 内存缓存改用 Map 的插入顺序实现 LRU，到达上限时删除最早访问的条目 |   P1   |
| 分层 TTL     | 内存 TTL 2 分钟，Redis TTL 10 分钟                                |   P1   |
| Singleflight | 同一 userId 的并发 miss 只执行一次 DB 查询                        |   P1   |
| 缓存预热     | `invalidateAll()` 后延迟 5 秒预热最近活跃的 Top-100 用户          |   P2   |

```typescript
// Singleflight 实现
private inflight = new Map<string, Promise<FullUserProfile | null>>();

async getFullProfile(userId: string): Promise<FullUserProfile | null> {
  // L1: 内存
  const memCached = this.memoryCache.get(userId);
  if (memCached && !this.isExpired(memCached, this.MEM_TTL)) {
    return memCached.data;
  }

  // L2: Redis
  const redisCached = await this.redis.get<FullUserProfile>(`profile:${userId}`);
  if (redisCached) {
    this.memoryCache.set(userId, { data: redisCached, ts: Date.now() });
    this.enforceLRU();
    return redisCached;
  }

  // Singleflight: 防止并发穿透
  if (this.inflight.has(userId)) {
    return this.inflight.get(userId)!;
  }

  const promise = this.loadFromDB(userId);
  this.inflight.set(userId, promise);
  try {
    const profile = await promise;
    if (profile) {
      this.memoryCache.set(userId, { data: profile, ts: Date.now() });
      this.enforceLRU();
      await this.redis.set(`profile:${userId}`, profile, this.REDIS_TTL);
    }
    return profile;
  } finally {
    this.inflight.delete(userId);
  }
}

private enforceLRU(): void {
  while (this.memoryCache.size > this.MAX_ENTRIES) {
    // Map 迭代器按插入顺序，第一个是最旧的
    const oldest = this.memoryCache.keys().next().value;
    this.memoryCache.delete(oldest);
  }
}
```

#### 3.1.3 ProfileCronService 升级

| 改动                  | 描述                                              | 优先级 |
| --------------------- | ------------------------------------------------- | :----: |
| 批处理 + 并发         | 每批 100 用户，5 并发 `Promise.allSettled`        |   P0   |
| 分布式锁              | 所有 cron 加 Redis 分布式锁                       |   P0   |
| 填充 goalProgress     | 日更新中计算，基于 weight_history 的 4 周滑动窗口 |   P1   |
| 填充 optimalMealCount | 基于 mealTimingPatterns 推断                      |   P1   |
| 填充 bingeRiskHours   | 分析 food_records 时间戳                          |   P1   |
| 填充 portionTendency  | 比较实际 vs 计划卡路里                            |   P1   |
| 进度日志              | 每处理 100 用户记录一次日志                       |   P2   |

#### 3.1.4 CollectionTriggerService 升级

| 改动        | 描述                                                          | 优先级 |
| ----------- | ------------------------------------------------------------- | :----: |
| 提醒去重    | 新增 `reminder_dismissals` 表，记录用户上次关闭每种提醒的时间 |   P1   |
| Rule 6 缓存 | 类别替换分析结果缓存 30 分钟                                  |   P2   |
| i18n        | 提醒文案迁移到 `i18n-messages.ts`                             |   P2   |

#### 3.1.5 Segmentation 升级

| 改动                       | 描述                                                      | 优先级 |
| -------------------------- | --------------------------------------------------------- | :----: |
| 新增 `new_user` 分段       | 使用天数 <7 天                                            |   P1   |
| 新增 `returning_user` 分段 | 曾超过 14 天不活跃后回归                                  |   P2   |
| `muscle_builder` 交叉分类  | muscle_gain 目标 + compliance < 40% 也应标记 `binge_risk` |   P1   |
| 连续变量输出               | 除了离散分段，额外输出 `segmentConfidence: number`        |   P2   |

```typescript
export type UserSegment =
  | 'new_user' // V5 新增
  | 'muscle_builder'
  | 'disciplined_loser'
  | 'active_maintainer'
  | 'binge_risk'
  | 'returning_user' // V5 新增
  | 'casual_maintainer';

export interface SegmentResult {
  segment: UserSegment;
  confidence: number; // 0-1
  secondaryFlags: string[]; // 例如 muscle_builder 也可标记 binge_risk
}

export function inferUserSegment(
  goal: string,
  behavior: {
    avgComplianceRate?: number;
    totalRecords?: number;
    daysSinceLastRecord?: number;
    usageDays?: number;
  }
): SegmentResult {
  const compliance = behavior?.avgComplianceRate ?? 0;
  const records = behavior?.totalRecords ?? 0;
  const daysSinceActive = behavior?.daysSinceLastRecord ?? 0;
  const usageDays = behavior?.usageDays ?? 0;
  const flags: string[] = [];

  // 新用户
  if (usageDays < 7) {
    return { segment: 'new_user', confidence: 0.9, secondaryFlags: [] };
  }

  // 回归用户
  if (daysSinceActive > 14 && records > 20) {
    return { segment: 'returning_user', confidence: 0.8, secondaryFlags: [] };
  }

  // 暴食风险（独立检测，也用于交叉标记）
  if (compliance < 0.4 && records >= 14) {
    flags.push('binge_risk');
  }

  if (goal === 'muscle_gain') {
    return {
      segment: 'muscle_builder',
      confidence: 0.95,
      secondaryFlags: flags, // 可能同时标记 binge_risk
    };
  }

  if (compliance >= 0.7) {
    return {
      segment: goal === 'fat_loss' ? 'disciplined_loser' : 'active_maintainer',
      confidence: Math.min(1, compliance),
      secondaryFlags: flags,
    };
  }

  if (flags.includes('binge_risk')) {
    return { segment: 'binge_risk', confidence: 0.85, secondaryFlags: [] };
  }

  return { segment: 'casual_maintainer', confidence: 0.6, secondaryFlags: flags };
}
```

### 3.2 Recommendation 模块

#### 3.2.1 RecommendationEngineService 升级

| 改动                                   | 描述                                                                           | 优先级 |
| -------------------------------------- | ------------------------------------------------------------------------------ | :----: |
| 全局优化器集成                         | `generatePlan()` 四餐生成后调用 `optimizeDailyPlan()`                          |   P0   |
| 跨天多样性                             | `recommendMealFromPool()` 接收 `weekExcludeNames` 参数，7天内重复食物降权 0.7x |   P0   |
| `recommendMealFromPool` 支持预加载数据 | 新增 `PreloadedContext` 参数，避免周计划重复查询                               |   P0   |
| 场景推荐候选不足时渐进放宽             | 从 3→2→1 逐步降低最低候选数，而非直接回退到全池                                |   P1   |
| 删除残留的 deprecated 委托方法         | 清理编排器上不再需要的旧方法                                                   |   P2   |

```typescript
// 预加载上下文接口
interface PreloadedContext {
  profile: FullUserProfile;
  allFoods: FoodLibrary[];
  recentFoodNames: string[];
  feedbackStats: Map<string, FeedbackStat>;
  preferenceProfile: PreferenceProfile;
  regionalBoostMap: Map<string, number>;
  cfScores?: Map<string, number>;
}

// generatePlan 改进后流程
async generatePlan(
  userId: string,
  date: string,
  context?: PreloadedContext,
  weekExcludeNames?: Set<string>,
): Promise<DailyPlan> {
  // 1. 数据准备（使用预加载或现场查询）
  const ctx = context ?? await this.loadContext(userId);

  // 2. 计算目标
  const goals = this.nutritionScore.calculateDailyGoals(ctx.profile);

  // 3. 串行生成 4 餐（需要排除集递增）
  const excludeNames = new Set<string>(weekExcludeNames ?? []);
  const meals: MealRecommendation[] = [];

  for (const mealType of ['breakfast', 'lunch', 'dinner', 'snack']) {
    const meal = this.recommendMealFromPool(
      ctx.allFoods, mealType, goals, ctx, excludeNames,
    );
    meals.push(meal);
    meal.foods.forEach((f) => excludeNames.add(f.name));
  }

  // 4. [V5新增] 全局优化
  const optimized = this.globalOptimizer.optimizeDailyPlan(
    meals.map((m, i) => ({
      mealType: MEAL_TYPES[i],
      picks: m.foods,
      candidatePool: this.getCandidatePool(ctx.allFoods, MEAL_TYPES[i], ctx),
    })),
    goals,
  );

  // 5. 转换并保存
  const plan = this.buildDailyPlan(userId, date, optimized, goals);
  return this.planRepo.save(plan);
}
```

#### 3.2.2 FoodScorerService 升级

| 改动                 | 描述                                         | 优先级 |
| -------------------- | -------------------------------------------- | :----: |
| 第 10 维：膳食纤维   | 独立的纤维评分维度，目标 25-30g/天按餐次分配 |   P0   |
| 微量营养素缺失值插补 | 从品类均值插补缺失的维生素/矿物质数据        |   P1   |
| 正向健康增益         | PenaltyEngine 扩展为 Penalty+Bonus 双向引擎  |   P1   |
| 在线权重学习         | 基于反馈数据的梯度更新，周期性调整基础权重   |   P2   |

```typescript
// === 第 10 维：膳食纤维评分 ===
private scoreFiber(food: FoodLibrary, mealType: string): number {
  const fiber = food.dietaryFiber ?? 0;
  // 每日目标 25-30g，按餐次比例分配
  const mealRatio = MEAL_RATIOS[mealType] ?? 0.25;
  const mealTarget = 27.5 * mealRatio; // 取中值 27.5g
  // Sigmoid: 接近目标得高分，超过也不额外奖励
  const ratio = fiber / Math.max(mealTarget, 1);
  return Math.min(1.0, ratio); // 线性到 1.0，超过不加分
}

// === 微量营养素插补 ===
// 预计算每个品类的微量营养素均值
private categoryMicroAverages = new Map<string, MicroNutrients>();

private imputeMicroNutrients(food: FoodLibrary): MicroNutrients {
  const category = food.category;
  const defaults = this.categoryMicroAverages.get(category);
  if (!defaults) return this.globalMicroAverages;

  return {
    vitaminA: food.vitaminA ?? defaults.vitaminA,
    vitaminC: food.vitaminC ?? defaults.vitaminC,
    vitaminD: food.vitaminD ?? defaults.vitaminD,
    vitaminE: food.vitaminE ?? defaults.vitaminE,
    calcium: food.calcium ?? defaults.calcium,
    iron: food.iron ?? defaults.iron,
    potassium: food.potassium ?? defaults.potassium,
    // ... 其余微量元素
  };
}

// === 正向健康增益 ===
// 在 penalty-engine.service.ts 中扩展
interface HealthModifier {
  multiplier: number;    // < 1.0 = 惩罚, > 1.0 = 增益
  reason: string;
  type: 'penalty' | 'bonus';
}

// 示例增益规则：
// 高血脂 + Omega-3 丰富 (鱼类 omega3 > 500mg/100g): 1.15x bonus
// 糖尿病 + 低GI (<40): 1.10x bonus
// 高血压 + 高钾 (>300mg) + 低钠 (<200mg): 1.12x bonus
// 贫血 + 高铁 (>3mg/100g): 1.10x bonus
```

#### 3.2.3 PenaltyEngine → HealthModifierEngine 重命名

V5 将 `PenaltyEngine` 重命名为 `HealthModifierEngine`，因为它现在同时处理惩罚和增益。

```typescript
// health-modifier-engine.service.ts (重命名自 penalty-engine.service.ts)

export interface HealthModifierResult {
  finalMultiplier: number;    // 所有 modifier 的乘积
  modifiers: HealthModifier[];
  isVetoed: boolean;
}

// 新增严重度支持
interface HealthConditionWithSeverity {
  condition: HealthCondition;
  severity: 'mild' | 'moderate' | 'severe'; // V5 新增
}

// 严重度影响惩罚/增益强度
private getSeverityFactor(severity: 'mild' | 'moderate' | 'severe'): number {
  switch (severity) {
    case 'mild': return 0.6;      // 惩罚打 6 折
    case 'moderate': return 1.0;  // 标准惩罚
    case 'severe': return 1.3;    // 惩罚加 30%
  }
}

// 示例：糖尿病 + 高GI
// severity=mild:    multiplier = 1 - (1-0.8) * 0.6 = 0.88
// severity=moderate: multiplier = 0.8
// severity=severe:  multiplier = 1 - (1-0.8) * 1.3 = 0.74

// 新增健康条件
// 在 V4 的 6 个条件基础上新增：
// - fatty_liver: 已有枚举但无规则 → 实现（高脂/高糖惩罚）
// - celiac_disease: 麸质硬否决
// - ibs: FODMAP 高的食物惩罚
// - iron_deficiency_anemia: 高铁增益，茶/咖啡惩罚
// - osteoporosis: 高钙增益
```

#### 3.2.4 CollaborativeFilteringService 升级

| 改动               | 描述                                                    | 优先级 |
| ------------------ | ------------------------------------------------------- | :----: |
| 实现时间衰减       | `buildInteractionMatrix()` 应用 `e^(-0.02 * days)` 衰减 |   P0   |
| Item-based CF      | 新增 item-based CF 模式，计算食物-食物相似矩阵          |   P1   |
| 后台矩阵计算       | 矩阵重建移到 Cron 任务（每天凌晨），避免请求时阻塞      |   P1   |
| 食物 ID 替代食物名 | 交互矩阵用食物 ID 作为 key                              |   P1   |

```typescript
// === 时间衰减实现（修复 D4）===
private async buildInteractionMatrix(): Promise<void> {
  const now = Date.now();
  const decayDays = this.IMPLICIT_DECAY_DAYS; // 30

  // 隐式信号：食物记录（带时间衰减）
  const records = await this.recordRepo
    .createQueryBuilder('r')
    .select(['r.user_id', 'r.foods', 'r.created_at'])
    .where('r.created_at >= :since', { since: new Date(now - decayDays * 86400000) })
    .getMany();

  for (const record of records) {
    const userId = record.userId;
    const daysSince = (now - record.createdAt.getTime()) / 86400000;
    const decayWeight = Math.exp(-0.02 * daysSince); // V5: 实际应用衰减

    for (const food of record.foods) {
      const current = this.matrix.get(userId)?.get(food.foodId) ?? 0;
      // 衰减后的对数频率
      this.matrix.get(userId)?.set(food.foodId, current + Math.log2(2) * decayWeight);
    }
  }
}

// === Item-based CF ===
// 计算食物-食物相似矩阵（基于共同被同一用户消费的模式）
private itemSimilarity = new Map<string, Map<string, number>>();

private buildItemSimilarityMatrix(): void {
  // 转置用户-食物矩阵为食物-用户矩阵
  const foodUsers = new Map<string, Map<string, number>>();

  for (const [userId, foods] of this.matrix) {
    for (const [foodId, score] of foods) {
      if (!foodUsers.has(foodId)) foodUsers.set(foodId, new Map());
      foodUsers.get(foodId)!.set(userId, score);
    }
  }

  // 计算食物间余弦相似度（仅共同用户数 >= 3 的食物对）
  const foodIds = Array.from(foodUsers.keys());
  for (let i = 0; i < foodIds.length; i++) {
    for (let j = i + 1; j < foodIds.length; j++) {
      const sim = this.sparseCosine(
        foodUsers.get(foodIds[i])!,
        foodUsers.get(foodIds[j])!,
      );
      if (sim > 0.1) {
        if (!this.itemSimilarity.has(foodIds[i])) {
          this.itemSimilarity.set(foodIds[i], new Map());
        }
        this.itemSimilarity.get(foodIds[i])!.set(foodIds[j], sim);
      }
    }
  }
}
```

#### 3.2.5 FoodEmbedding 升级 (64→96 维)

| 维度范围    | 类别                     | V4  | V5 变更                                                  |
| ----------- | ------------------------ | :-: | -------------------------------------------------------- |
| [0-5]       | 宏量营养素               | ✅  | 保留                                                     |
| [6-17]      | 微量营养素               | ✅  | 保留，缺失值用品类均值插补                               |
| [18-23]     | 健康指标                 | ✅  | 保留                                                     |
| [24-27]     | 派生比率                 | ✅  | 保留                                                     |
| [28-37]     | 品类 one-hot (10)        | ✅  | 保留                                                     |
| [38-41]     | 餐次 one-hot (4)         | ✅  | 保留                                                     |
| [42-49]     | 布尔特征 (8)             | ✅  | 保留                                                     |
| [50-63]     | 标签特征 (14)            | ✅  | 保留                                                     |
| **[64-71]** | **菜系 one-hot (8)**     | ❌  | **V5 新增**: 中式/西式/日韩/东南亚/地中海/印度/中东/拉美 |
| **[72-77]** | **口味特征 (6)**         | ❌  | **V5 新增**: 辣度/甜度/咸度/酸度/鲜味/苦味 (0-1 连续值)  |
| **[78-83]** | **烹饪方式 one-hot (6)** | ❌  | **V5 新增**: 蒸/煮/炒/烤/炸/生食                         |
| **[84-87]** | **准备复杂度 (4)**       | ❌  | **V5 新增**: 准备时间/烹饪时间/总时间(归一化)/技能需求   |
| **[88-91]** | **成本与可得性 (4)**     | ❌  | **V5 新增**: 估计成本/季节性/保存期/常见度               |
| **[92-95]** | **医学特征 (4)**         | ❌  | **V5 新增**: 嘌呤等级/磷含量等级/FODMAP等级/草酸等级     |

```typescript
// food_library 表需要新增的列（用于支持新嵌入维度）
// cuisine: varchar(30)         -- 菜系分类
// flavorProfile: jsonb         -- { spicy, sweet, salty, sour, umami, bitter }
// cookingMethod: varchar(20)   -- 主要烹饪方式
// prepTimeMinutes: int         -- 准备时间
// cookTimeMinutes: int         -- 烹饪时间
// skillRequired: varchar(10)   -- easy/medium/hard
// estimatedCostLevel: int      -- 1-5
// shelfLifeDays: int           -- 保质期
// fodmapLevel: varchar(10)     -- low/moderate/high
// oxalateLevel: varchar(10)    -- low/moderate/high
```

#### 3.2.6 VectorSearchService 升级（pgvector 实现）

```typescript
// vector-search.service.ts V5 改进

@Injectable()
export class VectorSearchService {
  // V5: pgvector 模式为默认模式
  private readonly EMBEDDING_DIM = 96;

  /**
   * 使用 pgvector 进行 ANN 搜索
   * 替代 V4 的内存暴力扫描
   */
  async findSimilarFoods(
    targetEmbedding: number[],
    topK: number,
    options?: {
      excludeIds?: string[];
      categoryFilter?: string[];
      minSimilarity?: number;
    }
  ): Promise<Array<{ foodId: string; similarity: number }>> {
    const qb = this.foodRepo
      .createQueryBuilder('f')
      .select('f.id', 'foodId')
      .addSelect(`1 - (f.embedding_v5 <=> :embedding::vector)`, 'similarity')
      .where('f.is_verified = true')
      .andWhere('f.embedding_v5 IS NOT NULL')
      .setParameter('embedding', `[${targetEmbedding.join(',')}]`);

    if (options?.excludeIds?.length) {
      qb.andWhere('f.id NOT IN (:...excludeIds)', { excludeIds: options.excludeIds });
    }
    if (options?.categoryFilter?.length) {
      qb.andWhere('f.category IN (:...categories)', { categories: options.categoryFilter });
    }
    if (options?.minSimilarity) {
      qb.andWhere(`1 - (f.embedding_v5 <=> :embedding::vector) >= :minSim`, {
        minSim: options.minSimilarity,
      });
    }

    qb.orderBy(`f.embedding_v5 <=> :embedding::vector`, 'ASC').limit(topK);

    return qb.getRawMany();
  }

  /**
   * 批量同步嵌入（V5: 96 维）
   */
  async syncEmbeddings(): Promise<{ updated: number; failed: number }> {
    const foods = await this.foodRepo.find({
      where: { isVerified: true, embeddingV5: IsNull() },
    });

    let updated = 0;
    let failed = 0;

    // 批量处理，每批 200
    for (let i = 0; i < foods.length; i += 200) {
      const batch = foods.slice(i, i + 200);
      const promises = batch.map(async (food) => {
        try {
          const embedding = computeFoodEmbeddingV5(food);
          await this.foodRepo.update(food.id, { embeddingV5: embedding });
          updated++;
        } catch {
          failed++;
        }
      });
      await Promise.allSettled(promises);
    }

    return { updated, failed };
  }
}
```

#### 3.2.7 GlobalOptimizer 升级

| 改动         | 描述                                              | 优先级 |
| ------------ | ------------------------------------------------- | :----: |
| 优化维度扩展 | 从 4 维 (cal/pro/fat/carb) → 6 维 (+fiber+GI)     |   P0   |
| 触发阈值降低 | 偏差阈值从 10% 降至 8%                            |   P1   |
| 迭代次数提升 | 从 8 轮增至 12 轮                                 |   P1   |
| 份量微调     | 除了食物替换，增加 ±10%/±20% 份量调整作为优化动作 |   P2   |

```typescript
// global-optimizer.ts V5 改进

interface OptimizationConfig {
  maxIterations: number; // 12 (V4: 8)
  minScoreRatio: number; // 0.85
  deviationWeights: {
    calories: number; // 0.30 (V4: 0.35)
    protein: number; // 0.25 (V4: 0.30)
    fat: number; // 0.12 (V4: 0.15)
    carbs: number; // 0.15 (V4: 0.20)
    fiber: number; // 0.10 (V5 新增)
    glycemicLoad: number; // 0.08 (V5 新增)
  };
  portionAdjustments: number[]; // [0.8, 0.9, 1.0, 1.1, 1.2] V5 新增
}

// 新增份量调整优化动作
interface OptimizationMove {
  type: 'swap' | 'portion_adjust'; // V5: 新增 portion_adjust
  mealIndex: number;
  pickIndex: number;
  // swap 类型
  newFood?: ScoredFood;
  // portion_adjust 类型
  portionMultiplier?: number;
}
```

#### 3.2.8 ABTestingService 升级

| 改动                       | 描述                                             | 优先级 |
| -------------------------- | ------------------------------------------------ | :----: |
| 指标自动收集               | 每次推荐记录 experimentId + groupId → 反馈时关联 |   P1   |
| 统计显著性                 | 实现 chi-squared test 判断接受率差异显著性       |   P1   |
| 实验结论持久化             | 新增 `experiment_results` 表，记录 winner/结论   |   P2   |
| 多变量实验                 | 支持同时测试 weights + penalties 参数            |   P2   |
| `mealWeightOverrides` 接入 | 实现 V4 定义但未接入的 mealWeightOverrides       |   P2   |

```typescript
// 指标收集
interface ExperimentMetrics {
  experimentId: string;
  groupId: string;
  totalRecommendations: number;
  acceptedCount: number;
  replacedCount: number;
  skippedCount: number;
  acceptanceRate: number;
  avgNutritionScore: number;
  sampleSize: number;
}

// 统计显著性（chi-squared）
function isSignificant(
  controlAccepted: number,
  controlTotal: number,
  treatmentAccepted: number,
  treatmentTotal: number,
  alpha: number = 0.05
): { significant: boolean; pValue: number; chiSquared: number } {
  // 2x2 列联表 chi-squared test
  const controlRejected = controlTotal - controlAccepted;
  const treatmentRejected = treatmentTotal - treatmentAccepted;
  const total = controlTotal + treatmentTotal;
  const totalAccepted = controlAccepted + treatmentAccepted;
  const totalRejected = controlRejected + treatmentRejected;

  const expected = [
    (controlTotal * totalAccepted) / total,
    (controlTotal * totalRejected) / total,
    (treatmentTotal * totalAccepted) / total,
    (treatmentTotal * totalRejected) / total,
  ];
  const observed = [controlAccepted, controlRejected, treatmentAccepted, treatmentRejected];

  let chiSq = 0;
  for (let i = 0; i < 4; i++) {
    chiSq += Math.pow(observed[i] - expected[i], 2) / expected[i];
  }

  // df=1 时，chi-squared > 3.841 → p < 0.05
  const critical = alpha === 0.05 ? 3.841 : 6.635; // 0.01
  return {
    significant: chiSq > critical,
    pValue: chiSq > critical ? alpha : 1.0, // 简化，实际应计算精确 p 值
    chiSquared: chiSq,
  };
}
```

### 3.3 Scoring 模块

#### 3.3.1 评分维度升级 (9→10 维)

| #      | 维度               | V4 权重 (fat_loss) | V5 权重 (fat_loss) | 变更                 |
| ------ | ------------------ | :----------------: | :----------------: | -------------------- |
| 1      | 热量匹配           |        0.20        |        0.18        | 略降，为纤维腾出空间 |
| 2      | 蛋白质             |        0.18        |        0.17        | 略降                 |
| 3      | 碳水               |        0.10        |        0.09        | 略降                 |
| 4      | 脂肪               |        0.08        |        0.07        | 略降                 |
| 5      | 品质               |        0.12        |        0.11        | 略降                 |
| 6      | 饱腹感             |        0.12        |        0.11        | 略降                 |
| 7      | 升糖影响           |        0.08        |        0.08        | 不变                 |
| 8      | 营养密度 (NRF 9.3) |        0.07        |        0.07        | NRF 用插补后数据     |
| 9      | 抗炎性             |        0.05        |        0.05        | 不变                 |
| **10** | **膳食纤维**       |       **-**        |      **0.07**      | **V5 新增**          |

> 其他 goal 类型类似调整，确保总权重 = 1.0

#### 3.3.2 NutritionScoreService 升级

| 改动         | 描述                                                                 | 优先级 |
| ------------ | -------------------------------------------------------------------- | :----: |
| 消除重复计算 | `calculateDailyGoals()` 结果在请求内缓存（单次请求可能被调用 3+ 次） |   P1   |
| 决策带扩展   | 增加 `GREAT (>=85)` 带，用于可解释性                                 |   P2   |

### 3.4 Cache 模块

#### 3.4.1 FoodPoolCacheService 升级

| 改动         | 描述                                                    | 优先级 |
| ------------ | ------------------------------------------------------- | :----: |
| 分片缓存     | 按品类分片：`food_pool:protein`, `food_pool:grain`, ... |   P1   |
| 延长 TTL     | 从 5 分钟延长到 30 分钟（食物库变更不频繁）             |   P1   |
| 后台预热     | TTL 过期前 2 分钟异步预加载                             |   P2   |
| 仅存关键字段 | Redis 中只存 scoring 需要的字段，减少序列化开销         |   P2   |

```typescript
// 分片缓存
async getVerifiedFoodsByCategory(category: string): Promise<FoodLibrary[]> {
  const cacheKey = `food_pool:${category}`;

  // L1: 内存
  const mem = this.memoryCache.get(cacheKey);
  if (mem && !this.isExpired(mem)) return mem.data;

  // L2: Redis
  const redis = await this.redis.get<FoodLibrary[]>(cacheKey);
  if (redis) {
    this.memoryCache.set(cacheKey, { data: redis, ts: Date.now() });
    return redis;
  }

  // DB
  const foods = await this.foodRepo.find({
    where: { isVerified: true, category },
  });
  this.memoryCache.set(cacheKey, { data: foods, ts: Date.now() });
  await this.redis.set(cacheKey, foods, 30 * 60 * 1000); // 30 min
  return foods;
}

// 批量获取所有品类
async getVerifiedFoods(): Promise<FoodLibrary[]> {
  const categories = ['protein', 'grain', 'veggie', 'fruit', 'dairy', 'fat', 'beverage', 'snack', 'condiment', 'composite'];
  const results = await Promise.all(
    categories.map((c) => this.getVerifiedFoodsByCategory(c)),
  );
  return results.flat();
}
```

#### 3.4.2 RedisCacheService 升级

| 改动                | 描述                                                | 优先级 |
| ------------------- | --------------------------------------------------- | :----: |
| key 命名空间        | 全局前缀 `wuwei:` 防止多应用冲突                    |   P0   |
| `setNX` 分布式锁    | 新增 `setNX(key, value, ttlMs): Promise<boolean>`   |   P0   |
| `getOrSet` 模式     | 新增 `getOrSet<T>(key, factory, ttlMs): Promise<T>` |   P1   |
| `UNLINK` 替代 `DEL` | 非阻塞删除                                          |   P1   |
| Pipeline 支持       | 批量操作                                            |   P2   |
| 定期重连            | 超过 maxRetries 后每 60 秒尝试重连                  |   P2   |

```typescript
// 新增的关键方法
async setNX(key: string, value: string, ttlMs: number): Promise<boolean> {
  if (!this.isConnected || !this.client) return false;
  const prefixedKey = `${this.PREFIX}${key}`;
  const result = await this.client.set(prefixedKey, value, {
    PX: ttlMs,
    NX: true,
  });
  return result === 'OK';
}

async getOrSet<T>(key: string, factory: () => Promise<T>, ttlMs: number): Promise<T> {
  const cached = await this.get<T>(key);
  if (cached !== null) return cached;

  const value = await factory();
  await this.set(key, value, ttlMs);
  return value;
}
```

### 3.5 数据流模块

#### 3.5.1 时区统一方案

V5 采用 IANA 时区字符串（如 `Asia/Shanghai`）作为统一时区表示，存储在 `UserProfile.timezone` 列。

```typescript
// 全局时区工具
// apps/api-server/src/common/utils/timezone.util.ts

export function getUserLocalDate(timezone: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  // 返回 'YYYY-MM-DD' 格式
}

export function getUserLocalHour(timezone: string): number {
  return new Date().toLocaleString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  }) |> Number;
}

// 所有使用 new Date().getHours() 的地方改为：
const hour = getUserLocalHour(profile.timezone ?? 'Asia/Shanghai');

// 所有使用 new Date().toISOString().split('T')[0] 的地方改为：
const today = getUserLocalDate(profile.timezone ?? 'Asia/Shanghai');
```

受影响的文件清单：

- `daily-plan.service.ts` — `getPlan()`, `adjustPlan()`, `generatePlan()` 中的日期和小时
- `food.service.ts` — `getMealSuggestion()` 中的 `new Date().getHours()`
- `weekly-plan.service.ts` — `getCurrentWeekDates()` 中的日期边界
- `constraint-generator.service.ts` — 弱时段检测（V4 已修复但用 offset 参数，需改用 timezone）
- `profile-cron.service.ts` — `mealTimingPatterns` 计算

#### 3.5.2 Controller 整理

```
V4 现状（7 个 Controller，19 个重复端点）:
├── FoodController (532行) ← 全部重复，删除
├── FoodRecordController  ← 保留
├── FoodSummaryController ← 保留
├── FoodPlanController    ← 保留，添加 DTO 验证
├── FoodBehaviorController ← 保留
├── FoodNutritionController ← 保留
└── ContentManagementController ← 保留

V5 目标（6 个 Controller，0 重复）:
├── FoodRecordController   — 增加 POST analyze (从 FoodController 迁移)
├── FoodSummaryController  — 保留不变
├── FoodPlanController     — 添加 DTO + @Throttle + WeeklyPlan 端点
├── FoodBehaviorController — 保留不变
├── FoodNutritionController — 保留不变
└── ContentManagementController — 添加实验结果端点
```

新增端点：
| 端点 | Controller | 描述 |
|------|-----------|------|
| `GET weekly-plan` | FoodPlanController | 暴露 WeeklyPlanService（V4 未暴露） |
| `POST daily-plan/regenerate-meal` | FoodPlanController | 单餐替换独立端点（从 regenerate 分离） |
| `GET experiment-results/:id` | ContentManagementController | A/B 实验结果查询 |

#### 3.5.3 反馈闭环数据流 (V5)

```
用户操作                     数据流                              影响
═══════════════════════════════════════════════════════════════════════

记录饮食 ──────→ FoodRecord ──→ DailySummary 更新
    │                           │
    │                           ├──→ 日 Cron: compliance/streak/goalProgress
    │                           └──→ portionTendency 计算
    │
接受/替换/跳过推荐 ──→ RecommendationFeedback
    │                     │
    │                     ├──→ PreferenceUpdater (EMA, 即时)
    │                     ├──→ CF 矩阵失效标记 (延迟, 下次重建)
    │                     ├──→ Thompson Sampling 参数更新 (即时)
    │                     └──→ [V5] A/B 实验指标记录
    │
修改画像 ──────→ ProfileSnapshot + InferredProfile 同步
    │                     │
    │                     └──→ ProfileCache 失效
    │
体重变化 ──────→ WeightHistory 记录
    │                     │
    │                     └──→ goalProgress 重算
    │
[V5] 删除饮食记录 ──→ DailySummary 更新（V4 遗漏，V5 修复）
```

#### 3.5.4 `deleteRecord` 修复

```typescript
// food.service.ts — deleteRecord 需要更新 DailySummary
async deleteRecord(userId: string, recordId: string): Promise<void> {
  await this.foodRecordService.deleteRecord(userId, recordId);
  // V5: 删除后也要更新汇总（V4 遗漏）
  this.dailySummaryService.updateDailySummary(userId).catch((err) => {
    this.logger.warn(`删除记录后更新日汇总失败: ${err.message}`);
  });
}
```

---

## Step 4: 技术路线图

### Phase 1 — 基础治理 (预计 3-4 天)

> 目标：消除所有架构缺陷和生产风险，不改变推荐逻辑

| #    | 任务                                                                                  | 涉及文件                                                                                          | 预计工时 |
| ---- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | :------: |
| 1.1  | ~~删除 `FoodController`，迁移 `POST analyze` 到 `FoodRecordController`~~ **[已完成]** | `food.controller.ts`(已删除), `food-record.controller.ts`, `diet.module.ts`                       |    1h    |
| 1.2  | ~~定义 `AppUser` 接口，替换所有 `user: any`~~ **[已完成]**                            | `app-user-payload.type.ts`(新建), 11 个 Controller 全部替换                                       |    1h    |
| 1.3  | ~~新建验证 DTO（6 个端点）~~ **[已完成]**                                             | `food.dto.ts` 新增 6 个 DTO，4 个 Controller 已替换内联类型                                       |    2h    |
| 1.4  | ~~添加 `@Throttle()` 到 4 个重操作端点~~ **[已完成]**                                 | `app.module.ts`, `food-plan.controller.ts`, `food-record.controller.ts`                           |   0.5h   |
| 1.5  | ~~RedisCacheService 新增 `setNX`/`getOrSet`/key 命名空间~~ **[已完成]**               | `redis-cache.service.ts`                                                                          |   1.5h   |
| 1.6  | ~~计划生成幂等锁（Redis setNX）~~ **[已完成]**                                        | `daily-plan.service.ts`                                                                           |    1h    |
| 1.7  | ~~BMR 安全下限 (1200/1500 kcal)~~ **[已完成]**                                        | `user-profile.service.ts`                                                                         |   0.5h   |
| 1.8  | ~~统一时区：添加 `timezone` 列 + `timezone.util.ts` + 替换全部 12 处~~ **[已完成]**   | `user-profile.entity.ts`, 新建 `timezone.util.ts`, 10 个 service 文件 + `recommendation.types.ts` |    2h    |
| 1.9  | ~~`deleteRecord` 触发 DailySummary 更新~~ **[已完成]**                                | `food.service.ts`, `food-record.service.ts`                                                       |   0.5h   |
| 1.10 | ~~统一餐次命名（`morning`→`breakfast`）和比例（使用 `MEAL_RATIOS`）~~ **[已完成]**    | `recommendation.types.ts`, `daily-plan.service.ts`, `food.service.ts`                             |    1h    |
| 1.11 | ~~Cron 分布式锁~~ **[已完成]**                                                        | `redis-cache.service.ts` 新增 `runWithLock`, `profile-cron.service.ts` 4 个 cron 方法             |    1h    |
| 1.12 | ~~反馈统计改 SQL GROUP BY~~ **[已完成]**                                              | `feedback.service.ts`                                                                             |    1h    |
| 1.13 | ~~推荐质量服务改 SQL 聚合~~ **[已完成]**                                              | `recommendation-quality.service.ts`                                                               |    1h    |
| 1.14 | ~~编译验证 + 测试通过~~ **[已完成]**                                                  | 全量 `tsc --noEmit` + `jest`                                                                      |   0.5h   |

**Phase 1 产出**: 0 个重复端点、全量输入验证、限流、幂等、统一时区、性能热点修复

### Phase 2 — 推荐智能化 (预计 4-5 天)

> 目标：提升推荐质量和智能化水平

| #    | 任务                                                                       | 涉及文件                                                                                                              | 预计工时 |
| ---- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | :------: |
| 2.1  | ~~全局优化器集成到 `generatePlan()`~~ **[已完成]**                         | `daily-plan.service.ts`, `global-optimizer.ts`, `recommendation-engine.service.ts`, `recommendation.types.ts`         |    2h    |
| 2.2  | ~~全局优化器维度扩展 (4→6 维) + 份量调整~~ **[已完成]**                    | `global-optimizer.ts`, `recommendation.types.ts`, `food-scorer.service.ts`, `daily-plan.service.ts`                   |    2h    |
| 2.3  | ~~跨天多样性：周计划传递排除集~~ **[已完成]**                              | `weekly-plan.service.ts`, `daily-plan.service.ts`                                                                     |    2h    |
| 2.4  | ~~暴露 `GET weekly-plan` API 端点~~ **[已完成]**                           | `food-plan.controller.ts`                                                                                             |   0.5h   |
| 2.5  | ~~周计划批量生成优化（共享数据预加载）~~ **[已完成]**                      | `weekly-plan.service.ts`, `daily-plan.service.ts`                                                                     |    3h    |
| 2.6  | ~~新增第 10 维评分：膳食纤维~~ **[已完成]**                                | `food-scorer.service.ts`, `recommendation.types.ts`, `scoring-explanation.interface.ts`                               |   1.5h   |
| 2.7  | ~~微量营养素缺失值品类均值插补~~ **[已完成]**                              | `food-scorer.service.ts`, `food-pool-cache.service.ts`, `recommendation.types.ts`, `recommendation-engine.service.ts` |    2h    |
| 2.8  | ~~PenaltyEngine → HealthModifierEngine（正向增益 + 严重度）~~ **[已完成]** | `health-modifier-engine.service.ts` (重命名), `recommendation.types.ts`                                               |    3h    |
| 2.9  | ~~CF 时间衰减实现~~ **[已完成]**                                           | `collaborative-filtering.service.ts`                                                                                  |    1h    |
| 2.10 | ~~CF 矩阵计算移到 Cron~~ **[已完成]**                                      | `collaborative-filtering.service.ts`                                                                                  |   1.5h   |
| 2.11 | ~~食物嵌入 64→96 维扩展~~ **[已完成]**                                     | `food-embedding.ts`, `food-library.entity.ts`, `vector-search.service.ts`                                             |    2h    |
| 2.12 | ~~场景推荐渐进放宽逻辑~~ **[已完成]**                                      | `recommendation-engine.service.ts`                                                                                    |    1h    |
| 2.13 | ~~编译验证 + 测试更新~~ **[已完成]**                                       | 全量 `tsc --noEmit` + `jest`                                                                                          |    2h    |

**Phase 2 产出**: 全局优化集成、跨天多样性、10 维评分、健康增益、CF 修复、96 维嵌入

### Phase 3 — 画像与可解释性 (预计 3-4 天)

> 目标：填充所有孤儿字段、实现可解释性、A/B 指标收集

| #    | 任务                                                                        | 涉及文件                                                                              | 预计工时 |
| ---- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | :------: |
| 3.1  | ~~填充 `goalProgress` (weight_history 表 + 计算逻辑)~~ **[已完成]**         | 新建 `weight-history.entity.ts`, `profile-cron.service.ts`, `user-profile.service.ts` |    3h    |
| 3.2  | ~~填充 `optimalMealCount`/`bingeRiskHours`/`portionTendency`~~ **[已完成]** | `profile-cron.service.ts`                                                             |    2h    |
| 3.3  | ~~Cron 批处理 + 并发优化~~ **[已完成]**                                     | `profile-cron.service.ts`                                                             |    2h    |
| 3.4  | ~~Segmentation 升级 (new_user/returning_user/交叉分类)~~ **[已完成]**       | `segmentation.util.ts`, `profile-cron.service.ts`, `profile-inference.service.ts`     |    1h    |
| 3.5  | ~~可解释性：ExplanationGeneratorService~~ **[已完成]**                      | 新建 `explanation-generator.service.ts`                                               |    3h    |
| 3.6  | ~~推荐 API 返回 `UserFacingExplanation`~~ **[已完成]**                      | `food-plan.controller.ts`, `daily-plan.service.ts`, `daily-plan.entity.ts`            |   1.5h   |
| 3.7  | ~~A/B 测试指标收集~~ **[已完成]**                                           | `ab-testing.service.ts`, `feedback.service.ts`, `recommendation-feedback.entity.ts`   |    2h    |
| 3.8  | ~~A/B 测试统计显著性~~ **[已完成]**                                         | `ab-testing.service.ts`                                                               |   1.5h   |
| 3.9  | ~~提醒去重（reminder_dismissals 表）~~ **[已完成]**                         | 新建 entity, `collection-trigger.service.ts`                                          |   1.5h   |
| 3.10 | ~~编译验证 + 测试~~ **[已完成]**                                            | 全量 `tsc --noEmit` + `jest`                                                          |    1h    |

**Phase 3 产出**: 所有孤儿字段填充、用户可读推荐解释、A/B 全链路、提醒去重

### Phase 4 — 高级特性 (预计 2-3 天)

> 目标：pgvector、item-based CF、缓存分片

| #   | 任务                                                         | 涉及文件                                                   | 预计工时 |
| --- | ------------------------------------------------------------ | ---------------------------------------------------------- | :------: |
| 4.1 | ~~pgvector 迁移 + HNSW 索引~~ **[已完成]**                   | 新迁移文件, `vector-search.service.ts`                     |    3h    |
| 4.2 | ~~Item-based CF 实现~~ **[已完成]**                          | `collaborative-filtering.service.ts`                       |    3h    |
| 4.3 | ~~食物池缓存分片 (按品类)~~ **[已完成]**                     | `food-pool-cache.service.ts`                               |    2h    |
| 4.4 | ~~FoodPoolCache TTL 延长 + 后台预热~~ **[已完成]**           | `food-pool-cache.service.ts`                               |    1h    |
| 4.5 | ~~ProfileCache LRU + 分层 TTL + Singleflight~~ **[已完成]**  | `profile-cache.service.ts`                                 |    2h    |
| 4.6 | ~~food_library 新增列（菜系/口味/烹饪方式等）~~ **[已完成]** | 迁移文件, `food-library.entity.ts`                         |    2h    |
| 4.7 | ~~在线权重学习（基于反馈的梯度更新）~~ **[已完成]**          | `food-scorer.service.ts`, 新建 `weight-learner.service.ts` |    3h    |
| 4.8 | ~~`mealWeightOverrides` 接入 A/B 系统~~ **[已完成]**         | `ab-testing.service.ts`, `food-scorer.service.ts`          |    1h    |
| 4.9 | ~~编译验证 + 测试~~ **[已完成]**                             | 全量 `tsc --noEmit` + `jest`                               |    1h    |

**Phase 4 产出**: pgvector ANN 搜索、item-based CF、缓存优化、权重学习

### 里程碑总览

```
Phase 1 (3-4天)          Phase 2 (4-5天)           Phase 3 (3-4天)         Phase 4 (2-3天)
 架构治理                 推荐智能化                 画像与可解释性           高级特性
 ┌─────────────┐         ┌──────────────┐          ┌──────────────┐        ┌──────────────┐
 │ 删除重复端点 │         │ 全局优化器集成│          │ 孤儿字段填充  │        │ pgvector     │
 │ 输入验证 DTO │         │ 10维评分      │          │ 推荐解释生成  │        │ Item-based CF│
 │ 限流/幂等    │         │ 健康增益引擎  │          │ A/B指标收集   │        │ 缓存分片     │
 │ 统一时区     │         │ CF修复        │          │ 统计显著性    │        │ 权重学习     │
 │ SQL优化      │         │ 96维嵌入      │          │ 分段升级      │        │ 嵌入新字段   │
 │ 分布式锁     │         │ 跨天多样性    │          │ 提醒去重      │        │              │
 └──────┬──────┘         └──────┬───────┘          └──────┬───────┘        └──────┬───────┘
        │                       │                          │                       │
        ▼                       ▼                          ▼                       ▼
   生产就绪基础             推荐质量飞跃               用户体验提升            技术深度升级
```

---

## Step 5: 直接替换策略

> 项目未上线，无需数据迁移或 API 兼容层。所有改动直接就地修改。

### 5.1 数据库变更策略

所有 schema 变更通过 TypeORM 迁移文件实现，但无需考虑存量数据：

| 变更                                                              | 类型                          | 迁移方式                                    |
| ----------------------------------------------------------------- | ----------------------------- | ------------------------------------------- |
| `user_profiles` 添加 `timezone` 列                                | ALTER TABLE ADD COLUMN        | 默认值 `'Asia/Shanghai'`                    |
| 新建 `weight_history` 表                                          | CREATE TABLE                  | 新表                                        |
| 新建 `reminder_dismissals` 表                                     | CREATE TABLE                  | 新表                                        |
| `food_library` 添加 `embedding_v5 vector(96)` 列                  | ALTER TABLE + CREATE INDEX    | 需先安装 pgvector 扩展                      |
| `food_library` 添加菜系/口味/烹饪方式等列                         | ALTER TABLE ADD COLUMN (多列) | nullable，渐进填充                          |
| `penalty-engine.service.ts` → `health-modifier-engine.service.ts` | 文件重命名                    | 直接 git mv + 更新 import                   |
| `healthConditions` 增加 severity 字段                             | JSONB schema 变更             | 直接修改 interface，旧数据默认 `'moderate'` |

### 5.2 文件删除清单

| 文件                                                      | 原因                                                |
| --------------------------------------------------------- | --------------------------------------------------- |
| `apps/api-server/src/modules/diet/app/food.controller.ts` | 19 个重复端点的根源，拆分 Controller 已覆盖所有功能 |

### 5.3 文件重命名清单

| 原路径                      | 新路径                              | 原因                   |
| --------------------------- | ----------------------------------- | ---------------------- |
| `penalty-engine.service.ts` | `health-modifier-engine.service.ts` | 现在同时处理惩罚和增益 |

### 5.4 新增文件清单

| 文件                                                                                   | 用途               |
| -------------------------------------------------------------------------------------- | ------------------ |
| `apps/api-server/src/common/types/app-user.type.ts`                                    | `AppUser` 接口定义 |
| `apps/api-server/src/common/utils/timezone.util.ts`                                    | 时区工具函数       |
| `apps/api-server/src/modules/diet/app/dto/regenerate-plan.dto.ts`                      | 重新生成计划 DTO   |
| `apps/api-server/src/modules/diet/app/dto/adjust-plan.dto.ts`                          | 调整计划 DTO       |
| `apps/api-server/src/modules/diet/app/dto/recommendation-feedback.dto.ts`              | 推荐反馈 DTO       |
| `apps/api-server/src/modules/diet/app/dto/substitute-query.dto.ts`                     | 替代查询 DTO       |
| `apps/api-server/src/modules/diet/app/recommendation/explanation-generator.service.ts` | 推荐解释生成       |
| `apps/api-server/src/modules/diet/app/recommendation/weight-learner.service.ts`        | 在线权重学习       |
| `apps/api-server/src/modules/user/entities/weight-history.entity.ts`                   | 体重历史           |
| `apps/api-server/src/modules/user/entities/reminder-dismissal.entity.ts`               | 提醒关闭记录       |
| `apps/api-server/src/migrations/1756000000000-V5SchemaUpgrade.ts`                      | V5 schema 迁移     |
| `apps/api-server/src/migrations/1756100000000-AddPgvectorExtension.ts`                 | pgvector 迁移      |

---

## Step 6: 文档与代码差异清单

### 6.1 与 V4 文档的差异

| V4 文档描述                        | V5 变更                                            | 理由                                 |
| ---------------------------------- | -------------------------------------------------- | ------------------------------------ |
| "升级策略: 不重写、不破坏现有功能" | 直接替换，无兼容约束                               | 项目未上线                           |
| "PenaltyEngine: 4 层惩罚"          | HealthModifierEngine: 4 层惩罚 + 正向增益 + 严重度 | 只惩罚不奖励限制了推荐质量           |
| "9 维评分"                         | 10 维评分（+膳食纤维）                             | 纤维对多个健康目标都重要但无直接杠杆 |
| "64 维食物嵌入"                    | 96 维（+菜系/口味/烹饪方式/成本/医学）             | 无法捕获烹饪和口味偏好               |
| "内存向量搜索"                     | pgvector ANN 搜索                                  | O(N) 暴力不可扩展                    |
| "User-based CF"                    | Item-based CF + 时间衰减                           | user-based O(U²) 不可扩展            |
| "全局优化器独立函数"               | 集成到 generatePlan 主流程                         | 未集成等于无效代码                   |
| "周计划串行生成"                   | 共享数据预加载 + 跨天排除                          | N+1 查询 + 多样性未生效              |
| "5 分钟食物缓存 TTL"               | 30 分钟 + 分片 + 预热                              | 食物库不经常变动                     |

### 6.2 新增文档需要的条目

- `ExplanationGeneratorService` 的解释生成规则
- `HealthModifierEngine` 的增益规则表
- `WeightHistory` 数据模型
- pgvector 安装和索引配置
- 分布式 Cron 锁的使用方式
- 96 维嵌入的维度分布表

---

## Step 7: 风险与权衡

### 7.1 技术风险

| 风险                             | 概率 | 影响 | 缓解                                                                               |
| -------------------------------- | :--: | :--: | ---------------------------------------------------------------------------------- |
| pgvector 部署环境不支持          |  中  |  高  | Railway/Docker 均支持 PostgreSQL 扩展；提供回退到内存搜索的开关                    |
| 96 维嵌入新字段数据空缺          |  高  |  中  | 菜系/口味/烹饪方式等新字段短期内为空；使用默认值和品类推断，不依赖这些维度做硬过滤 |
| 全局优化器增加延迟               |  中  |  中  | 12 轮迭代预计增加 ~50ms，可接受；设置超时上限 200ms                                |
| Item-based CF 食物数量不足时退化 |  中  |  低  | <500 食物时自动回退到 user-based CF                                                |
| 在线权重学习过拟合               |  中  |  中  | 设置学习率上限、权重变化幅度限制（±20%）、定期回退到基线                           |

### 7.2 权衡决策

| 决策           | 选项 A                 | 选项 B                      | 选择 | 理由                                                          |
| -------------- | ---------------------- | --------------------------- | :--: | ------------------------------------------------------------- |
| CF 算法        | User-based (现有)      | Item-based (新建)           |  B   | Item-based 更稳定、可扩展；user-based 在用户少时也退化        |
| 向量搜索       | 内存 HNSW (hnswlib)    | pgvector (DB层)             |  B   | 减少应用内存占用，天然支持多实例，索引持久化                  |
| 嵌入维度       | 保持 64 维             | 扩展到 96 维                |  B   | 增加 50% 维度换取菜系/口味/烹饪方式表达力，计算开销增加可忽略 |
| 惩罚引擎重命名 | 保留 PenaltyEngine     | 重命名 HealthModifierEngine |  B   | 名称反映双向语义（惩罚+增益）                                 |
| 时区表示       | offset 数字 (-8 ~ +12) | IANA 字符串 (Asia/Shanghai) |  B   | IANA 自动处理夏令时，是行业标准                               |
| 卡路里下限     | 无限制（用户自由）     | 强制 1200/1500 下限         |  B   | 医学安全底线，避免极端饮食方案                                |

### 7.3 不做的事情（V5 范围外）

| 方案                                  | 为什么不做                                                               |
| ------------------------------------- | ------------------------------------------------------------------------ |
| 引入外部 ML 模型 (TensorFlow/PyTorch) | 当前规模不需要，增加部署复杂度和运维成本。V5 的在线权重学习已是渐进式 ML |
| 独立推荐微服务                        | 当前单体 NestJS 架构足够，推荐逻辑已模块化，拆微服务增加运维负担         |
| 实时流处理 (Kafka/RabbitMQ)           | 反馈量不足以需要流处理，fire-and-forget + cron 已够用                    |
| GraphQL 替代 REST                     | 前端已适配 REST API，切换成本高，收益不明显                              |
| 多语言 i18n 框架 (i18next)            | 当前用户群为中文用户，36 条文案用简单 map 即可                           |
| 外部向量数据库 (Qdrant/Pinecone)      | pgvector 足以处理 <100K 食物的向量搜索，无需额外基础设施                 |
| 食物-药物交互检测                     | 需要药品数据库和医学审核，超出饮食推荐系统范围                           |

### 7.4 成功标准

| 指标                     |     V4 基线     |  V5 目标   | 衡量方式           |
| ------------------------ | :-------------: | :--------: | ------------------ |
| 推荐接受率               |    ~60% (估)    |    ≥70%    | A/B 测试指标收集   |
| 每日营养偏差             |   ≤10% (阈值)   | ≤8% (阈值) | 全局优化器偏差报告 |
| 周计划生成延迟           | ~3.5s (7×500ms) |   ≤1.5s    | 共享数据预加载     |
| 向量搜索延迟 (1000 食物) |      ~15ms      |    ≤3ms    | pgvector HNSW      |
| 孤儿字段填充率           |       0/4       |    4/4     | 代码覆盖           |
| 重复端点数               |       19        |     0      | 代码审查           |
| 输入验证覆盖率           |      ~30%       |    100%    | DTO 覆盖           |
| 测试覆盖                 |    243 tests    | ≥300 tests | jest 报告          |

---

## 附录 A: 核心文件索引

### 新增文件

| 文件路径                                                               | 用途         | Phase |
| ---------------------------------------------------------------------- | ------------ | :---: |
| `src/common/types/app-user.type.ts`                                    | AppUser 接口 |   1   |
| `src/common/utils/timezone.util.ts`                                    | 时区工具     |   1   |
| `src/modules/diet/app/dto/*.dto.ts` (6个)                              | 输入验证     |   1   |
| `src/modules/diet/app/recommendation/explanation-generator.service.ts` | 推荐解释     |   3   |
| `src/modules/diet/app/recommendation/weight-learner.service.ts`        | 权重学习     |   4   |
| `src/modules/user/entities/weight-history.entity.ts`                   | 体重历史     |   3   |
| `src/modules/user/entities/reminder-dismissal.entity.ts`               | 提醒去重     |   3   |
| `src/migrations/1756000000000-V5SchemaUpgrade.ts`                      | V5 迁移      |   1   |
| `src/migrations/1756100000000-AddPgvectorExtension.ts`                 | pgvector     |   4   |

### 修改文件（按 Phase）

**Phase 1 (14 个文件)**:
`redis-cache.service.ts`, `daily-plan.service.ts`, `food.service.ts`, `food-plan.controller.ts`, `food-record.controller.ts`, `user-profile.service.ts`, `user-profile.entity.ts`, `diet.module.ts`, `feedback.service.ts`, `recommendation-quality.service.ts`, `profile-cron.service.ts`, `weekly-plan.service.ts`, `food.controller.ts`(删除), `recommendation.types.ts`

**Phase 2 (11 个文件)**:
`recommendation-engine.service.ts`, `global-optimizer.ts`, `food-scorer.service.ts`, `penalty-engine.service.ts`(重命名), `collaborative-filtering.service.ts`, `food-embedding.ts`, `food-plan.controller.ts`, `daily-plan.service.ts`, `weekly-plan.service.ts`, `recommendation.types.ts`, `food-library.entity.ts`

**Phase 3 (8 个文件)**:
`profile-cron.service.ts`, `segmentation.util.ts`, `ab-testing.service.ts`, `feedback.service.ts`, `collection-trigger.service.ts`, `food-plan.controller.ts`, `daily-plan.service.ts`, `user-profile.service.ts`

**Phase 4 (7 个文件)**:
`vector-search.service.ts`, `collaborative-filtering.service.ts`, `food-pool-cache.service.ts`, `profile-cache.service.ts`, `food-scorer.service.ts`, `food-library.entity.ts`, `ab-testing.service.ts`

### 删除文件

| 文件路径                                  | 原因                |
| ----------------------------------------- | ------------------- |
| `src/modules/diet/app/food.controller.ts` | 19 个重复端点的根源 |

---

## 附录 B: 数据库 Schema 变更

### 迁移 1: V5SchemaUpgrade

```sql
-- 1. user_profiles 添加 timezone
ALTER TABLE user_profiles ADD COLUMN timezone VARCHAR(50) DEFAULT 'Asia/Shanghai';

-- 2. weight_history 表
CREATE TABLE weight_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  weight_kg DECIMAL(5,1) NOT NULL,
  body_fat_percent DECIMAL(4,1),
  source VARCHAR(20) DEFAULT 'manual',
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  CONSTRAINT fk_weight_user FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE
);
CREATE INDEX idx_weight_history_user_date ON weight_history(user_id, recorded_at DESC);

-- 3. reminder_dismissals 表
CREATE TABLE reminder_dismissals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  reminder_type VARCHAR(50) NOT NULL,
  dismissed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, reminder_type)
);

-- 4. food_library 新增列
ALTER TABLE food_library ADD COLUMN cuisine VARCHAR(30);
ALTER TABLE food_library ADD COLUMN flavor_profile JSONB;
ALTER TABLE food_library ADD COLUMN cooking_method VARCHAR(20);
ALTER TABLE food_library ADD COLUMN prep_time_minutes INT;
ALTER TABLE food_library ADD COLUMN cook_time_minutes INT;
ALTER TABLE food_library ADD COLUMN skill_required VARCHAR(10) DEFAULT 'easy';
ALTER TABLE food_library ADD COLUMN estimated_cost_level INT DEFAULT 3;
ALTER TABLE food_library ADD COLUMN shelf_life_days INT;
ALTER TABLE food_library ADD COLUMN fodmap_level VARCHAR(10);
ALTER TABLE food_library ADD COLUMN oxalate_level VARCHAR(10);

-- 5. 品类索引（用于分片缓存查询）
CREATE INDEX idx_food_library_category_verified ON food_library(category) WHERE is_verified = true;
```

### 迁移 2: AddPgvectorExtension

```sql
-- 需要数据库 superuser 权限
CREATE EXTENSION IF NOT EXISTS vector;

-- 添加 96 维向量列
ALTER TABLE food_library ADD COLUMN embedding_v5 vector(96);

-- HNSW 索引（余弦距离）
CREATE INDEX idx_food_embedding_hnsw
  ON food_library USING hnsw (embedding_v5 vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);
```
