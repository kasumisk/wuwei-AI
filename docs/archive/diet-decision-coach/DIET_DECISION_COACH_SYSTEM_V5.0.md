# 饮食决策 + AI教练系统 V5.0 升级设计文档

> 版本：V5.0 | 基线：V4.9 | 不兼容旧代码

---

## 一、V4.9 遗留问题分析

### 1.1 Text / Image 分析 Prompt 各自独立（Critical）

| 维度            | Text 链路                                       | Image 链路                                                               | 影响                                                              |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| **Prompt 构建** | `buildBasePrompt('text') + buildContextBlock()` | `buildGoalAwarePrompt()` + tonePrompt + behaviorContext + precisionBlock | 两条链路注入的上下文完全不同，text 缺少 persona tone 和行为上下文 |
| **模型**        | `deepseek-chat-v3` (text)                       | `ernie-4.5-vl-28b` (vision)                                              | 合理，但 prompt 结构差异不应因模型而异                            |
| **库匹配**      | 先库匹配 → LLM fallback → 再 re-match           | 无库匹配，纯 AI 输出                                                     | image 链路的营养数据无校准源                                      |
| **评分路径**    | `calculateScore()` — per-food granularity       | `calculateImageScore()` — aggregated totals only                         | 图片链路失去 per-food 质量/饱腹评分精度                           |
| **结果格式**    | 直接 AnalyzedFoodItem[] → pipeline              | legacy AnalysisResult → legacyFoodsToAnalyzed() → pipeline               | image 有额外转换层                                                |

### 1.2 Prompt 字段与食物库 / 食物富化 Pipeline 不完全对齐

| Prompt 已有 | 食物库有但 Prompt 未要求                    | 影响                                               |
| ----------- | ------------------------------------------- | -------------------------------------------------- |
| ~40 字段    | `foodForm` (ingredient/dish/semi_prepared)  | 无法区分原料 vs 菜品，scoring 中 dish 拆解逻辑缺失 |
|             | `commonPortions` (JSON: [{name, grams}])    | LLM 只返回单一 `standardServingG`，缺少多份量规格  |
|             | `dishPriority` (0-100)                      | 推荐引擎依赖此字段，分析链路未产出                 |
|             | `flavorProfile` (JSON: {sweet, salty, ...}) | coach 个性化建议缺少口味偏好依据                   |
|             | `compatibility` (JSON: {good:[], avoid:[]}) | 替代建议缺少搭配/冲突信息                          |

### 1.3 评分系统 Text/Image 双路径冗余

`FoodScoringService` 维护 `calculateScore()` 和 `calculateImageScore()` 两套入口，核心都调用 `computeScoreCore()`，但输入转换逻辑不同。Image 路径丢失 per-food 粒度信息。

### 1.4 决策系统与分析系统耦合

`AnalysisPipelineService` 同时编排分析和决策，809 行文件包含：

- 营养汇总（分析）
- 评分（分析/评分边界）
- 决策判断（决策）
- Coach 诊断（决策/教练）
- 持久化（基础设施）

职责不清晰，难以独立测试和迭代。

### 1.5 替代建议硬编码阈值

`AlternativeSuggestionService` 中：

- 静态规则 `CATEGORY_ALTERNATIVE_RULES` + `GOAL_ALTERNATIVE_RULES` 作为 fallback
- 约束提取阈值硬编码（如 late-night hour=21, calorie floor=200）
- 推荐引擎可用时仍有大量 fallback 逻辑分支

### 1.6 Coach i18n 分散 + 缺乏冲突解释能力

- `coach-i18n.ts` (858 行) 自包含所有翻译，未与 `decision-labels` 统一
- 饮食冲突（如"高蛋白目标但当天蛋白已超"）缺乏结构化解释
- education points 硬编码条件→主题映射

### 1.7 Image 链路 Legacy 转换层

