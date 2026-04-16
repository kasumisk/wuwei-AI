# 饮食决策 + AI教练系统 V1.3 设计文档

> 版本: V1.3 | 作者: 系统架构师 | 基于 V1.2 升级

---

## Step 1: 现有能力分析与缺失点

### 1.1 分析层（Analyze）现状与缺失

| 能力       | 现状                                          | 缺失/问题                                                     |
| ---------- | --------------------------------------------- | ------------------------------------------------------------- |
| 食物识别   | ✅ 标准库匹配 + LLM 补位                      | —                                                             |
| 营养计算   | ✅ 16维营养数据（含 saturatedFat/addedSugar） | —                                                             |
| 评分引擎   | ✅ 7维加权评分（NutritionScoreService）       | ❌ 非标准库食物 qualityScore/satietyScore 默认5，评分失真     |
| 上下文感知 | ✅ 今日摄入、目标对比                         | ❌ 未注入 stabilityData（streakDays），stability 维度固定80分 |
| 评分分解   | ✅ NutritionScoreBreakdown 7维                | ❌ 分解数据未传递给决策层和前端，只用了总分                   |

### 1.2 决策层（Decision）现状与缺失

| 能力                | 现状                                            | 缺失/问题                    |
| ------------------- | ----------------------------------------------- | ---------------------------- |
| 基础决策            | ✅ 评分→recommend/caution/avoid                 | —                            |
| 时间感知            | ✅ 宵夜/晚餐/早餐差异化                         | —                            |
| 过敏/限制           | ✅ 强制 avoid                                   | —                            |
| 健康状况            | ✅ 高血压+高钠/糖尿病+高糖                      | —                            |
| 决策解耦            | ❌ computeDecision 是 1756 行巨型服务的内部方法 | 无法独立测试、独立迭代       |
| 评分 breakdown 驱动 | ❌ 决策只看 nutritionScore 总分                 | 不知道是哪个维度拉低了分数   |
| 份量建议精度        | ❌ "减少到X%"是粗估                             | 没有基于目标剩余反算最优份量 |
| 动态决策可解释      | ❌ contextReasons 是字符串列表                  | 没有结构化的决策因子输出     |

### 1.3 教练层（Coach）现状与缺失

| 能力           | 现状                              | 缺失/问题                                            |
| -------------- | --------------------------------- | ---------------------------------------------------- |
| 个性化 prompt  | ✅ 目标/行为/限制/macro 进度      | —                                                    |
| 分析上下文注入 | ✅ foods/calories/decision/advice | ❌ 评分 breakdown 未注入 coach，教练不知道哪个维度差 |
| 行为引导       | ✅ 弱餐次/超标类别                | ❌ 下一餐具体建议缺失（应该吃什么+多少量）           |
| 替代建议质量   | ⚠️ 推荐引擎优先                   | ❌ LLM 解析食物（无 libraryMatch）无法触发引擎替代   |

---

## Step 2: V1.3 架构升级方向

### 核心主题: **解耦 + 评分增强 + 决策精度**

V1.3 三大方向:

1. **服务解耦**: 将 `TextFoodAnalysisService` 的评分/决策/解释/替代方案抽离为独立服务
2. **评分增强**: 注入 stabilityData、解锁 breakdown 传递、LLM 食物 quality/satiety 估算
3. **决策精度**: breakdown 驱动的精准原因定位 + 最优份量计算 + 结构化决策因子

---

## Step 3-7: 详细设计

### Phase 1: 评分引擎增强 + 服务解耦基础

#### P1-1: 抽离 FoodDecisionService（解耦核心）

从 `TextFoodAnalysisService` 抽离以下方法到新的 `FoodDecisionService`:

```
food/app/services/food-decision.service.ts (新建)
├── computeDecision()       ← 从 text-food-analysis.service.ts 移入
├── scoreToFoodDecision()   ← 移入
├── generateDecisionAdvice() ← 移入
├── generateExplanation()   ← 移入
└── generateAlternatives()  ← 移入（含 getEngineAlternatives + generateStaticAlternatives）
```

