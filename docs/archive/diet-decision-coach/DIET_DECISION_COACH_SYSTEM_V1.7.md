# 饮食决策 + AI教练系统 V1.7 设计文档

> 版本: V1.7 | 基于 V1.6 升级 | 核心主题: **精度提升 + 定量化 + 结构化问题识别 + 国际化补齐**

---

## Step 1: V1.6 现有能力分析与缺失点

### 1.1 分析层（Analyze）

| 能力     | 现状                                       | 缺失/问题                                               |
| -------- | ------------------------------------------ | ------------------------------------------------------- |
| 食物识别 | ✅ 标准库匹配 + LLM 补位                   | —                                                       |
| 营养计算 | ✅ 16维营养数据                            | —                                                       |
| 评分引擎 | ✅ FoodScoringService 门面 + 7维 breakdown | ❌ 维度解释只有模板文案，无定量数据（实际值 vs 目标值） |
| 评分解释 | ✅ BreakdownExplanation 3语言              | ❌ 无法回答"蛋白质具体差多少"这类问题                   |

### 1.2 决策层（Decision）

| 能力       | 现状                            | 缺失/问题                                                                                                  |
| ---------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 基础决策   | ✅ scoreToFoodDecision          | ❌ 所有目标用相同阈值（75/55/35），减脂/增肌应有差异                                                       |
| 决策链     | ✅ DecisionExplainerService     | ❌ **类型不匹配**: 定义 `{step:number, factor, action, resultLevel}` 实际用 `{step:string, input, output}` |
| 替代对比   | ✅ AlternativeSuggestionService | ❌ `comparison` 字段未真正实现定量对比（caloriesDiff/proteinDiff/scoreDiff 对象）                          |
| 问题识别   | ✅ contextReasons 字符串数组    | ❌ 非结构化，前端/教练无法精确引用单个问题                                                                 |
| 上下文分析 | ✅ 今日摄入对比                 | ❌ 缺少宏量营养进度百分比汇总输出                                                                          |

### 1.3 教练层（Coach）

| 能力           | 现状                           | 缺失/问题                                               |
| -------------- | ------------------------------ | ------------------------------------------------------- |
| 分析上下文注入 | ✅ breakdown + decisionChain   | ❌ 注入文本标签硬编码中文（"刚分析的食物"、"总热量"等） |
| 结构化回复     | ✅ 结论/原因/建议/替代 4段结构 | ❌ 无法引用结构化问题列表给出针对性指导                 |
| 个性化语气     | ✅ 3种教练风格                 | —                                                       |

---

## Step 2: V1.7 优化目标（6个）

1. **修复 DecisionChainStep 类型不匹配** — 统一类型定义与实现
2. **评分解释定量化** — BreakdownExplanation 增加 `actualValue/targetValue/unit` 字段
3. **决策阈值目标差异化** — scoreToFoodDecision 根据 goalType 使用不同阈值
4. **替代方案定量对比** — comparison 字段填充真实的 caloriesDiff/proteinDiff
5. **问题识别结构化** — 新增 `DietIssue` 类型替代 contextReasons 字符串
6. **Coach 分析上下文国际化** — prepareContext 标签跟随 locale

---

## Step 3-7: 分阶段实现

### Phase 1: 类型修复 + 评分定量化 + 决策阈值

**P1-1: 修复 DecisionChainStep 类型**

```typescript
// analysis-result.types.ts — 修正类型定义
export interface DecisionChainStep {
  /** 步骤名称（如"营养评分计算"） */
  step: string;
  /** 输入描述 */
  input: string;
  /** 输出描述 */
  output: string;
}
```

移除旧的 `{step: number, factor, action, resultLevel}` 定义。

**P1-2: 评分解释定量化**

```typescript
// BreakdownExplanation 扩展
export interface BreakdownExplanation {
  dimension: string;
  label: string;
  score: number;
  impact: 'positive' | 'warning' | 'critical';
  message: string;
  /** V1.7: 实际值 */
  actualValue?: number;
  /** V1.7: 目标/推荐值 */
  targetValue?: number;
  /** V1.7: 单位（如 'kcal', 'g', '%'） */
  unit?: string;
}
```

FoodScoringService.explainBreakdown() 增加定量数据计算：

- energy: 实际热量 vs 目标热量
- proteinRatio: 实际蛋白质占比% vs 推荐占比%
- macroBalance: 实际比例 vs 理想比例
- foodQuality: 食物质量分 (1-10)
- satiety: 饱腹感分 (1-10)

