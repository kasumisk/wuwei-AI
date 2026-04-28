# 智能饮食推荐系统 V7.3 升级方案

> 主题：**推荐智能化 + 食物大众化 + 场景化食谱 + 可解释性增强 + 性能优化**
>
> 基于 V7.2 架构增量升级，不重写、不推翻。

---

## 一、能力评估（Step 1）

### 1.1 当前系统已具备能力

| 能力层   | V7.2 现状                                                                | 成熟度 |
| -------- | ------------------------------------------------------------------------ | ------ |
| 用户画像 | NutritionProfile + PreferencesProfile + KitchenProfile + 行为推断        | ★★★★   |
| 推荐引擎 | 13维评分 + 3路召回 + ScoringChain(10因子) + Pipeline                     | ★★★★☆  |
| 场景系统 | 12场景类型 + 6获取渠道 + 4级现实策略(可配置) + 厨房设备约束              | ★★★★   |
| 执行追踪 | 5级语义匹配 + 14天滚动执行率 + 替换模式挖掘 + 高频替换boost              | ★★★☆   |
| 可解释性 | 10种洞察 + ExplanationV2 + 雷达图 + 对比卡片 + 付费分层(拆分后)          | ★★★★   |
| 跨餐联动 | 声明式规则引擎 + 4条内置规则 + 营养补偿 + 风味/温度追踪                  | ★★★★   |
| 缓存机制 | TieredCache(L1+L2) + FoodPoolCache(10分片) + ProfileCache + singleflight | ★★★★   |
| 健康修正 | 5层惩罚/奖励管道 + 9种健康状况 + 严重度分级                              | ★★★★   |
| 在线学习 | WeightLearner(3级权重) + Thompson Sampling + 执行率加权                  | ★★★☆   |
| 食谱系统 | RecipeAssembler(DB匹配) + MealAssembler(角色分组) + 自然菜名             | ★★★    |
| A/B测试  | 完整实验框架 + 卡方检验 + 确定性分桶 + 指标收集                          | ★★★★   |

### 1.2 存在问题

#### A. 推荐智能度不足

| 问题                              | 影响                                                                    |
| --------------------------------- | ----------------------------------------------------------------------- |
| **规则驱动为主，无学习型排序**    | 10个ScoringFactor全是手写规则，权重固定，无法从用户反馈自动调整因子权重 |
| **WeightLearner仅调评分维度权重** | 只学习13维评分的权重分配，不学习因子本身的强度                          |
| **CF相似度O(n²)且冷启动差**       | 新用户无协同数据，CF因子无效果                                          |
| **无上下文感知排序**              | 同一食物在不同时间/天气/心情下得分相同                                  |

#### B. 食物推荐不够大众化和贴近现实

| 问题                              | 影响                                                           |
| --------------------------------- | -------------------------------------------------------------- |
| **食物库混合原材料和成品菜**      | 推荐"鸡胸肉"而非"白切鸡"、"鸡蛋"而非"番茄炒蛋"，不贴近日常饮食 |
| **无餐食模板系统**                | 每次纯算法组装，缺少"一碗面+一个小菜"这样的经典搭配            |
| **食谱微量营养素数据缺失**        | recipes仅有5个宏量营养素(cal/protein/fat/carbs/fiber)          |
| **popularityScore无真实数据支撑** | popularity字段仅靠seed静态值，无用户行为驱动                   |

#### C. 场景化推荐深度不够

| 问题                               | 影响                                                     |
| ---------------------------------- | -------------------------------------------------------- |
| **场景仅影响过滤，不影响排序策略** | SceneContextFactor只算统一乘数，不按场景调整评分维度权重 |
| **无外卖/食堂菜单匹配**            | 外卖场景仍推组合菜，不推"一人份套餐"                     |
| **场景无时间感知**                 | 不考虑季节、工作日/周末、节假日差异                      |

#### D. 可解释性可提升空间

| 问题                               | 影响                                                  |
| ---------------------------------- | ----------------------------------------------------- |
| **ScoringChain解释过于技术化**     | "preference-signal: multiplier=1.08"对用户无意义      |
| **无"为什么推荐这道菜"的自然语言** | 缺少"因为你上周常吃鸡肉，这次推荐鱼肉补充DHA"这类解释 |
| **营养解释缺微量营养素覆盖**       | 只解释宏量营养素，不提维生素/矿物质差距               |

#### E. 性能瓶颈

| 问题                         | 影响                                   |
| ---------------------------- | -------------------------------------- |
| **无请求级缓存**             | 同一请求内多次调用相同profile/food数据 |
| **DietModule 66个providers** | 启动慢，测试隔离困难                   |
| **全量食物池加载后过滤**     | 不按场景预分片，每次从全量池过滤       |
| **无缓存预热**               | 部署后首批请求 cache miss storm        |

---

## 二、核心升级方向（Step 2）

### 方向1：食物推荐大众化 + 成品菜优先（Food Realism Enhancement）

**为什么需要**：用户反馈"推荐太多原材料（鸡胸肉、糙米），不推成品菜（黄焖鸡、牛肉面）"。当前食物库将原材料和成品菜混在同一表中，但推荐逻辑未区分处理。

**解决什么问题**：

- 新增 `foodForm` 字段区分原材料/成品菜/半成品，推荐时优先选成品菜
- 成品菜自动关联食谱，展示完整做法
- 场景匹配：外卖推成品菜，做饭推食谱+材料清单

### 方向2：餐食模板系统（Meal Template System）

**为什么需要**：当前餐食组装纯靠角色分组算法（protein+carb+veggie），缺少"一碗牛肉面"、"米饭+两菜一汤"这样的经典搭配模板。纯算法组装的结果有时不符合日常饮食习惯。

**解决什么问题**：

- 定义餐食模板（如 `一主一副一汤`、`面食套餐`、`快餐组合`）
- 模板按场景/餐次匹配，算法在模板框架内填充具体食物
- 降低推荐结果的"离谱感"，提升执行率

### 方向3：场景化评分策略（Scene-Aware Scoring Strategy）

**为什么需要**：当前SceneContextFactor只计算统一乘数（几何平均），不按场景调整评分维度的权重。外卖场景和居家做饭场景的评分策略应该完全不同——外卖看性价比和送达时间，做饭看营养密度和食材新鲜度。

