# 饮食决策 + AI教练系统 V1.0

> 文档版本: V1.0 Base  
> 目标: 围绕"分析 → 决策 → 教练"三层，系统性修复现有缺陷并增强能力  
> 范围: 后端分析管道 + 决策引擎 + 教练服务 + 前端展示与交互  
> 不涉及: 推荐系统、用户画像系统、商业化逻辑

---

## 1. 系统现状总览

### 1.1 三层架构

```
┌─────────────────────────────────────────────────┐
│                   前端 (Web)                      │
│  AnalyzePage → DecisionCard → CoachPage          │
└──────────┬──────────────┬──────────────┬─────────┘
           │              │              │
     ┌─────▼─────┐  ┌────▼─────┐  ┌────▼─────┐
     │  分析层    │  │  决策层   │  │  教练层   │
     │ Analyze   │  │ Decision │  │  Coach   │
     │           │  │          │  │          │
     │ 文字分析  │  │ 规则决策 │  │ SSE聊天  │
     │ 图片分析  │  │ 评分引擎 │  │ 每日问候 │
     │ 快速查询  │  │ 替代方案 │  │ 风格切换 │
     └───────────┘  └──────────┘  └──────────┘
```

### 1.2 已识别的关键缺陷

| #   | 层级 | 缺陷                                            | 影响                    |
| --- | ---- | ----------------------------------------------- | ----------------------- |
| D1  | 分析 | 文字分析不使用7维评分引擎，仅用简单规则         | 文字/图片分析评分不一致 |
| D2  | 分析 | 替代方案：文字分析纯硬编码，图片依赖AI          | 文字分析替代方案质量差  |
| D3  | 决策 | `riskLevel` 字段不显示在任何UI                  | 用户无法感知风险等级    |
| D4  | 决策 | `DecisionFeedback` 实际不出现在分析流程中       | 反馈闭环断裂            |
| D5  | 决策 | `useDecisionFeedback` hook 从未被使用           | 死代码                  |
| D6  | 决策 | `FeedbackRatings` 多维评分有定义无UI            | 无法收集细粒度反馈      |
| D7  | 决策 | `getSubstitutes` / `explainWhyNot` API 从未调用 | 替代品/解释功能废弃     |
| D8  | 决策 | `advice` 字段保存但不显示                       | 决策建议不可见          |
| D9  | 教练 | 前端不传结构化饮食上下文给Coach                 | 教练缺乏精确上下文      |
| D10 | 教练 | 教练无法基于分析结果给结构化建议                | 教练与分析脱节          |

---

## 2. Phase 1: 单次分析 + 基础决策

> 目标: 统一分析管道评分、修复决策展示、激活反馈闭环

### 2.1 分析层修复

#### 2.1.1 文字分析接入7维评分引擎 (修复 D1)

**现状**: `TextFoodAnalysisService` 使用 `computeDecision()` 简单规则生成 score/decision  
**目标**: 复用 `NutritionScoreService.calculateMealScore()` 替代简单规则

**修改文件**: `apps/api-server/src/modules/food-analysis/services/text-food-analysis.service.ts`

**实施步骤**:

1. 注入 `NutritionScoreService`
2. 在 `analyzeText()` 管道中，营养数据计算完成后调用 `calculateMealScore()`
3. 用引擎返回的 `healthScore/nutritionScore` 覆盖简单规则的 score
4. 用引擎的分数→决策映射覆盖 `computeDecision()` 的结果
5. 保留 `computeDecision()` 作为降级方案（引擎异常时回退）

**数据流变更**:

```
Before: 营养计算 → computeDecision() → score + decision
After:  营养计算 → NutritionScoreService.calculateMealScore() → score + decision
                   ↓ (异常时)
                   computeDecision() → 降级决策
```

**验证**: 同一食物用文字和图片分析，healthScore 偏差应 <15 分

#### 2.1.2 文字分析替代方案增强 (修复 D2)

**现状**: 硬编码映射表（如 炸鸡→烤鸡胸）  
**目标**: Phase 1 先扩充规则表 + 按品类生成，Phase 2 再引入上下文感知

**修改文件**: `text-food-analysis.service.ts`

**实施步骤**:

1. 将替代方案映射从内联硬编码提取为独立配置文件 `alternative-food-rules.ts`
2. 按品类组织：油炸类→低油替代、高糖类→低糖替代、精碳类→全谷物替代
3. 每个替代方案附带 `reason` 字段说明替代逻辑
4. 支持按用户目标过滤（fat_loss 优先低热量替代，muscle_gain 优先高蛋白替代）

### 2.2 决策层修复

#### 2.2.1 DecisionCard 完善展示 (修复 D3, D8)

**修改文件**: `apps/web/src/features/food-analysis/components/decision-card.tsx`

**实施步骤**:

1. 在决策卡片中显示 `riskLevel`（用颜色标签: green/yellow/red）
2. 显示 `advice` 字段内容（如果存在）
3. 显示 `explanation.primaryReason`（付费墙保护已有）
4. 风险等级用图标+文字：🟢低风险 / 🟡中风险 / 🔴高风险

#### 2.2.2 反馈闭环激活 (修复 D4, D5)

