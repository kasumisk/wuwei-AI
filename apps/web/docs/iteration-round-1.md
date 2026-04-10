# Round 1: 首页推荐区域 - 激活反馈闭环

> 日期: 2026-04-09
> 页面: 首页 (`home-page.tsx`)
> 状态: 实施中

---

## Step 1: 当前页面理解

### 首页信息流（从上到下）

| 区域     | 组件                    | 数据来源                   | 交互                 |
| -------- | ----------------------- | -------------------------- | -------------------- |
| 导航栏   | 内联                    | user                       | 无                   |
| 今日状态 | `TodayStatus`           | DailySummary + UserProfile | 纯展示               |
| 档案完善 | `CompletionPrompt`      | completion-suggestions     | 可关闭/可跳转        |
| 核心入口 | 内联双按钮              | 无                         | 跳转 analyze/foods   |
| 主动提醒 | `ProactiveReminderCard` | ProactiveReminder          | **仅能关闭**         |
| 每日计划 | 内联                    | DailyPlanData              | **纯展示**           |
| 餐食推荐 | 内联                    | MealSuggestion             | 场景切换（仅UI切换） |
| 今日记录 | `MealList` 内联         | FoodRecord[]               | **纯展示**           |

### 现状判定

- 页面是一个**数据仪表盘**，不是**决策助手**
- 后端有 `decisionFeedback` API、`adjustDailyPlan` API，前端从未调用
- 推荐区域只显示"吃什么"，不解释"为什么"
- 用户对推荐没有任何控制能力（无 like/dislike/替换）

---

## Step 2: 最关键问题

**推荐是单向输出，用户无法反馈和控制。**

具体表现：

1. 首页"餐食推荐"区域 → 只展示食物名+热量，无反馈按钮
2. 首页"每日计划"区域 → 只展示4餐计划，无法调整
3. 首页"今日记录"列表 → 有 decision badge 但无反馈入口
4. 后端 Thompson Sampling 需要用户反馈数据才能学习，但前端没有提供入口

**为什么这是最关键的？**

- 不解决反馈问题，推荐系统永远无法"变聪明"
- 用户觉得推荐"不准"时没有出口，只能忽略，导致推荐功能废弃
- 这是整个推荐闭环的断裂点

---

## Step 3: 最小优化方案

### 改哪里

首页 `home-page.tsx` 中的**餐食推荐区域**（L207-L264）

### 改什么

将"餐食推荐"从**纯展示卡片**改为**可交互的推荐卡片**：

1. 新增反馈按钮：`[喜欢] [换一个] [不想吃]`
2. 新增推荐原因（前端基于已有数据拼接）
3. 新增"换一个"调用 `adjustDailyPlan` API

### 为什么

| 改动     | 体验提升                             |
| -------- | ------------------------------------ |
| 反馈按钮 | 用户有控制感，推荐系统开始学习       |
| 推荐原因 | 用户理解"为什么推荐这个"，提高信任   |
| 换一个   | 不喜欢时有出路，不会直接放弃推荐功能 |

### 不改什么

- 不动 TodayStatus 组件
- 不动底部导航
- 不动每日计划区域（下一轮迭代）
- 不动页面整体布局

---

## Step 4: UI + 交互设计

### 改动前

```
┌─────────────────────────────────┐
│ 🍽️ 午餐推荐                     │
│ [在家做] [外卖] [堂食]           │
│                                 │
│ 鸡胸肉沙拉 + 糙米饭              │
│ ≈ 520 kcal    💡 高蛋白低脂搭配  │
└─────────────────────────────────┘
```

### 改动后

```
┌─────────────────────────────────┐
│ 🍽️ 午餐推荐                     │
│ [在家做] [外卖] [堂食]           │
│                                 │
│ 鸡胸肉沙拉 + 糙米饭              │
│ ≈ 520 kcal    💡 高蛋白低脂搭配  │
│                                 │
│ ┌─ 为什么推荐 ───────────────┐  │
│ │ 基于你的减脂目标，蛋白质     │  │
│ │ 今日达标率 62%，本餐侧重    │  │
│ │ 高蛋白补充                  │  │
│ └────────────────────────────┘  │
│                                 │
│ [👍 喜欢] [🔄 换一个] [👎 不想吃]│
└─────────────────────────────────┘
```

### 用户操作流程

