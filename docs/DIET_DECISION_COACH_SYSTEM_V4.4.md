# 饮食决策 + AI教练系统 V4.4 — 分析精准化 + 架构解耦 + 教练增强

> 版本: V4.4 | 日期: 2026-04-20
> 前置: V4.3（i18n 统一、遗留代码清理）

---

## 一、现有能力诊断

### 1.1 当前系统能力矩阵

| 能力层           | 已具备                                             | 缺失/不足                                                                                                                    |
| ---------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **食物分析**     | 文本/图片→营养数据、食物库匹配、LLM 补全           | ❌ LLM prompt 返回字段与食物库不对齐（无 standardServingG/quality/satiety/glycemicIndex）；份量估算基于硬编码 map 而非食物库 |
| **评分**         | 7+1维评分、目标权重、健康条件乘数                  | ⚠️ FoodScoringService 722行过于庞大；quality/satiety 来源不一致（图片=LLM估算，文本=缺失）                                   |
| **决策**         | 三档判定、上下文分析、问题识别、份量建议、动态阈值 | ❌ i18n 碎片化（3套系统）；decision-checks.ts 1008行 God config；替代方案 907行 3重 fallback 但静态规则写死食物              |
| **教练**         | 结构化输出、语气适配、行为洞察                     | ⚠️ 教练 tone 系统内联多语言未走 i18n；教练不引用推荐引擎的替代结果                                                           |
| **用户行为记录** | 食物记录→每日摘要→行为画像→短期缓存                | ✅ 完整                                                                                                                      |

### 1.2 核心问题清单

**P0 — 分析精准度问题**

1. **LLM prompt 与食物库字段不对齐**: 文本 prompt 不返回 `standardServingG`、`quality`、`satiety`、`glycemicIndex`，导致决策层这些字段缺失或需二次推断
2. **份量估算硬编码**: `CATEGORY_DEFAULT_SERVING` 和 `QUANTITY_GRAMS_MAP` 是写死的 map，应优先使用食物库的 `standardServingG` 和 `commonPortions`
3. **图片/文本两套 prompt 字段不一致**: 图片返回 quality/satiety/confidence，文本不返回

**P1 — i18n 碎片化** 4. **3套 i18n 系统**: `t()` 仍在 5 个文件中使用（decision-checks.ts 40处、contextual-modifier 7处、portion-advisor 5处、issue-detector 1处、food-scoring 多处）5. **tone 系统内联多语言**: `DecisionToneResolverService` 和 `coach-tone.config.ts` 有内联 zh/en/ja 文案未走 i18n 6. **hardcoded 中文**: EvidencePackBuilder、ConfidenceDiagnostics 有硬编码中文

**P2 — 架构解耦** 7. **AnalysisPipelineService 14 依赖 God Service**: 需拆分为阶段协调器 8. **类型文件 985 行**: 30+ 接口混在一个文件 9. **AlternativeSuggestionService 907行**: 静态规则写死食物名，应全部走推荐引擎 10. **DecisionSummaryService 834行**: 职责过多

**P3 — 教练增强** 11. **替代方案不走推荐引擎**: 静态 fallback 推荐硬编码食物 12. **教练缺乏推荐引擎参考**: CoachActionPlan.alternatives 是文本，不引用推荐结果

---

## 二、V4.4 设计方案

### 2.1 分析 prompt 对齐方案

#### 目标

LLM prompt 输出字段与食物库（FoodLibrary）完全对齐，决策系统直接消费标准化字段。

#### 新增 prompt 返回字段

| 字段               | 类型         | 说明           | 食物库来源                     |
| ------------------ | ------------ | -------------- | ------------------------------ |
| `standardServingG` | number       | 标准份量（克） | `FoodLibrary.standardServingG` |
| `quality`          | number(1-10) | 食物质量评分   | `FoodLibrary.qualityScore`     |
| `satiety`          | number(1-10) | 饱腹感评分     | `FoodLibrary.satietyScore`     |
| `glycemicIndex`    | number\|null | 血糖指数       | `FoodLibrary.glycemicIndex`    |
| `isProcessed`      | boolean      | 是否加工食品   | `FoodLibrary.isProcessed`      |

#### 改动逻辑

- 文本 prompt (`TEXT_ANALYSIS_PROMPT`): 增加 `standardServingG`、`quality`、`satiety`、`glycemicIndex`、`isProcessed` 字段
- 食物库命中时: 这些字段优先用食物库值覆盖 LLM 估算值（与 allergens 覆盖逻辑一致）
- `toAnalyzedFoodItem`: 传递新字段到 `AnalyzedFoodItem`
- `AnalyzedFoodItem` 类型: 新增 `quality?`、`satiety?`、`isProcessed?` 可选字段

#### 份量估算改进

- 食物库命中时，使用 `standardServingG` 替代 `CATEGORY_DEFAULT_SERVING`
- 食物库有 `commonPortions` 时，匹配用户量词（如"一碗"）到对应克数
- 仅在食物库未命中时 fallback 到 `CATEGORY_DEFAULT_SERVING`

