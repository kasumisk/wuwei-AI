# 饮食决策 + AI教练系统 V4.5 — 设计文档

> 版本: V4.5 | 作者: 系统架构师 | 日期: 2026-04-20
> 基于 V4.4 迭代升级，围绕 **分析 → 评分 → 决策 → 教练** 四层能力优化

---

## 一、现有能力分析

### 1.1 当前系统能力矩阵

| 能力层           | 现状                                              | 评级  | 关键缺失                                                                     |
| ---------------- | ------------------------------------------------- | ----- | ---------------------------------------------------------------------------- |
| **食物营养分析** | 文本/图片双入口，LLM + 食物库混合                 | ⚠️ B  | 文本/图片 prompt 完全不同结构；字段与食物库不对齐；category 编码不统一       |
| **评分能力**     | 7维评分 + 信心加权 + 健康状况调整                 | ✅ A  | 无重大缺失，但废弃文件 `scoring.service.ts` 仍存在                           |
| **决策能力**     | 3级判定 + 4因子结构化决策 + 动态阈值              | ✅ A- | Should Eat 语义清晰但可解释性分散在多个服务                                  |
| **教练能力**     | 规则文本生成（非 LLM 对话）                       | ⚠️ B- | 纯拼接非 AI 生成；`coach-i18n.ts` 30KB 与 `decision-labels.ts` 84KB 职责重叠 |
| **替代方案**     | 3 级降级（推荐引擎 → 替换服务 → 静态规则）        | ✅ A- | 静态规则仍有硬编码食物名；引擎调用已完备                                     |
| **用户行为记录** | 通过 `analysis-persistence.service.ts` 异步持久化 | ✅ A  | 完备                                                                         |

### 1.2 关键问题

1. **文本/图片 prompt 割裂**：完全不同的角色定义、输出字段、category 编码
   - 文本 prompt 返回 `estimatedWeightGrams`, `standardServingG`, `glycemicIndex`, `isProcessed` — 图片无
   - 图片 prompt 返回 `decision`, `riskLevel`, `compensation` — 文本无
   - Category: 文本用英文 (`protein/grain/veggie`)，图片用中文 (`主食/蔬菜/蛋白质`)

2. **字段与食物库不对齐**：
   - LLM `quality` ↔ 食物库 `qualityScore`
   - LLM `satiety` ↔ 食物库 `satietyScore`
   - LLM 返回 per-serving 营养 ↔ 食物库 per-100g
   - 食物库有 `glycemicLoad`, `transFat`, `cholesterol`, `purine` 等字段，prompt 未要求

3. **i18n 碎片化**：
   - `decision-labels.ts` (84KB) — 巨型单文件
   - `coach-i18n.ts` (30KB) — 独立体系，locale 格式不同 (`zh` vs `zh-CN`)
   - `explainer-labels.ts` (7KB) — 又一个独立文件
   - 三套系统共存增加维护成本

4. **废弃代码未清理**：`scoring.service.ts`, `decision-classifier.service.ts`

---

## 二、V4.5 优化目标（8 项）

| #   | 目标                                                                     | 对应层 | 优先级 |
| --- | ------------------------------------------------------------------------ | ------ | ------ |
| 1   | **统一分析 prompt** — 文本/图片合并为统一字段结构，对齐食物库            | 分析   | 🔴 P0  |
| 2   | **prompt 字段对齐食物库** — category/nutrition/quality 统一编码          | 分析   | 🔴 P0  |
| 3   | **清理废弃代码** — 删除 deprecated 服务                                  | 全局   | 🟡 P1  |
| 4   | **i18n 整理** — decision-labels 按领域拆分子文件，coach-i18n locale 对齐 | 全局   | 🟡 P1  |
| 5   | **冲突可解释性增强** — 统一冲突检测 + 结构化输出                         | 决策   | 🟡 P1  |
| 6   | **替代方案优化** — 移除静态硬编码食物名，全部走推荐引擎                  | 决策   | 🟢 P2  |
| 7   | **教练层结构化** — coach 输出增加 actionPlan 结构                        | 教练   | 🟢 P2  |
| 8   | **类型安全增强** — 消除 `any` 类型，强类型食物库匹配                     | 全局   | 🟢 P2  |

