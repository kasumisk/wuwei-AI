# 饮食决策 + AI教练系统 V4.9 升级设计文档

> 版本：V4.9 | 基线：V4.8 | 不兼容旧代码

---

## 一、V4.8 遗留问题分析

### 1.1 Prompt ↔ 食物库数据基准不一致（Critical）

| 维度             | LLM Prompt (当前)                            | Foods DB (per 100g)         | 影响                                                                                |
| ---------------- | -------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| **营养数据基准** | "per serving" — LLM 返回的是实际份量的营养值 | per 100g 可食部分           | 食物库匹配后无法直接对比/验证 LLM 数据；food enrichment pipeline 也用 per-100g 基准 |
| **下游换算**     | 无统一换算逻辑                               | `standardServingG` 字段存在 | aggregator 直接累加 per-serving 值，无法利用 DB 的 per-100g 数据做校准              |

### 1.2 Category 枚举不统一

| Prompt 分类 (11) | DB 分类 (14)                               | 问题                                            |
| ---------------- | ------------------------------------------ | ----------------------------------------------- |
| `protein`        | `meat`, `seafood`, `egg`, `legume`         | prompt 用一个笼统的 `protein` 覆盖 4 个 DB 分类 |
| `veggie`         | `vegetable`                                | 命名不同                                        |
| `composite`      | 无对应                                     | DB 没有 composite 分类                          |
| `soup`           | 无对应                                     | DB 没有 soup 分类                               |
| 无对应           | `nut`, `egg`, `legume`, `seafood`, `other` | prompt 缺少这些分类                             |

### 1.3 AnalyzedFoodItem 注释误导

`food-item.types.ts` 中注释标注 `// === 宏量营养素（per serving）===`，但 V4.9 将改为 per-100g 基准，注释需同步更新。

### 1.4 nutrition-aggregator 缺少 per-100g → per-serving 换算

当前 `aggregateNutrition()` 直接累加 `f.calories`、`f.protein` 等字段。V4.9 中这些字段变为 per-100g 值，需要先乘以 `estimatedWeightGrams / 100` 再累加。

### 1.5 nutrition-sanity-validator CATEGORY_MACRO_RATIO 缺少新分类

当前只有 9 个分类的 macro ratio（protein/grain/veggie/fruit/dairy/beverage/snack/fat/composite）。V4.9 统一分类后需要补充 meat/seafood/egg/legume/nut/other 的 ratio。

### 1.6 i18n 分散

当前有 4 套 i18n 系统：

- `analysis-prompt-schema.ts` 内联常量（GOAL_FOCUS_BLOCKS, HEALTH_CONDITION_INSTRUCTIONS 等）
- `decision-labels.ts` (cl) + 3 个 locale 子文件
- `explainer-labels.ts` (chainLabel)
- `coach-i18n.ts` (ci)

Prompt schema 内的 i18n 块无法被其他模块复用。

---

## 二、V4.9 优化目标

### 核心原则

- **不兼容旧代码**，以最优标准迭代
- **不增加新模块**，只在现有模块内重构
- **不增加数据库字段**
- 推荐系统/用户画像系统**只读**
- `text-food-analysis.service.ts` 中文 NLP 逻辑不修改

### Phase 1：Prompt Per-100g 对齐 + Category 统一 + 类型修正（6 个目标）

1. **P1.1** LLM Prompt 营养数据基准改为 per-100g：修改 `FOOD_JSON_SCHEMA` 和 `ESTIMATION_RULES`，要求 LLM 返回 per-100g 营养值 + `estimatedWeightGrams`（实际食用克数），per-serving 值由下游计算
2. **P1.2** Category 枚举统一为 DB 14 分类：prompt category 改为 `grain/vegetable/fruit/meat/seafood/dairy/egg/legume/nut/fat/beverage/condiment/snack/other`，移除 `protein/veggie/composite/soup`
3. **P1.3** `AnalyzedFoodItem` 类型更新：注释改为 per-100g，新增 `caloriesPerServing`/`proteinPerServing`/`fatPerServing`/`carbsPerServing` 计算属性说明（或由 aggregator 负责换算）
4. **P1.4** `nutrition-aggregator.ts` 增加 per-100g → per-serving 换算：`aggregateNutrition()` 使用 `estimatedWeightGrams` 计算实际摄入量
5. **P1.5** `nutrition-sanity-validator.ts` CATEGORY_MACRO_RATIO 补全：新增 meat/seafood/egg/legume/nut/other 分类的默认宏量比例，移除旧 protein/veggie/composite 映射
6. **P1.6** tsc 0 errors

