# 饮食决策 + AI教练系统 V4.8 升级设计文档

> 版本：V4.8 | 基线：V4.7 | 不兼容旧代码

---

## 一、当前系统能力分析

### 1.1 V4.7 已完成的优化

| 编号 | 优化项 | 状态 |
|------|--------|------|
| P1.1 | Prompt Schema 共享（`analysis-prompt-schema.ts`） | ✅ 完成 |
| P1.2 | Prompt 多语言支持（`buildBasePrompt(mode, locale)`） | ✅ 完成 |
| P1.3 | `ScoringFoodItem` 改为 `Pick<AnalyzedFoodItem, ...>` | ✅ 完成 |
| P2.1 | `decision-checks.ts` 拆分为 4 个子文件 + 聚合入口 | ✅ 完成 |
| P2.4 | `buildConflictReport` 提取为独立文件 | ✅ 完成 |

### 1.2 V4.7 未充分解决的遗留问题

| 层级 | 问题 | 影响 | V4.8 优先级 |
|------|------|------|-------------|
| **分析** | `image-food-analysis.service.ts` 仍有 `legacyFoodsToAnalyzed` 桥接适配器，`executeAnalysis()` 返回旧 `AnalysisResult` 格式再转换 | 多余的类型转换层，增加复杂度 | P1 |
| **分析** | `image-food-analysis.service.ts` 中 `quality→qualityScore` / `satiety→satietyScore` 字段重命名仍在 `parseAnalysisResult()` | LLM 旧字段名兼容逻辑应清除 | P1 |
| **分析** | `image-food-analysis.service.ts` 中 `totalCalories` 顶层回退逻辑 | 旧 prompt 格式遗留，当前 prompt 已不会产生此格式 | P1 |
| **分析** | `text-food-analysis.service.ts` 第 928 行 LLM user message 为硬编码中文，未使用共享 prompt schema | 多语言 LLM 效果下降 | P1 |
| **分析** | `ParsedFoodItem` 与 `AnalyzedFoodItem` 高度重复，`libraryMatch` 为 `any` 类型 | 类型安全差，维护成本高 | P2 |
| **分析** | `image-food-analysis.service.ts` 中 `CATEGORY_DEFAULTS` 含内联中文 key（`蛋白质`/`蔬菜`等） | 旧数据兼容，应移除 | P2 |
| **分析** | `image-food-analysis.service.ts` 中 6 处用户可见中文字符串（错误消息、替代原因等）未 i18n | 非中文用户体验差 | P2 |
| **决策** | `alternative-suggestion.service.ts` 静态规则中仍有品类硬编码逻辑 | 推荐引擎已集成，静态规则应精简 | P2 |
| **教练** | `decision-coach.service.ts` 的 `enrichWithStructuredFactors` 中 factor-type 映射硬编码 | 可维护性差 | P3 |
| **全局** | Logger 消息全部中文（17处），虽不影响用户但影响国际化运维 | 运维可读性差 | P3 |

---

## 二、V4.8 优化目标

### 核心原则

- **不兼容旧代码**，以最优标准迭代
- **不增加新模块**，只在现有模块内重构
- **不增加数据库字段**
- 推荐系统/用户画像系统**只读**

### 优化目标

**Phase 1（图片分析清洗 + 文本分析优化 + 统一类型）**

1. **P1.1** 图片分析链路直出 `AnalyzedFoodItem[]`：移除 `legacyFoodsToAnalyzed` 桥接，`executeAnalysis()` 直接返回 V61 格式，删除旧 `AnalysisResult` 依赖
2. **P1.2** 图片分析 `parseAnalysisResult()` 清除旧字段兼容：移除 `quality→qualityScore` / `satiety→satietyScore` 重命名、`totalCalories` 顶层回退
3. **P1.3** 文本分析 LLM user message 国际化：第 928 行 `分析以下食物描述：` 迁移到共享 prompt schema
4. **P1.4** `ParsedFoodItem` 统一：改为 `AnalyzedFoodItem & { libraryMatch?: FoodLibraryEntity }` 的类型别名，消除重复定义
5. **P1.5** 图片分析 `CATEGORY_DEFAULTS` 中文 key 移除，统一使用英文 category code
6. **P1.6** tsc 验证

**Phase 2（i18n 完善 + 替代方案优化 + 可解释性增强）**

1. **P2.1** 图片分析 6 处用户可见中文字符串迁移到 `t()` / `cl()`
2. **P2.2** `alternative-suggestion.service.ts` 静态规则精简：移除与推荐引擎功能重叠的品类硬编码，保留仅作为引擎 fallback 的最小规则集
3. **P2.3** 决策解释增强：`decision-explainer.service.ts` 中饮食冲突解释细化，为每类冲突（过敏/限制/健康）生成独立解释节点
4. **P2.4** `analysis-pipeline.service.ts` 的 `toDecisionFoodItems` 简化：利用 `ScoringFoodItem` 已为 `Pick` 子集的事实，用 spread + pick 模式替代手动映射
5. **P2.5** tsc 验证

**Phase 3（教练优化 + logger 国际化 + 全局审计）**

1. **P3.1** `decision-coach.service.ts` 的 `enrichWithStructuredFactors` 优化：factor-type 映射提取为 `FACTOR_TYPE_CONFIG` 常量
2. **P3.2** Decision 模块 17 处 logger 中文消息改为英文（国际化运维标准）
3. **P3.3** `image-food-analysis.service.ts` logger 中文消息改为英文
4. **P3.4** `text-food-analysis.service.ts` logger 中文消息改为英文
5. **P3.5** tsc 验证

---

## 三、决策链路设计

