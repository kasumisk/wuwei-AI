# 饮食决策 + AI教练系统 V3.2 设计文档

**版本**: V3.2  
**基线**: V3.1（动态权重、置信度分级、结构化输出、每日摘要、signalTrace 联动）  
**设计日期**: 2026-04-17  
**核心目标**: 围绕"吃之前/吃之后"完整决策链，解耦分离分析→评分→决策→教练，结合推荐系统和用户画像  
**状态**: 设计阶段，待实施 Phase 1-3

---

## 一、Step 1 — 现有能力分析

### 1.1 分析层（Analyze）✅ 已具备

| 能力                     | 状态 | 说明                                               |
| ------------------------ | ---- | -------------------------------------------------- |
| 单次食物识别             | ✅   | text/image 链路，支持文本和图片                    |
| 营养汇总                 | ✅   | `aggregateNutrition()` 支持热量/宏量计算           |
| 当日上下文               | ✅   | `MacroSlotStatus`（四维）+ `MacroProgress`（消耗） |
| 置信度诊断               | ✅   | `ConfidenceDiagnostics.reviewLevel` 区分手动/自动  |
| **缺失**: 分析准确度评估 | ❌   | 无法量化当前识别的准确度指标                       |
| **缺失**: 问题识别       | ❌   | 无显式"蛋白不足/脂肪过高"的结构化识别              |

### 1.2 评分层（Scoring）✅ 已具备

| 能力                         | 状态 | 说明                                                           |
| ---------------------------- | ---- | -------------------------------------------------------------- |
| 综合健康分                   | ✅   | `NutritionScoreService` 7 维度                                 |
| 维度 breakdown               | ✅   | `scoreToImpact()` 转化为文本影响                               |
| 用户画像融合                 | ✅   | `FoodScoringService` 调用 BehaviorService + UserProfileService |
| 置信度加权                   | ✅   | `aggregateWithConfidence()` 融合分析置信度                     |
| **缺失**: 食物评分与推荐融合 | ❌   | 评分与推荐系统未显式关联                                       |
| **缺失**: 分量评分           | ❌   | 仅评分食材本身，未评价分量适配度                               |

### 1.3 决策层（Decision）✅ 已具备

| 能力                               | 状态 | 说明                                        |
| ---------------------------------- | ---- | ------------------------------------------- |
| 三档决策                           | ✅   | RECOMMEND / CAUTION / AVOID                 |
| 动态阈值                           | ✅   | `DynamicThresholdsService` 基于用户画像计算 |
| 信号优先级                         | ✅   | `signalTrace` 追踪 top-N 问题信号           |
| 动态权重                           | ✅   | V3.1 `DynamicSignalWeightService`           |
| 决策原因解释                       | ✅   | `DecisionExplainerService` + 类型化原因     |
| **缺失**: "Should Eat?" 结构化建议 | ❌   | 无显式"吃/替代/不吃"对应的替代建议          |
| **缺失**: 分量建议                 | ⚠️   | `PortionAdvisorService` 存在但未与决策集成  |

### 1.4 教练层（Coach）✅ 已具备

| 能力                     | 状态 | 说明                                               |
| ------------------------ | ---- | -------------------------------------------------- |
| 语气引擎                 | ✅   | V3.0 `ToneResolverService`（strict/friendly/data） |
| Prompt 深度控制          | ✅   | V3.1 `promptDepth` 驱动段落省略                    |
| 结构化输出               | ✅   | V3.1 `CoachOutputSchema`                           |
| 每日摘要                 | ✅   | V3.1 `DailyMacroSummaryService`                    |
| **缺失**: 对话式引导     | ❌   | 教练输出是单轮决策结果，无多轮对话逻辑             |
| **缺失**: 个性化建议模板 | ❌   | 建议生成无结构化模板，全靠 prompt 自由生成         |

### 1.5 当前链路缺失点

| 缺失                         | 影响 | 备注                                     |
| ---------------------------- | ---- | ---------------------------------------- |
| **吃之前 → 吃之后** 决策链路 | 🔴   | 现有是分离的：吃前决策、吃后恢复各自为政 |
| **分析准确度到决策**的反馈   | 🔴   | 无法量化"这个分析精准吗?"，影响决策权重  |
| **推荐引擎融合**             | 🟡   | 评分和决策系统读不了推荐系统的输出       |
| **问题识别结构化**           | 🟡   | "蛋白不足"只在后端推理，无显式数据结构   |
| **替代建议系统化**           | 🟡   | 无与推荐引擎联动的替代方案生成机制       |

---

## 二、Step 2 — 饮食分析系统设计（Analyze Layer）