**解决什么问题**：

- 每种场景定义独立的评分维度权重调整
- 场景+时间联动（工作日午餐偏快餐，周末晚餐偏家庭烹饪）
- 新增 `SceneScoringProfile` 配置，通过ScoringChain传递

### 方向4：自然语言推荐解释（Natural Language Explanation）

**为什么需要**：当前ExplanationV2虽然有雷达图和进度条等结构化数据，但解释文本偏技术化（"multiplier=1.08"）。用户需要的是"今天推荐鱼肉是因为你这周蛋白质来源过于单一，鱼肉还能补充DHA"这样的自然语言。

**解决什么问题**：

- 基于ScoringChain的adjustments生成人类可读解释
- 关联营养知识图谱：解释为什么某种营养素重要
- 分层解释：普通用户看摘要，付费用户看详细分析

### 方向5：智能权重学习增强（Adaptive Scoring Enhancement）

**为什么需要**：当前WeightLearner只学习13维评分权重的分配，但不学习ScoringChain中各Factor的强度。用户如果总是接受高偏好信号的推荐但拒绝高营养得分的推荐，系统应该自动增强偏好因子、降低营养因子的影响力。

**解决什么问题**：

- Factor级别的权重学习：每个ScoringFactor的multiplier上限/下限可动态调整
- 用户反馈闭环：accept/reject → 归因到具体Factor → 调整该Factor的影响范围
- 与现有WeightLearner协同：评分维度权重(WeightLearner) + 因子强度(FactorLearner)

### 方向6：性能优化 + 模块治理（Performance & Module Governance）

**为什么需要**：DietModule 66个providers启动慢、测试隔离困难。同一请求内多次重复读取相同数据。部署后无缓存预热。

**解决什么问题**：

- 请求级缓存(RequestScope)：同一请求内profile/食物数据只读一次
- DietModule 拆分为子模块（RecommendationModule, ExplanationModule, TrackingModule）
- 缓存预热策略：启动后异步加载热点数据
- 场景预分片：按场景/渠道预建食物子池

### 方向7：食谱营养完善 + 营养覆盖增强（Nutrition Coverage Enhancement）

**为什么需要**：食谱表仅存5个宏量营养素（cal/protein/fat/carbs/fiber），而foods表有26种营养素。推荐食谱时无法准确评估微量营养素覆盖。NRF9.3模型也仅用了12/26个可用营养素。

**解决什么问题**：

- 食谱营养从ingredient聚合计算，而非手动填写
- NRF9.3模型扩展：纳入zinc, magnesium, vitaminB12, folate等
- 微量营养素缺口可视化：用户可看到自己哪些微量营养素长期不足

---

## 三、架构升级设计（Step 3）

### 3.1 V7.3 架构变更图

```
V7.2 Architecture:
──────────────────
RecommendationEngine (29 DI)
  ├── PipelineBuilder
  │     ├── recallCandidates() → 3路召回
  │     ├── rankCandidates()
  │     │     └── ScoringChain (10 ScoringFactor)
  │     └── rerankAndSelect()
  ├── FoodScorer (13维, 固定权重)
  ├── RealisticFilter (4档可配置)
  ├── DailyPlanContext (声明式跨餐规则)
  ├── ExplanationGenerator / InsightGenerator / ExplanationTier
  ├── RecipeAssembler (DB匹配)
  ├── MealAssembler (角色分组)
  └── WeightLearner (3级权重, 仅评分维度)

V7.3 Architecture (变更部分):
──────────────────────────────
PipelineBuilder
  └── ScoringChain
        ├── 原10个Factor (不变)
        ├── SceneScoringFactor              ← 【升级】场景化评分策略
        │     └── SceneScoringProfile[]     ← 【新增】每场景的维度权重调整
        └── FactorWeightAdapter             ← 【新增】因子强度自适应

FoodScorer
  └── NRF9.3+                              ← 【升级】扩展微量营养素覆盖

FoodLibrary
  └── foodForm: ingredient|dish|semi        ← 【新增】食物形态分类
      dishPriority                          ← 【新增】成品菜推荐优先级

MealTemplateService                         ← 【新增】餐食模板系统
  ├── MealTemplate[]                        ← 模板定义(一主一副一汤等)
  ├── matchTemplate(scene, mealType)        ← 场景模板匹配
  └── fillTemplate(template, candidates)    ← 模板填充

RecipeAssembler
  └── computeRecipeNutrition()              ← 【新增】食谱营养聚合计算

ExplanationGenerator
  └── NaturalLanguageExplainer              ← 【新增】自然语言解释生成器
        ├── generateNarrative(adjustments)  ← 从Chain结果生成叙述
        └── nutrientKnowledge               ← 营养知识模板

FactorLearnerService                        ← 【新增】因子级权重学习
  ├── attributeFeedback(adjustments, action) ← 反馈归因
  └── adjustFactorBounds(userId, factors)   ← 调整因子强度

DietModule (拆分)                           ← 【重构】
  ├── RecommendationModule                  ← 推荐核心(Engine+Pipeline+Scoring)
  ├── ExplanationModule                     ← 解释系统(Explanation+Insight+Tier)
  ├── TrackingModule                        ← 追踪系统(Execution+Weight+Feedback)
  └── DietModule                            ← 聚合模块(import子模块)

RequestScopedCacheService                   ← 【新增】请求级缓存
CacheWarmupService                          ← 【新增】缓存预热
```

### 3.2 新增/变更模块清单

