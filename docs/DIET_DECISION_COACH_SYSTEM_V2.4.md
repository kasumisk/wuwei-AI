# 饮食决策 + AI 教练系统 V2.4

> 版本定位：在 V2.3 完成的标准化分析状态、置信度诊断、证据块、行动决策基础上，继续优化决策系统的可用性、可维护性、国际化与反 馈闭环能力。

> 重要边界：
> - 推荐系统：只读依赖，不修改算法本体
> - 用户画像系统：只读依赖，不修改画像逻辑与字段
> - 订阅/商业化逻辑：不修改
> - 数据库字段：不新增

---

## 0. V2.4 设计原则

V2.4 在 V2.3 已落地的 AnalysisState、ConfidenceDiagnostics、EvidencePack、ShouldEatAction、PostMealRecovery 基础上，继续做三类增强：

1. **决策层解耦与模块化**：把"分析 → 评分 → 决策"三层彻底分离，参考推荐系统的模块设计，每层独立迭代增强。
2. **质量与反馈闭环**：建立"分析审核 → 策略修正"的完整反馈链，持续提升决策代表性。
3. **国际化与维护性**：清理硬编码、统一格式化接口、支持 i18n，为后续产品国际化做准备。

V2.4 的核心不是新增功能模块，而是 **优化现有架构的纵深与横向延展性**，让系统从"能用"升级为"易维护且可迭代"。

---

## 1. V2.3 → V2.4 的演进

### 1.1 V2.3 交付物回顾

| 维度 | V2.3 完成状态 |
| --- | --- |
| 分析状态建模 | ✓ AnalysisState (pre/post/recovery) |
| 置信度分层 | ✓ ConfidenceDiagnostics (4-layer) |
| 证据块标准化 | ✓ EvidencePack (unified) |
| 行动决策 | ✓ ShouldEatAction (executable) |
| 教练行动计划 | ✓ CoachActionPlan (with lazy-build) |
| 管道集成 | ✓ 步骤 4.5, 5.6, 5.7 全部连通 |

**主要成果**：完整的"分析 → 决策 → 教练"管道已成型，V2.3 代表系统已具备核心决策闭环能力。

### 1.2 V2.4 面临的问题

尽管 V2.3 完成了重大架构升级，但仍需解决 5 个关键问题：

| 编号 | 问题 | 影响 | 解决方向 |
| --- | --- | --- | --- |
| I1 | 分析/评分/决策三层耦合 | 新增需求难以独立迭代（如评分算法调整需重新理解决策逻辑） | 模块化分离，参考推荐系统的 RecommendationEngine 设计 |
| I2 | 硬编码与格式化重复 | 时间边界值、分隔符、翻译 key 等散落在各处，i18n 改造困难 | 建立统一的配置、常量、格式化层 |
| I3 | 缺乏数据质量反馈 | food_analysis_records.reviewStatus 已存在但没被系统化使用，无法反哺分析策略 | 建立质量反馈节点，与审核流集成 |
| I4 | 教练上下文格式化重复 | CoachService 与 CoachPromptBuilder 都有摘要格式化，维护成本高 | 统一格式化接口，建立 CoachFormatService |
| I5 | 缺乏国际化实装 | 虽然架构支持多语言，但分析决策层缺少 i18n 层 | 建立 i18n 翻译层，分离常量与文本渲染 |

---

## 2. V2.4 优化目标（4-8 个目标）

### 2.1 核心优化目标

按"分析 → 评分 → 决策 → 教练"五层，定义 6 个优化目标：

| 序号 | 目标 | V2.4 具体需求 | 优先级 |
| --- | --- | --- | --- |
| **O1** | **决策层模块化** | 建立独立的 `DecisionEngine` 服务，解耦当前的"分析+评分+决策"混合逻辑，并为每层定义清晰的输入/输出契约 | ⭐⭐⭐ |
| **O2** | **建立用户-决策反馈节点** | 在 food_records 中记录"用户是否接受决策"，作为后续分析质量反馈的数据源 | ⭐⭐⭐ |
| **O3** | **统一格式化与 i18n 层** | 建立 `FoodAnalysisFormatService` 与 `CoachFormatService`，集中管理所有文本渲染、时间格式、多语言映射 | ⭐⭐⭐ |
| **O4** | **替代方案场景化评分** | 在 Alternative 生成时，使用 RecommendationEngine 而非静态 fallback，并为每个替代方案标注场景与理由 | ⭐⭐ |
| **O5** | **质量反馈中枢** | 建立 `AnalysisQualityFeedbackService`，聚合审核状态、用户接受度、推荐点赞数等信号，生成分析策略调优建议 | ⭐⭐ |
| **O6** | **校准国际化基础路由** | 为关键决策输出（Should Eat reason、Coach suggestion 等）引入 i18n key 映射，为后续国际化奠基 | ⭐⭐ |

