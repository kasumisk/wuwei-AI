# POST /api/app/food/explain-why-not

## 概述

反向解释 API — "为什么不推荐这个食物？"

用户输入想吃的食物名称 + 餐次，系统对该食物运行完整评分和过滤分析，返回不推荐的原因 + 替代推荐。本质上是对推荐系统黑盒的诊断工具，帮助用户理解为什么某个食物没有被系统推荐。

---

## 基本信息

| 项目 | 值 |
|---|---|
| **方法** | `POST` |
| **路径** | `/api/app/food/explain-why-not` |
| **认证** | JWT Token（`AppJwtAuthGuard`，控制器类级别） |
| **订阅门控** | 无（`@RequireFeature` 未生效） |
| **限流** | `@UserApiThrottle(10, 60)` — 每用户每 60 秒最多 10 次 |
| **HTTP 状态码** | `200 OK` |
| **版本** | V6 2.8 |
| **i18n** | `zh-CN` / `en-US` / `ja-JP` |

---

## 请求参数

### Request Body（`ExplainWhyNotDto`）

| 参数 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `foodName` | `string` | ✅ | 食物名称，支持中文或英文（如 `"炸鸡"`, `"hotpot"`） |
| `mealType` | `enum: MealType` | ✅ | 餐次类型，可选值：`breakfast`、`lunch`、`dinner`、`snack` |
| `locale` | `string?` | ❌ | 语言区域，可选值：`zh-CN`、`en-US`、`ja-JP`，默认跟随请求头 |

### 请求示例

```json
{
  "foodName": "炸鸡",
  "mealType": "lunch",
  "locale": "zh-CN"
}
```

---

## 响应结构

### Response Wrapper

```json
{
  "success": true,
  "code": 200,
  "message": "diet.explanationGenerated",
  "data": { ... }
}
```

### `data` 字段（`WhyNotResult`）

| 字段 | 类型 | 说明 |
|---|---|---|
| `foodName` | `string` | 匹配到的食物名称 |
| `found` | `boolean` | 是否在食物库中找到了该食物 |
| `score` | `number` | 该食物的综合评分（0-1，精度两位小数；0 表示被硬过滤/未找到） |
| `reason` | `string` | 用户可读的不推荐原因文本（分号分隔多条原因） |
| `alternatives` | `array` | 同餐次替代推荐 Top-5 |

### `alternatives[]` 元素

| 字段 | 类型 | 说明 |
|---|---|---|
| `foodId` | `string` | 食物 ID |
| `name` | `string` | 食物名称 |
| `category` | `string` | 食物分类 |
| `score` | `number` | 综合评分（0-1） |
| `servingCalories` | `number` | 一份标准份量的热量（kcal） |
| `servingProtein` | `number` | 一份标准份量的蛋白质（g） |

### 响应示例（食物找到）

```json
{
  "success": true,
  "code": 200,
  "message": "解释已生成",
  "data": {
    "foodName": "炸鸡",
    "found": true,
    "score": 0.32,
    "reason": "热量过高，超出本餐预算；该食物加工程度较高（NOVA 惩罚因子 44%），不利于减脂目标；在以下维度表现较弱: 热量匹配、脂肪控制、食物品质",
    "alternatives": [
      {
        "foodId": "abc-123",
        "name": "煎鸡胸肉",
        "category": "肉类",
        "score": 0.89,
        "servingCalories": 180,
        "servingProtein": 35
      }
    ]
  }
}
```

### 响应示例（食物未找到）

```json
{
  "success": true,
  "code": 200,
  "message": "解释已生成",
  "data": {
    "foodName": "三体星特产",
    "found": false,
    "score": 0,
    "reason": "食物库中未找到\"三体星特产\"",
    "alternatives": []
  }
}
```

---

## 完整工作流程

### 架构概览

```
Controller (food-plan.controller.ts)
  │
  ▼
Service (food.service.ts :: explainWhyNot)
  │
  ├─► UserProfileService.getProfile()        用户画像
  ├─► getTodaySummary()                      今日饮食汇总
  ├─► NutritionScoreService.calculateDailyGoals()  每日营养目标
  │
  └─► RecommendationEngineService.scoreAndExplainWhyNot()
        │
        ├─ Step 1: getAllFoods() → 食物匹配
        ├─ Step 2: 硬过滤检测（filterReasons[]）
        ├─ Step 3: FoodScorerService.scoreFoodDetailed() → 14 维评分
        ├─ Step 4: ExplanationGeneratorService.explainWhyNot() → 生成原因文案
        └─ Step 5: 替代食物排序 Top-5
```

