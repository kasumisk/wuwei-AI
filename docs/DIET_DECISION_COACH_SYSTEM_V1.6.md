# 饮食决策 + AI教练系统 V1.6 设计文档

> 版本: V1.6 | 基于 V1.5 升级 | 核心主题: **架构解耦 + 推荐驱动替代 + 可解释性 + 国际化**

---

## Step 1: V1.5 现状与 V1.6 缺失点分析

### 1.1 架构耦合问题

| 层级     | 现状                                                                     | 问题                                                 |
| -------- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| 分析层   | TextFoodAnalysisService(1055行) 内嵌 `calculateTotals`, `calculateScore` | 分析/评分/决策混在一个服务，无法独立迭代             |
| 评分层   | NutritionScoreService 在 diet 模块，被 food 模块跨模块直接调用           | 无 food 侧的评分门面(facade)，每次调用需手动组装参数 |
| 决策层   | FoodDecisionService(1330行) 在 `food/app/services/` 扁平目录             | 决策+替代+份量+下一餐建议全部揉在一个文件            |
| 替代方案 | `alternative-food-rules.ts` 静态规则 + SubstitutionService               | 静态规则写死目标，未充分利用推荐引擎个性化能力       |

### 1.2 可解释性不足

| 方面     | 现状                   | 缺失                                                        |
| -------- | ---------------------- | ----------------------------------------------------------- |
| 决策解释 | `decisionFactors` 数组 | 无结构化的「决策链」追踪（为什么从 recommend 降到 caution） |
| 评分解释 | breakdown 7维数值      | 无自然语言解释每个维度得分原因                              |
| 替代解释 | `reason` 一句话        | 无「为什么推荐这个替代」的定量对比                          |

### 1.3 国际化缺口

| 方面     | 现状                             | 缺失                       |
| -------- | -------------------------------- | -------------------------- |
| 决策消息 | FoodDecisionService 已使用 `t()` | 部分 fallback 仍硬编码中文 |
| 评分解释 | 无                               | 维度解释文案需要三语言     |
| Coach    | 系统prompt中文                   | 需根据用户locale切换语言   |

---

## Step 2: V1.6 架构设计

### 2.1 目录结构重组

```
food/app/
├── services/                    # 保留: 分析层（识别+营养计算）
│   ├── text-food-analysis.service.ts    # 瘦身: 移除评分/决策逻辑
│   ├── image-food-analysis.service.ts   # 瘦身: 移除评分/决策逻辑
│   ├── food-library.service.ts          # 不变
│   ├── analyze.service.ts               # 不变
│   ├── analysis-ingestion.service.ts    # 不变
│   ├── candidate-aggregation.service.ts # 不变
│   └── data-quality.service.ts          # 不变
├── scoring/                     # 新建: 评分层
│   └── food-scoring.service.ts          # 评分门面 + 可解释性增强
├── decision/                    # 新建: 决策层
│   ├── food-decision.service.ts         # 从 services/ 迁移 + 重构
│   ├── alternative-suggestion.service.ts # 替代建议（推荐引擎驱动）
│   └── decision-explainer.service.ts    # 决策可解释性服务
├── types/
│   └── analysis-result.types.ts         # 扩展: 新增可解释性类型
├── config/
│   └── alternative-food-rules.ts        # 降级为 fallback only
```

### 2.2 数据流（重构后）

```
用户输入 → [分析层] 食物识别+营养计算
         → [评分层] 7维评分 + 维度解释
         → [决策层] 决策判定 + 决策链 + 替代建议 + 份量 + 下一餐
         → 组装 FoodAnalysisResultV61 返回
```

### 2.3 约束

- **不新增数据库字段**
- **不修改推荐系统/用户画像**（只读引用）
- **不修改订阅/商业化逻辑**
- 使用已有 `t(key, vars?, locale?)` + `{{var}}` 语法
- 三语言: zh-CN / en-US / ja-JP

---

## Step 3-7: 分阶段实现

### Phase 1: 评分层解耦 + 评分可解释性

**目标**: 创建 `scoring/food-scoring.service.ts`，将评分逻辑从分析服务中抽离

**P1-1: FoodScoringService（新建）**

```typescript
// food/app/scoring/food-scoring.service.ts
@Injectable()
export class FoodScoringService {
  // 封装 NutritionScoreService 调用，提供统一接口
  calculateScore(input: ScoringInput): ScoringResult;
  // 为每个 breakdown 维度生成自然语言解释
  explainBreakdown(breakdown, locale): BreakdownExplanation[];
}
```

**P1-2: 新增类型**