| 模块                         | 类型 | 说明                                         |
| ---------------------------- | ---- | -------------------------------------------- |
| `MealTemplateService`        | 新增 | 餐食模板管理与匹配填充                       |
| `MealTemplate` (类型)        | 新增 | 模板定义: slots[], sceneTypes[], mealTypes[] |
| `FactorLearnerService`       | 新增 | ScoringFactor级别的权重学习                  |
| `NaturalLanguageExplainer`   | 新增 | 从ScoringChain结果生成自然语言解释           |
| `SceneScoringProfile` (类型) | 新增 | 每场景的评分维度权重调整配置                 |
| `RequestScopedCacheService`  | 新增 | 请求级缓存（同一请求内去重）                 |
| `CacheWarmupService`         | 新增 | 应用启动时异步预热热点缓存                   |
| `RecommendationModule`       | 新增 | 从DietModule拆出的推荐子模块                 |
| `ExplanationModule`          | 新增 | 从DietModule拆出的解释子模块                 |
| `TrackingModule`             | 新增 | 从DietModule拆出的追踪子模块                 |
| `SceneContextFactor`         | 升级 | 从统一乘数→场景化评分策略                    |
| `FoodScorer.NRF9.3`          | 升级 | 扩展微量营养素覆盖(+zinc/mag/B12/folate)     |
| `RecipeAssembler`            | 升级 | 新增食谱营养聚合计算                         |
| `FoodLibrary` (类型/Schema)  | 升级 | 新增foodForm、dishPriority字段               |
| `ExplanationGenerator`       | 升级 | 集成自然语言解释                             |

---

## 四、模块级升级设计（Step 4）

### 4.1 食物大众化 — foodForm + dishPriority

#### 4.1.1 FoodLibrary 字段扩展

```typescript
// === food.types.ts 新增字段 ===

/** 食物形态：原材料/成品菜/半成品 */
export type FoodForm = 'ingredient' | 'dish' | 'semi_prepared';

// FoodLibrary 接口新增:
export interface FoodLibrary {
  // ... 已有字段 ...

  /** V7.3: 食物形态 (ingredient=原材料如鸡胸肉, dish=成品菜如宫保鸡丁, semi_prepared=半成品如速冻饺子) */
  foodForm?: FoodForm;

  /** V7.3: 成品菜推荐优先级 (0-100, 仅dish/semi_prepared有值, 用于推荐排序偏好) */
  dishPriority?: number;
}
```

#### 4.1.2 Schema 迁移

```sql
-- Migration: Add foodForm and dishPriority to foods table
ALTER TABLE foods ADD COLUMN food_form VARCHAR(20) DEFAULT 'ingredient';
ALTER TABLE foods ADD COLUMN dish_priority INT DEFAULT NULL;

-- 根据现有数据推断 foodForm:
-- dish_type IN ('dish','soup','drink','dessert') 且 ingredient_list 长度 > 1 → dish
-- dish_type = 'staple' 或 ingredient_list 长度 <= 1 → ingredient
-- available_channels 包含 'convenience' → semi_prepared
UPDATE foods SET food_form = 'dish'
  WHERE dish_type IN ('dish', 'soup') AND COALESCE(array_length(ingredient_list, 1), 0) > 1;
UPDATE foods SET food_form = 'semi_prepared'
  WHERE dish_type IN ('snack', 'drink', 'dessert') OR available_channels::text LIKE '%convenience%';

-- dishPriority 初始化: 基于 commonality_score + popularity
UPDATE foods SET dish_priority = LEAST(
  COALESCE(commonality_score, 50) * 0.6 + COALESCE(popularity, 50) * 0.4,
  100
)::INT WHERE food_form IN ('dish', 'semi_prepared');
```

#### 4.1.3 推荐逻辑变更

在 `PipelineBuilder.rerankAndSelect()` 中新增成品菜优先逻辑：

```typescript
// 成品菜优先策略:
// 1. 如果场景是 eating_out/delivery/convenience_meal/canteen_meal, dish优先
// 2. 如果场景是 home_cooking/meal_prep, 同时推荐dish(菜名)和ingredient(材料清单)
// 3. dishPriority作为加分项加入评分

const dishBoost =
  food.foodForm === 'dish'
    ? 1.0 + (food.dishPriority || 50) / 500 // 最多+20%
    : food.foodForm === 'semi_prepared'
      ? 1.0 + (food.dishPriority || 30) / 600 // 最多+16%
      : 1.0;
```

### 4.2 餐食模板系统

#### 4.2.1 MealTemplate 类型

```typescript
// === recommendation/meal-template.types.ts ===

export interface MealTemplateSlot {
  /** 槽位角色 */
  role: 'main' | 'side' | 'soup' | 'staple' | 'drink' | 'dessert' | 'snack';
  /** 食物形态偏好 */
  preferredFoodForm?: FoodForm;
  /** 该槽位占总热量百分比范围 */
  calorieRatioRange: [number, number]; // e.g. [0.4, 0.6]
  /** 可选食物类别约束 */
  categoryConstraint?: string[]; // e.g. ['protein', 'composite']
  /** 是否可省略 */
  optional?: boolean;
}

export interface MealTemplate {
  /** 模板ID */
  id: string;
  /** 模板名称 (i18n key) */
  nameKey: string;
  /** 适用场景 */
  applicableScenes: SceneType[];
  /** 适用餐次 */
  applicableMealTypes: string[]; // breakfast/lunch/dinner/snack
  /** 槽位定义 */
  slots: MealTemplateSlot[];
  /** 模板优先级 (越高越优先匹配) */
  priority: number;
}
```

#### 4.2.2 内置模板