---

### Step 0：用户上下文加载

**`food.service.ts : explainWhyNot()`** (line 842-905)

并行加载用户画像和今日饮食汇总：

```typescript
const [summary, profile] = await Promise.all([
  this.getTodaySummary(userId),
  this.userProfileService.getProfile(userId),
]);
```

然后计算该餐次的营养预算：

1. **每日目标计算**：通过 `NutritionScoreService.calculateDailyGoals(profile)` 获取全天热量、蛋白质、脂肪、碳水目标
2. **餐次比例分配**：根据用户目标类型（减脂/增肌/健康/习惯），从 `MEAL_RATIOS` 中查表得到该餐次的热量分配比例：

   | 目标类型 | breakfast | lunch | dinner | snack |
   |---|---|---|---|---|
   | `fat_loss` | 30% | 35% | 25% | 10% |
   | `muscle_gain` | 25% | 30% | 25% | 20% |
   | `health` | 25% | 35% | 30% | 10% |
   | `habit` | 25% | 35% | 30% | 10% |

3. **剩余预算约束**：热量预算取 `min(日目标 × 餐次比例, 日目标 - 已摄入热量)`，蛋白质按剩余量比例分配

4. **构建用户约束**：提取 `dietaryRestrictions`、`allergens`、`healthConditions`、`regionCode`、`timezone`

---

### Step 1：食物匹配

**`recommendation-engine.service.ts : scoreAndExplainWhyNot()`** (line 916-969)

从食物库中查找用户指定的食物：

1. **精确匹配**：按 `food.name` 或 `food.aliases`（逗号分隔）精确匹配
2. **模糊匹配**（fallback）：按包含关系匹配（`food.name.includes(foodName)` 或 `foodName.includes(food.name)` 或别名包含）

若均未找到，直接返回 `found: false`，reason 为 i18n 翻译的未找到提示。

---

### Step 2：硬过滤检测

**`recommendation-engine.service.ts`** (line 971-1070)

依次检测 6 类硬过滤原因，将命中的原因放入 `filterReasons[]`：

#### 2a. 过敏原冲突

对用户的 `allergens` 与食物的成分进行匹配：
- 如果用户有过敏原且食物含有对应成分，生成如 `"含有过敏原: 花生、牛奶"` 的原因

#### 2b. 餐次不适配

检查食物的 `mealTypes` 字段是否包含当前餐次：
- 如食物标记为早餐食物但用户查询午餐场景，生成不适配提示

#### 2c. 热量超标

通过 `ConstraintGeneratorService` 生成该餐次的热量上限，检查食物标准份量的热量是否超标：
- 若 `servingCalories > maxCalories`，添加 `"热量过高，超出本餐预算"`

#### 2d. 蛋白质不足

若该餐次有最低蛋白质要求（`minProtein > 0`），检查食物标准份量的蛋白质是否不达标：
- 若 `servingProtein < minProtein`，添加达标提示

#### 2e. 饮食禁忌标签

通过 `ConstraintGeneratorService` 生成排除标签列表（`excludeTags`），与食物标签（`food.tags`）取交集：
- 命中则添加 `"不符合饮食限制: {标签名}"`

#### 2f. 近期拒绝历史

加载用户短期行为画像（`ShortTermProfile`），检查该食物的拒绝次数：
- 阈值默认 = 2（配置项 `recallConfig.shortTermRejectThreshold`）
- 若 `rejectCount >= threshold`，添加 `"用户近期拒绝了该食物"`

---

### Step 3：14 维综合评分

即使食物被硬过滤，仍然运行完整评分流程以分析弱维度。

