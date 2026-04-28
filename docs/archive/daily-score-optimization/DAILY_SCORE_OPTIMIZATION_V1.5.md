# Daily Score + Daily Status 优化设计文档 V1.5

> 版本：V1.5 | 日期：2026-04-17  
> 前置版本：V1.0 → V1.2 → V1.3 → V1.4  
> 关键词：冗余清理、权重可配置化、评分结构优化、多系统融合增强

---

## 一、V1.5 目标概述

V1.5 是一个**治理 + 增强**版本，包含两大方向：

### 方向 A：冗余清理（必须）

发现未提交的 4 个文件组成的"权重管理系统"（System 4）与现有评分系统存在严重冗余：

| 冗余文件                                                        | 行数 | 问题                                           |
| --------------------------------------------------------------- | ---- | ---------------------------------------------- |
| `src/config/nutrition-weights.config.ts`                        | 269  | 7 维权重，缺 `mealQuality` + `habit`，值已漂移 |
| `src/modules/diet/services/nutrition-weights.service.ts`        | 290  | 从未被 NutritionScoreService 调用              |
| `src/modules/diet/services/enhanced-nutrition-score.service.ts` | 229  | 包含第三份漂移的 GOAL_WEIGHTS 副本             |
| `src/modules/diet/controllers/nutrition-weights.controller.ts`  | 294  | 有 4 个编译错误，从未注册到任何 Module         |

**根因**：System 4 试图将 `NutritionScoreService.GOAL_WEIGHTS` 外部化，但从未完成接入，导致三份权重配置共存且数值漂移。

**决策**：删除 System 4 全部 4 个文件，改用现有 `ScoringConfigService` 基础设施实现权重可配置化。

### 方向 B：权重可配置化 + 评分增强

1. **权重可配置化**：复用 `ScoringConfigService`（feature_flag DB + Redis 缓存），支持运行时修改每日评分权重
2. **评分结构优化**：清晰的 response 结构 + 行为 vs 建议对比
3. **状态解释增强**：融合 mealSignals + 行为趋势到自然语言解释

---

## 二、冗余分析详情

### 系统全景图（5 个评分/权重系统）

```
┌─────────────────────────────────────────────────────────────────┐
│ System 1: NutritionScoreService (nutrition-score.service.ts)    │
│   GOAL_WEIGHTS (8维×4目标) + computePersonalizedWeights()      │
│   用途: 每日营养评分 + 每餐评分                                 │
│   状态: ✅ 生产使用中（V1.0-V1.4 迭代）                        │
├─────────────────────────────────────────────────────────────────┤
│ System 2: ScoringConfigService (scoring-config.service.ts)      │
│   ScoringConfigSnapshot (42+ 参数)                              │
│   用途: 食物推荐引擎的评分参数                                  │
│   状态: ✅ 生产使用中，有 Admin API                             │
├─────────────────────────────────────────────────────────────────┤
│ System 3: ScoringService (decision/score/scoring.service.ts)    │
│   NutritionScore 进度追踪 (consumed/target/remaining)           │
│   用途: 决策引擎的简易营养进度                                  │
│   状态: ✅ 生产使用中，独立域                                   │
├─────────────────────────────────────────────────────────────────┤
│ System 3b: FoodScoringService (decision/score/food-scoring)     │
│   纯 Facade → 代理到 System 1                                  │
│   用途: 文本/图片分析管道的评分入口                             │
│   状态: ✅ 无冗余，清洁代理                                    │
├─────────────────────────────────────────────────────────────────┤
│ System 4: nutrition-weights.config + service + controller       │  ← 🗑️ 删除
│   NutritionWeightsVersion (7维×3目标) + A/B 测试                │
│   用途: 试图外部化 System 1 的 GOAL_WEIGHTS                     │
│   状态: ❌ 未接入、未注册Module、编译错误、值漂移               │
└─────────────────────────────────────────────────────────────────┘
```

### 冗余结论

| 对比                 | 冗余？           | 处理                                             |
| -------------------- | ---------------- | ------------------------------------------------ |
| System 1 vs System 4 | **是，严重冗余** | 删除 System 4，用 System 2 基础设施替代          |
| System 1 vs System 2 | 否（不同域）     | System 2 管推荐参数，System 1 管每日评分权重     |
| System 1 vs System 3 | 否（不同粒度）   | System 3 是简易进度追踪，System 1 是加权评分     |
| System 2 vs System 4 | 概念重叠         | 都是"可配置评分参数"，应统一到 System 2 基础设施 |

---

## 三、权重可配置化方案

### 3.1 设计原则

