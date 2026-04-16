# 饮食决策 + AI教练系统 V2.0 设计文档

> 版本: V2.0  
> 基于: V1.9（模块解耦 + 上下文增强 + 教练重构 + 可解释性 + i18n）  
> 目标: 完善"分析 → 决策 → 教练"完整决策链，修复已知缺陷，提升决策质量和教练效果

---

## Step 1: 现有能力分析

### V1.9 已具备能力

| 层级   | 能力                                                | 状态    |
| ------ | --------------------------------------------------- | ------- |
| 分析层 | 文本/图片食物识别 + 12维营养估算                    | ✅ 成熟 |
| 分析层 | 食物库匹配 + 模糊搜索 + LLM fallback                | ✅ 成熟 |
| 评分层 | 7维 NutritionScore + 定量解释                       | ✅ 成熟 |
| 评分层 | 纯函数营养估算（quality/satiety）                   | ✅ V1.9 |
| 决策层 | 4档决策（SAFE/OK/LIMIT/AVOID）+ 目标差异化阈值      | ✅ V1.9 |
| 决策层 | 上下文修正器（累积饱和/深夜/多日趋势/暴食风险）     | ✅ V1.9 |
| 决策层 | 结构化问题识别 + 宏量进度 + 决策推理链              | ✅ V1.7 |
| 决策层 | 决策阈值独立配置 + 可解释性字段                     | ✅ V1.9 |
| 替代层 | 推荐引擎优先 + 静态 fallback + i18n + 用户偏好过滤  | ✅ V1.9 |
| 教练层 | CoachPromptBuilder（Profile+Diet+Behavior+7日统计） | ✅ V1.9 |
| 教练层 | Goal×Tone 矩阵 + confidence modifier + few-shot     | ✅ V1.9 |
| 教练层 | SSE 流式对话 + 会话管理                             | ✅ 成熟 |

### V2.0 识别的缺失点（8个优化目标）

| #   | 缺失点                                                                          | 影响                                    | 优先级 |
| --- | ------------------------------------------------------------------------------- | --------------------------------------- | ------ |
| 1   | **scoreMultiplier 未应用**: 上下文修正器计算了 multiplier 但决策服务未消费      | 上下文修正只影响 issues，不影响核心评分 | P0     |
| 2   | **UserContext 类型不统一**: builder 和 decision 服务定义了不同的接口            | 类型混乱，数据可能丢失                  | P0     |
| 3   | **图片分析路径不一致**: 不用 UserContextBuilder、不发事件、自带 PERSONA_PROMPTS | 与文本路径行为不一致，prompt 配置分散   | P0     |
| 4   | **分析→教练无自动桥接**: text 发 ANALYSIS_COMPLETED 无人监听，image 不发事件    | 教练无法自动获取分析结果                | P1     |
| 5   | **决策审计缺失**: 决策链步骤不持久化                                            | 教练无法引用历史决策，无法分析决策趋势  | P1     |
| 6   | **computeDecision/identifyIssues 逻辑重复**: 过敏/超标检查运行两次              | 维护风险，性能浪费                      | P1     |
| 7   | **无正向反馈**: 上下文修正器只有惩罚，无奖励（如连续健康饮食）                  | 用户缺乏正向激励                        | P1     |
| 8   | **profile: any 贯穿全局**: 所有服务的 profile 参数无类型                        | 类型安全缺失，重构风险                  | P2     |

---

## Step 2: 饮食分析系统优化设计

### 2.1 统一分析路径

**问题**: 文本和图片分析路径在用户上下文构建、事件发射、prompt 配置上不一致。

**方案**:

- 图片分析服务 `analyzeToV61` 改用 `UserContextBuilderService.build()` 替代手工构建
- 图片分析服务注入 `EventEmitter2`，分析完成后发射 `ANALYSIS_COMPLETED` 事件
- 删除图片服务内的 `PERSONA_PROMPTS` / `GOAL_FOCUS_BLOCK`，改用 `coach-tone.config.ts` 的 `buildTonePrompt()`
- 移除文本服务中未使用的 `SubstitutionService` 注入

**文件变更**:

- `image-food-analysis.service.ts`: 注入 EventEmitter2，调用 UserContextBuilderService.build()，移除重复 prompt 常量
- `text-food-analysis.service.ts`: 移除 SubstitutionService 注入
- `food.module.ts`: 更新 provider 注册

### 2.2 统一 UserContext 接口

**问题**: `user-context-builder.service.ts` 和 `food-decision.service.ts` 各定义了不同的 `UserContext`。

**方案**:

