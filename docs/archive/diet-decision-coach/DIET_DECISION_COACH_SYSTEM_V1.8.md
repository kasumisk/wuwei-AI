# 饮食决策 + AI教练系统 V1.8 设计文档

> 版本: V1.8  
> 基于: V1.7（评分定量化 + 问题结构化 + 宏量进度 + Coach 国际化）  
> 目标: 架构解耦 + 评分精度提升 + 行为感知决策 + 替代方案增强

---

## 一、当前系统能力评估

### 已具备能力（V1.7）

| 层级   | 能力                                      | 状态     |
| ------ | ----------------------------------------- | -------- |
| 分析层 | 文本/图片食物识别 + 营养估算              | ✅ 成熟  |
| 分析层 | 食物库匹配 + 模糊搜索 + LLM fallback      | ✅ 成熟  |
| 评分层 | 7维 NutritionScore 引擎评分               | ✅ 成熟  |
| 评分层 | 目标差异化权重                            | ✅ 成熟  |
| 评分层 | 评分定量化解释（actualValue/targetValue） | ✅ V1.7  |
| 决策层 | 三档决策（recommend/caution/avoid）       | ✅ 成熟  |
| 决策层 | 目标差异化阈值                            | ✅ V1.7  |
| 决策层 | 上下文修正（时间/餐次/预算/过敏/健康）    | ✅ 成熟  |
| 决策层 | 结构化问题识别（DietIssue）               | ✅ V1.7  |
| 决策层 | 宏量进度汇总                              | ✅ V1.7  |
| 决策层 | 决策推理链 + 维度解释                     | ✅ V1.6  |
| 替代层 | 推荐引擎优先 + 静态 fallback              | ✅ V1.1+ |
| 替代层 | 定量对比（caloriesDiff/proteinDiff）      | ✅ V1.7  |
| 教练层 | SSE 流式对话 + 分析上下文注入             | ✅ 成熟  |
| 教练层 | 个性化语气（strict/friendly/data）        | ✅ 成熟  |
| 教练层 | 上下文国际化                              | ✅ V1.7  |

### 识别的缺失点

| #   | 缺失点                                                                     | 影响                             | 严重程度 |
| --- | -------------------------------------------------------------------------- | -------------------------------- | -------- |
| 1   | **循环依赖**: FoodScoringService ↔ FoodDecisionService                     | 架构腐化、测试困难               | 高       |
| 2   | **DIMENSION_LABELS 三处重复**: scoring + decision + explainer              | 维护成本、一致性风险             | 高       |
| 3   | **UserContext 三处独立构建**: text/image/coach 各自实现                    | 逻辑分散、行为不一致             | 高       |
| 4   | **stability 维度数据缺失**: 未传递 streakDays/avgMeals 给评分引擎          | 稳定性维度始终默认80分           | 中       |
| 5   | **GI 数据未填充**: glycemicIndex 未从食物库传递                            | 血糖影响维度始终默认75分         | 中       |
| 6   | **SubstitutionService 调用不完整**: 缺少 userConstraints/preferenceProfile | 替代方案忽略过敏/偏好过滤        | 中       |
| 7   | **historicalCount/crossCategory 元数据丢失**                               | 替代方案可解释性弱               | 低       |
| 8   | **暴食风险时段未纳入决策**                                                 | 已有 bingeRiskHours 数据但未使用 | 中       |
| 9   | **多日趋势未纳入决策**                                                     | 连续超标无法识别                 | 中       |
| 10  | **静态替代规则全中文**                                                     | 国际化缺口                       | 低       |

---

## 二、V1.8 优化目标（6个）

### 目标 1: 打破循环依赖 + 提取共享常量

- 将 `estimateQuality()`/`estimateSatiety()` 从 FoodDecisionService 提取到独立的 `NutritionEstimator`（纯函数工具）
- 将 `DIMENSION_LABELS` 提取到 `config/scoring-dimensions.ts` 共享常量文件
- FoodScoringService 不再依赖 FoodDecisionService

### 目标 2: 统一 UserContext 构建