---

## 三、统一分析 Prompt 设计

### 3.1 设计原则

- **一套 prompt 结构**：文本和图片共享相同的输出 JSON schema
- **字段名与食物库对齐**：`qualityScore` 而非 `quality`，`satietyScore` 而非 `satiety`
- **Category 统一为英文编码**：与 pipeline 一致
- **营养数据统一为 per-serving**：LLM 估算的是实际份量的营养（prompt 明确要求）
- **必须返回 `estimatedWeightGrams`** 和 `standardServingG`：无论文本还是图片
- **决策相关字段从 prompt 移除**：LLM 只做营养分析，决策由 pipeline 完成

### 3.2 统一输出 Schema

```typescript
// 统一 LLM 食物分析输出（文本/图片共用）
interface UnifiedFoodAnalysisOutput {
  foods: UnifiedParsedFood[];
  summary: string; // 一句话餐食特点总结
}

interface UnifiedParsedFood {
  // === 基础 ===
  name: string; // 食物名
  quantity: string; // 份量描述（"1碗", "2片"）
  estimatedWeightGrams: number; // 估算克重
  standardServingG: number; // 该食物标准一人份克数
  category: FoodCategory; // 统一英文编码

  // === 宏量营养（per serving）===
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number | null;
  sugar: number | null; // 新增：总糖
  addedSugar: number | null;
  saturatedFat: number | null;
  sodium: number | null;

  // === 微量营养（per serving）===
  vitaminA: number | null;
  vitaminC: number | null;
  calcium: number | null;
  iron: number | null;

  // === 健康指标 ===
  glycemicIndex: number | null; // 0-100
  isProcessed: boolean;
  processingLevel: 1 | 2 | 3 | 4; // NOVA 分级（新增）
  qualityScore: number; // 1-10（对齐食物库字段名）
  satietyScore: number; // 1-10（对齐食物库字段名）

  // === 安全 ===
  allergens: string[]; // Big-9 过敏原
  tags: string[];

  // === 元数据 ===
  confidence: number; // 0-1 识别信心
  estimated: boolean; // 是否为估算值
}

type FoodCategory =
  | 'protein'
  | 'grain'
  | 'veggie'
  | 'fruit'
  | 'dairy'
  | 'fat'
  | 'beverage'
  | 'snack'
  | 'composite'
  | 'condiment'
  | 'soup';
```

### 3.3 字段映射（LLM → 食物库）

| LLM 输出                 | 食物库字段            | 转换                                 |
| ------------------------ | --------------------- | ------------------------------------ |
| `qualityScore`           | `qualityScore`        | 直接对齐 ✅                          |
| `satietyScore`           | `satietyScore`        | 直接对齐 ✅                          |
| `processingLevel`        | `processingLevel`     | 直接对齐 ✅（新增）                  |
| `sugar`                  | `sugar`               | 直接对齐 ✅（新增）                  |
| `calories` (per serving) | `calories` (per 100g) | `value * 100 / estimatedWeightGrams` |

### 3.4 Prompt 模板结构

```
[SYSTEM]
你是专业营养分析助手。识别食物、估算份量和多维营养数据。
只返回纯 JSON，不要其他文字。

[SCHEMA] — 统一 JSON schema（见 3.2）

[RULES] — 通用估算规则
- 营养数据为实际份量（per serving），非 per 100g
- standardServingG = 该食物标准一人份克数（非 100）
- category 必须使用指定英文编码
- qualityScore/satietyScore 1-10 分制
- processingLevel: NOVA 1-4 分级
- allergens 只返回 Big-9

[GOAL_CONTEXT] — 可选：用户目标/预算/健康状况注入
（由 buildContextAwarePrompt 动态拼接）

[INPUT] — 文本描述 或 "请分析图中食物"
```

---

## 四、决策链路设计