1. 构建健康修正上下文（`HealthModifierContext`）：包含过敏原、健康状况、目标类型
2. 构建营养目标（`NutritionTargets`）：基于用户画像导出微量和常量营养目标
3. 加载中心化评分配置（`ScoringConfigService.getConfig()`）
4. 调用 `FoodScorerService.scoreFoodDetailed()` 执行 **14 维评分**：

   | 维度 | 英文 key | 说明 |
   |---|---|---|
   | 热量匹配 | `calories` | 热量与目标的契合度 |
   | 蛋白质 | `protein` | 蛋白质含量的评分 |
   | 碳水 | `carbs` | 碳水比例的评分 |
   | 脂肪 | `fat` | 脂肪/脂肪类型的评分 |
   | 食物品质 | `quality` | NOVA 加工等级、添加剂等 |
   | 饱腹感 | `satiety` | 饱腹感和满足度 |
   | 血糖影响 | `glycemic` | GI/GL 的评分 |
   | 营养密度 | `nutrientDensity` | 微量营养素密度 |
   | 抗炎因子 | `inflammation` | 炎症反应评分 |
   | 膳食纤维 | `fiber` | 纤维含量评分 |
   | 时令性 | `seasonality` | 季节性新鲜度 |
   | 可执行性 | `executability` | 是否容易获得烹饪 |
   | 大众度 | `popularity` | 常见度和接受度 |
   | 可获得性 | `acquisition` | 渠道可获得性 |

   **评分返回结构** (`ScoringExplanation`)：
   - `score` — 加权综合分数 (0-1)
   - `dimensions` — 14 维度的分别评分 (raw + weighted)
   - `penaltyResult` — 健康修正惩罚（vetoed / reasons / penalty factor）
   - `novaPenalty` — NOVA 加工等级惩罚因子 (接近 1 无惩罚，< 0.7 严重惩罚)
   - `preferenceBoost` — 偏好增强因子 (0-1)
   - `shortTermBoost` — 短期行为偏好因子 (0-1)

---

### Step 4：反向解释文案生成

**`explanation-generator.service.ts : explainWhyNot()`** (line 642-734)

按优先级从高到低构建原因文案（以分号 `；` 连接）：

| 层级 | 优先级 | 触发条件 | 文案模板（中文） |
|---|---|---|---|
| 1 | 最高 | `filterReasons` 非空 | 直接输出硬过滤原因 |
| 2 | 高 | 健康修正否决（`penaltyResult.vetoed`） | `健康风险: {具体原因}` 或 `因健康条件限制，该食物被系统排除` |
| 3 | 中 | NOVA 惩罚严重（`novaPenalty < 0.7`） | `该食物加工程度较高（NOVA 惩罚因子 {penalty}%），不利于{目标}目标` |
| 4 | 中 | 有维度评分 < 0.4（raw） | `在以下维度表现较弱: {维度1}、{维度2}...` |
| 5 | 低 | 偏好不匹配（`preferenceBoost < 0.5`） | `该食物与你的饮食偏好不匹配` |
| 6 | 低 | 短期反馈消极（`shortTermBoost < 0.9`） | `你近期对该类食物的反馈较消极` |
| 7 | 兜底 | `score > 0` 但无其他原因 | `该食物综合评分偏低，在当前{目标}目标下有更优选择` |
| 8 | 保底 | 以上条件都不满足 | `该食物在当前推荐条件下未能入选，可能是营养搭配或多样性策略所致` |

---

### Step 5：替代推荐

**`recommendation-engine.service.ts`** (line 1118-1132)

1. 从食物库中排除当前食物
2. 对剩余所有食物运行 `scoreFoodsWithServing()` 批量评分
3. 按综合评分降序排序，取 Top-5

---

## 相关文件清单

### 后端（api-server）

