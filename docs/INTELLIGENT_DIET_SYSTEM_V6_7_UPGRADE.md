# 智能饮食系统 V6.7 升级方案

> 基于 V6.6 架构的版本演进设计，非重新设计。
> 所有升级不影响已有接口，保留已有模块设计。
> 日期：2026-04-11

---

## 目录

- [Step 1：V6.6 能力评估](#step-1v66-能力评估)
- [Step 2：核心升级方向](#step-2核心升级方向)
- [Step 3：架构升级设计](#step-3架构升级设计)
- [Step 4：模块级升级设计](#step-4模块级升级设计)
- [Step 5：技术路线图](#step-5技术路线图)
- [Step 6：数据迁移](#step-4数据迁移)
- [Step 7：文档差异](#step-7文档差异)

---

## Step 1：V6.6 能力评估

### 1.1 V6.6 已达成能力

通过对 V6.6 实际代码的深度审计（2026-04-11），确认以下模块已**完整实现**：

| 能力域            | V6.6 现状                                                                                                                     | 成熟度 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------ |
| 12 维评分管道     | calories/protein/carbs/fat/quality/satiety/glycemic/nutrientDensity/inflammation/fiber/seasonality/executability + Boost 1-13 | 高     |
| 现实过滤          | RealisticFilterService（commonality + budget + cookTime + CANTEEN 模式 + 场景动态调整）                                       | 中高   |
| 双路召回          | RuleBasedRecall + SemanticRecallService → RecallMerger 合并去重                                                               | 高     |
| 替换反馈闭环      | ReplacementFeedbackInjectorService → 第 13 层 Boost 注入 FoodScorer                                                           | 高     |
| 6 个画像字段激活  | exerciseSchedule + sleepQuality + stressLevel + hydrationGoal + supplementsUsed + mealTimingPreference                        | 高     |
| 生活方式评分      | LifestyleScoringAdapter（sleep→tryptophan/Mg/B6, stress→VitC/B12/Mg, supplements→deconflict）                                 | 中     |
| 餐食组合 Rerank   | MealCompositionScorer 4 维（食材多样性 + 烹饪方式 + 口味平衡 + 营养互补）                                                     | 中高   |
| 协同过滤          | 双模式 CF（user-based 0.4 + item-based 0.6）+ 冷启动 semantic fallback                                                        | 中高   |
| 策略自动调优      | StrategyAutoTuner 周 Cron + DB 持久化 + 重启恢复                                                                              | 高     |
| 解释 A/B 追踪     | ExplanationABTrackerService（风格效果分析 + 自动切换）                                                                        | 中     |
| Learned Ranking   | LearnedRankingService（per-segment 线性回归 + feature_flag 灰度）                                                             | 低中   |
| 6 渠道覆盖        | HOME_COOK/RESTAURANT/DELIVERY/CONVENIENCE/CANTEEN/UNKNOWN                                                                     | 高     |
| 向量搜索          | pgvector HNSW 索引 + VectorSearchService + EmbeddingGenerationService                                                         | 高     |
| Redis 限流        | @nestjs/throttler Redis-backed + ioredis 连接池                                                                               | 高     |
| 熔断器            | CircuitBreakerService（opossum，per-service 实例）                                                                            | 高     |
| 死信队列          | DeadLetterService（DB 持久化，Admin 重放/丢弃）                                                                               | 高     |
| 暴食干预          | BingeInterventionService + BehaviorService.proactiveCheck 集成                                                                | 中高   |
| 流失预测          | ChurnPredictionService 8 维特征 + ProfileCronService 集成                                                                     | 中     |
| 自适应解释深度    | AdaptiveExplanationDepthService 4 维行为信号加权                                                                              | 中     |
| Thompson Sampling | 自适应探索率（衰减 + 收敛感知），Admin 可视化端点                                                                             | 高     |

### 1.2 V6.6 遗留问题诊断

#### P0：推荐质量核心缺陷

| #    | 问题                                            | 影响                                                                                                                                        | 严重度 |
| ---- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| P0-1 | **scoreFoodDetailed 参数爆炸（12 个位置参数）** | 函数签名脆弱，新增任何评分上下文都需要修改所有调用处，容易引入 bug                                                                          | 高     |
| P0-2 | **waterContent / tryptophan 信号断路**          | LifestyleScoringAdapter 输出 waterContent 和 tryptophan 调整值，但 FoodScorerService 无任何维度消费这两个信号——睡眠质量差的用户推荐不会改变 | 高     |
| P0-3 | **RealisticFilter fallback bug**                | 第 110 行 `Math.max(candidates.length, MIN_CANDIDATES)` 永远 ≥ candidates.length，fallback 实质返回全量未过滤池                             | 高     |
| P0-4 | **CF 与 ReplacementFeedback 标识不一致**        | CF 用 food name 匹配，ReplacementFeedback 用 food ID——食物改名后 CF 断裂                                                                    | 中高   |
| P0-5 | **MealCompositionScorer 口味平衡逻辑反转**      | 将高方差视为"平衡"（第 163 行 `avgStd * 40`），同时极甜+极辣的餐食得高分，与中餐口味和谐理念相悖                                            | 中高   |

#### P1：推荐场景与个性化不足

| #    | 问题                                 | 影响                                                                                             |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------------------ |
| P1-1 | **mealTimingPreference 未实现**      | 字段已采集但标注"预留"，早起型/标准型/晚食型用户的推荐无差异                                     |
| P1-2 | **SemanticRecall 无负反馈排斥**      | 只用正向反馈构建用户向量，被跳过/替换的食物不影响语义画像，系统会重复推荐用户不喜欢的食物        |
| P1-3 | **SemanticRecall 单向量模型**        | 用加权平均生成单个用户偏好向量，"喜欢寿司又喜欢火锅"的用户得到无意义的中间点向量                 |
| P1-4 | **无技能级别过滤**                   | HOME_COOK 渠道下，烹饪新手仍会看到高难度菜品（skillRequired 仅在评分中软加权，不在过滤中硬拦截） |
| P1-5 | **CF 无目标感知**                    | 减脂用户和增肌用户共享同一个相似度矩阵，减脂用户可能被推荐增肌用户偏好的高热量食物               |
| P1-6 | **替换反馈无餐次上下文**             | 午餐替换 A→B 的权重在晚餐也生效，但午餐和晚餐的食物偏好可能完全不同                              |
| P1-7 | **dinner/snack 场景无动态调整**      | adjustForScene 仅处理 weekday lunch 和 breakfast，晚餐和加餐无场景适配                           |
| P1-8 | **RealisticFilter 无技能级别硬过滤** | foods.skill_required 字段存在但 filter 不使用                                                    |

#### P2：算法/模型质量

| #    | 问题                                        | 影响                                                             |
| ---- | ------------------------------------------- | ---------------------------------------------------------------- |
| P2-1 | **LearnedRanking 使用 L2 loss + 二值标签**  | 实际是线性回归拟合 0/1 目标，预测值可负可 >1，应用 logistic loss |
| P2-2 | **LearnedRanking 无正则化**                 | 无 L1/L2 penalty，易对小样本分群过拟合                           |
| P2-3 | **LearnedRanking 无验证集**                 | 全量训练无 held-out 评估，无法检测过拟合                         |
| P2-4 | **ExplanationABTracker 无统计显著性检验**   | 10% 差异阈值 + 50 样本是任意规则，非卡方/Fisher 检验             |
| P2-5 | **CF O(n²) 全量重建**                       | 5000+ 食物的 item-based 全对比计算，随数据增长不可持续           |
| P2-6 | **MealCompositionScorer 营养互补只有 4 对** | 缺少 zinc+copper 拮抗、omega-3+vitE、protein+B6 等关键对         |
| P2-7 | **MealCompositionScorer 无质感多样性**      | 全软/全硬/全汤的餐食不扣分，缺少口感搭配维度                     |

#### P3：工程与可扩展性

| #    | 问题                                              | 影响                                                              |
| ---- | ------------------------------------------------- | ----------------------------------------------------------------- |
| P3-1 | **42+ 硬编码魔法数字分散在 10 个 service 中**     | 调参需改代码重部署，无法运行时 A/B 测试不同参数组合               |
| P3-2 | **RecallMerger 未集成 CF 召回**                   | CF 分数通过 PipelineContext 旁路注入，绕过了 merge-and-trace 架构 |
| P3-3 | **I18nMiddleware 未实现**                         | V6.6 Phase 3-B 计划的国际化中间件未落地                           |
| P3-4 | **node-redis 残留在 package.json**                | ioredis 迁移完成但旧依赖未移除                                    |
| P3-5 | **RecallMerger 用 ad-hoc `__` 属性注入元数据**    | `as FoodLibrary & { __recallSource }` 类型断言脆弱                |
| P3-6 | **USER_SEGMENTS 在 LearnedRanking 中硬编码**      | 新增分群需手动同步多处                                            |
| P3-7 | **RecommendationEngineService 2120 行 God Class** | 单文件承载召回/评分/组装/解释/缓存等全部逻辑，可维护性差          |

---

## Step 2：核心升级方向

基于 V6.6 遗留问题和用户指定升级方向，确定 **7 个核心升级点**，按 Phase 1/2/3 分层：

### 升级点 1：评分管道重构 — ScoringContext 化 + 信号断路修复

**为什么需要：** P0-1、P0-2 是同一类问题的两个表现——评分管道缺乏统一的上下文传递机制。12 个位置参数意味着每新增一种评分信号（如 waterContent、tryptophan、替换权重）都需要修改函数签名和所有调用处。V6.5 引入的 lifestyleAdjustment 已经暴露了这个问题：adapter 输出了信号但 scorer 无法接收。

**解决什么问题：** P0-1 参数爆炸、P0-2 信号断路、P3-1 部分硬编码（将评分参数纳入 ScoringContext）。

### 升级点 2：现实过滤增强 — 技能过滤 + 场景补全 + Bug 修复

**为什么需要：** P0-3 fallback bug 导致过滤形同虚设。P1-4 HOME_COOK 渠道下新手被推荐高难度菜品违反"可执行性最大化"原则。P1-7 dinner/snack 无场景调整使得晚餐推荐与午餐无差异。

**解决什么问题：** P0-3 fallback bug、P1-4 技能过滤缺失、P1-7 场景补全、P1-8 技能硬过滤。

### 升级点 3：语义召回进化 — 负反馈排斥 + 多兴趣建模 + 品类分散

**为什么需要：** P1-2 和 P1-3 使得语义召回的用户画像精度很低。单向量模型无法表达"又爱日料又爱川菜"的多面兴趣；不用负反馈意味着系统永远不知道用户不喜欢什么。

**解决什么问题：** P1-2 负反馈缺失、P1-3 单向量局限、语义召回品类过于集中。

### 升级点 4：餐食组合评分修正 — 口味和谐 + 质感多样性 + 营养拮抗

**为什么需要：** P0-5 口味平衡逻辑反转是一个正确性 bug，会导致怪异的餐食组合。P2-6 缺少营养拮抗对（如菠菜+豆腐的钙吸收问题）。P2-7 缺少质感维度使得全粥类/全炸物餐食不被惩罚。

**解决什么问题：** P0-5 口味逻辑反转、P2-6 营养拮抗缺失、P2-7 质感维度缺失。

### 升级点 5：CF 与替换反馈精细化 — 目标感知 + 餐次上下文 + ID 统一

**为什么需要：** P0-4 ID/name 不一致是数据一致性 bug。P1-5 CF 无目标感知会导致跨目标的推荐污染（减脂用户推荐增肌食物）。P1-6 替换反馈无餐次上下文导致权重泛化错误。

**解决什么问题：** P0-4 标识不一致、P1-5 CF 目标感知、P1-6 餐次上下文。

### 升级点 6：LearnedRanking 升级 — Logistic Loss + 正则化 + 验证集

**为什么需要：** P2-1/P2-2/P2-3 是标准 ML 工程问题。当前线性回归拟合二值标签在数学上不合理，且无过拟合检测。这不是过度工程化——修复这三个问题只需约 50 行代码修改。

**解决什么问题：** P2-1 损失函数、P2-2 正则化、P2-3 验证集。

### 升级点 7：管道可配置化 — 参数中心化 + 统一召回架构

**为什么需要：** P3-1 42+ 魔法数字分散在 10 个 service 中，每次调参需改代码重部署。P3-2 CF 旁路注入绕过了 RecallMerger 的 merge-and-trace 架构。P3-7 God Class 降低可维护性。

**解决什么问题：** P3-1 硬编码、P3-2 CF 召回未统一、P3-5 ad-hoc 元数据、P3-7 部分解耦。

---

## Step 3：架构升级设计

### 3.1 推荐管道架构演进

V6.6 推荐管道：

```
用户请求
  → ProfileResolver (6层画像 + lifestyle 字段)
  → StrategySelector (DB持久化 + 自动调优)
  → [并行召回]
      ├── RuleBasedRecall (规则过滤)
      └── SemanticRecallService (单向量正反馈ANN)
  → RecallMerger (去重 + 来源标记)
  → [旁路] CF scores 通过 PipelineContext 注入
  → RealisticFilter (commonality + budget + cookTime)
  → FoodScorer (12维评分, 12位置参数 + 13层Boost)
  → LearnedRankingAdjuster (可选)
  → MealCompositionScorer (4维, 口味方差=好)
  → ExplanationGenerator
  → 返回
```

V6.7 升级后：

```
用户请求
  → ProfileResolver (6层画像 + lifestyle 字段)
  → StrategySelector (DB持久化 + 自动调优)
  → [三路并行召回]
      ├── RuleBasedRecall (规则过滤)
      ├── SemanticRecallService (多兴趣向量 + 负反馈排斥 + 品类分散)
      └── CFRecallService (目标感知CF, 新增召回路)
  → RecallMerger (三路合并 + 统一 RecallMetadata + 品类限额)
  → RealisticFilter (+ 技能硬过滤 + dinner/snack场景 + fallback修复)
  → FoodScorer (ScoringContext 统一入参, + 信号断路修复)
  → LearnedRankingAdjuster (logistic loss + L2正则 + 验证集)
  → MealCompositionScorer (5维, + 口味和谐修正 + 质感多样性 + 营养拮抗)
  → ExplanationGenerator (不变)
  → 返回
```

### 3.2 核心架构变化

```
diet.module.ts
├── [UPGRADE] RecommendationEngineService    (ScoringContext, 三路召回, 部分解耦)
├── [UPGRADE] FoodScorerService              (ScoringContext 替代12位置参数)
├── [UPGRADE] SemanticRecallService          (多兴趣向量 + 负反馈排斥)
├── [UPGRADE] RecallMergerService            (三路合并 + RecallMetadata + CF集成)
├── [UPGRADE] RealisticFilterService         (技能过滤 + 场景补全 + bug修复)
├── [UPGRADE] MealCompositionScorer          (口味和谐 + 质感 + 营养拮抗)
├── [UPGRADE] CollaborativeFilteringService  (目标感知 + ID统一)
├── [UPGRADE] LearnedRankingService          (logistic loss + L2 + validation)
├── [UPGRADE] ReplacementFeedbackInjector    (餐次上下文)
├── [NEW]     ScoringConfigService           (参数中心化管理)
├── [NEW]     RecallMetadata                 (类型定义, 替代 __ad-hoc属性)
└── [NEW]     CFRecallService                (CF→召回阶段适配器)

recommendation.types.ts
├── [NEW]     ScoringContext                 (统一评分上下文接口)
├── [NEW]     RecallMetadata                 (统一召回元数据接口)
├── [UPGRADE] MealCompositionResult          (新增 textureDiversity 维度)
└── [UPGRADE] COMPOSITION_WEIGHTS            (5维权重, 可配置)
```

### 3.3 数据流变化

#### ScoringContext 统一入参

```typescript
// 替代 12 个位置参数
interface ScoringContext {
  // 食物
  food: FoodPoolItem;
  // 画像
  profile: EnrichedProfileContext;
  nutritionTarget: NutritionTarget;
  // 策略
  strategy: StrategyConfig;
  rankPolicy: RankPolicyConfig;
  // 运行时上下文
  mealType: MealType;
  channel: AcquisitionChannel;
  isWeekday: boolean;
  // 外部信号
  cfScores: Map<string, number>;
  replacementWeights: Map<string, ReplacementWeight>; // 含餐次上下文
  lifestyleAdjustment: LifestyleNutrientAdjustment;
  // 可选学习权重
  learnedWeights?: number[];
  // 配置中心化参数
  scoringConfig: ScoringConfigSnapshot;
}
```

#### RecallMetadata 统一元数据

```typescript
// 替代 __recallSource / __semanticScore / __ruleWeight
interface RecallMetadata {
  foodId: string;
  sources: Set<'rule' | 'semantic' | 'cf'>;
  semanticScore?: number; // 0-1, 语义相似度
  cfScore?: number; // 0-1, CF 预测分
  ruleWeight: number; // 默认 1.0, semantic-only 0.7, cf-only 0.6
}

// 独立存储在 Map<string, RecallMetadata> 而非注入到 food 对象
```

#### 三路召回合并策略

```typescript
// RecallMergerService.merge() 扩展
// 1. rule + semantic + cf 三路合并
// 2. 任一路存在 → 保留
// 3. 多路存在 → sources 标记为 Set
// 4. 仅 semantic → ruleWeight 0.7
// 5. 仅 cf → ruleWeight 0.6 (CF 信号弱于语义)
// 6. 仅 cf + semantic → ruleWeight 0.75
// 7. 品类限额：semantic-only 和 cf-only 的候选，每个 category 最多 5 个
```

---

## Step 4：模块级升级设计

### 4.1 ScoringContext 重构 + 信号断路修复（Phase 1-A）

**涉及文件：**

- `recommendation.types.ts` — 新增 `ScoringContext` / `ScoringConfigSnapshot` 接口
- `food-scorer.service.ts` — `scoreFoodDetailed` 签名重构
- `recommendation-engine.service.ts` — 构建 ScoringContext 并传入

**ScoringContext 接口定义：**

```typescript
// recommendation.types.ts 新增

export interface ScoringConfigSnapshot {
  // 从 ScoringConfigService 加载的运行时参数
  executabilitySubWeights: { commonality: number; cost: number; cookTime: number; skill: number }; // 默认 0.35/0.25/0.25/0.15
  nrf93SigmoidCenter: number; // 默认 150
  nrf93SigmoidSlope: number; // 默认 0.01
  inflammationCenter: number; // 默认 20
  inflammationSlope: number; // 默认 0.08
  addedSugarPenaltyThreshold: number; // 默认 15
  confidenceFloor: number; // 默认 0.7
  novaBase: number[]; // 默认 [1.0, 1.0, 1.0, 0.85, 0.55]
  energySigmaRatios: Record<string, number>; // per-goal sigma
}

export interface ScoringContext {
  food: FoodPoolItem;
  profile: EnrichedProfileContext;
  nutritionTarget: NutritionTarget;
  strategy: StrategyConfig;
  rankPolicy: RankPolicyConfig;
  mealType: string;
  channel: AcquisitionChannel;
  isWeekday: boolean;
  cfScore: number;
  replacementWeight: ReplacementWeight | null;
  lifestyleAdjustment: LifestyleNutrientAdjustment;
  learnedWeights?: number[];
  scoringConfig: ScoringConfigSnapshot;
}

export interface ReplacementWeight {
  multiplier: number;
  reason: 'replaced_from' | 'replaced_to';
  decayFactor: number;
  mealType?: string; // V6.7: 餐次上下文
}
```

**FoodScorerService 签名变更：**

```typescript
// 变更前 (V6.6):
scoreFoodDetailed(
  food: FoodPoolItem,
  targets: NutritionTarget,
  rankPolicy: RankPolicyConfig,
  profile: EnrichedProfileContext,
  mealType: string,
  channel: AcquisitionChannel,
  isWeekday: boolean,
  cfScore: number,
  replacementMultiplier: number,
  lifestyleAdjustment: LifestyleNutrientAdjustment,
  learnedWeights?: number[],
  scoringConfig?: ScoringConfigSnapshot,
): ScoredFood

// 变更后 (V6.7):
scoreFoodDetailed(ctx: ScoringContext): ScoredFood
```

**信号断路修复 — waterContent / tryptophan：**

在 `FoodScorerService` 的 `calcNutrientDensityScore` 方法中新增：

```typescript
// V6.7: 消费 lifestyleAdjustment 的 waterContent 信号
private calcNutrientDensityScore(ctx: ScoringContext): number {
  let baseScore = this.calcNRF93(ctx.food, ctx.nutritionTarget);

  // V6.7: waterContent boost
  const waterAdj = ctx.lifestyleAdjustment?.waterContent ?? 0;
  if (waterAdj > 0 && ctx.food.waterContentPercent) {
    // 含水率 > 80% 的食物获得 boost
    const waterBoost = ctx.food.waterContentPercent > 80
      ? waterAdj * 0.8
      : ctx.food.waterContentPercent > 60
        ? waterAdj * 0.4
        : 0;
    baseScore += waterBoost;
  }

  // V6.7: tryptophan boost (via protein quality proxy)
  const tryptAdj = ctx.lifestyleAdjustment?.tryptophan ?? 0;
  if (tryptAdj > 0) {
    // 色氨酸丰富食物：火鸡、鸡肉、牛奶、香蕉、燕麦
    const tryptophanRichTags = ['poultry', 'dairy', 'banana', 'oats', 'eggs', 'seeds'];
    const hasTryptophan = tryptophanRichTags.some(t =>
      ctx.food.tags?.includes(t) || ctx.food.category === t
    );
    if (hasTryptophan) {
      baseScore += tryptAdj;
    }
  }

  return Math.min(100, Math.max(0, baseScore));
}
```

---

### 4.2 ScoringConfigService — 参数中心化（Phase 1-B）

**文件：** `apps/api-server/src/modules/diet/app/recommendation/scoring-config.service.ts`

**功能：** 集中管理 10 个 service 中分散的 42+ 硬编码常量，支持运行时通过 Admin API 更新，无需重部署。

```typescript
@Injectable()
export class ScoringConfigService implements OnModuleInit {
  private config: ScoringConfigSnapshot;
  private readonly CACHE_KEY = 'scoring_config:snapshot';
  private readonly CACHE_TTL_MS = 300_000; // 5 分钟

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService
  ) {}

  async onModuleInit(): Promise<void> {
    await this.loadConfig();
  }

  async getConfig(): Promise<ScoringConfigSnapshot> {
    if (this.config) return this.config;
    return this.loadConfig();
  }

  private async loadConfig(): Promise<ScoringConfigSnapshot> {
    // 1. 尝试 Redis 缓存
    const cached = await this.redis.get<ScoringConfigSnapshot>(this.CACHE_KEY);
    if (cached) {
      this.config = cached;
      return cached;
    }

    // 2. 从 feature_flag 表读取配置
    const flag = await this.prisma.featureFlag.findUnique({
      where: { key: 'scoring_config_v67' },
    });

    if (flag?.config) {
      this.config = this.mergeWithDefaults(flag.config as Partial<ScoringConfigSnapshot>);
    } else {
      this.config = this.getDefaults();
    }

    await this.redis.set(this.CACHE_KEY, this.config, this.CACHE_TTL_MS);
    return this.config;
  }

  private getDefaults(): ScoringConfigSnapshot {
    return {
      executabilitySubWeights: { commonality: 0.35, cost: 0.25, cookTime: 0.25, skill: 0.15 },
      nrf93SigmoidCenter: 150,
      nrf93SigmoidSlope: 0.01,
      inflammationCenter: 20,
      inflammationSlope: 0.08,
      addedSugarPenaltyThreshold: 15,
      confidenceFloor: 0.7,
      novaBase: [1.0, 1.0, 1.0, 0.85, 0.55],
      energySigmaRatios: { fat_loss: 0.15, muscle_gain: 0.2, health: 0.25, habit: 0.3 },
      // RecallMerger 参数
      semanticOnlyWeight: 0.7,
      cfOnlyWeight: 0.6,
      maxCandidatesPerCategoryForNonRule: 5,
      // RealisticFilter 参数
      minCandidates: 5,
      canteenCommonalityThreshold: 60,
      // MealComposition 参数
      compositionWeights: {
        ingredientDiversity: 0.25,
        cookingMethodDiversity: 0.15,
        flavorHarmony: 0.2,
        nutritionComplementarity: 0.2,
        textureDiversity: 0.2,
      },
      // ReplacementFeedback 参数
      replacedFromMultiplier: 0.8,
      replacedToMultiplier: 1.12,
      replacementDecayDays: 30,
      replacementMinFrequency: 2,
      // CF 参数
      cfUserBasedWeight: 0.4,
      cfItemBasedWeight: 0.6,
      // Lifestyle 参数
      lifestyleSleepPoorTryptophanBoost: 0.15,
      lifestyleSleepPoorMagnesiumBoost: 0.1,
      lifestyleStressHighVitCBoost: 0.12,
    };
  }

  // Admin API 调用此方法更新配置
  async updateConfig(partial: Partial<ScoringConfigSnapshot>): Promise<ScoringConfigSnapshot> {
    const merged = this.mergeWithDefaults(partial);

    await this.prisma.featureFlag.upsert({
      where: { key: 'scoring_config_v67' },
      update: { config: merged as any },
      create: {
        id: generateId(),
        key: 'scoring_config_v67',
        name: 'V6.7 Scoring Config',
        type: 'boolean',
        enabled: true,
        config: merged as any,
      },
    });

    this.config = merged;
    await this.redis.set(this.CACHE_KEY, merged, this.CACHE_TTL_MS);
    return merged;
  }

  private mergeWithDefaults(partial: any): ScoringConfigSnapshot {
    const defaults = this.getDefaults();
    return { ...defaults, ...partial };
  }
}
```

**Admin 端点（在 strategy-management.controller.ts 扩展）：**

```typescript
// GET /api/admin/scoring-config — 查看当前配置
// PUT /api/admin/scoring-config — 更新配置（partial merge）
```

---

### 4.3 RealisticFilter 增强（Phase 1-C）

**涉及文件：** `realistic-filter.service.ts`

#### Fallback Bug 修复

```typescript
// 修复前 (V6.6, line 110):
return candidates.slice(0, Math.max(candidates.length, MIN_CANDIDATES));

// 修复后 (V6.7):
// fallback: 过滤过于激进时，按 commonality_score 降序排列后取 top MIN_CANDIDATES
if (filtered.length < this.config.minCandidates) {
  this.logger.warn(
    `RealisticFilter: 过滤后仅剩 ${filtered.length} 个候选, 回退到 top ${this.config.minCandidates}`
  );
  return candidates
    .sort((a, b) => (b.commonalityScore ?? 50) - (a.commonalityScore ?? 50))
    .slice(0, this.config.minCandidates);
}
return filtered;
```

#### 技能级别硬过滤

```typescript
// 新增在 filterByRealism 方法中
private filterBySkillLevel(
  candidates: FoodPoolItem[],
  channel: AcquisitionChannel,
  cookingSkill: CookingSkillLevel | null,
): FoodPoolItem[] {
  // 仅 HOME_COOK 渠道触发
  if (channel !== AcquisitionChannel.HOME_COOK) return candidates;
  if (!cookingSkill) return candidates;

  const maxSkill = SKILL_LEVEL_MAP[cookingSkill]; // beginner=1, intermediate=2, advanced=3

  return candidates.filter(food => {
    const required = SKILL_LEVEL_MAP[food.skillRequired ?? 'beginner'];
    return required <= maxSkill;
  });
}

const SKILL_LEVEL_MAP: Record<string, number> = {
  beginner: 1,
  intermediate: 2,
  advanced: 3,
};
```

#### Dinner/Snack 场景调整

```typescript
// adjustForScene 扩展
adjustForScene(config: RealismConfig, mealType: string, isWeekday: boolean): RealismConfig {
  const adjusted = { ...config };

  if (isWeekday && mealType === 'lunch') {
    adjusted.weekdayCookTimeCap = Math.min(adjusted.weekdayCookTimeCap, 30);
    adjusted.commonalityThreshold = Math.max(adjusted.commonalityThreshold, 40);
  } else if (isWeekday && mealType === 'morning') {
    adjusted.weekdayCookTimeCap = Math.min(adjusted.weekdayCookTimeCap, 15);
    adjusted.commonalityThreshold = Math.max(adjusted.commonalityThreshold, 50);
  }
  // V6.7: 新增 dinner 和 snack
  else if (isWeekday && mealType === 'dinner') {
    // 工作日晚餐：比午餐稍宽松，但仍有时间限制
    adjusted.weekdayCookTimeCap = Math.min(adjusted.weekdayCookTimeCap, 45);
  } else if (mealType === 'snack') {
    // 加餐：极短准备时间，高便捷性
    adjusted.weekdayCookTimeCap = Math.min(adjusted.weekdayCookTimeCap, 10);
    adjusted.commonalityThreshold = Math.max(adjusted.commonalityThreshold, 55);
  }

  return adjusted;
}
```

---

### 4.4 SemanticRecall 进化 — 负反馈 + 多兴趣（Phase 2-A）

**涉及文件：** `semantic-recall.service.ts`

#### 负反馈排斥

```typescript
// buildUserProfileVector 方法扩展
private async buildUserProfileVector(userId: string): Promise<number[]> {
  const feedbacks = await this.getFeedbacks(userId, 90); // 扩展到90天

  // 正向反馈
  const positive = feedbacks.filter(f => ['accepted', 'loved'].includes(f.action));
  const positiveVector = this.weightedAverage(positive, {
    loved: 1.5,
    accepted: 1.0,
  });

  // V6.7: 负向反馈
  const negative = feedbacks.filter(f => ['skipped', 'replaced'].includes(f.action));
  if (negative.length >= 2) {
    const negativeVector = this.weightedAverage(negative, {
      replaced: 0.8,
      skipped: 0.5,
    });

    // 正向量 - 0.3 * 负向量 → 推离不喜欢的食物
    const REPULSION_FACTOR = 0.3;
    return this.subtractVectors(positiveVector, negativeVector, REPULSION_FACTOR);
  }

  return positiveVector;
}

private subtractVectors(positive: number[], negative: number[], factor: number): number[] {
  const result = positive.map((v, i) => v - factor * (negative[i] ?? 0));
  // L2 归一化
  const norm = Math.sqrt(result.reduce((sum, v) => sum + v * v, 0));
  return norm > 0 ? result.map(v => v / norm) : result;
}
```

#### 多兴趣建模

```typescript
// 多兴趣向量：对正向反馈的 embeddings 做 k-means (k=2-3)
private async buildMultiInterestVectors(userId: string): Promise<number[][]> {
  const feedbacks = await this.getPositiveFeedbacksWithEmbeddings(userId);
  if (feedbacks.length < 6) {
    // 不足6条反馈 → 回退到单向量
    return [this.buildUserProfileVector(userId)];
  }

  // 简单 k-means, k = min(3, ceil(feedbacks.length / 5))
  const k = Math.min(3, Math.ceil(feedbacks.length / 5));
  const clusters = this.kMeans(feedbacks.map(f => f.embedding), k, 20); // 20次迭代

  return clusters.centroids;
}

// 召回时：对每个兴趣向量分别做 ANN，去重后合并
async recall(userId: string, options: SemanticRecallOptions): Promise<SemanticRecallResult[]> {
  const interests = await this.buildMultiInterestVectors(userId);
  const allCandidates = new Map<string, SemanticRecallResult>();

  for (const vector of interests) {
    // 加上负反馈排斥
    const adjustedVector = await this.applyNegativeRepulsion(userId, vector);
    const candidates = await this.vectorSearch.findSimilarByVector(
      adjustedVector,
      Math.ceil(options.topK / interests.length) * 2,
    );
    for (const c of candidates) {
      if (!allCandidates.has(c.foodId)) {
        allCandidates.set(c.foodId, c);
      }
    }
  }

  // 品类分散：每个 category 最多 N 个
  return this.enforceCategoryDiversity(
    Array.from(allCandidates.values()),
    options.topK,
    options.maxPerCategory ?? 5,
  );
}

private enforceCategoryDiversity(
  candidates: SemanticRecallResult[],
  topK: number,
  maxPerCategory: number,
): SemanticRecallResult[] {
  const categoryCount = new Map<string, number>();
  const result: SemanticRecallResult[] = [];

  // 按语义分降序
  candidates.sort((a, b) => b.semanticScore - a.semanticScore);

  for (const c of candidates) {
    if (result.length >= topK) break;
    const cat = c.food.category ?? 'unknown';
    const count = categoryCount.get(cat) ?? 0;
    if (count < maxPerCategory) {
      result.push(c);
      categoryCount.set(cat, count + 1);
    }
  }

  return result;
}
```

**k-means 实现（轻量，内嵌 service）：**

```typescript
private kMeans(
  points: number[][],
  k: number,
  maxIter: number,
): { centroids: number[][]; assignments: number[] } {
  const dim = points[0].length;
  // 随机初始化 centroids
  let centroids = points.slice(0, k).map(p => [...p]);
  let assignments = new Array(points.length).fill(0);

  for (let iter = 0; iter < maxIter; iter++) {
    // Assign
    let changed = false;
    for (let i = 0; i < points.length; i++) {
      let bestDist = Infinity, bestK = 0;
      for (let j = 0; j < k; j++) {
        const dist = this.euclideanDist(points[i], centroids[j]);
        if (dist < bestDist) { bestDist = dist; bestK = j; }
      }
      if (assignments[i] !== bestK) { changed = true; assignments[i] = bestK; }
    }
    if (!changed) break;

    // Update centroids
    for (let j = 0; j < k; j++) {
      const members = points.filter((_, i) => assignments[i] === j);
      if (members.length > 0) {
        centroids[j] = new Array(dim).fill(0).map(
          (_, d) => members.reduce((s, m) => s + m[d], 0) / members.length,
        );
      }
    }
  }

  return { centroids, assignments };
}
```

---

### 4.5 RecallMerger 三路统一 + RecallMetadata（Phase 2-B）

**涉及文件：** `recall-merger.service.ts`, `recommendation.types.ts`

#### RecallMetadata 类型定义

```typescript
// recommendation.types.ts 新增
export interface RecallMetadata {
  foodId: string;
  sources: Set<'rule' | 'semantic' | 'cf'>;
  semanticScore: number; // 0-1, 无则为 0
  cfScore: number; // 0-1, 无则为 0
  ruleWeight: number; // 最终权重乘数
}
```

#### CFRecallService 适配器

```typescript
// cf-recall.service.ts 新增
@Injectable()
export class CFRecallService {
  constructor(
    private readonly cf: CollaborativeFilteringService,
    private readonly prisma: PrismaService
  ) {}

  /**
   * 将 CF 分数转为召回候选列表
   * 仅返回 CF score > 0.1 的食物作为召回候选
   */
  async recall(
    userId: string,
    goalType: string,
    excludedIds: Set<string>,
    topK: number
  ): Promise<CFRecallResult[]> {
    const cfScores = await this.cf.getCFScoresForUser(userId, goalType);

    return Array.from(cfScores.entries())
      .filter(([id, score]) => score > 0.1 && !excludedIds.has(id))
      .sort((a, b) => b[1] - a[1])
      .slice(0, topK)
      .map(([id, score]) => ({ foodId: id, cfScore: score }));
  }
}
```

#### RecallMergerService 三路合并

```typescript
// recall-merger.service.ts 重构
@Injectable()
export class RecallMergerService {
  merge(
    ruleCandidates: FoodPoolItem[],
    semanticCandidates: SemanticRecallResult[],
    cfCandidates: CFRecallResult[], // V6.7 新增
    config: ScoringConfigSnapshot
  ): { foods: FoodPoolItem[]; metadata: Map<string, RecallMetadata> } {
    const metadata = new Map<string, RecallMetadata>();
    const foodMap = new Map<string, FoodPoolItem>();

    // 规则路全量加入
    for (const food of ruleCandidates) {
      foodMap.set(food.id, food);
      metadata.set(food.id, {
        foodId: food.id,
        sources: new Set(['rule']),
        semanticScore: 0,
        cfScore: 0,
        ruleWeight: 1.0,
      });
    }

    // 语义路
    for (const sem of semanticCandidates) {
      const existing = metadata.get(sem.food.id);
      if (existing) {
        existing.sources.add('semantic');
        existing.semanticScore = sem.semanticScore;
      } else {
        foodMap.set(sem.food.id, sem.food);
        metadata.set(sem.food.id, {
          foodId: sem.food.id,
          sources: new Set(['semantic']),
          semanticScore: sem.semanticScore,
          cfScore: 0,
          ruleWeight: config.semanticOnlyWeight, // 0.7
        });
      }
    }

    // CF 路
    for (const cf of cfCandidates) {
      const existing = metadata.get(cf.foodId);
      if (existing) {
        existing.sources.add('cf');
        existing.cfScore = cf.cfScore;
        // CF 加入已有候选 → 略微提权
        if (!existing.sources.has('rule')) {
          existing.ruleWeight = Math.min(1.0, existing.ruleWeight + 0.1);
        }
      } else {
        // CF-only 候选（需要从 DB 加载食物数据）
        const food = this.foodCache.get(cf.foodId);
        if (food) {
          foodMap.set(cf.foodId, food);
          metadata.set(cf.foodId, {
            foodId: cf.foodId,
            sources: new Set(['cf']),
            semanticScore: 0,
            cfScore: cf.cfScore,
            ruleWeight: config.cfOnlyWeight, // 0.6
          });
        }
      }
    }

    // 品类限额：非规则路 only 的候选，每 category 最多 N 个
    const finalFoods = this.enforceCategoryLimit(
      Array.from(foodMap.values()),
      metadata,
      config.maxCandidatesPerCategoryForNonRule
    );

    return { foods: finalFoods, metadata };
  }

  private enforceCategoryLimit(
    foods: FoodPoolItem[],
    metadata: Map<string, RecallMetadata>,
    maxPerCategory: number
  ): FoodPoolItem[] {
    const categoryCount = new Map<string, number>();
    return foods.filter((food) => {
      const meta = metadata.get(food.id);
      if (!meta || meta.sources.has('rule')) return true; // 规则路不限制
      const cat = food.category ?? 'unknown';
      const count = categoryCount.get(cat) ?? 0;
      if (count >= maxPerCategory) return false;
      categoryCount.set(cat, count + 1);
      return true;
    });
  }
}
```

---

### 4.6 MealCompositionScorer 修正 + 扩展（Phase 2-C）

**涉及文件：** `meal-composition-scorer.service.ts`

#### 口味平衡逻辑修正（P0-5）

```typescript
// 修复前 (V6.6): 高方差 = 好 (错误)
// flavorBalance = avgStd * 40 → 方差越大分越高

// 修复后 (V6.7): 口味和谐模型
// 好的组合：覆盖 3-4 种口味轴，每种适度（不极端）
private calcFlavorHarmony(foods: FoodPoolItem[]): number {
  const axes = ['sweet', 'sour', 'salty', 'bitter', 'umami', 'spicy'];
  const mealProfile = new Map<string, number[]>();

  for (const axis of axes) {
    mealProfile.set(axis, []);
  }

  for (const food of foods) {
    const profile = food.flavorProfile ?? {};
    for (const axis of axes) {
      const value = profile[axis] ?? 0;
      mealProfile.get(axis)!.push(value);
    }
  }

  // 1. 覆盖度：有几种口味轴有 >0 值（满分：3-4种有值）
  const coveredAxes = axes.filter(
    axis => mealProfile.get(axis)!.some(v => v > 0)
  ).length;
  const coverageScore = coveredAxes >= 4 ? 100
    : coveredAxes === 3 ? 85
    : coveredAxes === 2 ? 60
    : coveredAxes === 1 ? 40 : 20;

  // 2. 极端度惩罚：任何轴 max > 4 (满分5) 扣分
  let extremePenalty = 0;
  for (const axis of axes) {
    const values = mealProfile.get(axis)!;
    const maxVal = Math.max(...values, 0);
    if (maxVal > 4) extremePenalty += 15; // 极端口味扣15分
    if (maxVal > 3 && axis === 'spicy') {
      // 多道辣菜额外惩罚
      const spicyCount = values.filter(v => v > 3).length;
      if (spicyCount > 1) extremePenalty += 10;
    }
  }

  // 3. 冲突检测：同时高甜+高辣、同时高酸+高苦 扣分
  const sweetMax = Math.max(...(mealProfile.get('sweet') ?? [0]));
  const spicyMax = Math.max(...(mealProfile.get('spicy') ?? [0]));
  const sourMax = Math.max(...(mealProfile.get('sour') ?? [0]));
  const bitterMax = Math.max(...(mealProfile.get('bitter') ?? [0]));

  if (sweetMax > 3 && spicyMax > 3) extremePenalty += 20;
  if (sourMax > 3 && bitterMax > 3) extremePenalty += 15;

  return Math.max(0, coverageScore - extremePenalty);
}
```

#### 质感多样性（新增第 5 维）

```typescript
// 质感映射：基于 cooking_method 和 tags 推断
private calcTextureDiversity(foods: FoodPoolItem[]): number {
  const TEXTURE_MAP: Record<string, string> = {
    // cooking_method → texture
    'stir_fry': 'crispy',
    'deep_fry': 'crispy',
    'steam': 'soft',
    'boil': 'soft',
    'stew': 'tender',
    'bake': 'crispy',
    'raw': 'crunchy',
    'grill': 'chewy',
    'braise': 'tender',
  };

  const textures = new Set<string>();
  for (const food of foods) {
    const method = food.cookingMethod ?? '';
    const texture = TEXTURE_MAP[method] ?? 'unknown';
    textures.add(texture);

    // 额外：特定 tags 覆写
    if (food.tags?.includes('soup') || food.tags?.includes('congee')) textures.add('liquid');
    if (food.tags?.includes('salad') || food.tags?.includes('raw')) textures.add('crunchy');
  }

  // 2种不同质感 = 60分, 3种 = 85分, 4+ = 100分
  if (textures.size >= 4) return 100;
  if (textures.size === 3) return 85;
  if (textures.size === 2) return 60;
  if (textures.size === 1) return 30; // 全部同一质感
  return 50; // unknown
}
```

#### 营养拮抗对

```typescript
// 现有互补对之外，新增拮抗对
private readonly ANTAGONISTIC_PAIRS: { a: string; b: string; penalty: number }[] = [
  { a: 'calcium', b: 'oxalate', penalty: -15 },    // 菠菜+豆腐/牛奶
  { a: 'iron', b: 'calcium', penalty: -10 },        // 高铁+高钙同餐降低吸收
  { a: 'zinc', b: 'phytate', penalty: -8 },         // 锌+植酸（全谷物）
];

private calcNutritionScore(foods: FoodPoolItem[]): number {
  let score = 0;

  // 正向互补对（已有）
  for (const pair of this.COMPLEMENTARY_PAIRS) {
    if (this.hasPair(foods, pair.a, pair.b)) score += pair.bonus;
  }

  // V6.7: 负向拮抗对
  for (const pair of this.ANTAGONISTIC_PAIRS) {
    if (this.hasAntagonism(foods, pair.a, pair.b)) score += pair.penalty;
  }

  return Math.max(0, Math.min(100, 50 + score));
}

private hasAntagonism(foods: FoodPoolItem[], a: string, b: string): boolean {
  const hasA = foods.some(f => this.isRichIn(f, a));
  const hasB = foods.some(f => this.isRichIn(f, b));
  return hasA && hasB;
}
```

#### 权重更新（5 维）

```typescript
// V6.6: 4维
// COMPOSITION_WEIGHTS = { ingredientDiversity: 0.30, cookingMethodDiversity: 0.20, flavorBalance: 0.25, nutritionComplementarity: 0.25 }

// V6.7: 5维，从 ScoringConfigService 读取
// 默认值:
// { ingredientDiversity: 0.25, cookingMethodDiversity: 0.15, flavorHarmony: 0.20, nutritionComplementarity: 0.20, textureDiversity: 0.20 }
```

---

### 4.7 CF 目标感知 + ID 统一（Phase 2-D）

**涉及文件：** `collaborative-filtering.service.ts`

#### 目标感知 CF

```typescript
// 修改 computeUserSimilarity：增加目标匹配加权
private async computeUserSimilarity(
  userAId: string,
  userBId: string,
  userAGoal: string,
): Promise<number> {
  const baseSimilarity = this.cosineSimilarity(
    this.userVectors.get(userAId)!,
    this.userVectors.get(userBId)!,
  );

  // V6.7: 目标匹配加权
  const userBGoal = this.userGoals.get(userBId);
  if (userBGoal === userAGoal) {
    return baseSimilarity; // 同目标：全权重
  }
  // 不同目标：相似度打折
  return baseSimilarity * 0.5;
}

// 在 fullRebuild 和 incrementalUpdate 中加载用户目标
private async loadUserGoals(): Promise<Map<string, string>> {
  const profiles = await this.prisma.userProfile.findMany({
    select: { userId: true, goal: true },
  });
  return new Map(profiles.map(p => [p.userId, p.goal]));
}
```

#### 统一使用 food ID（修复 P0-4）

```typescript
// 修改 CF 内部的所有 food name 引用为 food ID
// 搜索所有 `food.name` 或 `foodName` 用法，替换为 `food.id` / `foodId`

// 具体变更：
// 1. userVectors: Map<userId, Map<foodName, score>>
//    → userVectors: Map<userId, Map<foodId, score>>
// 2. itemSimilarities: Map<foodName, Map<foodName, score>>
//    → itemSimilarities: Map<foodId, Map<foodId, score>>
// 3. getCFScoresForUser 返回 Map<foodId, score> (已是)
// 4. implicit signal 计算中的 food_records.foods JSON 需要按 food_id 而非 food_name 匹配
```

---

### 4.8 ReplacementFeedbackInjector 餐次上下文（Phase 2-E）

**涉及文件：** `replacement-feedback-injector.service.ts`

```typescript
// V6.7: 替换权重增加餐次维度
async getWeightMap(
  userId: string,
  mealType?: string, // V6.7: 可选餐次上下文
): Promise<Map<string, ReplacementWeight>> {
  const patterns = await this.prisma.replacementPatterns.findMany({
    where: {
      userId,
      lastOccurred: { gte: subDays(new Date(), 90) },
      frequency: { gte: this.config.replacementMinFrequency },
    },
  });

  const weightMap = new Map<string, ReplacementWeight>();

  for (const p of patterns) {
    const daysSince = differenceInDays(new Date(), p.lastOccurred);
    const decayFactor = daysSince <= this.config.replacementDecayDays
      ? 1.0
      : Math.max(0.6, 1.0 - (daysSince - this.config.replacementDecayDays) / 60);

    // V6.7: 检查替换是否发生在当前餐次
    // replacement_patterns 需要新增 meal_type 字段才能精确匹配
    // 暂用软匹配：如果 pattern 有 meal_type 信息，仅在匹配时全权重，不匹配时 0.6x
    const mealTypeMatch = !mealType || !p.mealType || p.mealType === mealType;
    const mealTypeFactor = mealTypeMatch ? 1.0 : 0.6;

    // 被替换食物降权
    const fromWeight = weightMap.get(p.fromFoodId);
    const fromMultiplier = (fromWeight?.multiplier ?? 1.0)
      * this.config.replacedFromMultiplier
      * decayFactor
      * mealTypeFactor;
    weightMap.set(p.fromFoodId, {
      multiplier: Math.max(0.65, fromMultiplier),
      reason: 'replaced_from',
      decayFactor,
      mealType: p.mealType,
    });

    // 替换目标增权
    const toWeight = weightMap.get(p.toFoodId);
    const toMultiplier = (toWeight?.multiplier ?? 1.0)
      * this.config.replacedToMultiplier
      * decayFactor
      * mealTypeFactor;
    weightMap.set(p.toFoodId, {
      multiplier: Math.min(1.25, toMultiplier),
      reason: 'replaced_to',
      decayFactor,
      mealType: p.mealType,
    });
  }

  return weightMap;
}
```

**Schema 变更（replacement_patterns 新增 meal_type）：**

```sql
ALTER TABLE "replacement_patterns"
  ADD COLUMN IF NOT EXISTS "meal_type" TEXT;

CREATE INDEX IF NOT EXISTS "idx_rp_meal_type"
  ON "replacement_patterns"("meal_type");
```

---

### 4.9 LearnedRanking 升级（Phase 3-A）

**涉及文件：** `learned-ranking.service.ts`

#### Logistic Loss + L2 正则化

```typescript
// V6.7: 替换 fitWeights 方法
private fitWeights(samples: RankingSample[]): number[] {
  const dim = 12; // 评分维度数
  let weights = new Array(dim).fill(1 / dim); // 初始均匀分布
  const LAMBDA = 0.01; // L2 正则化系数

  // 训练/验证集分割 (80/20)
  const splitIdx = Math.floor(samples.length * 0.8);
  const trainSamples = samples.slice(0, splitIdx);
  const valSamples = samples.slice(splitIdx);

  let bestValLoss = Infinity;
  let bestWeights = [...weights];
  let noImproveCount = 0;

  for (let iter = 0; iter < this.MAX_ITERATIONS; iter++) {
    // Forward: logistic loss on train set
    let trainLoss = 0;
    const gradient = new Array(dim).fill(0);

    for (const sample of trainSamples) {
      const predicted = this.dotProduct(weights, sample.features);
      const sigmoid = 1 / (1 + Math.exp(-predicted));
      const error = sigmoid - sample.accepted; // accepted: 0 or 1

      trainLoss += -sample.accepted * Math.log(sigmoid + 1e-8)
        - (1 - sample.accepted) * Math.log(1 - sigmoid + 1e-8);

      for (let d = 0; d < dim; d++) {
        gradient[d] += error * sample.features[d] / trainSamples.length;
        gradient[d] += LAMBDA * weights[d]; // L2 正则化梯度
      }
    }

    // Gradient descent
    for (let d = 0; d < dim; d++) {
      weights[d] -= this.LEARNING_RATE * gradient[d];
    }

    // 投影约束：非负 + 归一化
    weights = this.projectToSimplex(weights);

    // 验证集 loss
    let valLoss = 0;
    for (const sample of valSamples) {
      const predicted = this.dotProduct(weights, sample.features);
      const sigmoid = 1 / (1 + Math.exp(-predicted));
      valLoss += -sample.accepted * Math.log(sigmoid + 1e-8)
        - (1 - sample.accepted) * Math.log(1 - sigmoid + 1e-8);
    }
    valLoss /= valSamples.length;

    // Early stopping
    if (valLoss < bestValLoss - this.CONVERGENCE_THRESHOLD) {
      bestValLoss = valLoss;
      bestWeights = [...weights];
      noImproveCount = 0;
    } else {
      noImproveCount++;
      if (noImproveCount >= 50) {
        this.logger.log(`LearnedRanking: early stopped at iter ${iter}, valLoss=${bestValLoss.toFixed(6)}`);
        break;
      }
    }
  }

  return bestWeights;
}

private projectToSimplex(w: number[]): number[] {
  // 非负投影
  w = w.map(v => Math.max(0, v));
  // 归一化
  const sum = w.reduce((s, v) => s + v, 0);
  return sum > 0 ? w.map(v => v / sum) : new Array(w.length).fill(1 / w.length);
}
```

#### 动态分群列表

```typescript
// V6.7: 从 DB 动态获取分群列表，替代硬编码 USER_SEGMENTS
private async getActiveSegments(): Promise<string[]> {
  const segments = await this.prisma.userInferredProfile.findMany({
    select: { userSegment: true },
    distinct: ['userSegment'],
    where: { userSegment: { not: null } },
  });
  return segments.map(s => s.userSegment!).filter(Boolean);
}
```

---

### 4.10 ExplanationABTracker 统计显著性（Phase 3-B）

**涉及文件：** `explanation-ab-tracker.service.ts`

```typescript
// V6.7: 替换简单阈值为卡方检验
private isStatisticallySignificant(
  acceptedA: number, totalA: number,
  acceptedB: number, totalB: number,
  alpha: number = 0.05,
): boolean {
  // 2x2 列联表卡方检验
  const a = acceptedA;           // style A accepted
  const b = totalA - acceptedA;  // style A not accepted
  const c = acceptedB;           // style B accepted
  const d = totalB - acceptedB;  // style B not accepted
  const n = a + b + c + d;

  if (n < 30) return false; // 样本不足

  const expected_a = (a + b) * (a + c) / n;
  const expected_b = (a + b) * (b + d) / n;
  const expected_c = (c + d) * (a + c) / n;
  const expected_d = (c + d) * (b + d) / n;

  // 避免除以零
  if ([expected_a, expected_b, expected_c, expected_d].some(e => e < 5)) return false;

  const chi2 = Math.pow(a - expected_a, 2) / expected_a
    + Math.pow(b - expected_b, 2) / expected_b
    + Math.pow(c - expected_c, 2) / expected_c
    + Math.pow(d - expected_d, 2) / expected_d;

  // alpha=0.05, df=1 → 临界值 3.841
  return chi2 > 3.841;
}
```

---

### 4.11 I18nMiddleware 实现（Phase 3-C）

**文件：** `apps/api-server/src/core/i18n/i18n.middleware.ts`

```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

const SUPPORTED_LOCALES = ['zh', 'en', 'ja'];

@Injectable()
export class I18nMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // 优先级：query ?lang= > Accept-Language header > 默认 zh
    const queryLang = req.query.lang as string | undefined;
    const headerLang = req.headers['accept-language']?.split(',')[0]?.split('-')[0];

    const resolved = queryLang ?? headerLang ?? 'zh';
    (req as any).locale = SUPPORTED_LOCALES.includes(resolved) ? resolved : 'zh';

    next();
  }
}
```

**注册（app.module.ts）：**

```typescript
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(I18nMiddleware).forRoutes('*');
  }
}
```

---

## Step 5：技术路线图

### Phase 1：核心缺陷修复（1-2 周）

优先级最高，修复正确性 bug 和架构缺陷：

| 编号 | 任务                                                                         | 涉及文件                                                                                | 估时 |
| ---- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ---- |
| 1-A  | ScoringContext 重构（12参数→1对象）+ 信号断路修复（waterContent/tryptophan） | `recommendation.types.ts`, `food-scorer.service.ts`, `recommendation-engine.service.ts` | 8h   |
| 1-B  | ScoringConfigService 参数中心化（42+ 魔法数字 → 运行时配置）+ Admin 端点     | `scoring-config.service.ts` (NEW), `strategy-management.controller.ts`                  | 6h   |
| 1-C  | RealisticFilter 增强（fallback bug 修复 + 技能硬过滤 + dinner/snack 场景）   | `realistic-filter.service.ts`                                                           | 4h   |
| 1-D  | MealCompositionScorer 口味和谐修正（P0-5 逻辑反转修复）                      | `meal-composition-scorer.service.ts`                                                    | 3h   |
| 1-E  | CF 食物标识统一（food name → food ID）                                       | `collaborative-filtering.service.ts`                                                    | 4h   |
| 1-F  | 清理 node-redis 残留依赖                                                     | `package.json`                                                                          | 0.5h |

**Phase 1 验收标准：**

- `scoreFoodDetailed` 仅接受单个 `ScoringContext` 参数
- sleepQuality='poor' 的用户推荐中，色氨酸丰富食物分数可观测提升
- 所有 42+ 硬编码常量可通过 Admin API 查看和修改
- RealisticFilter fallback 正确返回 top-N by commonality，而非全量
- HOME_COOK + beginner 用户看不到 advanced 难度菜品
- MealCompositionScorer 对"极甜+极辣"组合扣分
- CF 全部使用 food ID，不再引用 food name

---

### Phase 2：推荐质量提升（3-5 周）

| 编号 | 任务                                                           | 涉及文件                                                                            | 估时 |
| ---- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---- |
| 2-A  | SemanticRecall 负反馈排斥 + 多兴趣向量（k-means） + 品类分散   | `semantic-recall.service.ts`                                                        | 10h  |
| 2-B  | RecallMerger 三路统一（+CF 路）+ RecallMetadata 替代 `__` 属性 | `recall-merger.service.ts`, `cf-recall.service.ts` (NEW), `recommendation.types.ts` | 8h   |
| 2-C  | MealCompositionScorer 质感多样性 + 营养拮抗对 + 权重 5 维化    | `meal-composition-scorer.service.ts`                                                | 6h   |
| 2-D  | CF 目标感知（同目标用户相似度全权重，跨目标打折）              | `collaborative-filtering.service.ts`                                                | 4h   |
| 2-E  | ReplacementFeedback 餐次上下文 + Schema meal_type 字段         | `replacement-feedback-injector.service.ts`, Schema                                  | 4h   |
| 2-F  | LifestyleScoringAdapter mealTimingPreference 实现              | `lifestyle-scoring-adapter.service.ts`                                              | 3h   |

**Phase 2 验收标准：**

- 语义召回日志出现 `multiInterest: true` + `negativeRepulsion: applied`
- RecallMerger 日志出现 `source: 'cf'` 候选
- "全粥餐"的 textureDiversity 分数 < 40
- 菠菜+豆腐同餐触发 calcium+oxalate 拮抗扣分
- 减脂用户的 CF 推荐不包含增肌用户偏好的高热量食物
- 午餐替换的降权在晚餐减弱为 0.6x

---

### Phase 3：AI 化与工程完善（4-6 周）

| 编号 | 任务                                                                | 涉及文件                                                                | 估时 |
| ---- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- | ---- |
| 3-A  | LearnedRanking 升级（logistic loss + L2 正则 + 验证集 + 动态分群）  | `learned-ranking.service.ts`                                            | 6h   |
| 3-B  | ExplanationABTracker 统计显著性（卡方检验替代任意阈值）             | `explanation-ab-tracker.service.ts`                                     | 3h   |
| 3-C  | I18nMiddleware 实现 + 推荐结果多语言                                | `core/i18n/i18n.middleware.ts` (NEW), `app.module.ts`                   | 6h   |
| 3-D  | RecommendationEngine 部分解耦（提取 PipelineBuilder）               | `recommendation-engine.service.ts`, `pipeline-builder.service.ts` (NEW) | 10h  |
| 3-E  | LifestyleScoringAdapter 补充：fair sleep + medium stress 中间档调整 | `lifestyle-scoring-adapter.service.ts`                                  | 2h   |
| 3-F  | CF O(n²) 优化：品类分块（category blocking）                        | `collaborative-filtering.service.ts`                                    | 6h   |

**Phase 3 验收标准：**

- LearnedRanking 日志输出 trainLoss 和 valLoss，valLoss 收敛且低于 trainLoss
- ExplanationAB 切换基于 p<0.05 统计显著性
- `GET /api/app/diet/recommend?lang=en` 返回英文食物名称
- RecommendationEngineService < 1500 行
- fair sleep 用户获得轻度 tryptophan 提升（0.05 vs poor 的 0.15）
- CF 全量重建耗时减少 50%+

---

### 时间线总览

```
Week 1:   [1-A] ScoringContext 重构 + 信号修复
          [1-B] ScoringConfigService 参数中心化
Week 2:   [1-C] RealisticFilter 增强
          [1-D] MealComposition 口味修正
          [1-E] CF ID 统一
          [1-F] 清理 node-redis
Week 3:   [2-A] SemanticRecall 进化
Week 4:   [2-B] RecallMerger 三路统一
          [2-C] MealComposition 质感 + 拮抗
Week 5:   [2-D] CF 目标感知
          [2-E] ReplacementFeedback 餐次上下文
          [2-F] mealTimingPreference 实现
Week 6+:  [3-A~3-F] Phase 3 各项
```

---

## Step 6：数据迁移

### 6.1 V6.7 Schema 迁移

**迁移文件：** `prisma/migrations/20260412020000_v67_enhancements/migration.sql`

```sql
-- ==================================================
-- V6.7 Schema Changes
-- ==================================================

-- 1. replacement_patterns 新增 meal_type 字段（Phase 2-E）
ALTER TABLE "replacement_patterns"
  ADD COLUMN IF NOT EXISTS "meal_type" TEXT;

CREATE INDEX IF NOT EXISTS "idx_rp_meal_type"
  ON "replacement_patterns"("meal_type");

-- 2. feature_flag 表新增 V6.7 评分配置（Phase 1-B）
-- 通过 ScoringConfigService.onModuleInit 自动创建，无需手动 SQL

-- 3. foods 表新增 water_content_percent 字段（Phase 1-A, 信号断路修复）
ALTER TABLE "foods"
  ADD COLUMN IF NOT EXISTS "water_content_percent" DOUBLE PRECISION;

COMMENT ON COLUMN "foods"."water_content_percent" IS '食物含水率百分比(0-100), 用于 LifestyleAdapter hydration 信号';
```

### 6.2 Prisma Schema 对应变更

```prisma
// schema.prisma 修改

// foods model 新增字段
model foods {
  // ... 已有字段 ...
  water_content_percent Float?  @db.DoublePrecision  // V6.7: 含水率

  // ... 已有关系 ...
}

// replacement_patterns model 新增字段
model replacement_patterns {
  // ... 已有字段 ...
  meal_type    String?  @db.Text  // V6.7: 替换发生的餐次

  // ... 已有索引 ...
  @@index([meal_type], name: "idx_rp_meal_type")
}
```

### 6.3 含水率数据回填

**脚本：** `scripts/v6.7/backfill_water_content.sql`

```sql
-- 基于食物分类的含水率估算回填
-- 数据来源：中国食物成分表第6版典型值
BEGIN;

UPDATE "foods"
SET "water_content_percent" = CASE
  -- 高含水量 (>80%)
  WHEN category IN ('vegetable', 'fruit', 'mushroom') THEN 88
  WHEN category = 'melon' THEN 92
  WHEN tags @> '["soup"]' THEN 95
  WHEN tags @> '["congee"]' THEN 85

  -- 中含水量 (50-80%)
  WHEN category IN ('tofu', 'dairy') THEN 75
  WHEN category IN ('fish', 'seafood') THEN 72
  WHEN category IN ('pork', 'chicken', 'beef', 'lamb') THEN 65
  WHEN category = 'egg' THEN 74

  -- 低含水量 (<50%)
  WHEN category IN ('grain', 'rice', 'noodle') THEN 12
  WHEN category IN ('bread', 'pastry') THEN 35
  WHEN category IN ('nut', 'seed') THEN 5
  WHEN category = 'dried_fruit' THEN 20
  WHEN category IN ('oil', 'sauce') THEN 10

  -- 默认
  ELSE 60
END
WHERE "water_content_percent" IS NULL;

-- 验证
SELECT
  category,
  COUNT(*) AS food_count,
  ROUND(AVG(water_content_percent)::numeric, 1) AS avg_water
FROM foods
WHERE water_content_percent IS NOT NULL
GROUP BY category
ORDER BY avg_water DESC;

COMMIT;
```

### 6.4 迁移风险评估

| 迁移项                             | 风险等级 | 风险描述                                          | 缓解措施                      |
| ---------------------------------- | -------- | ------------------------------------------------- | ----------------------------- |
| replacement_patterns ADD meal_type | 低       | nullable 新字段，不影响现有查询                   | IF NOT EXISTS                 |
| foods ADD water_content_percent    | 低       | nullable 新字段，不影响现有查询                   | IF NOT EXISTS                 |
| water_content 回填                 | 低       | UPDATE 基于 category 条件，WHERE IS NULL 保证幂等 | 事务内执行，可回滚            |
| ScoringContext 重构                | 中       | FoodScorer 签名变更影响所有调用处                 | TypeScript 编译器检查所有调用 |
| CF ID 统一                         | 中       | 需全面验证 CF 输入/输出链路                       | 逐步替换 + 回归测试           |
| RecallMerger 三路合并              | 低       | 纯新增逻辑，CF 路为新增参数                       | 默认空数组兼容旧调用          |

---

## Step 7：文档差异

### 7.1 架构层面变化

| 层次           | V6.6                         | V6.7                                           | 变化 |
| -------------- | ---------------------------- | ---------------------------------------------- | ---- |
| 评分入参       | 12 个位置参数                | ScoringContext 单对象                          | 重构 |
| 信号通路       | waterContent/tryptophan 断路 | 断路修复，接入 NutrientDensity 评分            | 修复 |
| 召回路数       | 2 路（规则 + 语义）+ CF 旁路 | 3 路统一（规则 + 语义 + CF）                   | 扩展 |
| 召回元数据     | `__` ad-hoc 属性注入         | RecallMetadata 独立 Map                        | 重构 |
| 语义召回       | 单向量 + 仅正反馈            | 多兴趣向量 + 负反馈排斥 + 品类分散             | 升级 |
| 口味评分       | 高方差=好（错误）            | 口味和谐模型（覆盖度+极端惩罚+冲突检测）       | 修复 |
| 餐食组合       | 4 维                         | 5 维（+ 质感多样性）                           | 扩展 |
| 营养互补       | 4 正向对                     | 4 正向对 + 3 拮抗对                            | 扩展 |
| 现实过滤       | 无技能过滤，fallback bug     | 技能硬过滤 + dinner/snack 场景 + fallback 修复 | 增强 |
| CF 标识        | 混用 name/ID                 | 统一 food ID                                   | 修复 |
| CF 相似度      | 目标无关                     | 目标感知（跨目标 0.5x）                        | 增强 |
| 替换权重       | 全餐次统一                   | 餐次上下文（跨餐次 0.6x）                      | 增强 |
| 参数管理       | 42+ 硬编码常量               | ScoringConfigService 中心化 + Admin API        | 重构 |
| LearnedRanking | 线性回归 + L2 loss           | logistic loss + L2 正则 + 验证集               | 升级 |
| A/B 统计       | 10% 差异阈值                 | 卡方检验 p<0.05                                | 升级 |
| 国际化         | 计划未实现                   | I18nMiddleware 实现                            | 新增 |

### 7.2 新增模块汇总

| 模块                   | 文件路径                                              | Phase | 功能                     |
| ---------------------- | ----------------------------------------------------- | ----- | ------------------------ |
| ScoringConfigService   | `diet/app/recommendation/scoring-config.service.ts`   | 1-B   | 评分参数中心化管理       |
| CFRecallService        | `diet/app/recommendation/cf-recall.service.ts`        | 2-B   | CF→召回阶段适配器        |
| I18nMiddleware         | `core/i18n/i18n.middleware.ts`                        | 3-C   | Accept-Language 语言切换 |
| PipelineBuilderService | `diet/app/recommendation/pipeline-builder.service.ts` | 3-D   | 推荐管道构建器（解耦）   |

### 7.3 升级模块汇总

| 模块                                       | 变更类型  | 关键变化                                                        |
| ------------------------------------------ | --------- | --------------------------------------------------------------- |
| `recommendation.types.ts`                  | 增强      | 新增 ScoringContext, RecallMetadata, ReplacementWeight.mealType |
| `food-scorer.service.ts`                   | 重构      | 签名 12参数→ScoringContext + waterContent/tryptophan 消费       |
| `recommendation-engine.service.ts`         | 重构      | 构建 ScoringContext + 三路召回 + RecallMetadata 传递            |
| `semantic-recall.service.ts`               | 增强      | 多兴趣向量 + 负反馈排斥 + 品类分散                              |
| `recall-merger.service.ts`                 | 重构      | 三路合并 + RecallMetadata Map + 品类限额                        |
| `realistic-filter.service.ts`              | 修复+增强 | fallback bug + 技能过滤 + dinner/snack 场景                     |
| `meal-composition-scorer.service.ts`       | 修复+增强 | 口味和谐 + 质感多样性 + 营养拮抗 + 5维权重                      |
| `collaborative-filtering.service.ts`       | 重构      | food ID 统一 + 目标感知相似度                                   |
| `replacement-feedback-injector.service.ts` | 增强      | 餐次上下文 + 配置化参数                                         |
| `learned-ranking.service.ts`               | 升级      | logistic loss + L2 正则 + 验证集 + 动态分群                     |
| `explanation-ab-tracker.service.ts`        | 升级      | 卡方检验统计显著性                                              |
| `lifestyle-scoring-adapter.service.ts`     | 增强      | mealTimingPreference 实现 + fair/medium 中间档                  |

### 7.4 接口变更

#### Admin API（新增）

```
GET  /api/admin/scoring-config       — 查看当前评分配置
PUT  /api/admin/scoring-config       — 更新评分配置（partial merge）
```

#### 推荐接口（新增参数）

```
GET /api/app/diet/recommend?lang=en  — Phase 3-C, 多语言支持
```

#### 推荐响应（新增字段）

```json
{
  "recommendations": [...],
  "compositionScore": {
    "ingredientDiversity": 78,
    "cookingMethodDiversity": 65,
    "flavorHarmony": 82,           // V6.7: 替代 flavorBalance
    "nutritionComplementarity": 70,
    "textureDiversity": 75,        // V6.7: 新增
    "overall": 74
  }
}
```

### 7.5 V6.6 → V6.7 评分维度对比

| 维度            | V6.6                            | V6.7                       | 变化 |
| --------------- | ------------------------------- | -------------------------- | ---- |
| 1-12            | 不变                            | 不变                       | —    |
| Boost 1-13      | 不变                            | 不变                       | —    |
| nutrientDensity | 无 waterContent/tryptophan 加权 | 新增信号消费               | 增强 |
| 餐食组合维度    | 4 维                            | 5 维（+ textureDiversity） | 扩展 |
| 口味评分        | flavorBalance（方差模型）       | flavorHarmony（和谐模型）  | 替换 |
| 召回路数        | 2 路 + CF 旁路                  | 3 路统一                   | 扩展 |

### 7.6 已解决 vs 遗留问题清单

| 问题                             | V6.6 状态 | V6.7 解决？                       |
| -------------------------------- | --------- | --------------------------------- |
| scoreFoodDetailed 参数爆炸       | P0        | ✅ Phase 1-A ScoringContext       |
| waterContent/tryptophan 信号断路 | P0        | ✅ Phase 1-A 信号修复             |
| RealisticFilter fallback bug     | P0        | ✅ Phase 1-C 修复                 |
| CF/Replacement ID 不一致         | P0        | ✅ Phase 1-E 统一                 |
| MealComposition 口味逻辑反转     | P0        | ✅ Phase 1-D 修复                 |
| 42+ 硬编码魔法数字               | P3        | ✅ Phase 1-B ScoringConfigService |
| SemanticRecall 无负反馈          | P1        | ✅ Phase 2-A                      |
| SemanticRecall 单向量            | P1        | ✅ Phase 2-A 多兴趣               |
| 无技能过滤                       | P1        | ✅ Phase 1-C                      |
| dinner/snack 无场景调整          | P1        | ✅ Phase 1-C                      |
| CF 无目标感知                    | P1        | ✅ Phase 2-D                      |
| 替换反馈无餐次上下文             | P1        | ✅ Phase 2-E                      |
| mealTimingPreference 未实现      | P1        | ✅ Phase 2-F                      |
| LearnedRanking L2 loss           | P2        | ✅ Phase 3-A logistic loss        |
| LearnedRanking 无正则化/验证     | P2        | ✅ Phase 3-A L2 + validation      |
| ExplanationAB 无统计检验         | P2        | ✅ Phase 3-B 卡方检验             |
| MealComposition 无质感维度       | P2        | ✅ Phase 2-C                      |
| MealComposition 营养拮抗缺失     | P2        | ✅ Phase 2-C                      |
| RecallMerger 未集成 CF           | P3        | ✅ Phase 2-B 三路统一             |
| RecallMerger ad-hoc 属性         | P3        | ✅ Phase 2-B RecallMetadata       |
| I18nMiddleware 未实现            | P3        | ✅ Phase 3-C                      |
| node-redis 残留                  | P3        | ✅ Phase 1-F                      |
| CF O(n²)                         | P2        | 🔄 Phase 3-F 品类分块             |
| God Class 2120 行                | P3        | 🔄 Phase 3-D 部分解耦             |
| OpenTelemetry 分布式追踪         | P3        | ❌ 延至 V6.8                      |

---

> **V6.7 设计原则：**
>
> - Phase 1 优先正确性修复（P0 bug + 架构缺陷），不引入新功能
> - Phase 2 所有推荐质量改进向后兼容，语义召回/CF 召回的新路仅补充不主导
> - Phase 3 通过 feature_flag 灰度控制，LearnedRanking 和 I18n 独立上线
> - 每个 Phase 完成后运行 `pnpm exec tsc --noEmit` 验证编译，`prisma validate` 验证 schema
> - ScoringConfigService 实现后，所有后续任务优先从中心化配置读取参数