### Phase 2：评分适配 + 替代方案优化 + 上下文分析改进（5 个目标）

1. **P2.1** `food-scoring.service.ts` 适配 per-100g：评分输入 `ScoringFoodItem` 需要 per-serving 值，确保 pipeline 传入的是换算后的值
2. **P2.2** `food-decision.service.ts` 适配：`DecisionFoodItem` / `toDecisionFoodItems()` 确保使用换算后的 per-serving 值
3. **P2.3** `alternative-suggestion.service.ts` 优化：替代建议使用 DB 分类匹配，消除旧 prompt 分类硬编码
4. **P2.4** `analysis-context.service.ts` 改进：上下文分析中的 macro progress 使用换算后的值
5. **P2.5** tsc 0 errors

### Phase 3：Coach 优化 + i18n 整合 + 可解释性增强（6 个目标）

1. **P3.1** Coach prompt 适配：教练系统中引用的营养数据确保是 per-serving 换算后的值
2. **P3.2** Prompt schema i18n 块提取：将 `GOAL_FOCUS_BLOCKS`、`HEALTH_CONDITION_INSTRUCTIONS`、`PRIORITY_LABELS` 等从 `analysis-prompt-schema.ts` 提取到独立的 i18n 文件，可被其他模块复用
3. **P3.3** 决策解释增强：explainer 中显示 per-100g 基准数据 + 实际摄入量的双重展示，增强透明度
4. **P3.4** Category 映射可解释性：当 LLM 返回的 category 与库匹配结果不一致时，在 confidence diagnostics 中记录
5. **P3.5** ESTIMATION_RULES 增加 per-100g 校准指引：引导 LLM 参照常见食物数据库（USDA/中国食物成分表）的 per-100g 标准值
6. **P3.6** tsc 0 errors

---

## 三、关键设计决策

### 3.1 Per-100g 数据流

```
LLM 返回
  ├── calories (per 100g)
  ├── protein (per 100g)
  ├── fat (per 100g)
  ├── carbs (per 100g)
  ├── estimatedWeightGrams (用户实际食用克数)
  └── standardServingG (标准一人份克数)
  ↓
[nutrition-aggregator] 换算
  actualCalories = calories × estimatedWeightGrams / 100
  actualProtein = protein × estimatedWeightGrams / 100
  ...
  ↓
NutritionTotals (per-serving 累加值)
  ↓
[food-scoring] 评分（使用 per-serving 值）
  ↓
[food-decision] 决策（使用 per-serving 值）
```

### 3.2 AnalyzedFoodItem 字段语义变更

**Before (V4.8)**:

```typescript
calories: number;  // per serving
protein?: number;  // per serving
```

**After (V4.9)**:

```typescript
calories: number;  // per 100g（与食物库对齐）
protein?: number;  // per 100g
// estimatedWeightGrams 用于计算实际摄入
// 下游需要 per-serving 值时由 aggregator 换算
```

### 3.3 Category 统一映射

| 新统一分类 (14) | 原 Prompt 分类     | 映射说明     |
| --------------- | ------------------ | ------------ |
| `grain`         | `grain`            | 不变         |
| `vegetable`     | `veggie`           | 重命名       |
| `fruit`         | `fruit`            | 不变         |
| `meat`          | `protein`(部分)    | 拆分：畜禽肉 |
| `seafood`       | `protein`(部分)    | 拆分：鱼虾贝 |
| `dairy`         | `dairy`            | 不变         |
| `egg`           | `protein`(部分)    | 拆分：蛋类   |
| `legume`        | `protein`(部分)    | 拆分：豆类   |
| `nut`           | 无                 | 新增         |
| `fat`           | `fat`              | 不变         |
| `beverage`      | `beverage`         | 不变         |
| `condiment`     | `condiment`        | 不变         |
| `snack`         | `snack`            | 不变         |
| `other`         | `composite`/`soup` | 合并为 other |

