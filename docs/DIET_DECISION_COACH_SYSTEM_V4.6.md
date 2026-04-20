# 饮食决策 + AI教练系统 V4.6 — 设计文档

> 版本: V4.6 | 作者: 系统架构师 | 日期: 2026-04-20
> 基于 V4.5 迭代升级，核心目标：**统一分析提示词、三层解耦、推荐引擎替代、i18n 整理**

---

## 一、V4.5 → V4.6 变更总览

### 1.1 核心问题

| 问题                         | 现状                                                      | V4.6 目标                                                                |
| ---------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------ |
| **分析提示词割裂**           | 文本/图片各自独立 prompt，字段不一致                      | 统一 prompt schema，以食物库 90+ 字段为标准，大幅扩展分析字段            |
| **分析 vs 评分 vs 决策耦合** | AnalysisPipeline 783 行串行三阶段                         | 分析/评分/决策三层职责清晰解耦，参考推荐系统 pipeline 架构               |
| **替代方案硬编码**           | `alternative-food-rules.ts` 380 行静态食物名              | 全部走 SubstitutionService，静态规则仅作 fallback schema（不含具体食物） |
| **i18n 混乱**                | `decision-checks.ts` 有 44 处 `t()` 调用（推荐系统 i18n） | 全部迁移到 `cl()` from decision-labels                                   |
| **可解释性分散**             | 冲突信息散落多处                                          | ConflictReport 增强 + 统一解释链                                         |

### 1.2 约束（不变）

- ❌ 不修改推荐系统、用户画像系统（只读）
- ❌ 不增加数据库字段
- ❌ 不增加新模块
- ❌ 不兼容旧代码（项目未上线）
- ✅ i18n: `cl()`/`ci()` only，禁止新增 `t()` 调用

---

## 二、统一分析 Prompt Schema（V4.6 核心）

### 2.1 设计原则

- **以食物库为标准**：prompt 要求返回的字段尽可能覆盖食物库关键营养/健康字段
- **per-serving 返回**：LLM 估算实际份量营养（与 V4.5 一致）
- **文本/图片完全共享 schema**：只有 input 部分不同（文本描述 vs 图片识别指令）
- **移除决策字段**：LLM 只做营养分析，决策由 pipeline 完成
- **不兼容旧字段**：移除 `quality`/`satiety` deprecated 别名

### 2.2 扩展后的统一输出 Schema

```typescript
/**
 * V4.6: 统一 LLM 食物分析输出（文本/图片共用）
 * 以食物库 Foods 表字段为标准，大幅扩展营养和健康指标
 */
interface UnifiedParsedFood {
  // === 基础标识 ===
  name: string; // 食物名（用户语言）
  nameEn: string; // 英文名（用于食物库匹配）
  quantity: string; // 份量描述（"1碗", "2片"）
  estimatedWeightGrams: number; // 估算克重
  standardServingG: number; // 标准一人份克数
  standardServingDesc: string; // 标准份量描述（"1碗约200g"）
  category: FoodCategory; // 统一英文编码

  // === 宏量营养素（per serving）===
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  fiber: number | null;
  sugar: number | null; // 总糖
  addedSugar: number | null; // 添加糖
  saturatedFat: number | null;
  transFat: number | null; // V4.6 新增：反式脂肪
  cholesterol: number | null; // V4.6 新增：胆固醇 (mg)
  sodium: number | null;

  // === 脂肪酸细分（per serving）===
  omega3: number | null; // V4.6 新增：Omega-3 (mg)
  omega6: number | null; // V4.6 新增：Omega-6 (mg)

  // === 纤维细分 ===
  solubleFiber: number | null; // V4.6 新增：可溶性纤维 (g)

  // === 微量营养素（per serving）===
  vitaminA: number | null; // μg RAE
  vitaminC: number | null; // mg
  vitaminD: number | null; // V4.6 新增：μg
  calcium: number | null; // mg
  iron: number | null; // mg
  potassium: number | null; // V4.6 新增：mg
  zinc: number | null; // V4.6 新增：mg

  // === 健康指标 ===
  glycemicIndex: number | null; // 0-100
  glycemicLoad: number | null; // V4.6 新增：GL = GI × 可用碳水(g) / 100
  processingLevel: 1 | 2 | 3 | 4; // NOVA 分级
  qualityScore: number; // 1-10
  satietyScore: number; // 1-10
  nutrientDensity: number | null; // V4.6 新增：营养密度 0-10

  // === 特殊风险标记 ===
  fodmap: 'low' | 'medium' | 'high' | null; // V4.6 新增
  oxalate: 'low' | 'medium' | 'high' | null; // V4.6 新增
  purine: 'low' | 'medium' | 'high' | null; // V4.6 新增

  // === 安全 ===
  allergens: string[]; // Big-9 过敏原
  tags: string[]; // 标签（如 'organic', 'fried', 'raw'）

  // === 烹饪/实用 ===
  cookingMethods: string[]; // V4.6 新增：烹饪方式
  ingredientList: string[]; // V4.6 新增：主要成分

  // === 元数据 ===
  confidence: number; // 0-1 识别信心
  estimated: boolean; // 是否为估算值
}
```