**P1-3: 决策阈值目标差异化**

```typescript
const GOAL_DECISION_THRESHOLDS: Record<
  string,
  { excellent: number; good: number; caution: number }
> = {
  fat_loss: { excellent: 78, good: 58, caution: 38 }, // 更严格
  muscle_gain: { excellent: 72, good: 52, caution: 32 }, // 蛋白质权重高，分数可能偏低
  health: { excellent: 75, good: 55, caution: 35 }, // 默认
  habit: { excellent: 70, good: 50, caution: 30 }, // 更宽松，鼓励为主
};
```

---

### Phase 2: 替代对比 + 问题结构化 + 上下文增强

**P2-1: 替代方案定量对比**

AlternativeSuggestionService 增强：

- 从 SubstitutionService 返回的候选食物中提取 `servingCalories`, `servingProtein`
- 计算 `caloriesDiff = alternative.calories - original.calories`
- 计算 `proteinDiff = alternative.protein - original.protein`
- 填充 `FoodAlternative.comparison` 对象

```typescript
// 修改 explainAlternative 返回对象而非字符串
private buildComparison(
  originalFoods: DecisionFoodItem[],
  candidate: SubstitutionCandidate,
): AlternativeComparison {
  const origCalories = originalFoods.reduce((s,f) => s + f.calories, 0) / originalFoods.length;
  const origProtein = originalFoods.reduce((s,f) => s + f.protein, 0) / originalFoods.length;
  return {
    caloriesDiff: Math.round(candidate.servingCalories - origCalories),
    proteinDiff: Math.round(candidate.servingProtein - origProtein),
  };
}
```

**P2-2: 问题识别结构化**

新增 `DietIssue` 类型：

```typescript
export interface DietIssue {
  /** 问题类别 */
  category:
    | 'calorie_excess'
    | 'calorie_deficit'
    | 'protein_low'
    | 'fat_high'
    | 'carbs_high'
    | 'timing'
    | 'allergen'
    | 'health_conflict'
    | 'restriction';
  /** 严重程度 */
  severity: 'info' | 'warning' | 'critical';
  /** 人类可读描述（i18n） */
  message: string;
  /** 定量数据 */
  data?: { actual?: number; target?: number; unit?: string };
}
```

FoodDecision 扩展：

```typescript
interface FoodDecision {
  // ... 现有字段
  /** V1.7: 结构化问题列表 */
  issues?: DietIssue[];
}
```

FoodDecisionService.computeDecision() 在现有 contextReasons 逻辑基础上，同步生成 issues 数组。

**P2-3: 上下文宏量进度汇总**

DecisionOutput 扩展：

```typescript
interface DecisionOutput {
  // ... 现有字段
  /** V1.7: 当日宏量营养进度 */
  macroProgress?: {
    calories: { consumed: number; target: number; percent: number };
    protein: { consumed: number; target: number; percent: number };
    fat: { consumed: number; target: number; percent: number };
    carbs: { consumed: number; target: number; percent: number };
  };
}
```

---

### Phase 3: Coach 国际化 + 结构化注入 + 引导增强

**P3-1: Coach 分析上下文国际化**

prepareContext() 中所有硬编码中文标签改为 locale 感知：

- "刚分析的食物" → i18n
- "食物"/"总热量"/"宏量"/"AI判定"/"风险等级"/"营养评分"/"AI建议"/"餐次" → i18n
- "请结合以上分析结果给出针对性建议" → i18n

**P3-2: 结构化问题注入 Coach**

prepareContext() 增加 issues 注入：

```
【识别到的问题】
- [warning] 蛋白质不足: 当前15g，目标25g
- [critical] 热量超标: 超出200kcal
```

教练可以基于 issues 的 severity 优先回应 critical 问题。

**P3-3: 宏量进度注入 Coach**

```
【宏量营养进度】
- 热量: 1200/1800 kcal (67%)
- 蛋白质: 45/90g (50%)
- 脂肪: 40/60g (67%)
- 碳水: 150/225g (67%)
```

---

## Step 8: 模块注册变更

无新服务需要注册，V1.7 所有变更在现有服务内部完成。

---

## 约束

- 不新增数据库字段
- 不修改推荐系统/用户画像（只读）
- 不修改订阅/商业化逻辑
- 使用已有 `t(key, vars?, locale?)` + 本地 i18n 映射
- 三语言: zh-CN / en-US / ja-JP