### 3.4 CATEGORY_MACRO_RATIO 更新

```typescript
const CATEGORY_MACRO_RATIO = {
  grain: { proteinRatio: 0.1, fatRatio: 0.08, carbsRatio: 0.82 },
  vegetable: { proteinRatio: 0.2, fatRatio: 0.1, carbsRatio: 0.7 },
  fruit: { proteinRatio: 0.06, fatRatio: 0.04, carbsRatio: 0.9 },
  meat: { proteinRatio: 0.42, fatRatio: 0.3, carbsRatio: 0.0 }, // 畜禽肉
  seafood: { proteinRatio: 0.5, fatRatio: 0.2, carbsRatio: 0.0 }, // 鱼虾
  dairy: { proteinRatio: 0.22, fatRatio: 0.48, carbsRatio: 0.3 },
  egg: { proteinRatio: 0.35, fatRatio: 0.6, carbsRatio: 0.05 }, // 蛋类
  legume: { proteinRatio: 0.3, fatRatio: 0.15, carbsRatio: 0.55 }, // 豆类
  nut: { proteinRatio: 0.12, fatRatio: 0.72, carbsRatio: 0.16 }, // 坚果
  fat: { proteinRatio: 0.0, fatRatio: 1.0, carbsRatio: 0.0 },
  beverage: { proteinRatio: 0.04, fatRatio: 0.0, carbsRatio: 0.96 },
  condiment: { proteinRatio: 0.1, fatRatio: 0.3, carbsRatio: 0.6 },
  snack: { proteinRatio: 0.08, fatRatio: 0.38, carbsRatio: 0.54 },
  other: { proteinRatio: 0.15, fatRatio: 0.3, carbsRatio: 0.55 }, // 默认比例
};
```

---

## 四、决策链路设计（V4.9）

```
用户输入（文本/图片）
  ↓
[食物识别] text-food-analysis / image-food-analysis
  ↓ AnalyzedFoodItem[] (per-100g 基准)  ← V4.9 P1.1: 营养值为 per-100g
  │                                       ← V4.9 P1.2: category 统一为 DB 14 分类
  ↓
[共享 Prompt Schema] analysis-prompt-schema.ts
  │ ← V4.9 P1.1: 要求 LLM 返回 per-100g 值
  │ ← V4.9 P3.5: 增加 per-100g 校准指引
  ↓
[营养换算 + 汇总] nutrition-aggregator
  │ ← V4.9 P1.4: per-100g × estimatedWeightGrams / 100 → NutritionTotals
  ↓
[合理性校验] nutrition-sanity-validator
  │ ← V4.9 P1.5: CATEGORY_MACRO_RATIO 更新为 14 分类
  ↓
[用户上下文] user-context-builder → UnifiedUserContext
  ↓
[评分] food-scoring.service → AnalysisScore
  │ ← V4.9 P2.1: 输入为换算后的 per-serving 值
  ↓
[上下文分析] analysis-context.service → ContextualAnalysis
  │ ← V4.9 P2.4: macro progress 使用换算后值
  ↓
[决策判断] food-decision.service → DecisionOutput
  ├── decision-engine.service
  ├── decision-checks/
  ├── alternative-suggestion.service ← V4.9 P2.3: 使用 DB 14 分类匹配
  └── decision-explainer.service ← V4.9 P3.3: 双重展示
  ↓
[AI教练] coach/
  ├── decision-coach.service ← V4.9 P3.1: per-serving 换算值
  └── coach-i18n.ts
  ↓
FoodAnalysisResultV61（最终输出）
```

---

## 五、分阶段实施计划

### Phase 1：Prompt Per-100g + Category + 类型（6 个目标）