### 2.3 相比 V4.5 新增字段（17 个）

| 字段                        | 来源                     | 用途                     |
| --------------------------- | ------------------------ | ------------------------ |
| `nameEn`                    | LLM 翻译                 | 食物库精确匹配           |
| `standardServingDesc`       | LLM 估算                 | 前端展示                 |
| `transFat`                  | 食物库 `transFat`        | 心血管风险评估           |
| `cholesterol`               | 食物库 `cholesterol`     | 心血管/高血脂检查        |
| `omega3`/`omega6`           | 食物库 omega 字段        | 脂肪酸平衡评分           |
| `solubleFiber`              | 食物库 `solubleFiber`    | 消化健康评估             |
| `vitaminD`                  | 食物库 `vitaminD`        | 骨骼健康                 |
| `potassium`/`zinc`          | 食物库对应字段           | 微量营养评估             |
| `glycemicLoad`              | 食物库 `glycemicLoad`    | 血糖管理（比 GI 更准确） |
| `nutrientDensity`           | 食物库 `nutrientDensity` | 评分加权                 |
| `fodmap`/`oxalate`/`purine` | 食物库对应字段           | IBS/肾结石/痛风风险      |
| `cookingMethods`            | LLM 识别                 | 烹饪方式对营养影响评估   |
| `ingredientList`            | LLM 识别                 | 复合菜拆解               |

### 2.4 移除的字段

| 旧字段        | 原因                                           |
| ------------- | ---------------------------------------------- |
| `quality`     | 统一为 `qualityScore`，不兼容旧代码            |
| `satiety`     | 统一为 `satietyScore`，不兼容旧代码            |
| `isProcessed` | 由 `processingLevel` 替代（`>= 3` 即加工食品） |

### 2.5 AnalyzedFoodItem 类型同步更新

```typescript
export interface AnalyzedFoodItem {
  name: string;
  normalizedName?: string;
  nameEn?: string; // V4.6
  foodLibraryId?: string;
  candidateId?: string;
  quantity?: string;
  estimatedWeightGrams?: number;
  standardServingG?: number; // V4.6: 提升为显式字段
  standardServingDesc?: string; // V4.6
  category?: string;
  confidence: number;

  // 宏量营养素
  calories: number;
  protein?: number;
  fat?: number;
  carbs?: number;
  fiber?: number;
  sodium?: number;
  sugar?: number | null;
  saturatedFat?: number | null;
  addedSugar?: number | null;
  transFat?: number | null; // V4.6
  cholesterol?: number | null; // V4.6

  // 脂肪酸
  omega3?: number | null; // V4.6
  omega6?: number | null; // V4.6

  // 纤维细分
  solubleFiber?: number | null; // V4.6

  // 微量营养素
  vitaminA?: number | null;
  vitaminC?: number | null;
  vitaminD?: number | null; // V4.6
  calcium?: number | null;
  iron?: number | null;
  potassium?: number | null; // V4.6
  zinc?: number | null; // V4.6

  // 健康指标
  glycemicIndex?: number;
  glycemicLoad?: number | null; // V4.6
  processingLevel?: number;
  qualityScore?: number;
  satietyScore?: number;
  nutrientDensity?: number | null; // V4.6
  estimated?: boolean;

  // 风险标记
  fodmap?: 'low' | 'medium' | 'high' | null; // V4.6
  oxalate?: 'low' | 'medium' | 'high' | null; // V4.6
  purine?: 'low' | 'medium' | 'high' | null; // V4.6

  // 安全
  allergens?: string[];
  tags?: string[];

  // 烹饪/实用
  cookingMethods?: string[]; // V4.6
  ingredientList?: string[]; // V4.6

  // === 移除 ===
  // quality (使用 qualityScore)
  // satiety (使用 satietyScore)
  // isProcessed (使用 processingLevel >= 3)
}
```

