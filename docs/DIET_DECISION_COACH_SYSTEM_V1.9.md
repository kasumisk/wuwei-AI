# 饮食决策 + AI教练系统 V1.9 设计文档

> 版本: V1.9  
> 基于: V1.8（架构解耦 + 评分精度 + 行为感知 + 替代增强）  
> 目标: 模块彻底解耦 + 分析准确度提升 + 动态决策增强 + AI教练结构化输出 + 可解释性 + 国际化

---

## 一、当前系统能力评估

### 已具备能力（V1.8 基线）

| 层级   | 能力                                      | 状态     |
| ------ | ----------------------------------------- | -------- |
| 分析层 | 文本/图片食物识别 + 营养估算              | ✅ 成熟  |
| 分析层 | 食物库匹配 + 模糊搜索 + LLM fallback      | ✅ 成熟  |
| 评分层 | 7维 NutritionScore 引擎评分               | ✅ 成熟  |
| 评分层 | 评分定量化解释（actualValue/targetValue） | ✅ V1.7  |
| 决策层 | 三档决策 + 目标差异化阈值                 | ✅ V1.7  |
| 决策层 | 上下文修正（时间/餐次/预算/过敏/健康）    | ✅ 成熟  |
| 决策层 | 结构化问题识别 + 宏量进度                 | ✅ V1.7  |
| 决策层 | 决策推理链 + 维度解释                     | ✅ V1.6  |
| 替代层 | 推荐引擎优先 + 静态 fallback              | ✅ V1.1+ |
| 教练层 | SSE 流式对话 + 个性化语气                 | ✅ 成熟  |

### V1.9 识别的缺失点（8个优化目标）

| #   | 缺失点                                                                      | 影响                         | 优先级 |
| --- | --------------------------------------------------------------------------- | ---------------------------- | ------ |
| 1   | **分析/评分/决策耦合在 food 模块内**，无独立模块边界                        | 无法单独迭代，职责混乱       | P0     |
| 2   | **循环依赖未解决**: FoodScoringService ↔ FoodDecisionService                | 架构腐化、测试困难           | P0     |
| 3   | **DIMENSION_LABELS 三处重复** + UserContext 三处独立构建                    | 维护成本高、一致性风险       | P0     |
| 4   | **分析准确度不可追踪**: 缺少置信度校准和分析质量反馈闭环                    | 无法度量和改进分析精度       | P1     |
| 5   | **动态决策不充分**: 同一食物在不同上下文下结论相同（时间/累积无差异化权重） | 决策缺乏时间敏感性           | P1     |
| 6   | **替代方案未充分接入推荐引擎**: SubstitutionService 缺少过敏/偏好过滤       | 替代方案可能推荐用户过敏食物 | P1     |
| 7   | **AI教练输出缺乏结构化**: 结论/原因/建议未在 prompt 层面强制约束            | 教练回答结构不稳定           | P1     |
| 8   | **国际化不完整**: 静态替代规则、决策 advice 硬编码中文                      | 非中文用户体验差             | P2     |

---

## 二、V1.9 优化目标（8个）

### 目标 1: 饮食分析 / 评分 / 决策 模块解耦分离

**问题**: 当前分析、评分、决策逻辑全部混在 `food` 模块的 `app/` 子目录下，缺少独立模块边界。

**方案**:

- 将 `food/app/scoring/` 提升为独立 `scoring` 模块（scoring.module.ts）
- 将 `food/app/decision/` 提升为独立 `decision` 模块（利用已存在的 `modules/decision/` 空目录）
- 参考推荐系统的模块化结构（独立 module + service + types）
- food 模块只保留食物分析（analyze）职责

### 目标 2: 打破循环依赖 + 共享常量提取

**问题**: FoodScoringService.estimateQuality/Satiety 委托给 FoodDecisionService 造成循环依赖；DIMENSION_LABELS 在3个文件中重复。

**方案**:

- 提取 `NutritionEstimator` 纯函数工具（无 DI 依赖）
- 提取 `scoring-dimensions.ts` 共享常量
- 统一 `UserContextBuilder` 服务消除重复构建逻辑