| 编号 | 文件                            | 改动                                                                                                                                          |
| ---- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.1 | `analysis-prompt-schema.ts`     | `FOOD_JSON_SCHEMA` 三语版本中营养字段注释改为 per-100g；`ESTIMATION_RULES` 规则改为"所有营养数据为 per 100g 可食部分"；新增 per-100g 校准说明 |
| P1.2 | `analysis-prompt-schema.ts`     | category 枚举改为 DB 14 分类 `grain/vegetable/fruit/meat/seafood/dairy/egg/legume/nut/fat/beverage/condiment/snack/other`                     |
| P1.3 | `food-item.types.ts`            | 注释更新为 per-100g；确认 `estimatedWeightGrams` 已存在                                                                                       |
| P1.4 | `nutrition-aggregator.ts`       | `aggregateNutrition()` 增加 per-100g → per-serving 换算逻辑                                                                                   |
| P1.5 | `nutrition-sanity-validator.ts` | `CATEGORY_MACRO_RATIO` 更新为 14 分类                                                                                                         |
| P1.6 | —                               | tsc 0 errors                                                                                                                                  |

### Phase 2：评分/决策适配 + 替代方案（5 个目标）

| 编号 | 文件                                                              | 改动                                                                                                      |
| ---- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| P2.1 | `food-scoring.service.ts`                                         | 确认 ScoringFoodItem 来源是换算后值；如果 pipeline 传入 per-100g 原始值则需要在 toScoringFoodItems 中换算 |
| P2.2 | `food-decision.service.ts` + `analysis-pipeline.service.ts`       | `toDecisionFoodItems()` 适配换算后值                                                                      |
| P2.3 | `alternative-suggestion.service.ts` + `alternative-food-rules.ts` | category 匹配逻辑更新为 DB 14 分类                                                                        |
| P2.4 | `analysis-context.service.ts`                                     | macro progress 确认使用 aggregator 换算后的 NutritionTotals                                               |
| P2.5 | —                                                                 | tsc 0 errors                                                                                              |

### Phase 3：Coach + i18n + 可解释性（6 个目标）

| 编号 | 文件                                                                  | 改动                                                                                        |
| ---- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| P3.1 | `decision-coach.service.ts`                                           | 确认教练使用的营养数据是 per-serving 换算后值                                               |
| P3.2 | 新文件 `decision/i18n/prompt-labels.ts` + `analysis-prompt-schema.ts` | 提取 GOAL_FOCUS_BLOCKS 等 i18n 块到独立文件，prompt schema 导入使用                         |
| P3.3 | `decision-explainer.service.ts`                                       | 决策链路中增加"per-100g 基准 + 实际摄入"双重展示                                            |
| P3.4 | `confidence-diagnostics.service.ts`                                   | 增加 category mismatch 检测（LLM vs library match）                                         |
| P3.5 | `analysis-prompt-schema.ts`                                           | `ESTIMATION_RULES` 增加 per-100g 校准参考（如"参照 USDA/中国食物成分表的 per-100g 标准值"） |
| P3.6 | —                                                                     | tsc 0 errors                                                                                |

---

## 六、风险与缓解

### 6.1 LLM 输出质量风险

**风险**：LLM 习惯输出 per-serving 数据，切换到 per-100g 可能导致初期准确率下降。

**缓解**：

- `ESTIMATION_RULES` 中明确给出 per-100g 参考示例（如"白米饭 per 100g: 116kcal, protein 2.6g"）
- `nutrition-sanity-validator` 的热力学一致性校验仍然有效（per-100g 数据同样满足 P×4 + F×9 + C×4 ≈ Cal）
- 在 `ESTIMATION_RULES` 中增加 "estimatedWeightGrams 表示用户实际食用量（克），营养值 × estimatedWeightGrams / 100 = 实际摄入" 的明确说明

### 6.2 下游换算精度

**风险**：`estimatedWeightGrams` 为 0 或缺失时，换算会产生 0 值。

**缓解**：`aggregateNutrition()` 中增加 fallback：如果 `estimatedWeightGrams` 缺失，使用 `standardServingG`（默认 100g）。

### 6.3 Category 映射兼容性

**风险**：旧数据中可能存在使用旧 category 值（protein/veggie/composite/soup）的缓存。

**缓解**：

- `nutrition-sanity-validator` 的 `CATEGORY_MACRO_RATIO` 保留 `other` 作为 fallback
- `validateNutrition()` 中 category 查找失败时已使用 `DEFAULT_RATIO`

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
- `cl(key,locale)` — decision 模块标签
- `ci(key,locale,vars)` — coach 专用
- `chainLabel(key,vars,locale)` — 决策链路步骤标签
- Logger 消息统一使用英文