---

## 三、三层解耦架构

### 3.1 当前问题

`AnalysisPipelineService` 783 行包含分析→评分→决策全链路，职责过重。

### 3.2 解耦后架构

```
用户输入（文本/图片）
    │
    ▼
┌─ 分析层 (Analyze) ──────────────────────────────┐
│ TextFoodAnalysisService / ImageFoodAnalysisService │
│ → UnifiedParsedFood[] → AnalyzedFoodItem[]        │
│ → NutritionSanityValidator 校验                    │
│ → 食物库匹配 + 字段补全                            │
│ → NutritionAggregator → NutritionTotals            │
│ → UserContextBuilder → UnifiedUserContext           │
│ 输出: AnalysisOutput { foods, totals, context }    │
└───────────────────────┬──────────────────────────┘
                        ▼
┌─ 评分层 (Score) ────────────────────────────────┐
│ FoodScoringService（已存在，增强）                  │
│ → 7维评分 + 用户画像加权                           │
│ → 健康状况调整                                     │
│ → 置信度衰减                                       │
│ → 上下文分析（macroSlot, issues）                  │
│ 输出: ScoringOutput { score, contextualAnalysis }  │
└───────────────────────┬──────────────────────────┘
                        ▼
┌─ 决策层 (Decide) ───────────────────────────────┐
│ DecisionEngineService（已存在，增强）               │
│ → computeDecision（3级判定）                       │
│ → computeStructuredDecision（4因子）               │
│ → ConflictReport（冲突检测）                       │
│ → AlternativeSuggestionService（推荐引擎驱动）     │
│ → DecisionSummary                                  │
│ 输出: DecisionOutput { decision, structured, ... } │
└───────────────────────┬──────────────────────────┘
                        ▼
┌─ 教练层 (Coach) ────────────────────────────────┐
│ DecisionCoachService（已存在，增强）                │
│ → 语气选择 + ActionPlan 生成                       │
│ → 个性化引导（结合行为画像）                       │
│ → 结构化输出                                       │
│ 输出: CoachingExplanation + CoachActionPlan         │
└──────────────────────────────────────────────────┘
```

### 3.3 解耦实施策略

**不新建服务类**，在现有 `AnalysisPipelineService` 中将三阶段方法明确拆分为独立的 `private` 方法组：

```typescript
class AnalysisPipelineService {
  // Phase 1: 分析
  private async runAnalysis(input): Promise<AnalysisPhaseResult> { ... }

  // Phase 2: 评分
  private async runScoring(analysis, context): Promise<ScoringPhaseResult> { ... }

  // Phase 3: 决策
  private async runDecision(analysis, scoring, context): Promise<DecisionPhaseResult> { ... }

  // Phase 4: 教练（后处理）
  private async runCoaching(analysis, scoring, decision, context): Promise<CoachPhaseResult> { ... }

  // 主入口
  async execute(input): Promise<FoodAnalysisResultV61> {
    const analysis = await this.runAnalysis(input);
    const scoring = await this.runScoring(analysis, analysis.context);
    const decision = await this.runDecision(analysis, scoring, analysis.context);
    const coaching = await this.runCoaching(analysis, scoring, decision, analysis.context);
    return this.assembleResult(analysis, scoring, decision, coaching);
  }
}
```