### 2.1 单次饮食分析能力（已有，增强）

**输入**:

- 用户 ID + 目标
- 食物/餐 识别结果（name, confidence, nutrition）

**输出**:

```typescript
interface FoodAnalysisPackage {
  // Base nutrition
  totalCalories: number;
  macros: { protein: number; fat: number; carbs: number };

  // V3.2: 分析准确度层级
  accuracyLevel: 'high' | 'medium' | 'low'; // 基于 confidence + reviewLevel
  accuracyScore: number; // 0-100 百分比
  accuracyFactors: { confidence: number; reviewLevel: string }; // 明细

  // Nutrition fact sheet
  nutritionBreakdown: NutritionScoreBreakdown; // 7 维度
}
```

**实现** (V3.2 新增):

- `AnalysisAccuracyService.assessAccuracy(confidence, reviewLevel)`: 量化准确度
- 准确度影响后续决策权重

### 2.2 上下文分析（已有，增强）

**当前能力**: `MacroSlotStatus` 四维 + `MacroProgress` 消耗记录

**V3.2 增强**:

```typescript
interface ContextualAnalysis {
  // 当前进度
  macroSlotStatus: MacroSlotStatus; // deficit/ok/excess
  macroProgress: MacroProgress; // consumed/remaining/ratio

  // V3.2: 问题识别结构化 ⭐
  identifiedIssues: NutritionIssue[]; // [{type:'protein_deficit', severity: 'high'}, ...]

  // V3.2: 替代建议条件 ⭐
  recommendationContext: {
    remainingCalories: number;
    targetMacros: { protein; fat; carbs }; // 剩余目标
    excludeFoods: string[]; // 已吃过的
    preferredScenarios: string[]; // 用户偏好场景
  };
}
```

**实现** (V3.2 新增):

- `AnalysisContextService.buildContextualAnalysis()`: 组装上下文
- `NutritionIssueDetector.identifyIssues()`: 结构化问题识别（蛋白不足、脂肪过高等）

### 2.3 问题识别（新增）⭐

```typescript
type IssueType =
  | 'protein_deficit'
  | 'fat_excess'
  | 'carb_excess'
  | 'fiber_deficit'
  | 'sodium_excess'
  | 'calorie_excess';

interface NutritionIssue {
  type: IssueType;
  severity: 'low' | 'medium' | 'high';
  metric: number; // 偏差值（g 或 %）
  threshold: number; // 阈值
  implication: string; // 中文说明
}
```

**实现** (V3.2 新增):

- `NutritionIssueDetector` (单独服务): 基于 `MacroSlotStatus` 生成结构化问题列表
- 问题按 severity 排序，驱动后续决策和建议

---

## 三、Step 3 — 决策系统设计（Should Eat?）

### 3.1 是否建议吃（决策三档：RECOMMEND / CAUTION / AVOID）

**V3.1 基础** ✅: `FoodDecisionService` 已支持  
**V3.2 增强**: 精细化"让用户选择"而非绝对禁止

```typescript
interface StructuredDecision {
  verdict: 'recommend' | 'caution' | 'avoid';

  // V3.2: 决策因素明细化 ⭐
  factors: {
    nutritionAlignment: { score: number; rationale: string }; // 与目标匹配度
    macroBalance: { score: number; rationale: string }; // 宏量平衡
    healthConstraint: { score: number; rationale: string }; // 健康限制
    timeliness: { score: number; rationale: string }; // 吃的时机合理性
  };

  // 权重融合
  finalScore: number; // 0-100，综合因素的加权
}
```

### 3.2 原因解释（必须）

v3.1 已有 `CoachOutputSchema.mainReason`，v3.2 增强为：

```typescript
interface DetailedRationale {
  baseline: string; // 基础原因（基于 nutrition score）
  contextual: string; // 上下文原因（基于当日摄入）
  goalAlignment: string; // 目标对齐原因
  healthRisk: string | null; // 健康风险（若有）
  timelinessNote: string | null; // 时机建议
}
```

**实现** (V3.2 新增):

- `DecisionRationaleService.buildDetailedRationale()`: 生成多维度原因

### 3.3 替代方案（关键）⭐

**V3.2 新增**：与推荐系统联动，无硬编码推荐

```typescript
interface RecommendationAlternative {
  type: 'substitute' | 'adjust_portion' | 'combine_with';
  suggestion: string; // 建议文本（中文）
  referenceFood?: {
    // 推荐系统中的食物
    foodId: string;
    name: string;
    reason: string; // 为什么推荐这个
  };
  expectedNutrition: {
    // 替代方案的预期营养
    calories: number;
    macros: { protein; fat; carbs };
  };
}
```

