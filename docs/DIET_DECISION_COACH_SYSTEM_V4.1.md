# 饮食决策 + AI 教练系统 V4.1 — 解耦重构 + i18n 清理 + 可解释性增强

## 版本定位

V4.0 完成了画像深度集成、评分增强、替代方案排序、教练行为感知。V4.1 聚焦**架构解耦、代码质量、国际化**：

> 从"功能完备"到"结构清晰、可独立迭代、国际化就绪"

核心理念：**分析/评分/决策/教练四层解耦，消除硬编码中文，提升可解释性和可维护性。**

---

## 当前架构问题诊断

### 1. 四层耦合

| 问题                  | 现象                                                                                                                   | 影响     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- | -------- |
| 双 Coach 服务         | `analyze/decision-coach.service.ts`（V3.2 旧版）与 `coach/decision-coach.service.ts`（V3.3 新版）并存，module 中都注册 | 维护混淆 |
| Pipeline 阶段命名错位 | `runCoach()` 实际做的是证据包/置信度/准确度，不是教练                                                                  | 语义不清 |
| Decision 目录职责混杂 | `user-context-builder`（分析层）、`daily-macro-summary`（摘要层）、`decision-checks`（工具）全在 decision/ 下          | 难以定位 |
| 评分解释散落          | `food-scoring.service.ts` 的 `explainBreakdown()` 返回决策级解释                                                       | 层级穿越 |

### 2. 硬编码中文（100+ 处）

| 文件                                | 行数 | 类型              | 优先级         |
| ----------------------------------- | ---- | ----------------- | -------------- |
| decision-checks.ts                  | 102  | 条件匹配+用户面向 | 高             |
| scoring-dimensions.ts               | 95   | 维度标签          | 高             |
| alternative-food-rules.ts           | 91   | 食物规则映射      | 中（条件匹配） |
| food-scoring.service.ts             | 77   | 解释文案+日志     | 高             |
| coach-insight.service.ts            | 56   | 用户面向教练文案  | 高             |
| analysis-accuracy.service.ts        | 49   | 准确度说明        | 中             |
| decision-engine.service.ts          | 48   | 决策因素文案      | 高             |
| nutrition-issue-detector.service.ts | 45   | 问题描述          | 高             |
| decision-summary.service.ts         | 47   | 摘要文案          | 高             |
| contextual-modifier.service.ts      | 33   | 修正说明          | 中             |
| evidence-pack-builder.service.ts    | 20   | 证据文案          | 中             |
| confidence-diagnostics.service.ts   | 5    | 诊断说明          | 低             |

> 注：`types/analysis-result.types.ts`（301 行含中文）主要是 JSDoc 注释，不影响运行，优先级低。

### 3. 代码冗余

- `analyze/decision-coach.service.ts` 旧版 242 行与新版 345 行**功能完全重复**
- `food-decision.service.ts` 的委托方法（`computeDecision`/`extractDecisionFactors`/`calculateOptimalPortion`/`generateNextMealAdvice`）只是透传
- `decision-checks.ts` 中条件名用中文字符串做 `.includes()` 匹配（如 `'糖尿病'`），需要改为枚举或 i18n key

### 4. 旧 Coach 与新 Coach 并存

- `analyze/decision-coach.service.ts` — V3.2 旧版，硬编码英文，无 i18n，无 structuredDecision 支持
- `coach/decision-coach.service.ts` — V3.3 新版，完整 i18n，支持 structuredDecision + 行为洞察
- `decision.module.ts` 同时注册两者：
  ```ts
  import { DecisionCoachService } from './analyze/decision-coach.service';
  import { DecisionCoachService as DecisionCoachServiceV33 } from './coach/decision-coach.service';
  ```
- **V4.1 方案：删除旧版，统一使用新版**

---

## 设计原则

1. **不新增 provider** — `decision.module.ts` 保持 33 个 provider 不变（可删除旧版 Coach 减少到 32）
2. **不新增数据库字段** — 所有新增字段为可选 `?:`
3. **不修改外部模块** — 推荐系统、用户画像、订阅逻辑只读取
4. **不破坏现有 API** — 所有改动向后兼容
5. **三套 i18n 共存** — `t()`、`cl()`、`ci()` 不合并，但消除硬编码