### 目标 3: 分析准确度提升

**问题**: 食物识别和营养估算的准确度无法度量和改进。

**方案**:

- 引入分析置信度校准机制（多因子置信度：食物库匹配度 + LLM 自报置信度 + 份量精度）
- 分析结果增加 `accuracyFactors` 字段，拆分置信度来源
- 决策系统根据置信度调整建议强度（低置信度时语气更保守）

### 目标 4: 动态决策增强（同一食物不同结论）

**问题**: 同一食物在不同时间/累积状态下应有不同结论，但当前上下文修正力度不够。

**方案**:

- 引入 `ContextualDecisionModifier`：时间权重系数 + 累积饱和度系数
- 深夜/暴食风险时段 → 评分直接衰减（而非只加 contextReason）
- 当天已超标 → 非必需食物直接降级为 caution/avoid
- 多日趋势检测（连续超标 → 严格模式自动触发）

### 目标 5: 替代方案全面接入推荐引擎

**问题**: SubstitutionService.findSubstitutes 调用时未传递过敏原和偏好过滤。

**方案**:

- AlternativeSuggestionService 构建 `userConstraints`（allergens/restrictions）传递给推荐引擎
- 构建 `preferenceProfile`（loves/avoids）传递给推荐引擎
- 静态 fallback 作为兜底不再硬编码食物名称

### 目标 6: AI教练结构化输出

**问题**: Coach system prompt 虽有格式指令但 LLM 遵从性不稳定。

**方案**:

- 强化 system prompt 的结构约束（JSON schema hint + few-shot examples）
- 根据用户目标动态切换教练语气模板（不仅基于 coachStyle，还结合 goalType）
- 教练输出增加 `coachingTone` 元数据标记

### 目标 7: 可解释性增强

**问题**: 决策链虽已存在但缺少"为什么这个维度得分低"的深层解释。

**方案**:

- BreakdownExplanation 增加 `suggestion` 字段（针对该维度的改善建议）
- 决策链增加 `confidence` 字段（每步的确定性程度）
- issues 增加 `actionable` 字段（可执行的改善动作）

### 目标 8: 国际化完善

**问题**: 静态替代规则、部分 advice 生成逻辑硬编码中文。

**方案**:

- alternative-food-rules.ts 食物名称和 reason 改为 i18n key
- 新增本地 i18n 映射（不修改 diet 模块 i18n 文件）
- decision advice 全路径走 i18n

---

## 三、架构变更

### V1.9 目标模块结构

```
modules/
├── food/                              ← 食物分析模块（瘦身后）
│   ├── food.module.ts
│   └── app/
│       ├── services/
│       │   ├── text-food-analysis.service.ts    ← 委托 UserContextBuilder
│       │   ├── image-food-analysis.service.ts   ← 委托 UserContextBuilder
│       │   ├── food-library.service.ts
│       │   └── analysis-ingestion.service.ts
│       ├── types/
│       │   └── analysis-result.types.ts         ← 类型定义（共享）
│       └── config/
│           └── alternative-food-rules.ts        ← 国际化改造
│
├── scoring/                           ← 【新独立模块】评分系统
│   ├── scoring.module.ts
│   ├── services/
│   │   ├── food-scoring.service.ts              ← 评分门面（无循环依赖）
│   │   └── nutrition-estimator.ts               ← 纯函数工具
│   ├── config/
│   │   └── scoring-dimensions.ts                ← 共享维度常量 + i18n
│   └── types/
│       └── scoring.types.ts                     ← 评分相关类型
│
├── decision/                          ← 【激活空模块】决策系统
│   ├── decision.module.ts
│   ├── services/
│   │   ├── food-decision.service.ts             ← 核心决策引擎
│   │   ├── contextual-modifier.service.ts       ← 【新增】动态上下文修正
│   │   ├── alternative-suggestion.service.ts    ← 替代建议（接入推荐引擎）
│   │   ├── decision-explainer.service.ts        ← 决策解释（引用共享常量）
│   │   └── user-context-builder.service.ts      ← 统一 UserContext 构建
│   ├── config/
│   │   └── decision-thresholds.ts               ← 决策阈值配置
│   └── types/
│       └── decision.types.ts                    ← 决策相关类型
│
├── coach/                             ← AI教练模块（增强）
│   ├── coach.module.ts
│   └── app/
│       ├── coach.service.ts                     ← 增强结构化输出
│       ├── coach-prompt-builder.service.ts      ← 【新增】Prompt 构建器
│       └── coach-tone.config.ts                 ← 【新增】语气模板配置
│
├── diet/                              ← 推荐系统（只读引用）
├── user/                              ← 用户画像（只读引用）
└── subscription/                      ← 订阅系统（不修改）
```