**优先级说明**：
- ⭐⭐⭐ = Phase 1（必须）
- ⭐⭐ = Phase 2（应该）
- ⭐ = Phase 3（可做）

---

## 3. V2.4 整体架构

### 3.1 分层设计（参考推荐系统）

V2.4 按"分析层 → 评分层 → 决策层 → 教练层 → 持久化层"重新组织，每层职责清晰、接口标准化：

```text
层级                              职责                                服务/模块
───────────────────────────────────────────────────────────────────
分析层                            单次餐或日度饮食分析                AnalysisPipelineService
                                  + AnalysisState 建模
                                  + ConfidenceDiagnostics

评分层                            用户目标对标、宏量进度、问题识别     ScoringService (NEW)
                                  输出：NutritionScore

决策层                            Should Eat 判断、理由、替代方案      DecisionEngine (NEW)
                                  输出：ShouldEatAction

替代方案层                        基于 RecommendationEngine 候选        AlternativeService (REFACTOR)

教练层                            行动计划生成、格式化、持续追踪      CoachActionPlanService
                                                                        + CoachFormatService (NEW)

持久化 + 反馈层                   质量反馈、用户决策反馈               AnalysisQualityFeedbackService (NEW)
```

### 3.2 核心服务重构

#### 新增服务（3 个）

1. **`ScoringService`** （决策库）
   - **职责**：接收 AnalysisState + UserProfile，输出单一的 NutritionScore，与用户目标对标
   - **方法**：
     - `scoreNutrition(state, userProfile)` → `NutritionScore`
     - `detectIssues(score, state)` → `Issue[]`
     - `getProgressStatus(score)` → `{consumed, target, remaining, status}`
   - **设计理由**：当前评分逻辑与分析、决策混合，无法独立调整

2. **`DecisionEngine`** （决策库）
   - **职责**：接收 ShouldEatRequest（食物、用户、当前状态），输出 ShouldEatDecision
   - **方法**：
     - `decideShouldEat(req)` → `ShouldEatDecision { action, reason, alternatives }`
     - `getDecisionReason(action, context)` → `string` (i18n aware)
   - **设计理由**：当前决策逻辑分散，融合化决策引擎便于策略调整

3. **`CoachFormatService`** （教练库）
   - **职责**：统一所有文本格式化、多语言翻译、时间表示
   - **方法**：
     - `formatSuggestion(action, persona, lang)` → `string`
     - `formatTimebound(hours, lang)` → `string` (e.g., "接下来 2 小时内")
     - `formatNutrition(value, unit, lang)` → `string`
   - **设计理由**：文本渲染逻辑现在分散在 Coach 和 Builder 中，难以统一国际化

4. **`AnalysisQualityFeedbackService`** （反馈库）
   - **职责**：聚合分析审核、用户接受度、推荐反馈，生成改进建议
   - **方法**：
     - `recordUserFeedback(analysisId, accepted, userNote)` → void
     - `getQualityMetrics(dateRange)` → `{accuracy, acceptanceRate, reviewLatency}`
     - `suggestPolicyChanges()` → `PolicySuggestion[]`
   - **设计理由**：为持续改进提供数据驱动的反馈闭环

#### 重构服务（2 个）

1. **`AlternativeService`** → 使用 RecommendationEngine 替代静态 fallback
   - 当前：调 `SubstitutionService` 或返回硬编码替代
   - V2.4：接收"需要规避的营养限制"，调 RecommendationEngine 的 `generateConstraints()` + `recommendMealFromPool()`
   - 输出：`Alternative[] { food, reason, scenarioType }`