```typescript
export const BUILT_IN_MEAL_TEMPLATES: MealTemplate[] = [
  {
    id: 'chinese_standard',
    nameKey: 'template.chinese_standard',
    applicableScenes: ['home_cooking', 'family_dinner', 'canteen_meal'],
    applicableMealTypes: ['lunch', 'dinner'],
    priority: 100,
    slots: [
      {
        role: 'staple',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.25, 0.35],
        categoryConstraint: ['grain'],
      },
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.3, 0.45],
        categoryConstraint: ['protein', 'composite'],
      },
      {
        role: 'side',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.1, 0.2],
        categoryConstraint: ['veggie'],
      },
      {
        role: 'soup',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.05, 0.15],
        categoryConstraint: ['composite'],
        optional: true,
      },
    ],
  },
  {
    id: 'noodle_set',
    nameKey: 'template.noodle_set',
    applicableScenes: ['quick_breakfast', 'office_lunch', 'convenience_meal', 'eating_out'],
    applicableMealTypes: ['breakfast', 'lunch'],
    priority: 80,
    slots: [
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.7, 0.9],
        categoryConstraint: ['composite'],
      },
      {
        role: 'side',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.1, 0.3],
        categoryConstraint: ['veggie', 'protein'],
        optional: true,
      },
    ],
  },
  {
    id: 'quick_breakfast',
    nameKey: 'template.quick_breakfast',
    applicableScenes: ['quick_breakfast', 'convenience_meal'],
    applicableMealTypes: ['breakfast'],
    priority: 90,
    slots: [
      {
        role: 'staple',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.4, 0.6],
        categoryConstraint: ['grain'],
      },
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.2, 0.4],
        categoryConstraint: ['protein', 'dairy'],
      },
      {
        role: 'drink',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.05, 0.2],
        categoryConstraint: ['beverage', 'dairy'],
        optional: true,
      },
    ],
  },
  {
    id: 'fast_food_combo',
    nameKey: 'template.fast_food_combo',
    applicableScenes: ['eating_out', 'delivery', 'convenience_meal'],
    applicableMealTypes: ['lunch', 'dinner'],
    priority: 70,
    slots: [
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.6, 0.8],
        categoryConstraint: ['composite'],
      },
      {
        role: 'drink',
        preferredFoodForm: 'semi_prepared',
        calorieRatioRange: [0.1, 0.25],
        categoryConstraint: ['beverage'],
        optional: true,
      },
      {
        role: 'dessert',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.05, 0.15],
        categoryConstraint: ['snack', 'fruit'],
        optional: true,
      },
    ],
  },
  {
    id: 'canteen_tray',
    nameKey: 'template.canteen_tray',
    applicableScenes: ['canteen_meal'],
    applicableMealTypes: ['lunch', 'dinner'],
    priority: 85,
    slots: [
      {
        role: 'staple',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.25, 0.35],
        categoryConstraint: ['grain'],
      },
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.3, 0.4],
        categoryConstraint: ['protein', 'composite'],
      },
      {
        role: 'side',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.15, 0.25],
        categoryConstraint: ['veggie'],
      },
      {
        role: 'side',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.05, 0.15],
        categoryConstraint: ['veggie'],
        optional: true,
      },
    ],
  },
  {
    id: 'post_workout_refuel',
    nameKey: 'template.post_workout',
    applicableScenes: ['post_workout'],
    applicableMealTypes: ['snack'],
    priority: 75,
    slots: [
      {
        role: 'main',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.5, 0.7],
        categoryConstraint: ['protein', 'dairy'],
      },
      {
        role: 'staple',
        preferredFoodForm: 'dish',
        calorieRatioRange: [0.2, 0.4],
        categoryConstraint: ['grain', 'fruit'],
      },
      {
        role: 'drink',
        preferredFoodForm: 'semi_prepared',
        calorieRatioRange: [0.05, 0.15],
        categoryConstraint: ['beverage'],
        optional: true,
      },
    ],
  },
];
```

#### 4.2.3 MealTemplateService

```typescript
// === recommendation/meal-template.service.ts ===

@Injectable()
export class MealTemplateService {
  private templates: MealTemplate[] = [...BUILT_IN_MEAL_TEMPLATES];

  /**
   * 根据场景和餐次匹配最佳模板
   * @returns 匹配的模板，无匹配时返回null（降级到原有MealAssembler逻辑）
   */
  matchTemplate(sceneType: SceneType, mealType: string): MealTemplate | null;

  /**
   * 用候选食物填充模板槽位
   * 每个槽位按评分排序选择最佳匹配，遵守热量比例约束
   */
  fillTemplate(
    template: MealTemplate,
    candidates: ScoredFood[],
    totalCalories: number
  ): TemplateFilledResult;

  /** 注册自定义模板 */
  registerTemplate(template: MealTemplate): void;
}

export interface TemplateFilledResult {
  templateId: string;
  filledSlots: FilledSlot[];
  totalCalories: number;
  coverageScore: number; // 0-1, 槽位填充完整度
  templateMatchScore: number; // 0-1, 候选食物与模板的匹配度
}

export interface FilledSlot {
  role: string;
  food: ScoredFood;
  allocatedCalories: number;
}
```

### 4.3 场景化评分策略

#### 4.3.1 SceneScoringProfile

```typescript
// === recommendation/scene-scoring.types.ts ===

/** 场景评分配置: 定义每种场景下各评分维度的权重调整 */
export interface SceneScoringProfile {
  sceneType: SceneType;
  /** 评分维度权重乘数 (dimension → multiplier) */
  dimensionWeightAdjustments: Partial<Record<string, number>>;
  /** ScoringFactor 强度覆盖 (factorName → strengthMultiplier) */
  factorStrengthOverrides?: Partial<Record<string, number>>;
  /** 描述 (i18n key) */
  descriptionKey: string;
}

export const SCENE_SCORING_PROFILES: SceneScoringProfile[] = [
  {
    sceneType: 'eating_out',
    dimensionWeightAdjustments: {
      executability: 0.5, // 外卖不关心烹饪难度
      popularity: 1.5, // 外卖偏好热门菜
      calories: 1.2, // 外卖注意热量(通常偏高)
      quality: 0.8, // 外卖营养质量要求适度降低
    },
    factorStrengthOverrides: {
      'scene-context': 1.3, // 增强场景因子
    },
    descriptionKey: 'scene.eating_out.desc',
  },
  {
    sceneType: 'home_cooking',
    dimensionWeightAdjustments: {
      quality: 1.3, // 在家做饭注重营养质量
      executability: 1.2, // 关注可执行性(技能/设备匹配)
      popularity: 0.8, // 在家可以尝试新菜
    },
    descriptionKey: 'scene.home_cooking.desc',
  },
  {
    sceneType: 'canteen_meal',
    dimensionWeightAdjustments: {
      executability: 0.3, // 食堂不需要自己做
      popularity: 1.4, // 食堂偏好大众菜
      satiety: 1.2, // 食堂餐偏好管饱
    },
    descriptionKey: 'scene.canteen_meal.desc',
  },
  {
    sceneType: 'quick_breakfast',
    dimensionWeightAdjustments: {
      executability: 1.5, // 早餐要快速简单
      calories: 0.8, // 早餐热量要求适度
      satiety: 1.3, // 要管饱到中午
    },
    descriptionKey: 'scene.quick_breakfast.desc',
  },
  {
    sceneType: 'convenience_meal',
    dimensionWeightAdjustments: {
      executability: 0.3, // 便利店不需要做
      popularity: 1.3, // 偏好常见品
    },
    descriptionKey: 'scene.convenience_meal.desc',
  },
  {
    sceneType: 'post_workout',
    dimensionWeightAdjustments: {
      protein: 1.5, // 运动后蛋白质需求高
      glycemic: 1.3, // 需要快速补充碳水
      calories: 1.1,
    },
    descriptionKey: 'scene.post_workout.desc',
  },
];
```