在 `analysis-result.types.ts` 中定义唯一的 `UnifiedUserContext` 接口：

```typescript
export interface UnifiedUserContext {
  goalType: string;
  dailyCalorieGoal: number;
  consumedCalories: number;
  remainingCalories: number;
  consumedProtein: number;
  consumedFat: number;
  consumedCarbs: number;
  remainingProtein: number;
  remainingFat: number;
  remainingCarbs: number;
  proteinGoal: number;
  fatGoal: number;
  carbsGoal: number;
  mealCount: number;
  mealType?: string;
  currentHour: number;
  allergens: string[];
  dietaryRestrictions: string[];
  healthConditions: string[];
  locale?: string;
}
```

- `UserContextBuilderService.build()` 返回 `UnifiedUserContext`
- `FoodDecisionService` 方法签名全部使用 `UnifiedUserContext`
- 移除两处独立定义的 `UserContext` 接口

**文件变更**:

- `analysis-result.types.ts`: 新增 `UnifiedUserContext`
- `user-context-builder.service.ts`: 返回类型改为 `UnifiedUserContext`
- `food-decision.service.ts`: 移除内部 `UserContext`，引用 `UnifiedUserContext`
- `contextual-modifier.service.ts`: 参数类型更新

---

## Step 3: 决策系统优化设计

### 3.1 应用 scoreMultiplier

**问题**: `ContextualDecisionModifierService` 返回 `scoreMultiplier` 但 `FoodDecisionService.computeFullDecision` 忽略它。

**方案**:

在 `computeFullDecision` 中，获取 `contextualModification` 后，将 `scoreMultiplier` 应用到 `healthScore`：

```typescript
const modification = await this.contextualModifier.computeModification(...);
const adjustedScore = decision.healthScore * (modification?.scoreMultiplier ?? 1);
// 用 adjustedScore 重新判定 decisionLevel
const adjustedLevel = scoreToDecisionLevel(adjustedScore, thresholds);
```

这确保深夜进食、累积过量等上下文因素真正影响最终决策。

**文件变更**:

- `food-decision.service.ts`: `computeFullDecision` 中应用 multiplier

### 3.2 消除 computeDecision / identifyIssues 逻辑重复

**问题**: 过敏原检查、热量超标检查、蛋白质不足检查在 `computeDecision` 和 `identifyIssues` 中各实现一次。

**方案**:

提取共享检查函数到 `decision-checks.ts`：

```typescript
// 新文件: food/app/decision/decision-checks.ts
export function checkAllergenConflict(foods, allergens, locale?): CheckResult | null;
export function checkCalorieOverrun(totals, ctx, locale?): CheckResult | null;
export function checkProteinDeficit(totals, ctx, locale?): CheckResult | null;
export function checkFatExcess(totals, ctx, locale?): CheckResult | null;
export function checkCarbExcess(totals, ctx, locale?): CheckResult | null;
export function checkHealthConditionRisk(foods, totals, conditions, locale?): CheckResult | null;

export interface CheckResult {
  triggered: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  decisionOverride?: 'avoid' | 'caution'; // 如果需要覆盖决策
  issue?: DietIssue; // 对应的问题记录
  reason?: string; // 解释文本
}
```

`computeDecision` 和 `identifyIssues` 都调用这些共享函数，消除重复。

**文件变更**:

- 新建 `food/app/decision/decision-checks.ts`
- `food-decision.service.ts`: 重构 computeDecision 和 identifyIssues 调用共享函数

### 3.3 正向反馈机制

**问题**: `ContextualDecisionModifierService` 只有惩罚性修正，无正向激励。

**方案**:

在 `computeModification` 中新增正向修正：

```typescript
// 连续健康饮食奖励
if (streaks.healthyDays >= 3) {
  scoreMultiplier *= 1.05;  // 适度放宽，鼓励持续
  reasons.push({ type: 'positive_streak', message: ... });
}

// 今日均衡饮食奖励（如果前几餐宏量均衡）
if (todayMacroBalance > 0.8) {
  scoreMultiplier *= 1.03;
  reasons.push({ type: 'balanced_day', message: ... });
}
```

Multiplier 上限调整为 `[0.5, 1.08]`。

**文件变更**:

- `contextual-modifier.service.ts`: 新增正向修正逻辑，调整 clamp 上限

---

## Step 4: AI教练系统优化设计

### 4.1 分析→教练自动桥接

**问题**: 分析完成事件无人监听，教练无法自动获取分析上下文。

**方案**:

在 `CoachService` 中监听 `ANALYSIS_COMPLETED` 事件，缓存最新分析结果：

