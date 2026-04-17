# Daily Score + Daily Status 优化设计文档 V1.2

> 基于 V1.0 实施成果，全面升级评分结构、输入数据整合、解释性和国际化。

## 1. V1.0 已完成回顾

| 阶段    | 内容                                                                                  | 状态 |
| ------- | ------------------------------------------------------------------------------------- | ---- |
| Phase 1 | stabilityData 注入、foodQuality/satiety fallback 修复、零值权重分摊                   | ✅   |
| Phase 2 | healthConditions 权重调整、complianceRate 融入、连胜加分                              | ✅   |
| Phase 3 | statusLabel/statusExplanation/topStrength/topWeakness/behaviorBonus/complianceInsight | ✅   |

## 2. V1.2 新增目标

| 编号   | 目标                                                                | 优先级 |
| ------ | ------------------------------------------------------------------- | ------ |
| V1.2-1 | `buildStatusExplanation` 增加 ja-JP 支持（三语完整覆盖）            | P0     |
| V1.2-2 | 宏量槽位状态检测（macroSlotStatus）融入 nutrition-score endpoint    | P0     |
| V1.2-3 | 问题识别（issueHighlights）— 从营养数据直接检测问题并返回结构化列表 | P0     |
| V1.2-4 | 完整评分结构 JSON 定义文档化                                        | P1     |
| V1.2-5 | 偏好系统解释性融合（轻量级，不增加模块依赖）                        | P2     |

## 3. 设计原则（延续 V1.0）

1. **行为优先**：评分基于用户实际记录
2. **个性化理解**：目标 + 健康条件调整权重，偏好仅用于解释
3. **决策系统辅助**：判断偏离程度，轻微加权
4. **不新增数据库字段 / 不新增模块**
5. **不引入跨模块循环依赖**：diet 模块不 import decision 模块

---

## 4. Step 1: 输入数据整合

nutrition-score endpoint 的完整输入数据来源：

```
┌─────────────────────────────────────────────────┐
│              nutrition-score endpoint            │
│                                                  │
│  数据源 1: 今日饮食记录                           │
│  ├── FoodService.getTodaySummary()               │
│  ├── totalCalories, totalProtein, totalFat,      │
│  │   totalCarbs, mealCount, avgQuality,          │
│  │   avgSatiety                                  │
│  │                                               │
│  数据源 2: 用户画像                               │
│  ├── UserProfileService.getProfile()             │
│  ├── goal, healthConditions, mealsPerDay,        │
│  │   weightKg, dailyCalorieGoal                  │
│  │                                               │
│  数据源 3: 行为数据                               │
│  ├── BehaviorService.getProfile()                │
│  ├── streakDays, avgComplianceRate               │
│  │                                               │
│  数据源 4: 计算目标                               │
│  ├── NutritionScoreService.calculateDailyGoals() │
│  ├── calories, protein, fat, carbs goals         │
│  │                                               │
│  数据源 5: 实时计算（V1.2 新增）                   │
│  ├── macroSlotStatus — 四维宏量槽位状态           │
│  ├── issueHighlights — 结构化问题识别             │
│  └── (从数据源 1+4 实时推导，无需外部服务)         │
└─────────────────────────────────────────────────┘
```

### 为什么不直接调用 ContextualAnalysis / CoachInsightService

- `CoachInsightService` 属于 `DecisionModule`，diet 模块未 import 该模块
- 引入会造成循环依赖风险（decision → diet → decision）
- 替代方案：在 `NutritionScoreService` 中实现轻量级的宏量槽位检测和问题识别，逻辑等价但解耦

---

## 5. Step 2: Daily Score 核心设计

### 5.1 多层评分架构（V1.2 完整版）