#### 4.3.2 SceneContextFactor 升级

升级现有 `scene-context.factor.ts`，从统一乘数改为按场景调整评分维度权重：

```typescript
// SceneContextFactor.computeAdjustment() 变更:
// 旧: 统一几何平均乘数
// 新: 查找 SCENE_SCORING_PROFILES, 将 dimensionWeightAdjustments
//     写入 ctx.sceneDimensionAdjustments 供 FoodScorer 使用
//     同时返回 factorStrengthOverrides 给 ScoringChain
```

### 4.4 自然语言推荐解释

#### 4.4.1 NaturalLanguageExplainer

```typescript
// === recommendation/natural-language-explainer.service.ts ===

@Injectable()
export class NaturalLanguageExplainerService {
  /**
   * 从 ScoringChain 的调整结果生成自然语言推荐理由
   * @param adjustments - ScoringChain 输出的 ScoringAdjustment[]
   * @param food - 被推荐的食物
   * @param ctx - 上下文(包含营养目标/用户偏好等)
   * @returns 1-3句自然语言解释
   */
  generateNarrative(
    adjustments: ScoringAdjustment[],
    food: FoodLibrary,
    ctx: NarrativeContext
  ): string;

  /**
   * 生成"为什么推荐这道菜"的完整解释
   * 包含: 主要原因 + 营养补充说明 + 生活方式匹配
   */
  generateWhyThisDish(
    food: ScoredFood,
    adjustments: ScoringAdjustment[],
    ctx: NarrativeContext
  ): WhyThisDishExplanation;
}

export interface NarrativeContext {
  locale: string;
  goalType: string;
  mealType: string;
  nutritionGaps?: string[]; // 当前缺口的营养素
  recentFoodNames?: string[]; // 近期已吃的食物
  executionRate?: number;
}

export interface WhyThisDishExplanation {
  /** 主要推荐理由 (1句) */
  primaryReason: string;
  /** 营养角度说明 (0-2句) */
  nutritionNote?: string;
  /** 场景匹配说明 (0-1句) */
  sceneNote?: string;
  /** 完整叙述 (合并以上) */
  narrative: string;
}
```

#### 4.4.2 解释模板（i18n）

```typescript
// === i18n-messages.ts 新增 ===

// 推荐理由模板
'narrative.preference_match': '推荐{food}是因为你偏好{reason}类食物',
'narrative.nutrition_gap': '今天{nutrient}摄入不足，{food}是很好的{nutrient}来源',
'narrative.diversity': '你最近常吃{recentCategory}，换成{food}可以丰富营养来源',
'narrative.scene_fit': '{food}很适合{scene}场景，{reason}',
'narrative.execution_boost': '根据你的饮食记录，{food}是你经常会吃的食物，执行率更高',
'narrative.seasonal': '{food}正当季，新鲜又实惠',
'narrative.health_benefit': '{food}有助于{healthBenefit}',

// 营养知识模板
'nutrient.protein.benefit': '维持肌肉量和饱腹感',
'nutrient.fiber.benefit': '促进消化和肠道健康',
'nutrient.vitamin_c.benefit': '增强免疫力和铁吸收',
'nutrient.calcium.benefit': '骨骼健康',
'nutrient.iron.benefit': '预防贫血',
'nutrient.zinc.benefit': '免疫功能和伤口愈合',
'nutrient.magnesium.benefit': '肌肉放松和睡眠质量',
'nutrient.dha.benefit': '大脑和视力健康',
// ...更多营养素
```

### 4.5 智能权重学习增强 — FactorLearnerService

#### 4.5.1 核心设计

```typescript
// === recommendation/factor-learner.service.ts ===

@Injectable()
export class FactorLearnerService {
  /**
   * 将用户反馈归因到具体的ScoringFactor
   * 根据每个Factor对该食物的adjustment贡献度分配反馈权重
   */
  attributeFeedback(
    adjustments: ScoringAdjustment[],
    action: 'accept' | 'reject' | 'replace'
  ): FactorAttribution[];

  /**
   * 获取用户级别的Factor强度调整
   * 返回每个Factor的multiplier上限调整(>1增强, <1减弱)
   */
  getUserFactorAdjustments(userId: string, goalType: string): Promise<FactorAdjustmentMap>;

  /**
   * 更新Factor强度(异步, 基于反馈归因)
   */
  updateFactorWeights(
    userId: string,
    goalType: string,
    attributions: FactorAttribution[]
  ): Promise<void>;
}

export interface FactorAttribution {
  factorName: string;
  /** 该Factor对最终分数的贡献占比(0-1) */
  contributionRatio: number;
  /** 反馈方向(+1=positive, -1=negative) */
  direction: number;
}

/** factorName → strengthMultiplier (0.5-2.0范围, 默认1.0) */
export type FactorAdjustmentMap = Map<string, number>;
```

#### 4.5.2 学习策略

- **存储**：Redis hash `factor_learner:user:{userId}:{goalType}`，TTL=14天
- **归因算法**：按各Factor的 `|multiplier - 1| + |additive|` 计算贡献占比
- **更新公式**：`newStrength = oldStrength + lr * direction * contributionRatio`
- **学习率**：0.02（保守，避免振荡）
- **安全范围**：[0.5, 2.0]，越界则钳制
- **冷启动门槛**：至少10次反馈后才启用

### 4.6 性能优化

#### 4.6.1 请求级缓存

```typescript
// === core/cache/request-scoped-cache.service.ts ===

@Injectable({ scope: Scope.REQUEST })
export class RequestScopedCacheService {
  private cache = new Map<string, any>();

  getOrSet<T>(key: string, factory: () => T | Promise<T>): T | Promise<T>;
  invalidate(key: string): void;
  clear(): void;
}
```

使用场景：