---

## Phase 1: 解耦重构 — 分析/评分/决策分离

### P1.1 删除旧版 Coach

**目标**：消除双 Coach 问题

- 删除 `analyze/decision-coach.service.ts`（旧版 V3.2）
- 从 `decision.module.ts` 中移除旧版 `DecisionCoachService` 注册和导出
- 检查所有 import 引用，确保无处引用旧版
- Provider 数量 33 → 32

### P1.2 文件重组 — `user-context-builder` 归属修正

**目标**：`user-context-builder` 是分析层职责，不应在 decision/ 目录

- 将 `decision/user-context-builder.service.ts` 移至 `analyze/user-context-builder.service.ts`
- 更新所有 import 路径（pipeline, food-decision 等）
- Provider 注册不变（只是文件位置移动）

### P1.3 文件重组 — `daily-macro-summary` 归属修正

**目标**：每日宏量摘要是教练/摘要层职责

- 将 `decision/daily-macro-summary.service.ts` 移至 `coach/daily-macro-summary.service.ts`
- 更新所有 import 路径

### P1.4 文件重组 — `decision-checks.ts` 提取工具函数

**目标**：`decision-checks.ts` 是共享工具，不应在 decision/ 目录

- 将 `decision/decision-checks.ts` 移至 `config/decision-checks.ts`（与其他 config 工具并列）
- 更新所有 import 路径

### P1.5 Pipeline 阶段命名修正

**目标**：`runCoach()` 实际执行的是"后处理"（证据包、置信度、准确度），重命名为 `runPostProcess()`

- 重命名 `runCoach` → `runPostProcess`
- 重命名 `CoachStageResult` → `PostProcessStageResult`（类型定义在 types/ 中）
- 更新 `execute()` 中的调用

### P1.6 tsc 验证

- 运行 `npx tsc --noEmit --pretty`，确保零错误

---

## Phase 2: i18n 清理 — 消除硬编码中文

### P2.1 高优先级文件 i18n 化

**目标文件**（用户面向文案）：

| 文件                                  | 策略                                        |
| ------------------------------------- | ------------------------------------------- |
| `decision-checks.ts`                  | 中文条件名 → 枚举常量 + i18n label          |
| `food-scoring.service.ts`             | 解释文案 → `cl()`                           |
| `coach-insight.service.ts`            | 教练文案 → `ci()`                           |
| `decision-engine.service.ts`          | 因素文案 → `cl()`                           |
| `nutrition-issue-detector.service.ts` | 问题描述 → `cl()`                           |
| `decision-summary.service.ts`         | 摘要文案 → `cl()`（大部分已迁移，清理残留） |

### P2.2 中优先级文件 i18n 化

| 文件                               | 策略                                          |
| ---------------------------------- | --------------------------------------------- |
| `scoring-dimensions.ts`            | 维度标签已有 i18n 结构，清理残留              |
| `alternative-food-rules.ts`        | 食物规则中文名 → 保留（内部数据，不面向用户） |
| `contextual-modifier.service.ts`   | 修正文案 → `ci()`                             |
| `evidence-pack-builder.service.ts` | 证据文案 → `cl()`                             |
| `analysis-accuracy.service.ts`     | 准确度说明 → `cl()`                           |

### P2.3 `decision-checks.ts` 条件匹配重构

**当前问题**：用中文字符串做条件匹配

```ts
if (conditions.includes('糖尿病')) { ... }
if (conditions.includes('高血压')) { ... }
```

**解决方案**：

```ts
// 定义健康条件常量（中英文映射）
const HEALTH_CONDITION_KEYS = {
  diabetes: ['糖尿病', 'diabetes'],
  hypertension: ['高血压', 'hypertension'],
  heart_disease: ['心脏病', '心血管', 'heart_disease', 'cardiovascular'],
  gout: ['痛风', 'gout'],
  kidney_disease: ['肾病', 'kidney_disease'],
} as const;

function matchCondition(conditions: string[], key: keyof typeof HEALTH_CONDITION_KEYS): boolean {
  const aliases = HEALTH_CONDITION_KEYS[key];
  return conditions.some((c) => aliases.some((a) => c.includes(a)));
}
```