### 依赖关系（V1.9）

```
                    ┌─────────────────┐
                    │   food module   │
                    │  (分析 only)    │
                    └──────┬──────────┘
                           │ 调用
                    ┌──────▼──────────┐
                    │ scoring module  │ ← NutritionEstimator (纯函数)
                    │  (评分 only)    │ ← scoring-dimensions.ts (共享常量)
                    └──────┬──────────┘
                           │ 输出 breakdown
                    ┌──────▼──────────┐
                    │ decision module │ ← UserContextBuilder
                    │ (决策 + 替代)   │ ← ContextualModifier
                    └──────┬──────────┘    ← AlternativeSuggestion → 推荐引擎(只读)
                           │ 输出 DecisionOutput
                    ┌──────▼──────────┐
                    │  coach module   │ ← CoachPromptBuilder
                    │  (AI教练)       │ ← coach-tone.config
                    └─────────────────┘

    只读引用: diet(推荐系统), user(画像), subscription(权益)
```

---

## 四、决策链路设计

### 完整链路

```
用户输入（"我想吃麻辣烫"）
    │
    ▼
┌─────────────────────────────────┐
│ Step 1: 饮食分析 (food module)  │
│ - 食物识别 + 食物库匹配        │
│ - 营养估算（热量/蛋白/脂肪/碳水）│
│ - 置信度评估 (accuracyFactors)  │
│ 输出: AnalyzedFoodItem[]       │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ Step 2: 评分计算 (scoring)      │
│ - 7维评分引擎                   │
│ - stability 真实数据            │
│ - GI 数据填充                   │
│ 输出: AnalysisScore + breakdown │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ Step 3: 上下文构建 (decision)   │
│ - UserContextBuilder 统一构建   │
│ - 今日已摄入汇总               │
│ - 目标/限制/健康状况读取        │
│ 输出: UserContext               │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ Step 4: 动态决策 (decision)     │
│ - 基础评分→决策映射             │
│ - ContextualModifier 动态修正   │
│   · 时间权重衰减               │
│   · 累积饱和度检测             │
│   · 暴食风险时段检测           │
│   · 多日趋势检测               │
│ - 问题识别 (issues)             │
│ - 宏量进度计算                  │
│ 输出: FoodDecision + issues     │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ Step 5: 替代建议 (decision)     │
│ - 推荐引擎优先                  │
│   · 传递 userConstraints        │
│   · 传递 preferenceProfile      │
│ - 静态规则 fallback (i18n)      │
│ - 定量对比                      │
│ 输出: FoodAlternative[]         │
└──────────┬──────────────────────┘
           │
           ▼
┌─────────────────────────────────┐
│ Step 6: AI教练输出 (coach)      │
│ - CoachPromptBuilder 构建       │
│ - 目标×语气 矩阵选择           │
│ - 结构化输出约束               │
│   · 结论（吃/不吃/替代）       │
│   · 原因（基于决策链）         │
│   · 建议（可执行动作）         │
│ - SSE 流式响应                  │
│ 输出: 结构化教练建议            │
└─────────────────────────────────┘
```

---

## 五、API能力设计

### 可复用已有 API

| 能力         | 已有 API                                  | 说明              |
| ------------ | ----------------------------------------- | ----------------- |
| 食物文本分析 | `POST /api/app/food/analyze-text`         | 已有，不变        |
| 食物图片分析 | `POST /api/app/food/analyze`              | 已有，不变        |
| 快速分析     | `GET /api/app/food/analyze-quick/:foodId` | 已有，不变        |
| AI教练对话   | `POST /api/app/coach/chat`                | 已有，增强 prompt |
| 分析历史     | `GET /api/app/food/analysis/history`      | 已有，不变        |