2. **`AnalysisPipelineService`** → 分离核心分析与决策聚合
   - 当前：既做分析，也做决策结果组装
   - V2.4：AnalysisPipeline 专注分析 → AnalysisState；决策聚合上移到 `ResultAssembler`

---

## 4. V2.4 分阶段实现计划

### Phase 1: 模块化基础（必须）

**目标**：建立清晰的分析 → 评分 → 决策三层模块。

**工作量**：4-5 服务 + 2 类型 + 3 文件修改

**交付物**：

1. 新增服务（3 个）：
   - `ScoringService` （含 NutritionScore 类型）
   - `DecisionEngine` （含 ShouldEatDecision 类型）
   - `CoachFormatService` （含 FormatOptions 配置）

2. 新增目录结构：
   ```
   src/modules/decision/
   ├── analyze/          (V2.3 - 分析层)
   ├── scoring/          (NEW - 评分层)
   │   ├── scoring.service.ts
   │   └── scoring.types.ts
   ├── decision/         (REFACTORED - 决策层)
   │   ├── decision-engine.service.ts (NEW)
   │   ├── decision.types.ts (EXTENDED)
   │   └── ... (existing)
   └── decision.module.ts (UPDATED)
   
   src/modules/coach/
   ├── app/
   │   ├── coach.service.ts
   │   └── prompt/
   ├── coaching/
   │   └── coach-format.service.ts (NEW)
   └── coach.module.ts (UPDATED)
   ```

3. 修改文件（3 个）：
   - `decision.module.ts` - 注册新服务
   - `coach.module.ts` - 注册 CoachFormatService
   - `result-assembler.service.ts` - 调用 ScoringService 和 DecisionEngine

4. 验证标准：
   - 编译成功，0 errors
   - 所有新服务正确导出
   - 依赖注入正确无循环
   - 现有 API 行为不变（向后兼容）

---

### Phase 2: 反馈闭环 + 格式化统一（应该）

**目标**：建立数据质量反馈机制，统一文本格式化与 i18n 基础。

**依赖**：Phase 1 完成

**工作量**：2 服务 + 4 文件修改 + i18n 配置初始化

**交付物**：

1. 新增服务（2 个）：
   - `AnalysisQualityFeedbackService`
   - `AlternativeService` (REFACTORED to use RecommendationEngine)

2. 新增 I18n 配置：
   ```
   src/config/
   ├── i18n/
   │   ├── en.yml   (英文)
   │   ├── zh.yml   (简中)
   │   └── i18n.service.ts (翻译服务 - NEW)
   └── decision-constants.ts (重新组织所有硬编码)
   ```

3. 修改文件（4 个）：
   - `food-records.entity.ts` - 新增 "user_feedback" 字段（或在 food_analysis_records 中扩展）
   - `food-analyze.controller.ts` - 添加反馈上报端点
   - `coach.service.ts` - 调用 CoachFormatService
   - `coach-prompt-builder.service.ts` - 使用 i18n keys

4. 验证标准：
   - CoachFormatService 成功渲染中英文文本
   - 反馈上报端点可用
   - 所有决策原因文本来自 i18n 配置

---

### Phase 3: 国际化基础路由 + 持续改进（可做）

**目标**：完成 i18n 基础设施建设，为全球化产品做准备；建立持续改进的度量与报告。

**依赖**：Phase 2 完成

**工作量**：2 文件 + 报表端点

**交付物**：

1. I18n 完整覆盖：
   - 所有决策原因、建议、替代说明都通过 i18n key 而非硬编码
   - 支持中、英、日、韩等关键市场语言

2. 持续改进仪表板：
   - 新增管理端端点：`GET /admin/analysis/quality-metrics` → `{ accuracy, acceptanceRate, commonIssues, recommendations }`
   - 支持按日期段、用户群体、食物类别分组

3. 修改文件（2 个）：
   - `admin/` 路由 - 添加质量指标端点
   - 决策类型定义 - 补充 i18n key 字段

4. 验证标准：
   - 管理端可看到实时质量指标
   - 所有用户可用语言都支持

---

## 5. 数据模型设计

### 5.1 新增/扩展类型

#### ScoringService 相关