`image-food-analysis.service.ts` 使用 legacy `AnalysisResult` → `legacyFoodsToAnalyzed()` → `AnalyzedFoodItem[]`，增加了一层不必要的转换。

---

## 二、V5.0 优化目标

### 核心原则

- **不兼容旧代码**，以最优标准迭代
- **不增加新模块**，只在现有模块内重构（新文件 OK）
- **不增加数据库字段**
- 推荐系统/用户画像系统**只读**
- `text-food-analysis.service.ts` 中文 NLP 逻辑（中文分词/停用词/单位识别）不修改
- Logger 消息统一使用英文
- 用户可见错误消息使用英文（API 层，前端负责展示）

### Phase 1：统一分析 Prompt + 合并 Text/Image Prompt + 分析-评分解耦（6 个目标）

1. **P1.1** 统一分析 Prompt 对齐食物库：在 `FOOD_JSON_SCHEMA` 中新增 `foodForm`、`commonPortions`、`dishPriority` 三个字段（与食物库 Foods 模型对齐，与食物富化 pipeline 的字段定义一致）。`ESTIMATION_RULES` 增加这三个字段的估算指引
2. **P1.2** 合并 Text/Image Prompt 为统一 Prompt：消除 `buildBasePrompt` 的 mode 参数差异，`SYSTEM_ROLE` 合并为单一角色指令（text 和 image 只在 user message 层区分）。Image 链路的 persona tone / behavior context / precision block 统一提取为可组合的 context block，text 链路同样可注入
3. **P1.3** Image 链路消除 legacy 转换层：`image-food-analysis.service.ts` 直接输出 `AnalyzedFoodItem[]`，移除 legacy `AnalysisResult` 和 `legacyFoodsToAnalyzed()` 转换。Image 链路的 JSON 解析直接映射到 `AnalyzedFoodItem`
4. **P1.4** 评分路径统一：消除 `calculateImageScore()` 独立入口，image 链路复用 `calculateScore()` 路径。Image 食物列表通过 `toScoringFoodItems()` 转换后走统一评分。Pipeline 中的 `computeScore()` 不再区分 text/image
5. **P1.5** 分析-评分解耦：将 `AnalysisPipelineService` 中的评分逻辑提取到独立的 `ScoringStageService`（新文件在 decision/score/ 下），Pipeline 只负责编排调用。ScoringStageService 封装 `computeScore()` + `toScoringFoodItems()` + fallback 逻辑
6. **P1.6** tsc 0 errors

### Phase 2：上下文分析增强 + 替代建议推荐引擎化 + 架构增强（6 个目标）

1. **P2.1** 替代建议全面推荐引擎化：`AlternativeSuggestionService` 的静态规则降级为最后 fallback，引擎 + substitution 路径增强。引擎调用时传入 `foodForm` 和 `flavorProfile`（当食物库匹配到时），提升替代相关性
2. **P2.2** 约束提取动态化：替代建议中的硬编码阈值（late-night hour、calorie floor、rank weights）提取到 `decision-thresholds.ts` 统一管理
3. **P2.3** 决策编排解耦：将 `AnalysisPipelineService` 中的决策阶段（runDecide）提取到独立的 `DecisionStageService`（新文件在 decision/decision/ 下），Pipeline 只负责三阶段编排调用
4. **P2.4** Coach 阶段解耦：将 `AnalysisPipelineService` 中的 coaching 阶段（runCoaching）提取到独立的 `CoachingStageService`（新文件在 decision/coach/ 下）
5. **P2.5** Image 链路库匹配增强：Image 分析结果中的 `nameEn` 用于 post-analysis 库匹配（复用 `analysis-ingestion.service.ts` 的匹配逻辑），补充 `foodLibraryId` 和校准营养数据
6. **P2.6** tsc 0 errors

### Phase 3：AI Coach 增强 + 个性化指导 + i18n 整合（6 个目标）