### 3.4 Phase 中间类型

```typescript
/** 分析阶段输出 */
interface AnalysisPhaseResult {
  foods: AnalyzedFoodItem[];
  totals: NutritionTotals;
  context: UnifiedUserContext;
  inputSnapshot: AnalysisInputSnapshot;
}

/** 评分阶段输出 */
interface ScoringPhaseResult {
  score: AnalysisScore;
  contextualAnalysis: ContextualAnalysis;
  confidenceDiagnostics: ConfidenceDiagnostics;
}

/** 决策阶段输出 */
interface DecisionPhaseResult {
  decision: FoodDecision;
  structuredDecision: StructuredDecision;
  summary: DecisionSummary;
  alternatives: FoodAlternative[];
  shouldEatAction: ShouldEatAction;
  evidencePack: EvidencePack;
}

/** 教练阶段输出 */
interface CoachPhaseResult {
  coachActionPlan: CoachActionPlan;
  explanation: AnalysisExplanation;
}
```

---

## 四、替代方案：推荐引擎驱动

### 4.1 当前问题

`alternative-food-rules.ts` 有 380 行硬编码食物名（鸡胸肉、糙米、希腊酸奶等），6 个品类规则 + 7 个目标规则，每个规则含 2-3 个三语言硬编码替代食物。

### 4.2 V4.6 方案

**层级降级策略**（保留但重构）:

```
Level 1: SubstitutionService.findSubstitutes()  ← 推荐引擎（首选）
Level 2: RecommendationEngineService             ← 推荐 pipeline（备选）
Level 3: 规则化 fallback schema（无具体食物名）  ← 最低优先级
```

**Level 3 重构**：`alternative-food-rules.ts` 从硬编码食物名改为**约束 schema**：

```typescript
// V4.6: 替代规则不再含具体食物名，只定义营养约束
interface AlternativeRuleV46 {
  id: string;
  trigger: { categories?: string[]; goals?: string[]; minCalories?: number; ... };
  // 替代约束（传递给推荐引擎的查询条件）
  substitutionConstraints: {
    preferCategories?: string[];       // 推荐品类
    maxCaloriesRatio?: number;         // 相对原食物的热量比上限
    minProteinRatio?: number;          // 蛋白质比下限
    preferTags?: string[];             // 偏好标签
    avoidTags?: string[];              // 排除标签
    processingLevelMax?: number;       // NOVA 上限
  };
  // 仅在推荐引擎全部失败时，用品类级泛化建议
  fallbackHint: Record<'zh-CN' | 'en-US' | 'ja-JP', string>;
}
```

### 4.3 AlternativeSuggestionService 改造

```typescript
async generateAlternatives(params): Promise<FoodAlternative[]> {
  // 1. 推荐引擎查询
  const engineResults = await this.trySubstitutionEngine(params);
  if (engineResults.length >= 2) return this.rankAndFormat(engineResults);

  // 2. 推荐 pipeline 补充
  const pipelineResults = await this.tryRecommendationPipeline(params);
  const combined = [...engineResults, ...pipelineResults];
  if (combined.length >= 2) return this.rankAndFormat(combined);

  // 3. 规则约束 + 食物库搜索（不含硬编码食物名）
  const ruleResults = await this.tryRuleBasedSearch(params);
  return this.rankAndFormat([...combined, ...ruleResults]);
}
```

---

## 五、i18n 整理

### 5.1 核心任务

`decision-checks.ts` 有 **44 处 `t()` 调用**（from `i18n-messages.ts`，属于推荐系统），需全部迁移到 `cl()` from `decision-labels.ts`。

### 5.2 迁移策略