```typescript
// src/modules/decision/scoring/scoring.types.ts

interface NutritionScore {
  // 当前摄入 vs 目标
  consumed: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
  };
  target: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
  };
  remaining: {
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    fiber: number;
  };
  
  // 进度状态
  status: 'under' | 'balanced' | 'over'; // 三态评价
  
  // 宏量均衡度 (0-100)
  macroBalance: number;
  
  // 问题识别
  issues: {
    name: string;        // e.g., "protein_deficit"
    severity: 'low' | 'medium' | 'high';
    desc_i18n: string;   // i18n key: "scoring.issue.protein_deficit"
    value: number;
  }[];
  
  // 决策建议方向
  actionDirection: 'must_eat' | 'should_eat' | 'can_skip' | 'should_avoid';
  
  // 置信度权重（0-1）
  confidence: number;
}

interface Issue {
  type: string;      // nutrition_type: 'protein', 'fat', 'carbs', etc.
  status: 'deficit' | 'excess';
  value: number;     // 当前 vs 目标的差值
  severity: 'low' | 'medium' | 'high';
  msg_i18n: string;  // e.g., "issue.protein_deficit_high"
}
```

#### DecisionEngine 相关

```typescript
// src/modules/decision/decision/decision.types.ts (EXTEND)

interface ShouldEatRequest {
  foodId: string;
  qty: number;      // 计划摄入量 (克)
  userId: string;
  currentScore: NutritionScore;
  analysisConfidence: number;
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  userProfile: UserProfile;
}

interface ShouldEatDecision {
  action: 'must_eat' | 'should_eat' | 'can_skip' | 'should_avoid';
  confidence: number;  // 决策置信度（0-1）
  
  // 决策理由（多个维度）
  reasons: {
    dimension: 'nutrition' | 'health' | 'allergy' | 'preference';
    reason_i18n: string;  // i18n key
    weight: number;       // 权重 (0-1)
  }[];
  
  // 替代方案
  alternatives: Alternative[];
  
  // 补偿建议（如果不吃这个）
  compensationSuggestions?: string[];
}

interface Alternative {
  foodId: string;
  foodName: string;
  qty: number;
  reason_i18n: string;      // 为什么推荐这个
  scenarioType: 'takeout' | 'convenience' | 'homeCook' | 'standard';
  score: number;            // 匹配度 (0-100)
}
```

#### 教练与反馈相关

```typescript
// src/modules/coach/coaching/coach-format.types.ts (NEW)

interface CoachFormatOptions {
  language: 'en' | 'zh' | 'ja' | 'ko';
  persona: 'strict' | 'friendly' | 'data';
  style: 'brief' | 'detailed';
}

// src/modules/decision/feedback/feedback.types.ts (NEW)

interface UserDecisionFeedback {
  analysisId: string;
  userId: string;
  decision: 'accepted' | 'modified' | 'rejected';
  userNote?: string;
  timestamp: Date;
}

interface AnalysisQualityMetrics {
  dateRange: { start: Date; end: Date };
  totalAnalyses: number;
  acceptedCount: number;
  rejectedCount: number;
  acceptanceRate: number;  // percentage
  
  // 问题分布
  issueBreakdown: {
    [issueType: string]: number;
  };
  
  // 常见替代选择
  commonAlternatives: {
    original: string;
    replacement: string;
    frequency: number;
  }[];
}
```

### 5.2 修改现有数据模型

#### FoodRecord 扩展反馈字段

```typescript
// src/modules/food/entities/food-record.entity.ts (EXTEND)

@Entity('food_records')
export class FoodRecord {
  // ... existing fields
  
  // NEW: 用户对决策的反馈
  @Column({ type: 'varchar', nullable: true })
  userFeedback?: 'accepted' | 'modified' | 'rejected';
  
  @Column({ type: 'text', nullable: true })
  userFeedbackNote?: string;
  
  @Column({ type: 'timestamp', nullable: true })
  feedbackTimestamp?: Date;
}
```

---

## 6. API 能力设计

### 6.1 分析决策链路 API

#### 已有 API（复用）

```
POST /food/analyze              分析食物或食物照片 (既有，V2.0)
  Input:  { image?, text?, userId }
  Output: FoodAnalysisResultV61 (含 ShouldEatAction)

GET  /user/profile              获取用户画像 (既有，用户模块)
GET  /food/recommendations      推荐食物 (既有，推荐模块)
```