**接口设计:**

```typescript
interface DecisionInput {
  foods: ParsedFoodItem[];
  totals: NutritionTotals;
  score: AnalysisScore;
  scoreBreakdown: NutritionScoreBreakdown; // V1.3 新增
  userContext: UserContext;
  locale?: Locale;
}

interface DecisionOutput {
  decision: FoodDecision;
  alternatives: FoodAlternative[];
  explanation: AnalysisExplanation;
  decisionFactors: DecisionFactor[]; // V1.3 新增：结构化决策因子
}
```

**原则:** `TextFoodAnalysisService.analyze()` 调用 `FoodDecisionService` 作为 step 7-9 的替代。

#### P1-2: 评分 breakdown 透传

当前: `calculateScore()` 内部调用 `nutritionScoreService.calculateMealScore()` 但只取 `.score`，丢弃 `.breakdown`。

修改: 保留 `NutritionScoreBreakdown` 并传递给:

- `AnalysisScore` 类型（新增 `breakdown` 字段）
- `FoodDecisionService.computeDecision()`（基于具体维度做精准决策）
- `AnalysisContextDto`（传递给 AI 教练）

#### P1-3: stability 维度真实数据注入

当前: `calculateScore()` 调用 `calculateMealScore()` 时不传 `stabilityData`，导致 stability 固定80分。

修改: 在 `calculateScore()` 中从 `BehaviorService` 获取 streakDays + avgMealsPerDay 注入。

**数据来源:**

- `BehaviorService.getProfile(userId)` → 已有 `streakDays` 字段（行为画像只读取）
- 从 `foodService.getRecentSummaries(userId, 7)` 计算 `avgMealsPerDay`

#### P1-4: LLM 解析食物的 quality/satiety 估算

当前: 非标准库食物 `qualityScore` 和 `satietyScore` 默认5，导致评分失真。

修改: 基于已有营养数据估算:

```typescript
function estimateQuality(food: ParsedFoodItem): number {
  let q = 5;
  if (food.fiber && food.fiber > 3) q += 1; // 高纤维
  if (food.sodium && food.sodium > 600) q -= 1; // 高钠
  if (food.addedSugar && food.addedSugar > 5) q -= 1; // 高添加糖
  if (food.saturatedFat && food.saturatedFat > 5) q -= 1; // 高饱和脂
  const proteinRatio = (food.protein * 4) / Math.max(1, food.calories);
  if (proteinRatio > 0.25) q += 1; // 高蛋白比
  return Math.max(1, Math.min(10, q));
}

function estimateSatiety(food: ParsedFoodItem): number {
  let s = 5;
  if (food.protein > 15) s += 1; // 蛋白质饱腹
  if (food.fiber && food.fiber > 3) s += 1; // 纤维饱腹
  if (food.fat > 15 && food.carbs < 20) s += 1; // 脂肪缓释
  if (food.calories > 0 && food.calories < 100) s -= 1; // 低热量不饱腹
  return Math.max(1, Math.min(10, s));
}
```

#### P1-5: i18n 新增 keys + tsc 检查

新增:

- `decision.factor.*` — 结构化决策因子文案
- `decision.portion.*` — 份量建议文案

---

### Phase 2: 决策精度增强

#### P2-1: Breakdown 驱动的精准原因定位

当前 `computeDecision()` 用 if-else 堆叠检测各种问题。V1.3 改为:

```typescript
// 从 breakdown 中定位最弱维度
const weakDimensions = Object.entries(breakdown)
  .filter(([_, score]) => score < 50)
  .sort((a, b) => a[1] - b[1]);

// 生成结构化决策因子
const factors: DecisionFactor[] = weakDimensions.map(([dim, score]) => ({
  dimension: dim,
  score,
  impact: score < 30 ? 'critical' : 'warning',
  message: t(`decision.factor.${dim}.low`, { score: String(score) }, locale),
}));
```

