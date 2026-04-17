# Round 4: 历史列表快速复盘到 AI 教练

> 日期: 2026-04-17
> 目标: 在历史列表直接触发“复盘 -> 教练”闭环，减少用户从列表进入详情再发问的路径损耗
> 范围: `history-page.tsx`（无后端改动）

---

## Step 1：用户画像与档案评估

本轮不新增用户画像字段，继续复用已有画像：
- goal / activityLevel
- allergens / dietaryRestrictions / healthConditions

本轮用户需额外提供的信息：
- 无新增手动输入（通过历史记录自动组装）

API 是否需要修改（仅饮食决策域）：
- 本轮不需要。
- 继续复用 coach 侧已有会话上下文注入机制。

---

## Step 2：核心用户流程设计（文字流程图）

```text
用户进入历史列表
  -> 浏览某条记录（热量/类型/判定）
  -> 点击“快速复盘到 AI 教练”（卡片按钮或更多菜单）
    -> 前端组装最小复盘上下文（analysisId/inputType/mealType/totalCalories/decision）
    -> 写入 sessionStorage (coach_analysis_context + coach_auto_prompt)
    -> 跳转 /coach?q=...
  -> Coach 页面自动发送首问
  -> 返回“关键问题 + 当日补救 + 下一餐建议”
```

---

## Step 3：页面结构设计（可落地）

页面列表（本轮涉及）：
- `/history` 历史列表
- `/coach` AI 教练

页面能力映射：
- 历史列表
  - 功能: 快速复盘入口（按钮 + 菜单）
  - 数据来源: `GET /app/food/analysis/history`
  - 用户操作: 一键跳转 coach 并自动提问

- 教练页
  - 功能: 读取缓存上下文并自动发送首问
  - 数据来源: `POST /app/coach/chat`（沿用）
  - 用户操作: 接收复盘建议并继续追问

---

## Step 4：交互优化（行为路径）

关键行为优化：
- 旧路径：历史列表 -> 历史详情 -> 复盘到教练 -> 自动发送
- 新路径：历史列表 -> 快速复盘 -> 自动发送

收益：
- 降低一步页面跳转与认知切换
- 增强历史回看的“可行动性”
- 提升教练入口触达率

---

## Step 5：UI 结构设计（组件级）

组件改动：
- `HistoryItem`
  - 新增 `buildQuickCoachPrompt(item)`
  - 新增 `handleQuickCoachReview(closeMenu?)`
  - 新增卡片内按钮“快速复盘到 AI 教练”
  - 新增更多菜单项“问 AI 教练复盘”

状态来源：
- API 状态: `useAnalysisHistory`
- 本地状态: `showActions` / `showDeleteConfirm`
- 会话态: `sessionStorage`（一次性复盘上下文）

---

## Step 6：API 缺口识别

当前可实现，但仍有两点可升级：
- 缺口 1: 历史列表接口没有 foods 摘要，导致首问只能用“热量+判定+文本片段”
  - 建议: history item 增加 `foodsPreview: string[]`（最多 3 个）

- 缺口 2: 缺少后端生成的“复盘 prompt 模板版本化”
  - 建议: 新增可选端点 `POST /app/coach/review-prompt` 或在 chat 入参支持 `reviewMode=history_list`

---

## Step 7：分阶段迭代（更新）

Phase 1（已完成）
- 历史详情一键复盘
- 分析上下文透传
- coach 自动首问

Phase 2（本轮完成关键一步）
- 历史列表快速复盘入口（卡片 + 菜单）
- 减少一层跳转成本

Phase 3（下一步）
- 在历史列表增加“风险优先复盘”排序标签（高风险记录置顶复盘）
- 复盘后自动生成“今日剩余执行清单”（可勾选）

---

## 本轮落地文件

- `apps/web/src/features/history/components/history-page.tsx`
- `apps/web/docs/iteration-round-4-history-list-quick-review.md`