```
Layer 1: 原始营养评分（7维）
  ├── energy          高斯钟形(actual vs target)
  ├── proteinRatio    分段函数(ratio vs goal range)
  ├── macroBalance    碳水+脂肪比例区间评分
  ├── foodQuality     对数映射(1-10 → 0-100)
  ├── satiety         对数映射(1-10 → 0-100)
  ├── stability       连胜+规律性+合规率 三维加权
  └── glycemicImpact  Sigmoid(GL)

Layer 2: 个性化权重（computePersonalizedWeights）
  ├── 基础权重: GOAL_WEIGHTS[goalType]
  ├── 健康条件倍数调整: conditionMultipliers
  ├── 零值维度权重分摊
  └── 归一化 → sum = 1.0

Layer 3: 调整机制（applyAdjustments）
  ├── 惩罚: 热量>130%目标 ×0.7, 蛋白质<10% ×0.8, 食物质量<2 ×0.85
  └── 激励: 连胜≥7天 +1.5/周（最高 +5）

Layer 4: 宏量槽位状态检测（V1.2 新增）
  ├── computeMacroSlotStatus(intake, goals)
  ├── 四维 deficit/ok/excess 判定
  └── dominantDeficit / dominantExcess

Layer 5: 问题识别（V1.2 新增）
  ├── detectIssueHighlights(intake, goals, breakdown)
  ├── 结构化问题列表: type + severity + message(i18n)
  └── 与 ContextualAnalysis.identifiedIssues 等价但轻量

Layer 6: 状态解释生成（buildStatusExplanation）
  ├── 7维 breakdown 信号
  ├── 行为信号（连胜、合规率）
  ├── 决策信号（SAFE/OK/LIMIT/AVOID）
  ├── 宏量槽位信号（V1.2: macroSlotStatus）
  └── 问题信号（V1.2: issueHighlights）
  → 输出: 三语自然语言文案 (zh/en/ja)
```

### 5.2 宏量槽位状态（macroSlotStatus）

```typescript
interface MacroSlotStatus {
  calories: 'deficit' | 'ok' | 'excess';
  protein: 'deficit' | 'ok' | 'excess';
  fat: 'deficit' | 'ok' | 'excess';
  carbs: 'deficit' | 'ok' | 'excess';
  dominantDeficit?: 'calories' | 'protein' | 'fat' | 'carbs';
  dominantExcess?: 'calories' | 'protein' | 'fat' | 'carbs';
}

// 判定规则（与 ContextualAnalysis 中 MacroSlotStatus 一致）
// ratio = consumed / goal
// < 0.7 → deficit
// 0.7 ~ 1.15 → ok
// > 1.15 → excess
```

### 5.3 问题识别（issueHighlights）

```typescript
interface IssueHighlight {
  type: string; // 'calorie_excess' | 'protein_deficit' | 'fat_excess' | ...
  severity: 'high' | 'medium' | 'low';
  message: string; // i18n 文案
}

// 检测规则：
// calorie_excess:   calories > 130% goal → high
// calorie_deficit:  calories < 50% goal (有记录时) → high
// protein_deficit:  protein < 60% goal → high
// fat_excess:       fat > 130% goal → medium
// carbs_excess:     carbs > 140% goal → medium
// low_quality:      foodQuality score < 40 → medium
// low_satiety:      satiety score < 40 → low
// glycemic_risk:    glycemicImpact score < 40 → medium (有GI数据时)
```

---

## 6. 完整评分结构 JSON 定义

### 6.1 API Response: `GET /api/app/food/nutrition-score`

```jsonc
{
  "success": true,
  "code": 200,
  "data": {
    // ── 核心评分 ──
    "totalScore": 72, // 0-100 综合评分
    "breakdown": {
      // 7维分解
      "energy": 85,
      "proteinRatio": 62,
      "macroBalance": 71,
      "foodQuality": 58,
      "satiety": 65,
      "stability": 78,
      "glycemicImpact": 75,
    },
    "highlights": ["⚠️ 蛋白质偏低 38%"], // 最多3条提示
    "decision": "OK", // SAFE/OK/LIMIT/AVOID

    // ── 目标与摄入 ──
    "goals": {
      "calories": 2000,
      "protein": 130,
      "fat": 49,
      "carbs": 263,
      "quality": 7,
      "satiety": 6,
    },
    "intake": {
      "calories": 1520,
      "protein": 58,
      "fat": 42,
      "carbs": 210,
    },
    "feedback": "蛋白质偏低，建议增加优质蛋白来源",

    // ── V1.0 增强字段 ──
    "statusLabel": "good", // excellent/good/fair/needs_improvement
    "statusExplanation": "热量摄入适度... ", // 自然语言解释
    "topStrength": { "dimension": "energy", "score": 85 },
    "topWeakness": { "dimension": "foodQuality", "score": 58 },
    "behaviorBonus": {
      "streakDays": 12,
      "complianceRate": 0.85,
      "bonusPoints": 1.5,
    },
    "complianceInsight": {
      "calorieAdherence": 76, // 百分比
      "proteinAdherence": 45,
      "fatAdherence": 86,
      "carbsAdherence": 80,
    },

    // ── V1.2 新增字段 ──
    "macroSlotStatus": {
      // 四维宏量槽位状态
      "calories": "deficit",
      "protein": "deficit",
      "fat": "ok",
      "carbs": "ok",
      "dominantDeficit": "protein",
      "dominantExcess": null,
    },
    "issueHighlights": [
      // 结构化问题列表
      {
        "type": "protein_deficit",
        "severity": "high",
        "message": "蛋白质摄入不足，仅达目标的45%",
      },
    ],
  },
}
```

