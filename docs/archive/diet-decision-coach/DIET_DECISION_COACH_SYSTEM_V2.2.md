# 饮食决策 + AI教练系统 V2.2 — 智能决策升级

> 基于 V2.1（解耦分离 + 统一管道 + i18n 基础）之上，聚焦**决策智能化**：
> 将硬编码绝对阈值替换为用户画像驱动的动态阈值，引入置信度加权评分，
> 深度集成推荐引擎的替代方案，增强可解释性，优化教练上下文质量。

---

## Step 1：当前系统能力分析 — 缺失点

### 已具备能力

| 层         | 能力                                                  | 状态        |
| ---------- | ----------------------------------------------------- | ----------- |
| **分析层** | 文本/图片食物识别 + 营养估算                          | ✅ 成熟     |
| **分析层** | 食物库匹配 + LLM 兜底                                 | ✅ 成熟     |
| **分析层** | 上下文构建（今日摄入/目标/余量）                      | ✅ 成熟     |
| **评分层** | 7维评分（能量/蛋白比/宏量均衡/质量/饱腹/稳定性/血糖） | ✅ 成熟     |
| **评分层** | 目标权重向量（fat_loss/muscle_gain/health/habit）     | ✅ 成熟     |
| **评分层** | 餐后投影评分（today + meal projection）               | ✅ 成熟     |
| **决策层** | Should Eat 判断（recommend/caution/avoid）            | ✅ 成熟     |
| **决策层** | 上下文修正（累积饱和/深夜/多日趋势/暴食风险）         | ✅ 成熟     |
| **决策层** | 替代方案（引擎优先 + 静态兜底）                       | ✅ 基本可用 |
| **决策层** | 问题检测 + 宏量进度                                   | ✅ 成熟     |
| **教练层** | 事件驱动自动注入分析上下文                            | ✅ 成熟     |
| **教练层** | 个性化语气（strict/friendly/data × 4 目标）           | ✅ 成熟     |
| **教练层** | 行为洞察注入（弱餐/替换模式/偏好）                    | ✅ 成熟     |

### 关键缺失点（V2.2 要解决的 8 个问题）

| #      | 缺失点                                                                                                                            | 影响                                                                          | 严重度 |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------ |
| **D1** | **50+ 硬编码绝对阈值**：15g 蛋白、30g 脂肪、300kcal "显著餐"门槛、60g 碳水等，对 50kg 女性和 100kg 男性用同一标准                 | 决策准确度：小体重用户永远不触发警告，大体重用户频繁误报                      | 🔴 高  |
| **D2** | **置信度未参与评分加权**：低置信度食物（LLM 猜测，confidence=0.7）和高置信度食物（库匹配，confidence=0.95）对评分贡献相同         | 评分不可靠：一个猜测的 500kcal 食物会显著拉低得分，但其实可能根本不是 500kcal | 🔴 高  |
| **D3** | **决策检查(decision-checks.ts)全部用绝对值**：与 D1 同源但分布在独立文件中，8 个检查函数共 419 行，全部硬编码                     | 维护困难，无法针对用户个性化                                                  | 🟡 中  |
| **D4** | **替代方案未深度使用推荐引擎的 Recall→Rank→Rerank 管道**：当前只调用 `recommendMeal` 取 top-N，未传递当前餐的问题维度作为召回约束 | 替代方案质量：推荐的替代食物可能不针对当前问题（如蛋白不足时推荐高碳水食物）  | 🟡 中  |
| **D5** | **教练收到的是原始数据堆砌**：`formatAnalysisContext` 输出 ~20 个段落，LLM 需自行理解并挑选重点                                   | 教练回复质量不稳定，有时忽略关键问题                                          | 🟡 中  |
| **D6** | **评分维度阈值分散**：decision-thresholds.ts、nutrition-score.service.ts、decision-engine.service.ts 各有一套阈值，无统一配置源   | 改一处漏一处，回归风险高                                                      | 🟡 中  |
| **D7** | **决策解释缺乏量化证据**：explanation 主要是文字描述，缺少 "你的蛋白摄入 32g / 目标 120g = 27%" 这种精确数据                      | 用户信任度低，不知道为什么被警告                                              | 🟡 中  |
| **D8** | **决策检查的时间边界硬编码**：21:00-05:00 深夜、18:00-21:00 晚间，不适用于轮班工作者                                              | 对非标准作息用户产生错误决策                                                  | 🟢 低  |

