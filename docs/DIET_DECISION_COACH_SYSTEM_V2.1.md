# 饮食决策 + AI教练系统 V2.1 设计文档

> 基于 V2.0，核心目标：**解耦分离 + 分析准确度 + 推荐引擎集成 + 可维护性 + 国际化基础**

---

## Step 1：当前系统能力分析（V2.0 基线）

### ✅ 已具备的能力

| 层         | 能力                                                                                     | 状态         |
| ---------- | ---------------------------------------------------------------------------------------- | ------------ |
| **分析层** | 文本食物识别（标准库精确/模糊 + LLM 补位）                                               | ✅ 成熟      |
| **分析层** | 图片食物识别（AI Vision）                                                                | ✅ 成熟      |
| **分析层** | 营养估算（热量/蛋白/脂肪/碳水/纤维/钠）                                                  | ✅           |
| **分析层** | 上下文构建（今日摄入/用户画像/目标）                                                     | ✅ V2.0 统一 |
| **评分层** | 7维评分（energy/proteinRatio/macroBalance/foodQuality/satiety/stability/glycemicImpact） | ✅           |
| **评分层** | 维度解释 + suggestion                                                                    | ✅ V1.9      |
| **决策层** | 三档决策（recommend/caution/avoid）+ 阈值差异化                                          | ✅           |
| **决策层** | 上下文修正（累积饱和/多日趋势/暴食风险/正向反馈）                                        | ✅ V2.0      |
| **决策层** | 结构化问题识别（8类检查）                                                                | ✅ V2.0      |
| **决策层** | 替代方案（推荐引擎优先 + 静态 fallback）                                                 | ✅           |
| **决策层** | 决策推理链 + 可解释性                                                                    | ✅ V1.6      |
| **教练层** | 对话式引导 + 结构化输出                                                                  | ✅           |
| **教练层** | Goal×Tone 个性化语气矩阵                                                                 | ✅ V1.9      |
| **教练层** | 分析事件自动桥接                                                                         | ✅ V2.0      |
| **教练层** | Prompt token 安全截断                                                                    | ✅ V2.0      |

### ❌ 缺失点 / 改进目标

| #   | 缺失点                                           | 影响                                                                                  | V2.1 目标                    |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------- | ---------------------------- |
| 1   | **分析/评分/决策 三层耦合在同一模块**            | 无法独立迭代，text/image 服务各 900 行                                                | 解耦为独立子模块             |
| 2   | **Text/Image 编排重复**                          | 新增分析链路需复制代码                                                                | 引入统一 AnalysisPipeline    |
| 3   | **FoodScoringService 有两个评分方法**            | `calculateScore` vs `calculateImageScore` 内部逻辑重复                                | 统一为一个入口               |
| 4   | **FoodDecisionService 仍是"上帝服务"（1064行）** | 份量/下一餐/issues/macroProgress 都堆在里面                                           | 拆分职责                     |
| 5   | **事件名不一致**                                 | text 用 `DomainEvents.ANALYSIS_COMPLETED`，image 用字符串 `'food.analysis.completed'` | 统一事件常量                 |
| 6   | **跨模块 import 穿透**                           | food 直接引用 diet 内部路径                                                           | 通过 DietModule exports 隔离 |
| 7   | **i18n 分散**                                    | 评分标签/教练标签/决策标签各自维护 i18n Map                                           | 统一 i18n 基础设施           |
| 8   | **替代方案的推荐引擎调用缺少容错指标**           | 推荐引擎失败静默 fallback，无可观测性                                                 | 增加调用指标日志             |

---

## Step 2：饮食分析系统设计（Analyze）

### 2.1 架构：引入 AnalysisPipeline 编排器

```
AnalysisPipelineService（新）
├── Step 1: 食物识别（委托 text/image 各自的识别逻辑）
├── Step 2: 营养汇总（NutritionAggregator，从 text service 提取）
├── Step 3: 用户上下文构建（UserContextBuilderService，已有）
├── Step 4: 评分（FoodScoringService，统一入口）
├── Step 5: 决策（FoodDecisionService）
├── Step 6: 结果组装（ResultAssemblerService，新）
├── Step 7: 持久化（AnalysisPersistenceService，从 text/image 提取）
└── Step 8: 事件发射（统一事件常量）
```

**核心原则**：text/image 只负责"食物识别"（Step 1），后续 Step 2-8 由 Pipeline 统一编排。

### 2.2 单次饮食分析

输入：`{ foods: AnalyzedFoodItem[], mealType, userId }`
输出：`FoodAnalysisResultV61`（不变）

### 2.3 上下文分析

由 `UserContextBuilderService.build()` 提供（V2.0 已统一），包含：

- 今日已摄入（热量/蛋白/脂肪/碳水）
- 剩余配额
- 用户目标 + 活动等级
- 过敏原/饮食限制/健康状况

### 2.4 问题识别

由 `decision-checks.ts` 8 类纯函数提供（V2.0 已有）：