**现状**: `DecisionFeedback` 组件存在，但分析结果步骤没有 `recordId`，保存后切到 saved 步骤又不渲染反馈组件

**修改文件**:

- `apps/web/src/features/food-analysis/components/analyze-page.tsx`
- `apps/web/src/features/food-analysis/components/decision-card.tsx`

**实施步骤**:

1. 在 `result` 步骤的 `DecisionCard` 底部添加简化反馈（👍/👎 + 可选文字）
2. 反馈不依赖 `recordId`，使用 `analysisId`（分析结果都有）
3. 保存后的 `saved` 步骤保留完整 `DecisionFeedback`（使用 recordId）
4. 激活 `useDecisionFeedback` hook，连接到实际 API 调用

#### 2.2.3 激活已有但未用的 API (修复 D7)

**修改文件**: `apps/web/src/features/food-analysis/components/decision-card.tsx`

**实施步骤**:

1. 当 `recommendation === 'caution' || 'avoid'` 时，显示"查看替代方案"按钮
2. 点击调用 `getSubstitutes(foodId)` API
3. 在 DecisionCard 下方展开替代方案列表
4. 每个替代品显示名称 + 替代原因
5. "为什么不建议吃?"链接 → 调用 `explainWhyNot(foodId)` 弹出解释

### 2.3 教练层基础优化

#### 2.3.1 分析结果传递到教练 (修复 D9 部分)

**现状**: 分析→教练跳转只传 `?q=自然语言描述`  
**目标**: Phase 1 增强 q 参数内容，包含结构化摘要

**修改文件**:

- `apps/web/src/features/food-analysis/components/decision-card.tsx`（跳转逻辑）
- `apps/web/src/app/[locale]/coach/page.tsx`（接收端）

**实施步骤**:

1. 跳转时将分析摘要编码到 q 参数：`?q=我刚分析了[食物名]，热量[X]kcal，评分[Y]分，建议[recommend/caution/avoid]，帮我分析一下`
2. 教练页解析后自动发送，用户感知到教练"知道"刚才的分析

---

## 3. Phase 2: 上下文分析 + 替代建议

> 目标: 引入当日饮食上下文、增强替代方案质量、时间感知决策

### 3.1 分析层 - 上下文感知

#### 3.1.1 文字分析引入当日饮食上下文

**现状**: 图片分析已有用户上下文构建（当日剩余热量预算），文字分析完全没有  
**目标**: 文字分析也接入当日饮食上下文

**修改文件**: `text-food-analysis.service.ts`

**实施步骤**:

1. 调用 `FoodRecordService` 获取用户当日已记录的饮食
2. 计算当日已摄入: totalCalories, totalProtein, totalFat, totalCarbs
3. 计算剩余预算 = 目标 - 已摄入
4. 将上下文传入 `NutritionScoreService.calculateMealScore()` 的 energy 维度
5. 如果当日已超标，自动提高 energy 维度权重 → 更严格的决策

**V61 输出增强**:

```typescript
explanation: {
  summary: "这份炸鸡排约650kcal",
  userContextImpact: "您今日已摄入1200kcal，加上这份将达到1850kcal，超出目标200kcal",
  // ...
}
```

#### 3.1.2 时间感知决策

**实施步骤**:

1. 根据分析时间判断 mealType（早餐/午餐/晚餐/加餐）
2. 不同时段应用不同决策权重：
   - 晚餐(18:00后): 碳水惩罚增强（fat_loss目标）
   - 加餐(22:00后): 总热量惩罚增强
   - 早餐(6:00-9:00): 碳水容忍度提高
3. 在 explanation 中说明时间因素影响

### 3.2 决策层 - 替代方案增强

#### 3.2.1 上下文感知替代方案

**目标**: 替代方案基于当日剩余预算推荐

**修改文件**: `text-food-analysis.service.ts`, `nutrition-score.service.ts`

**实施步骤**:

1. 替代方案筛选条件：热量 < 原食物的70%，蛋白质 >= 原食物的80%
2. 如果用户当日蛋白质不足，优先推高蛋白替代
3. 如果用户当日碳水超标，优先推低碳替代
4. 替代方案 reason 字段说明"为什么这个更适合你现在"

#### 3.2.2 替代方案 UI 增强

**修改文件**: `decision-card.tsx`

**实施步骤**:

1. 替代方案从折叠列表改为卡片式展示
2. 每张替代卡片显示：名称、热量对比（-30%）、替代原因
3. 点击替代品可直接触发新分析（预填替代食物名称）
4. Premium 用户显示完整营养对比表

### 3.3 教练层 - 结构化上下文

#### 3.3.1 教练接收结构化饮食上下文 (完整修复 D9)

**修改文件**:

- `apps/web/src/app/[locale]/coach/page.tsx`
- `apps/web/src/lib/api/coach.ts`

**实施步骤**:

1. 从分析跳转时，除 q 参数外，在 coach chat 请求中增加 `context` 字段：