1. 提取 `decision-checks.ts` 中所有 `t()` 调用的 key
2. 在 `labels-zh.ts` / `labels-en.ts` / `labels-ja.ts` 中添加对应翻译
3. 替换所有 `t(key, vars, locale)` 为 `cl(key, locale, vars)`
4. 移除 `import { t, Locale } from '../../diet/app/recommendation/utils/i18n-messages'`
5. tsc 验证

### 5.3 t() key 清单（需迁移到 cl()）

| 现有 t() key                              | 出现次数 | 新 cl() key                    |
| ----------------------------------------- | -------- | ------------------------------ |
| `decision.context.overBudget`             | 4        | `check.overBudget`             |
| `decision.context.nearLimit`              | 4        | `check.nearLimit`              |
| `decision.context.lowProtein`             | 2        | `check.lowProtein`             |
| `decision.context.highFat`                | 4        | `check.highFat`                |
| `decision.context.highCarbs`              | 4        | `check.highCarbs`              |
| `decision.context.lateNightHighCal`       | 2        | `check.lateNight`              |
| `decision.context.restrictionConflict`    | 8        | `check.restrictionConflict`    |
| `decision.context.allergenConflict`       | 4        | `check.allergenConflict`       |
| `decision.context.diabetesHighGI`         | 4        | `check.diabetesHighGI`         |
| `decision.context.cardiovascularRisk`     | 4        | `check.cardiovascularRisk`     |
| `decision.context.hypertensionSodium`     | 4        | `check.hypertensionSodium`     |
| `decision.context.anemiaLowIron`          | 2        | `check.anemiaLowIron`          |
| `decision.context.osteoporosisLowCalcium` | 2        | `check.osteoporosisLowCalcium` |
| 其他健康检查                              | ~6       | `check.*`                      |

---

## 六、评分增强

### 6.1 新增利用字段

V4.6 扩展的分析字段将被评分系统消费：

| 评分维度         | 新增消费字段                                     | 影响                        |
| ---------------- | ------------------------------------------------ | --------------------------- |
| `glycemicImpact` | `glycemicLoad`                                   | GL 比 GI 更准确反映血糖影响 |
| `foodQuality`    | `nutrientDensity`, `processingLevel`, `transFat` | 多维度质量评估              |
| `stability`      | `omega3/omega6` 比值, `solubleFiber`             | 血糖/消化稳定性             |
| `satiety`        | `solubleFiber`, `protein`                        | 可溶性纤维增强饱腹感权重    |

### 6.2 健康状况检查增强

| 健康状况 | 新增检查            | 消费字段                  |
| -------- | ------------------- | ------------------------- |
| 痛风     | purine 等级检查     | `purine`                  |
| IBS      | FODMAP 等级检查     | `fodmap`                  |
| 肾结石   | oxalate 等级检查    | `oxalate`                 |
| 高血脂   | 胆固醇+反式脂肪检查 | `cholesterol`, `transFat` |

---

## 七、分阶段实施计划

### Phase 1：统一分析提示词 + 评分优化 + 基础决策（4-8 目标）

| #    | 任务                        | 文件                             | 说明                                                     |
| ---- | --------------------------- | -------------------------------- | -------------------------------------------------------- |
| P1.1 | AnalyzedFoodItem 扩展       | `food-item.types.ts`             | 添加 17 个新字段，移除 `quality`/`satiety`/`isProcessed` |
| P1.2 | 统一 Prompt Schema 构建函数 | `text-food-analysis.service.ts`  | 新建 `buildUnifiedPromptSchema()` 纯函数，文本/图片共享  |
| P1.3 | 文本分析 prompt 重写        | `text-food-analysis.service.ts`  | 使用统一 schema，扩展返回字段                            |
| P1.4 | 图片分析 prompt 重写        | `image-food-analysis.service.ts` | 使用统一 schema，移除决策字段                            |
| P1.5 | 解析函数适配                | 两个 analysis service            | `toAnalyzedFoodItem` 适配新字段，移除旧兼容逻辑          |
| P1.6 | NutritionTotals 扩展        | `food-item.types.ts`             | 新增 `transFat`, `cholesterol`, `sugar` 汇总             |
| P1.7 | 评分消费新字段              | `food-scoring.service.ts`        | glycemicImpact 用 GL，foodQuality 用 nutrientDensity     |
| P1.8 | tsc 验证                    | —                                | 0 errors                                                 |