- **复用现有基础设施**：ScoringConfigService 已有 feature_flag DB + Redis + Admin API
- **无新模块/新表**：权重存储在 feature_flag 表的新 key 中
- **降级安全**：读不到配置时回退到硬编码默认值
- **热路径零 IO**：内存缓存 + TTL 刷新

### 3.2 存储方案

```
feature_flag 表:
  key: "daily_score_weights_v1"
  value: JSON (DailyScoreWeightsConfig)
  enabled: true
```

### 3.3 类型定义

```typescript
/**
 * 每日评分权重配置（运行时可配置）
 * 存储在 feature_flag 表，通过 ScoringConfigService 管理
 */
export interface DailyScoreWeightsConfig {
  version: string; // 如 "1.5.0"
  updatedAt: string; // ISO datetime

  /** 按目标类型的 8 维权重 */
  goalWeights: Record<string, Record<string, number>>;

  /** 健康条件倍数调整 */
  healthConditionMultipliers: Record<string, Record<string, number>>;
}
```

### 3.4 数据流

```
NutritionScoreService.computePersonalizedWeights(goalType, healthConditions)
    │
    ├─ 1. 尝试从 this.dailyScoreWeightsCache 读取运行时配置
    │     └─ 缓存未命中 → 从 ScoringConfigService.getDailyScoreWeights() 加载
    │           └─ Service 内存缓存 → Redis → feature_flag DB → 硬编码默认值
    │
    ├─ 2. 获取 goalWeights[goalType] 作为基础权重
    │
    ├─ 3. 应用 healthConditionMultipliers
    │
    └─ 4. 归一化 → 返回
```

### 3.5 Admin API 扩展

复用现有 `PUT /admin/scoring-config` 端点，在 ScoringConfigSnapshot 中增加 `dailyScoreWeights` 可选字段。

---

## 四、评分结构优化

### 4.1 完整 Response 结构

`GET /api/app/food/nutrition-score` 返回：

```json
{
  "success": true,
  "data": {
    // ── 核心评分 ──
    "totalScore": 72,
    "breakdown": {
      "energy": 85,
      "proteinRatio": 68,
      "macroBalance": 72,
      "foodQuality": 65,
      "satiety": 70,
      "stability": 80,
      "glycemicImpact": 75,
      "mealQuality": 78
    },
    "decision": "OK",
    "statusLabel": "good",

    // ── 目标与摄入 ──
    "goals": { "calories": 2000, "protein": 130, "fat": 49, "carbs": 263 },
    "intake": { "calories": 1450, "protein": 85, "fat": 42, "carbs": 195 },

    // ── 个性化权重（可配置） ──
    "weights": {
      "energy": 0.25,
      "proteinRatio": 0.2,
      "macroBalance": 0.1,
      "foodQuality": 0.05,
      "satiety": 0.05,
      "stability": 0.05,
      "glycemicImpact": 0.12,
      "mealQuality": 0.18
    },

    // ── 时间感知进度 ──
    "dailyProgress": {
      "localHour": 14,
      "expectedProgress": 0.57,
      "actualProgress": 0.73,
      "isOnTrack": true
    },

    // ── 宏量状态 ──
    "macroSlotStatus": {
      "calories": "ok",
      "protein": "deficit",
      "fat": "ok",
      "carbs": "ok",
      "dominantDeficit": "protein"
    },

    // ── 结构化问题 ──
    "issueHighlights": [
      { "type": "protein_deficit", "severity": "high", "message": "蛋白质摄入不足，仅达目标的65%" }
    ],

    // ── V1.4: 每餐决策信号 ──
    "mealSignals": {
      "totalMeals": 3,
      "healthyMeals": 2,
      "healthyRatio": 0.67,
      "avgMealScore": 72,
      "decisionDistribution": { "safe": 2, "warn": 1, "stop": 0 },
      "mealTypes": ["breakfast", "lunch", "snack"],
      "mealDiversity": 1.0
    },

    // ── V1.4: 建议符合度 ──
    "decisionAlignment": {
      "alignmentScore": 67,
      "deviationCount": 1,
      "deviationMeals": [],
      "summary": "3餐中2餐符合建议"
    },

    // ── 状态解释 ──
    "statusExplanation": "热量摄入适度，符合目标。⚠️ 蛋白质不足。💡 今日有1餐需要注意饮食搭配。",

    // ── 强弱维度 ──
    "topStrength": { "dimension": "energy", "score": 85 },
    "topWeakness": { "dimension": "foodQuality", "score": 65 },

    // ── 行为加分 ──
    "behaviorBonus": {
      "streakDays": 12,
      "complianceRate": 0.85,
      "bonusPoints": 1.5
    },

    // ── 合规性对比 ──
    "complianceInsight": {
      "calorieAdherence": 73,
      "proteinAdherence": 65,
      "fatAdherence": 86,
      "carbsAdherence": 74
    },

    // ── 反馈文案 ──
    "highlights": ["⚠️ 蛋白质摄入不足", "✅ 热量控制良好"],
    "feedback": "蛋白质摄入不足；减肥期间注意热量控制"
  }
}
```

