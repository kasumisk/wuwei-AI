# 饮食决策与AI教练系统 V2.5（升级设计与执行总纲）

> 日期：2026-04-17
> 基线版本：V2.4
> 升级目标：在不改推荐系统、不改用户画像系统、不新增数据库字段的前提下，把现有系统从“可用”升级为“可进化智能系统”。

---

## 0. 边界与约束（严格遵守）

### 禁止改动

- 推荐系统（只读调用）
- 用户画像系统（只读调用）
- 订阅/商业化逻辑
- 数据库字段（不新增字段）

### 允许改动

- 决策相关模块内部服务编排
- 决策输出结构与解释层
- 质量反馈计算逻辑（基于已有记录）
- 文档与阶段化实施方案

---

## 1. Step 1：现有能力分析（基于当前代码）

当前 V2.4 已具备的能力：

1. 分析层（Analyze）

- 已有统一分析管道（AnalysisPipelineService）
- 支持文本/图片食物识别后的统一汇总
- 可输出营养汇总、分析状态、置信度、证据块

2. 评分层（Score）

- 已有 ScoringService（V2.4）
- 可生成 consumed/target/remaining、macroBalance、issues
- 评分能力存在，但与“日内上下文”耦合度仍偏低

3. 决策层（Should Eat）

- 已有 DecisionEngineService + FoodDecisionService
- 支持基于目标、餐次、时段、预算、健康限制的动态判断
- 支持 recommend/caution/avoid，但可执行建议结构还可再标准化

4. 教练层（Coach）

- 已有 Coach 服务与格式化能力基础
- 支持 persona（strict/friendly/data）
- 对“结论-原因-建议”的结构化输出可进一步强约束

5. 用户行为记录（吃了什么）

- 已有 food_records、daily_summaries、ai_decision_logs、coach_conversations 等可读数据
- 数据基础充分，可支撑“吃前/吃后”双态决策

### 三层缺失点（分析 / 评分 / 决策 / 教练）

1. 分析层缺失

- 单次分析强，但“当天累计摄入上下文”在决策中仍非第一优先输入。
- 分析准确度与“用户反馈采纳率”闭环可追踪，但策略联动不足。

2. 评分层缺失

- 评分已可用，但缺少“吃前候选餐 vs 今日剩余额度”的显式冲突标签。
- 问题识别有规则，但对“蛋白不足/脂肪过高/糖过高”的优先级排序不统一。

3. 决策层缺失

- “推荐吃/不建议/可替代”语义已存在，但输出等级与动作建议（份量、时段、替代）仍可进一步模板化。
- 同一食物跨时间动态结论已有能力，但文案可解释性不总是稳定一致。

4. 教练层缺失

- 教练输出存在自然语言差异，结构化稳定性（结论、原因、建议）需强制化。
- persona 已有，但和具体决策风险级别的语气映射尚未完全制度化。

---

## 2. Step 2：饮食分析系统设计（Analyze）

### 2.1 单次饮食分析

输入：用户 + 食物/餐
输出：

- 热量（calories）
- 宏量营养（protein/fat/carbs）
- 健康评分（nutritionScore + macroBalance）

### 2.2 上下文分析（关键）

增加“日内上下文快照”作为统一输入（不新增表字段）：

- 今日已摄入
- 今日剩余额度
- 当前餐次预算占比
- 是否超标/不足（按 calories/protein/fat/carbs）

### 2.3 问题识别

统一问题字典（不改数据库，仅改决策内部枚举与输出）：

- protein_deficit
- fat_excess
- sugar_excess
- carb_excess
- fiber_deficit
- calorie_over_budget

---

## 3. Step 3：决策系统（Should Eat）

### 3.1 是否建议吃（标准化）

统一动作输出：

- recommend_eat（推荐吃）
- not_recommended（不建议）
- suggest_alternative（可替代）

### 3.2 原因解释（必须）

每个结论必须至少包含 3 维理由：

- 基于用户目标（fat_loss/muscle_gain/health）
- 基于当前摄入（today consumed vs target）
- 基于健康限制（allergen/restriction/condition）

### 3.3 替代方案（严格依赖推荐引擎）

- 替代候选来源：RecommendationEngine（只读）
- 不允许静态写死“万能替代品”
- 输出更优食物 + 更优份量 + 场景（外卖/便利店/家做）

### 3.4 动态决策

同一食物在不同时间可不同结论，规则由以下变量驱动：

- localHour
- mealType
- remainingBudget
- 当日已摄入结构

---

## 4. Step 4：AI教练系统设计（Coach）

### 4.1 对话式引导

教练输出不只给结果，要给“下一步怎么做”。

### 4.2 建议结构化（强制模板）

每次输出必须包含：

1. 结论（吃/不吃/替代）
2. 原因（目标+摄入+健康）
3. 建议（份量、时间、替代组合）

### 4.3 个性化语气映射

- 减脂用户：控制型（边界明确）
- 增肌用户：鼓励型（强调补充）
- 健康管理用户：平衡型（稳态优先）

---

## 5. Step 5：决策链路（统一）

用户输入（想吃什么）
→ 饮食分析（单次 + 日内上下文）
→ 评分与问题识别
→ Should Eat 决策
→ AI 教练输出（结构化+个性化）

---

## 6. Step 6：API能力设计（能力级，不展开接口细节）

### 可复用能力

- 分析管道能力（文本/图片识别后的统一处理）
- 决策引擎能力（动态阈值与上下文修正）
- 推荐引擎能力（替代候选生成）
- 用户画像读取能力（目标、限制、偏好）

### 需要新增/增强能力（不新增DB字段）

- 日内上下文快照聚合能力（read model）
- 决策解释标准化能力（统一 reason schema）
- 教练结构化渲染能力（结论-原因-建议）
- 质量反馈聚合与策略建议能力（基于已有日志/反馈）

---

## 7. Step 7：数据结构设计（允许范围）

不新增数据库字段，仅增强运行时结构：

1. FoodScoreView

- foodSummary
- nutrientDelta
- qualityFlags

2. UserIntakeStateView

- consumedToday
- remainingToday
- overLimitFlags

3. DecisionRecordView

- action
- reasons[]
- alternatives[]
- coachAdvice
- explainabilityScore

---

## 8. Step 8：分阶段迭代（V2.5执行）

### Phase 1（先把“能判断”做稳）

- 单次饮食分析标准化
- 评分与用户画像对齐
- 决策输出统一（吃/不吃）

### Phase 2（再把“会权衡”做强）

- 日内上下文分析
- 替代建议完全绑定推荐引擎
- 分析/评分/决策三层可独立迭代

### Phase 3（最后把“会沟通”做深）

- AI教练对话式解释
- persona 与风险等级联动
- 国际化全覆盖（i18n keys 全链路）

---

## 9. 优先优化目标（本轮 6 项）

1. 分析-评分-决策解耦强化（模块边界清晰）
2. 日内上下文成为决策默认输入
3. Should Eat 解释模板标准化
4. 替代方案与推荐引擎强绑定
5. 教练输出结构化强约束
6. i18n 全链路覆盖（先 key，后文案扩充）

---

## 10. 交付物（本次文档迭代）

- V2.5 总纲：本文件
- Phase 1 执行文档：DIET_DECISION_COACH_SYSTEM_V2.5_PHASE1.md
- Phase 2 执行文档：DIET_DECISION_COACH_SYSTEM_V2.5_PHASE2.md
- Phase 3 执行文档：DIET_DECISION_COACH_SYSTEM_V2.5_PHASE3.md

> 以上文档可直接作为后续迭代实施蓝图，按 Phase 顺序推进。