### 2.2 i18n 统一方案

#### 迁移范围（V4.4 完成）

| 文件                                | 当前 t() 数 | 迁移策略               |
| ----------------------------------- | ----------- | ---------------------- |
| `contextual-modifier.service.ts`    | 7           | t() → cl()             |
| `portion-advisor.service.ts`        | 5           | t() → cl()             |
| `issue-detector.service.ts`         | 1           | t() → cl()             |
| `user-context-builder.service.ts`   | 3           | t() → cl() (goalLabel) |
| `food-scoring.service.ts`           | 多处        | t() → cl()             |
| `evidence-pack-builder.service.ts`  | 硬编码中文  | → cl()                 |
| `confidence-diagnostics.service.ts` | 硬编码中文  | → cl()                 |
| `decision-tone-resolver.service.ts` | 内联多语言  | → cl()                 |

#### 不迁移（延期 V4.5）

| 文件                 | t() 数 | 原因                                 |
| -------------------- | ------ | ------------------------------------ |
| `decision-checks.ts` | ~40    | 纯函数配置，改动风险高，需单独 phase |

### 2.3 架构解耦方案

#### 类型文件拆分

```
types/analysis-result.types.ts (985行)
→ types/context.types.ts       — UnifiedUserContext, MacroSlotStatus, SignalTraceItem
→ types/score.types.ts         — AnalysisScore, NutritionScoreBreakdown refs
→ types/decision.types.ts      — FoodDecision, StructuredDecision, DecisionFactorDetail, etc.
→ types/coach.types.ts         — CoachActionPlan, CoachOutputSchema, ExplanationNode
→ types/pipeline.types.ts      — AnalyzeStageResult, DecideStageResult, PostProcessStageResult
→ types/result.types.ts        — FoodAnalysisResultV61, AnalysisInputSnapshot, EntitlementInfo (barrel re-exports all)
→ types/index.ts               — barrel re-export all
```

#### 替代方案改进

- `AlternativeSuggestionService.generateStaticAlternatives`: 移除硬编码食物名，全部走推荐引擎
- 推荐引擎调用失败时，返回空替代而非写死食物
- 替代方案结果附带 `foodLibraryId`、`score`、`comparison`

### 2.4 教练增强方案

#### 教练引用推荐引擎

- `CoachActionPlan.alternatives` 从文本列表→ 引用 `FoodAlternative[]`（含 foodLibraryId）
- 教练输出中引用替代方案时，使用推荐引擎返回的食物名和原因

#### 冲突可解释性优化

- `StructuredDecision.rationale` 各维度增加量化数据（如 `healthRisk: "检测到过敏原: 花生(peanuts) — 用户已标注过敏"`）
- 决策链步骤增加 `snapshot` 数据（当前已有字段，填充更多有意义的数据）

---

## 三、分阶段实施计划

### Phase 1: 分析 Prompt 对齐 + AnalyzedFoodItem 扩展 + i18n 迁移（4-5 个文件）

**目标**: 6 个优化点

1. **TEXT_ANALYSIS_PROMPT 扩展** — 新增 `standardServingG`、`quality`、`satiety`、`glycemicIndex`、`isProcessed` 字段到 prompt
2. **AnalyzedFoodItem 类型扩展** — 新增 `quality?`、`satiety?`、`isProcessed?` 可选字段
3. **toAnalyzedFoodItem 传递新字段** — 食物库命中时覆盖 LLM 值
4. **份量估算改进** — 食物库 `standardServingG` 优先于 `CATEGORY_DEFAULT_SERVING`
5. **i18n: contextual-modifier.service.ts** — 7 处 t() → cl()
6. **i18n: portion-advisor.service.ts** — 5 处 t() → cl()
7. **i18n: issue-detector.service.ts** — 1 处 t() → cl()

**验证**: `npx tsc --noEmit --pretty` 0 errors

### Phase 2: 类型拆分 + 替代方案改进 + i18n 继续

**目标**: 6 个优化点

1. **types/ 拆分** — 985行→6个文件 + barrel index.ts
2. **所有 import 更新** — 全模块 import 路径更新（通过 barrel re-export 兼容）
3. **替代方案: 移除静态硬编码** — `generateStaticAlternatives` 改为走推荐引擎 fallback
4. **i18n: food-scoring.service.ts** — t() → cl()
5. **i18n: user-context-builder.service.ts** — 3 处 t() → cl()
6. **i18n: evidence-pack-builder + confidence-diagnostics** — 硬编码中文 → cl()

**验证**: `npx tsc --noEmit --pretty` 0 errors

### Phase 3: 教练增强 + 冲突可解释性 + tone i18n

**目标**: 6 个优化点

