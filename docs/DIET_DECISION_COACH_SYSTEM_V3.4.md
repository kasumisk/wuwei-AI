# 饮食决策 + AI教练系统 V3.4 设计文档

> 版本：V3.4 | 基于 V3.3 升级 | 生成日期：2026-04-17

---

## 一、版本定位

V3.4 聚焦「分析准确度 + 决策质量」两大核心问题：

1. **图片/文本分析不够准确** — Vision AI 和 LLM 缺乏用户实时营养状态和健康条件上下文
2. **决策不够个性化** — 健康条件（糖尿病/高血压/心脏病）未纳入评分和问题识别
3. **教练上下文弱** — CoachInsightService 已建立但未接入 Prompt 构建器

### 禁止范围（继承 V3.3）

- 推荐系统：只读，不改
- 用户画像系统：只读，不改
- 订阅/商业化逻辑：不动
- 不增加数据库字段
- 不增加新模块

### 关于服务迁移

**结论：image-food-analysis.service.ts / text-food-analysis.service.ts 不迁移**

原因：`decision.module.ts` 已通过 `forwardRef(() => FoodModule)` 引入 FoodModule。
若将这两个服务迁入 decision 模块，会导致 FoodModule ↔ DecisionModule 双向强依赖，
编译将报循环依赖错误。当前架构中 food 模块负责 Step 1（食物解析），
decision 模块负责 Step 2-8（管道），职责边界清晰，保持不变。

---

## 二、当前能力差距分析

| 层级       | 当前能力                 | 差距                                                                                              |
| ---------- | ------------------------ | ------------------------------------------------------------------------------------------------- |
| **分析层** | 图片/文本识别 + 营养估算 | Vision AI 使用 `detail: 'low'` + `max_tokens: 1000`，可能截断多食物场景；健康条件未注入 AI prompt |
| **分析层** | 用户上下文注入           | `formatAsPromptString()` 输出剩余宏量但遗漏 `healthConditions`                                    |
| **分析层** | 文本 LLM 补位            | `TEXT_ANALYSIS_PROMPT` 完全通用，不知道用户目标和健康条件，返回结果无法决策导向                   |
| **准确度** | AnalysisAccuracyService  | 仅用 confidence + reviewLevel + completeness 三信号，未用食物数量/营养完整率                      |
| **评分层** | 7维评分                  | 维度权重静态，不因健康条件调整（糖尿病应加重升糖影响权重）                                        |
| **决策层** | NutritionIssueDetector   | 只检测宏量缺/超，不检测健康条件特异性问题（高钠风险、高升糖风险）                                 |
| **教练层** | CoachPromptBuilder       | CoachInsightService 已实现但未接入 formatAnalysisContext()                                        |

---

## 三、V3.4 优化目标（8个）

### Phase 1：分析准确度增强

#### P1.1 — formatAsPromptString() 健康条件注入

**文件：** `decision/decision/user-context-builder.service.ts`

当前问题：格式化 prompt 包含 `dietaryRestrictions` 但遗漏 `healthConditions`。
对 AI 而言，糖尿病用户和正常用户得到完全相同的分析指令。

改进：为每种健康条件注入专用指令：

- `diabetes` → 优先控制碳水、关注升糖指数、标记高糖食物
- `hypertension` → 关注钠含量、标记高钠食物、限制腌制食品
- `heart_disease` → 关注饱和脂肪、标记高脂肪食物

#### P1.2 — 图片分析 AI 调用质量提升

**文件：** `food/app/services/image-food-analysis.service.ts`

改进点：

1. `detail: 'low'` → `'auto'`（让 OpenRouter 根据图片尺寸自动选择，提升多菜品识别率）
2. `max_tokens: 1000` → `1500`（防止多食物 JSON 被截断）
3. 新增 `buildDecisionContextBlock()` — 基于 `nutritionPriority` + `healthConditions` 生成决策优先级块，直接告知 AI 本餐最重要的判断维度

#### P1.3 — 文本分析 LLM 用户上下文注入

**文件：** `food/app/services/text-food-analysis.service.ts`

当前：`TEXT_ANALYSIS_PROMPT` 完全静态，LLM 不知道用户目标。
改进：注入 `UserContextBuilderService`，在 `llmParseFoods()` 中构建动态 system prompt，
包含目标类型、营养优先级、健康条件 → LLM 返回决策导向的营养估算（如减脂用户更关注热量精准度）

#### P1.4 — AnalysisAccuracyService 多信号增强

**文件：** `decision/analyze/analysis-accuracy.service.ts`

新增 `assessFromFoods()` 方法，信号扩展：

- `nutrientCompletenessRate` — 食物中 fiber/sodium 等扩展字段填充率（反映营养数据细致程度）
- `foodCountPenalty` — 食物种数越多识别难度越高，适当降低 high 门槛
- `categoryDiversityBonus` — 不同品类组合时整体置信度更有保障