---

## Step 2-7：V2.2 设计

### 优化目标（8 个）

| #      | 目标                                                     | 对应缺失   | Phase |
| ------ | -------------------------------------------------------- | ---------- | ----- |
| **O1** | 动态阈值系统：所有决策阈值基于用户画像动态计算           | D1, D3, D8 | 1     |
| **O2** | 置信度加权评分：低置信度食物对评分贡献按比例衰减         | D2         | 1     |
| **O3** | 决策检查重构：decision-checks 从绝对值改为消费动态阈值   | D3         | 1     |
| **O4** | 替代方案深度集成：传递问题维度到推荐引擎作为召回约束     | D4         | 2     |
| **O5** | 教练结构化摘要：新增 DecisionSummary 层，预消化关键信息  | D5         | 2     |
| **O6** | 阈值配置集中化：统一 ThresholdConfig，所有服务从一处读取 | D6         | 2     |
| **O7** | 量化可解释性：决策解释附带精确数值对比                   | D7         | 3     |
| **O8** | 决策检查 i18n 补全 + 时间边界用户化                      | D8         | 3     |

---

### 架构设计

#### 新增文件

```
food/app/config/
  └── dynamic-thresholds.service.ts   ← O1/O3: 动态阈值计算服务
food/app/scoring/
  └── confidence-weighting.ts         ← O2: 置信度加权纯函数
food/app/decision/
  └── decision-summary.service.ts     ← O5: 教练结构化摘要
```

#### 修改文件

```
food/app/config/decision-thresholds.ts          ← O6: 扩展为完整阈值配置
food/app/scoring/food-scoring.service.ts         ← O2: 集成置信度加权
food/app/decision/decision-checks.ts             ← O1/O3: 消费动态阈值
food/app/decision/decision-engine.service.ts     ← O1: 消费动态阈值
food/app/decision/portion-advisor.service.ts     ← O1: 动态 buffer ratio
food/app/decision/issue-detector.service.ts      ← O1: 动态问题检测阈值
food/app/decision/alternative-suggestion.service.ts  ← O4: 传递问题约束
food/app/decision/decision-explainer.service.ts  ← O7: 量化证据
food/app/pipeline/analysis-pipeline.service.ts   ← O5: 调用 summary 服务
coach/app/prompt/coach-prompt-builder.service.ts ← O5: 消费结构化摘要
food/food.module.ts                              ← 注册新服务
```

---

### O1：动态阈值系统

**核心思想**：所有绝对阈值替换为 `用户日目标 × 比例因子`。

**DynamicThresholdsService**：

