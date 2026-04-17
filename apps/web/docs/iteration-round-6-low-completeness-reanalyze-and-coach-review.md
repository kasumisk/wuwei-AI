# Round 6: 低完整度重分析 + 分项复盘直连教练

> 日期: 2026-04-17
> 目标: 当分析完整度不足时，用户可立即采取行动（重分析或教练复盘），避免结果停留在“看完就结束”
> 范围: `analyze-page.tsx`（前端交互增强）

---

## Step 1：用户画像与档案评估

本轮不新增画像字段，继续复用现有画像体系：
- goal / activityLevel
- allergens / dietaryRestrictions / healthConditions

新增用户输入引导（行为层）：
- 低完整度时，优先引导补充“份量 + 做法”后重分析

API 是否改动：
- 本轮不改 API。
- 通过前端复盘 prompt 模板和上下文透传完成闭环。

---

## Step 2：核心用户流程（文字流程图）

```text
用户完成分析 -> 进入结果页
  -> 查看分析完整度面板
  -> 若完整度低/中：
      A. 点击“一键补全后重分析”（文字模式）
         -> 自动补充输入提示 -> 直接重新发起分析
      B. 点击“让教练做分项复盘”
         -> 注入完整度上下文 -> 跳转 coach 自动首问
  -> 获得可执行下一步（继续分析或立即行动）
```

---

## Step 3：页面结构设计（可落地）

涉及页面：
- `/analyze`（新增低完整度分流动作）
- `/coach`（复用自动首问机制）

页面功能与 API 映射：
- analyze
  - 功能: 一键重分析、分项复盘跳转
  - API: `POST /app/food/analyze/text|image`

- coach
  - 功能: 接收分项复盘 prompt 并输出可执行建议
  - API: `POST /app/coach/chat`

---

## Step 4：交互优化（关键）

核心不是 UI，而是“结果后的决策分流”：
- 以前：用户看到低完整度结果，不知道下一步
- 现在：面板直接给出两条明确路径
  - 重分析补数据
  - 教练复盘先决策

交互收益：
- 降低低质量结果带来的流失
- 提高分析链路的闭环率
- 提高教练入口质量（更聚焦“缺口”）

---

## Step 5：UI 结构设计（组件级）

在 `AnalyzePage` 新增：
- `buildEnhancedTextInput()`
  - 自动补齐“份量提示 + 做法提示”

- `buildCompletenessCoachPrompt()`
  - 生成“分析完整度复盘”专用 prompt

- `analyzeTextByContent()`
  - 抽象文字分析流程，支持普通分析与一键重分析复用

- `handleQuickReanalyze()`
  - 低完整度一键重分析入口

- `handleCoachCompletenessReview()`
  - 分项复盘直连教练入口

状态来源：
- 本地状态: textInput/result/editedFoods/resultQuality
- 会话状态: coach_analysis_context + coach_auto_prompt

---

## Step 6：API 缺口识别

当前可用，但建议后续补齐：
- 缺口 1: 后端未返回“缺口类型”
  - 建议补 `missingSignals[]`（missing_portion/missing_cooking_method/macro_coverage_low）

- 缺口 2: 无后端标准化复盘模板
  - 建议补 `reviewTemplateVersion`，便于 A/B 与灰度

- 缺口 3: 无重分析策略建议字段
  - 建议补 `reanalyzeHints[]`，前端无需硬编码中文提示

---

## Step 7：分阶段迭代

Phase 1（已完成）
- 输入质量引导
- 完整度面板展示

Phase 2（本轮完成）
- 低完整度一键重分析
- 分项复盘直连教练

Phase 3（下一轮建议）
- 低完整度结果默认高亮动作按钮（行为优先）
- 复盘后自动回填“重分析建议清单”到 analyze 输入区

---

## 本轮代码落点

- `apps/web/src/features/food-analysis/components/analyze-page.tsx`
- `apps/web/docs/iteration-round-6-low-completeness-reanalyze-and-coach-review.md`