1. **P3.1** 饮食冲突结构化解释：Coach 新增 `conflictExplanations` 字段，结构化解释当前食物与用户目标/健康条件/当天摄入的冲突。使用 `StructuredDecision` 的 4 维度分数（nutritionAlignment, macroBalance, healthConstraint, timeliness）作为冲突来源
2. **P3.2** Coach i18n 统一到 decision-labels 体系：`coach-i18n.ts` 中的翻译 key 迁移到 `labels-zh.ts / labels-en.ts / labels-ja.ts`，`ci()` 函数内部改为调用 `cl()` + 命名空间前缀 `coach.`。消除 coach-i18n.ts 中的独立翻译存储
3. **P3.3** Education points 动态化：Coach 的 education points 从硬编码映射改为基于 `DietIssue[]` 动态生成，利用 issue 的 category + severity 决定教育内容。Education 内容翻译走统一 i18n
4. **P3.4** 多语言 Coach prompt 模板：Coach 对话模板支持 zh-CN / en-US / ja-JP 三语，模板存储在 `prompt-labels.ts` 中（复用现有 i18n 基础设施）
5. **P3.5** `flavorProfile` + `compatibility` 在 Coach 建议中的应用：当食物库匹配到时，Coach 的替代建议和搭配建议可引用 `flavorProfile`（口味相似推荐）和 `compatibility`（搭配/冲突提示）
6. **P3.6** tsc 0 errors

---

## 三、关键设计决策

### 3.1 统一 Prompt 架构（V5.0 P1.1 + P1.2）

```
                    ┌─────────────────────────┐
                    │  Unified System Role     │ ← 不区分 text/image
                    │  (nutrition analyst)      │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │  JSON Schema (per-100g)  │ ← 新增 foodForm, commonPortions, dishPriority
                    │  + Estimation Rules      │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
    ┌─────────▼─────────┐ ┌─────▼──────┐ ┌─────────▼─────────┐
    │  Goal Focus Block  │ │ Context    │ │ Precision Block    │
    │  (per goal type)   │ │ Block      │ │ (health + budget)  │
    └────────────────────┘ │ (calories, │ └────────────────────┘
                           │  protein,  │
                           │  behavior) │
                           └────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                                      │
    ┌─────────▼─────────┐              ┌─────────────▼─────────────┐
    │  Text User Message │              │  Image User Message       │
    │  "Analyze: {text}" │              │  "Analyze this image"     │
    └────────────────────┘              │  + image_url content      │
                                        └───────────────────────────┘
```

**变更**：

- `SYSTEM_ROLE` 合并为单一角色（不区分 text/image），mode 差异仅在 user message
- `buildBasePrompt()` 移除 mode 参数，返回统一 base prompt
- Image 链路的 persona tone 和 behavior context 统一为 `buildEnrichedContextBlock()`，text 链路同样可用
- `buildPrecisionBlock()` 和 `buildContextBlock()` 合并为 `buildUserContextPrompt()`（包含 goal + budget + health + precision）

### 3.2 新增 Prompt 字段（对齐食物库）

```typescript
// FOOD_JSON_SCHEMA 新增字段
{
  // ... existing fields ...
  "foodForm": "ingredient" | "dish" | "semi_prepared",
  // ingredient=单一食材（鸡蛋、米饭）
  // dish=成品菜品（宫保鸡丁、牛肉面）
  // semi_prepared=半成品（速冻饺子、预制菜）

  "commonPortions": [
    {"name": "1碗", "grams": 200},
    {"name": "1盘", "grams": 300}
  ],
  // 常见份量规格（≤3个），包含名称和对应克数

  "dishPriority": 数字 0-100,
  // 推荐优先级：100=日常主食/经典菜品，50=常见，0=罕见
}
```

**ESTIMATION_RULES 新增指引**：