| 文件路径 | 角色 |
|---|---|
| `src/modules/diet/app/controllers/food-plan.controller.ts:319-339` | Controller 路由定义 |
| `src/modules/diet/app/services/food.service.ts:842-905` | Service 层 — 用户上下文 + 预算计算 |
| `src/modules/diet/app/services/recommendation-engine.service.ts:58-77` | `WhyNotResult` 接口定义 |
| `src/modules/diet/app/services/recommendation-engine.service.ts:916-1148` | `scoreAndExplainWhyNot()` 核心评分引擎 |
| `src/modules/diet/app/recommendation/explanation/explanation-generator.service.ts:642-734` | `explainWhyNot()` 文案生成器 |
| `src/modules/diet/app/dto/recommendation.dto.ts:195-215` | `ExplainWhyNotDto` DTO 定义 |
| `src/modules/diet/app/recommendation/pipeline/food-scorer.service.ts` | `FoodScorerService` — 14 维评分 |
| `src/modules/diet/app/recommendation/pipeline/constraint-generator.service.ts` | `ConstraintGeneratorService` — 约束生成 |
| `src/modules/diet/app/recommendation/types/scoring.types.ts:20-35` | `SCORE_DIMENSIONS` 14 维定义 |
| `src/modules/diet/app/recommendation/types/scoring.types.ts:290-295` | `MEAL_RATIOS` 目标自适应餐次比例 |
| `src/modules/diet/app/recommendation/modifier/health-modifier-engine.service.ts` | `HealthModifierEngineService` — 健康修正引擎 |
| `src/modules/diet/app/recommendation/context/scoring-config.service.ts` | `ScoringConfigService` — 中心化评分配置 |
| `src/modules/diet/app/recommendation/feedback/profile-aggregator.service.ts` | `ProfileAggregatorService` — 短期行为画像 |
| `src/modules/diet/i18n/zh-CN.json:377-384` | 反向解释 i18n 翻译（中文） |
| `src/modules/diet/i18n/zh-CN.json:439-445` | 过滤原因 i18n 翻译（中文） |
| `src/modules/diet/i18n/en-US.json` | 英文 i18n 翻译 |
| `src/modules/diet/i18n/ja-JP.json` | 日文 i18n 翻译 |
| `src/modules/diet/diet.module.ts` | Module 注册 |
| `src/modules/diet/recommendation.module.ts` | Recommendation 子模块注册 |

### 前端（web）

| 文件路径 | 角色 |
|---|---|
| `src/lib/api/food-plan.ts:50-58` | API 客户端 `foodPlanService.explainWhyNot()` |
| `src/types/food.ts:668-674` | `ExplainWhyNotResult` 类型定义 |
| `src/features/plan/hooks/use-plan-data.ts` | React Query mutation 封装 |
| `src/features/plan/components/why-not-card.tsx` | WhyNotCard UI 组件（输入 + 结果展示） |
| `src/features/plan/components/plan-page.tsx:227` | 计划页面中渲染 WhyNotCard |
| `src/features/food-analysis/components/decision-card.tsx:41-52` | 食物分析页面也调用此接口 |

---

## 与 `getMealSuggestion` 的关系

两个接口共享同一套目标计算逻辑：

- `getMealSuggestion`：正向推荐 — 基于目标筛选评分最高的食物，返回推荐列表
- `explain-why-not`：反向诊断 — 针对用户指定的任意食物，解释其评分低的原因

`explainWhyNot` 本质上是 `getMealSuggestion` 的补充：用户看到推荐结果后若疑惑"为什么没推荐 X？"，可通过此接口获得透明解释。

---

## 数据流图

```
用户请求 (foodName + mealType)
    │
    ├─► UserProfileService.getProfile()
    │     └─► 获取: goal, allergens[], dietaryRestrictions[], healthConditions[], regionCode, timezone
    │
    ├─► getTodaySummary()
    │     └─► 获取: totalCalories, totalProtein, calorieGoal
    │
    ├─► NutritionScoreService.calculateDailyGoals()
    │     └─► 输出: { calories, protein, fat, carbs }
    │
    ├─► MEAL_RATIOS[goalType][mealType] → 餐次营养预算
    │
    └─► RecommendationEngineService.scoreAndExplainWhyNot()
          │
          ├─ [1] getAllFoods() + exact/fuzzy match → food
          │
          ├─ [2] 硬过滤检测
          │     ├─ matchAllergens(food, user.allergens)
          │     ├─ food.mealTypes vs mealType
          │     ├─ constraintGenerator.generateConstraints() → { maxCalories, minProtein, excludeTags }
          │     ├─ servingCal vs constraints.maxCalories
          │     ├─ food.tags ∩ constraints.excludeTags
          │     └─ shortTermProfile.rejectedFoods[food.name] vs threshold
          │
          ├─ [3] foodScorer.scoreFoodDetailed({
          │       food, goalType, target, penaltyContext, mealType,
          │       rankPolicy, nutritionTargets, scoringConfig
          │     })
          │     └─► 返回: { score, explanation { dimensions[14], penaltyResult, novaPenalty, preferenceBoost, shortTermBoost } }
          │
          ├─ [4] explanationGenerator.explainWhyNot(food, scored, filterReasons, ...)
          │     └─► 按优先级拼接 8 层原因 → reason 文本
          │
          └─ [5] foodScorer.scoreFoodsWithServing(all other foods) → Top-5 alternatives
                └─► 返回: WhyNotResult { foodName, found, score, reason, alternatives[] }
```