- calorieCheck / proteinCheck / fatCheck / carbCheck
- lateNightCheck / allergenCheck / restrictionCheck / healthConditionCheck

---

## Step 3：评分系统设计（Score）

### 3.1 统一评分入口

将 `calculateScore` 和 `calculateImageScore` 合并为单一方法：

```typescript
// 统一签名
async calculateScore(input: ScoringInput): Promise<ScoringResult>

interface ScoringInput {
  foods: AnalyzedFoodItem[];
  totals: NutritionTotals;
  userContext: UnifiedUserContext;
  userId?: string;
  locale?: Locale;
}
```

图片链路不再自行计算评分，而是先将识别结果转为 `AnalyzedFoodItem[]`，再调统一入口。

### 3.2 评分维度解释

`explainBreakdown()` 保持不变，但搬到独立的 `scoring/` 目录下作为纯工具函数。

---

## Step 4：决策系统设计（Decision）

### 4.1 FoodDecisionService 拆分

当前 1064 行的 `FoodDecisionService` 拆分为：

| 服务                          | 职责                                                             | 来源                        |
| ----------------------------- | ---------------------------------------------------------------- | --------------------------- |
| `DecisionEngineService`       | 核心决策逻辑：computeDecision + scoreMultiplier 应用             | 从 FoodDecisionService 提取 |
| `PortionAdvisorService`       | 最优份量 + 下一餐建议                                            | 从 FoodDecisionService 提取 |
| `IssueDetectorService`        | 结构化问题识别 + 宏量进度                                        | 从 FoodDecisionService 提取 |
| `FoodDecisionService`（瘦身） | 编排层：协调以上三个 + AlternativeSuggestion + DecisionExplainer | 保留，但只做编排            |

### 4.2 动态决策

同一食物在不同时间/上下文下结论不同——已由 `ContextualDecisionModifierService` 实现（V2.0），无需改动。

### 4.3 替代方案推荐引擎集成增强

`AlternativeSuggestionService` 已正确集成 `SubstitutionService`。V2.1 增加：

- 推荐引擎调用成功/失败的日志指标
- fallback 时标记 `source: 'static'` vs `source: 'engine'`

---

## Step 5：AI教练系统设计（Coach）

### 5.1 对话式引导

已具备结构化输出（结论/原因/建议/替代），V2.1 不做大改。

### 5.2 个性化语气

Goal×Tone 矩阵已在 V1.9 实现（`coach-tone.config.ts`），V2.1 不做大改。

### 5.3 教练 i18n 基础

将 `CoachPromptBuilderService` 内的 `COACH_LABELS` 迁移到独立的 i18n 配置文件，与评分维度标签统一管理。

---

## Step 6：决策链路设计

```
用户输入（文本/图片）
  → [TextRecognizer / ImageRecognizer]  -- 食物识别
  → [NutritionAggregator]               -- 营养汇总
  → [UserContextBuilder]                 -- 上下文构建
  → [FoodScoringService]                -- 7维评分
  → [DecisionEngineService]             -- 三档决策
  → [ContextualModifier]                -- 上下文修正
  → [IssueDetector]                     -- 问题识别
  → [PortionAdvisor]                    -- 份量/下一餐
  → [AlternativeSuggestion]             -- 替代方案（推荐引擎）
  → [DecisionExplainer]                 -- 可解释性
  → [ResultAssembler]                   -- 组装 V61 结果
  → [AnalysisPersistence]              -- 持久化
  → [EventEmitter]                      -- 事件通知 → Coach 自动桥接
```

---

## Step 7：目录结构设计

### V2.1 目标目录结构（food 模块内部）

```
food/
├── food.module.ts
├── food.types.ts
├── app/
│   ├── controllers/
│   │   ├── food-analyze.controller.ts     -- HTTP 入口（不变）
│   │   └── food-library.controller.ts
│   ├── pipeline/                          -- 【新】统一分析管道
│   │   ├── analysis-pipeline.service.ts   -- 编排器
│   │   ├── nutrition-aggregator.ts        -- 营养汇总（从 text service 提取）
│   │   ├── result-assembler.service.ts    -- V61 结果组装（从 text/image 提取）
│   │   └── analysis-persistence.service.ts -- 持久化（从 text/image 提取）
│   ├── scoring/                           -- 评分（已有，增强）
│   │   ├── food-scoring.service.ts        -- 统一评分入口
│   │   └── scoring.types.ts              -- 评分相关类型
│   ├── decision/                          -- 决策（已有，拆分）
│   │   ├── decision-engine.service.ts     -- 【新】核心决策逻辑
│   │   ├── portion-advisor.service.ts     -- 【新】份量 + 下一餐建议
│   │   ├── issue-detector.service.ts      -- 【新】问题识别 + 宏量进度
│   │   ├── food-decision.service.ts       -- 瘦身为编排层
│   │   ├── alternative-suggestion.service.ts -- 不变
│   │   ├── decision-explainer.service.ts  -- 不变
│   │   ├── user-context-builder.service.ts -- 不变
│   │   ├── contextual-modifier.service.ts -- 不变
│   │   └── decision-checks.ts            -- 不变
│   ├── services/                          -- 食物识别（瘦身）
│   │   ├── text-food-analysis.service.ts  -- 只保留食物识别逻辑
│   │   ├── image-food-analysis.service.ts -- 只保留 AI Vision 调用
│   │   ├── analyze.service.ts             -- 队列编排（不变）
│   │   └── food-library.service.ts        -- 不变
│   ├── config/                            -- 配置（不变）
│   ├── types/                             -- 类型（不变）
│   ├── listeners/                         -- 事件监听（不变）
│   └── i18n/                              -- 【新】统一 i18n 标签
│       └── food-labels.ts                 -- 评分/决策/问题标签
```