```typescript
@OnEvent('food.analysis.completed')
handleAnalysisCompleted(payload: { userId: string; result: FoodAnalysisResultV61 }) {
  this.latestAnalysisCache.set(payload.userId, {
    result: payload.result,
    timestamp: Date.now(),
  });
}
```

在 `prepareContext` 中，如果 `analysisContext` 未显式传入，自动从缓存获取（5分钟内有效）：

```typescript
if (!analysisContext) {
  const cached = this.latestAnalysisCache.get(userId);
  if (cached && Date.now() - cached.timestamp < 5 * 60 * 1000) {
    analysisContext = cached.result;
  }
}
```

**文件变更**:

- `coach.service.ts`: 新增 `@OnEvent` 处理器 + 内存缓存
- `coach.module.ts`: 确保 EventEmitter2 可用

### 4.2 Prompt token 安全

**问题**: `CoachPromptBuilderService` 的 prompt 无限增长，可能超出模型 context window。

**方案**:

新增 `estimateTokenCount(text: string): number` 工具函数（简单估算：中文字符×1.5 + 英文单词×1.3），在 `buildSystemPrompt` 末尾检查：

```typescript
const estimated = estimateTokenCount(prompt);
if (estimated > MAX_SYSTEM_PROMPT_TOKENS) {
  prompt = this.truncatePrompt(prompt, MAX_SYSTEM_PROMPT_TOKENS);
}
```

截断策略：优先保留 profile + today summary + restrictions，截断 7日历史和行为洞察。

**文件变更**:

- `coach-prompt-builder.service.ts`: 新增 token 估算和截断逻辑

---

## Step 5: 决策链路设计

### 完整链路（V2.0）

```
用户输入（文本/图片）
  │
  ├─ TextFoodAnalysisService.analyze()
  │  └─ 食物识别 → 营养估算 → AnalyzedFoodItem[]
  │
  ├─ ImageFoodAnalysisService.analyzeToV61()
  │  └─ 视觉模型 → 营养估算 → AnalyzedFoodItem[]
  │
  ▼
UserContextBuilderService.build()      ← 统一入口（文本/图片共用）
  └─ 并行获取: 今日摄入 + 用户画像 + 营养目标
  └─ 输出: UnifiedUserContext
  │
  ▼
FoodScoringService.calculateScore()
  └─ NutritionScore 7维评分 + quality/satiety
  └─ 输出: ScoringResult { healthScore, breakdown }
  │
  ▼
FoodDecisionService.computeFullDecision()
  ├─ computeDecision(): score → DecisionLevel（目标差异化阈值）
  │  └─ decision-checks.ts 共享检查（过敏/超标/健康）
  ├─ ContextualModifierService: scoreMultiplier 应用 ← V2.0 修复
  │  └─ 正向反馈（连续健康/均衡饮食）← V2.0 新增
  ├─ identifyIssues(): 结构化问题识别
  │  └─ decision-checks.ts 共享检查（消除重复）
  ├─ DecisionExplainerService: 决策链 + 解释
  ├─ AlternativeSuggestionService: 替代方案
  └─ 输出: DecisionOutput → FoodAnalysisResultV61
  │
  ▼
EventEmitter: 'food.analysis.completed'  ← 文本+图片统一发射
  │
  ▼
CoachService（自动桥接）
  ├─ @OnEvent 缓存最新分析结果
  ├─ prepareContext(): 自动注入分析上下文
  ├─ CoachPromptBuilderService: 构建 prompt（带 token 安全）
  └─ SSE 流式输出
```

---

## Step 6: API能力设计

### 可复用（无需修改）

| API                                    | 用途              |
| -------------------------------------- | ----------------- |
| `NutritionScoreService.calculateScore` | 7维评分引擎       |
| `BehaviorService.*`                    | 行为数据查询      |
| `FoodService.*`                        | 今日摄入/目标查询 |
| `UserProfileService.*`                 | 用户画像查询      |
| `SubstitutionService.findSubstitutes`  | 推荐引擎替代      |
| `FoodLibraryService.*`                 | 食物库查询        |

### 需修改