**实现** (V3.2 新增):

- `DecisionAlternativeService.generateAlternatives(identifiedIssues, recommendationContext)`:
  1. 调用推荐系统 `recommendationEngine.generateConstraints()` 获得当前推荐条件
  2. 基于所需补充/减少，调用 `recommendationEngine.recommendMealFromPool()`
  3. 包装为 RecommendationAlternative 返回
  - 无硬编码，完全依赖推荐系统的 constraint/filter/score 逻辑

### 3.4 动态决策（关键）

同一食物在不同时刻结论不同 → 由于 `MacroSlotStatus` + `remainingCalories` 变化

**V3.2 设计**: 决策已考虑 context，无需特殊处理

---

## 四、Step 4 — AI教练系统核心能力设计

### 4.1 对话式引导（不只结果，要解释）

v3.1 已支持单轮输出，v3.2 增强对话场景：

```typescript
interface CoachSession {
  sessionId: string;
  turns: CoachMessage[]; // 多轮对话
}

interface CoachMessage {
  role: 'coach' | 'user';
  content: {
    query?: string; // 用户问题
    coaching: CoachOutput; // 教练回复
    depth: PromptDepthLevel; // v3.1: 输出深度
  };
}

interface CoachOutput {
  // v3.1 CoachOutputSchema
  verdict: 'recommend' | 'caution' | 'avoid';
  mainReason: string;
  actionSteps: string[];
  cautionNote?: string;
  confidenceNote?: string;

  // v3.2: 对话式补充
  followUpPrompt?: string; // 邀请用户追问
  educationalNote?: string; // 营养教育小贴士
}
```

### 4.2 建议结构化（输出标准化）

v3.1 `CoachOutputSchema` 已覆盖，v3.2 增强为更细粒度的模板：

```typescript
interface StructuredSuggestion {
  // 核心 3 段
  conclusion: {
    verdict: 'recommend' | 'caution' | 'avoid';
    confidence: number; // 0-100
  };

  reasoning: {
    primary: string; // 第一理由
    secondary?: string; // 第二理由
    risks?: string[]; // 风险列表
  };

  actionable: {
    ifRecommend: string[]; // 推荐吃时怎么做
    ifModify: string[]; // 修改食物时怎么做
    ifAvoid: string[]; // 避免吃时建议
  };
}
```

### 4.3 个性化语气（语气适配）

v3.0 `ToneResolverService` 已支持（strict/friendly/data)，v3.2 扩展到微调：

```typescript
interface ToneProfile {
  baseStyle: 'strict' | 'friendly' | 'data'; // v3.0

  // v3.2 微调
  firmness: 'gentle' | 'balanced' | 'firm'; // 劝阻强度
  educationLevel: 'beginner' | 'intermediate' | 'expert'; // 教育深度
  urgency: 'casual' | 'normal' | 'urgent'; // 紧迫感
}
```

**实现** (v3.2 新增):

- `ToneMicroAdjustService.adjustTone(baseStyle, context)`: 基于用户属性和食物重要性微调

---

## 五、Step 5 — 决策链路设计（重点）⭐

### 5.1 "吃之前"决策链（User Intent → Decision）

```
用户问 "我想吃一碗米饭"
    ↓
[1] ANALYZE: 识别 + 营养计算 + 准确度评估
    → FoodAnalysisPackage { calories, macros, accuracyLevel }
    ↓
[2] BUILD CONTEXT: 当日摄入 + 用户画像 + 推荐条件
    → ContextualAnalysis { macroSlotStatus, identifiedIssues, recommendationContext }
    ↓
[3] IDENTIFY ISSUES: 结构化问题（蛋白不足? 脂肪过高?）
    → NutritionIssue[] { type, severity, implication }
    ↓
[4] SCORE + DECIDE: 综合评分 + 三档决策 + 因素明细
    → StructuredDecision { verdict, factors, finalScore }
    ↓
[5] GENERATE ALTERNATIVES: 如决策不是 "recommend"，生成替代
    → RecommendationAlternative[] { substitute, adjust_portion, combine_with }
    (调用推荐系统)
    ↓
[6] EXPLAIN + COACH: 包装决策为教练输出 + 个性化语气
    → CoachOutput { verdict, mainReason, actionSteps, followUpPrompt }
    ↓
返回给用户
```

### 5.2 "吃之后"恢复链（Meal Recorded → Recovery Guidance）

v3.1 `PostMealRecoveryService` 已有基础，v3.2 完整化：

