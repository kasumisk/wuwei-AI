# Round 2: Analyze → Decision → Coach 全链路迭代（V3.2 对齐）

> 日期: 2026-04-17
> 范围: `/analyze`、`/history`、`/coach`、`/profile`、`/onboarding`
> 目标: 从“分析结果展示”升级为“可追溯决策 + 连续教练”产品流

---

## Step 1: 用户画像必填数据 & Diet Decision API 变化评估

### 1.1 当前决策质量最依赖的画像字段（按优先级）

P0（必须）
- `goal`（减脂/增肌/健康/习惯）
- `activityLevel`（活动水平）
- `weightKg` + `heightCm`（基础代谢与热量目标校准）
- `dietaryRestrictions`、`allergens`、`healthConditions`（安全约束）

P1（强建议）
- `mealPattern`、`mealTimingPreference`
- `cookingEffort`、`kitchenProfile`
- `budgetSensitivity`
- `sleepQuality`、`stressLevel`

P2（优化项）
- `flavorOpenness`、`diversityTolerance`
- `bingeTriggers`、`weakTimeSlots`

### 1.2 当前 API 是否必须改动

结论: 不需要大改 Controller 路径，但需要“前端契约升级 + 可选增强字段”。

现状
- 后端 `POST /app/food/analyze-text`、`GET /app/food/analyze/:requestId`、`GET /app/food/analysis/:analysisId` 已提供 V6.1/V7 结构（含 `v61`）。
- 前端大量使用旧扁平字段（`SAFE/OK/LIMIT/AVOID`、`advice/reason/suggestion`）。

需要做的 API 合约工作
- 前端增加统一 Adapter：V61 → 旧 UI 所需字段（本轮已实现）。
- Coach 请求保留 `analysisContext`，并补充字段（`decisionFactors`、`breakdown`、`nextMealAdvice`）用于更强上下文问答。
- 建议后端补充一个“统一返回模式”开关（如 `?view=v61|legacy`），减少双格式维护成本。

---

## Step 2: 核心用户流（文本流程图）

```text
用户进入 Analyze
  -> 选择输入方式(图片/文字/常吃/搜索)
  -> 提交分析
    -> 图片: /app/food/analyze 创建任务 + 轮询 /app/food/analyze/:requestId
    -> 文本: /app/food/analyze-text 同步返回
  -> 结果页看到: 决策 + 风险 + 营养分 + 替代方案 + 补救策略
  -> 用户动作
    -> 保存记录: /app/food/analyze-save
    -> 追问教练: 跳转 /coach?q=... 并携带 analysisContext
    -> 改分析对象: 点替代项重新分析
  -> 历史页可回看分析详情
  -> 教练页读取一次性分析上下文进行连续对话
```

---

## Step 3: 页面结构（页面/核心功能/API/用户动作）

### 3.1 Analyze 页面
- 页面: `src/app/[locale]/analyze/page.tsx`
- 组件: `src/features/food-analysis/components/analyze-page.tsx`
- API:
  - `POST /app/food/analyze`
  - `GET /app/food/analyze/:requestId`
  - `POST /app/food/analyze-text`
  - `POST /app/food/analyze-save`
- 用户动作:
  - 上传图片 / 输入文本
  - 选择餐次
  - 保存记录
  - 点击“问 AI 教练”
  - 选择替代项触发再分析

### 3.2 History 页面
- 页面: `src/app/[locale]/history/page.tsx`
- 组件: `src/features/history/components/history-page.tsx`
- API:
  - `GET /app/food/analysis/history`
  - `GET /app/food/analysis/:analysisId`
- 用户动作:
  - 筛选（图片/文字）
  - 进入详情
  - 分页浏览

### 3.3 Coach 页面
- 页面: `src/app/[locale]/coach/page.tsx`
- API:
  - `POST /app/coach/chat`（SSE）
  - `GET /app/coach/daily-greeting`
  - `GET /app/coach/conversations`
  - `GET /app/coach/conversations/:id/messages`
- 用户动作:
  - 问题输入
  - 中断流式回答
  - 选择历史会话
  - 切换教练风格

### 3.4 Profile / Preferences / Onboarding 页面
- 页面:
  - `src/app/[locale]/profile/page.tsx`
  - `src/app/[locale]/profile/preferences/page.tsx`
  - `src/app/[locale]/onboarding/page.tsx`
