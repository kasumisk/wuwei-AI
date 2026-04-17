# 饮食决策 + AI教练系统 V3.3 设计文档

**版本**: V3.3  
**基线**: V3.2（分析准确度、问题识别、上下文分析、替代建议框架、教练解释）  
**设计日期**: 2026-04-17  
**核心目标**: 解耦分析→评分→决策→教练四层为独立子模块，增强单次分析+评分融合用户画像+决策可解释性+AI教练国际化  
**状态**: 实施中

---

## 一、V3.2 → V3.3 变更总览

### 1.1 架构变更（解耦）

V3.2 现状问题：

- `decision/` 目录混合了决策、分析辅助、教练逻辑
- `score/` 和 `scoring/` 两套评分并存，边界模糊
- `DecisionCoachService` 放在 `analyze/` 目录下，职责归属不清
- 分析、评分、决策三层无清晰模块边界

V3.3 目标目录结构（参考推荐系统的分层模式）：

```
decision/
├── analyze/                    # 分析层（不变，已良好）
│   ├── analysis-pipeline.service.ts
│   ├── analysis-context.service.ts
│   ├── analysis-accuracy.service.ts
│   ├── analysis-state-builder.service.ts
│   ├── confidence-diagnostics.service.ts
│   ├── evidence-pack-builder.service.ts
│   ├── nutrition-aggregator.ts
│   ├── nutrition-issue-detector.service.ts
│   ├── result-assembler.service.ts
│   └── analysis-persistence.service.ts
├── score/                      # 评分层（整合，单一入口）
│   ├── food-scoring.service.ts          # 主评分门面（已有）
│   ├── confidence-weighting.ts          # 置信度加权（已有）
│   ├── scoring.service.ts               # V2.4评分（从 scoring/ 移入）
│   └── scoring.types.ts                 # V2.4类型（从 scoring/ 移入）
├── decision/                   # 决策层（纯决策逻辑）
│   ├── food-decision.service.ts
│   ├── decision-engine.service.ts
│   ├── decision-explainer.service.ts
│   ├── decision-summary.service.ts
│   ├── decision-classifier.service.ts
│   ├── decision-checks.ts
│   ├── contextual-modifier.service.ts
│   ├── daily-macro-summary.service.ts
│   ├── issue-detector.service.ts
│   ├── portion-advisor.service.ts
│   ├── user-context-builder.service.ts
│   ├── should-eat-action.service.ts
│   ├── post-meal-recovery.service.ts
│   ├── decision-tone-resolver.service.ts
│   └── alternative-suggestion.service.ts
├── coach/                      # 教练层（从 analyze/ 迁移 + 增强）⭐ V3.3 新增目录
│   ├── decision-coach.service.ts        # 从 analyze/ 迁移，增强 i18n
│   ├── coach-insight.service.ts         # 新增：个性化洞察生成
│   └── coach-i18n.ts                    # 新增：教练层 i18n 标签
├── config/                     # 配置（不变）
│   ├── decision-thresholds.ts
│   ├── scoring-dimensions.ts
│   ├── alternative-food-rules.ts
│   ├── dynamic-signal-weight.service.ts
│   ├── dynamic-thresholds.service.ts
│   └── signal-priority.config.ts
├── feedback/                   # 反馈（不变）
│   ├── quality-feedback.service.ts
│   └── feedback.types.ts
├── i18n/                       # i18n（增强）
│   └── decision-labels.ts
├── types/                      # 类型（增强）
│   └── analysis-result.types.ts
└── decision.module.ts          # 模块注册（更新导入路径）
```

### 1.2 能力增强总览

| 层     | 变更                                                      | Phase |
| ------ | --------------------------------------------------------- | ----- |
| 分析层 | 单次分析输出 `FoodAnalysisPackage` 结构化                 | P1    |
| 评分层 | 合并 `scoring/` 到 `score/`，评分结合用户画像增强         | P1    |
| 决策层 | 决策因素明细化 `StructuredDecision`，上下文分析融入主管道 | P1+P2 |
| 决策层 | 替代建议增强（融合推荐引擎 + 上下文）                     | P2    |
| 教练层 | `DecisionCoachService` i18n + 个性化洞察                  | P3    |
| 教练层 | Coach 系统 prompt 融合决策结构化输出                      | P3    |
| i18n   | `DecisionCoachService` 三语支持 + coach-i18n.ts           | P3    |

---

## 二、Phase 1 — 分析增强 + 评分融合 + 决策结构化

### 2.1 目标

1. 评分目录整合：`scoring/` 文件移入 `score/`，删除空目录
2. 分析管道输出 `FoodAnalysisPackage`（结构化单次分析结果）
3. 评分融合用户画像：`FoodScoringService.calculateScore()` 增强，输出 `StructuredDecision.factors`
4. 决策结构化：`DecisionEngineService` 输出 `StructuredDecision`（含因素明细）
5. 上下文分析集成到主管道

### 2.2 新增/增强类型