```typescript
// analysis-result.types.ts 扩展
interface BreakdownExplanation {
  dimension: string;
  score: number;
  label: string; // i18n 维度名称
  explanation: string; // i18n 自然语言解释
  impact: 'positive' | 'neutral' | 'negative';
}

interface ScoringInput {
  foods: DecisionFoodItem[];
  totals: NutritionTotals;
  userContext: UserContext;
  stabilityData?: { streakDays: number };
}

interface ScoringResult {
  score: AnalysisScore;
  breakdown: NutritionScoreBreakdown;
  explanations: BreakdownExplanation[];
}
```

**P1-3: 瘦身分析服务**

- `TextFoodAnalysisService.calculateScore()` → 委托给 `FoodScoringService.calculateScore()`
- `ImageFoodAnalysisService.applyScoreEngine()` → 委托给 `FoodScoringService.calculateScore()`

---

### Phase 2: 决策层解耦 + 推荐引擎驱动替代

**目标**: 创建 `decision/` 目录，将决策逻辑从 `services/food-decision.service.ts` 迁移并增强

**P2-1: 迁移 FoodDecisionService**

将 `food/app/services/food-decision.service.ts` 迁移到 `food/app/decision/food-decision.service.ts`，更新所有 import。

**P2-2: AlternativeSuggestionService（新建）**

```typescript
// food/app/decision/alternative-suggestion.service.ts
@Injectable()
export class AlternativeSuggestionService {
  // 推荐引擎优先，静态规则降级
  async generateAlternatives(input: AlternativeInput): Promise<FoodAlternative[]>;
  // 为替代建议生成定量对比解释
  explainAlternative(original, alternative, locale): string;
}
```

关键改进：

- 替代建议**始终**先查询 SubstitutionService（推荐引擎）
- 静态规则只作为引擎无结果时的 fallback
- 每个替代附带定量对比（热量差、蛋白质差等）

**P2-3: DecisionExplainerService（新建）**

```typescript
// food/app/decision/decision-explainer.service.ts
@Injectable()
export class DecisionExplainerService {
  // 生成决策链: 描述从初始评估到最终决策的完整推理过程
  generateDecisionChain(input): DecisionChainStep[];
  // 生成综合解释
  generateExplanation(input, locale): AnalysisExplanation;
}
```

**P2-4: 新增类型**

```typescript
interface DecisionChainStep {
  step: number;
  factor: string; // 'base_score' | 'allergy' | 'health' | 'timing' | 'daily_budget'
  action: string; // i18n: "评分75分，初始判定为caution"
  resultLevel: 'recommend' | 'caution' | 'avoid';
}

// FoodDecision 扩展
interface FoodDecision {
  // ... 现有字段
  /** V1.6: 决策推理链 */
  decisionChain?: DecisionChainStep[];
  /** V1.6: 评分维度解释 */
  breakdownExplanations?: BreakdownExplanation[];
}

// FoodAlternative 扩展
interface FoodAlternative {
  // ... 现有字段
  /** V1.6: 定量对比 */
  comparison?: {
    caloriesDiff: number;
    proteinDiff: number;
    scoreDiff: number;
  };
}
```

**P2-5: 重构 FoodDecisionService**

- `generateAlternatives()` → 委托给 `AlternativeSuggestionService`
- `generateExplanation()` → 委托给 `DecisionExplainerService`
- `computeFullDecision()` 增加决策链输出
- 从 `services/` 迁移到 `decision/`

---

### Phase 3: AI教练增强 + 国际化

**P3-1: Coach 注入评分解释 + 决策链**

CoachService.prepareContext() 增加：

- `breakdownExplanations` → 教练知道每个维度的具体问题
- `decisionChain` → 教练可以解释「为什么建议你少吃」

**P3-2: Coach 语言感知**

- `buildSystemPrompt()` 根据用户 locale 切换语言
- 教练回复语言跟随用户设置

**P3-3: 全面国际化补齐**

- FoodScoringService 维度解释 → i18n
- DecisionExplainerService 决策链 → i18n
- AlternativeSuggestionService 对比解释 → i18n
- Coach 系统 prompt → i18n

---

## Step 8: 模块注册变更

```typescript
// food.module.ts 新增 providers
import { FoodScoringService } from './app/scoring/food-scoring.service';
import { FoodDecisionService } from './app/decision/food-decision.service';
import { AlternativeSuggestionService } from './app/decision/alternative-suggestion.service';
import { DecisionExplainerService } from './app/decision/decision-explainer.service';
```

---

## 风险与回滚

| 风险                                          | 缓解                                          |
| --------------------------------------------- | --------------------------------------------- |
| 迁移 FoodDecisionService 路径导致 import 断裂 | 全局搜索替换 import 路径                      |
| 评分门面增加调用层级                          | FoodScoringService 保持薄封装，不引入复杂逻辑 |
| 替代建议查询推荐引擎增加延迟                  | 保留超时 fallback 到静态规则                  |
| tsc 新增错误                                  | 每阶段完成后运行类型检查                      |