- 新增 `UserContextBuilder` 服务，统一文本/图片/决策路径的 UserContext 构建
- 单一数据源：profile + todaySummary + goals + behavior → UserContext
- 消除 text/image 两个分析服务中的重复 `buildUserContext()` 逻辑

### 目标 3: 评分精度提升 — stability + GI 真实数据

- 从 BehaviorService 获取 streakDays + avgMealsPerDay，传递给 calculateMealScore
- 从食物库匹配中提取 glycemicIndex，传递给评分引擎
- 消除 stability=80、glycemicImpact=75 的默认值掩盖问题

### 目标 4: 替代方案增强 — SubstitutionService 全参数调用

- 传递 userConstraints（allergens/dietaryRestrictions）和 preferenceProfile（loves/avoids）
- 保留 historicalCount + crossCategory 元数据到 FoodAlternative
- 替代方案可解释性增强

### 目标 5: 行为感知决策 — 暴食风险 + 多日趋势

- bingeRiskHours 纳入 issues 检测
- getRecentSummaries(3) 检测连续超标模式
- 新增 DietIssue category: `binge_risk` / `multi_day_excess`

### 目标 6: 静态替代规则国际化

- `alternative-food-rules.ts` 食物名称和 reason 改为 i18n key
- 新增 `decision.staticAlt.*` i18n 条目（三语言）

---

## 三、架构变更

### V1.8 目标目录结构

```
food/app/
├── config/
│   ├── alternative-food-rules.ts        ← 静态替代规则（国际化）
│   └── scoring-dimensions.ts            ← 【新增】共享维度常量
├── scoring/
│   ├── food-scoring.service.ts          ← 评分门面（不再依赖 FoodDecisionService）
│   └── nutrition-estimator.ts           ← 【新增】质量/饱腹估算（纯函数）
├── decision/
│   ├── food-decision.service.ts         ← 核心决策（行为感知增强）
│   ├── alternative-suggestion.service.ts ← 替代建议（SubstitutionService 全参数）
│   ├── decision-explainer.service.ts    ← 决策解释（引用共享常量）
│   └── user-context-builder.service.ts  ← 【新增】统一 UserContext 构建
├── services/
│   ├── text-food-analysis.service.ts    ← 委托 UserContextBuilder
│   ├── image-food-analysis.service.ts   ← 委托 UserContextBuilder
│   └── ...
├── types/
│   └── analysis-result.types.ts         ← 类型增强
```

### 依赖关系变更

**Before (V1.7):**

```
FoodScoringService → FoodDecisionService.estimateQuality/Satiety (循环!)
FoodDecisionService → FoodScoringService.explainBreakdown
TextFoodAnalysisService → [inline buildUserContext]
ImageFoodAnalysisService → [inline buildUserContext]
```

**After (V1.8):**

```
FoodScoringService → NutritionEstimator (纯函数, 无循环)
FoodDecisionService → FoodScoringService.explainBreakdown (单向)
FoodDecisionService → UserContextBuilder (统一)
TextFoodAnalysisService → UserContextBuilder (委托)
ImageFoodAnalysisService → UserContextBuilder (委托)
Both → config/scoring-dimensions.ts (共享常量)
```

---

## 四、分阶段实施计划

### Phase 1: 架构解耦

**1.1 提取共享维度常量**

- 新建 `config/scoring-dimensions.ts`
- 移入 `DIMENSION_LABELS`（三语言）、impact 阈值常量
- FoodScoringService / FoodDecisionService / DecisionExplainerService 统一引用

**1.2 提取营养估算工具**

- 新建 `scoring/nutrition-estimator.ts`
- 移入 `estimateQuality()` + `estimateSatiety()` 为纯导出函数
- FoodScoringService 直接导入（打破对 FoodDecisionService 的依赖）
- FoodDecisionService 保留引用（向后兼容）

**1.3 统一 UserContext 构建**

- 新建 `decision/user-context-builder.service.ts`
- 提取 text/image 分析服务中的 `buildUserContext()` 公共逻辑
- 注入 UserProfileService + FoodService + NutritionScoreService + BehaviorService
- TextFoodAnalysisService / ImageFoodAnalysisService 委托调用

