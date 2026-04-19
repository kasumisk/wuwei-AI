# 智能饮食系统 V6.8 升级方案

> 基于 V6.7 架构的版本演进设计，非重新设计。
> 所有升级不影响已有接口，保留已有模块设计。
> 日期：2026-04-12

---

## 目录

1. [Step 1：V6.7 能力评估](#step-1v67-能力评估)
2. [Step 2：核心升级方向](#step-2核心升级方向)
3. [Step 3：架构升级设计](#step-3架构升级设计)
4. [Step 4：模块级升级设计](#step-4模块级升级设计)
5. [Step 5：技术路线图](#step-5技术路线图)
6. [Step 6：数据迁移](#step-4数据迁移)
7. [Step 7：文档差异](#step-7文档差异)

---

## Step 1：V6.7 能力评估

### 1.1 V6.7 已达成能力

| 层次          | 已达成                                                                                                                     |
| ------------- | -------------------------------------------------------------------------------------------------------------------------- |
| **评分管道**  | ScoringContext 统一入参，12 维评分 + 13 层 Boost，ScoringConfigService 参数中心化（31 参数），NOVA 五级基准                |
| **召回架构**  | 三路召回（Rule/Semantic/CF）+ RecallMerger 统一融合 + RecallMetadata 溯源                                                  |
| **餐食组合**  | 5 维组合评分（ingredientDiversity + cookingMethodDiversity + flavorHarmony + nutritionComplementarity + textureDiversity） |
| **排序学习**  | LearnedRanking logistic loss + L2 正则 + 验证集 early stopping                                                             |
| **用户画像**  | RealtimeProfile 7 天滑动窗口 + ContextualProfile 10 场景 + ProfileResolver 5 层聚合                                        |
| **策略系统**  | 3 层优先级（USER > GOAL_TYPE > GLOBAL）+ 9 子配置段 + StrategyAutoTuner 周级自动调优                                       |
| **管道架构**  | PipelineBuilder 三阶段（Recall → Rank → Rerank）+ Thompson Sampling 探索/利用                                              |
| **现实过滤**  | RealisticFilter 技能/场景/频道多维过滤 + 食堂大众化阈值                                                                    |
| **解释系统**  | ExplanationGenerator 多层解释 + ExplanationABTracker 卡方检验                                                              |
| **替换反馈**  | ReplacementFeedbackInjector 餐次上下文 + 替换模式衰减                                                                      |
| **协同过滤**  | CF 目标感知 + 品类分块 + ID 统一                                                                                           |
| **i18n 基础** | I18nMiddleware + RequestContextService + i18n-messages.ts 消息目录 + FoodI18nService                                       |
| **预计算**    | 每日 03:00 批量 + 事件驱动单用户重算（5 分钟去抖）                                                                         |
| **通知系统**  | FCM 推送 + 站内信 + 设备管理 + 7 种通知类型                                                                                |
| **缓存**      | TieredCacheManager L1 内存 + L2 Redis 双层                                                                                 |
| **数据模型**  | 48+ Prisma models，foods 70+ 字段，pgvector embedding                                                                      |

### 1.2 V6.7 遗留问题诊断

#### P0：评分器硬编码与信号完整性

- **P0-1**：`food-scorer.service.ts` 仍有 **60+ 硬编码常量**未纳入 `ScoringConfigSnapshot`，包括蛋白质范围、GI sigmoid 参数、NOVA 微调阈值、炎症公式系数、NRF gap bonus 参数、烹饪时间阈值、品类水含量/GI 估算 map
- **P0-2**：Lifestyle 信号 `waterContent` 和 `tryptophan` 存在**双重消费**——`food-scorer.service.ts` 的 `lifestyleAdjustment` 直接修改 `nutrientDensityScore`，同时 `pipeline-builder.service.ts` 也将 lifestyle adjustments 合并入 `nutritionGaps`，同一信号被两条路径叠加
- **P0-3**：`addedSugarPenalty` 使用加法惩罚（`-penaltyPerGrams * sugar`），与 NOVA 的乘法惩罚（`novaBase[level]`）逻辑不一致，高糖 + 高 NOVA 的食物可能被双重惩罚但两种惩罚的交互不可控
- **P0-4**：NRF 9.3 gap bonus 是二值的（`>=15% DV → +20`），没有连续函数——15.1% DV 和 100% DV 获得相同 +20 bonus

#### P1：用户画像与个性化不足

- **P1-1**：`ProfileResolver.buildContext()` 是纯平铺映射，**无跨层冲突解决**——declared `goal=fat_loss` 但 observed 持续热量超标时无任何调和
- **P1-2**：`ContextualProfile.refineWithBehavior()` 近乎空操作——仅处理 weekend_brunch 和 late_night 两种场景，不使用 `complianceTrend`、`avgCaloriesPerDay`、`categoryPreferences` 等已有信号
- **P1-3**：ProfileResolver 对 V6.6 lifestyle 字段（sleepQuality/stressLevel/hydrationGoal/supplementsUsed/mealTimingPreference）全部使用 `(declared as any)` 访问，Prisma schema 未完整映射
- **P1-4**：用户画像无新鲜度检测——2 年前设置的 declared profile 与昨天设置的权重相同

#### P2：学习与替换质量

- **P2-1**：WeightLearner 使用**均匀梯度**而非 per-dimension 梯度——recommendation trace 已存储 `dimensionScores` 但 learner 完全不读取，无法识别"哪个维度导致了拒绝"
- **P2-2**：WeightLearner 无用户级个性化——按 `goalType` 全局学习，同目标不同偏好的用户获得相同权重调整
- **P2-3**：WeightLearner 14 天窗口内所有反馈等权，无时间衰减
- **P2-4**：替换服务 `nutritionProximity` 仅比较 calories(60%) + protein(40%)，**无血糖兼容性**（GI/GL）、**无微量营养素等价**（铁/钙/纤维）、**无脂肪/碳水**
- **P2-5**：冲突解决器是单次替换，三重冲突可能不完全解决

#### P3：i18n 与工程基础设施

- **P3-1**：i18n locale mismatch——`I18nMiddleware` 设置 `zh`/`en`/`ja` 但 `i18n-messages.ts` 使用 `zh-CN`/`en-US`/`ja-JP`，无映射层
- **P3-2**：`i18n-messages.ts` 使用全局可变 `currentLocale`，并发请求下线程不安全
- **P3-3**：**150+ 硬编码中文字符串**分布在 13+ 文件中（explanation-generator ~35、health-modifier-engine ~28、nutrition-score ~16、controllers ~30+、export ~25、behavior ~9、meal-assembler/ab-testing/food.service 等）
- **P3-4**：`i18n-messages.ts` 消息目录缺少 health modifier reasons、nutrition highlights、behavior notifications、CSV headers、controller responses、filter reasons 的 key
- **P3-5**：`StrategyAutoTuner` 的 `SEGMENT_STRATEGY_MAP` 是进程内存 `const` 对象——多实例部署下无跨实例同步，不同实例提供不同策略，污染 A/B 分析数据
- **P3-6**：`StrategyAutoTuner` 最小样本量 = 5，统计显著性不足
- **P3-7**：`SEGMENT_STRATEGY_MAP` 只有 7 个硬编码 segment，无动态 segment 发现
- **P3-8**：`FoodFilterService` 与 `recallCandidates` 阶段有功能重叠（品类过滤在 recall 和 filter 都执行）

---

## Step 2：核心升级方向

基于 V6.7 遗留问题和深度审计结果，确定 **8 个核心升级点**，按 Phase 1/2/3 分层：

### 升级点 1：评分参数全量外部化 — 60+ 常量迁入 ScoringConfigSnapshot

**为什么需要：** V6.7 的 `ScoringConfigService` 已外部化 31 个参数，但 `food-scorer.service.ts` 仍有 60+ 硬编码常量（蛋白质范围、GI sigmoid、NOVA 微调、炎症公式、NRF gap、烹饪时间、品类 map）。这些参数无法运行时调整，每次微调都需要代码发布。

**解决什么问题：** P0-1、P0-3、P0-4

### 升级点 2：Lifestyle 信号修复 — 双重消费去重 + 维度扩展

**为什么需要：** `waterContent` 和 `tryptophan` 信号在 food-scorer 和 pipeline-builder 两条路径被消费，导致不可控的双重加权。同时 lifestyle 维度缺少运动强度、酒精/吸烟状态等关键因素。

**解决什么问题：** P0-2

### 升级点 3：WeightLearner 精准化 — dimensionScores 接入 + 用户级学习

**为什么需要：** Trace 服务已持久化每个食物的 `dimensionScores`（12 维原始分数），但 WeightLearner 仍使用均匀梯度，无法识别是哪个评分维度导致了用户不满意。同时缺少用户级和餐次级粒度。

**解决什么问题：** P2-1、P2-2、P2-3

### 升级点 4：用户画像冲突解决与行为深化

**为什么需要：** ProfileResolver 的 5 层合并是纯平铺，无冲突检测和调和。ContextualProfile 的 `refineWithBehavior` 近乎空操作，大量行为信号被忽略。

**解决什么问题：** P1-1、P1-2、P1-4

### 升级点 5：替换服务营养等价升级 — 血糖 + 微量营养素 + 场景

**为什么需要：** 替换服务的营养接近度仅比较 calories + protein，高 GI 食物替换低 GI 食物、微量营养素差异大的替换都会被当作"好替换"。

**解决什么问题：** P2-4

### 升级点 6：i18n 体系完善 — locale 修复 + 硬编码清理 + 线程安全

**为什么需要：** 当前 i18n 有三个根本性问题：locale 格式不匹配（middleware vs messages）、全局可变状态导致并发不安全、150+ 硬编码中文字符串绕过翻译系统。

**解决什么问题：** P3-1、P3-2、P3-3、P3-4

### 升级点 7：策略系统分布式升级 — Redis 同步 + 统计增强

**为什么需要：** `SEGMENT_STRATEGY_MAP` 是进程内存对象，多实例部署下各实例策略不一致，污染 A/B 分析。同时最小样本量 = 5 的统计信度不足。

**解决什么问题：** P3-5、P3-6、P3-7

### 升级点 8：冲突解决器多轮迭代 + 管道健壮性

**为什么需要：** 冲突解决器是单次替换，三重冲突可能未完全解决。FoodFilter 与 Recall 存在功能重叠。

**解决什么问题：** P2-5、P3-8

---

## Step 3：架构升级设计

### 3.1 推荐管道架构演进

**V6.7 管道（保持不变）：**

```
User Request
  → ProfileResolver（5 层聚合）
  → ConstraintGenerator
  → PipelineBuilder（Recall → Rank → Rerank）
    ├── RuleRecall + SemanticRecall + CFRecall
    ├── RecallMerger（三路融合）
    ├── FoodFilter
    ├── FoodScorer（12 维）
    ├── LearnedRanking
    ├── RealisticFilter
    ├── MealCompositionScorer（5 维）
    └── ExplanationGenerator
  → Response
```

**V6.8 增量变化：**

```
User Request
  → ProfileResolver（5 层聚合 + [UPGRADE] 冲突解决层）
  → ConstraintGenerator
  → PipelineBuilder（Recall → Rank → Rerank）
    ├── RuleRecall + SemanticRecall + CFRecall
    ├── RecallMerger（三路融合）
    ├── [UPGRADE] FoodFilter（去重 Recall 重叠逻辑）
    ├── [UPGRADE] FoodScorer（12 维 + 全量外部化参数 + lifestyle 去重）
    ├── [UPGRADE] LearnedRanking（+ dimensionScores 精准梯度）
    ├── [UPGRADE] ConflictResolver（多轮迭代）
    ├── RealisticFilter
    ├── MealCompositionScorer（5 维）
    ├── [UPGRADE] SubstitutionService（营养等价 + 血糖兼容）
    └── ExplanationGenerator
  → Response

[UPGRADE] StrategyAutoTuner（Redis 同步 + 统计增强）
[UPGRADE] i18n pipeline（locale 修复 + 消息补全 + 线程安全）
[UPGRADE] WeightLearner（dimensionScores + 用户级 + 餐次级）
[UPGRADE] LifestyleScoringAdapter（去重路径 + 维度扩展）
```

### 3.2 核心架构变化

```
recommendation/
├── [UPGRADE]  food-scorer.service.ts          # 全量参数外部化
├── [UPGRADE]  scoring-config.service.ts       # ScoringConfigSnapshot V2 扩展
├── [UPGRADE]  recommendation.types.ts         # 新增类型定义
├── [UPGRADE]  weight-learner.service.ts       # dimensionScores + 用户级
├── [UPGRADE]  substitution.service.ts         # 营养等价 + 血糖
├── [UPGRADE]  lifestyle-scoring-adapter.service.ts  # 去重 + 扩展
├── [UPGRADE]  food-filter.service.ts          # 去重 Recall 重叠
├── [UPGRADE]  pipeline-builder.service.ts     # lifestyle 路径修复
├── [UPGRADE]  ab-testing.service.ts           # i18n 清理
├── [UPGRADE]  explanation-generator.service.ts # i18n 清理
├── [UPGRADE]  recommendation-engine.service.ts # i18n 清理
├── [UPGRADE]  meal-assembler.service.ts        # i18n 清理
├── [UPGRADE]  recommendation.config.ts         # i18n 清理
user/
├── [UPGRADE]  profile-resolver.service.ts     # 冲突解决层
├── [UPGRADE]  contextual-profile.service.ts   # refineWithBehavior 重建
strategy/
├── [UPGRADE]  strategy-auto-tuner.service.ts  # Redis 同步
├── [UPGRADE]  strategy.types.ts               # 新增 segment 类型
diet/app/
├── [UPGRADE]  behavior.service.ts             # i18n 清理
├── [UPGRADE]  nutrition-score.service.ts       # i18n 清理
├── [UPGRADE]  food.service.ts                 # i18n 清理
├── [UPGRADE]  export.service.ts               # i18n 清理
core/
├── [UPGRADE]  i18n/i18n.middleware.ts          # locale 映射修复
├── [UPGRADE]  i18n-messages.ts                # 消息目录扩展 + 线程安全
health/
├── [UPGRADE]  health-modifier-engine.service.ts # i18n 清理
```

### 3.3 数据流变化

**V6.7 ScoringConfigSnapshot（31 参数）→ V6.8 ScoringConfigSnapshot V2（90+ 参数）：**

新增参数分组：

- `proteinRanges`: 每目标蛋白质理想范围
- `energyPenalties`: 目标不对称惩罚系数
- `giSigmoid`: GL sigmoid 参数 + 品类 GI map
- `novaMicroAdjust`: NOVA 微调阈值和调整量
- `inflammationFormula`: 炎症公式各项系数
- `nrfGapBonus`: gap 阈值 + 连续函数参数
- `executabilityThresholds`: 烹饪时间阈值 + 便利分
- `categoryWaterMap`: 品类含水量估算
- `categoryGiMap`: 品类 GI 估算
- `substitutionProximity`: 替换营养接近度各因子权重

**WeightLearner 数据流变化：**

```
V6.7: feedback → uniform gradient → global goalType weights
V6.8: feedback + trace.dimensionScores → per-dimension gradient → user-level + goalType weights
```

**Lifestyle 信号流修复：**

```
V6.7（双重消费）:
  LifestyleAdapter → adjustments → food-scorer (path 1: 直接修改 nutrientDensityScore)
  LifestyleAdapter → adjustments → pipeline-builder (path 2: 合入 nutritionGaps)
  结果：waterContent/tryptophan 被叠加两次

V6.8（单路径）:
  LifestyleAdapter → adjustments → pipeline-builder → nutritionGaps (唯一消费路径)
  food-scorer: 移除 lifestyle 直接消费逻辑，仅通过 nutritionGaps 影响评分
```

---

## Step 4：模块级升级设计

### 4.1 评分参数全量外部化 — ScoringConfigSnapshot V2（Phase 1-A）

**涉及文件：**

- `recommendation/scoring-config.service.ts`
- `recommendation/recommendation.types.ts`
- `recommendation/food-scorer.service.ts`
- `admin/scoring-config.controller.ts`

**目标：** 将 food-scorer.service.ts 中 60+ 硬编码常量全部迁入 ScoringConfigSnapshot，通过 ScoringConfigService 管理，支持 Admin API 运行时修改。

**4.1.1 ScoringConfigSnapshot V2 类型扩展**

在 `recommendation.types.ts` 的 `ScoringConfigSnapshot` 接口新增以下字段：

```typescript
// V6.8: 蛋白质评分范围 — 每目标类型的理想蛋白质热量占比范围
proteinRangeByGoal: Record<string, [number, number]>;
// 默认: { fat_loss: [0.25, 0.35], muscle_gain: [0.25, 0.4], health: [0.15, 0.25], habit: [0.12, 0.3] }

// V6.8: 蛋白质评分曲线参数
proteinBelowRangeCoeff: number;    // 默认 0.3 — 低于范围时的线性斜率
proteinBelowRangeBase: number;     // 默认 0.7 — 低于范围时的基础分
proteinAboveRangeDecay: number;    // 默认 0.5 — 超出范围时的衰减系数
proteinAboveRangeDiv: number;      // 默认 0.15 — 超出范围时的分母

// V6.8: 能量评分不对称惩罚
energyFatLossPenalty: number;      // 默认 0.85 — 减脂超标惩罚
energyMuscleGainPenalty: number;   // 默认 0.9 — 增肌不足惩罚
energyDefaultScore: number;        // 默认 0.8 — target<=0 时默认分
proteinDefaultScore: number;       // 默认 0.8 — calories<=0 时默认分

// V6.8: GI/GL 评分参数
giDefaultScore: number;            // 默认 0.75 — 无法估算时默认分
glSigmoidSlope: number;            // 默认 0.3 — GL sigmoid 斜率
glSigmoidCenter: number;           // 默认 15 — GL sigmoid 中心点
categoryGiMap: Record<string, number>; // 品类 GI 估算 map
giFallback: number;                // 默认 55 — 品类未知时 fallback GI
giProcessingStep: number;          // 默认 5 — 每 NOVA 级加工 GI 增量
giFiberReduction: number;          // 默认 2 — 每克纤维 GI 减量
giFiberReductionCap: number;       // 默认 15 — 纤维 GI 减量上限

// V6.8: NRF 9.3 gap bonus — 改为连续函数
nrfGapThreshold: number;           // 默认 15 — 最低 %DV 才触发 bonus
nrfGapMaxBonus: number;            // 默认 20 — 单营养素最大 bonus（旧值=20 二值，新值=连续上限）
nrfGapTotalCap: number;            // 默认 80 — 总 bonus 上限
nrfGapContinuous: boolean;         // 默认 true — V6.8 启用连续函数

// V6.8: NOVA 微调参数
novaHighFiberThreshold: number;    // 默认 3 — g/100g
novaHighFiberRelief: number;       // 默认 0.05
novaLowSugarThreshold: number;    // 默认 5 — g
novaLowSugarRelief: number;       // 默认 0.05
novaLowSatFatThreshold: number;   // 默认 3 — g
novaLowSatFatRelief: number;      // 默认 0.05
novaHighSodiumThreshold: number;  // 默认 800 — mg
novaHighSodiumPenalty: number;    // 默认 0.05
novaClampMin: [number, number];   // 默认 [0.75, 0.45] — NOVA 3/4 下限
novaClampMax: [number, number];   // 默认 [0.95, 0.7] — NOVA 3/4 上限

// V6.8: 炎症公式系数
inflammTransFatDiv: number;        // 默认 2
inflammTransFatMax: number;        // 默认 50
inflammSatFatDiv: number;          // 默认 10
inflammSatFatMax: number;          // 默认 30
inflammFiberDiv: number;           // 默认 5
inflammFiberMax: number;           // 默认 40

// V6.8: 烹饪便利阈值
cookTimeQuick: number;             // 默认 15 — 分钟
cookTimeQuickScore: number;        // 默认 1.0
cookTimeMedium: number;            // 默认 30
cookTimeMediumScore: number;       // 默认 0.8
cookTimeLong: number;              // 默认 60
cookTimeLongScore: number;         // 默认 0.5
cookTimeZeroScore: number;         // 默认 0.8 — 免烹饪

// V6.8: 品类含水量估算 map
categoryWaterMap: Record<string, number>;

// V6.8: Lifestyle 调整参数
lifestyleWaterHighThreshold: number;    // 默认 80
lifestyleWaterHighMultiplier: number;   // 默认 0.8
lifestyleWaterMedThreshold: number;     // 默认 60
lifestyleWaterMedMultiplier: number;    // 默认 0.4
lifestyleTryptophanTags: string[];      // 默认 ['poultry','dairy',...]

// V6.8: 替换营养接近度权重
substitutionWeights: {
  calories: number;   // 默认 0.25
  protein: number;    // 默认 0.20
  fat: number;        // 默认 0.15
  carbs: number;      // 默认 0.15
  gi: number;         // 默认 0.15
  micronutrients: number; // 默认 0.10
};

// V6.8: 杂项默认值
defaultQualityScore: number;       // 默认 5
defaultSatietyScore: number;       // 默认 4
defaultMealCalorieTarget: number;  // 默认 400
defaultCarbFatScore: number;       // 默认 0.5
defaultConfidence: number;         // 默认 0.5
maxAddedSugarPenalty: number;      // 默认 -15
rangeOutPenaltySteepness: number;  // 默认 2
```

**4.1.2 ScoringConfigService 变更**

```typescript
// V6.8: 扩展默认值 — 新增全量参数的 defaults
private readonly DEFAULTS_V68: Partial<ScoringConfigSnapshot> = {
  // 蛋白质
  proteinRangeByGoal: {
    fat_loss: [0.25, 0.35], muscle_gain: [0.25, 0.4],
    health: [0.15, 0.25], habit: [0.12, 0.3],
  },
  proteinBelowRangeCoeff: 0.3,
  proteinBelowRangeBase: 0.7,
  proteinAboveRangeDecay: 0.5,
  proteinAboveRangeDiv: 0.15,
  // 能量
  energyFatLossPenalty: 0.85,
  energyMuscleGainPenalty: 0.9,
  energyDefaultScore: 0.8,
  proteinDefaultScore: 0.8,
  // GI/GL
  giDefaultScore: 0.75,
  glSigmoidSlope: 0.3,
  glSigmoidCenter: 15,
  categoryGiMap: {
    grain: 70, vegetable: 35, fruit: 40, dairy: 45,
    legume: 35, nut: 25, protein: 55, beverage: 65,
    snack: 60, other: 40,
  },
  giFallback: 55,
  giProcessingStep: 5,
  giFiberReduction: 2,
  giFiberReductionCap: 15,
  // NRF gap
  nrfGapThreshold: 15,
  nrfGapMaxBonus: 20,
  nrfGapTotalCap: 80,
  nrfGapContinuous: true,
  // NOVA 微调
  novaHighFiberThreshold: 3,
  novaHighFiberRelief: 0.05,
  novaLowSugarThreshold: 5,
  novaLowSugarRelief: 0.05,
  novaLowSatFatThreshold: 3,
  novaLowSatFatRelief: 0.05,
  novaHighSodiumThreshold: 800,
  novaHighSodiumPenalty: 0.05,
  novaClampMin: [0.75, 0.45],
  novaClampMax: [0.95, 0.7],
  // 炎症
  inflammTransFatDiv: 2,
  inflammTransFatMax: 50,
  inflammSatFatDiv: 10,
  inflammSatFatMax: 30,
  inflammFiberDiv: 5,
  inflammFiberMax: 40,
  // 烹饪
  cookTimeQuick: 15,
  cookTimeQuickScore: 1.0,
  cookTimeMedium: 30,
  cookTimeMediumScore: 0.8,
  cookTimeLong: 60,
  cookTimeLongScore: 0.5,
  cookTimeZeroScore: 0.8,
  // 品类水含量
  categoryWaterMap: {
    vegetable: 90, fruit: 85, beverage: 95, dairy: 87,
    protein: 65, grain: 12, legume: 55, nut: 5,
    oil: 0, other: 50,
  },
  // Lifestyle
  lifestyleWaterHighThreshold: 80,
  lifestyleWaterHighMultiplier: 0.8,
  lifestyleWaterMedThreshold: 60,
  lifestyleWaterMedMultiplier: 0.4,
  lifestyleTryptophanTags: ['poultry','dairy','banana','oats','eggs','seeds','nuts','turkey'],
  // 替换
  substitutionWeights: {
    calories: 0.25, protein: 0.20, fat: 0.15,
    carbs: 0.15, gi: 0.15, micronutrients: 0.10,
  },
  // 杂项
  defaultQualityScore: 5,
  defaultSatietyScore: 4,
  defaultMealCalorieTarget: 400,
  defaultCarbFatScore: 0.5,
  defaultConfidence: 0.5,
  maxAddedSugarPenalty: -15,
  rangeOutPenaltySteepness: 2,
};
```

Feature flag key 升级为 `scoring_config_v68`，但保持向后兼容——先读 v68，无数据时 fallback 读 v67 再 merge defaults。

**4.1.3 food-scorer.service.ts 变更**

将所有硬编码常量替换为从 `this.scoringConfig` 读取。示例：

```typescript
// V6.7: 硬编码
const [lo, hi] = goal === 'fat_loss' ? [0.25, 0.35] : ...;

// V6.8: 外部化
const ranges = this.scoringConfig.proteinRangeByGoal;
const [lo, hi] = ranges[goal] ?? ranges['health'];
```

```typescript
// V6.7: 二值 gap bonus
if (pctDv >= 15) totalBonus += 20;

// V6.8: 连续函数（可通过 nrfGapContinuous 开关控制）
if (cfg.nrfGapContinuous) {
  if (pctDv >= cfg.nrfGapThreshold) {
    // 线性连续: bonus = maxBonus * min(1, (pctDv - threshold) / (100 - threshold))
    const ratio = Math.min(1, (pctDv - cfg.nrfGapThreshold) / (100 - cfg.nrfGapThreshold));
    totalBonus += cfg.nrfGapMaxBonus * ratio;
  }
} else {
  // 兼容 V6.7 二值逻辑
  if (pctDv >= cfg.nrfGapThreshold) totalBonus += cfg.nrfGapMaxBonus;
}
```

**验收标准：**

- `food-scorer.service.ts` 中不再有 magic number（除 0/1/100 等数学常量）
- 所有新增参数有 Admin API GET/PATCH 支持
- NRF gap bonus 改为连续函数，旧行为可通过 `nrfGapContinuous=false` 恢复
- `pnpm exec tsc --noEmit` 编译通过

---

### 4.2 Lifestyle 双重消费修复 + 维度扩展（Phase 1-B）

**涉及文件：**

- `recommendation/food-scorer.service.ts`
- `recommendation/pipeline-builder.service.ts`
- `recommendation/lifestyle-scoring-adapter.service.ts`

**目标：** 消除 lifestyle 信号的双重消费路径，建立唯一消费通道。扩展 lifestyle 维度。

**4.2.1 消除双重消费**

`food-scorer.service.ts` 中 `lifestyleAdjustment` 的直接消费代码（当前 lines 185-229）将被移除。Lifestyle 信号改为仅通过 `pipeline-builder.service.ts` → `nutritionGaps` 路径消费。

```typescript
// V6.7 food-scorer.service.ts (移除):
// private applyLifestyleAdjustment(score, food, adjustments, cfg) {
//   if (adjustments['waterContent'] && food.waterContentPercent > 80) ...
//   if (adjustments['tryptophan'] && tryptophanTags.includes(...)) ...
// }

// V6.8: food-scorer 不再有 lifestyle 直接修改逻辑
// 所有 lifestyle 影响统一通过 nutritionGaps → nutrientDensityScore 路径
```

`pipeline-builder.service.ts` 的 lifestyle 合并逻辑保持不变，但增加防重复保护：

```typescript
// V6.8: pipeline-builder 合并 lifestyle 时添加 consumed 标记
const lifestyleGaps = this.lifestyleAdapter.getAdjustments(profile);
// 标记已消费，防止其他路径重复读取
lifestyleGaps.__consumed = true;
Object.entries(lifestyleGaps).forEach(([key, val]) => {
  if (key === '__consumed') return;
  nutritionGaps[key] = (nutritionGaps[key] ?? 0) + val;
});
```

**4.2.2 Lifestyle 维度扩展**

`lifestyle-scoring-adapter.service.ts` 新增处理维度：

```typescript
// V6.8: 运动恢复（如果 profile 有 exerciseIntensity）
if (lifestyle.exerciseIntensity === 'high') {
  adjustments['protein'] = (adjustments['protein'] ?? 0) + 0.12;
  adjustments['potassium'] = (adjustments['potassium'] ?? 0) + 0.08;
}

// V6.8: 调整总量封顶 — 每个营养素最大 ±0.25
for (const [key, val] of Object.entries(adjustments)) {
  adjustments[key] = Math.max(-0.25, Math.min(0.25, val));
}
```

**验收标准：**

- `food-scorer.service.ts` 不再有 `lifestyleAdjustment` 直接消费逻辑
- Lifestyle 信号仅通过 `nutritionGaps` 一条路径影响评分
- 每个营养素调整封顶 ±0.25
- 编译通过

---

### 4.3 NRF Gap Bonus 连续化 + 添加糖惩罚一致性（Phase 1-C）

**涉及文件：**

- `recommendation/food-scorer.service.ts`

**目标：** NRF 9.3 gap bonus 从二值改为连续函数。添加糖惩罚改为乘法形式，与 NOVA 一致。

**4.3.1 NRF Gap 连续函数**

已在 4.1.3 描述。关键公式：

```
bonus = nrfGapMaxBonus × min(1, (pctDv - threshold) / (100 - threshold))
```

这使得 15.1% DV 获得小 bonus（~0.06），100% DV 获得满 bonus（20），而不是原来的 15.1% = 100% = 20。

**4.3.2 添加糖惩罚一致性**

```typescript
// V6.7: 加法惩罚
const sugarPenalty = Math.max(
  cfg.maxAddedSugarPenalty,
  -cfg.addedSugarPenaltyPerGrams * addedSugar
);
nrf += sugarPenalty; // 加法

// V6.8: 改为乘法惩罚，与 NOVA 一致
// penalty factor: 1.0 → 衰减到 floor
// sugarFactor = max(floor, 1 - slope * addedSugar)
const sugarSlope = cfg.addedSugarPenaltyPerGrams / 100; // 归一化
const sugarFloor = 1.0 + cfg.maxAddedSugarPenalty / 100; // 转为乘法 floor
const sugarFactor = Math.max(sugarFloor, 1 - sugarSlope * addedSugar);
// 应用为乘法: nrf *= sugarFactor
nrf *= sugarFactor;
```

**验收标准：**

- NRF gap bonus 输出随 %DV 线性增长（15% → 0, 100% → maxBonus）
- 添加糖使用乘法惩罚
- 两种改动都可通过 ScoringConfig 开关回退到 V6.7 行为

---

### 4.4 ProfileResolver 冲突解决层（Phase 1-D）

**涉及文件：**

- `user/profile-resolver.service.ts`
- `recommendation/recommendation.types.ts`

**目标：** 在 ProfileResolver 的 5 层合并后增加冲突检测与调和层。

**4.4.1 冲突检测**

```typescript
// V6.8: 冲突检测接口
interface ProfileConflict {
  field: string;
  declaredValue: any;
  observedValue: any;
  resolution: 'use_declared' | 'use_observed' | 'blend';
  confidence: number;
  reason: string;
}

// V6.8: EnrichedProfileContext 新增
interface EnrichedProfileContext {
  // ... 现有字段
  conflicts: ProfileConflict[]; // V6.8: 检测到的跨层冲突
  profileFreshness: number; // V6.8: declared 新鲜度 0-1
}
```

**4.4.2 冲突解决逻辑**

在 `buildContext()` 末尾新增 `resolveConflicts()` 方法：

```typescript
// V6.8: 冲突解决
private resolveConflicts(context: EnrichedProfileContext, declared: any, observed: any): void {
  const conflicts: ProfileConflict[] = [];

  // 1. 新鲜度计算
  const daysSinceUpdate = declared.updated_at
    ? (Date.now() - new Date(declared.updated_at).getTime()) / 86400000
    : 365;
  context.profileFreshness = Math.max(0, 1 - daysSinceUpdate / 180); // 半年衰减到 0

  // 2. 目标 vs 行为冲突
  if (context.declared.goal === 'fat_loss' && observed?.avgCaloriesPerDay) {
    const targetCal = context.nutritionTargets?.calories ?? 2000;
    if (observed.avgCaloriesPerDay > targetCal * 1.2) {
      conflicts.push({
        field: 'goal_compliance',
        declaredValue: 'fat_loss',
        observedValue: `avg ${observed.avgCaloriesPerDay} kcal (target ${targetCal})`,
        resolution: context.profileFreshness > 0.5 ? 'use_declared' : 'blend',
        confidence: Math.min(1, observed.feedbackCount / 30),
        reason: 'declared_goal_conflicts_with_observed_intake',
      });
    }
  }

  // 3. 活动水平 vs 实际
  // 4. 烹饪技能 vs 实际选择模式
  // ... 其他冲突规则

  context.conflicts = conflicts;
}
```

**验收标准：**

- `EnrichedProfileContext` 包含 `conflicts[]` 和 `profileFreshness`
- 至少支持 3 种冲突检测规则
- 冲突数据可在 trace 中查看
- 编译通过

---

### 4.5 ContextualProfile refineWithBehavior 重建（Phase 1-E）

**涉及文件：**

- `user/contextual-profile.service.ts`

**目标：** 重建 `refineWithBehavior()` 方法，使其真正利用行为信号调整场景检测结果。

**4.5.1 行为信号消费**

```typescript
// V6.8: 重建 refineWithBehavior
private refineWithBehavior(
  scene: ContextScene,
  modifiers: SceneWeightModifiers,
  shortTerm: ShortTermProfile | null,
): { scene: ContextScene; modifiers: SceneWeightModifiers } {
  if (!shortTerm) return { scene, modifiers };

  const refined = { ...modifiers };

  // 1. 依从性趋势影响: 如果依从性下降, 增加饱腹感和可执行性权重
  if (shortTerm.complianceTrend !== undefined && shortTerm.complianceTrend < -0.15) {
    refined.satiety = (refined.satiety ?? 1.0) * 1.15;
    refined.executability = (refined.executability ?? 1.0) * 1.1;
  }

  // 2. 热量模式影响: 持续超标时收紧热量权重
  if (shortTerm.avgCaloriesPerDay && shortTerm.avgCaloriesPerDay > 0) {
    const targetCal = 2000; // 从 context 获取
    const ratio = shortTerm.avgCaloriesPerDay / targetCal;
    if (ratio > 1.15) {
      refined.energy = (refined.energy ?? 1.0) * (1 + (ratio - 1) * 0.3);
    }
  }

  // 3. 品类偏好影响: 如果用户强烈偏好某品类, 微调 preferTags
  if (shortTerm.categoryPreferences) {
    const topCategories = Object.entries(shortTerm.categoryPreferences)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([cat]) => cat);
    if (topCategories.length > 0) {
      refined.preferTags = [...(refined.preferTags ?? []), ...topCategories];
    }
  }

  // 4. 跳餐检测: 如果上一餐被跳过, 增加当前餐热量分配
  if (shortTerm.dailyIntakes) {
    const today = new Date().toISOString().slice(0, 10);
    const todayIntake = shortTerm.dailyIntakes.find(d => d.date === today);
    if (todayIntake && todayIntake.mealCount === 0) {
      refined.energy = (refined.energy ?? 1.0) * 1.1;
    }
  }

  return { scene, modifiers: refined };
}
```

**验收标准：**

- `refineWithBehavior` 至少使用 3 种行为信号（complianceTrend、avgCaloriesPerDay、categoryPreferences）
- 返回的 modifiers 与输入有可测量的差异（当行为信号存在时）
- 编译通过

---

### 4.6 i18n 基础修复 — locale 映射 + 线程安全 + 消息补全（Phase 1-F）

**涉及文件：**

- `core/i18n/i18n.middleware.ts`
- `recommendation/i18n-messages.ts`
- `core/context/request-context.service.ts`

**目标：** 修复 i18n 基础设施的三个根本问题：locale 映射、线程安全、消息目录补全。

**4.6.1 Locale 映射**

```typescript
// V6.8: i18n.middleware.ts — 添加 locale 标准化映射
const LOCALE_MAP: Record<string, string> = {
  zh: 'zh-CN',
  'zh-cn': 'zh-CN',
  'zh-tw': 'zh-TW',
  en: 'en-US',
  'en-us': 'en-US',
  'en-gb': 'en-GB',
  ja: 'ja-JP',
  'ja-jp': 'ja-JP',
};

// 在 use() 中:
const rawLocale = (query.lang ?? acceptLang ?? 'zh').toLowerCase();
const normalizedLocale = LOCALE_MAP[rawLocale] ?? 'zh-CN';
this.requestContext.setLocale(normalizedLocale);
```

**4.6.2 线程安全**

```typescript
// V6.8: i18n-messages.ts — 移除全局 currentLocale，改为参数传递
// 旧:
// let currentLocale = 'zh-CN';
// export function t(key: string): string { ... uses currentLocale }

// 新: t() 接受 locale 参数
export function t(key: string, locale?: string): string {
  const lang = locale ?? 'zh-CN'; // fallback
  return MESSAGES[lang]?.[key] ?? MESSAGES['zh-CN']?.[key] ?? key;
}

// 每个服务通过注入 RequestContextService 获取当前 locale:
// const locale = this.requestContext.getLocale();
// const msg = t('some_key', locale);
```

**4.6.3 消息目录扩展**

在 `i18n-messages.ts` 中新增以下消息分组的 key（Phase 1-F 只建结构和中文，英文/日文在 Phase 2 补全）：

```typescript
// V6.8: 新增消息分组
// health_modifier.* — 28 个健康修改器原因
// nutrition_highlight.* — 16 个营养评分高亮
// behavior_notification.* — 9 个行为通知
// filter_reason.* — 7 个过滤原因
// channel_label.* — 5 个渠道标签
// cooking_method.* — 5 个烹饪方式标签
// meal_narrative.* — 10 个餐食叙事模板
// diversity_tip.* — 5 个多样性建议
// export_header.* — 25 个 CSV 表头
// ab_conclusion.* — 7 个 A/B 分析结论
// error.* — 6 个错误消息
```

**验收标准：**

- `I18nMiddleware` 输出的 locale 格式与 `i18n-messages.ts` 期望格式一致
- `t()` 函数不依赖全局可变状态，接受 locale 参数
- 新增至少 80 个消息 key 的中文版本
- 编译通过

---

### 4.7 WeightLearner dimensionScores 接入（Phase 2-A）

**涉及文件：**

- `recommendation/weight-learner.service.ts`
- `recommendation/recommendation-trace.service.ts`

**目标：** 将 WeightLearner 从均匀梯度升级为 per-dimension 精准梯度，接入 trace 的 dimensionScores 数据。

**4.7.1 Trace 数据联查**

```typescript
// V6.8: 在 batch gradient 中 JOIN recommendation_traces 获取 dimensionScores
const feedbacksWithScores = await this.prisma.$queryRaw`
  SELECT
    f.id, f.user_id, f.food_id, f.feedback_type, f.meal_type, f.created_at,
    t.scoring_details->'dimensionScores' as dimension_scores
  FROM recommendation_feedbacks f
  LEFT JOIN recommendation_traces t ON t.food_id = f.food_id
    AND t.user_id = f.user_id
    AND t.created_at >= f.created_at - INTERVAL '1 hour'
    AND t.created_at <= f.created_at + INTERVAL '1 hour'
  WHERE f.created_at >= NOW() - INTERVAL '14 days'
  ORDER BY f.created_at DESC
`;
```

**4.7.2 Per-dimension 梯度**

```typescript
// V6.8: 精准梯度计算
private computeTargetedGradient(
  feedback: FeedbackWithScores,
  baseWeights: number[],
): number[] {
  const gradient = new Array(baseWeights.length).fill(0);
  const dimScores = feedback.dimension_scores as number[] | null;

  if (!dimScores || dimScores.length !== baseWeights.length) {
    // fallback 到均匀梯度
    return this.computeUniformGradient(feedback, baseWeights);
  }

  const lr = 0.01;
  const sign = feedback.feedback_type === 'accepted' ? 1 : -1;

  // 时间衰减: 14 天 → 0, 0 天 → 1
  const daysAgo = (Date.now() - new Date(feedback.created_at).getTime()) / 86400000;
  const decay = Math.exp(-daysAgo / 7); // 7 天半衰期

  for (let i = 0; i < gradient.length; i++) {
    // 如果 rejected, 高分维度应该被抑制(可能是它导致了不匹配)
    // 如果 accepted, 高分维度应该被增强(它做出了正确贡献)
    gradient[i] = sign * lr * dimScores[i] * decay;
  }

  return gradient;
}
```

**4.7.3 用户级权重偏移**

```typescript
// V6.8: 用户级权重偏移存储在 Redis
// key: weight_learner:user:{userId}:{goalType}
// value: number[] (12 维偏移)
// TTL: 14 天

async getUserWeights(userId: string, goalType: string, base: number[]): Promise<number[]> {
  const key = `weight_learner:user:${userId}:${goalType}`;
  const cached = await this.redis.get(key);
  if (cached) {
    const offsets = JSON.parse(cached) as number[];
    return base.map((b, i) => b + (offsets[i] ?? 0));
  }
  // fallback: 全局 goalType offsets
  return this.getGlobalWeights(goalType, base);
}
```

**验收标准：**

- WeightLearner 从 trace 读取 dimensionScores
- 有 dimensionScores 时使用 per-dimension 梯度，无数据时 fallback 均匀梯度
- 支持用户级权重偏移（Redis 存储）
- 反馈有时间衰减（7 天半衰期）
- 编译通过

---

### 4.8 替换服务营养等价升级（Phase 2-B）

**涉及文件：**

- `recommendation/substitution.service.ts`
- `recommendation/recommendation.types.ts`

**目标：** 替换服务的 `nutritionProximity` 从 2 维扩展到 6 维（calories + protein + fat + carbs + GI + micronutrients），支持场景感知。

**4.8.1 营养接近度扩展**

```typescript
// V6.8: 6 维营养接近度
private calculateNutritionProximity(
  original: FoodLibrary,
  candidate: FoodLibrary,
  cfg: ScoringConfigSnapshot,
): number {
  const w = cfg.substitutionWeights;

  // 宏量营养素接近度（per 100g 归一化）
  const calDiff = Math.abs((original.caloriesPer100g ?? 0) - (candidate.caloriesPer100g ?? 0));
  const calScore = Math.max(0, 1 - calDiff / 200);

  const protDiff = Math.abs((original.proteinPer100g ?? 0) - (candidate.proteinPer100g ?? 0));
  const protScore = Math.max(0, 1 - protDiff / 20);

  const fatDiff = Math.abs((original.fatPer100g ?? 0) - (candidate.fatPer100g ?? 0));
  const fatScore = Math.max(0, 1 - fatDiff / 15);

  const carbDiff = Math.abs((original.carbsPer100g ?? 0) - (candidate.carbsPer100g ?? 0));
  const carbScore = Math.max(0, 1 - carbDiff / 30);

  // V6.8: GI 接近度
  const origGi = original.glycemicIndex ?? cfg.categoryGiMap[original.category] ?? cfg.giFallback;
  const candGi = candidate.glycemicIndex ?? cfg.categoryGiMap[candidate.category] ?? cfg.giFallback;
  const giDiff = Math.abs(origGi - candGi);
  const giScore = Math.max(0, 1 - giDiff / 40);

  // V6.8: 微量营养素余弦相似度
  const microScore = this.micronutrientSimilarity(original, candidate);

  return (
    w.calories * calScore +
    w.protein * protScore +
    w.fat * fatScore +
    w.carbs * carbScore +
    w.gi * giScore +
    w.micronutrients * microScore
  );
}
```

**4.8.2 微量营养素余弦相似度**

```typescript
// V6.8: 微量营养素向量余弦相似度
private micronutrientSimilarity(a: FoodLibrary, b: FoodLibrary): number {
  const keys = ['fiber', 'iron', 'calcium', 'vitaminC', 'vitaminA', 'potassium'] as const;
  let dotProduct = 0, normA = 0, normB = 0;
  for (const k of keys) {
    const va = (a as any)[k + 'Per100g'] ?? 0;
    const vb = (b as any)[k + 'Per100g'] ?? 0;
    dotProduct += va * vb;
    normA += va * va;
    normB += vb * vb;
  }
  if (normA === 0 || normB === 0) return 0.5; // 无数据时中性分
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

**验收标准：**

- 替换评分使用 6 维营养接近度（calories + protein + fat + carbs + GI + micronutrients）
- 所有权重从 ScoringConfig 读取
- 替换 per-100g 归一化，消除 serving size 偏差
- 编译通过

---

### 4.9 策略系统 Redis 同步（Phase 2-C）

**涉及文件：**

- `strategy/strategy-auto-tuner.service.ts`
- `strategy/strategy.types.ts`

**目标：** 将 `SEGMENT_STRATEGY_MAP` 从进程内存迁移到 Redis，支持多实例同步。增强统计显著性检验。

**4.9.1 Redis 存储**

```typescript
// V6.8: Redis key 设计
// 主存储: strategy:segment_map (Hash)
//   field: segment_name → value: JSON {strategyKey, appliedAt, source}
// 版本号: strategy:segment_map:version (String, 自增)
// Pub/Sub channel: strategy:mapping:updated

// V6.8: 替换 module-level const
// 移除: const SEGMENT_STRATEGY_MAP = { ... };
// 改为: 通过 SegmentStrategyStore 封装

@Injectable()
class SegmentStrategyStore {
  private localCache: Map<string, SegmentMapping> = new Map();
  private localVersion = 0;

  async getMapping(segment: string): Promise<string> {
    await this.ensureFresh();
    return this.localCache.get(segment)?.strategyKey ?? 'balanced';
  }

  async setMapping(segment: string, strategyKey: string): Promise<void> {
    // 1. 写 Redis Hash
    await this.redis.hset(
      'strategy:segment_map',
      segment,
      JSON.stringify({
        strategyKey,
        appliedAt: new Date().toISOString(),
        source: 'auto_tuner',
      })
    );
    // 2. 自增版本号
    await this.redis.incr('strategy:segment_map:version');
    // 3. Pub/Sub 通知其他实例
    await this.redis.publish('strategy:mapping:updated', segment);
    // 4. 更新本地缓存
    this.localCache.set(segment, {
      strategyKey,
      appliedAt: new Date().toISOString(),
      source: 'auto_tuner',
    });
  }

  private async ensureFresh(): Promise<void> {
    const remoteVersion = Number((await this.redis.get('strategy:segment_map:version')) ?? 0);
    if (remoteVersion > this.localVersion) {
      const all = await this.redis.hgetall('strategy:segment_map');
      this.localCache.clear();
      for (const [k, v] of Object.entries(all)) {
        this.localCache.set(k, JSON.parse(v));
      }
      this.localVersion = remoteVersion;
    }
  }
}
```

**4.9.2 统计显著性增强**

```typescript
// V6.8: 最小样本量从 5 提升到 30
private readonly MIN_SAMPLE_SIZE = 30;

// V6.8: 使用 Wilson score interval 代替简单比率比较
private wilsonLower(successes: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const p = successes / total;
  const denominator = 1 + z * z / total;
  const center = p + z * z / (2 * total);
  const spread = z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total);
  return (center - spread) / denominator;
}

// V6.8: 只有当实验组 Wilson lower bound > control Wilson upper bound 才判定显著
```

**验收标准：**

- `SEGMENT_STRATEGY_MAP` 模块级常量被移除
- 策略映射存储在 Redis Hash
- 支持 Pub/Sub 跨实例同步
- 最小样本量 >= 30
- 编译通过

---

### 4.10 i18n 文件清理 — explanation + health-modifier（Phase 2-D）

**涉及文件：**

- `recommendation/explanation-generator.service.ts`（~35 个硬编码中文）
- `recommendation/health-modifier-engine.service.ts`（~28 个硬编码中文）
- `recommendation/i18n-messages.ts`

**目标：** 将 explanation-generator 和 health-modifier-engine 中的所有硬编码中文迁移到 `i18n-messages.ts`，使用 `t()` 函数。

**4.10.1 消息 key 命名规范**

```
explain.synergy.iron_vitc.label    = "铁+维C→铁吸收增强"
explain.synergy.iron_vitc.benefit  = "维C帮助铁吸收，提高铁的生物利用率"
explain.diversity.ingredient_repeat = "部分食材重复，建议替换为不同食材的菜品"
explain.cooking_method.stir_fry    = "炒"
explain.narrative.protein_source   = "{name}提供主要蛋白质"
health.allergy_match               = "过敏原匹配: {matched}"
health.trans_fat_exceed            = "反式脂肪严重超标: {value}g/100g"
health.diabetes.high_gi            = "糖尿病: 高GI食物 ({gi})"
```

**4.10.2 模板替换**

支持简单模板变量 `{varName}`：

```typescript
// V6.8: t() 函数增加模板变量支持
export function t(key: string, locale?: string, vars?: Record<string, string | number>): string {
  const lang = locale ?? 'zh-CN';
  let msg = MESSAGES[lang]?.[key] ?? MESSAGES['zh-CN']?.[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      msg = msg.replace(`{${k}}`, String(v));
    }
  }
  return msg;
}
```

**4.10.3 迁移示例**

```typescript
// V6.7:
reason = `过敏原匹配: ${matched}`;

// V6.8:
reason = t('health.allergy_match', locale, { matched });
```

**验收标准：**

- `explanation-generator.service.ts` 无硬编码中文（除 logger 消息）
- `health-modifier-engine.service.ts` 无硬编码中文（除 logger 消息）
- 所有迁移的字符串在 `i18n-messages.ts` 有对应 key
- `t()` 支持 `{varName}` 模板变量
- 编译通过

---

### 4.11 i18n 文件清理 — 剩余服务（Phase 2-E）

**涉及文件：**

- `diet/app/behavior.service.ts`（~9 个）
- `diet/app/nutrition-score.service.ts`（~16 个）
- `diet/app/food.service.ts`（~6 个）
- `diet/app/export.service.ts`（~25 个）
- `recommendation/ab-testing.service.ts`（~7 个）
- `recommendation/meal-assembler.service.ts`（~3 个）
- `recommendation/meal-composition-scorer.service.ts`（~7 个）
- `recommendation/recommendation.config.ts`（~2 个）
- `recommendation/recommendation-engine.service.ts`（~7 个）
- Controllers（~30+ 个）
- `recommendation/i18n-messages.ts`

**目标：** 清理所有剩余文件中的硬编码中文，完成 i18n 全覆盖。

**4.11.1 消息 key 分组**

```
nutrition.highlight.*     — 16 个营养评分高亮
behavior.notification.*   — 9 个行为通知
channel.label.*           — 5 个渠道标签
export.header.*           — 25 个 CSV 表头
ab.conclusion.*           — 7 个 A/B 分析结论
error.*                   — 通用错误消息
meal.*                    — 餐食相关标签
filter.*                  — 过滤原因
```

**4.11.2 Controller API 描述**

Controller 的 `@ApiTags` 和 `@ApiOperation({ summary })` 保持中文不变（Swagger 文档面向中文用户）。仅迁移 `response.message` 类的用户可见文本。

**验收标准：**

- 所有 `// V6.8 TODO: i18n` 标记清理完成
- `i18n-messages.ts` 包含全部 150+ 消息 key 的 zh-CN 版本
- en-US 和 ja-JP 版本至少有 key 占位（值可为英文或 key 本身）
- 编译通过

---

### 4.12 冲突解决器多轮迭代（Phase 2-F）

**涉及文件：**

- `recommendation/pipeline-builder.service.ts`

**目标：** 将冲突解决器从单次替换改为多轮迭代（最多 3 轮），确保多重冲突完全解决。

**4.12.1 多轮冲突解决**

```typescript
// V6.8: 多轮冲突解决
private resolveConflicts(
  foods: ScoredFood[],
  constraints: PipelineConstraints,
  pool: FoodLibrary[],
  maxRounds = 3,
): ScoredFood[] {
  let current = [...foods];
  for (let round = 0; round < maxRounds; round++) {
    const conflicts = this.detectConflicts(current, constraints);
    if (conflicts.length === 0) break; // 无冲突，提前退出

    for (const conflict of conflicts) {
      const replacement = this.findReplacement(conflict, current, pool, constraints);
      if (replacement) {
        current = current.map(f => f.food.id === conflict.foodId ? replacement : f);
      }
    }
  }
  return current;
}
```

**验收标准：**

- 冲突解决器支持最多 3 轮迭代
- 无冲突时提前退出（O(1)开销）
- 替换后仍满足原有约束
- 编译通过

---

### 4.13 FoodFilter 去重与 Recall 职责清理（Phase 3-A）

**涉及文件：**

- `recommendation/food-filter.service.ts`
- `recommendation/pipeline-builder.service.ts`

**目标：** 清理 FoodFilter 与 Recall 阶段的功能重叠，明确职责边界。

**4.13.1 职责划分**

```
Recall 阶段：负责"召回什么候选"（品类/语义/CF 选择）
FoodFilter 阶段：负责"硬约束过滤"（过敏原/健康禁忌/渠道/技能）

V6.7 问题：Recall 中的 RuleRecall 已做了品类过滤, FoodFilter 又做一遍
V6.8 修复：FoodFilter 移除品类相关逻辑, 仅保留硬约束过滤
```

**4.13.2 FoodFilter 精简**

```typescript
// V6.8: FoodFilter 仅保留硬约束
filter(candidates: FoodLibrary[], constraints: PipelineConstraints): FoodLibrary[] {
  return candidates.filter(food => {
    // 1. 过敏原检查（硬约束）
    if (this.hasAllergenConflict(food, constraints.allergens)) return false;
    // 2. 健康禁忌检查（硬约束）
    if (this.hasHealthRestriction(food, constraints.healthConditions)) return false;
    // 3. 渠道可达性（硬约束）
    if (constraints.channel && !this.isChannelAvailable(food, constraints.channel)) return false;
    // 4. 技能可行性（硬约束）
    if (constraints.skillLevel && !this.isSkillFeasible(food, constraints.skillLevel)) return false;
    return true;
  });
  // 移除: 品类过滤（已在 Recall 阶段完成）
  // 移除: 重复食物检测（已在 RecallMerger 完成）
}
```

**验收标准：**

- FoodFilter 不再做品类过滤
- Recall 与 Filter 职责无重叠
- 编译通过

---

### 4.14 Lifestyle 维度扩展 — 运动/酒精/年龄（Phase 3-B）

**涉及文件：**

- `recommendation/lifestyle-scoring-adapter.service.ts`
- `recommendation/recommendation.types.ts`
- `user/profile-resolver.service.ts`

**目标：** 扩展 lifestyle 调整维度，新增运动恢复、酒精影响、年龄相关调整。

**4.14.1 新增维度**

```typescript
// V6.8: 运动恢复
private applyExerciseRecovery(
  adjustments: Record<string, number>,
  lifestyle: LifestyleProfile,
): void {
  if (!lifestyle.exerciseIntensity) return;
  if (lifestyle.exerciseIntensity === 'high') {
    adjustments['protein'] = (adjustments['protein'] ?? 0) + 0.12;
    adjustments['potassium'] = (adjustments['potassium'] ?? 0) + 0.08;
    adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.06;
  } else if (lifestyle.exerciseIntensity === 'moderate') {
    adjustments['protein'] = (adjustments['protein'] ?? 0) + 0.06;
  }
}

// V6.8: 酒精影响
private applyAlcoholImpact(
  adjustments: Record<string, number>,
  lifestyle: LifestyleProfile,
): void {
  if (!lifestyle.alcoholFrequency) return;
  if (lifestyle.alcoholFrequency === 'frequent') {
    adjustments['vitaminB12'] = (adjustments['vitaminB12'] ?? 0) + 0.10;
    adjustments['folate'] = (adjustments['folate'] ?? 0) + 0.08;
    adjustments['magnesium'] = (adjustments['magnesium'] ?? 0) + 0.06;
  }
}

// V6.8: 年龄相关
private applyAgeAdjustments(
  adjustments: Record<string, number>,
  age: number | undefined,
): void {
  if (!age) return;
  if (age >= 50) {
    adjustments['calcium'] = (adjustments['calcium'] ?? 0) + 0.10;
    adjustments['vitaminD'] = (adjustments['vitaminD'] ?? 0) + 0.10;
    adjustments['vitaminB12'] = (adjustments['vitaminB12'] ?? 0) + 0.08;
  }
}
```

**验收标准：**

- 新增 3 个 lifestyle 维度（运动/酒精/年龄）
- 所有调整受 ±0.25 封顶保护
- 编译通过

---

### 4.15 ProfileResolver as-any 清理 + 画像新鲜度衰减（Phase 3-C）

**涉及文件：**

- `user/profile-resolver.service.ts`
- `apps/api-server/prisma/schema.prisma`（如需补列）

**目标：** 消除 ProfileResolver 中所有 `(declared as any)` 访问，确认 Prisma schema 完整映射 V6.6 lifestyle 字段。添加画像新鲜度衰减。

**4.15.1 Schema 验证**

检查 `user_profiles` 表是否包含以下字段：

- `sleep_quality`
- `stress_level`
- `hydration_goal`
- `supplements_used`
- `meal_timing_preference`

如缺失，添加到 Prisma schema 并生成迁移。

**4.15.2 类型安全访问**

```typescript
// V6.7: (declared as any).sleepQuality
// V6.8: declared.sleepQuality — 类型安全
```

**4.15.3 画像新鲜度衰减**

```typescript
// V6.8: 在 buildContext 中根据 profileFreshness 调整置信度
const freshness = context.profileFreshness; // 0-1, 来自 resolveConflicts
if (freshness < 0.3) {
  // 画像过于陈旧，降低 declared 层权重，提高 observed 层权重
  context.declared.confidence = (context.declared.confidence ?? 1.0) * freshness;
}
```

**验收标准：**

- `profile-resolver.service.ts` 不包含 `as any`
- Prisma schema 包含所有 lifestyle 字段
- 陈旧画像的 declared 置信度被衰减
- 编译通过

---

### 4.16 en-US / ja-JP 翻译补全（Phase 3-D）

**涉及文件：**

- `recommendation/i18n-messages.ts`

**目标：** 为 Phase 1-F / Phase 2-D / Phase 2-E 新增的所有消息 key 补全英文和日文翻译。

**4.16.1 翻译范围**

- `explain.*` — ~35 keys
- `health.*` — ~28 keys
- `nutrition.*` — ~16 keys
- `behavior.*` — ~9 keys
- `channel.*` — ~5 keys
- `export.*` — ~25 keys
- `ab.*` — ~7 keys
- `error.*` — ~6 keys
- `meal.*` — ~10 keys
- `filter.*` — ~7 keys
- `diversity.*` — ~5 keys

总计 ~153 keys × 2 语言 = ~306 条翻译

**验收标准：**

- `i18n-messages.ts` 的 `en-US` 和 `ja-JP` 分区覆盖所有 key
- 无空值或 placeholder（每个 key 有实际翻译文本）
- 编译通过

---

### 4.17 WeightLearner 餐次分维学习（Phase 3-E）

**涉及文件：**

- `recommendation/weight-learner.service.ts`

**目标：** 在 Phase 2-A 的 per-dimension 梯度基础上，增加餐次维度分维——早餐/午餐/晚餐/加餐各维护独立的权重偏移。

**4.17.1 餐次级存储**

```typescript
// V6.8: Redis key 设计
// 全局: weight_learner:global:{goalType} — 12 维偏移
// 用户: weight_learner:user:{userId}:{goalType} — 12 维偏移
// 用户×餐次: weight_learner:user:{userId}:{goalType}:{mealType} — 12 维偏移

// 权重解析优先级:
// user×mealType > user > global
async getUserMealWeights(userId: string, goalType: string, mealType: string, base: number[]): Promise<number[]> {
  const mealKey = `weight_learner:user:${userId}:${goalType}:${mealType}`;
  const cached = await this.redis.get(mealKey);
  if (cached) {
    const offsets = JSON.parse(cached) as number[];
    return base.map((b, i) => b + (offsets[i] ?? 0));
  }
  // fallback to user-level
  return this.getUserWeights(userId, goalType, base);
}
```

**验收标准：**

- 支持 userId × goalType × mealType 三级权重偏移
- 优先级链: mealType > user > global > base
- 编译通过

---

### 4.18 Pipeline 容错增强 + 健壮性（Phase 3-F）

**涉及文件：**

- `recommendation/pipeline-builder.service.ts`
- `recommendation/recommendation-engine.service.ts`

**目标：** 增强管道各阶段的容错能力——单个阶段失败不应导致整个推荐流程崩溃。

**4.18.1 阶段级 try-catch**

```typescript
// V6.8: 每个管道阶段包装在 try-catch 中
private async executePipeline(ctx: PipelineContext): Promise<PipelineResult> {
  let candidates = ctx.candidates;

  // Recall
  try {
    candidates = await this.recall(ctx);
  } catch (e) {
    this.logger.error('Recall failed, using fallback pool', e);
    candidates = this.fallbackRecall(ctx);
  }

  // Score
  try {
    candidates = await this.score(candidates, ctx);
  } catch (e) {
    this.logger.error('Scoring failed, using basic sort', e);
    candidates = this.basicSort(candidates);
  }

  // Rank
  try {
    candidates = await this.rank(candidates, ctx);
  } catch (e) {
    this.logger.error('Ranking failed, skipping', e);
    // 跳过 ranking, 使用 scoring 结果
  }

  // ... 其他阶段类似
  return { candidates, metadata: ctx.metadata };
}
```

**4.18.2 降级标记**

```typescript
// V6.8: PipelineResult 新增降级信息
interface PipelineResult {
  candidates: ScoredFood[];
  metadata: PipelineMetadata;
  degradations: PipelineDegradation[]; // V6.8: 记录哪些阶段降级
}

interface PipelineDegradation {
  stage: string;
  reason: string;
  fallbackUsed: string;
}
```

**验收标准：**

- 每个管道阶段有独立 try-catch
- 失败阶段使用降级策略而非抛出
- `PipelineResult` 包含降级记录
- 编译通过

---

## Step 5：技术路线图

### Phase 1：核心修复与基础设施（1-2 周）

| 编号 | 任务                                              | 涉及文件                                                                                                         | 估时 |
| ---- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ---- |
| 1-A  | 评分参数全量外部化 — ScoringConfigSnapshot V2     | `recommendation.types.ts`, `scoring-config.service.ts`, `food-scorer.service.ts`, `scoring-config.controller.ts` | 12h  |
| 1-B  | Lifestyle 双重消费修复 + 维度扩展                 | `food-scorer.service.ts`, `pipeline-builder.service.ts`, `lifestyle-scoring-adapter.service.ts`                  | 6h   |
| 1-C  | NRF Gap 连续化 + 添加糖惩罚一致性                 | `food-scorer.service.ts`                                                                                         | 4h   |
| 1-D  | ProfileResolver 冲突解决层                        | `profile-resolver.service.ts`, `recommendation.types.ts`                                                         | 6h   |
| 1-E  | ContextualProfile refineWithBehavior 重建         | `contextual-profile.service.ts`                                                                                  | 5h   |
| 1-F  | i18n 基础修复 — locale 映射 + 线程安全 + 消息骨架 | `i18n.middleware.ts`, `i18n-messages.ts`, `request-context.service.ts`                                           | 8h   |

**Phase 1 验收标准：**

- `food-scorer.service.ts` 中无非数学常量的硬编码 magic number
- Lifestyle 信号仅通过 `nutritionGaps` 一条路径消费
- NRF gap bonus 输出随 %DV 连续增长
- `EnrichedProfileContext` 包含 `conflicts[]` 和 `profileFreshness`
- `refineWithBehavior` 使用 >= 3 种行为信号
- `t()` 函数接受 locale 参数，不依赖全局可变状态
- `pnpm exec tsc --noEmit --project apps/api-server/tsconfig.json` 通过

### Phase 2：推荐质量提升（3-5 周）

| 编号 | 任务                                        | 涉及文件                                                                                                                                                                                                                                                             | 估时 |
| ---- | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 2-A  | WeightLearner dimensionScores 接入 + 用户级 | `weight-learner.service.ts`, `recommendation-trace.service.ts`                                                                                                                                                                                                       | 8h   |
| 2-B  | 替换服务营养等价升级                        | `substitution.service.ts`, `recommendation.types.ts`                                                                                                                                                                                                                 | 6h   |
| 2-C  | 策略系统 Redis 同步 + 统计增强              | `strategy-auto-tuner.service.ts`, `strategy.types.ts`                                                                                                                                                                                                                | 8h   |
| 2-D  | i18n 清理 — explanation + health-modifier   | `explanation-generator.service.ts`, `health-modifier-engine.service.ts`, `i18n-messages.ts`                                                                                                                                                                          | 10h  |
| 2-E  | i18n 清理 — 剩余 10+ 服务                   | `behavior.service.ts`, `nutrition-score.service.ts`, `food.service.ts`, `export.service.ts`, `ab-testing.service.ts`, `meal-assembler.service.ts`, `meal-composition-scorer.service.ts`, `recommendation.config.ts`, `recommendation-engine.service.ts`, controllers | 12h  |
| 2-F  | 冲突解决器多轮迭代                          | `pipeline-builder.service.ts`                                                                                                                                                                                                                                        | 4h   |

**Phase 2 验收标准：**

- WeightLearner 使用 per-dimension 梯度 + 用户级偏移 + 时间衰减
- 替换服务使用 6 维营养接近度
- 策略映射存储在 Redis，支持多实例同步
- `explanation-generator.service.ts` 和 `health-modifier-engine.service.ts` 无硬编码中文
- 全部 150+ 消息 key 的 zh-CN 版本完成
- 冲突解决器支持多轮迭代
- `pnpm exec tsc --noEmit --project apps/api-server/tsconfig.json` 通过

### Phase 3：精细化与健壮性（4-6 周）

| 编号 | 任务                                             | 涉及文件                                                                                         | 估时 |
| ---- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---- |
| 3-A  | FoodFilter 去重与 Recall 职责清理                | `food-filter.service.ts`, `pipeline-builder.service.ts`                                          | 4h   |
| 3-B  | Lifestyle 维度扩展 — 运动/酒精/年龄              | `lifestyle-scoring-adapter.service.ts`, `recommendation.types.ts`, `profile-resolver.service.ts` | 6h   |
| 3-C  | ProfileResolver as-any 清理 + Prisma schema 补全 | `profile-resolver.service.ts`, `schema.prisma`                                                   | 5h   |
| 3-D  | en-US / ja-JP 翻译补全（~306 条）                | `i18n-messages.ts`                                                                               | 8h   |
| 3-E  | WeightLearner 餐次分维学习                       | `weight-learner.service.ts`                                                                      | 5h   |
| 3-F  | Pipeline 容错增强 + 降级标记                     | `pipeline-builder.service.ts`, `recommendation-engine.service.ts`, `recommendation.types.ts`     | 6h   |

**Phase 3 验收标准：**

- FoodFilter 与 Recall 职责无重叠
- Lifestyle 新增 3 个维度（运动/酒精/年龄）
- `profile-resolver.service.ts` 无 `as any` 访问
- `i18n-messages.ts` 的 en-US 和 ja-JP 覆盖全部 key
- WeightLearner 支持 user×goalType×mealType 三级偏移
- 管道每阶段有独立 try-catch + 降级记录
- `pnpm exec tsc --noEmit --project apps/api-server/tsconfig.json` 通过

### 时间线总览

```
Week 1-2:   Phase 1（核心修复 + i18n 基础）           41h
Week 3-7:   Phase 2（推荐质量 + i18n 全覆盖）          48h
Week 8-13:  Phase 3（精细化 + 健壮性 + 翻译补全）      34h
───────────────────────────────────────────────────
总计:                                                 123h
```

---

## Step 6：数据迁移

### 6.1 V6.8 Schema 迁移

V6.8 的 schema 变更主要集中在以下方面：

**6.1.1 feature_flag 配置升级**

```sql
-- V6.8: 升级 scoring_config key
-- 无 schema 变更，仅数据层面: 新增 feature_flag key 'scoring_config_v68'
-- ScoringConfigService 先读 v68, fallback 读 v67
INSERT INTO feature_flag (key, value, is_active, description)
SELECT 'scoring_config_v68', value, true, 'V6.8 扩展评分配置'
FROM feature_flag WHERE key = 'scoring_config_v67'
ON CONFLICT (key) DO NOTHING;
```

**6.1.2 user_profiles lifestyle 字段验证**

```sql
-- 检查是否需要添加 lifestyle 字段
-- 如果 user_profiles 缺少以下字段，需要迁移:
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS sleep_quality VARCHAR(20);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS stress_level VARCHAR(20);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS hydration_goal DECIMAL(6,1);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS supplements_used TEXT[];
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS meal_timing_preference VARCHAR(30);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS exercise_intensity VARCHAR(20);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS alcohol_frequency VARCHAR(20);
```

### 6.2 Prisma Schema 对应变更

```prisma
// 如需添加到 user_profiles model:
model user_profiles {
  // ... 现有字段 ...

  // V6.8: lifestyle 字段正式化（从 as-any 访问改为类型安全）
  sleep_quality         String?   @db.VarChar(20)
  stress_level          String?   @db.VarChar(20)
  hydration_goal        Decimal?  @db.Decimal(6, 1)
  supplements_used      String[]
  meal_timing_preference String?  @db.VarChar(30)
  exercise_intensity    String?   @db.VarChar(20)    // V6.8 新增
  alcohol_frequency     String?   @db.VarChar(20)    // V6.8 新增
}
```

### 6.3 Redis Key 迁移

```
# V6.8 新增 Redis keys:
strategy:segment_map          (Hash) — 策略映射
strategy:segment_map:version  (String) — 版本号
strategy:mapping:updated      (Channel) — Pub/Sub

weight_learner:user:{userId}:{goalType}            — 用户级权重偏移
weight_learner:user:{userId}:{goalType}:{mealType} — 用户×餐次权重偏移

# 无需迁移旧 Redis key，V6.8 key 是增量新增
```

### 6.4 迁移风险评估

| 风险                                       | 影响                                   | 缓解措施                                       |
| ------------------------------------------ | -------------------------------------- | ---------------------------------------------- |
| scoring_config_v68 feature_flag 数据不存在 | 所有新参数使用 DEFAULTS_V68            | ScoringConfigService 已有 graceful degradation |
| user_profiles 新增字段全为 NULL            | Lifestyle adapter 走默认逻辑           | 所有新维度有 `if (!field) return` 保护         |
| Redis strategy:segment_map 空              | AutoTuner 的 onModuleInit 从 DB 初始化 | 首次启动自动填充                               |
| 多实例部署中 V6.7 和 V6.8 实例并存         | V6.7 实例读不到 v68 config key         | V6.7 实例继续读 v67 key，无影响                |

---

## Step 7：文档差异

### 7.1 架构层面变化

| 层次                 | V6.7                                                 | V6.8                            | 变化 |
| -------------------- | ---------------------------------------------------- | ------------------------------- | ---- |
| 评分参数             | 31 参数外部化                                        | 90+ 参数全量外部化              | 扩展 |
| Lifestyle 消费       | food-scorer + pipeline-builder 双路径                | pipeline-builder 唯一路径       | 修复 |
| NRF Gap Bonus        | 二值（>=threshold → fixed bonus）                    | 连续函数（线性增长）            | 升级 |
| 添加糖惩罚           | 加法                                                 | 乘法（与 NOVA 一致）            | 修复 |
| 画像合并             | 5 层平铺，无冲突检测                                 | 5 层 + 冲突解决层 + 新鲜度衰减  | 增强 |
| 场景行为修正         | refineWithBehavior 近乎空操作                        | 使用 4 种行为信号               | 重建 |
| WeightLearner        | 均匀梯度，全局 goalType                              | per-dimension 梯度，用户×餐次级 | 升级 |
| 替换营养比较         | 2 维（calories + protein）                           | 6 维（+fat +carbs +GI +micro）  | 扩展 |
| 策略映射存储         | 进程内存 const                                       | Redis Hash + Pub/Sub            | 升级 |
| 统计显著性           | 简单比率，min=5                                      | Wilson score interval，min=30   | 增强 |
| i18n 线程安全        | 全局可变 currentLocale                               | locale 参数传递                 | 修复 |
| i18n 覆盖            | ~40 key（4 文件使用 t()）                            | ~150+ key（全文件使用 t()）     | 扩展 |
| 冲突解决器           | 单次替换                                             | 最多 3 轮迭代                   | 增强 |
| 管道容错             | 无 try-catch，单点失败                               | 阶段级 try-catch + 降级记录     | 新增 |
| ProfileResolver 类型 | `(declared as any)` 访问                             | 类型安全                        | 修复 |
| Lifestyle 维度       | 5 维（sleep/stress/supplement/hydration/mealTiming） | 8 维（+exercise/alcohol/age）   | 扩展 |

### 7.2 新增模块汇总

| 模块                 | 文件                                       | 说明                      |
| -------------------- | ------------------------------------------ | ------------------------- |
| SegmentStrategyStore | `strategy-auto-tuner.service.ts`（内联类） | Redis-backed 策略映射存储 |
| PipelineDegradation  | `recommendation.types.ts`（接口）          | 管道降级记录              |
| ProfileConflict      | `recommendation.types.ts`（接口）          | 画像冲突记录              |

### 7.3 升级模块汇总

| 模块                       | 变化级别 | 说明                              |
| -------------------------- | -------- | --------------------------------- |
| ScoringConfigSnapshot      | 重度扩展 | 31 → 90+ 参数                     |
| food-scorer.service        | 重度重构 | 60+ 硬编码常量外部化              |
| weight-learner.service     | 重度升级 | per-dimension 梯度 + 用户×餐次级  |
| profile-resolver.service   | 中度增强 | 冲突解决层 + 新鲜度 + as-any 清理 |
| contextual-profile.service | 中度重建 | refineWithBehavior 4 种信号       |
| substitution.service       | 中度扩展 | 6 维营养接近度                    |
| lifestyle-scoring-adapter  | 中度增强 | 去重 + 3 新维度 + 封顶            |
| strategy-auto-tuner        | 中度升级 | Redis + Pub/Sub + Wilson          |
| pipeline-builder           | 轻度增强 | 冲突多轮 + lifestyle 路径         |
| food-filter                | 轻度精简 | 移除重叠逻辑                      |
| i18n-messages              | 重度扩展 | 40 → 150+ key × 3 语言            |
| i18n.middleware            | 轻度修复 | locale 映射                       |
| explanation-generator      | 中度重构 | 35 硬编码中文 → t()               |
| health-modifier-engine     | 中度重构 | 28 硬编码中文 → t()               |
| 其他 10+ 服务              | 轻度修改 | i18n 迁移                         |

### 7.4 接口变更

**扩展（向后兼容）：**

```typescript
// ScoringConfigSnapshot — 新增 ~60 个可选字段（全部有默认值）
// EnrichedProfileContext — 新增 conflicts[], profileFreshness
// PipelineResult — 新增 degradations[]
// t() — 新增 locale 和 vars 参数（原有调用无需修改）
```

**破坏性变更（无外部 API 影响）：**

```typescript
// food-scorer.service.ts 内部移除 lifestyleAdjustment 直接消费逻辑
// FoodFilter 内部移除品类过滤逻辑
// SEGMENT_STRATEGY_MAP 模块级常量被移除，改为 SegmentStrategyStore
```

### 7.5 V6.7 → V6.8 评分维度对比

| 评分维度  | V6.7             | V6.8                 | 变化      |
| --------- | ---------------- | -------------------- | --------- |
| NRF 9.3   | 二值 gap bonus   | 连续函数 gap bonus   | 升级      |
| GI/GL     | 硬编码 sigmoid   | 外部化 sigmoid 参数  | 外部化    |
| 蛋白质    | 硬编码范围       | 外部化 per-goal 范围 | 外部化    |
| NOVA      | 硬编码微调       | 外部化微调参数       | 外部化    |
| 炎症      | 硬编码公式系数   | 外部化公式系数       | 外部化    |
| 添加糖    | 加法惩罚         | 乘法惩罚             | 修复      |
| Lifestyle | 双路径消费       | 单路径 + 8 维        | 修复+扩展 |
| 能量      | 硬编码不对称惩罚 | 外部化               | 外部化    |
| 烹饪便利  | 硬编码阈值       | 外部化               | 外部化    |
| 其余 4 维 | —                | —                    | —         |

### 7.6 已解决 vs 遗留问题清单

| 问题 ID | 描述                       | V6.8 状态                                                   | 归属 |
| ------- | -------------------------- | ----------------------------------------------------------- | ---- |
| P0-1    | 60+ 硬编码常量             | ✅ 已解决（Phase 1-A）                                      | —    |
| P0-2    | Lifestyle 双重消费         | ✅ 已解决（Phase 1-B）                                      | —    |
| P0-3    | 添加糖加法惩罚不一致       | ✅ 已解决（Phase 1-C）                                      | —    |
| P0-4    | NRF gap bonus 二值         | ✅ 已解决（Phase 1-C）                                      | —    |
| P1-1    | ProfileResolver 无冲突解决 | ✅ 已解决（Phase 1-D）                                      | —    |
| P1-2    | refineWithBehavior 空操作  | ✅ 已解决（Phase 1-E）                                      | —    |
| P1-3    | Lifestyle as-any 访问      | ✅ 已解决（Phase 3-C）                                      | —    |
| P1-4    | 画像无新鲜度检测           | ✅ 已解决（Phase 1-D, 3-C）                                 | —    |
| P2-1    | WeightLearner 均匀梯度     | ✅ 已解决（Phase 2-A）                                      | —    |
| P2-2    | WeightLearner 无用户级     | ✅ 已解决（Phase 2-A）                                      | —    |
| P2-3    | WeightLearner 无时间衰减   | ✅ 已解决（Phase 2-A）                                      | —    |
| P2-4    | 替换服务 2 维营养          | ✅ 已解决（Phase 2-B）                                      | —    |
| P2-5    | 冲突解决器单次             | ✅ 已解决（Phase 2-F）                                      | —    |
| P3-1    | i18n locale mismatch       | ✅ 已解决（Phase 1-F）                                      | —    |
| P3-2    | i18n 线程不安全            | ✅ 已解决（Phase 1-F）                                      | —    |
| P3-3    | 150+ 硬编码中文            | ✅ 已解决（Phase 2-D, 2-E）                                 | —    |
| P3-4    | i18n 消息目录缺 key        | ✅ 已解决（Phase 1-F, 2-D, 2-E, 3-D）                       | —    |
| P3-5    | 策略映射进程内存           | ✅ 已解决（Phase 2-C）                                      | —    |
| P3-6    | 最小样本量 = 5             | ✅ 已解决（Phase 2-C）                                      | —    |
| P3-7    | 硬编码 segment 列表        | 🔄 部分解决（Phase 2-C 增加了动态发现，但 V6.9 需完整实现） | V6.9 |
| P3-8    | FoodFilter/Recall 重叠     | ✅ 已解决（Phase 3-A）                                      | —    |

**V6.9 方向预告：**

- 动态 segment 发现与自动策略生成
- ML 模型替代规则评分（LightGBM / small transformer）
- 食谱级推荐（多食物组合一次性推荐）
- 社交饮食场景（聚餐、请客）
- 预算感知推荐（结合实际食材价格数据）

---

> **设计原则：**
>
> - 所有升级是 V6.7 的增量演进，不重写已有模块
> - 每个 Phase 任务完成后运行 `pnpm exec tsc --noEmit --project apps/api-server/tsconfig.json` 验证编译
> - Prisma schema 变更后运行 `pnpm prisma validate --schema=apps/api-server/prisma/schema.prisma` 验证
> - 所有新参数有默认值，确保零配置可启动
> - i18n 迁移不改变现有功能行为，仅改变字符串来源
> - 策略 Redis 迁移保持向后兼容（Redis 不可用时 fallback 到 DB）