**新类型:**

```typescript
interface DecisionFactor {
  dimension: string; // energy | proteinRatio | macroBalance | foodQuality | satiety | stability | glycemicImpact
  score: number; // 该维度分数 0-100
  impact: 'critical' | 'warning' | 'positive';
  message: string; // 人类可读解释
}
```

#### P2-2: 最优份量计算

当前 `generateDecisionAdvice()` 中 "减少到X%" 是 `max(30, remaining/totalCalories * 100)` 粗估。

V1.3 新增精准份量:

```typescript
function calculateOptimalPortion(
  mealCalories: number,
  remainingCalories: number,
  goalType: string
): { recommendedPercent: number; recommendedCalories: number } {
  if (remainingCalories <= 0) {
    return { recommendedPercent: 0, recommendedCalories: 0 };
  }
  // 基于目标留出下一餐余量
  const mealBudget =
    goalType === 'fat_loss'
      ? remainingCalories * 0.8 // 减脂留20%缓冲
      : remainingCalories * 0.9; // 其他留10%
  const percent = Math.round(Math.min(100, (mealBudget / mealCalories) * 100));
  return {
    recommendedPercent: Math.max(20, percent),
    recommendedCalories: Math.round((mealCalories * percent) / 100),
  };
}
```

#### P2-3: LLM 食物的引擎替代方案

当前: `getEngineAlternatives()` 要求 `food.libraryMatch.id` 才能调用 `substitutionService.findSubstitutes()`。
LLM 解析的食物没有 libraryMatch，因此永远走静态 fallback。

V1.3: 对 LLM 食物做模糊名称搜索匹配最近似的标准库食物，用该 ID 调用替代引擎:

```typescript
// 在 getEngineAlternatives 中为无 libraryMatch 的食物补匹配
if (!food.libraryMatch?.id && food.name) {
  const fuzzyMatch = await this.foodLibraryService.searchByName(food.name, 1);
  if (fuzzyMatch.length > 0 && fuzzyMatch[0].similarity > 0.5) {
    proxyId = fuzzyMatch[0].id;
  }
}
```

#### P2-4: i18n + tsc

---

### Phase 3: 教练增强 + 可解释性

#### P3-1: 评分 breakdown 注入 AI 教练 prompt

在 `prepareContext()` 注入分析上下文时，新增 breakdown 数据:

```
【评分详情】
- 热量控制: 85/100（良好）
- 蛋白质比例: 42/100（⚠ 不足）
- 宏量均衡: 78/100（良好）
- 食物质量: 60/100（一般）
- 最弱维度: 蛋白质比例
```

这让 AI 教练能基于具体弱项给出精准建议。

#### P3-2: 结构化决策因子注入 AnalysisContextDto

`AnalysisContextDto` 新增:

```typescript
scoreBreakdown?: {
  energy: number;
  proteinRatio: number;
  macroBalance: number;
  foodQuality: number;
  satiety: number;
  stability: number;
  glycemicImpact: number;
};
decisionFactors?: Array<{
  dimension: string;
  score: number;
  impact: string;
  message: string;
}>;
optimalPortion?: {
  recommendedPercent: number;
  recommendedCalories: number;
};
```

#### P3-3: 下一餐建议生成

新增 `generateNextMealAdvice()`:

```typescript
// 基于当日剩余 macro 缺口，生成下一餐的 macro 目标
function generateNextMealAdvice(ctx: UserContext, currentMealTotals: NutritionTotals): NextMealAdvice {
  const remainingProtein = ctx.goalProtein - ctx.todayProtein - currentMealTotals.protein;
  const remainingFat = ctx.goalFat - ctx.todayFat - currentMealTotals.fat;
  const remainingCarbs = ctx.goalCarbs - ctx.todayCarbs - currentMealTotals.carbs;
  const remainingCalories = ctx.goalCalories - ctx.todayCalories - currentMealTotals.calories;

  return {
    targetCalories: Math.max(0, remainingCalories),
    targetProtein: Math.max(0, remainingProtein),
    targetFat: Math.max(0, remainingFat),
    targetCarbs: Math.max(0, remainingCarbs),
    emphasis: identifyEmphasis(remainingProtein, remainingFat, remainingCarbs, ctx.goalType),
    suggestion: generateSuggestionText(...)
  };
}
```