---

## 7. 实施方案

### V1.2-1: buildStatusExplanation ja-JP 支持

**文件**: `nutrition-score.service.ts`

在 `buildStatusExplanation` 方法中：

- locale 参数类型从 `'zh' | 'en'` 扩展为 `'zh' | 'en' | 'ja'`
- 所有文案增加 ja 分支
- controller 层根据用户 regionCode 映射 locale

### V1.2-2: computeMacroSlotStatus

**文件**: `nutrition-score.service.ts` 新增方法

```typescript
computeMacroSlotStatus(
  intake: { calories: number; protein: number; fat: number; carbs: number },
  goals: { calories: number; protein: number; fat: number; carbs: number },
): MacroSlotStatus
```

逻辑：ratio = consumed / goal，按阈值判定 deficit/ok/excess。

### V1.2-3: detectIssueHighlights

**文件**: `nutrition-score.service.ts` 新增方法

```typescript
detectIssueHighlights(
  intake: { calories: number; protein: number; fat: number; carbs: number },
  goals: { calories: number; protein: number; fat: number; carbs: number },
  breakdown: NutritionScoreBreakdown,
  mealCount: number,
  locale: 'zh' | 'en' | 'ja',
): IssueHighlight[]
```

### V1.2-4: Controller 集成

**文件**: `food-nutrition.controller.ts`

在 response 中增加 `macroSlotStatus` 和 `issueHighlights` 字段。

### V1.2-5: buildStatusExplanation 增强

融合 macroSlotStatus 信号到状态解释中（如"蛋白质不足，碳水正常"）。

---

## 8. 修改文件清单

| 文件                                                | 改动                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `diet/app/services/nutrition-score.service.ts`      | 新增 computeMacroSlotStatus、detectIssueHighlights、buildStatusExplanation ja-JP + macroSlot 融合 |
| `diet/app/controllers/food-nutrition.controller.ts` | response 增加 macroSlotStatus + issueHighlights、locale 映射                                      |

### 不修改

- 推荐系统、用户画像系统（只读）
- 数据库 schema
- DecisionModule（不引入跨模块依赖）
- 前端（前端按需消费新字段，向后兼容）

---

## 9. 数据流（V1.2 完整版）

```
GET /api/app/food/nutrition-score
  ├── FoodService.getTodaySummary()      → intake 数据
  ├── UserProfileService.getProfile()    → goals + healthConditions + regionCode
  ├── BehaviorService.getProfile()       → stabilityData (streakDays, complianceRate)
  ├── calculateDailyGoals(profile)       → goals
  ├── calculateScore(input, goal, stabilityData, healthConditions)
  │     ├── computePersonalizedWeights() → 个性化权重
  │     ├── 零值维度权重分摊
  │     ├── 7维加权求和
  │     └── applyAdjustments（惩罚 + 连胜加分）
  ├── computeMacroSlotStatus(intake, goals)          ← [V1.2 NEW]
  ├── detectIssueHighlights(intake, goals, breakdown) ← [V1.2 NEW]
  ├── buildStatusExplanation(..., macroSlotStatus)    ← [V1.2 ENHANCED]
  └── Response: score + breakdown + macroSlotStatus + issueHighlights + explanation
```

---

## 10. 长期迭代方向

### V2 可选增强

1. **ContextualAnalysis 深度融合**：当模块依赖允许时，直接消费 ContextualAnalysis
2. **CoachInsightPack 融合**：同上，需解决循环依赖
3. **食物多样性评分**：基于近 7 天食物种类数
4. **微量营养素维度**：当食物库有数据时新增维度
5. **时间维度评分**：用餐时间规律性
6. **AI 个性化文案**：LLM 生成个性化状态描述
7. **周评分/月评分**：多日聚合趋势评分
8. **偏好系统深度融合**：PreferenceProfileService 的 4 维偏好权重参与解释

### 评分公式可调性

所有权重和阈值均为常量配置，支持 A/B 测试和在线调参。