- `UserProfileService.getProfile(userId)` — 同一请求内可能被 Engine, Scorer, Explainer 各调用一次
- `FoodPoolCache.getVerifiedFoods()` — 同一请求内 recall + rank + rerank 都需要

#### 4.6.2 DietModule 拆分

```typescript
// === modules/diet/recommendation.module.ts ===
@Module({
  providers: [
    RecommendationEngineService,
    PipelineBuilderService,
    FoodScorerService,
    RealisticFilterService,
    DailyPlanContextService,
    MealAssemblerService,
    RecipeAssemblerService,
    MealTemplateService, // V7.3
    ScoringChainService,
    ...ALL_SCORING_FACTORS, // 10个Factor
    FactorLearnerService, // V7.3
    ABTestingService,
    // ...其他推荐核心服务
  ],
  exports: [RecommendationEngineService],
})
export class RecommendationModule {}

// === modules/diet/explanation.module.ts ===
@Module({
  providers: [
    ExplanationGeneratorService,
    InsightGeneratorService,
    ExplanationTierService,
    NaturalLanguageExplainerService, // V7.3
  ],
  exports: [ExplanationGeneratorService, InsightGeneratorService, NaturalLanguageExplainerService],
})
export class ExplanationModule {}

// === modules/diet/tracking.module.ts ===
@Module({
  providers: [
    ExecutionTrackerService,
    WeightLearnerService,
    FeedbackService,
    PreferenceProfileService,
  ],
  exports: [
    ExecutionTrackerService,
    WeightLearnerService,
    FeedbackService,
    PreferenceProfileService,
  ],
})
export class TrackingModule {}

// === modules/diet/diet.module.ts (瘦身后) ===
@Module({
  imports: [RecommendationModule, ExplanationModule, TrackingModule],
  controllers: [...ALL_CONTROLLERS],
})
export class DietModule {}
```

#### 4.6.3 缓存预热

```typescript
// === core/cache/cache-warmup.service.ts ===

@Injectable()
export class CacheWarmupService implements OnApplicationBootstrap {
  async onApplicationBootstrap(): Promise<void> {
    // 异步预热，不阻塞启动
    this.warmup().catch((err) => this.logger.warn('Cache warmup failed', err));
  }

  private async warmup(): Promise<void> {
    // 1. 食物池全量加载 (10个category分片)
    await this.foodPoolCache.getVerifiedFoods();

    // 2. 热门用户画像预加载 (最近7天活跃用户, 最多100个)
    const activeUsers = await this.getRecentActiveUsers(100);
    await Promise.all(activeUsers.map((u) => this.profileCache.warmUser(u.id)));

    this.logger.log(`Cache warmup complete: foods + ${activeUsers.length} profiles`);
  }
}
```

### 4.7 NRF9.3 营养覆盖增强

#### 4.7.1 扩展营养素集

当前 NRF9.3 用了 9 鼓励 + 3 限制 = 12 营养素。V7.3 扩展为 NRF11.4：

```typescript
// === food-scorer.service.ts 修改 ===

// V7.2 (NRF 9.3):
// 鼓励: protein, fiber, vitA, vitC, vitD, vitE, calcium, iron, potassium
// 限制: saturatedFat, addedSugar, sodium

// V7.3 (NRF 11.4):
// 鼓励: protein, fiber, vitA, vitC, vitD, vitE, calcium, iron, potassium,
//        zinc(新), magnesium(新)
// 限制: saturatedFat, addedSugar, sodium, transFat(新)

const NRF_ENCOURAGE_NUTRIENTS_V73 = [
  'protein',
  'fiber',
  'vitaminA',
  'vitaminC',
  'vitaminD',
  'vitaminE',
  'calcium',
  'iron',
  'potassium',
  'zinc', // V7.3 新增
  'magnesium', // V7.3 新增
];

const NRF_LIMIT_NUTRIENTS_V73 = [
  'saturatedFat',
  'addedSugar',
  'sodium',
  'transFat', // V7.3 新增
];
```

#### 4.7.2 食谱营养聚合

```typescript
// === recipe-assembler.service.ts 新增 ===

/**
 * 从食谱的ingredient列表聚合计算完整营养素
 * 使用各ingredient的FoodLibrary数据按比例加权
 */
computeRecipeNutrition(recipe: RecipeWithIngredients): RecipeNutrition {
  const nutrition: RecipeNutrition = { /* 初始化所有26种营养素为0 */ };
  for (const ing of recipe.ingredients) {
    if (!ing.food) continue;
    const ratio = ing.amount / 100; // 假设FoodLibrary数据per 100g
    // 聚合所有26种营养素
    nutrition.calories += (ing.food.calories || 0) * ratio;
    nutrition.protein += (ing.food.protein || 0) * ratio;
    // ... 全部26种
  }
  return nutrition;
}
```

### 4.8 数据流

V7.3 新增的数据流：

```
推荐请求 → MealTemplateService.matchTemplate() → 模板匹配
         → PipelineBuilder (带场景评分策略) → 候选评分
         → MealTemplateService.fillTemplate() → 模板填充
         → NaturalLanguageExplainer.generateNarrative() → 自然语言解释
         → 响应

用户反馈 → FactorLearnerService.attributeFeedback() → Factor归因
         → FactorLearnerService.updateFactorWeights() → Redis存储
         → 下次推荐读取 Factor 强度调整

应用启动 → CacheWarmupService.onApplicationBootstrap() → 异步预热
```

---

## 五、技术路线图（Step 5）

### Phase 1：食物大众化 + 模板系统 + 数据基础

**目标**：新增foodForm字段、餐食模板系统、Schema迁移，让推荐结果更贴近日常饮食。

| 任务                                           | 改动文件                         | 依赖   |
| ---------------------------------------------- | -------------------------------- | ------ |
| P1-A: FoodLibrary新增foodForm/dishPriority字段 | `food.types.ts`, `schema.prisma` | 无     |
| P1-B: Schema迁移 + 现有数据foodForm推断        | Prisma migration + seed update   | P1-A   |
| P1-C: MealTemplate类型 + 内置模板              | 新增 `meal-template.types.ts`    | 无     |
| P1-D: MealTemplateService实现                  | 新增 `meal-template.service.ts`  | P1-C   |
| P1-E: SceneScoringProfile类型 + 配置           | 新增 `scene-scoring.types.ts`    | 无     |
| P1-F: NRF11.4扩展(新增zinc/magnesium/transFat) | `food-scorer.service.ts`         | 无     |
| P1-G: 编译验证                                 | —                                | P1-A~F |