---

## Step 8：分阶段实施计划

### Phase 1：解耦分离 — 评分独立 + 决策拆分 + 事件统一

**目标**：将"上帝服务"拆成职责清晰的小服务，不改变外部行为。

| #   | 任务                                                                                                           | 文件                              |
| --- | -------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1.1 | 统一评分入口：合并 `calculateScore` 和 `calculateImageScore` 为统一 `calculateScore(ScoringInput)`             | `food-scoring.service.ts`         |
| 1.2 | 提取 `DecisionEngineService`：从 FoodDecisionService 提取 `computeDecision` + 阈值逻辑                         | 新建 `decision-engine.service.ts` |
| 1.3 | 提取 `PortionAdvisorService`：从 FoodDecisionService 提取 `calculateOptimalPortion` + `generateNextMealAdvice` | 新建 `portion-advisor.service.ts` |
| 1.4 | 提取 `IssueDetectorService`：从 FoodDecisionService 提取 `identifyIssues` + `computeMacroProgress`             | 新建 `issue-detector.service.ts`  |
| 1.5 | 瘦身 `FoodDecisionService`：改为编排层，协调 1.2-1.4 + AlternativeSuggestion + DecisionExplainer               | `food-decision.service.ts`        |
| 1.6 | 统一事件常量：text/image 都使用 `DomainEvents.ANALYSIS_COMPLETED`                                              | `image-food-analysis.service.ts`  |
| 1.7 | 注册新服务到 FoodModule                                                                                        | `food.module.ts`                  |

### Phase 2：分析管道统一 + 替代方案增强

**目标**：引入 AnalysisPipeline 消除 text/image 编排重复；替代方案增加可观测性。

| #   | 任务                                                                                             | 文件                                            |
| --- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------- | ------------------------------------------- |
| 2.1 | 提取 `NutritionAggregator`：从 text service 提取营养汇总纯函数                                   | 新建 `pipeline/nutrition-aggregator.ts`         |
| 2.2 | 提取 `ResultAssemblerService`：从 text/image 提取 V61 结果组装                                   | 新建 `pipeline/result-assembler.service.ts`     |
| 2.3 | 提取 `AnalysisPersistenceService`：从 text/image 提取持久化逻辑                                  | 新建 `pipeline/analysis-persistence.service.ts` |
| 2.4 | 创建 `AnalysisPipelineService`：统一编排 context → score → decision → assemble → persist → event | 新建 `pipeline/analysis-pipeline.service.ts`    |
| 2.5 | 瘦身 text/image service：只保留食物识别，编排委托 Pipeline                                       | 修改两个分析服务                                |
| 2.6 | 替代方案增加推荐引擎调用指标：成功/失败/fallback 日志                                            | `alternative-suggestion.service.ts`             |
| 2.7 | 替代方案结果标记 `source: 'engine'                                                               | 'static'`                                       | `alternative-suggestion.service.ts` + types |

### Phase 3：教练增强 + i18n 基础设施

**目标**：教练 prompt 国际化基础；评分/决策标签统一管理。

| #   | 任务                                                                                         | 文件                       |
| --- | -------------------------------------------------------------------------------------------- | -------------------------- |
| 3.1 | 提取 `food-labels.ts`：将 `COACH_LABELS` + `DIMENSION_LABELS` + 决策相关 i18n 合并到统一文件 | 新建 `i18n/food-labels.ts` |
| 3.2 | `CoachPromptBuilderService` 引用统一 i18n                                                    | 修改 prompt builder        |
| 3.3 | `scoring-dimensions.ts` 引用统一 i18n                                                        | 修改评分配置               |
| 3.4 | 清理 `services/food-decision.service.ts` 重导出文件                                          | 删除或标记 deprecated      |
| 3.5 | 更新 FoodModule exports，确保外部消费者使用正确路径                                          | `food.module.ts`           |

---

## 验证标准

每个 Phase 完成后必须：

1. `npx tsc --noEmit --project apps/api-server/tsconfig.build.json` 通过
2. 外部行为不变：`FoodAnalysisResultV61` 结构不变，API 接口不变
3. 无数据库字段变更
4. 不修改推荐系统/用户画像系统/订阅系统