### 需新增的能力（能力级描述）

| 能力                 | 说明                                                     | Phase |
| -------------------- | -------------------------------------------------------- | ----- |
| 独立评分能力         | scoring module 可独立调用，输入食物 + 上下文 → 输出评分  | P1    |
| 独立决策能力         | decision module 可独立调用，输入评分 + 上下文 → 输出决策 | P1    |
| 上下文分析能力       | 基于当天累积摄入 + 用户画像 → 输出上下文诊断             | P2    |
| 动态修正能力         | ContextualModifier 根据时间/累积/趋势 → 修正决策         | P2    |
| 教练 Prompt 构建能力 | CoachPromptBuilder 根据目标×语气 → 生成结构化 prompt     | P3    |

---

## 六、数据结构设计（允许范围内增强）

### AnalysisScore 增强

```typescript
export interface AnalysisScore {
  healthScore: number;
  nutritionScore: number;
  confidenceScore: number;
  breakdown?: NutritionScoreBreakdown;
  // V1.9: 置信度分解
  accuracyFactors?: {
    libraryMatchScore: number; // 食物库匹配度 0-1
    portionAccuracy: number; // 份量估算精度 0-1
    nutritionSource: 'library' | 'ai_estimate' | 'hybrid';
  };
}
```

### BreakdownExplanation 增强

```typescript
export interface BreakdownExplanation {
  dimension: string;
  label: string;
  score: number;
  impact: 'positive' | 'warning' | 'critical';
  message: string;
  actualValue?: number;
  targetValue?: number;
  unit?: string;
  // V1.9: 改善建议
  suggestion?: string;
}
```

### DietIssue 增强

```typescript
export interface DietIssue {
  category: /* existing */ 'binge_risk' | 'multi_day_excess';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  data?: Record<string, number | string>;
  // V1.9: 可执行动作
  actionable?: string;
}
```

### UserContext 增强

```typescript
export interface UserContext {
  // ... existing fields ...
  // V1.9: 行为数据增强
  bingeRiskHours?: number[];
  streakDays?: number;
  avgMealsPerDay?: number;
  recentDailyCalories?: number[]; // 近3天每日热量
  // V1.9: 分析准确度上下文
  analysisConfidence?: number; // 综合置信度
}
```

### DecisionChainStep 增强

```typescript
export interface DecisionChainStep {
  step: string;
  input: string;
  output: string;
  // V1.9: 确定性程度
  confidence?: number; // 0-1，该步骤的确定性
}
```

---

## 七、分阶段实施计划

### Phase 1: 架构解耦 + 基础评分增强

**1.1 提取共享维度常量**

- 新建 `scoring/config/scoring-dimensions.ts`
- 统一 `DIMENSION_LABELS`（三语言）+ `DIMENSION_EXPLANATIONS` + impact 阈值
- 三个消费方统一引用

**1.2 提取 NutritionEstimator 纯函数**

- 新建 `scoring/services/nutrition-estimator.ts`
- 移入 `estimateQuality()` + `estimateSatiety()` 为纯导出函数
- FoodScoringService 直接导入（打破循环依赖）

**1.3 创建 scoring.module.ts**

- 导出 FoodScoringService
- 声明内部依赖：NutritionScoreService, BehaviorService, FoodService

**1.4 激活 decision 模块**

- 将 `food/app/decision/` 下的服务迁移到 `modules/decision/`
- 创建 `decision.module.ts`
- 创建 `decision/types/decision.types.ts` 提取决策相关类型
- 创建 `decision/config/decision-thresholds.ts` 提取阈值配置

**1.5 统一 UserContextBuilder**

- 新建 `decision/services/user-context-builder.service.ts`
- 提取 text/image 中重复的 `buildUserContext()` 逻辑
- TextFoodAnalysisService / ImageFoodAnalysisService 委托调用

**1.6 单次饮食分析评分结合用户画像**