```
用户输入（文本/图片）
    │
    ▼
┌─ 分析层 (Analyze) ─────────────────────────┐
│ 1. Prompt → LLM → UnifiedParsedFood[]       │
│ 2. 食物库匹配 + 营养校验                      │
│ 3. 聚合 NutritionTotals                      │
│ 4. 构建 UnifiedUserContext                    │
│ 5. 7维评分                                    │
│ 6. 上下文分析（macro slot + issues）          │
└─────────────────────┬───────────────────────┘
                      ▼
┌─ 决策层 (Decide) ──────────────────────────┐
│ 1. 3级判定 (recommend/caution/avoid)         │
│ 2. 4因子结构化评分                            │
│ 3. 冲突检测 + 结构化解释                      │
│ 4. 最优份量 + 下一餐建议                      │
│ 5. 替代方案（推荐引擎驱动）                   │
│ 6. Decision Summary                          │
└─────────────────────┬───────────────────────┘
                      ▼
┌─ 教练层 (Coach) ───────────────────────────┐
│ 1. 语气解析 (goalType × verdict → tone)      │
│ 2. 结构化教练输出:                            │
│    - 结论（吃/不吃/替代）                     │
│    - 原因（基于目标/摄入/健康）               │
│    - 行动建议（份量/搭配/时间）               │
│ 3. 信心诊断 + 证据包                         │
│ 4. 行为洞察                                   │
└─────────────────────────────────────────────┘
```

---

## 五、分阶段迭代计划

### Phase 1：分析层统一 + 代码清理

**目标**：统一 prompt 结构、对齐食物库字段、清理废弃代码

| 任务                        | 文件                                                   | 说明                                                                                    |
| --------------------------- | ------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 1.1 统一 prompt 模板        | `text-food-analysis.service.ts`                        | 重写 `TEXT_ANALYSIS_PROMPT`，使用统一 schema                                            |
| 1.2 图片 prompt 对齐        | `image-food-analysis.service.ts`                       | 重写 `BASE_PROMPT`，移除决策字段，使用统一 schema                                       |
| 1.3 ParsedFoodItem 字段更新 | `food-item.types.ts`                                   | `quality` → `qualityScore`, `satiety` → `satietyScore`, 新增 `sugar`, `processingLevel` |
| 1.4 映射函数更新            | `text-food-analysis.service.ts`                        | `toAnalyzedFoodItem`, `buildFromLibraryMatch` 适配新字段名                              |
| 1.5 图片结果适配            | `image-food-analysis.service.ts`                       | 解析逻辑适配统一 schema                                                                 |
| 1.6 Category 统一           | 两个 analysis service                                  | 图片 prompt category 改为英文编码                                                       |
| 1.7 删除废弃文件            | `scoring.service.ts`, `decision-classifier.service.ts` | 清理已标记 deprecated 的文件                                                            |
| 1.8 tsc 验证                | —                                                      | 确保 0 errors                                                                           |

**风险控制**：

- `quality` → `qualityScore` 是破坏性重命名，需全局搜索所有引用
- 图片 prompt 移除决策字段后，上层消费图片结果的代码需同步调整
- 新增字段均为可选（`?:`），不破坏现有 API

### Phase 2：决策层增强 + 替代方案优化

**目标**：冲突可解释性增强、替代方案全面走推荐引擎、i18n 整理

| 任务                       | 文件                                | 说明                                                                                                 |
| -------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 2.1 冲突检测统一           | `decision-engine.service.ts`        | 将分散的冲突检测逻辑归集为结构化 `ConflictReport`                                                    |
| 2.2 替代方案去硬编码       | `alternative-food-rules.ts`         | 移除硬编码食物名列表，用 category+tag 约束替代                                                       |
| 2.3 替代方案引擎优先       | `alternative-suggestion.service.ts` | 静态规则降为最低优先级 fallback；引擎失败时才启用                                                    |
| 2.4 i18n 拆分              | `decision-labels.ts`                | 按领域拆为 `labels-score.ts`, `labels-decision.ts`, `labels-coach.ts`, `labels-evidence.ts` + barrel |
| 2.5 coach-i18n locale 对齐 | `coach-i18n.ts`                     | `CoachLocale` 统一为 `Locale` 类型，消除 `toCoachLocale` 转换                                        |
| 2.6 tsc 验证               | —                                   | 确保 0 errors                                                                                        |

### Phase 3：教练层优化 + 国际化

**目标**：教练输出结构化、语气个性化、i18n 完善