```typescript
{
  message: "帮我分析一下这顿饭",
  conversationId: "...",
  context: {
    recentAnalysis: {
      foods: ["炸鸡排"],
      totalCalories: 650,
      healthScore: 35,
      recommendation: "caution",
      reason: "热量偏高，油炸食品"
    },
    todayIntake: {
      calories: 1200,
      remaining: 600,
      meals: 2
    }
  }
}
```

2. 后端 Coach Service 接收 context，注入到 system prompt 的专用块中
3. 教练基于结构化数据给出更精准的建议

**后端修改文件**: `apps/api-server/src/modules/coach/coach.service.ts`

---

## 4. Phase 3: AI教练对话 + 个性化引导

> 目标: 教练从被动问答升级为主动引导，提供结构化建议和行为干预

### 4.1 教练层 - 结构化建议输出

#### 4.1.1 教练响应格式增强 (修复 D10)

**现状**: 教练返回纯文本流  
**目标**: 教练在特定场景返回结构化建议

**修改文件**:

- `apps/api-server/src/modules/coach/coach.service.ts`（prompt增强）
- `apps/web/src/app/[locale]/coach/page.tsx`（解析结构化内容）

**后端实施**:

1. 在 system prompt 中增加输出格式指令：

```
当用户询问饮食建议时，请用以下格式回答：
## 结论
[一句话结论]

## 原因
- [原因1]
- [原因2]

## 建议行动
1. [具体行动1]
2. [具体行动2]

## 替代选择（如适用）
- [替代方案]
```

2. 保持 SSE 流式输出，前端解析 markdown 结构

**前端实施**:

1. 教练消息渲染增强 markdown 解析
2. "建议行动"部分渲染为可交互的 checklist
3. "替代选择"部分点击可直接跳转到分析页预填

#### 4.1.2 教练主动建议触发

**实施步骤**:

1. 分析结果为 `caution` 或 `avoid` 时，分析结果页显示"问问教练怎么调整"按钮
2. 跳转后教练自动生成一条基于分析结果的结构化建议
3. 每日问候中，如果检测到连续3天某类问题（如蛋白质不足），主动提醒

### 4.2 教练层 - 个性化语气

#### 4.2.1 教练风格深化

**现状**: 3种风格（strict/friendly/data）仅影响 system prompt 的一段描述  
**目标**: 风格影响内容结构和用词

**修改文件**: `coach.service.ts`

**实施步骤**:

1. `strict` 风格：直接指出问题，用"应该/不应该"语气，强调数据偏差
2. `friendly` 风格：用鼓励语气，"其实可以试试..."，强调进步
3. `data` 风格：纯数据展示，表格化对比，少用主观评价
4. 每种风格定义独立的 prompt 模板（非一段话描述，而是完整的 system prompt 差异段）

### 4.3 教练层 - 行为引导

#### 4.3.1 饮食习惯追踪与干预

**实施步骤**:

1. 后端：在每日问候构建时分析最近7天饮食模式
2. 识别模式：
   - 连续高碳低蛋白 → 提醒增加蛋白质
   - 晚餐持续超标 → 建议晚餐控制策略
   - 蔬菜摄入不足 → 推荐增加蔬菜
3. 将模式洞察注入每日问候的 system prompt
4. 快捷建议从通用（"今天吃什么"）变为个性化（"昨晚碳水超标了，今天试试低碳午餐？"）

---

## 5. 实施优先级与依赖

```
Phase 1 (基础修复, 约5天)
├── P1-1: 文字分析接入评分引擎 [后端] ← 无依赖
├── P1-2: 替代方案规则提取+扩充 [后端] ← 无依赖
├── P1-3: DecisionCard展示完善 [前端] ← 无依赖
├── P1-4: 反馈闭环激活 [前端] ← 无依赖
├── P1-5: 激活 getSubstitutes/explainWhyNot [前端] ← 依赖P1-3
└── P1-6: 分析→教练 q 参数增强 [前端] ← 无依赖

Phase 2 (上下文增强, 约5天)
├── P2-1: 文字分析引入当日上下文 [后端] ← 依赖P1-1
├── P2-2: 时间感知决策 [后端] ← 依赖P2-1
├── P2-3: 上下文感知替代方案 [后端] ← 依赖P1-2, P2-1
├── P2-4: 替代方案UI增强 [前端] ← 依赖P1-5
└── P2-5: 教练接收结构化上下文 [前后端] ← 依赖P1-6

Phase 3 (教练升级, 约5天)
├── P3-1: 教练结构化建议输出 [前后端] ← 依赖P2-5
├── P3-2: 教练主动建议触发 [前后端] ← 依赖P3-1
├── P3-3: 教练风格深化 [后端] ← 无依赖
└── P3-4: 饮食习惯追踪与干预 [后端] ← 依赖P2-1
```

## 6. 技术约束

- 所有后端修改需确保向下兼容 V61 输出结构
- 前端修改需通过 `npx tsc --noEmit --project apps/web/tsconfig.json`
- Mobile-first: `max-w-lg mx-auto` pattern
- 付费墙字段保护逻辑不可变更
- Coach API 如需新增字段，需在 DTO 中标记为可选（不破坏现有客户端）
- 文字分析增加评分引擎调用可能增加延迟，需确保 <500ms 总响应时间