- API:
  - `GET /app/user-profile/full`
  - `POST /app/user-profile/onboarding/step/:step`
  - `PUT /app/user-profile/recommendation-preferences`
  - `PATCH /app/user-profile/declared`
- 用户动作:
  - 完善画像
  - 偏好调节
  - 引导补全

---

## Step 4: 交互路径优化（非视觉层）

1. 分析结果“先有结论，后有解释”
- 首屏固定三件事: 能不能吃、为什么、下一步怎么做。

2. 教练衔接从“跳转”升级为“问题模板 + 上下文注入”
- 由 Analyze 生成结构化问题模板（今天这一餐怎么补救/下一餐怎么安排）。

3. 历史页从“流水账”升级为“可行动复盘”
- 每条历史展示 1 个可执行动作（如“今天晚餐替换建议”）。

4. 保存路径防中断
- 保存成功后提供双 CTA：`继续分析` / `去教练复盘`。

---

## Step 5: 组件级 UI 结构（组件职责 & 状态来源）

- `AnalyzePage`
  - 职责: 输入、分析、保存、跳转教练
  - 状态来源: 本地 state + `useFoodAnalysis`

- `DecisionCard`
  - 职责: 展示决策解释、营养分、替代方案、补救
  - 状态来源: `AnalysisResult`

- `HistoryPage` / `HistoryDetailPage`
  - 职责: 历史列表与详情回放
  - 状态来源: `useAnalysisHistory` / `useAnalysisDetail`

- `CoachPage`
  - 职责: SSE 对话、上下文融合、历史会话
  - 状态来源: 页面 state + coach API

- `ProfileCompletionBar` / `PreferencesPage`
  - 职责: 画像闭环、偏好闭环
  - 状态来源: profile query + mutation

---

## Step 6: API 缺口 / Bug / 新接口建议

### 6.1 已确认缺口与问题

1) 图片分析前端缺少轮询闭环（已在本轮修复）
- 问题: `POST /app/food/analyze` 返回任务态，前端原本按同步结果消费。
- 修复: API 层自动轮询 `GET /app/food/analyze/:requestId` 直到 completed。

2) V61 与旧扁平字段契约漂移（已在本轮修复）
- 问题: 后端返回 `v61`，前端主要读旧字段，导致字段丢失/弱化。
- 修复: 在 API 层做统一 normalize 适配。

3) 分析历史结构不一致（已在本轮修复）
- 问题: 历史接口返回 `analysisId + summary`，前端期望 `id/inputText/foodCount`。
- 修复: API 层映射为前端统一类型。

4) 历史删除语义错误（本轮已修复）
- 问题: 历史详情删除原先走 `deleteRecord`，参数是 `analysisId`，语义不一致。
- 修复: 新增 `DELETE /app/food/analysis/:analysisId`，前端历史列表与详情统一改为 `deleteAnalysis`。

### 6.2 新接口建议（Phase 2/3）

- `POST /app/coach/context-preview`
  - 输入 analysisId，返回教练可读摘要与建议追问模板。

- `GET /app/food/analysis/:analysisId/actionables`
  - 返回“下一餐行动建议”结构化卡片数据。

---

## Step 7: 三阶段迭代路线图

### Phase 1（已启动，1-2 天）: 契约修复 + 稳定性
- 已完成
  - API 层图片分析自动轮询
  - V61/legacy 结果 normalize
  - 历史列表结构映射
  - 历史删除语义修复（新增 analysis 删除接口）
  - Coach 上下文字段增强 + 自动首问模板

### Phase 2（3-5 天）: 交互闭环
- Analyze 结果页增加“行动卡”
- Coach 首条自动问题模板
- 历史列表加入“复盘入口”
- 增加关键埋点：分析成功率、保存率、教练转化率

### Phase 3（5-7 天）: 智能化增强
- 个性化策略模板（减脂/增肌/慢病场景）
- 分析历史周报（行为趋势 + 可执行建议）
- 推荐与教练共享用户策略状态

---

## 本轮已落地代码

- `src/lib/api/food-record.ts`
  - 新增图片分析轮询逻辑
  - 新增 V61 -> AnalysisResult 适配
  - 新增分析历史响应映射
  - 新增分析详情响应适配