```typescript
// 输入：UnifiedUserContext（已有）
// 输出：UserThresholds（新类型）

interface UserThresholds {
  // 餐级阈值
  significantMealCal: number; // 原 300kcal → goalCalories * 0.15
  highProteinMeal: number; // 原 25g → goalProtein * 0.3
  lowProteinMeal: number; // 原 15g → goalProtein * 0.12
  veryLowProteinMeal: number; // 原 10g → goalProtein * 0.08
  highFatMeal: number; // 原 30g → goalFat * 0.45
  highCarbMeal: number; // 原 60g → goalCarbs * 0.22
  dinnerHighCarb: number; // 原 40g → goalCarbs * 0.15
  snackHighCal: number; // 原 200kcal → goalCalories * 0.1

  // 预算阈值
  overBudgetMargin: number; // 原 -100kcal → goalCalories * -0.05
  singleMealMaxRatio: number; // 原 0.5 → 保持 0.5（已是比例）
  carbExcessRatio: number; // 原 1.1 → 保持 1.1
  carbCriticalRatio: number; // 原 1.3 → 保持 1.3
  fatExcessRatio: number; // 原 1.0 → 保持 1.0
  fatCriticalRatio: number; // 原 1.3 → 保持 1.3

  // 份量阈值
  portionBufferRatio: number; // 原 0.8/0.9 → fat_loss=0.8, 其他=0.9
  portionMinPercent: number; // 原 20 → 保持 20
  nextMealLowBudget: number; // 原 100kcal → goalCalories * 0.05

  // 健康检查阈值
  sodiumLimit: number; // 原 800mg → 有高血压时 600mg，否则 2000mg
  addedSugarLimit: number; // 原 10g → 有糖尿病时 5g，否则 25g

  // 时间边界（未来可从用户画像读取作息）
  lateNightStart: number; // 原 21 → 21
  lateNightEnd: number; // 原 5 → 5
  eveningStart: number; // 原 18 → 18
}
```

**计算规则**：纯函数，输入 `UnifiedUserContext`，无副作用。所有比例因子定义在 `decision-thresholds.ts` 中作为常量。

---

### O2：置信度加权评分

**核心思想**：食物的置信度越低，其营养数据对评分的影响应被"衰减"到均值。

```typescript
// confidence-weighting.ts — 纯函数

/**
 * 将食物的营养值按置信度向"中性值"衰减。
 * 置信度=1.0 → 使用原值
 * 置信度=0.5 → 原值和中性值各占一半
 * 中性值 = 用户单餐目标值（goalX / mealsPerDay）
 */
function applyConfidenceWeighting(
  food: AnalyzedFoodItem,
  mealTarget: MealNutritionTarget
): WeightedNutrition {
  const w = food.confidence ?? 0.7;
  return {
    calories: food.calories * w + mealTarget.calories * (1 - w),
    protein: food.protein * w + mealTarget.protein * (1 - w),
    fat: food.fat * w + mealTarget.fat * (1 - w),
    carbs: food.carbs * w + mealTarget.carbs * (1 - w),
  };
}
```

**集成点**：在 `FoodScoringService.calculateScore()` 的营养汇总步骤中，对每个食物先做置信度加权再求和。`calculateImageScore` 同理。

**影响范围**：只影响评分输入，不影响用户看到的原始营养数据展示。

---

### O3：决策检查重构

**当前问题**：`decision-checks.ts` 中 8 个检查函数都用字面量（15, 30, 300, 800 等）。

**改造方式**：每个检查函数增加 `thresholds: UserThresholds` 参数，内部读取动态值。

改造前：

```typescript
if (mealProtein < 15 && mealCalories > 300) { ... }
```

改造后：

```typescript
if (mealProtein < thresholds.lowProteinMeal && mealCalories > thresholds.significantMealCal) { ... }
```

**影响**：`IssueDetectorService.identifyIssues()` 和 `DecisionEngineService.computeDecision()` 需要先调用 `DynamicThresholdsService.compute(ctx)` 获取阈值，然后传递给检查函数。

---

### O4：替代方案深度集成推荐引擎

**当前问题**：`AlternativeSuggestionService.generateAlternatives()` 调用推荐引擎时只传 mealType，不传当前餐的问题维度。

**改造**：

1. 从 `IssueDetectorService` 的问题列表中提取**约束维度**（如 proteinDeficit → 需高蛋白、fatExcess → 需低脂）
2. 构造 `alternativeConstraints` 传给推荐引擎的过滤层
3. 推荐引擎返回的食物已天然经过 Recall→Rank→Rerank，质量高于静态规则