```
用户记录吃了 "一碗米饭"
    ↓
[1] UPDATE CONTEXT: 更新 MacroSlotStatus + MacroProgress
    ↓
[2] SIGNAL TRACE: 识别吃后新的 dominantSignal
    → SignalTraceItem[] { signal, source, severity }
    ↓
[3] RECOVERY GUIDANCE: 基于新 signal 生成吃后建议
    → PostMealRecoveryGuidance {
        nextMealDirection: string;  // 下一餐怎么吃
        todayAdjustment: string;    // 今日如何调整
        alternativeAttempt?: string; // 若还想吃，怎么吃
      }
    ↓
[4] COACH OUTPUT: 包装为教练输出
    → CoachOutput { verdict: 'caution' | 'recommend', ... }
    ↓
返回给用户
```

### 5.3 完整生命周期（Pre-Meal → Post-Meal → Recovery）

```
T0: 用户问 "想吃 X" → [吃之前链路] → 决策 + 建议
T1: 用户吃了 X → 记录完成
T2: T1 + ΔT: 生成吃后恢复指导 → [吃之后链路] → 恢复建议
T3+: 继续用餐...
```

---

## 六、Step 6 — API能力设计（能力级，不写接口细节）

| API 能力                      | 源               | 新增? | 说明                             |
| ----------------------------- | ---------------- | ----- | -------------------------------- |
| **分析能力**                  |                  |       |
| FoodAnalysis (text/image)     | 既有 decode 步骤 | 否    | 复用现有                         |
| AnalysisAccuracy (量化准确度) | 新               | ✅    | V3.2 新增                        |
| **评分能力**                  |                  |       |
| NutritionScore (7 维度)       | 既有             | 否    | 复用现有                         |
| FoodScore (综合)              | 既有             | 否    | 复用现有                         |
| **决策能力**                  |                  |       |
| FoodDecision (三档)           | 既有             | 否    | 复用现有 + 增强因素明细          |
| NutritionIssueDetection       | 新               | ✅    | V3.2 新增                        |
| DecisionRationale (多维原因)  | 既有 enhance     | ⚠️    | V3.2 强化                        |
| **替代方案**                  |                  |       |
| GenerateAlternatives          | 新               | ✅    | V3.2 新增，需融合推荐系统        |
| **教练能力**                  |                  |       |
| CoachGenerate (Prompt)        | 既有             | 否    | 复用现有                         |
| ToneMicroAdjust               | 新               | ✅    | V3.2 新增                        |
| **吃后恢复**                  |                  |       |
| PostMealRecovery              | 既有             | 否    | 复用现有 + V3.1 signalTrace 改进 |

---

## 七、Step 7 — 数据结构设计（允许范围内）

### 7.1 现有数据表（无修改）

- `food_records` - 食物日志
- `daily_summaries` - 每日统计
- 推荐系统、用户画像 - 仅读

### 7.2 允许增强范围（应用层数据结构，无 DB 新增）

```typescript
// V3.2 应用层数据结构（内存/中间表示，无 DB 字段新增）

interface FoodAnalysisPackage {
  /* 见 2.1 */
}
interface ContextualAnalysis {
  /* 见 2.2 */
}
interface NutritionIssue {
  /* 见 2.3 */
}
interface StructuredDecision {
  /* 见 3.1 */
}
interface DetailedRationale {
  /* 见 3.2 */
}
interface RecommendationAlternative {
  /* 见 3.3 */
}
interface ToneProfile {
  /* 见 4.3 */
}
interface StructuredSuggestion {
  /* 见 4.2 */
}
interface PostMealRecoveryGuidance {
  /* 见 5.2 */
}
```

### 7.3 i18n 扩展（V3.2 新增标签）

新增 zh-CN / en-US / ja-JP 标签：

```
accuracyLevelLabel / accuracyScoreLabel / issueTypeLabel /
severityLabel / faclabelsctorsLabel / alternativeTypeLabel /
toneProfileLabel / recoveryguidanceLabel / ... (8-12个未定)
```

---

## 八、Step 8 — 分阶段迭代（Phase 1-3）

### 8.1 Phase 1 — 分析与问题识别（基础层）

目标: 完成"ANALYZE → CONTEXT → IDENTIFY ISSUES"三层

**新增服务**:

- `AnalysisAccuracyService` - 量化准确度
- `AnalysisContextService` - 组装上下文
- `NutritionIssueDetector` - 结构化问题识别

**新增类型**:

- `FoodAnalysisPackage`
- `ContextualAnalysis`
- `NutritionIssue`

**测试覆盖**:

- 分析准确度计算 (high/medium/low logic)
- 问题识别 (protein_deficit/fat_excess 等)
- 上下文组装 (remainingCalories, targetMacros)