| 服务                                                      | 修改内容                             |
| --------------------------------------------------------- | ------------------------------------ |
| `UserContextBuilderService.build()`                       | 返回 `UnifiedUserContext`            |
| `FoodDecisionService.computeFullDecision()`               | 应用 scoreMultiplier，调用共享检查   |
| `FoodDecisionService.computeDecision()`                   | 重构为调用 decision-checks           |
| `FoodDecisionService.identifyIssues()`                    | 重构为调用 decision-checks           |
| `ContextualDecisionModifierService.computeModification()` | 新增正向反馈                         |
| `ImageFoodAnalysisService.analyzeToV61()`                 | 用 UserContextBuilder + EventEmitter |
| `TextFoodAnalysisService.analyze()`                       | 移除 SubstitutionService             |
| `CoachService.prepareContext()`                           | 自动注入分析上下文                   |
| `CoachPromptBuilderService.buildSystemPrompt()`           | token 安全                           |

### 需新增

| 新文件               | 用途               |
| -------------------- | ------------------ |
| `decision-checks.ts` | 共享决策检查纯函数 |

---

## Step 7: 数据结构设计

### 7.1 UnifiedUserContext（新增）

见 Step 2.2，统一所有服务使用的用户上下文接口。

### 7.2 CheckResult（新增）

```typescript
export interface CheckResult {
  triggered: boolean;
  severity: 'low' | 'medium' | 'high' | 'critical';
  decisionOverride?: 'avoid' | 'caution';
  issue?: DietIssue;
  reason?: string;
}
```

### 7.3 ContextualModification 扩展

现有 `ContextualModification` 的 `reasons` 新增 type 枚举值：

```typescript
type ContextualReasonType =
  | 'cumulative_excess'
  | 'late_night'
  | 'multi_day_excess'
  | 'binge_risk'
  | 'positive_streak' // V2.0 新增
  | 'balanced_day'; // V2.0 新增
```

### 7.4 不修改的数据结构

- `FoodAnalysisResultV61`: 保持不变，已足够丰富
- `FoodDecision`: 保持不变
- `DietIssue`: 保持不变
- `DecisionChainStep`: 保持不变
- 数据库 schema: 不修改

---

## Step 8: 分阶段迭代计划

### Phase 1: 核心缺陷修复（4个目标）

> 目标: 修复已知 bug 和类型问题，确保决策链路数据正确流通

| #   | 任务                                            | 文件                                                                                                                | 优先级 |
| --- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| 1.1 | 统一 UserContext → UnifiedUserContext           | analysis-result.types.ts, user-context-builder.service.ts, food-decision.service.ts, contextual-modifier.service.ts | P0     |
| 1.2 | 应用 scoreMultiplier 到决策                     | food-decision.service.ts                                                                                            | P0     |
| 1.3 | 提取 decision-checks.ts 消除重复                | 新建 decision-checks.ts, 重构 food-decision.service.ts                                                              | P0     |
| 1.4 | 移除 text service 的 SubstitutionService 死依赖 | text-food-analysis.service.ts, food.module.ts                                                                       | P0     |

**验证**: `npx tsc --noEmit --project apps/api-server/tsconfig.build.json`

### Phase 2: 分析路径统一 + 正向反馈（4个目标）

> 目标: 图片/文本路径行为一致，上下文修正更完善

| #   | 任务                                                     | 文件                                           | 优先级 |
| --- | -------------------------------------------------------- | ---------------------------------------------- | ------ |
| 2.1 | 图片服务统一使用 UserContextBuilderService               | image-food-analysis.service.ts                 | P0     |
| 2.2 | 图片服务注入 EventEmitter + 发射事件                     | image-food-analysis.service.ts, food.module.ts | P1     |
| 2.3 | 图片服务移除重复 PERSONA_PROMPTS，使用 coach-tone.config | image-food-analysis.service.ts                 | P1     |
| 2.4 | 上下文修正器新增正向反馈                                 | contextual-modifier.service.ts                 | P1     |

**验证**: `npx tsc --noEmit --project apps/api-server/tsconfig.build.json`

### Phase 3: 教练增强（2个目标）

> 目标: 教练自动获取分析上下文，prompt 安全

| #   | 任务                                 | 文件                              | 优先级 |
| --- | ------------------------------------ | --------------------------------- | ------ |
| 3.1 | CoachService 监听分析事件 + 自动桥接 | coach.service.ts, coach.module.ts | P1     |
| 3.2 | Prompt token 估算和截断              | coach-prompt-builder.service.ts   | P1     |

**验证**: `npx tsc --noEmit --project apps/api-server/tsconfig.build.json`

---

## 约束条件

- **禁止修改**: 推荐系统、用户画像系统、订阅/商业化逻辑、数据库字段（只读）
- **替代方案**: 必须结合推荐引擎，不写死
- **构建验证**: 每次修改后执行 TypeScript 编译检查
- **向后兼容**: 所有 API 输出格式保持 `FoodAnalysisResultV61` 不变