```typescript
interface AlternativeConstraints {
  preferHighProtein?: boolean; // 当蛋白不足时
  preferLowFat?: boolean; // 当脂肪过高时
  preferLowCarb?: boolean; // 当碳水过高时
  preferLowCalorie?: boolean; // 当热量超标时
  maxCalories?: number; // 剩余热量预算
  excludeAllergens?: string[]; // 过敏原排除
  excludeCategories?: string[]; // 饮食限制排除
}
```

**集成方式**：在 `AlternativeSuggestionService` 中，将约束传给推荐引擎的 filter 阶段。推荐引擎的 `FilterService` 已支持过滤逻辑，只需扩展过滤参数。

---

### O5：教练结构化摘要

**当前问题**：`formatAnalysisContext` 输出 20 个段落原始数据，LLM 自行理解。

**改造**：新增 `DecisionSummaryService`，产出结构化摘要。

```typescript
interface DecisionSummary {
  headline: string; // "这顿红烧肉饭热量偏高(850kcal)，建议减量到60%"
  verdict: 'recommend' | 'caution' | 'avoid';
  topIssues: string[]; // 最多 3 个，按严重度排序
  topStrengths: string[]; // 最多 2 个正面因素
  actionItems: string[]; // 最多 3 个可执行建议
  quantitativeHighlight: string; // "蛋白质 12g/目标120g(10%), 严重不足"
  alternativeSummary?: string; // "建议替换为：鸡胸肉沙拉(450kcal, 蛋白42g)"
}
```

**集成方式**：

1. `AnalysisPipelineService.execute()` 在 Step 6 后调用 `DecisionSummaryService.summarize()`
2. `FoodAnalysisResultV61` 新增 `summary: DecisionSummary` 字段
3. `CoachPromptBuilderService.formatAnalysisContext()` 优先使用 summary 构建精简上下文
4. 原始详细数据仍然保留，但降级为补充信息

---

### O6：阈值配置集中化

**当前分散的阈值源**：

| 文件                             | 内容                                         |
| -------------------------------- | -------------------------------------------- |
| `decision-thresholds.ts`         | 4 个目标的 score→decision 边界               |
| `nutrition-score.service.ts`     | 权重向量、蛋白范围、Gaussian σ、penalty 阈值 |
| `decision-engine.service.ts`     | 300kcal、15g、25g、60g 等餐级阈值            |
| `decision-checks.ts`             | 同上 + 800mg 钠、10g 糖                      |
| `contextual-modifier.service.ts` | 1.1 饱和度、0.85 深夜、0.03/天               |
| `scoring-dimensions.ts`          | impact 阈值 70/40                            |

**改造**：`decision-thresholds.ts` 扩展为**完整阈值配置中心**，包含：

- Score→Decision 边界（已有）
- 比例因子常量（新增：`SIGNIFICANT_MEAL_RATIO = 0.15` 等）
- Modifier 参数（新增：从 contextual-modifier 迁入）
- Impact 阈值（从 scoring-dimensions 迁入或重导出）

**不迁移**的：`nutrition-score.service.ts` 中的评分公式参数（Gaussian σ、权重向量等），因为这些是评分算法内部实现，不是决策阈值。

---

### O7：量化可解释性

**改造 `DecisionExplainerService`**：

当前输出示例：

```
"蛋白质摄入偏低，建议增加优质蛋白"
```

改造后输出：

```
"蛋白质摄入 12g，仅占目标 120g 的 10%（建议单餐 ≥36g），建议增加优质蛋白"
```

**实现方式**：`generateExplanation()` 方法已接收 `UnifiedUserContext`（含 goalProtein/todayProtein 等），只需在文案模板中插入量化数据。

同时改造 `generateDecisionChain()` 的每个 step，附带具体数值。

---

### O8：时间边界用户化 + i18n 补全