- `foodForm`：单一食材（raw/cooked）= `ingredient`，包含多种食材的成品 = `dish`，工厂预制 = `semi_prepared`
- `commonPortions`：列出 1-3 个最常见份量规格（碗/盘/个/片等），每个包含 name 和 grams
- `dishPriority`：日常主食（米饭/面条）和经典菜品（番茄炒蛋）= 80-100，常见但非主食 = 40-70，罕见/特殊 = 0-30

### 3.3 统一评分路径

**Before (V4.9)**:

```
Text  → ScoringFoodItem[]  → calculateScore()      → AnalysisScore
Image → ImageScoringInput   → calculateImageScore() → {score, breakdown}
```

**After (V5.0)**:

```
Text  → ScoringFoodItem[] ─┐
                            ├→ calculateScore() → AnalysisScore
Image → ScoringFoodItem[] ─┘
         (via toScoringFoodItems)
```

Image 链路的食物列表通过 `toScoringFoodItems()` 转换为 `ScoringFoodItem[]`，走统一 `calculateScore()` 路径。`calculateImageScore()` 废弃。

### 3.4 Pipeline 三阶段解耦

**Before (V4.9)**: `AnalysisPipelineService` 包含 `runAnalyze()` + `runDecide()` + `runCoaching()` 全部逻辑 (809 行)

**After (V5.0)**:

```
AnalysisPipelineService (编排器，~200 行)
  ├── ScoringStageService.run()     ← 新文件：decision/score/scoring-stage.service.ts
  ├── DecisionStageService.run()    ← 新文件：decision/decision/decision-stage.service.ts
  └── CoachingStageService.run()    ← 新文件：decision/coach/coaching-stage.service.ts
```

每个 Stage Service 封装完整的阶段逻辑，Pipeline 只负责：

1. 调用三个 stage
2. 组装最终结果
3. 持久化 + 事件发射

### 3.5 Image 链路消除 Legacy 转换

**Before (V4.9)**:

```
Vision AI → JSON → AnalysisResult (legacy) → legacyFoodsToAnalyzed() → AnalyzedFoodItem[]
```

**After (V5.0)**:

```
Vision AI → JSON → AnalyzedFoodItem[] (直接映射)
```

`image-food-analysis.service.ts` 的 JSON 解析直接产出 `AnalyzedFoodItem[]`，无需中间 legacy 格式。

### 3.6 Coach i18n 统一

**Before (V4.9)**:

```
coach-i18n.ts (858 lines, standalone translations)
  ci('coach.headline.balanced', 'zh-CN')
  ↓
  独立的 COACH_TRANSLATIONS 字典

decision-labels.ts
  cl('pipeline.fallback.reason', 'zh-CN')
  ↓
  labels-zh.ts / labels-en.ts / labels-ja.ts
```

**After (V5.0)**:

```
labels-zh.ts / labels-en.ts / labels-ja.ts
  新增 coach.* 命名空间
  cl('coach.headline.balanced', 'zh-CN')

coach-i18n.ts (~100 lines, thin wrapper)
  ci(key, locale, vars) → cl('coach.' + key, locale) + 变量替换
```

### 3.7 饮食冲突结构化解释

```typescript
interface ConflictExplanation {
  /** 冲突维度 */
  dimension: 'nutritionAlignment' | 'macroBalance' | 'healthConstraint' | 'timeliness';
  /** 冲突严重程度 */
  severity: 'info' | 'warning' | 'critical';
  /** 冲突描述（已 i18n） */
  message: string;
  /** 冲突数据佐证 */
  evidence: {
    current: number; // 当前值/分数
    threshold: number; // 阈值
    unit?: string; // 单位
  };
  /** 改善建议 */
  suggestion?: string;
}
```

Coach 根据 `StructuredDecision` 的 4 维度分数生成冲突解释：

- `nutritionAlignment < 40` → 营养偏离冲突
- `macroBalance < 40` → 宏量失衡冲突
- `healthConstraint < 40` → 健康条件冲突
- `timeliness < 40` → 时间不当冲突

---

