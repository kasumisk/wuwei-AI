# Round 3: 历史分析一键复盘到 AI 教练（交互闭环）

> 日期: 2026-04-17
> 目标: 让“分析→教练”链路从仅当次分析可用，升级为历史回看也可一键复盘
> 范围: `history-detail-page.tsx` + `coach/page.tsx`（复用已有自动首问机制）

---

## Step 1：用户画像与 API 评估

本轮主要目标是复盘链路，不新增画像必填字段。

仍然依赖的关键画像字段：
- `goal`
- `activityLevel`
- `weightKg/heightCm`
- `dietaryRestrictions/allergens/healthConditions`

API 是否需改动：
- 本轮不新增决策 API。
- 复用已有 `POST /app/coach/chat` 的 `analysisContext` 承载结构化上下文。

---

## Step 2：核心用户流程（文字流程图）

```text
用户进入历史详情页
  -> 查看该次分析结果（决策/评分/补救）
  -> 点击「用这条记录问 AI 教练」
    -> 前端构建结构化 analysisContext + 自动首问 prompt
    -> 写入 sessionStorage (coach_analysis_context + coach_auto_prompt)
    -> 跳转 /coach
  -> Coach 页自动读取并发送首问
  -> AI 返回复盘建议（关键问题 / 补救动作 / 下一餐计划）
```

---

## Step 3：页面结构（可落地）

### 页面与功能
- 历史详情页 `/history/[id]`
  - 新增“复盘到 AI 教练”行动卡
  - 负责组装该次分析上下文并跳转

- 教练页 `/coach`
  - 复用自动首问机制
  - 接收历史详情注入的上下文并发起会话

### 对应 API
- `GET /app/food/analysis/:analysisId`（已有）
- `POST /app/coach/chat`（已有，支持 `analysisContext`）

### 用户操作
- 历史详情页点击 1 个按钮即可触发复盘

---

## Step 4：交互优化（行为路径）

本轮优化点：
- 过去：历史详情只能看，无法导向后续行动
- 现在：历史详情可直接进入“可执行建议”链路

具体行为优化：
- 缩短路径：`历史详情 -> 教练输入 -> 发送` 变为 `历史详情 -> 一键复盘`
- 增强上下文：不仅发文本问题，还携带结构化字段（foods、宏量、评分分解、决策因子）

---

## Step 5：组件级结构

新增/调整组件职责：
- `HistoryDetailPage`
  - 新增 `buildCoachReviewPrompt(result)`
  - 新增 `handleCoachReview()`
  - 新增“复盘到 AI 教练”行动区

状态来源：
- 分析详情数据：`useAnalysisDetail(analysisId)`
- 会话上下文：`sessionStorage`（一次性）

---

## Step 6：API 缺口识别

当前可用，但仍存在改进空间：
- 缺口 1：缺少统一“复盘摘要”接口
  - 建议新增 `GET /app/food/analysis/:analysisId/review-brief`
  - 由后端统一输出复盘提示词与关键因子，减少前端拼装逻辑

- 缺口 2：首问模板目前主要由前端生成
  - 建议在后端形成模板版本化，便于 A/B 与灰度迭代

---

## Step 7：分阶段迭代

Phase 1（本轮已完成）
- 历史详情页一键复盘入口
- 上下文结构化透传
- 自动首问触发

Phase 2（体验增强）
- 在历史列表卡片增加“快速复盘”次级入口
- 教练回答增加复盘结构模板（问题/补救/下一餐）

Phase 3（引导提升）
- 历史维度“高风险复盘提醒”
- 复盘后自动生成次日行动清单（可订阅）

---

## 本轮代码落点

- `apps/web/src/features/history/components/history-detail-page.tsx`
  - 新增复盘 prompt 构建
  - 新增复盘上下文注入与跳转
  - 新增“用这条记录问 AI 教练”按钮