```typescript
// types/analysis-result.types.ts 新增

/** V3.3: 结构化单次分析包 */
interface FoodAnalysisPackage {
  totalCalories: number;
  macros: { protein: number; fat: number; carbs: number };
  accuracyLevel: 'high' | 'medium' | 'low';
  accuracyScore: number;
  accuracyFactors: { confidence: number; reviewLevel: string };
  nutritionBreakdown: NutritionScoreBreakdown;
  identifiedIssues: NutritionIssue[];
}

/** V3.3: 决策因素明细 */
interface DecisionFactorDetail {
  score: number; // 0-100
  rationale: string; // i18n 友好
}

/** V3.3: 结构化决策 */
interface StructuredDecision {
  verdict: 'recommend' | 'caution' | 'avoid';
  factors: {
    nutritionAlignment: DecisionFactorDetail;
    macroBalance: DecisionFactorDetail;
    healthConstraint: DecisionFactorDetail;
    timeliness: DecisionFactorDetail;
  };
  finalScore: number;
  rationale: DetailedRationale;
}

/** V3.3: 多维原因 */
interface DetailedRationale {
  baseline: string;
  contextual: string;
  goalAlignment: string;
  healthRisk: string | null;
  timelinessNote: string | null;
}
```

### 2.3 实施清单

1. **移动** `scoring/scoring.service.ts` → `score/scoring.service.ts`
2. **移动** `scoring/scoring.types.ts` → `score/scoring.types.ts`
3. **删除** 空 `scoring/` 目录
4. **更新** `decision.module.ts` 导入路径
5. **增强** `analysis-pipeline.service.ts`：在管道中组装 `FoodAnalysisPackage`
6. **增强** `decision-engine.service.ts`：输出 `StructuredDecision`
7. **增强** `result-assembler.service.ts`：将 `FoodAnalysisPackage` 和 `StructuredDecision` 纳入最终结果
8. **增强** `types/analysis-result.types.ts`：新增类型定义

---

## 三、Phase 2 — 上下文分析 + 替代建议 + 架构增强

### 3.1 目标

1. `AnalysisContextService` 完全集成到主管道（当天摄入 + 用户画像 → `ContextualAnalysis`）
2. `NutritionIssueDetector` 输出驱动替代建议
3. `AlternativeSuggestionService` 增强：基于 `identifiedIssues` + `recommendationContext` 生成结构化替代
4. `DecisionSummaryService` 消费 `StructuredDecision` 和 `DetailedRationale`

### 3.2 新增/增强类型

```typescript
// V3.3 增强
interface ContextualAnalysis {
  macroSlotStatus: MacroSlotStatus;
  macroProgress: MacroProgress;
  identifiedIssues: NutritionIssue[];
  recommendationContext: {
    remainingCalories: number;
    targetMacros: { protein: number; fat: number; carbs: number };
    excludeFoods: string[];
    preferredScenarios: string[];
  };
}

interface RecommendationAlternative {
  type: 'substitute' | 'adjust_portion' | 'combine_with';
  suggestion: string;
  referenceFood?: {
    foodId: string;
    name: string;
    reason: string;
  };
  expectedNutrition: {
    calories: number;
    macros: { protein: number; fat: number; carbs: number };
  };
}
```

### 3.3 实施清单

1. **增强** `analysis-pipeline.service.ts`：调用 `AnalysisContextService` 生成 `ContextualAnalysis`
2. **增强** `alternative-suggestion.service.ts`：接收 `identifiedIssues` + `recommendationContext`
3. **增强** `decision-summary.service.ts`：消费 `StructuredDecision`
4. **增强** `evidence-pack-builder.service.ts`：纳入 contextual evidence

---

## 四、Phase 3 — 教练增强 + 个性化 + 国际化

### 4.1 目标

1. **迁移** `DecisionCoachService` 从 `analyze/` 到 `coach/` 子目录
2. **i18n 补全**: `DecisionCoachService` 全部硬编码英文 → 三语（zh/en/ja）
3. **新增** `CoachInsightService`：基于 `StructuredDecision` + 用户画像生成个性化洞察
4. **增强** `CoachPromptBuilderService`：融合 `StructuredDecision` + `DetailedRationale`
5. **增强** `CoachFormatService`：补全 ja-JP 支持
6. **新增** `coach-i18n.ts`：教练层专用 i18n 标签

### 4.2 新增类型

```typescript
interface CoachInsight {
  personalizedTip: string; // 基于用户历史行为
  educationalNote: string; // 营养教育
  motivationalMessage: string; // 激励语
  followUpPrompt: string; // 邀请追问
}
```

### 4.3 实施清单

1. **创建** `decision/coach/` 目录
2. **迁移** `analyze/decision-coach.service.ts` → `coach/decision-coach.service.ts`（i18n 化）
3. **创建** `coach/coach-insight.service.ts`
4. **创建** `coach/coach-i18n.ts`（三语标签）
5. **更新** `decision.module.ts` 导入路径
6. **增强** `coach/app/prompt/coach-prompt-builder.service.ts`：融合新结构
7. **增强** `coach/app/formatting/coach-format.service.ts`：补 ja-JP
8. **增强** `coach/app/config/coach-tone.config.ts`：确认 ja-JP 完整

---

## 五、设计原则

1. **无侵入性**: 不修改推荐系统、用户画像、数据库 schema
2. **只读集成**: 决策系统只读推荐/用户画像的数据
3. **渐进强化**: 每个 Phase 独立部署，不依赖后续 Phase
4. **向后兼容**: 现有 API 输出格式增量扩展，不破坏前端
5. **国际化就绪**: 新增能力配套 zh/en/ja 三语标签
6. **替代方案必须走推荐引擎**: 不硬编码食物推荐

---

## 六、与现有系统关系

| 系统        | 权限 | V3.3 交互方式                                |
| ----------- | ---- | -------------------------------------------- |
| 推荐系统    | 只读 | `recommendationEngine.recommendByScenario()` |
| 用户画像    | 只读 | `UserProfileService` 读取画像数据            |
| Coach 模块  | 增强 | 融合 `StructuredDecision` 到 prompt          |
| 订阅/商业化 | 不动 | 无变更                                       |