## 四、决策链路设计（V5.0）

```
用户输入（文本/图片）
  ↓
[食物识别] text-food-analysis / image-food-analysis
  ↓ AnalyzedFoodItem[] (per-100g)
  │ ← V5.0 P1.1: 新增 foodForm, commonPortions, dishPriority
  │ ← V5.0 P1.2: 统一 Prompt（text/image 只在 user message 层区分）
  │ ← V5.0 P1.3: Image 直接输出 AnalyzedFoodItem[]（无 legacy 转换）
  ↓
[统一 Prompt Schema] analysis-prompt-schema.ts
  │ ← V5.0 P1.2: buildBasePrompt() 不区分 mode
  │ ← V5.0 P1.2: buildUserContextPrompt() 合并 context/precision block
  ↓
[营养换算 + 汇总] nutrition-aggregator (V4.9 已实现)
  ↓
[合理性校验] nutrition-sanity-validator (V4.9 已实现)
  ↓
[用户上下文] user-context-builder → UnifiedUserContext
  ↓
[评分] ScoringStageService (V5.0 P1.5: 新文件)
  │ ← V5.0 P1.4: 统一 calculateScore() 路径
  │ ← toScoringFoodItems() for both text & image
  ↓
[上下文分析] analysis-context.service
  ↓
[决策判断] DecisionStageService (V5.0 P2.3: 新文件)
  ├── decision-engine.service
  ├── decision-checks/
  ├── alternative-suggestion.service
  │   ← V5.0 P2.1: 引擎优先，传入 foodForm + flavorProfile
  │   ← V5.0 P2.2: 阈值从 decision-thresholds.ts 读取
  └── decision-explainer.service
  ↓
[AI教练] CoachingStageService (V5.0 P2.4: 新文件)
  ├── decision-coach.service
  │   ← V5.0 P3.1: conflictExplanations 结构化冲突
  │   ← V5.0 P3.3: education points 动态化
  │   ← V5.0 P3.5: flavorProfile + compatibility 应用
  ├── coach-i18n.ts
  │   ← V5.0 P3.2: 瘦身，翻译迁移到 labels-*.ts
  └── prompt-labels.ts
      ← V5.0 P3.4: 多语言 coach prompt 模板
  ↓
[Pipeline 编排] AnalysisPipelineService (~200 行)
  ├── 组装 FoodAnalysisResultV61
  ├── 持久化（fire-and-forget）
  └── 事件发射
```

---

## 五、分阶段实施计划

### Phase 1：统一 Prompt + 合并评分 + 解耦分析（6 个目标）

| 编号 | 文件                                                       | 改动                                                                                                                                                                                                                                                                                                     |
| ---- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.1 | `analysis-prompt-schema.ts`                                | `FOOD_JSON_SCHEMA` 三语新增 `foodForm`、`commonPortions`、`dishPriority` 字段；`ESTIMATION_RULES` 三语新增这三个字段的估算指引                                                                                                                                                                           |
| P1.2 | `analysis-prompt-schema.ts`                                | `SYSTEM_ROLE` 合并为统一角色（移除 text/image 分支）；`buildBasePrompt()` 移除 mode 参数；新增 `buildUserContextPrompt()` 合并 context + precision block；`buildContextBlock()` 和 `buildPrecisionBlock()` 标记 @deprecated；更新 text-food-analysis.service.ts 和 image-food-analysis.service.ts 的调用 |
| P1.3 | `image-food-analysis.service.ts`                           | 移除 legacy `AnalysisResult` 类型和 `legacyFoodsToAnalyzed()` 转换，JSON 解析直接映射到 `AnalyzedFoodItem[]`；调用统一 prompt 函数                                                                                                                                                                       |
| P1.4 | `food-scoring.service.ts` + `analysis-pipeline.service.ts` | 新增 `toScoringFoodItems()` 通用转换；image 链路改用 `calculateScore()` 路径；`calculateImageScore()` 标记 @deprecated 或移除                                                                                                                                                                            |
| P1.5 | 新文件 `decision/score/scoring-stage.service.ts`           | 从 `AnalysisPipelineService.computeScore()` 提取：封装评分入口 + toScoringFoodItems 转换 + fallback；Pipeline 的 `runAnalyze()` 调用 `ScoringStageService.run()`                                                                                                                                         |
| P1.6 | —                                                          | tsc 0 errors                                                                                                                                                                                                                                                                                             |