- `UserThresholds` 中的时间边界从用户画像读取（如有），否则用默认值
- `decision-checks.ts` 中残余的中文硬编码（如 allergen 检测的食物名列表）通过 food-labels.ts 或独立 i18n 配置管理

---

## Step 8：分阶段实施

### Phase 1：动态阈值 + 置信度加权 + 决策检查重构

| 任务 | 文件                                           | 说明                                        |
| ---- | ---------------------------------------------- | ------------------------------------------- |
| 1.1  | 新建 `config/dynamic-thresholds.service.ts`    | `UserThresholds` 类型 + `compute(ctx)` 方法 |
| 1.2  | 修改 `config/decision-thresholds.ts`           | 新增比例因子常量 + modifier 参数常量        |
| 1.3  | 新建 `scoring/confidence-weighting.ts`         | `applyConfidenceWeighting` 纯函数           |
| 1.4  | 修改 `scoring/food-scoring.service.ts`         | `calculateScore` 集成置信度加权             |
| 1.5  | 修改 `decision/decision-checks.ts`             | 所有检查函数接收 `UserThresholds` 参数      |
| 1.6  | 修改 `decision/decision-engine.service.ts`     | `computeDecision` 先算阈值再传入            |
| 1.7  | 修改 `decision/issue-detector.service.ts`      | `identifyIssues` 消费动态阈值               |
| 1.8  | 修改 `decision/portion-advisor.service.ts`     | 消费动态 buffer ratio                       |
| 1.9  | 修改 `decision/contextual-modifier.service.ts` | 参数常量迁入 decision-thresholds            |
| 1.10 | 注册 `DynamicThresholdsService` 到 FoodModule  |
| 1.11 | 编译验证                                       |

### Phase 2：替代方案引擎集成 + 教练结构化摘要 + 阈值集中化

| 任务 | 文件                                                    | 说明                                        |
| ---- | ------------------------------------------------------- | ------------------------------------------- |
| 2.1  | 修改 `decision/alternative-suggestion.service.ts`       | 传递问题约束到推荐引擎                      |
| 2.2  | 新建 `decision/decision-summary.service.ts`             | `DecisionSummary` 类型 + `summarize()`      |
| 2.3  | 修改 `types/analysis-result.types.ts`                   | `FoodAnalysisResultV61` 新增 `summary` 字段 |
| 2.4  | 修改 `pipeline/analysis-pipeline.service.ts`            | 调用 summary 服务                           |
| 2.5  | 修改 `coach/app/prompt/coach-prompt-builder.service.ts` | 优先使用 summary                            |
| 2.6  | 修改 `pipeline/result-assembler.service.ts`             | 组装 summary                                |
| 2.7  | 注册 `DecisionSummaryService` 到 FoodModule             |
| 2.8  | 编译验证                                                |

### Phase 3：量化可解释性 + i18n 补全 + 教练增强

| 任务 | 文件                                           | 说明                          |
| ---- | ---------------------------------------------- | ----------------------------- |
| 3.1  | 修改 `decision/decision-explainer.service.ts`  | 解释附带量化数据              |
| 3.2  | 修改 `decision/decision-engine.service.ts`     | 决策链步骤附带数值            |
| 3.3  | 修改 `decision/decision-checks.ts`             | 检查结果 message 包含量化数据 |
| 3.4  | 更新 `i18n/food-labels.ts`                     | 新增决策检查相关的 i18n key   |
| 3.5  | 修改 `decision/contextual-modifier.service.ts` | modifier 原因附带数值         |
| 3.6  | 编译验证                                       |

---

## 禁止修改范围（重申）

- ❌ `modules/diet/app/recommendation/` — 推荐系统（只读调用）
- ❌ `modules/user/app/services/profile/` — 用户画像系统（只读调用）
- ❌ 订阅/商业化逻辑
- ❌ 数据库 schema / migration
- ✅ 允许增加 TypeScript 接口字段（内存态，不涉及 DB）