**交付**:

- `decision/analyze/analysis-accuracy.service.ts`
- `decision/analyze/analysis-context.service.ts`
- `decision/analyze/nutrition-issue-detector.service.ts`
- 类型扩展: `analysis-result.types.ts`
- Unit tests: `test/v3.2-phase1.spec.ts`

---

### 8.2 Phase 2 — 决策、替代与解释（决策层）

目标: 完成"SCORE → DECIDE → ALTERNATIVES → RATIONALE"四层

**新增服务**:

- `DecisionRationaleService` - 多维原因生成
- `DecisionAlternativeService` - 替代建议（融合推荐系统）

**增强服务**:

- `DecisionEngineService` - 输出 `StructuredDecision` 而非简单 verdict
- `FoodScoringService` - 输出 decision factors

**集成测试**:

- Decide → Alternatives 流程
- 推荐系统 API 调用（模拟）
- 替代建议排序和去重

**交付**:

- `decision/decision/decision-rationale.service.ts`
- `decision/decision/decision-alternative.service.ts`
- 类型扩展: `StructuredDecision`, `DetailedRationale`, `RecommendationAlternative`
- 增强 `decision-engine.service.ts`
- Integration tests: `test/v3.2-phase2.spec.ts`

---

### 8.3 Phase 3 — 教练链路与完整 E2E（教练层）

目标: 完成"BUILD COACH OUTPUT → E2E CHAIN"，全链路可用

**新增服务**:

- `ToneMicroAdjustService` - 语气微调
- `CoachChainService` - 编排吃之前/吃之后链路

**增强服务**:

- `CoachPromptBuilderService` - 融合 `structuredOutput` + 多维理由
- `PostMealRecoveryService` - 输出完整 `PostMealRecoveryGuidance`

**E2E 场景测试**:

1. 吃之前："想吃米饭" → 完整决策 + 替代方案 → 教练输出
2. 吃之后："吃了米饭" → 新 signals → 吃后建议 → 教练输出
3. 多轮对话（user 追问、coach 解释）

**交付**:

- `decision/decision/tone-micro-adjust.service.ts`
- `decision/decision/coach-chain.service.ts`
- 增强 `coach-prompt-builder.service.ts`
- 增强 `post-meal-recovery.service.ts`
- i18n 8-12 个新标签 × 3 locale
- E2E tests: `test/v3.2-phase3.spec.ts`

**Release 清单**:

- 旧 API 向后兼容 (v/2 endpoints 可用)
- 新 v/3 endpoints 功能完整并文档化
- 前端可消费 decision + alternatives + coach output 各部分

---

## 九、架构原理

### 9.1 解耦分离图

```
Input (Food + User)
         ↓
    [ANALYZE]
  /    |    \
Accuracy Context Issues (V3.2 Phase 1)
         ↓
    [SCORE]
    /   |   \
  Nutrition Health Behavioral
         ↓
    [DECIDE]
  /    |  \   \
Verdict Factors Rationale Alternatives (V3.2 Phase 2)
         ↓
    [COACH]
 /     |     \
Verdict Steps Tone → Output (V3.2 Phase 3)
```

### 9.2 设计原则

1. **无侵入性**: 不修改推荐系统、用户画像、数据库
2. **只读集成**: 决策系统只读推荐/用户画像的数据
3. **渐进强化**: 每个 Phase 独立部署，不依赖后续 Phase
4. **测试驱动**: 每 Phase 配套单元 + 集成测试
5. **国际化就绪**: 每个新能力配套 i18n labels

### 9.3 与现有系统关系

| 系统     | V3.1                | V3.2 新增接口                                       | 权限 |
| -------- | ------------------- | --------------------------------------------------- | ---- |
| 推荐系统 | 无关                | `recommendationEngine.recommendMealFromPool()` 调用 | 只读 |
| 用户画像 | 融合已有            | 补充 `ToneProfile` 微调参数                         | 只读 |
| Coach    | `CoachOutputSchema` | 多轮对话 + 教育文本                                 | 增强 |
| Decision | v3.1 完整基础       | 因素明细 + 结构化理由                               | 增强 |

---

## 十、后续优化方向（Phase 4+）

- **偏好学习**: 用户反馈决策→学习模型，动态调整建议权重
- **多餐协同**: 考虑餐次间的宏量流转（早餐蛋白不足→午餐自动加码）
- **社交对标**: "vs 你的朋友 / 你的历史" 对标分析
- **AI 持续对话**: 从单轮 → 真正的多轮对话教练
- **食物替代库**: 更智能的"这个能换那个吗"逻辑

---