### Phase 2：替代方案 + 架构解耦 + i18n（4-8 目标）

| #    | 任务                              | 文件                                 | 说明                                                  |
| ---- | --------------------------------- | ------------------------------------ | ----------------------------------------------------- |
| P2.1 | alternative-food-rules.ts 重构    | `alternative-food-rules.ts`          | 移除硬编码食物名，改为约束 schema                     |
| P2.2 | AlternativeSuggestionService 改造 | `alternative-suggestion.service.ts`  | 三级降级：引擎→pipeline→规则搜索                      |
| P2.3 | Pipeline 三层解耦                 | `analysis-pipeline.service.ts`       | 拆分为 runAnalysis/runScoring/runDecision/runCoaching |
| P2.4 | Phase 中间类型                    | `types/pipeline.types.ts`            | 添加 AnalysisPhaseResult 等 4 个中间类型              |
| P2.5 | i18n t()→cl() 迁移                | `decision-checks.ts` + `labels-*.ts` | 44 处 t() 全部迁移到 cl()                             |
| P2.6 | 健康检查增强                      | `decision-checks.ts`                 | 新增痛风/IBS/肾结石/高血脂检查（消费 V4.6 新字段）    |
| P2.7 | tsc 验证                          | —                                    | 0 errors                                              |

### Phase 3：AI教练优化 + 个性化 + 国际化（4-8 目标）

| #    | 任务                   | 文件                                  | 说明                                                     |
| ---- | ---------------------- | ------------------------------------- | -------------------------------------------------------- |
| P3.1 | Coach 消费新字段       | `decision-coach.service.ts`           | ActionPlan 利用 fodmap/purine/GL 等生成更精准建议        |
| P3.2 | 个性化引导             | `coach-insight.service.ts`            | 结合 shortTermBehavior + goalProgress 生成个性化 insight |
| P3.3 | Prompt 国际化增强      | `text/image-food-analysis.service.ts` | prompt 系统角色根据 locale 切换语言                      |
| P3.4 | coach-i18n 新 key 补全 | `coach-i18n.ts`                       | 为新增健康检查（痛风/IBS 等）补全三语 coach 文案         |
| P3.5 | 解释链优化             | `decision-explainer.service.ts`       | 统一所有解释输出走 ExplanationNode 链                    |
| P3.6 | 全局 i18n 审计         | 全模块                                | 确认 0 处 t() 残留在 decision 模块                       |
| P3.7 | tsc 验证               | —                                     | 0 errors                                                 |

---

## 八、风险与缓解

| 风险                                              | 缓解                                                                     |
| ------------------------------------------------- | ------------------------------------------------------------------------ |
| Prompt 扩展导致 LLM token 消耗增加                | 新增字段多为 nullable，LLM 可返回 null；prompt 中标注"无法判断返回 null" |
| 移除 `quality`/`satiety`/`isProcessed` 影响消费方 | 全局搜索所有引用，统一替换                                               |
| 替代规则重构导致替代方案质量下降                  | 保留 fallbackHint 泛化建议；推荐引擎失败时仍有兜底                       |
| 44 处 i18n 迁移遗漏                               | grep 验证 0 处 `t(` 残留                                                 |
| Pipeline 解耦引入新 bug                           | 中间类型强类型约束，逐步迁移                                             |

---

## 九、验收标准

- [ ] `tsc --noEmit` 0 errors
- [ ] `grep -r "from.*i18n-messages" decision/` 仅 0 处（完全移除 t() 依赖）
- [ ] AnalyzedFoodItem 无 `quality`/`satiety`/`isProcessed` 字段
- [ ] 文本/图片 prompt 共享同一 schema 构建函数
- [ ] `alternative-food-rules.ts` 无硬编码食物名
- [ ] Pipeline 四阶段各有独立中间类型