### Phase 2：场景化评分 + 自然语言解释 + Factor学习

**目标**：实现场景化评分策略、自然语言推荐解释、Factor级权重学习。

| 任务                                       | 改动文件                                     | 依赖 |
| ------------------------------------------ | -------------------------------------------- | ---- |
| P2-A: SceneContextFactor升级为场景化评分   | `scene-context.factor.ts`                    | P1-E |
| P2-B: NaturalLanguageExplainerService实现  | 新增 `natural-language-explainer.service.ts` | 无   |
| P2-C: FactorLearnerService实现             | 新增 `factor-learner.service.ts`             | 无   |
| P2-D: 食谱营养聚合计算                     | `recipe-assembler.service.ts`                | 无   |
| P2-E: ExplanationGenerator集成自然语言解释 | `explanation-generator.service.ts`           | P2-B |
| P2-F: 推荐管道集成foodForm优先策略         | `pipeline-builder.service.ts`                | P1-A |
| P2-G: i18n新增推荐理由模板 + 营养知识模板  | `i18n-messages.ts`                           | P2-B |

### Phase 3：性能优化 + 模块治理 + 集成验证

**目标**：请求级缓存、DietModule拆分、缓存预热、全量集成测试。

| 任务                                | 改动文件                                                          | 依赖       |
| ----------------------------------- | ----------------------------------------------------------------- | ---------- |
| P3-A: RequestScopedCacheService实现 | 新增 `request-scoped-cache.service.ts`                            | 无         |
| P3-B: CacheWarmupService实现        | 新增 `cache-warmup.service.ts`                                    | 无         |
| P3-C: DietModule拆分为子模块        | `diet.module.ts`, 新增3个子模块文件                               | P2-A~F     |
| P3-D: PipelineBuilder集成模板系统   | `pipeline-builder.service.ts`, `recommendation-engine.service.ts` | P1-D, P2-F |
| P3-E: ScoringChain集成FactorLearner | `scoring-chain.service.ts`, `pipeline-builder.service.ts`         | P2-C       |
| P3-F: 集成测试                      | 新增 `test/v7.3-integration.spec.ts`                              | P3-A~E     |
| P3-G: 编译验证 + 全量回归           | —                                                                 | P3-A~F     |

---

## 六、类型定义清单（Phase 1 输出物）

### 新增类型

```typescript
// === food.types.ts 新增 ===

export type FoodForm = 'ingredient' | 'dish' | 'semi_prepared';

// FoodLibrary 新增字段:
//   foodForm?: FoodForm;
//   dishPriority?: number;

// === recommendation/meal-template.types.ts (新文件) ===

export interface MealTemplateSlot {
  role: 'main' | 'side' | 'soup' | 'staple' | 'drink' | 'dessert' | 'snack';
  preferredFoodForm?: FoodForm;
  calorieRatioRange: [number, number];
  categoryConstraint?: string[];
  optional?: boolean;
}

export interface MealTemplate {
  id: string;
  nameKey: string;
  applicableScenes: SceneType[];
  applicableMealTypes: string[];
  slots: MealTemplateSlot[];
  priority: number;
}

export interface TemplateFilledResult {
  templateId: string;
  filledSlots: FilledSlot[];
  totalCalories: number;
  coverageScore: number;
  templateMatchScore: number;
}

export interface FilledSlot {
  role: string;
  food: ScoredFood;
  allocatedCalories: number;
}

// === recommendation/scene-scoring.types.ts (新文件) ===

export interface SceneScoringProfile {
  sceneType: SceneType;
  dimensionWeightAdjustments: Partial<Record<string, number>>;
  factorStrengthOverrides?: Partial<Record<string, number>>;
  descriptionKey: string;
}

// === recommendation/factor-learner.service.ts 类型 ===

export interface FactorAttribution {
  factorName: string;
  contributionRatio: number;
  direction: number;
}

export type FactorAdjustmentMap = Map<string, number>;

// === recommendation/natural-language-explainer.service.ts 类型 ===

export interface NarrativeContext {
  locale: string;
  goalType: string;
  mealType: string;
  nutritionGaps?: string[];
  recentFoodNames?: string[];
  executionRate?: number;
}

export interface WhyThisDishExplanation {
  primaryReason: string;
  nutritionNote?: string;
  sceneNote?: string;
  narrative: string;
}
```

### 修改类型

```typescript
// === food.types.ts 修改 ===

export interface FoodLibrary {
  // ... 已有字段不变 ...
  /** V7.3: 食物形态 */
  foodForm?: FoodForm;
  /** V7.3: 成品菜推荐优先级 */
  dishPriority?: number;
}

// === recommendation.types.ts 修改 ===

export interface PipelineContext {
  // ... 已有字段不变 ...
  /** V7.3: 场景评分配置 */
  sceneScoringProfile?: SceneScoringProfile;
  /** V7.3: 场景维度权重调整(由SceneContextFactor设置, FoodScorer读取) */
  sceneDimensionAdjustments?: Partial<Record<string, number>>;
  /** V7.3: Factor强度用户调整(由FactorLearner提供) */
  factorAdjustments?: FactorAdjustmentMap;
  /** V7.3: 匹配到的餐食模板 */
  matchedTemplate?: MealTemplate;
}

export interface MealRecommendation {
  // ... 已有字段不变 ...
  /** V7.3: 使用的模板ID */
  templateId?: string;
  /** V7.3: 每道菜的自然语言推荐理由 */
  dishExplanations?: WhyThisDishExplanation[];
}
```

---

## 七、测试计划

### V7.3 集成测试（v7.3-integration.spec.ts）