- 评分引擎接收 UserContext（含用户画像目标/限制）
- stability 维度填充真实 streakDays/avgMealsPerDay
- GI 数据从食物库匹配提取

### Phase 2: 上下文分析 + 替代建议 + 决策增强

**2.1 上下文分析能力（当天摄入）**

- UserContextBuilder 增加当天所有餐次汇总
- 计算宏量营养素缺口/超标状态
- 输出 `contextDiagnosis`: 当前缺什么/超什么

**2.2 ContextualDecisionModifier 服务**

- 新建 `decision/services/contextual-modifier.service.ts`
- 时间权重系数: 深夜(21-05) → 评分×0.7, 暴食风险时段 → 评分×0.8
- 累积饱和度: 已超标时 → 非必需食物降级
- 多日趋势: 连续3天超标 → 阈值上移（更严格）
- 新增 DietIssue category: `binge_risk`, `multi_day_excess`

**2.3 替代方案全面接入推荐引擎**

- AlternativeSuggestionService 传递 `userConstraints`（allergens/restrictions）
- 传递 `preferenceProfile`（loves/avoids/frequentFoods）
- FoodAlternative 增加 `historicalCount` + `crossCategory`
- 静态 fallback 食物名称改为 i18n key

**2.4 可解释性增强**

- BreakdownExplanation 增加 `suggestion` 字段
- DietIssue 增加 `actionable` 字段
- DecisionChainStep 增加 `confidence` 字段

### Phase 3: AI教练对话 + 个性化引导 + 国际化

**3.1 CoachPromptBuilder 提取**

- 从 CoachService.buildSystemPrompt 中提取 prompt 构建逻辑
- 新建 `coach/app/coach-prompt-builder.service.ts`
- 模块化: 用户画像段 / 饮食数据段 / 行为洞察段 / 分析上下文段

**3.2 目标×语气 矩阵**

- 新建 `coach/app/coach-tone.config.ts`
- 当前只有 3 种 coachStyle，V1.9 增加 goalType 维度交叉:
  - fat_loss × strict → 极严格，零容忍超标
  - fat_loss × friendly → 温和但坚定提醒
  - muscle_gain × strict → 强调蛋白质纪律
  - muscle_gain × friendly → 鼓励补充蛋白
  - health × data → 均衡数据导向
  - habit × friendly → 持续鼓励坚持

**3.3 结构化输出强化**

- System prompt 增加 few-shot examples（每种语气各一个）
- 增加输出格式校验 hint（结论/原因/建议三段式）
- 分析上下文注入时增加 `actionableAdvice` 汇总段

**3.4 分析置信度影响教练语气**

- 低置信度(<60%) → 教练回答增加不确定性提示
- 高置信度(>85%) → 教练回答更坚定

**3.5 国际化完善**

- alternative-food-rules.ts 全面 i18n 改造
- coach-tone.config.ts 三语言模板
- 决策 advice 全路径 i18n

---

## 八、禁止修改范围确认

- ❌ 推荐系统（只读 SubstitutionService.findSubstitutes）
- ❌ 用户画像系统（只读 UserProfileService / BehaviorService）
- ❌ 订阅/商业化逻辑
- ❌ 数据库 schema（无新字段）
- ❌ diet 模块 i18n 文件（新 i18n 条目使用本地映射）

---

## 九、预期收益

| 优化项               | 收益                                       |
| -------------------- | ------------------------------------------ |
| 模块解耦             | 分析/评分/决策可独立迭代，测试覆盖率提升   |
| 打破循环依赖         | FoodScoringService 可独立测试，架构干净    |
| 共享常量             | 维度标签一处维护，零不一致风险             |
| 统一 UserContext     | 消除 ~200 行重复代码，行为一致             |
| 分析准确度分解       | 可追踪和改进分析质量，用户信任度提升       |
| 动态决策             | 同一食物不同上下文给出不同结论，决策更智能 |
| 替代方案接入推荐引擎 | 替代建议个性化，自动过滤过敏原             |
| AI教练结构化输出     | 回答结构稳定，用户获得一致体验             |
| 可解释性增强         | 用户理解"为什么"，信任度提升               |
| 国际化完善           | 日/英用户获得本地化体验                    |