### Phase 2：替代建议增强 + 决策解耦 + Image 库匹配（6 个目标）

| 编号 | 文件                                                               | 改动                                                                                                                                                         |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P2.1 | `alternative-suggestion.service.ts`                                | 引擎调用时传入匹配到的 `foodForm` 和 `flavorProfile`；引擎路径权重提升（优先级 1），substitution 路径权重降低（优先级 2），静态规则仅作 fallback（优先级 3） |
| P2.2 | `decision-thresholds.ts` + `alternative-suggestion.service.ts`     | 将 late-night hour (21)、calorie floor (200)、rank weight ratios、engine/substitution/static 优先级阈值提取到 `decision-thresholds.ts` 统一管理              |
| P2.3 | 新文件 `decision/decision/decision-stage.service.ts`               | 从 `AnalysisPipelineService.runDecide()` 提取：封装完整决策阶段逻辑（decision + structuredDecision + summary）；包含 `toDecisionFoodItems()` 转换和 fallback |
| P2.4 | 新文件 `decision/coach/coaching-stage.service.ts`                  | 从 `AnalysisPipelineService.runCoaching()` 提取：封装完整 coaching 阶段逻辑（诊断 + 恢复 + 证据包 + shouldEat + 准确度）                                     |
| P2.5 | `image-food-analysis.service.ts` + `analysis-ingestion.service.ts` | Image 分析结果的 `nameEn` 用于 post-analysis 库匹配，补充 `foodLibraryId` 和营养校准。复用 `AnalysisIngestionService` 的匹配逻辑                             |
| P2.6 | —                                                                  | tsc 0 errors                                                                                                                                                 |

### Phase 3：Coach 增强 + i18n 统一 + 个性化（6 个目标）

| 编号 | 文件                                                               | 改动                                                                                                                                                                                  |
| ---- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3.1 | `decision-coach.service.ts`                                        | 新增 `buildConflictExplanations()` 方法：从 `StructuredDecision` 4 维度分数生成 `ConflictExplanation[]`，阈值 <40 触发冲突；输出附加到 `CoachingExplanation.conflictExplanations`     |
| P3.2 | `coach-i18n.ts` + `labels-zh.ts` + `labels-en.ts` + `labels-ja.ts` | coach-i18n.ts 中 `COACH_TRANSLATIONS` 迁移到 labels-_.ts（`coach._` 命名空间）；`ci()`函数改为`cl('coach.' + key, locale)` + 变量替换的 thin wrapper；coach-i18n.ts 缩减到 ~100 行    |
| P3.3 | `decision-coach.service.ts`                                        | `buildEducationPoints()` 改为基于 `DietIssue[]` 动态生成：issue.category 映射到教育主题，issue.severity 决定深度。教育内容翻译 key 存储在 labels-_.ts 的 `coach.education._` 命名空间 |
| P3.4 | `prompt-labels.ts`                                                 | 新增 `COACH_PROMPT_TEMPLATES` 三语 coach 对话模板（headline / guidance / close 模板），供 `decision-coach.service.ts` 使用                                                            |
| P3.5 | `decision-coach.service.ts`                                        | 当食物有 `foodLibraryId` 且库中有 `flavorProfile` / `compatibility` 时：替代建议添加"口味相似"标注；搭配建议引用 `compatibility.good[]`；冲突提示引用 `compatibility.avoid[]`         |
| P3.6 | —                                                                  | tsc 0 errors                                                                                                                                                                          |