#### P3-4: FoodDecision 类型扩展

```typescript
export interface FoodDecision {
  recommendation: 'recommend' | 'caution' | 'avoid';
  shouldEat: boolean;
  reason: string;
  riskLevel: 'low' | 'medium' | 'high';
  advice?: string;
  // V1.3 新增
  decisionFactors?: DecisionFactor[];
  optimalPortion?: { recommendedPercent: number; recommendedCalories: number };
  nextMealAdvice?: NextMealAdvice;
}
```

#### P3-5: AnalysisScore 类型扩展

```typescript
export interface AnalysisScore {
  healthScore: number;
  nutritionScore: number;
  confidenceScore: number;
  // V1.3 新增
  breakdown?: NutritionScoreBreakdown;
}
```

#### P3-6: i18n + tsc

---

## Step 8: 分阶段迭代计划

### Phase 1（P1-1 ~ P1-5）: 评分增强 + 服务解耦

| 任务  | 文件                            | 说明                                                                                                  |
| ----- | ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| P1-1  | 新建 `food-decision.service.ts` | 抽离 computeDecision + generateDecisionAdvice + generateExplanation + generateAlternatives + 辅助方法 |
| P1-2  | `analysis-result.types.ts`      | AnalysisScore 新增 `breakdown` 字段                                                                   |
| P1-2b | `text-food-analysis.service.ts` | calculateScore 保留 breakdown 并传递                                                                  |
| P1-3  | `text-food-analysis.service.ts` | calculateScore 注入 stabilityData（从 BehaviorService 读取）                                          |
| P1-4  | `food-decision.service.ts`      | LLM 食物 quality/satiety 估算函数                                                                     |
| P1-5  | i18n + tsc                      | 新增 keys，类型检查                                                                                   |

### Phase 2（P2-1 ~ P2-4）: 决策精度增强

| 任务 | 文件                       | 说明                                    |
| ---- | -------------------------- | --------------------------------------- |
| P2-1 | `food-decision.service.ts` | breakdown 驱动精准原因 + DecisionFactor |
| P2-2 | `food-decision.service.ts` | 最优份量计算                            |
| P2-3 | `food-decision.service.ts` | LLM 食物模糊匹配获取引擎替代            |
| P2-4 | i18n + tsc                 | 新增 keys，类型检查                     |

### Phase 3（P3-1 ~ P3-6）: 教练增强 + 可解释性

| 任务 | 文件                       | 说明                                                            |
| ---- | -------------------------- | --------------------------------------------------------------- |
| P3-1 | `coach.service.ts`         | breakdown 注入 prompt                                           |
| P3-2 | `coach.dto.ts`             | AnalysisContextDto 扩展 breakdown/factors/portion               |
| P3-3 | `food-decision.service.ts` | 下一餐建议 generateNextMealAdvice                               |
| P3-4 | `analysis-result.types.ts` | FoodDecision 扩展 decisionFactors/optimalPortion/nextMealAdvice |
| P3-5 | `analysis-result.types.ts` | AnalysisScore 扩展 breakdown                                    |
| P3-6 | i18n + tsc                 | 新增 keys，类型检查                                             |

---

## 禁止修改范围

- ❌ 推荐系统（SubstitutionService 只读调用）
- ❌ 用户画像系统（UserProfileService 只读调用）
- ❌ BehaviorService（只读调用）
- ❌ 订阅/商业化逻辑
- ❌ 数据库 schema