### Phase 2：评分与决策质量增强

#### P2.1 — NutritionIssueDetector 健康条件特异性检测

**文件：** `decision/analyze/nutrition-issue-detector.service.ts`

扩展 `detectIssues()` 接受可选 `healthConditions: string[]`，新增规则：

- `diabetes` + carbs_excess → `issue: 'glycemic_risk'`（升糖风险）
- `hypertension` + sodium 可推断高（通过 food 类别判断）→ `issue: 'sodium_risk'`
- `heart_disease` + fat_excess → `issue: 'cardiovascular_risk'`

#### P2.2 — AnalysisContextService 健康条件传递

**文件：** `decision/analyze/analysis-context.service.ts`

`buildContextualAnalysis()` 新增 `healthConditions` 参数，透传至 `NutritionIssueDetector`。
管道层同步更新调用。

### Phase 3：教练增强

#### P3.1 — CoachPromptBuilder 接入 CoachInsightService

**文件：** `coach/app/prompt/coach-prompt-builder.service.ts`

注入 `CoachInsightService`（来自 `decision/coach/`），在 `formatAnalysisContext()` 末尾
调用 `CoachInsightService.generate()` 并追加 CoachInsightPack 到 prompt 片段：

- `priorityInsight` — 最优先改善点
- `trendInsight` — 近期营养趋势
- `goalInsight` — 目标达成状态
- `timingInsight` — 当前时段建议

#### P3.2 — 编译验证

运行 `npx tsc --noEmit --project apps/api-server/tsconfig.json`，确保零错误。

---

## 四、完整决策链路 V3.4

```
用户输入（图片/文本）
  ↓
[Step 1] 食物解析（food 模块）
  ├─ 图片: Vision AI
  │    ├─ BASE_PROMPT
  │    ├─ GOAL_FOCUS_BLOCK（目标差异化）
  │    ├─ formatAsPromptString()（剩余宏量 + 健康条件 ← NEW P1.1）
  │    ├─ buildDecisionContextBlock()（决策优先级 ← NEW P1.2）
  │    ├─ detail: 'auto' ← P1.2
  │    └─ max_tokens: 1500 ← P1.2
  └─ 文本: 库匹配 + LLM补位
       └─ 动态 system prompt（用户目标 + 健康条件 ← NEW P1.3）
  ↓
[Steps 2-8] 分析管道（decision 模块）
  ├─ Step 2: NutritionAggregator
  ├─ Step 3: UserContextBuilderService → UnifiedUserContext
  ├─ Step 4: FoodScoringService → AnalysisScore（7维）
  │   4.1: AnalysisContextService
  │         → buildContextualAnalysis(ctx, healthConditions) ← P2.2
  │         → NutritionIssueDetector.detectIssues(slot, progress, healthConditions) ← P2.1
  │   4.5: AnalysisStateBuilderService
  ├─ Step 5: FoodDecisionService → DecisionOutput
  │   5.45: DecisionEngineService → StructuredDecision
  │   5.5:  DecisionSummaryService → DecisionSummary
  │   5.6:  ConfidenceDiagnosticsService → ConfidenceDiagnostics
  │   5.7:  EvidencePack + ShouldEatAction
  │   5.8:  AnalysisAccuracyService.assessFromFoods() ← P1.4
  ├─ Step 6: ResultAssemblerService → FoodAnalysisResultV61
  ├─ Step 7: AnalysisPersistenceService（async）
  └─ Step 8: EventEmitter2 → food.analysis.completed
                                    ↓
                        CoachService（缓存 5min TTL）
                              ↓
                   CoachPromptBuilderService
                   formatAnalysisContext() + CoachInsightService ← P3.1
```

---

## 五、分阶段迭代

### Phase 1（分析准确度）

- P1.1: `formatAsPromptString()` + 健康条件
- P1.2: 图片分析 AI 调用参数 + Decision Context Block
- P1.3: 文本分析动态 LLM Prompt
- P1.4: `AnalysisAccuracyService.assessFromFoods()`

### Phase 2（评分 & 决策）

- P2.1: `NutritionIssueDetector` + 健康条件特异性规则
- P2.2: `AnalysisContextService` 传递 `healthConditions`

### Phase 3（教练增强）

- P3.1: `CoachPromptBuilderService` 接入 `CoachInsightService`
- P3.2: 编译验证

---

## 六、不变范围

以下服务 V3.4 不修改（已在 V3.3 完成）：

- `DecisionEngineService` — StructuredDecision 四维因素
- `DecisionSummaryService` — TopIssues/ActionItems 增强
- `AlternativeSuggestionService` — 推荐引擎三层 fallback（tier 1 已是推荐引擎）
- `CoachInsightService` — 已建立，P3.1 接入
- `coach-i18n.ts` / `decision-coach.service.ts` — V3.3 已完成

---

_文档结束_