---

## 六、风险与缓解

### 6.1 新增 Prompt 字段导致 Token 成本增加

**风险**：`foodForm`、`commonPortions`、`dishPriority` 增加 ~50 tokens/food 的输出。

**缓解**：

- 这三个字段信息量高，对推荐和教练有直接价值
- `commonPortions` 限制最多 3 个规格
- `dishPriority` 为单个数字，overhead 极小

### 6.2 Image 链路统一评分后精度变化

**风险**：Image 链路从 `calculateImageScore()` 切换到 `calculateScore()` 后，per-food 粒度可能因 image AI 的 quality/satiety 估算不够准确而产生偏差。

**缓解**：

- Image 链路的 `confidence` 本身反映 AI 不确定性，低 confidence 食物在评分中已有衰减机制
- `calculateScore()` 的 confidence-weighted 聚合比 `calculateImageScore()` 的 flat aggregation 更合理
- V5.0 P2.5 的 Image 库匹配增强会补充更准确的 quality/satiety 数据

### 6.3 Coach i18n 迁移过程中 key 遗漏

**风险**：858 行 coach-i18n.ts 中可能有 key 迁移遗漏。

**缓解**：

- 迁移后跑 tsc + 单元测试确保所有 key 可解析
- `ci()` 函数保留作为 thin wrapper，调用端不需要改动
- 分批迁移：先迁移高频 key（headline/summary/guidance），再迁移低频 key（education/behavior）

### 6.4 Pipeline 解耦后循环依赖

**风险**：新增 ScoringStageService / DecisionStageService / CoachingStageService 可能引入新的循环依赖。

**缓解**：

- 三个 Stage Service 只依赖已有的 leaf services（FoodScoringService, FoodDecisionService, etc.），不依赖 Pipeline
- Pipeline 只依赖三个 Stage Service，不反向依赖
- 如有 DI 问题，使用 `forwardRef()` 解决（现有模式）

### 6.5 Image 库匹配 post-analysis 性能

**风险**：Image 分析后增加库匹配步骤，增加约 50-200ms 延迟。

**缓解**：

- 库匹配使用已有的 `FoodLibraryService`，有 Redis 缓存
- 匹配是 fire-and-forget 或 parallel 执行，不阻塞主返回路径
- 仅在 `nameEn` 存在时触发匹配

---

## 七、禁止修改范围确认

- ❌ 推荐系统：只读 `SubstitutionService` / `RecommendationEngineService`
- ❌ 用户画像系统：只读 `UnifiedUserContext`
- ❌ 订阅/商业化逻辑
- ❌ 不增加数据库字段
- ❌ 不增加新模块（可增加新文件在现有模块内）
- ❌ `text-food-analysis.service.ts` 中文本 NLP 逻辑（中文分词/停用词/单位识别）不修改
- ❌ `executeAnalysis()` 返回格式（Redis 缓存兼容）不可破坏

---

## 八、i18n 系统约束

- `t(key,vars,locale)` — 用户可见消息（错误提示等）
- `cl(key,locale)` — decision 模块标签（V5.0: 新增 `coach.*` 命名空间）
- `ci(key,locale,vars)` — coach 专用（V5.0: 改为 thin wrapper over `cl()`）
- `chainLabel(key,vars,locale)` — 决策链路步骤标签
- Logger 消息统一使用英文

---

## 九、新增文件清单

| 文件                                          | 模块     | 职责                      |
| --------------------------------------------- | -------- | ------------------------- |
| `decision/score/scoring-stage.service.ts`     | decision | 评分阶段封装（P1.5）      |
| `decision/decision/decision-stage.service.ts` | decision | 决策阶段封装（P2.3）      |
| `decision/coach/coaching-stage.service.ts`    | decision | Coaching 阶段封装（P2.4） |

所有新文件在现有 decision 模块内，不引入新模块。