#### 新增能力（仅描述，不暴露新客户端接口）

```
内部调用（服务间）：

ScoringService.scoreNutrition(analysisState, userProfile)
  → NutritionScore

DecisionEngine.decideShouldEat(request)
  → ShouldEatDecision

CoachFormatService.formatSuggestion(action, persona, language)
  → string (formatted suggestion)

AnalysisQualityFeedbackService.recordUserFeedback(analysisId, feedback)
  → void

AlternativeService.generateAlternatives(constraints)
  → Alternative[] (from RecommendationEngine)
```

#### 新增管理端 API（可选）

```
GET /admin/analysis/quality-metrics
  Input:  { dateRange, groupBy? }
  Output: AnalysisQualityMetrics

POST /admin/decision/policy-adjust
  Input:  { policyId, suggestion }
  Output: { status, reason }
```

---

## 7. 实现关键点与注意事项

### 7.1 与现有系统的集成策略

1. **推荐系统只读**：
   - DecisionEngine 不修改 RecommendationEngine
   - AlternativeService 通过 RecommendationEngineService 的公开方法（generateConstraints, recommendMealFromPool）获取方案
   - 无增删改，只读取

2. **用户画像只读**：
   - ScoringService 读取 UserProfile 计算目标与进度，不修改用户数据

3. **向后兼容**：
   - FoodAnalyzeController 返回结构保持不变（augment，不修改）
   - 现有客户端代码无需改动

### 7.2 模块文件组织

按决策系统的逻辑分层重组文件夹：

```
src/modules/decision/
├── analyze/               (V2.3 - 分析层，保持不变)
│   ├── analysis-pipeline.service.ts
│   ├── analysis-state-builder.service.ts
│   ├── confidence-diagnostics.service.ts
│   ├── evidence-pack-builder.service.ts
│   └── analysis-result.types.ts
├── scoring/               (NEW - Phase 1 评分层)
│   ├── scoring.service.ts
│   ├── scoring.types.ts
│   └── scoring.module.ts (可选，如果需要独立暴露)
├── decision/              (REFACTORED - Phase 1 决策层)
│   ├── decision-engine.service.ts (NEW)
│   ├── decision.types.ts (EXTENDED)
│   ├── should-eat-action.service.ts (V2.3)
│   ├── post-meal-recovery.service.ts (V2.3)
│   └── food-decision.service.ts (LEGACY, 可逐步迁移)
├── alternatives/          (NEW - Phase 2 替代方案)
│   ├── alternative.service.ts (REFACTORED from SubstitutionService)
│   └── alternative.types.ts
├── feedback/              (NEW - Phase 2 反馈层)
│   ├── quality-feedback.service.ts
│   └── feedback.types.ts
├── decision.module.ts     (UPDATED 每个 phase)
└── decision.types.ts      (EXTENDED)

src/modules/coach/
├── app/
│   ├── coach.service.ts
│   └── prompt/
│       ├── coach-prompt-builder.service.ts
│       └── coach-prompt.types.ts
├── coaching/              (NEW - Phase 1 教练格式化)
│   ├── coach-format.service.ts (NEW)
│   ├── coach-format.types.ts (NEW)
│   └── coach-action-plan.service.ts
└── coach.module.ts        (UPDATED)

src/config/               (NEW - Phase 2 全局配置)
├── i18n/ (NEW - Phase 2)
│   ├── zh.yml
│   ├── en.yml
│   └── i18n.service.ts
├── decision-constants.ts   (NEW - Phase 2, 聚集所有硬编码)
└── coach-prompts.config.ts (EXISTING-ish, 重新组织)
```

### 7.3 依赖注入策略

确保无循环依赖：

```
AnalysisPipeline
  → (read) RecommendationEngine, UserProfile
  →(output) AnalysisState

ScoringService
  → (read) UserProfile, NutritionProfile
  → (input) AnalysisState
  → (output) NutritionScore

DecisionEngine
  → (read) ScoringService
  → (read) AnalysisState, UserProfile
  → (input) ShouldEatRequest
  → (output) ShouldEatDecision

CoachFormatService
  → (read) I18nService, FormatConfig
  → (input) Decision, Action
  → (output) formatted string

AlternativeService
  → (read) RecommendationEngine
  → (input) constraints
  → (output) Alternative[]

AnalysisQualityFeedbackService
  → (read) Database
  → (input) Feedback
  → (output) QualityMetrics

CoachActionPlanService
  → (read) DecisionEngine, ShouldEatAction
  → (input) User, Decision
  → (output) ActionPlan
```

