# 智能饮食系统 V6.6 升级方案

> 基于 V6.5 架构的版本演进设计，非重新设计。
> 所有升级不影响已有接口，保留已有模块设计。
> 日期：2026-04-11

---

## 目录

- [Step 1：V6.5 能力评估](#step-1v65-能力评估)
- [Step 2：核心升级方向](#step-2核心升级方向)
- [Step 3：架构升级设计](#step-3架构升级设计)
- [Step 4：模块级升级设计](#step-4模块级升级设计)
- [Step 5：技术路线图](#step-5技术路线图)
- [Step 6：数据迁移](#step-6数据迁移)
- [Step 7：文档差异](#step-7文档差异)

---

## Step 1：V6.5 能力评估

### 1.1 V6.5 已达成能力

通过对 V6.5 实际代码的深度审计（2026-04-11），确认以下模块已**完整实现**：

| 能力域                  | V6.5 现状                                                                                                                                     | 成熟度   |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 可执行性评分            | 第 12 维 `executability`（4 子维度：commonality/cost/cookTime/skill），已进入评分管道                                                         | 高       |
| 现实过滤                | RealisticFilterService（commonality 阈值 + 预算过滤 + 烹饪时间上限），策略驱动可配置                                                          | 高       |
| 大众化分数              | `foods.commonality_score`（0-100），默认 50，已接入 FoodPoolCacheService 和 FoodScorerService                                                 | 高       |
| 渠道感知                | AcquisitionChannel 5 种，推断逻辑 4 层优先级，HOME_COOK 触发烹饪时间过滤                                                                      | 高       |
| 餐食组合评分            | MealCompositionScorer（食材多样性 0.30 + 烹饪方式多样性 0.20 + 口味平衡 0.25 + 营养互补 0.25），已接入 rerank                                 | 高       |
| 策略自动调优            | StrategyAutoTuner（周 Cron，效果矩阵分析，自动切换 + 自适应探索率），已注入推荐引擎                                                           | 中高     |
| 熔断器                  | CircuitBreakerService（opossum 库，per-service 实例，Prometheus 计数），全局注册                                                              | 高       |
| 死信队列                | DeadLetterService（5 个 Processor 接入，DB 持久化，Admin 查询/重放/丢弃），已完整实现                                                         | 高       |
| 队列降级                | QueueResilienceService（Redis 不可用时同步降级处理）                                                                                          | 中高     |
| 替换模式追踪            | replacement_patterns 表 + ReplacementPatternService（A→B 频率统计），已接入替换建议评分                                                       | 中       |
| Redis 限流              | Gateway RateLimitGuard 升级为 Redis-first（INCR+TTL），内存回退                                                                               | 高       |
| 策略第 9 维             | RealismConfig（commonalityThreshold/budgetFilter/cookTimeCap），JSONB 存储                                                                    | 高       |
| 事件错误处理            | EventErrorHandler 全局 EventEmitter2 error listener，Prometheus 计数                                                                          | 高       |
| 菜谱评分 4 维           | nutrition + preference + difficulty + cookingTime，烹饪时间已接入                                                                             | 高       |
| 菜谱用户评分            | recipe_ratings 表（1-5 星）+ 平均评分聚合                                                                                                     | 中高     |
| 向量搜索                | VectorSearchService（V5 遗留，655 行，pgvector + cosine），存在但**未包装为语义召回管道**                                                     | 低       |
| 画像字段激活            | exerciseSchedule DTO 已暴露（V6.3），其余 5 字段（sleepQuality/stressLevel/hydrationGoal/supplementsUsed/mealTimingPreference）**完全未实现** | 低       |
| 全局限流 Redis 化       | @nestjs/throttler 仍为**内存存储**，多实例失效                                                                                                | 未解决   |
| Redis 连接池            | RedisCacheService 使用 node-redis 单连接，**未使用 ioredis**                                                                                  | 未解决   |
| 策略调优持久化          | StrategyAutoTuner 仅改内存 Map，**重启丢失**                                                                                                  | 未解决   |
| Schema/Migration 一致性 | **7 张新表 + 3 字段 + 5 FK 有 schema 定义但无迁移文件**                                                                                       | CRITICAL |

### 1.2 V6.5 遗留问题诊断

#### C0：Schema/Migration 漂移（CRITICAL，影响部署可靠性）

| 问题                                                                                                                                                      | 影响                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 7 张新表无迁移：recommendation_traces, recipe_translations, dead_letter_jobs, daily_plan_items, recipe_ratings, strategy_tuning_log, replacement_patterns | `prisma migrate deploy` 在新环境/CI 无法创建这些表，代码运行时报错 |
| 3 字段无迁移：foods.commonality_score, foods.available_channels, recommendation_feedbacks.trace_id                                                        | 线上 DB 缺少字段，所有依赖这些字段的查询静默失败                   |
| 5 FK 无迁移：daily_plans/strategy_assignment/notification/user_behavior_profiles/weight_history                                                           | 数据完整性无约束，脏数据可能存入                                   |
| 向量索引（HNSW/IVFFlat）仅在代码中引用但未在 schema 或迁移中定义                                                                                          | VectorSearchService 引用了不存在的索引，pgvector 查询全表扫描      |

#### P0：未实现的 V6.5 关键特性

| 特性                                                                                        | 现状                                                                      | 影响                                 |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------ |
| SemanticRecallService                                                                       | VectorSearchService（V5）存在但未包装为召回阶段的独立服务，未接入推荐管道 | 推荐仍为纯规则召回，无语义相似性捕捉 |
| 5 个画像字段（sleepQuality/stressLevel/hydrationGoal/supplementsUsed/mealTimingPreference） | schema 无列、DTO 无字段、代码无引用                                       | 生活方式数据空白，无法做差异化推荐   |
| 替换反馈闭环                                                                                | A→B 替换有历史统计，但**未自动回流到主推荐评分管道**                      | 系统仍重复推荐用户反复替换的食物     |
| StrategyAutoTuner 持久化                                                                    | 内存 Map 更新，重启丢失                                                   | 每次重启后策略映射退回到硬编码默认值 |

#### P1：基础设施残余问题

| 问题                             | 影响                                                                                                            | 严重度 |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------ |
| @nestjs/throttler 内存存储       | 多实例部署下每个 Pod 独立限流，效果失效                                                                         | 中     |
| node-redis 单连接（非 ioredis）  | 高并发时单连接成为瓶颈，无连接池                                                                                | 中     |
| 健康检查无 BullMQ Worker 检测    | 队列 Worker 挂起时 /health 仍返回 OK                                                                            | 低     |
| MealCompositionScorer 缺数据字段 | flavor_tags/texture_category/color_category 不在 schema 中，MealCompositionScorer 仅用 flavor_profile JSON 估算 | 低     |

#### P2：推荐质量待提升

| 问题                                | 影响                                                           |
| ----------------------------------- | -------------------------------------------------------------- |
| 食堂渠道（canteen）缺失             | AcquisitionChannel 5 种无食堂，学校/企业用户场景缺失           |
| 场景推断缺乏"工作状态"检测          | 无 `working` 场景，DELIVERY 推断仅凭 takeoutFrequency 静态字段 |
| 解释风格有效性未追踪                | concise/coaching 分配基于 hash，无数据支持哪种风格接受率更高   |
| CF 冷启动 content-based fallback 弱 | 交互 <5 次用户仅靠热门兜底，无语义相似食物推荐                 |
| 无 Learned Ranking                  | SCORE_WEIGHTS 硬编码，非从反馈数据学习                         |

#### P3：商业化与扩展性

| 问题                        | 影响                                                |
| --------------------------- | --------------------------------------------------- |
| 无用户流失预测              | 无法主动挽留即将流失用户                            |
| 无 OpenTelemetry 分布式追踪 | 跨 Queue/Event 的调用链断裂，异步任务失败时无法溯源 |
| 无国际化基础设施            | recipe_translations 表已有但接口层无多语言切换逻辑  |
| 暴食干预无效果评估          | 推送干预提醒后未追踪行为是否改善                    |

---

## Step 2：核心升级方向

基于 V6.5 遗留问题和用户指定升级方向，确定 **9 个核心升级点**，按 Phase 1/2/3 分层：

### Phase 1：修复基础（工程可靠性）

#### 升级点 1：Schema/Migration 完整性修复

**为什么是 Phase 1 最高优先级：** 当前有 7 张表的代码依赖完全没有对应迁移，生产环境的数据库与 schema 定义不一致。这不是功能问题，而是**部署可靠性**问题——任何新环境部署都会失败。

**目标：** 生成完整的 V6.5 补丁迁移，覆盖所有 schema drift，确保 `prisma migrate deploy` 在任何环境都能成功。

#### 升级点 2：替换反馈闭环打通

**为什么需要：** V6.5 的 replacement_patterns 表已经收集 A→B 替换记录，但这些数据**没有回流到主推荐评分管道**。用户每次替换都是明确的偏好信号，却被白白浪费。

**目标：** 在 FoodScorerService 的评分中注入替换权重——被替换食物降权，替换目标食物增权。回流权重有衰减机制（最近的替换权重更高）。

#### 升级点 3：全局限流 Redis 化

**为什么需要：** @nestjs/throttler 内存存储在 Railway 多实例部署时每个 Pod 独立限流，用户实际可享受 N 倍配额（N = 实例数）。这是生产环境的真实漏洞。

**目标：** 为 @nestjs/throttler 配置 Redis-backed ThrottlerStorageRedisService，与现有 RedisCacheService 共享连接。

### Phase 2：推荐质量提升（场景化 + 语义化 + 可解释性）

#### 升级点 4：语义召回管道（SemanticRecallService）

**为什么需要：** V6.5 的 VectorSearchService 是一个 655 行的独立工具，从未被推荐引擎调用。现有召回完全基于规则过滤（营养目标 + 渠道 + 标签）。引入语义召回后，系统可以捕捉"用户喜欢鸡蛋→也可能喜欢豆腐"这类语义相似性，提升新用户和小众口味用户的召回质量。

**目标：** 将 VectorSearchService 包装为 SemanticRecallService，作为推荐管道中与规则召回并列的第二路召回源，最终混合排名。

#### 升级点 5：食堂渠道 + 场景深化

**为什么需要：** AcquisitionChannel 缺少 `CANTEEN`（食堂），但这是中国市场最大的用餐场景之一（学生、企业白领）。同时现有场景系统缺少"上班中"的状态感知，DELIVERY 渠道的推断仅靠静态 takeoutFrequency 字段。

**目标：**

- 新增 `CANTEEN` 渠道，适配食堂的选择特点（固定菜品、营养标注少、选项有限）
- 新增 `working` 场景辅助推断，基于工作日时段 + 手机使用模式
- 场景推断增加时间窗口感知（外卖平台营业时间段）

#### 升级点 6：5 个画像字段激活

**为什么需要：** sleepQuality/stressLevel/hydrationGoal/supplementsUsed/mealTimingPreference 是 V6.5 承诺激活但未实现的 5 个字段。这些字段采集成本已付，不激活就是资源浪费。其中 sleepQuality 和 stressLevel 与推荐决策高度相关（高压/睡眠不足 → 优先镁/色氨酸/B族维生素）。

**目标：** 补齐 schema 列、DTO 字段、API 写入逻辑，并在推荐评分中引入健康状态向量。

#### 升级点 7：可解释性增强（Explainable AI）

**为什么需要：** V6.5 的解释系统已有单食物 + 整餐 + 雷达图，但存在两个问题：(1) 解释风格（concise/coaching）是基于 FNV hash 分配的，没有数据支持哪种风格对哪类用户更有效；(2) 解释只解释"为什么推荐这个"，没有"为什么不推荐那个（反向解释）"和"为什么今天的推荐和昨天不同（变化解释）"。

**目标：**

- 解释风格 A/B 测试追踪（哪种风格对哪个分群接受率更高）
- 新增"变化解释"：今天推荐 X 而不是昨天的 Y，因为 Z 原因
- 新增"渠道解释"：基于你当前渠道（外卖/食堂），筛选了 N 个不可获取的选项
- 解释置信度分级：低数据量用户的解释标注"基于有限数据的推断"

### Phase 3：AI 化与国际化

#### 升级点 8：Learned Ranking 初步引入

**为什么需要：** 当前 SCORE_WEIGHTS 是人工调参的硬编码常量。V6.5 已有 recommendation_traces + feedbacks 数据，可以用来学习**哪些特征对哪类用户接受率影响最大**。这是从规则系统向 AI 驱动推荐的关键一步。

**目标（务实版）：**

- 基于历史数据，per-segment 计算最优权重向量（简单梯度下降或 LR 即可，无需神经网络）
- 权重存入 strategy.config（JSONB），每周重算一次
- 对比 learned weights vs. hardcoded weights 的 A/B 效果

#### 升级点 9：国际化基础设施

**为什么需要：** recipe_translations 表已有，food_translations 表已有，解释系统已有 zh/en/ja 三语言。但接口层无多语言切换逻辑（Accept-Language header 未处理），Admin 无翻译管理 UI。这些是商业化出海的基础。

**目标（Phase 3，不阻塞前两阶段）：**

- API 层 i18n 中间件：Accept-Language / user profile language 切换
- 推荐结果字段按语言返回（food name/description/explanation）
- 国际化缺失度指标：哪些食物/菜谱缺少 en 翻译

---

## Step 3：架构升级设计

### 3.1 推荐管道架构演进

V6.5 推荐管道为**单路召回**（规则过滤）→ 排名 → 重排：

```
用户请求
  → ProfileResolver (5层画像聚合)
  → RuleBasedRecall (营养目标 + 渠道 + 标签过滤)
  → RealisticFilter (commonality + budget + cookTime)
  → FoodScorer (12维评分)
  → MealCompositionScorer (组合rerank)
  → ExplanationGenerator
  → 返回
```

V6.6 升级为**双路召回混合**，引入语义召回：

```
用户请求
  → ProfileResolver (5层画像聚合 + 5个新生活方式字段)
  → [并行召回]
      ├── RuleBasedRecall (规则过滤，主路)
      └── SemanticRecallService (向量相似性，辅路)
  → RecallMerger (去重 + 来源标记)
  → RealisticFilter (commonality + budget + cookTime + 渠道时间窗口)
  → FoodScorer (12维评分 + 替换权重注入 + 生活方式向量)
  → LearnedRankingAdjuster (per-segment 学习权重，Phase 3 可选)
  → MealCompositionScorer (组合rerank)
  → ExplanationGenerator (+ 变化解释 + 渠道解释 + 置信度分级)
  → 返回
```

### 3.2 新增组件与现有组件关系

```
diet.module.ts
├── [已有] RuleBasedRecall (食物池缓存+规则过滤)
├── [已有] RealisticFilterService        (V6.5 Phase 1D)
├── [已有] FoodScorerService             (12维，V6.5)
├── [已有] MealCompositionScorer         (V6.5 Phase 2C)
├── [已有] ExplanationGeneratorService   (V6.5 升级版)
├── [已有] ReplacementPatternService     (V6.5 Phase 1F，追踪)
├── [NEW]  SemanticRecallService         (包装VectorSearchService，混合召回)
├── [NEW]  RecallMergerService           (双路召回去重 + 来源权重)
├── [NEW]  LifestyleScoringAdapter       (5个新画像字段→评分调整向量)
├── [NEW]  ReplacementFeedbackInjector   (替换模式→FoodScorer权重注入)
├── [NEW]  ExplanationABTracker          (解释风格效果追踪)
└── [NEW]  LearnedRankingService         (Phase 3，per-segment权重优化)

strategy.module.ts
├── [已有] StrategyAutoTuner             (V6.5 Phase 2F，内存)
└── [UPGRADE] StrategyAutoTuner         (新增DB持久化，重启不丢失)

core/
├── [已有] CircuitBreakerService
├── [已有] DeadLetterService
├── [已有] QueueResilienceService
├── [已有] MetricsService
├── [UPGRADE] RedisThrottlerStorage     (替换@nestjs/throttler内存存储)
└── [NEW]  I18nMiddleware               (Phase 3，语言切换)

prisma/migrations/
└── [NEW]  V6.5 补丁迁移 (7表+3字段+5FK+2向量索引)
```

### 3.3 数据流变化

#### 双路召回合并策略

```typescript
interface RecallCandidate {
  food: FoodPoolItem;
  recallSource: 'rule' | 'semantic' | 'both';
  semanticScore?: number; // 0-1，仅语义路存在
  ruleScore?: number; // 召回时的初始分，仅规则路存在
}

// 合并策略：
// 1. 两路均有 → source='both'，保留，语义分作为额外 boost
// 2. 仅规则路 → source='rule'，保留
// 3. 仅语义路 → source='semantic'，保留但最终权重 ×0.7（语义路补充，不主导）
// 4. 去重基于 food_id
```

#### 替换权重注入策略

```typescript
// ReplacementFeedbackInjector 在 FoodScorer 调用前注入
interface ReplacementWeight {
  foodId: string;
  multiplier: number; // 0.7(降权) ~ 1.15(增权)
  reason: 'replaced_from' | 'replaced_to';
  decayFactor: number; // 最近30天的替换权重衰减
}

// 替换权重注入到 FoodScorerService.scoreFood() 的 boost 阶段
// 独立于 12 维评分，作为第 13 层 Boost（命名 replacementPatternBoost）
```

#### 生活方式向量

```typescript
// LifestyleScoringAdapter 生成调整向量
interface LifestyleAdjustment {
  sleepQuality: 'poor' | 'fair' | 'good'; // 影响: 色氨酸/镁优先级
  stressLevel: 'low' | 'medium' | 'high'; // 影响: 抗氧化/B族维生素优先级
  hydrationGoal: number; // 影响: 高含水量食物加分
  supplementsUsed: string[]; // 影响: 避免与补剂重叠的营养素
  mealTimingPreference: string; // 影响: 餐次热量分配权重
}

// 转为 nutrientPriorityVector，叠加到 NutritionTargetService 的 nutritionGaps
```

---

## Step 4：模块级升级设计

### 4.1 Migration 补丁（Phase 1-A，最高优先级）

**文件：** `prisma/migrations/20260412000000_v65_schema_patch/migration.sql`

涵盖：

- 7 张新表的 CREATE TABLE
- 3 个新字段的 ALTER TABLE ADD COLUMN
- 5 个 FK 的 ALTER TABLE ADD CONSTRAINT
- HNSW 向量索引

```sql
-- ==================================================
-- 1. 新增字段到已有表
-- ==================================================

-- foods 表
ALTER TABLE "foods"
  ADD COLUMN IF NOT EXISTS "commonality_score" INTEGER NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS "available_channels" JSONB NOT NULL DEFAULT '[]';

CREATE INDEX IF NOT EXISTS "idx_foods_commonality"
  ON "foods"("commonality_score");

-- recommendation_feedbacks 表
ALTER TABLE "recommendation_feedbacks"
  ADD COLUMN IF NOT EXISTS "trace_id" TEXT;

CREATE INDEX IF NOT EXISTS "idx_rec_feedbacks_trace_id"
  ON "recommendation_feedbacks"("trace_id");

-- ==================================================
-- 2. 新增表
-- ==================================================

CREATE TABLE IF NOT EXISTS "recommendation_traces" (
  "id"                TEXT NOT NULL,
  "user_id"           TEXT NOT NULL,
  "meal_type"         TEXT NOT NULL,
  "goal_type"         TEXT NOT NULL,
  "channel"           TEXT NOT NULL DEFAULT 'unknown',
  "strategy_id"       TEXT,
  "strategy_version"  INTEGER,
  "experiment_id"     TEXT,
  "group_id"          TEXT,
  "pipeline_snapshot" JSONB NOT NULL DEFAULT '{}',
  "top_foods"         JSONB NOT NULL DEFAULT '[]',
  "score_stats"       JSONB NOT NULL DEFAULT '{}',
  "food_pool_size"    INTEGER NOT NULL DEFAULT 0,
  "filters_applied"   JSONB NOT NULL DEFAULT '[]',
  "duration_ms"       INTEGER NOT NULL DEFAULT 0,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "recommendation_traces_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_rec_traces_user_created"
  ON "recommendation_traces"("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "idx_rec_traces_strategy"
  ON "recommendation_traces"("strategy_id");
CREATE INDEX IF NOT EXISTS "idx_rec_traces_experiment"
  ON "recommendation_traces"("experiment_id");
CREATE INDEX IF NOT EXISTS "idx_rec_traces_channel"
  ON "recommendation_traces"("channel");
CREATE INDEX IF NOT EXISTS "idx_rec_traces_created"
  ON "recommendation_traces"("created_at" DESC);

CREATE TABLE IF NOT EXISTS "recipe_translations" (
  "id"          TEXT NOT NULL,
  "recipe_id"   TEXT NOT NULL,
  "locale"      TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "steps"       JSONB NOT NULL DEFAULT '[]',
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "recipe_translations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_recipe_translation_recipe_locale" UNIQUE ("recipe_id", "locale")
);

CREATE INDEX IF NOT EXISTS "idx_recipe_translations_locale"
  ON "recipe_translations"("locale");

ALTER TABLE "recipe_translations"
  ADD CONSTRAINT "fk_recipe_translations_recipe"
  FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "dead_letter_jobs" (
  "id"              TEXT NOT NULL,
  "queue_name"      TEXT NOT NULL,
  "job_id"          TEXT NOT NULL,
  "job_data"        JSONB NOT NULL DEFAULT '{}',
  "error_message"   TEXT NOT NULL,
  "attempts_made"   INTEGER NOT NULL DEFAULT 0,
  "status"          TEXT NOT NULL DEFAULT 'pending',
  "failed_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "retried_at"      TIMESTAMPTZ(6),
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "dead_letter_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_dlj_queue_status"
  ON "dead_letter_jobs"("queue_name", "status");
CREATE INDEX IF NOT EXISTS "idx_dlj_failed_at"
  ON "dead_letter_jobs"("failed_at" DESC);

CREATE TABLE IF NOT EXISTS "daily_plan_items" (
  "id"          TEXT NOT NULL,
  "plan_id"     TEXT NOT NULL,
  "meal_type"   TEXT NOT NULL,
  "food_id"     TEXT,
  "recipe_id"   TEXT,
  "quantity"    DOUBLE PRECISION NOT NULL DEFAULT 1,
  "unit"        TEXT NOT NULL DEFAULT 'serving',
  "position"    INTEGER NOT NULL DEFAULT 0,
  "created_at"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "daily_plan_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_dpi_plan_meal"
  ON "daily_plan_items"("plan_id", "meal_type");
CREATE INDEX IF NOT EXISTS "idx_dpi_food"
  ON "daily_plan_items"("food_id");
CREATE INDEX IF NOT EXISTS "idx_dpi_recipe"
  ON "daily_plan_items"("recipe_id");

CREATE TABLE IF NOT EXISTS "recipe_ratings" (
  "id"         TEXT NOT NULL,
  "recipe_id"  TEXT NOT NULL,
  "user_id"    TEXT NOT NULL,
  "rating"     INTEGER NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "recipe_ratings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_recipe_rating_recipe_user" UNIQUE ("recipe_id", "user_id"),
  CONSTRAINT "chk_recipe_ratings_range" CHECK ("rating" >= 1 AND "rating" <= 5)
);

CREATE INDEX IF NOT EXISTS "idx_recipe_ratings_user"
  ON "recipe_ratings"("user_id");
CREATE INDEX IF NOT EXISTS "idx_recipe_ratings_recipe"
  ON "recipe_ratings"("recipe_id");

ALTER TABLE "recipe_ratings"
  ADD CONSTRAINT "fk_recipe_ratings_recipe"
  FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS "strategy_tuning_log" (
  "id"                TEXT NOT NULL,
  "segment_name"      TEXT NOT NULL,
  "previous_strategy" TEXT NOT NULL,
  "new_strategy"      TEXT NOT NULL,
  "previous_rate"     DOUBLE PRECISION NOT NULL DEFAULT 0,
  "new_rate"          DOUBLE PRECISION NOT NULL DEFAULT 0,
  "improvement"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "auto_applied"      BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "strategy_tuning_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "idx_stl_segment"
  ON "strategy_tuning_log"("segment_name");
CREATE INDEX IF NOT EXISTS "idx_stl_created"
  ON "strategy_tuning_log"("created_at" DESC);

CREATE TABLE IF NOT EXISTS "replacement_patterns" (
  "id"             TEXT NOT NULL,
  "user_id"        TEXT NOT NULL,
  "from_food_id"   TEXT NOT NULL,
  "from_food_name" TEXT NOT NULL,
  "to_food_id"     TEXT NOT NULL,
  "to_food_name"   TEXT NOT NULL,
  "frequency"      INTEGER NOT NULL DEFAULT 1,
  "last_occurred"  TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "replacement_patterns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "uq_replacement_patterns_user_from_to"
    UNIQUE ("user_id", "from_food_id", "to_food_id")
);

CREATE INDEX IF NOT EXISTS "idx_rp_user"
  ON "replacement_patterns"("user_id");
CREATE INDEX IF NOT EXISTS "idx_rp_from_food"
  ON "replacement_patterns"("from_food_id");

-- ==================================================
-- 3. FK 补齐（已存在的表）
-- ==================================================

-- 只在 FK 不存在时添加，使用 DO $$ ... $$ 保证幂等
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_daily_plans_user'
  ) THEN
    ALTER TABLE "daily_plans"
      ADD CONSTRAINT "fk_daily_plans_user"
      FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_strategy_assignment_user'
  ) THEN
    ALTER TABLE "strategy_assignment"
      ADD CONSTRAINT "fk_strategy_assignment_user"
      FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_notification_user'
  ) THEN
    ALTER TABLE "notifications"
      ADD CONSTRAINT "fk_notification_user"
      FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_behavior_profiles_user'
  ) THEN
    ALTER TABLE "user_behavior_profiles"
      ADD CONSTRAINT "fk_behavior_profiles_user"
      FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_weight_history_user'
  ) THEN
    ALTER TABLE "weight_history"
      ADD CONSTRAINT "fk_weight_history_user"
      FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- ==================================================
-- 4. 向量索引（pgvector HNSW）
-- ==================================================
-- 需先确认 pgvector 扩展已安装（Railway/Vercel Postgres 均支持）
CREATE EXTENSION IF NOT EXISTS vector;

CREATE INDEX IF NOT EXISTS "idx_foods_embedding_hnsw"
  ON "foods" USING hnsw (embedding_v5 vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

**Data Backfill：**

```sql
-- commonality_score 初始值回填（基于 popularity 字段估算，分桶映射）
UPDATE "foods"
SET "commonality_score" = CASE
  WHEN "popularity" >= 80 THEN 85
  WHEN "popularity" >= 60 THEN 70
  WHEN "popularity" >= 40 THEN 55
  WHEN "popularity" >= 20 THEN 35
  ELSE 20
END
WHERE "commonality_score" = 50; -- 只更新默认值
```

---

### 4.2 SemanticRecallService（Phase 2-A）

**文件：** `apps/api-server/src/modules/diet/app/recommendation/semantic-recall.service.ts`

**核心逻辑：**

```typescript
@Injectable()
export class SemanticRecallService {
  constructor(
    private readonly vectorSearch: VectorSearchService,
    private readonly redisCache: RedisCacheService
  ) {}

  /**
   * 基于用户口味偏好向量，召回语义相似的候选食物
   * 仅作为辅路召回，输出会经 RecallMerger 与规则路合并
   */
  async recall(
    userId: string,
    tasteEmbedding: number[], // 来自 ProfileResolver 的口味向量
    options: SemanticRecallOptions
  ): Promise<SemanticRecallResult[]> {
    const cacheKey = `semantic_recall:${userId}:${options.goalType}:${options.mealType}`;
    const cached = await this.redisCache.get<SemanticRecallResult[]>(cacheKey);
    if (cached) return cached;

    // VectorSearchService 的 findSimilarFoods()，限制 topK * 2 后过滤
    const candidates = await this.vectorSearch.findSimilarFoods(
      tasteEmbedding,
      options.topK * 2, // 多取一倍，过滤后保留 topK
      options.filters
    );

    // 过滤：排除禁忌食物、过敏原、status != 'approved'
    const filtered = candidates
      .filter((c) => !options.excludedFoodIds.has(c.food_id))
      .filter((c) => !this.hasAllergenConflict(c, options.allergens))
      .slice(0, options.topK);

    const result: SemanticRecallResult[] = filtered.map((c) => ({
      food: c.food,
      semanticScore: c.similarity, // 0-1
      recallSource: 'semantic' as const,
    }));

    await this.redisCache.set(cacheKey, result, 300); // 5分钟缓存
    return result;
  }
}
```

**RecallMergerService：**

```typescript
@Injectable()
export class RecallMergerService {
  merge(
    ruleCandidates: FoodPoolItem[],
    semanticCandidates: SemanticRecallResult[]
  ): MergedCandidate[] {
    const merged = new Map<string, MergedCandidate>();

    // 规则路全量加入
    for (const food of ruleCandidates) {
      merged.set(food.id, { food, source: 'rule', semanticScore: 0, ruleWeight: 1.0 });
    }

    // 语义路：已有 → 升级 source='both'，新增 → source='semantic'，权重 0.7
    for (const sem of semanticCandidates) {
      if (merged.has(sem.food.id)) {
        const existing = merged.get(sem.food.id)!;
        existing.source = 'both';
        existing.semanticScore = sem.semanticScore;
      } else {
        merged.set(sem.food.id, {
          food: sem.food,
          source: 'semantic',
          semanticScore: sem.semanticScore,
          ruleWeight: 0.7, // 语义补充路权重折扣
        });
      }
    }

    return Array.from(merged.values());
  }
}
```

**接入推荐引擎：** 在 `recommendation-engine.service.ts` 的 Recall 阶段，与现有 FoodPoolCacheService 并行调用，结果经 RecallMergerService 合并后传入 RealisticFilterService。

---

### 4.3 ReplacementFeedbackInjector（Phase 2-B）

**文件：** `apps/api-server/src/modules/diet/app/recommendation/replacement-feedback-injector.service.ts`

**功能：** 从 replacement_patterns 表读取当前用户的 A→B 替换记录，生成权重 Map，注入 FoodScorerService。

```typescript
@Injectable()
export class ReplacementFeedbackInjectorService {
  private readonly REPLACED_FROM_MULTIPLIER = 0.8; // 被替换食物降权 20%
  private readonly REPLACED_TO_MULTIPLIER = 1.12; // 替换目标增权 12%
  private readonly DECAY_DAYS = 30; // 超过30天的替换衰减

  async getWeightMap(userId: string): Promise<Map<string, number>> {
    const patterns = await this.prisma.replacementPatterns.findMany({
      where: {
        userId,
        lastOccurred: { gte: subDays(new Date(), 90) }, // 90天内
        frequency: { gte: 2 }, // 至少替换2次
      },
    });

    const weightMap = new Map<string, number>();

    for (const p of patterns) {
      // 时间衰减：最近30天的替换满权重，之后线性衰减到60%
      const daysSince = differenceInDays(new Date(), p.lastOccurred);
      const decayFactor =
        daysSince <= this.DECAY_DAYS
          ? 1.0
          : Math.max(0.6, 1.0 - (daysSince - this.DECAY_DAYS) / 60);

      // 被替换的食物降权（权重叠加，多次替换不超过 0.65）
      const fromMultiplier = weightMap.get(p.fromFoodId) ?? 1.0;
      weightMap.set(
        p.fromFoodId,
        Math.max(0.65, fromMultiplier * this.REPLACED_FROM_MULTIPLIER * decayFactor)
      );

      // 替换目标增权（权重叠加，不超过 1.25）
      const toMultiplier = weightMap.get(p.toFoodId) ?? 1.0;
      weightMap.set(
        p.toFoodId,
        Math.min(1.25, toMultiplier * this.REPLACED_TO_MULTIPLIER * decayFactor)
      );
    }

    return weightMap;
  }
}
```

**在 FoodScorerService 中接入：**

在 `scoreFood()` 的 Boost 计算阶段末尾，新增 Phase 13 Boost：

```typescript
// Phase 13: Replacement Pattern Boost (V6.6)
const replacementMultiplier = this.replacementWeightMap?.get(food.id) ?? 1.0;
finalScore *= replacementMultiplier;
```

`replacementWeightMap` 由 `recommendation-engine.service.ts` 在管道开始时（ProfileResolver 之后）调用 `ReplacementFeedbackInjectorService.getWeightMap()` 获取，传入 FoodScorer 的 context 参数。

---

### 4.4 LifestyleScoringAdapter（Phase 2-C）

**目标：** 将 sleepQuality / stressLevel / hydrationGoal / supplementsUsed / mealTimingPreference 5 个新字段接入评分管道。

**Schema 变更（放入 V6.6 独立迁移）：**

```sql
-- 新增到 user_profiles 表
ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "sleep_quality"            TEXT,     -- 'poor'|'fair'|'good'
  ADD COLUMN IF NOT EXISTS "stress_level"             TEXT,     -- 'low'|'medium'|'high'
  ADD COLUMN IF NOT EXISTS "hydration_goal"           INTEGER,  -- 每日目标饮水 ml
  ADD COLUMN IF NOT EXISTS "supplements_used"         JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "meal_timing_preference"   TEXT;     -- 'early_bird'|'standard'|'late_eater'
```

**DTO 变更：** 在 `UpdateDeclaredProfileDto` 中新增 5 个可选字段。

**LifestyleScoringAdapter 逻辑：**

```typescript
@Injectable()
export class LifestyleScoringAdapter {
  /**
   * 将生活方式字段转换为营养素优先级向量
   * 叠加到 NutritionTargetService 输出的 nutritionGaps
   */
  adapt(profile: DeclaredProfile): LifestyleNutrientAdjustment {
    const adjustments: LifestyleNutrientAdjustment = {};

    // 睡眠质量差 → 提高色氨酸/镁/B6 优先级
    if (profile.sleepQuality === 'poor') {
      adjustments['tryptophan'] = (adjustments['tryptophan'] ?? 0) + 0.15;
      adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.1;
      adjustments['vitaminB6'] = (adjustments['vitaminB6'] ?? 0) + 0.1;
    }

    // 高压状态 → 提高抗氧化维生素/B族维生素优先级
    if (profile.stressLevel === 'high') {
      adjustments['vitaminC'] = (adjustments['vitaminC'] ?? 0) + 0.12;
      adjustments['vitaminB12'] = (adjustments['vitaminB12'] ?? 0) + 0.08;
      adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.08;
    }

    // 补剂已服用 → 避免重叠推高（下调对应营养素优先级）
    for (const supplement of profile.supplementsUsed ?? []) {
      const nutrient = SUPPLEMENT_NUTRIENT_MAP[supplement];
      if (nutrient) {
        adjustments[nutrient] = (adjustments[nutrient] ?? 0) - 0.1;
      }
    }

    // 饮水目标 → 高含水量食物（含水率 > 80%）加分
    if (profile.hydrationGoal && profile.hydrationGoal > 2000) {
      adjustments['waterContent'] = 0.08; // 食物含水量评分维度加权
    }

    return adjustments;
  }
}
```

**接入方式：** 在 ProfileResolverService 的 `resolve()` 输出的 `EnrichedProfileContext` 中新增 `lifestyleAdjustment` 字段，由 NutritionScorerService 在计算 nutritionGaps 时叠加。

---

### 4.5 CANTEEN 渠道（Phase 2-D）

**AcquisitionChannel 枚举扩展：**

```typescript
// recommendation.types.ts 中新增
CANTEEN = 'canteen', // 食堂/团餐
```

**推断逻辑扩展（inferAcquisitionChannel 新增分支）：**

```typescript
// 食堂推断：用户明确标注 canteen，或时段为工作日午餐 + 未开启外卖
if (declaredProfile.primaryEatingLocation === 'canteen') {
  return AcquisitionChannel.CANTEEN;
}
```

**食堂渠道特点（差异化评分策略）：**

```typescript
// RealismConfig 新增 canteenMode 标志
// 食堂模式下：
// 1. commonality_score 阈值提高到 60（只推荐非常常见的菜品）
// 2. cookTimeCap 不适用（无烹饪成本）
// 3. 食材组合多样性评分权重降低（食堂菜品固定，无组合选择）
// 4. 优先推荐有食堂常见标签的食物（tags 含 'canteen_common'）
```

**available_channels 枚举值补充：** 在食物数据的 available_channels JSONB 字段中增加 `'canteen'` 选项（由 Admin 后台或数据脚本批量标注）。

---

### 4.6 可解释性增强（Phase 2-E）

#### 解释风格 A/B 追踪

**新增 ExplanationABTrackerService：**

```typescript
@Injectable()
export class ExplanationABTrackerService {
  /**
   * 记录解释风格与后续接受/跳过行为的关联
   * 每周分析哪种风格对哪个分群接受率更高
   */
  async trackExplanationOutcome(
    userId: string,
    traceId: string,
    explanationStyle: 'concise' | 'coaching',
    outcome: 'accepted' | 'replaced' | 'skipped'
  ): Promise<void> {
    // 写入 recommendation_traces 的 pipeline_snapshot.explanationStyle 字段
    // 结合 recommendation_feedbacks 的 action 字段，后续 StrategyEffectivenessService 可查询
  }

  /**
   * 每周 Cron：计算各分群最优解释风格
   * 输出写入 strategy.config.explain.preferredStyle per segment
   */
  @Cron('0 5 * * 1')
  async analyzeExplanationEffectiveness(): Promise<void> {
    // 按 user_segment × explanation_style 分组计算接受率
    // 接受率差异 > 10% 且样本 > 50 则自动切换该分群的默认风格
  }
}
```

#### 变化解释（Delta Explanation）

在 ExplanationGeneratorService 新增方法：

```typescript
/**
 * 变化解释：今天推荐 X，昨天推荐 Y，解释为什么变了
 * 仅在今日推荐与昨日显著不同时生成
 */
async generateDeltaExplanation(
  todayTop: FoodItem[],
  yesterdayTop: FoodItem[],
  profile: EnrichedProfileContext,
): Promise<DeltaExplanation | null> {
  const newFoods = todayTop.filter(f => !yesterdayTop.some(y => y.id === f.id));
  if (newFoods.length === 0) return null;

  // 找出主要变化原因（营养缺口变化、场景变化、策略刷新）
  return {
    changedFoods: newFoods.map(f => f.name),
    primaryReason: this.detectChangeReason(profile, yesterdayTop, todayTop),
    confidence: profile.dataQuality > 0.6 ? 'high' : 'low',
  };
}
```

#### 渠道解释

```typescript
/**
 * 渠道过滤解释：因为当前渠道是外卖，过滤了 N 个需要自己做的菜品
 */
generateChannelFilterExplanation(
  channel: AcquisitionChannel,
  filteredCount: number,
): string {
  const channelNames = {
    [AcquisitionChannel.DELIVERY]: '外卖',
    [AcquisitionChannel.HOME_COOK]: '自己做',
    [AcquisitionChannel.CANTEEN]: '食堂',
    [AcquisitionChannel.CONVENIENCE]: '便利店',
    [AcquisitionChannel.RESTAURANT]: '餐厅',
  };
  return `基于你当前的${channelNames[channel]}场景，已筛除 ${filteredCount} 个不适合的选项`;
}
```

---

### 4.7 StrategyAutoTuner 持久化（Phase 2-F）

**问题：** 当前 StrategyAutoTuner 的调优结果仅修改内存中的 `SEGMENT_STRATEGY_MAP`，重启后丢失。

**解决方案：** 将调优结果写入 DB，启动时从 DB 恢复最新映射。

```typescript
// strategy-auto-tuner.service.ts 修改

// 1. 启动时从 strategy_tuning_log 恢复最新映射
async onModuleInit(): Promise<void> {
  const latestApplied = await this.prisma.strategyTuningLog.findMany({
    where: { autoApplied: true },
    orderBy: { createdAt: 'desc' },
    // 每个 segment 只取最新一条
  });

  for (const log of latestApplied) {
    if (!this.recoveredSegments.has(log.segmentName)) {
      SEGMENT_STRATEGY_MAP[log.segmentName] = log.newStrategy;
      this.recoveredSegments.add(log.segmentName);
    }
  }
  this.logger.log(`StrategyAutoTuner: 从 DB 恢复了 ${this.recoveredSegments.size} 个分群的策略映射`);
}

// 2. autoApplied=true 的条目写入时同时更新 SEGMENT_STRATEGY_MAP（已有）
// 3. 重启后 onModuleInit 读取最新条目并恢复
```

---

### 4.8 全局限流 Redis 化（Phase 1-B）

**依赖：** `@nestjs-throttler/storage-redis`

**app.module.ts 修改：**

```typescript
// 安装: pnpm add @nestjs-throttler/storage-redis
import { ThrottlerStorageRedisService } from '@nestjs-throttler/storage-redis';

ThrottlerModule.forRootAsync({
  imports: [RedisModule],
  inject: [RedisCacheService],
  useFactory: (redisCache: RedisCacheService) => ({
    throttlers: THROTTLE_CONFIG,
    storage: new ThrottlerStorageRedisService(redisCache.getClient()),
    // 注意：getClient() 需在 RedisCacheService 中新增，返回底层 redis client
  }),
}),
```

**注意事项：** 当前 RedisCacheService 使用 node-redis，而 ThrottlerStorageRedisService 期望 ioredis 实例。V6.6 同步将 RedisCacheService 迁移到 ioredis（见 4.9）。

---

### 4.9 Redis 连接池化（Phase 1-C）

**问题：** 当前使用 node-redis v5 单连接（`createClient`），不支持连接池。`@nestjs/throttler` Redis 存储和 BullMQ 均依赖 ioredis。

**迁移方案：**

```typescript
// redis-cache.service.ts 迁移到 ioredis
import Redis from 'ioredis';

// 替换:
// this.client = createClient({ url, ... })

// 改为:
this.client = new Redis({
  host: config.host,
  port: config.port,
  password: config.password,
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  // 连接池（通过 ioredis Cluster 或 LazyConnect 模式）
  lazyConnect: false,
  connectTimeout: 5000,
  commandTimeout: 2000,
  retryStrategy: (times) => Math.min(times * 100, 3000),
});
```

**影响评估：** ioredis API 与 node-redis 基本相同（`get`/`set`/`del`/`incr`/`expire` 命令），但返回类型略有差异（node-redis 某些命令返回 null，ioredis 返回 null 或 undefined）。需全局搜索 `this.client.` 调用并验证类型兼容性。

**公开 getClient() 方法：**

```typescript
getClient(): Redis {
  return this.client;
}
```

供 ThrottlerStorageRedisService 和其他需要原生 ioredis 客户端的服务使用。

---

### 4.10 Learned Ranking 初步引入（Phase 3-A）

> Phase 3，不阻塞 Phase 1/2 发布，独立 feature flag 控制。

**LearnedRankingService 核心逻辑：**

```typescript
@Injectable()
export class LearnedRankingService {
  /**
   * 基于历史 acceptance rate，per-segment 学习最优权重向量
   * 每周重算，结果缓存到 Redis 和 strategy.config.rank.learnedWeights
   */
  @Cron('0 6 * * 1') // 周一 06:00，晚于 StrategyAutoTuner (04:00)
  async recomputeWeights(): Promise<void> {
    for (const segment of USER_SEGMENTS) {
      const samples = await this.collectSamples(segment); // 近30天的 trace + feedback
      if (samples.length < MIN_SAMPLES) continue; // 样本不足跳过

      const learnedWeights = this.fitWeights(samples);
      await this.saveWeights(segment, learnedWeights);
    }
  }

  /**
   * 简单梯度下降：最小化 (predicted_score - actual_accepted) 的 L2 损失
   * 无需神经网络，线性回归即可
   */
  private fitWeights(samples: RankingSample[]): number[] {
    // 12维权重向量的梯度下降优化
    // 约束：所有权重 >= 0，权重之和 = 1
    // 最大迭代 1000 次，学习率 0.001
  }
}
```

**Feature Flag 控制：**

```typescript
// 通过现有 feature_flags 表控制是否启用 learned ranking
// feature_key: 'learned_ranking_enabled'
// 默认 false，Phase 3 灰度开放
const useLearnedWeights = await this.featureFlagService.isEnabled(
  'learned_ranking_enabled',
  userId
);
```

---

### 4.11 国际化基础（Phase 3-B）

**I18nMiddleware：**

```typescript
// core/i18n/i18n.middleware.ts
@Injectable()
export class I18nMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // 优先级：query ?lang= > Accept-Language header > user profile language > 默认 zh
    const lang =
      req.query.lang || req.headers['accept-language']?.split(',')[0]?.split('-')[0] || 'zh';
    req['locale'] = SUPPORTED_LOCALES.includes(lang) ? lang : 'zh';
    next();
  }
}
```

**推荐结果多语言：**

在 RecommendationEngine 输出时，根据 `req.locale` 从 food_translations / recipe_translations 读取对应语言的名称和描述，无翻译时回退到中文（zh）。

**国际化覆盖率指标（MetricsService 新增）：**

```typescript
// Prometheus Gauge: i18n_coverage_ratio{locale, model}
// 每天统计 foods/recipes 中有 en/ja 翻译的比例
// 用于 Admin 仪表盘展示国际化欠账
```

---

## Step 5：技术路线图

### Phase 1：工程基础修复（1-2 周）

优先级最高，确保生产环境稳定：

| 编号  | 任务                                                  | 涉及文件                                                          | 估时 |
| ----- | ----------------------------------------------------- | ----------------------------------------------------------------- | ---- |
| 1-A   | 生成 V6.5 Schema 补丁迁移（7表+3字段+5FK+HNSW索引）   | `prisma/migrations/20260412000000_v65_schema_patch/migration.sql` | 4h   |
| 1-A.1 | commonality_score 历史数据回填脚本                    | `scripts/v6.6/backfill_commonality_scores.sql`                    | 1h   |
| 1-B   | @nestjs/throttler Redis 化 + ioredis 迁移             | `core/redis/redis-cache.service.ts`, `app.module.ts`              | 6h   |
| 1-C   | StrategyAutoTuner 启动恢复（onModuleInit 从 DB 读取） | `strategy/app/strategy-auto-tuner.service.ts`                     | 2h   |
| 1-D   | 健康检查补充 BullMQ Worker 活性检测                   | `health/health.controller.ts`                                     | 2h   |

**Phase 1 验收标准：**

- `prisma migrate deploy` 在空数据库上能完整执行
- 多实例部署时 `/api/health` 验证所有限流均基于 Redis
- StrategyAutoTuner 重启后映射从 DB 恢复，而非回退硬编码

---

### Phase 2：推荐质量提升（3-5 周）

| 编号  | 任务                                                                     | 涉及文件                                                                                                                                      | 估时 |
| ----- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ---- | -------------- |
| 2-A   | SemanticRecallService 实现 + RecallMergerService                         | `diet/app/recommendation/semantic-recall.service.ts`, `recall-merger.service.ts`                                                              | 8h   |
| 2-A.1 | 接入 recommendation-engine.service.ts（双路并行召回）                    | `diet/app/recommendation/recommendation-engine.service.ts`                                                                                    | 4h   |
| 2-B   | ReplacementFeedbackInjectorService 实现 + FoodScorer 第 13 层 Boost 接入 | `diet/app/recommendation/replacement-feedback-injector.service.ts`, `food-scorer.service.ts`                                                  | 6h   |
| 2-C   | 5 个画像字段 Schema 迁移 + DTO + API                                     | `prisma/migrations/20260412010000_v66_lifestyle_fields/migration.sql`, `user/app/dto/user-profile.dto.ts`, `user/app/user-profile.service.ts` | 6h   |
| 2-C.1 | LifestyleScoringAdapter 实现 + ProfileResolver 接入                      | `diet/app/recommendation/lifestyle-scoring-adapter.service.ts`, `user/app/profile-resolver.service.ts`                                        | 6h   |
| 2-D   | CANTEEN 渠道枚举 + 推断逻辑 + RealismConfig 食堂模式                     | `diet/app/recommendation/recommendation.types.ts`, `realistic-filter.service.ts`                                                              | 4h   |
| 2-E   | ExplanationABTrackerService + 变化解释 + 渠道解释                        | `diet/app/recommendation/explanation-ab-tracker.service.ts`, `explanation-generator.service.ts`                                               | 8h   |
| 2-F   | StrategyAutoTuner 持久化（onModuleInit 恢复）                            | `strategy/app/strategy-auto-tuner.service.ts`                                                                                                 | 2h   | （已含在 1-C） |

**Phase 2 验收标准：**

- 推荐日志中出现 `recall_source: 'semantic'` 的候选食物（语义路有召回）
- 用户有 ≥2 次替换记录时，被替换食物在同次推荐中分数降低 ≥15%
- API `/user-profile` PATCH 接受 sleepQuality/stressLevel 字段
- 带 CANTEEN 渠道的请求不触发烹饪时间过滤

---

### Phase 3：AI 化与国际化（6-10 周）

| 编号  | 任务                                            | 涉及文件                                                           | 估时 |
| ----- | ----------------------------------------------- | ------------------------------------------------------------------ | ---- |
| 3-A   | LearnedRankingService + 周 Cron 权重优化        | `diet/app/recommendation/learned-ranking.service.ts`               | 16h  |
| 3-A.1 | feature_flag 灰度控制 + Admin A/B 视图          | `feature-flag/`                                                    | 4h   |
| 3-B   | I18nMiddleware + 推荐结果多语言                 | `core/i18n/i18n.middleware.ts`, `recommendation-engine.service.ts` | 10h  |
| 3-B.1 | Admin 国际化覆盖率仪表盘 + 缺失翻译列表         | `admin/`                                                           | 6h   |
| 3-C   | OpenTelemetry 分布式追踪（跨 Queue/Event 链路） | `core/telemetry/`                                                  | 12h  |
| 3-D   | 用户流失预测模型（基于 user_behavior_profiles） | `user/app/churn-prediction.service.ts`                             | 16h  |

---

### 时间线总览

```
Week 1:   [1-A] Schema 补丁迁移 + 数据回填
Week 2:   [1-B] Redis 限流 + ioredis 迁移
          [1-C] StrategyAutoTuner 持久化
          [1-D] 健康检查补充
Week 3:   [2-A] SemanticRecallService + RecallMerger
Week 4:   [2-B] ReplacementFeedbackInjector
          [2-C] 5个画像字段激活
Week 5:   [2-C.1] LifestyleScoringAdapter
          [2-D] CANTEEN 渠道
          [2-E] 解释增强
Week 6+:  [3-A~3-D] Phase 3 各项，独立特性开关控制
```

---

## Step 6：数据迁移

### 6.1 V6.5 补丁迁移（最高优先级）

**迁移文件：** `prisma/migrations/20260412000000_v65_schema_patch/migration.sql`

（完整 SQL 见 Step 4.1，此处不重复）

**执行方式：**

```bash
# 生成迁移（使用 --create-only 不自动执行，先审查 SQL）
pnpm --filter api-server prisma migrate dev --name v65_schema_patch --create-only

# 审查 SQL 后执行
pnpm --filter api-server prisma migrate deploy
```

**回滚方案：**

```sql
-- 回滚 V6.5 补丁（如出现问题）
-- 注意：7张表中 dead_letter_jobs/strategy_tuning_log/replacement_patterns 可安全删除
-- recommendation_traces/daily_plan_items 如有数据需先备份

DROP TABLE IF EXISTS "replacement_patterns";
DROP TABLE IF EXISTS "strategy_tuning_log";
DROP TABLE IF EXISTS "dead_letter_jobs";
DROP TABLE IF EXISTS "daily_plan_items";
DROP TABLE IF EXISTS "recipe_ratings";
DROP TABLE IF EXISTS "recipe_translations";
DROP TABLE IF EXISTS "recommendation_traces";

ALTER TABLE "foods"
  DROP COLUMN IF EXISTS "commonality_score",
  DROP COLUMN IF EXISTS "available_channels";

ALTER TABLE "recommendation_feedbacks"
  DROP COLUMN IF EXISTS "trace_id";
```

### 6.2 commonality_score 数据回填

**脚本：** `scripts/v6.6/backfill_commonality_scores.sql`

```sql
-- 基于 popularity 字段的分桶映射回填
-- 执行前先备份：CREATE TABLE foods_backup AS SELECT id, commonality_score FROM foods;

BEGIN;

UPDATE "foods"
SET "commonality_score" = CASE
  WHEN "popularity" >= 90 THEN 95  -- 超高热门：米饭、鸡蛋、猪肉
  WHEN "popularity" >= 75 THEN 82
  WHEN "popularity" >= 60 THEN 68
  WHEN "popularity" >= 45 THEN 55
  WHEN "popularity" >= 30 THEN 40
  WHEN "popularity" >= 15 THEN 28
  ELSE 15                           -- 极罕见食物：鸵鸟肉、藜麦等
END
WHERE "commonality_score" = 50;    -- 只更新仍为默认值50的行

-- 验证
SELECT
  CASE
    WHEN commonality_score >= 80 THEN '高大众化(80-100)'
    WHEN commonality_score >= 60 THEN '中等(60-79)'
    WHEN commonality_score >= 40 THEN '一般(40-59)'
    ELSE '小众(<40)'
  END AS tier,
  COUNT(*) AS food_count
FROM foods
GROUP BY 1
ORDER BY 1;

COMMIT;
```

### 6.3 V6.6 新增迁移（生活方式字段）

**迁移文件：** `prisma/migrations/20260412010000_v66_lifestyle_fields/migration.sql`

```sql
ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "sleep_quality"            TEXT,
  ADD COLUMN IF NOT EXISTS "stress_level"             TEXT,
  ADD COLUMN IF NOT EXISTS "hydration_goal"           INTEGER,
  ADD COLUMN IF NOT EXISTS "supplements_used"         JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS "meal_timing_preference"   TEXT;

COMMENT ON COLUMN "user_profiles"."sleep_quality"          IS '睡眠质量: poor|fair|good';
COMMENT ON COLUMN "user_profiles"."stress_level"           IS '压力水平: low|medium|high';
COMMENT ON COLUMN "user_profiles"."hydration_goal"         IS '每日目标饮水量(ml)';
COMMENT ON COLUMN "user_profiles"."supplements_used"       IS '正在服用的补剂列表';
COMMENT ON COLUMN "user_profiles"."meal_timing_preference" IS '用餐时间偏好: early_bird|standard|late_eater';
```

### 6.4 CANTEEN 渠道数据标注

**脚本：** `scripts/v6.6/tag_canteen_foods.sql`

```sql
-- 标注食堂常见食物（基于 tags 和 category 批量标注）
-- 需人工审核后再执行，或通过 Admin 后台逐批标注

UPDATE "foods"
SET "available_channels" = jsonb_set(
  COALESCE("available_channels", '[]'::jsonb),
  '{0}', '"canteen"'
)
WHERE
  -- 食堂常见：中式主食、常见蔬菜、常见肉类
  (category IN ('grain', 'vegetable', 'pork', 'chicken', 'tofu')
  AND commonality_score >= 65)
  AND NOT ("available_channels" @> '"canteen"');

-- 验证
SELECT COUNT(*) AS canteen_foods
FROM foods
WHERE "available_channels" @> '"canteen"';
```

### 6.5 迁移风险评估

| 迁移项                                       | 风险等级 | 风险描述                                     | 缓解措施                                                                         |
| -------------------------------------------- | -------- | -------------------------------------------- | -------------------------------------------------------------------------------- |
| V6.5 7张新表                                 | 低       | 全新表，无历史数据，失败可回滚               | IF NOT EXISTS 保证幂等                                                           |
| foods.commonality_score ADD COLUMN           | 低       | 有默认值50，不影响现有查询                   | 先 ADD COLUMN，再回填                                                            |
| recommendation_feedbacks.trace_id ADD COLUMN | 低       | 可为 NULL，存量记录无影响                    | 无 NOT NULL 约束                                                                 |
| FK 补齐                                      | 中       | 可能存在脏数据导致 FK 约束添加失败           | DO $$ 幂等脚本 + 先验证数据完整性                                                |
| HNSW 索引                                    | 中       | 大表建索引耗时（foods 表行数未知），可能锁表 | 用 CREATE INDEX CONCURRENTLY（需额外处理 Prisma 迁移不支持 CONCURRENTLY 的问题） |
| ioredis 迁移                                 | 高       | API 差异可能导致 null/undefined 处理异常     | 完整的单元测试 + Staging 环境验证                                                |
| user_profiles 5字段                          | 低       | 全为 nullable，不影响现有逻辑                | 先迁移再上代码                                                                   |

---

## Step 7：文档差异

### 7.1 架构层面变化

| 层次          | V6.5                                                      | V6.6                                                                                         |
| ------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 推荐召回      | 单路规则召回                                              | 双路召回（规则 + 语义），RecallMerger 合并                                                   |
| 替换反馈      | 追踪但不回流评分                                          | 自动回流（ReplacementFeedbackInjector，第13层Boost）                                         |
| 画像完整度    | 1/6 生活方式字段激活（exerciseSchedule）                  | 6/6 激活（新增 sleepQuality/stressLevel/hydrationGoal/supplementsUsed/mealTimingPreference） |
| 策略调优      | 内存级，重启丢失                                          | DB 持久化，重启恢复                                                                          |
| 渠道覆盖      | 5 种（HOME_COOK/RESTAURANT/DELIVERY/CONVENIENCE/UNKNOWN） | 6 种（新增 CANTEEN）                                                                         |
| 限流存储      | 全局路由内存，Gateway Redis                               | 全局路由 Redis（@nestjs/throttler Redis storage）                                            |
| Redis 客户端  | node-redis v5 单连接                                      | ioredis，支持连接池                                                                          |
| 可解释性      | 解释风格 hash 分配，无追踪                                | A/B 追踪 + 变化解释 + 渠道解释 + 置信度分级                                                  |
| Ranking       | 硬编码 SCORE_WEIGHTS                                      | Phase 3：Learned Ranking（per-segment 权重优化）                                             |
| 国际化        | 翻译表已有，接口层无多语言                                | Phase 3：I18nMiddleware + 推荐结果多语言                                                     |
| Schema 一致性 | 7张表有 schema 无迁移（CRITICAL）                         | 补丁迁移完整，`prisma migrate deploy` 可靠                                                   |

### 7.2 新增模块汇总

| 模块                               | 文件路径                                                           | Phase | 功能                                   |
| ---------------------------------- | ------------------------------------------------------------------ | ----- | -------------------------------------- |
| SemanticRecallService              | `diet/app/recommendation/semantic-recall.service.ts`               | 2-A   | 向量语义召回，包装 VectorSearchService |
| RecallMergerService                | `diet/app/recommendation/recall-merger.service.ts`                 | 2-A   | 双路召回去重合并，来源标记             |
| ReplacementFeedbackInjectorService | `diet/app/recommendation/replacement-feedback-injector.service.ts` | 2-B   | 替换模式→评分权重注入                  |
| LifestyleScoringAdapter            | `diet/app/recommendation/lifestyle-scoring-adapter.service.ts`     | 2-C   | 生活方式字段→营养素优先级向量          |
| ExplanationABTrackerService        | `diet/app/recommendation/explanation-ab-tracker.service.ts`        | 2-E   | 解释风格效果追踪 + 自动优化            |
| LearnedRankingService              | `diet/app/recommendation/learned-ranking.service.ts`               | 3-A   | per-segment 权重学习（Phase 3）        |
| I18nMiddleware                     | `core/i18n/i18n.middleware.ts`                                     | 3-B   | Accept-Language 多语言切换（Phase 3）  |
| V6.5 补丁迁移                      | `prisma/migrations/20260412000000_v65_schema_patch/`               | 1-A   | 7张表+3字段+5FK+HNSW索引               |
| V6.6 生活方式迁移                  | `prisma/migrations/20260412010000_v66_lifestyle_fields/`           | 2-C   | 5个生活方式字段                        |

### 7.3 升级模块汇总

| 模块                               | 变更类型 | 关键变化                                                                   |
| ---------------------------------- | -------- | -------------------------------------------------------------------------- |
| `recommendation-engine.service.ts` | 增强     | 双路召回并行 + ReplacementFeedbackInjector 注入 + LifestyleAdjustment 传递 |
| `food-scorer.service.ts`           | 增强     | 新增第 13 层 Boost（replacementPatternBoost）                              |
| `strategy-auto-tuner.service.ts`   | 增强     | onModuleInit 从 DB 恢复策略映射                                            |
| `recommendation.types.ts`          | 增强     | 新增 CANTEEN 渠道，MergedCandidate 类型，LifestyleAdjustment 类型          |
| `realistic-filter.service.ts`      | 增强     | CANTEEN 模式处理（不触发烹饪时间过滤）                                     |
| `explanation-generator.service.ts` | 增强     | 变化解释 + 渠道过滤解释 + 置信度分级                                       |
| `redis-cache.service.ts`           | 重构     | node-redis → ioredis，新增 getClient() 方法                                |
| `app.module.ts`                    | 增强     | ThrottlerModule Redis storage 配置                                         |
| `user-profile.dto.ts`              | 增强     | 新增 5 个生活方式字段                                                      |
| `profile-resolver.service.ts`      | 增强     | 整合 LifestyleScoringAdapter 输出                                          |

### 7.4 接口变更

#### 用户画像 PATCH 接口（新增字段）

```
PATCH /api/app/user/profile
新增可选字段（均可为 null）:
- sleepQuality: 'poor' | 'fair' | 'good'
- stressLevel: 'low' | 'medium' | 'high'
- hydrationGoal: number (ml, 建议 1500-3000)
- supplementsUsed: string[] (补剂名称列表)
- mealTimingPreference: 'early_bird' | 'standard' | 'late_eater'
```

#### 推荐接口（新增参数）

```
GET /api/app/diet/recommend?channel=canteen
新增 channel 枚举值: 'canteen'
```

#### 推荐响应（新增字段）

```json
{
  "recommendations": [...],
  "explanation": {
    "...(已有字段)",
    "deltaExplanation": {  // 新增，仅在今日推荐与昨日有显著差异时存在
      "changedFoods": ["三文鱼"],
      "primaryReason": "你昨天睡眠质量下降，今天增加了色氨酸丰富的食物",
      "confidence": "high"
    },
    "channelFilterNote": "基于你当前的外卖场景，已筛除 8 个需要自己做的选项"
  }
}
```

### 7.5 V6.5 → V6.6 评分维度对比

| 维度序号   | V6.5                      | V6.6                                | 变化                   |
| ---------- | ------------------------- | ----------------------------------- | ---------------------- |
| 1-11       | 不变                      | 不变                                | --                     |
| 12         | executability（可执行性） | 同上                                | 无变化                 |
| Boost 1-12 | 不变                      | 不变                                | --                     |
| Boost 13   | 不存在                    | **replacementPatternBoost**（新增） | 新增：替换模式权重注入 |
| 召回路     | 1 路（规则）              | 2 路（规则 + 语义）                 | 扩展                   |

### 7.6 已解决 vs 遗留问题清单

| 问题                             | V6.5 状态 | V6.6 解决？                                   |
| -------------------------------- | --------- | --------------------------------------------- |
| Schema/Migration 漂移            | CRITICAL  | ✅ Phase 1-A 全部修复                         |
| SemanticRecallService 缺失       | 未实现    | ✅ Phase 2-A 实现                             |
| 替换反馈未回流                   | 未实现    | ✅ Phase 2-B 实现                             |
| 5 个画像字段未激活               | 未实现    | ✅ Phase 2-C 实现                             |
| StrategyAutoTuner 内存丢失       | 未解决    | ✅ Phase 1-C 修复                             |
| 全局限流内存存储                 | 未解决    | ✅ Phase 1-B 修复                             |
| Redis 单连接                     | 未解决    | ✅ Phase 1-B（ioredis 迁移）                  |
| CANTEEN 渠道缺失                 | 未解决    | ✅ Phase 2-D 新增                             |
| 解释风格无追踪                   | 未解决    | ✅ Phase 2-E 新增                             |
| Learned Ranking                  | 未实现    | 🔄 Phase 3-A（受控灰度）                      |
| 国际化接口层                     | 未实现    | 🔄 Phase 3-B                                  |
| 分布式追踪                       | 未实现    | 🔄 Phase 3-C                                  |
| 用户流失预测                     | 未实现    | 🔄 Phase 3-D                                  |
| 健康检查 BullMQ                  | 未解决    | ✅ Phase 1-D 补充                             |
| MealCompositionScorer 缺数据字段 | 低优先级  | ❌ 暂不处理（flavor_profile JSON 估算可接受） |

---

> **V6.6 设计原则：**
>
> - Phase 1 优先工程稳定，不交付功能残缺的生产环境
> - Phase 2 所有功能改动均向后兼容，新字段为可选，旧逻辑有 fallback
> - Phase 3 全部通过 feature_flag 灰度控制，不影响主路径
> - 每个 Phase 完成后单独验收，不等所有 Phase 完成再上线