**点击"喜欢"：**

1. 按钮变为已选状态（绿色勾）
2. toast 提示"已记录偏好"
3. 无 API 调用（暂时，因为 decisionFeedback 需要 recordId，推荐还不是 record）

**点击"换一个"：**

1. 按钮显示 loading 状态
2. 调用 `recommendationService.adjustDailyPlan("用户不想吃当前推荐")`
3. 刷新 meal-suggestion 和 daily-plan 查询
4. 展示新推荐

**点击"不想吃"：**

1. 展示底部简短原因选择（非模态弹窗，内联展开）
   - 不喜欢这类食物
   - 手边没有食材
   - 想吃别的
2. 选择后自动触发"换一个"

---

## Step 5: 前端实现

### 新增文件

```
src/features/home/hooks/use-plan-adjust.ts    — adjustDailyPlan mutation
src/features/home/components/meal-recommendation-card.tsx  — 推荐卡片（从 home-page 中拆出）
```

### 修改文件

```
src/features/home/components/home-page.tsx  — 引入新组件替换内联推荐区
src/features/home/hooks/use-home-data.ts    — 无需修改
```

### 组件拆分

```
MealRecommendationCard
├── props: { suggestion, summary, profile, onRefresh }
├── 内部状态:
│   ├── activeScenario: number
│   ├── showReason: boolean (推荐原因折叠)
│   ├── showDislikeOptions: boolean (不想吃原因)
│   └── feedbackGiven: 'like' | 'dislike' | null
├── 推荐原因: 基于 profile.goal + summary 宏量达标率前端计算
└── 操作:
    ├── 喜欢 → 设置 feedbackGiven + toast
    ├── 换一个 → usePlanAdjust.adjustPlan()
    └── 不想吃 → 展开原因选择 → 选择后 adjustPlan()
```

### 状态管理

```
usePlanAdjust hook:
  - useMutation(recommendationService.adjustDailyPlan)
  - onSuccess: invalidateQueries(['daily-plan', 'meal-suggestion'])
```

### 数据流

```
[推荐原因计算 - 纯前端]
profile.goal → 目标类型文案
summary.totalProtein / summary.proteinGoal → 蛋白质达标率
summary.totalCalories / summary.calorieGoal → 热量使用率
profile.canCook → 是否推荐自制
→ 拼接为 2-3 句话的推荐理由

[换一个]
UI 点击 → usePlanAdjust.mutateAsync(reason)
  → POST /app/food/daily-plan/adjust { reason }
  → onSuccess: invalidate queries
  → React Query 自动 refetch meal-suggestion + daily-plan
  → UI 自动更新
```

---

## Step 6: 验证方式

### 功能验证

- [ ] 推荐卡片正常渲染（含推荐原因区域）
- [ ] 点击"喜欢"显示 toast 反馈
- [ ] 点击"换一个"调用 API 并刷新推荐
- [ ] 点击"不想吃"展开原因选择
- [ ] 选择原因后自动换一个
- [ ] 场景切换仍然正常工作

### 不影响已有功能

- [ ] TodayStatus 渲染不变
- [ ] 每日计划区域不变
- [ ] 今日记录列表不变
- [ ] 底部导航不变
- [ ] 无推荐数据时的空状态不变

### 用户体验验证

- 用户是否能理解"为什么推荐这个食物"
- 用户是否会使用"换一个"功能
- 反馈操作是否足够简单（1-2 次点击完成）

---

## Step 7: 下一步建议

1. **Round 2: 今日记录列表增加反馈入口** — 在每条饮食记录旁增加 `decisionFeedback` 的 👍/👎 按钮，激活后端偏好学习
2. **Round 3: 每日计划从只读变为可调整** — 增加单餐替换能力，调用 `adjustDailyPlan`

---

## 涉及的后端 API

| API                                | 用途         | 当前状态                 |
| ---------------------------------- | ------------ | ------------------------ |
| `GET /app/food/meal-suggestion`    | 获取推荐     | ✅ 已使用                |
| `POST /app/food/daily-plan/adjust` | 换一个       | ❌ 前端未调用 → 本轮激活 |
| `GET /app/food/summary/today`      | 推荐原因计算 | ✅ 已使用，数据复用      |
| `GET /app/food/profile`            | 推荐原因计算 | ✅ 已使用，数据复用      |