| 测试组                   | 测试点                                                   | 数量    |
| ------------------------ | -------------------------------------------------------- | ------- |
| FoodForm                 | foodForm字段存在, dish优先排序, ingredient降权, 场景匹配 | 5       |
| MealTemplate匹配         | 场景模板匹配, 餐次匹配, 优先级排序, 无匹配降级           | 5       |
| MealTemplate填充         | 槽位填充, 热量约束, 可选槽位跳过, 覆盖度评分             | 5       |
| SceneScoringProfile      | 各场景维度调整, 未知场景默认, Factor强度覆盖             | 4       |
| NaturalLanguageExplainer | 偏好匹配叙述, 营养缺口叙述, 多样性叙述, 场景叙述, i18n   | 6       |
| FactorLearner            | 反馈归因, 权重更新, 安全范围钳制, 冷启动门槛, Redis存储  | 6       |
| NRF11.4                  | 新增营养素纳入评分, transFat限制                         | 3       |
| 食谱营养聚合             | 从ingredient聚合计算, 缺失ingredient降级, 微量营养素覆盖 | 3       |
| RequestScopedCache       | 同请求去重, 请求结束清理                                 | 2       |
| CacheWarmup              | 启动预热触发, 预热失败不影响启动                         | 2       |
| DietModule拆分           | 子模块独立导入, 聚合模块正常工作                         | 3       |
| PipelineBuilder模板集成  | 模板模式推荐, 非模板降级, 模板+评分联动                  | 4       |
| ExplanationGenerator集成 | 自然语言解释生成, whyThisDish字段存在                    | 3       |
| 类型兼容性               | 新字段向后兼容, PipelineContext扩展                      | 3       |
| **总计**                 |                                                          | **~54** |

---

## 八、依赖关系图

```
Phase 1（食物大众化 + 模板 + 数据基础）
  P1-A: FoodLibrary foodForm/dishPriority
  P1-B: Schema迁移 + foodForm数据推断      ← P1-A
  P1-C: MealTemplate类型 + 内置模板
  P1-D: MealTemplateService                ← P1-C
  P1-E: SceneScoringProfile 类型 + 配置
  P1-F: NRF11.4 扩展
  P1-G: 编译验证                           ← P1-A~F

Phase 2（场景化评分 + 自然语言 + Factor学习）
  P2-A: SceneContextFactor 升级             ← P1-E
  P2-B: NaturalLanguageExplainerService     ← 独立
  P2-C: FactorLearnerService               ← 独立
  P2-D: 食谱营养聚合                        ← 独立
  P2-E: ExplanationGenerator 集成           ← P2-B
  P2-F: PipelineBuilder foodForm优先策略    ← P1-A
  P2-G: i18n 新增模板                       ← P2-B

Phase 3（性能优化 + 模块治理 + 集成验证）
  P3-A: RequestScopedCacheService           ← 独立
  P3-B: CacheWarmupService                 ← 独立
  P3-C: DietModule 拆分                     ← P2-A~G
  P3-D: PipelineBuilder 集成模板系统        ← P1-D, P2-F
  P3-E: ScoringChain 集成 FactorLearner     ← P2-C
  P3-F: 集成测试                            ← P3-A~E
  P3-G: 编译验证 + 全量回归                 ← P3-A~F
```

---

## 九、数据迁移（Step 6）

### 9.1 Schema 变更

```sql
-- Migration: V7.3 - Add foodForm and dishPriority to foods table

ALTER TABLE foods ADD COLUMN food_form VARCHAR(20) DEFAULT 'ingredient';
ALTER TABLE foods ADD COLUMN dish_priority INT DEFAULT NULL;

-- 索引
CREATE INDEX idx_foods_food_form ON foods(food_form);
```

### 9.2 数据推断迁移

```sql
-- 根据现有字段推断 foodForm
-- 规则1: 有ingredient_list且长度>1, dish_type为dish/soup → dish
UPDATE foods SET food_form = 'dish'
  WHERE (dish_type IN ('dish', 'soup')
    AND COALESCE(array_length(ingredient_list, 1), 0) > 1);

-- 规则2: snack/drink/dessert且available_channels包含convenience → semi_prepared
UPDATE foods SET food_form = 'semi_prepared'
  WHERE food_form = 'ingredient'
    AND (dish_type IN ('drink', 'dessert')
      OR (available_channels IS NOT NULL AND available_channels::text LIKE '%convenience%'));

-- 规则3: dish_type = 'dish' 但未被规则1命中(单一食材菜, 如"煎蛋") → dish
UPDATE foods SET food_form = 'dish'
  WHERE food_form = 'ingredient'
    AND dish_type = 'dish';

-- dishPriority 初始化
UPDATE foods SET dish_priority = LEAST(
  (COALESCE(commonality_score, 50) * 0.6 + COALESCE(popularity, 50) * 0.4)::INT,
  100
) WHERE food_form IN ('dish', 'semi_prepared');
```

### 9.3 Prisma Schema 变更

```prisma
model foods {
  // ... 已有字段 ...

  // V7.3: 食物形态与大众化
  food_form       String?  @default("ingredient") @db.VarChar(20)
  dish_priority   Int?
}
```

### 9.4 Seed 数据更新

需要更新 `seed-foods.data.ts`，为每个食物项添加 `food_form` 和 `dish_priority` 字段。

---

## 十、文档升级（Step 7）

### 新增文档

1. 本文档 (`INTELLIGENT_DIET_SYSTEM_V7_3_UPGRADE.md`)

### 修改内容

无（V7.2文档保持不变，V7.3作为独立增量文档）

### 删除内容

无

---

## 十一、总结

V7.3 是 V7.2 的**智能化 + 场景化升级**，核心改进：

1. **食物大众化**：新增foodForm区分原材料/成品菜/半成品，推荐优先成品菜，贴近日常饮食
2. **餐食模板系统**：6个内置模板（中式标准/面食套餐/快餐组合等），场景自动匹配，算法在模板框架内填充
3. **场景化评分策略**：每种场景独立的评分维度权重调整，外卖看性价比/做饭看营养密度
4. **自然语言解释**：从技术化解释→"推荐鱼肉是因为你这周蛋白质来源单一"
5. **Factor级权重学习**：用户反馈自动归因到具体评分因子，动态调整因子影响力
6. **性能优化**：请求级缓存去重 + 缓存预热 + DietModule拆分为3个子模块
7. **营养覆盖增强**：NRF9.3→NRF11.4(+zinc/magnesium/transFat)，食谱营养从ingredient聚合