### Phase 2: 评分精度 + 替代方案增强

**2.1 stability 维度真实数据**

- UserContextBuilder 获取 streakDays + 计算 avgMealsPerDay（来自 getRecentSummaries）
- 传递 `stabilityData: { streakDays, avgMealsPerDay, targetMeals: 3 }` 给 calculateMealScore

**2.2 GI 数据填充**

- 食物库匹配时提取 `glycemicIndex` 字段（如果存在）
- 传递给 NutritionInput 的 `glycemicIndex` 和 `carbsPerServing`
- 无 GI 数据时保持现有默认行为

**2.3 SubstitutionService 全参数调用**

- AlternativeSuggestionService 接收 allergens/dietaryRestrictions/foodPreferences
- 构建 `userConstraints` 和 `preferenceProfile` 传给 findSubstitutes
- FoodAlternative 类型新增 `historicalCount?: number` + `crossCategory?: boolean`

### Phase 3: 行为感知决策 + 国际化

**3.1 暴食风险时段检测**

- identifyIssues() 检查当前 localHour 是否在 bingeRiskHours 中
- 新增 DietIssue category `binge_risk`（severity: warning）

**3.2 多日趋势检测**

- FoodDecisionService 通过 FoodService.getRecentSummaries(3) 获取近3天数据
- 检测连续超标（calories > 105% 连续2天+）
- 新增 DietIssue category `multi_day_excess`（severity: warning）

**3.3 静态替代规则国际化**

- alternative-food-rules.ts 的 name/reason 改为 i18n key 引用
- AlternativeSuggestionService 在生成时解析 key → 本地化文本
- 新增三语言 `decision.staticAlt.*` 条目（本地 i18n 映射，不修改 diet 模块 i18n）

---

## 五、类型变更

### FoodAlternative 增强（Phase 2.3）

```typescript
export interface FoodAlternative {
  name: string;
  reason: string;
  foodLibraryId?: string;
  score?: number;
  comparison?: AlternativeComparison;
  // V1.8: 替代元数据
  historicalCount?: number; // 用户历史选择次数
  crossCategory?: boolean; // 是否跨分类替代
}
```

### DietIssue category 扩展（Phase 3）

新增：

- `binge_risk` — 当前时段为用户暴食风险时段
- `multi_day_excess` — 连续多日热量超标

### UserContext 增强（Phase 1.3）

```typescript
export interface UserContext {
  // ... existing fields ...
  // V1.8: 行为数据增强
  bingeRiskHours?: number[];
  streakDays?: number;
  avgMealsPerDay?: number;
  recentDailyCalories?: number[]; // 近3天每日热量
}
```

---

## 六、禁止修改范围确认

- ❌ 推荐系统（只读 SubstitutionService.findSubstitutes）
- ❌ 用户画像系统（只读 UserProfileService / BehaviorService）
- ❌ 订阅/商业化逻辑
- ❌ 数据库 schema（无新字段）
- ❌ diet 模块 i18n 文件（新 i18n 条目使用本地映射）

---

## 七、预期收益

| 优化项                     | 收益                                           |
| -------------------------- | ---------------------------------------------- |
| 打破循环依赖               | 可独立测试 FoodScoringService，消除架构腐化    |
| 共享常量                   | 维度标签一处维护，三处引用，零不一致风险       |
| 统一 UserContext           | 消除 ~200 行重复代码，text/image 行为一致      |
| stability 真实数据         | 稳定性维度反映用户真实打卡习惯（而非固定80分） |
| GI 数据填充                | 血糖影响维度从默认75分变为真实计算             |
| SubstitutionService 全参数 | 替代方案自动过滤过敏原、优先用户偏好           |
| 暴食风险检测               | 在用户高风险时段主动预警                       |
| 多日趋势                   | 识别持续超标模式，调整建议强度                 |
| 替代规则国际化             | 日/英用户看到本地化替代建议                    |