| 任务                         | 文件                                           | 说明                                           |
| ---------------------------- | ---------------------------------------------- | ---------------------------------------------- |
| 3.1 教练输出结构增强         | `decision-coach.service.ts`                    | 确保输出包含：结论 + 原因 + 行动建议三段式结构 |
| 3.2 行为洞察增强             | `coach-insight.service.ts`                     | 丰富 trend/timing insight 生成逻辑             |
| 3.3 explainer-labels 整合    | `explainer-labels.ts` → `decision-labels` 体系 | 消除独立 i18n 文件，统一到 cl()                |
| 3.4 coach-i18n 缺失 key 补全 | `coach-i18n.ts`                                | 审计所有 fallback-to-key 场景，补全三语翻译    |
| 3.5 image prompt 国际化      | `image-food-analysis.service.ts`               | prompt 角色描述和规则说明支持 locale 切换      |
| 3.6 tsc 验证                 | —                                              | 确保 0 errors                                  |

---

## 六、API 能力设计

### 6.1 现有可复用

| 能力         | 当前入口                                              | 状态                    |
| ------------ | ----------------------------------------------------- | ----------------------- |
| 文本食物分析 | `TextFoodAnalysisService.analyze()`                   | ✅ 可用，待 prompt 优化 |
| 图片食物分析 | `ImageFoodAnalysisService.analyze()`                  | ✅ 可用，待 prompt 对齐 |
| 决策判断     | `AnalysisPipelineService.execute()`                   | ✅ 完备                 |
| 替代方案     | `AlternativeSuggestionService.generateAlternatives()` | ✅ 已接推荐引擎         |
| 教练输出     | `DecisionCoachService.generateCoachingExplanation()`  | ✅ 可用，待结构增强     |

### 6.2 需增强的能力（不新增模块/接口）

| 能力           | 增强方式                                         |
| -------------- | ------------------------------------------------ |
| 统一食物分析   | 文本/图片共享 prompt schema + 解析逻辑           |
| 冲突结构化解释 | `DecisionEngineService` 输出 `ConflictReport`    |
| 教练三段式输出 | `CoachingExplanation` 增加 `actionPlan` 可选字段 |

---

## 七、数据结构增强（允许范围）

### 7.1 `AnalyzedFoodItem` 字段变更

```typescript
// V4.5 变更（向后兼容）
interface AnalyzedFoodItem {
  // 重命名（旧字段保留为 deprecated alias）
  qualityScore?: number; // 原 quality
  satietyScore?: number; // 原 satiety

  // 新增可选字段
  sugar?: number; // 总糖 (g)
  processingLevel?: number; // NOVA 1-4
  confidence?: number; // 0-1 识别信心

  // 保留旧字段（deprecated，过渡期兼容）
  quality?: number; // @deprecated → qualityScore
  satiety?: number; // @deprecated → satietyScore
}
```

### 7.2 `CoachingExplanation` 增强

```typescript
interface CoachingExplanation {
  // 现有字段保留...

  // V4.5 新增（可选）
  actionPlan?: {
    conclusion: string; // 结论：吃/不吃/替代
    reasons: string[]; // 原因列表
    actions: string[]; // 行动建议列表
  };
}
```

---

## 八、约束与风险

### 8.1 禁止修改范围

- ❌ 推荐系统（只读调用）
- ❌ 用户画像系统（只读调用）
- ❌ 订阅/商业化逻辑
- ❌ 数据库字段
- ❌ 新增模块

### 8.2 向后兼容策略

- 所有新增字段为可选（`?:`）
- 重命名字段保留旧名作为 deprecated alias
- `quality` / `satiety` 旧字段在 `toAnalyzedFoodItem` 中双写（新旧都赋值）
- API 输出结构不变，只增不删

### 8.3 风险点

| 风险                               | 缓解                                                           |
| ---------------------------------- | -------------------------------------------------------------- |
| prompt 变更导致 LLM 输出格式不稳定 | 解析层增加 fallback：新字段名优先，旧字段名兜底                |
| 图片 prompt 移除决策字段影响上游   | 确认图片分析结果消费链路，确保决策由 pipeline 而非 prompt 生成 |
| i18n 拆分导致 import 路径变更      | barrel 文件统一 re-export，外部 import 路径不变                |