1. **教练引用推荐引擎替代方案** — CoachActionPlan.alternatives 改为引用 FoodAlternative[]
2. **冲突可解释性增强** — 过敏原/限制冲突的决策链增加详细 snapshot
3. **StructuredDecision.rationale 量化** — 各维度附加实际数据
4. **decision-tone-resolver.service.ts i18n** — 内联多语言 → cl()
5. **coach-tone.config.ts i18n** — PERSONA_PROMPTS 内联多语言 → ci()
6. **DecisionSummary 冲突解释优化** — healthConstraintNote 增加具体冲突细节

**验证**: `npx tsc --noEmit --pretty` 0 errors

---

## 四、禁止修改清单

- ❌ 推荐系统代码（只读调用）
- ❌ 用户画像系统代码（只读调用）
- ❌ 订阅/商业化逻辑
- ❌ 数据库 schema（不增加字段）
- ❌ 不增加新模块
- ❌ `i18n-messages.ts`（推荐系统 t() 源，只读）

---

## 五、决策链路设计（完整流程）

```
用户输入（"想吃红烧肉"或拍照）
  ↓
【Stage 0: 食物分析】(food module, 只读)
  → 文本/图片 → LLM prompt（V4.4: 对齐食物库字段）
  → 食物库匹配（standardServingG/quality/satiety 覆盖）
  → AnalyzedFoodItem[]（V4.4: 含 quality/satiety/isProcessed）
  ↓
【Stage 1: 分析 (Analyze)】
  → FoodScoringService: 7+1维评分
  → UserContextBuilderService: 统一用户上下文
  → AnalysisStateBuilder: 吃前/吃后投影
  → ContextualModifier: 上下文调整
  → 输出: AnalyzeStageResult
  ↓
【Stage 2: 决策 (Decide)】
  → DecisionEngineService: 评分→三档决策 + 动态阈值
  → IssueDetectorService: 问题识别
  → PortionAdvisorService: 份量建议
  → AlternativeSuggestionService: 替代方案（V4.4: 全部走推荐引擎）
  → DecisionExplainerService: 决策解释链
  → DecisionSummaryService: 结构化摘要
  → 输出: DecideStageResult
  ↓
【Stage 3: 教练 (Coach)】
  → DecisionCoachService: 结构化教练输出
  → CoachInsightService: 行为洞察
  → 输出: CoachActionPlan（V4.4: alternatives 引用推荐引擎结果）
  ↓
【Stage 4: 后处理 (PostProcess)】
  → ShouldEatAction + Recovery + EvidencePack + ConfidenceDiagnostics
  → ResultAssembler: 组装 FoodAnalysisResultV61
  ↓
最终输出 → 前端
```

---

## 六、文件改动清单

### Phase 1 改动文件

| 文件                                               | 改动类型 | 说明                                                     |
| -------------------------------------------------- | -------- | -------------------------------------------------------- |
| `food/app/services/text-food-analysis.service.ts`  | 修改     | prompt 扩展、toAnalyzedFoodItem 传递新字段、份量估算改进 |
| `decision/types/analysis-result.types.ts`          | 修改     | AnalyzedFoodItem 新增 quality/satiety/isProcessed        |
| `decision/decision/contextual-modifier.service.ts` | 修改     | 7处 t() → cl()                                           |
| `decision/decision/portion-advisor.service.ts`     | 修改     | 5处 t() → cl()                                           |
| `decision/decision/issue-detector.service.ts`      | 修改     | 1处 t() → cl()                                           |
| `decision/i18n/decision-labels.ts`                 | 修改     | 新增 modifier._/portion._/issue.\* keys                  |

### Phase 2 改动文件

| 文件                                                  | 改动类型  | 说明                            |
| ----------------------------------------------------- | --------- | ------------------------------- |
| `decision/types/*.ts`                                 | 新建 6 个 | 拆分自 analysis-result.types.ts |
| `decision/types/index.ts`                             | 新建      | barrel re-export                |
| `decision/decision/alternative-suggestion.service.ts` | 修改      | 移除静态硬编码                  |
| `decision/score/food-scoring.service.ts`              | 修改      | t() → cl()                      |
| `decision/analyze/user-context-builder.service.ts`    | 修改      | t() → cl()                      |
| `decision/analyze/evidence-pack-builder.service.ts`   | 修改      | 硬编码中文 → cl()               |
| `decision/analyze/confidence-diagnostics.service.ts`  | 修改      | 硬编码中文 → cl()               |

### Phase 3 改动文件

| 文件                                               | 改动类型 | 说明                      |
| -------------------------------------------------- | -------- | ------------------------- |
| `decision/coach/decision-coach.service.ts`         | 修改     | alternatives 引用推荐引擎 |
| `decision/coach/decision-tone-resolver.service.ts` | 修改     | 内联多语言 → cl()         |
| `decision/coach/coach-tone.config.ts`              | 修改     | PERSONA_PROMPTS → ci()    |
| `decision/decision/decision-summary.service.ts`    | 修改     | 冲突解释增强              |
| `decision/decision/food-decision.service.ts`       | 修改     | 传递 snapshot 数据        |
| `decision/i18n/decision-labels.ts`                 | 修改     | 新增 tone._/coach._ keys  |