---

## 8. 里程碑与成功标准

### Phase 1 完成标准

- [ ] 3 个新服务（ScoringService, DecisionEngine, CoachFormatService）实现并单测通过
- [ ] 新模块文件夹结构建立，import paths 正确
- [ ] decision.module.ts 和 coach.module.ts 注册所有新服务无循环依赖
- [ ] FoodAnalyzeController 调用新的决策链路，API 行为保持不变
- [ ] 编译成功，0 errors，dist/ 有新增 JS 文件
- [ ] 现有 E2E 测试全过

### Phase 2 完成标准

- [ ] AnalysisQualityFeedbackService 实现，能记录反馈并查询指标
- [ ] AlternativeService refactor 完成，使用 RecommendationEngine 生成替代
- [ ] I18n 基础配置（zh.yml, en.yml）初始化
- [ ] food_records 扩展用户反馈字段，数据库迁移成功
- [ ] 反馈上报端点 (POST /food/analysis/{id}/feedback) 可用
- [ ] 编译成功，新增测试全过

### Phase 3 完成标准

- [ ] I18n 覆盖所有决策文本、建议、替代说明
- [ ] 管理端质量指标端点可用，能返回准确的度量数据
- [ ] 支持 3+ 语言（中、英、……）
- [ ] 编译成功，集成测试全过

---

## 9. 风险与回滚策略

### 技术风险

| 风险 | 影响 | 缓解策略 |
| --- | --- | --- |
| 决策引擎性能 | 如果 DecisionEngine 计算复杂度高，可能拖累响应时间 | 引入缓存（Redis）或异步处理 |
| I18n 覆盖不全 | 某些决策文本仍是硬编码，导致国际化不彻底 | Phase 2 建立 linter，检查所有字符串是否来自 i18n |
| 推荐引擎的 API 变更 | 如果推荐引擎改 API，AlternativeService 需跟进 | 建立集成测试，确保对推荐引擎的调用固定化 |

### 回滚策略

- **Phase 1 回滚**：去掉新服务，食物决策短期通过 V2.3 的 ShouldEatAction 继续工作
- **Phase 2 回滚**：关闭反馈上报端点，不使用新的 AlternativeService，继续用 SubstitutionService
- **Phase 3 回滚**：回到中文文本硬编码

---

## 10. 后续产品与技术方向

### 产品方向（与决策系统联动）

1. **营养目标个性化**：引入用户行为教练，动态调整推荐食物与决策阈值
2. **社交对标**：允许用户对标其他健身社群的进度，决策基于社交压力与目标偏差
3. **AI 教练强化**：从"单次决策教练"升级为"跨周期行为纠正教练"

### 技术方向

1. **决策链路的 A/B 测试框架**：为决策算法的漂移提供实验框架
2. **多模式决策**：支持"严格模式（小红书风格）"和"灵活模式（日常友好）"
3. **决策透明度报告**：用户可查看"历史决策准确率""常见误判原因""个人化修正建议"

---

## 附录：术语表

| 术语 | 定义 |
| --- | --- |
| AnalysisState | V2.3 引入，标准化吃前/吃后/补偿状态模型 |
| NutritionScore | V2.4 新增，用户当前摄入与目标的对标评分 |
| ShouldEatAction | V2.3 引入，可执行的"吃/不吃"决策对象 |
| ShouldEatDecision | V2.4 新增，包含理由、替代、补偿的决策完整体 |
| DecisionEngine | V2.4 新增，决策独立服务 |
| ConfidenceDiagnostics | V2.3 引入，分层置信度诊断 |
| EvidencePack | V2.3 引入，统一证据块 |
| i18n | 国际化（Internationalization） |
| RecommendationEngine | V2.2 既有，推荐食物的核心算法，V2.4 只读依赖 |
| CoachFormatService | V2.4 新增，教练文本格式化服务 |