### 4.2 新增字段：weights

在 response 中暴露当前使用的权重配置，便于前端展示"评分是怎么算的"以及后台调试。

---

## 五、实施清单

### Phase 1：冗余清理（必须先做）

| #   | 操作 | 文件                                                            |
| --- | ---- | --------------------------------------------------------------- |
| 1.1 | 删除 | `src/config/nutrition-weights.config.ts`                        |
| 1.2 | 删除 | `src/modules/diet/services/nutrition-weights.service.ts`        |
| 1.3 | 删除 | `src/modules/diet/services/enhanced-nutrition-score.service.ts` |
| 1.4 | 删除 | `src/modules/diet/controllers/nutrition-weights.controller.ts`  |
| 1.5 | 确认 | 以上文件未在任何 module.ts 中注册（验证无引用）                 |

### Phase 2：权重可配置化

| #   | 操作                                                                               | 文件                           |
| --- | ---------------------------------------------------------------------------------- | ------------------------------ |
| 2.1 | 新增类型 `DailyScoreWeightsConfig`                                                 | `nutrition-score.service.ts`   |
| 2.2 | 注入 `ScoringConfigService`                                                        | `nutrition-score.service.ts`   |
| 2.3 | 改造 `computePersonalizedWeights` 支持从配置读取                                   | `nutrition-score.service.ts`   |
| 2.4 | `ScoringConfigService` 增加 `getDailyScoreWeights()` + `updateDailyScoreWeights()` | `scoring-config.service.ts`    |
| 2.5 | Admin controller 支持 daily score weights CRUD                                     | `scoring-config.controller.ts` |

### Phase 3：Response 增强

| #   | 操作                                    | 文件                           |
| --- | --------------------------------------- | ------------------------------ |
| 3.1 | `calculateScore` 返回使用的权重         | `nutrition-score.service.ts`   |
| 3.2 | Controller response 增加 `weights` 字段 | `food-nutrition.controller.ts` |

### Phase 4：编译验证

| #   | 操作                                                                    |
| --- | ----------------------------------------------------------------------- |
| 4.1 | `npx tsc --noEmit --project apps/api-server/tsconfig.json`              |
| 4.2 | 确认只有 pre-existing 的 4 个错误（已删除的 controller 中的错误应消失） |

---

## 六、设计原则遵守情况

| 原则                 | V1.5 遵守方式                                                     |
| -------------------- | ----------------------------------------------------------------- |
| 行为优先（最高）     | ✅ 评分基于真实 food_records 摄入数据                             |
| 个性化理解（第二层） | ✅ 目标权重 + 健康条件倍数 + 可配置                               |
| 决策系统仅辅助       | ✅ mealQuality 权重 17-20%，不主导                                |
| 禁止新增 DB 字段     | ✅ 复用 feature_flag 表存储配置                                   |
| 禁止新增模块         | ✅ 复用 ScoringConfigService + 现有 Admin API                     |
| 复用 Analyze/Explain | ✅ 类型可导入；mealSignals 复用 decision/isHealthy/nutritionScore |

---

## 七、约束与风险

1. **ScoringConfigService 注入**：NutritionScoreService 需要注入 ScoringConfigService。由于 RecommendationModule 已导出 ScoringConfigService，且 DietModule 导入了 RecommendationModule，注入可行。
2. **降级安全**：feature_flag 无记录时回退硬编码默认值，不影响现有功能。
3. **缓存一致性**：权重更新后通过 ScoringConfigService 的 Redis 失效机制同步到所有实例。

---

## 八、迭代路线图

| 版本 | 核心改动                                                  | 状态 |
| ---- | --------------------------------------------------------- | ---- |
| V1.0 | 数据质量修复 + 个性化增强 + 解释性增强                    | ✅   |
| V1.2 | macroSlotStatus + issueHighlights + ja-JP                 | ✅   |
| V1.3 | 时间感知评分（getExpectedProgress）                       | ✅   |
| V1.4 | 多系统融合（mealQuality 第 8 维 + MealSignalAggregation） | ✅   |
| V1.5 | 冗余清理 + 权重可配置化 + Response 增强                   | 🚧   |
| V2.0 | （规划）跨模块 Analyze 复用 + 趋势评分 + 周报             | 📋   |