### P2.4 新增 i18n keys

在 `decision-labels.ts` 和 `coach-i18n.ts` 中补充所有新增的三语 keys。

### P2.5 tsc 验证

---

## Phase 3: 可解释性 + 教练增强 + 收尾

### P3.1 分析准确度返回优化

**目标**：准确度结果需要面向决策需求优化输出

- `AnalysisAccuracyService.assessFromFoods()` 返回值增加 `decisionImpact` 字段：
  ```ts
  decisionImpact?: {
    shouldDowngrade: boolean;
    reason?: string; // i18n
  }
  ```
- Pipeline 中 `applyAccuracyDowngrade()` 使用此字段替代硬编码逻辑

### P3.2 替代方案结合推荐引擎优化

**目标**：替代方案不能写死，需要结合推荐引擎

- `AlternativeSuggestionService` 中的静态 fallback 规则标记为 `source: 'static'`
- 推荐引擎返回的标记为 `source: 'engine'`
- 排序时 `engine` 优先级高于 `static`
- 检查 `alternative-food-rules.ts` 中的硬编码食物映射，减少写死数量

### P3.3 可解释性增强 — Decision Chain 增强

**目标**：每步 DecisionChainStep 增加 `confidence` + `snapshot`

- 确保所有 chain step 都填充 `confidence` 和 `snapshot` 字段
- `decision-explainer.service.ts` 已有框架，补全数据填充

### P3.4 教练 Coach 服务增强

**目标**：`CoachInsightService` 已有 V4.0 行为洞察，V4.1 增加可解释性

- 教练输出增加 `decisionRationale` 字段（从 `StructuredDecision.rationale` 提取）
- 教练输出增加 `confidenceNote`（从准确度和置信度推导）

### P3.5 Logger 日志中文清理（低优先级）

- `analysis-pipeline.service.ts` 等文件中的 Logger 消息（如 `分析记录持久化失败`）
- **策略**：Logger 消息保留中文不影响功能，但为一致性可逐步替换为英文 + context
- 本阶段标记但不强制处理

### P3.6 tsc 验证 + 全量回归

---

## 文件变更汇总

### 移动的文件

| 原路径                                     | 新路径                                    | 原因            |
| ------------------------------------------ | ----------------------------------------- | --------------- |
| `decision/user-context-builder.service.ts` | `analyze/user-context-builder.service.ts` | 分析层职责      |
| `decision/daily-macro-summary.service.ts`  | `coach/daily-macro-summary.service.ts`    | 教练/摘要层职责 |
| `decision/decision-checks.ts`              | `config/decision-checks.ts`               | 共享工具        |

### 删除的文件

| 文件                                | 原因                                                           |
| ----------------------------------- | -------------------------------------------------------------- |
| `analyze/decision-coach.service.ts` | 旧版 V3.2 Coach，被 `coach/decision-coach.service.ts` 完全替代 |

### 重命名

| 原名               | 新名                     | 位置                             |
| ------------------ | ------------------------ | -------------------------------- |
| `runCoach()`       | `runPostProcess()`       | `analysis-pipeline.service.ts`   |
| `CoachStageResult` | `PostProcessStageResult` | `types/analysis-result.types.ts` |

### 修改的文件（i18n 清理）

约 15 个文件，详见 Phase 2。

---

## 约束

- ❌ 不新增 NestJS Module
- ❌ 不新增 provider（只允许删除旧版 Coach 后减少 1 个）
- ❌ 不修改推荐系统/用户画像/订阅逻辑
- ❌ 不新增数据库字段
- ✅ 所有新增接口字段为 `?:` 可选
- ✅ 每阶段结束跑 `npx tsc --noEmit --pretty` 零错误
- ✅ i18n 三套共存：`t()`、`cl()`、`ci()`