```
用户输入（文本/图片）
  ↓
[食物识别] text-food-analysis / image-food-analysis
  ↓ AnalyzedFoodItem[]  ← V4.8 P1.1: 图片链路直出，无桥接
  │                      ← V4.8 P1.4: ParsedFoodItem = AnalyzedFoodItem + libraryMatch
  ↓
[共享 Prompt Schema] analysis-prompt-schema.ts
  │ ← V4.8 P1.3: 文本 LLM user message 国际化
  ↓
[营养汇总] nutrition-aggregator → NutritionTotals
  ↓
[用户上下文] user-context-builder → UnifiedUserContext
  ↓
[评分] food-scoring.service → AnalysisScore
  ↓
[上下文分析] analysis-context.service → ContextualAnalysis
  ↓
[决策判断] food-decision.service → DecisionOutput
  ├── decision-engine.service (核心决策)
  ├── decision-checks/ (已拆分 4 子文件)
  ├── conflict-report-builder.ts (已独立)
  ├── alternative-suggestion.service ← V4.8 P2.2: 精简静态规则
  └── decision-explainer.service ← V4.8 P2.3: 冲突解释细化
  ↓
[AI教练] coach/
  ├── decision-coach.service ← V4.8 P3.1: factor 配置化
  ├── coach-insight.service
  └── coach-i18n.ts
  ↓
FoodAnalysisResultV61（最终输出）
```

---

## 四、数据结构优化

### 4.1 图片分析类型统一（P1.1）

**Before (V4.7)**:
```
executeAnalysis() → AnalysisResult (legacy)
  → legacyFoodsToAnalyzed() → AnalyzedFoodItem[]
  → analyzeToV61() → FoodAnalysisResultV61
```

**After (V4.8)**:
```
executeAnalysis() → AnalyzedFoodItem[]
  → (直接传入 pipeline) → FoodAnalysisResultV61
```

### 4.2 ParsedFoodItem 统一（P1.4）

**Before**: `ParsedFoodItem` 独立接口，~90 行定义，与 `AnalyzedFoodItem` 高度重复

**After**:
```typescript
import type { FoodLibraryEntity } from '../../food/food.types';

/** 文本分析内部食物项 = 统一分析项 + 食物库匹配引用 */
export type ParsedFoodItem = AnalyzedFoodItem & {
  /** 食物库匹配结果（内部使用，不暴露到最终输出） */
  libraryMatch?: FoodLibraryEntity;
};
```

---

## 五、分阶段实施计划

### Phase 1：分析清洗 + 类型统一（6 个目标）

| 编号 | 文件 | 改动 |
|------|------|------|
| P1.1 | `image-food-analysis.service.ts` | 移除 `legacyFoodsToAnalyzed`，`executeAnalysis` 直接产出 `AnalyzedFoodItem[]`，`analyzeToV61` 不再做格式转换 |
| P1.2 | `image-food-analysis.service.ts` | `parseAnalysisResult` 移除 `quality→qualityScore` 重命名、`totalCalories` 回退 |
| P1.3 | `analysis-prompt-schema.ts` + `text-food-analysis.service.ts` | 新增 `USER_MESSAGE_TEMPLATE` 三语模板，第 928 行改用共享模板 |
| P1.4 | `text-food-analysis.service.ts` | `ParsedFoodItem` 改为 `AnalyzedFoodItem & { libraryMatch }` 类型别名，删除重复字段定义 |
| P1.5 | `image-food-analysis.service.ts` | `CATEGORY_DEFAULTS` 中文 key 替换为英文 category code |
| P1.6 | — | tsc 0 errors |

### Phase 2：i18n + 替代方案 + 可解释性（5 个目标）

| 编号 | 文件 | 改动 |
|------|------|------|
| P2.1 | `image-food-analysis.service.ts` | 6 处用户可见中文字符串迁移到 `t()` |
| P2.2 | `alternative-suggestion.service.ts` | 移除与推荐引擎重叠的品类硬编码，精简为最小 fallback 规则集 |
| P2.3 | `decision-explainer.service.ts` | 冲突解释细化：per-conflict-type 解释节点 |
| P2.4 | `analysis-pipeline.service.ts` | `toDecisionFoodItems` 用 spread + pick 替代手动字段映射 |
| P2.5 | — | tsc 0 errors |

### Phase 3：教练 + logger 国际化 + 审计（5 个目标）

| 编号 | 文件 | 改动 |
|------|------|------|
| P3.1 | `decision-coach.service.ts` | `enrichWithStructuredFactors` factor-type 映射提取为 `FACTOR_TYPE_CONFIG` 常量 |
| P3.2 | decision 模块全局 (5 files) | 17 处 logger 中文消息 → 英文 |
| P3.3 | `image-food-analysis.service.ts` | logger 中文消息 → 英文 |
| P3.4 | `text-food-analysis.service.ts` | logger 中文消息 → 英文 |
| P3.5 | — | tsc 0 errors |

---

## 六、禁止修改范围确认

- ❌ 推荐系统：只读 `SubstitutionService` / `RecommendationEngineService`
- ❌ 用户画像系统：只读 `UnifiedUserContext`
- ❌ 订阅/商业化逻辑
- ❌ 不增加数据库字段
- ❌ 不增加新模块
- ❌ `text-food-analysis.service.ts` 中文本 NLP 逻辑（中文分词/停用词/单位识别）暂不修改，这些是中文市场核心功能

---

## 七、i18n 系统约束

- `t(key,vars,locale)` — 用户可见消息（错误提示等）
- `cl(key,locale)` — decision 模块标签
- `ci(key,locale,vars)` — coach 专用
- Logger 消息统一使用英文（V4.8 新规范）
