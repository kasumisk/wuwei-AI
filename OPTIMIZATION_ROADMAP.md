# 推荐引擎 & 食物库 持续优化路线图

> 基于当前代码现状 + 食物库优化建议 + 推荐引擎优化方案，整理的可执行迭代计划  
> 更新日期：2026-04-08

---

## 一、当前系统现状评估

### 1.1 已完成的基础能力

| 模块 | 状态 | 说明 |
|------|------|------|
| 食物库 `FoodLibrary` | ✅ 可用 | 150+ 食物，含基础营养数据 + 标签 + 置信度 |
| 推荐引擎 `RecommendationEngineService` | ✅ 可用 | 6 维评分 + 约束生成 + 餐次策略 |
| 每日计划 `DailyPlanService` | ✅ 可用 | 串行生成 + 跨餐排除 + 预算分配 |
| 多样性控制 | ✅ 可用 | 相似度惩罚 (`diversifyWithPenalty`) + ε-greedy 随机探索 |
| 场景化推荐 | ✅ 可用 | 外卖/便利店/家里 三场景 |
| 用户画像 `UserProfile` | ✅ 可用 | 目标/体型/饮食偏好/弱势时段/暴饮触发 |
| 行为画像 `UserBehaviorProfile` | ✅ 可用 | 连续打卡/合规率/偏好食物/失败触发 |
| 动态调整 `adjustPlan` | ✅ 可用 | 按时段重新分配剩余预算 |

### 1.2 当前食物库字段（实际 Entity）

```typescript
// food-library.entity.ts
{
  id, name, aliases, category,            // 基础
  caloriesPer100g, proteinPer100g,        // 营养
  fatPer100g, carbsPer100g,
  standardServingG, standardServingDesc,   // 份量
  searchWeight, isVerified,                // 搜索
  tags: string[],                          // 标签（自动推导）
  source, confidence                       // 数据质量
}
```

### 1.3 当前差距（对照食物库优化建议）

| 建议字段 | 当前状态 | 影响 |
|---------|---------|------|
| `fiber`（膳食纤维） | ❌ 缺失 | 饱腹感计算不精准，只能依赖分类粗略映射 |
| `sugar`（糖） | ❌ 缺失 | 无法针对控糖用户做精确推荐 |
| `sodium`（钠） | ❌ 缺失 | 健康评分维度不足 |
| `glycemicIndex`（GI值） | ❌ 缺失 | 糖尿病/血糖管理用户无法适配 |
| `isProcessed`（加工食品标记） | ❌ 缺失 | 只能通过 category=快餐 粗略判断 |
| `isFried`（油炸标记） | ❌ 缺失 | 标签里有"油炸"但无结构化字段 |
| `mealTypes`（适合餐次） | ❌ 缺失 | 餐次策略只能依赖标签匹配，无法精确控制 |
| `mainIngredient`（主要食材） | ❌ 缺失 | 多样性控制只到 category 粒度，鸡胸肉和宫保鸡丁无法识别为同一食材 |
| `subCategory`（子分类） | ❌ 缺失 | 瘦肉/肥肉/加工肉无法区分 |
| `compatibility`（搭配关系） | ❌ 缺失 | 无法生成合理的食物组合 |
| `qualityScore / satietyScore` | ⚠️ 从分类推导 | 同一分类下的食物得分完全相同，精度不够 |

### 1.4 推荐引擎当前不足

| 问题 | 当前状态 | 影响 |
|------|---------|------|
| 评分维度粗糙 | quality/satiety 仅按 `category` 映射 | 同类食物评分一致，区分度低 |
| 无用户偏好融合 | 评分不考虑用户历史偏好 | 不喜欢的食物照推不误 |
| 无套餐组合逻辑 | 每餐选 Top3，无角色约束 | 可能选出 3 个蛋白质或 3 个主食 |
| 标签驱动过于简单 | `includeTags` OR 匹配 | 标签缺失的食物直接被过滤 |
| 份量不可调 | 固定 `standardServingG` | 无法根据预算动态调整份量 |
| 无时间感知 | 不考虑用户当前时间习惯 | 不能利用行为画像的`weakTimeSlots` |
| 动态调整仍用旧方法 | `adjustPlan` 仍调 `recommendMeal` | 未使用优化后的 `recommendMealFromPool` |

---

## 二、分阶段优化路线

### 阶段总览

```
Phase 1（数据基建）    → 食物库字段扩展 + 数据补充
Phase 2（引擎增强）    → 套餐组合 + 份量调节 + 评分优化
Phase 3（个性化）      → 用户偏好学习 + 行为画像融合
Phase 4（智能化）      → AI 自动打标 + 自适应权重 + 反馈闭环
```

---

## Phase 1：数据基建（食物库升级）

> **目标**：让食物数据从"营养记录层"升级到"决策引擎级数据结构"  
> **预期效果**：推荐精准度提升，多样性控制到食材粒度

### 1.1 Entity 字段扩展

```sql
-- 新增字段（Migration）
ALTER TABLE foods ADD COLUMN fiber_per_100g DECIMAL(5,1) DEFAULT NULL;
ALTER TABLE foods ADD COLUMN sugar_per_100g DECIMAL(5,1) DEFAULT NULL;
ALTER TABLE foods ADD COLUMN sodium_per_100g DECIMAL(6,1) DEFAULT NULL;
ALTER TABLE foods ADD COLUMN glycemic_index INT DEFAULT NULL;
ALTER TABLE foods ADD COLUMN is_processed BOOLEAN DEFAULT false;
ALTER TABLE foods ADD COLUMN is_fried BOOLEAN DEFAULT false;
ALTER TABLE foods ADD COLUMN meal_types JSONB DEFAULT '["breakfast","lunch","dinner"]'::jsonb;
ALTER TABLE foods ADD COLUMN main_ingredient VARCHAR(50) DEFAULT NULL;
ALTER TABLE foods ADD COLUMN sub_category VARCHAR(50) DEFAULT NULL;
ALTER TABLE foods ADD COLUMN quality_score INT DEFAULT NULL;
ALTER TABLE foods ADD COLUMN satiety_score INT DEFAULT NULL;
```

### 1.2 Entity 代码修改

```typescript
// food-library.entity.ts 新增字段
@Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'fiber_per_100g' })
fiberPer100g?: number;

@Column({ type: 'decimal', precision: 5, scale: 1, nullable: true, name: 'sugar_per_100g' })
sugarPer100g?: number;

@Column({ type: 'decimal', precision: 6, scale: 1, nullable: true, name: 'sodium_per_100g' })
sodiumPer100g?: number;

@Column({ type: 'int', nullable: true, name: 'glycemic_index' })
glycemicIndex?: number;

@Column({ type: 'boolean', default: false, name: 'is_processed' })
isProcessed: boolean;

@Column({ type: 'boolean', default: false, name: 'is_fried' })
isFried: boolean;

@Column({ type: 'jsonb', default: ['breakfast', 'lunch', 'dinner'], name: 'meal_types' })
mealTypes: string[];

@Column({ type: 'varchar', length: 50, nullable: true, name: 'main_ingredient' })
mainIngredient?: string;

@Column({ type: 'varchar', length: 50, nullable: true, name: 'sub_category' })
subCategory?: string;

@Column({ type: 'int', nullable: true, name: 'quality_score', comment: '食物品质评分 1-10' })
qualityScore?: number;

@Column({ type: 'int', nullable: true, name: 'satiety_score', comment: '饱腹感评分 1-10' })
satietyScore?: number;
```

### 1.3 种子数据补充（示例）

```typescript
// seed-foods.data.ts 升级后的数据结构
{
  name: '鸡胸肉（水煮）',
  category: '肉类',
  subCategory: 'lean_meat',          // 新增：瘦肉
  mainIngredient: 'chicken',          // 新增：主食材
  caloriesPer100g: 133,
  proteinPer100g: 31, fatPer100g: 1.2, carbsPer100g: 0,
  fiberPer100g: 0,                    // 新增
  sugarPer100g: 0,                    // 新增
  sodiumPer100g: 74,                  // 新增
  glycemicIndex: 0,                   // 新增
  isProcessed: false,                 // 新增
  isFried: false,                     // 新增
  mealTypes: ['lunch', 'dinner'],     // 新增：适合餐次
  qualityScore: 9,                    // 新增：独立品质分
  satietyScore: 8,                    // 新增：独立饱腹分
  standardServingG: 150,
  standardServingDesc: '1块约150g',
  searchWeight: 195,
}
```

### 1.4 数据补充策略

| 步骤 | 方法 | 范围 |
|------|------|------|
| 1 | 脚本批量推导 | `isProcessed`（category=快餐→true）、`isFried`（根据名称关键词）、`mainIngredient`（根据名称提取） |
| 2 | AI 辅助标注 | `mealTypes`、`qualityScore`、`satietyScore`、`subCategory`（让 GPT 批量生成） |
| 3 | 手动校验 | 核心 50 个常用食物优先校验 |
| 4 | 管理后台入口 | 在 admin 添加食物编辑页，支持逐条修正 |

### 1.5 Admin 食物管理页（配套）

在 `apps/admin/` 新增食物库管理页面：
- 食物列表（搜索、筛选、分页）
- 食物编辑表单（包含所有新增字段）
- 批量导入/导出 CSV
- 标签管理

### 1.6 交付物

- [ ] 数据库 Migration（新增 11 个字段）
- [ ] `food-library.entity.ts` 更新
- [ ] `seed-foods.data.ts` 升级（150 个食物补充新字段）
- [ ] 数据批量推导脚本（自动填充 `isProcessed`、`isFried`、`mainIngredient`）
- [ ] Admin 食物管理页面

---

## Phase 2：推荐引擎增强

> **目标**：从"Top3 贪心选取"升级到"角色化套餐组合 + 动态份量"  
> **预期效果**：每餐推荐有主食+蛋白+蔬菜的合理结构

### 2.1 评分模型优化

**问题**：当前 `qualityScore` 和 `satietyScore` 从 `CATEGORY_QUALITY / CATEGORY_SATIETY` 映射，同分类下所有食物分数一样。

**改造**：优先使用食物自身的 `qualityScore / satietyScore`，没有时 fallback 到分类映射。

```typescript
// recommendation-engine.service.ts → scoreFood()
scoreFood(food: FoodLibrary, goalType: string): number {
  // ...existing 热量/蛋白/碳水/脂肪评分...

  // 优先使用食物独立评分，fallback 到分类映射
  const quality = food.qualityScore ?? (CATEGORY_QUALITY[food.category] || 5);
  const satiety = food.satietyScore ?? (CATEGORY_SATIETY[food.category] || 4);

  // 新增：加工食品惩罚
  let processedPenalty = 0;
  if (food.isProcessed) processedPenalty += 0.05;
  if (food.isFried) processedPenalty += 0.08;

  // 新增：纤维加分（影响饱腹感）
  const fiberBonus = food.fiberPer100g
    ? Math.min(food.fiberPer100g / 10, 0.1) * 0.05
    : 0;

  const qualityScore = quality / 10;
  const satietyScore = satiety / 10;
  // ...加权求和...
  return (rawScore + fiberBonus - processedPenalty) * (0.7 + 0.3 * confidence);
}
```

### 2.2 餐次约束升级（结构化 mealTypes）

**问题**：当前餐次策略仅通过标签匹配，不精确。

**改造**：新增 `mealTypes` 字段后，在 `filterFoods` 中直接过滤。

```typescript
// filterFoods() 中新增
filterFoods(foods: FoodLibrary[], constraint: Constraint, mealType?: string): FoodLibrary[] {
  return foods.filter(food => {
    // ...existing 标签/热量/蛋白筛选...

    // 餐次匹配（如果食物有 mealTypes 字段）
    if (mealType && food.mealTypes?.length > 0) {
      if (!food.mealTypes.includes(mealType)) return false;
    }

    return true;
  });
}
```

### 2.3 套餐组合（角色化选取）⭐ 关键优化

**问题**：当前每餐直接选 Top3，可能出现 3 个肉类或 3 个主食。

**改造**：每餐按"主食+蛋白质+蔬菜/配菜"角色分别各选 1 个最优。

```typescript
// 定义每餐角色模板
const MEAL_ROLES: Record<string, { roles: string[]; categoryMap: Record<string, string[]> }> = {
  breakfast: {
    roles: ['carb', 'protein', 'side'],
    categoryMap: {
      carb: ['主食'],
      protein: ['肉类', '豆制品'],
      side: ['水果', '饮品', '蔬菜'],
    },
  },
  lunch: {
    roles: ['carb', 'protein', 'veggie'],
    categoryMap: {
      carb: ['主食'],
      protein: ['肉类', '豆制品'],
      veggie: ['蔬菜', '汤类'],
    },
  },
  dinner: {
    roles: ['protein', 'veggie', 'side'],
    categoryMap: {
      protein: ['肉类', '豆制品'],
      veggie: ['蔬菜'],
      side: ['汤类', '水果'],
    },
  },
  snack: {
    roles: ['snack1', 'snack2'],
    categoryMap: {
      snack1: ['水果', '零食'],
      snack2: ['饮品', '豆制品'],
    },
  },
};

recommendMealFromPool(...): MealRecommendation {
  const template = MEAL_ROLES[mealType] || MEAL_ROLES.lunch;
  const picks: ScoredFood[] = [];

  for (const role of template.roles) {
    const allowedCategories = template.categoryMap[role];
    // 从该角色允许的分类中，选评分最高的（排除已选）
    const roleCandidates = scored
      .filter(sf => allowedCategories.includes(sf.food.category))
      .filter(sf => !excludeNames.includes(sf.food.name))
      .filter(sf => !picks.some(p => p.food.name === sf.food.name));

    if (roleCandidates.length > 0) {
      // 加入随机探索后选最佳
      const explored = this.addExploration(roleCandidates, 0.15);
      picks.push(explored[0]);
    }
  }
  // ...聚合...
}
```

### 2.4 多样性控制升级（食材粒度）

**问题**：当前相似度只看 `category` 和 `tags`，鸡胸肉和宫保鸡丁无法识别为同一食材。

**改造**：使用 `mainIngredient` 字段提升相似度精准度。

```typescript
private similarity(a: FoodLibrary, b: FoodLibrary): number {
  let score = 0;
  if (a.category === b.category) score += 0.3;   // 同大类
  if (a.subCategory && a.subCategory === b.subCategory) score += 0.2; // 同子类
  if (a.mainIngredient && a.mainIngredient === b.mainIngredient) score += 0.5; // 同食材（最高权重）
  const tagsA = a.tags || [];
  const tagsB = b.tags || [];
  score += tagsA.filter(t => tagsB.includes(t)).length * 0.05;
  return score;
}
```

### 2.5 动态份量调节

**问题**：当前固定 `standardServingG`，推荐总热量可能偏离预算。

**改造**：选完食物后，按预算比例缩放份量。

```typescript
// 选完 picks 后，根据总预算调整份量
private adjustPortions(picks: ScoredFood[], targetCalories: number): ScoredFood[] {
  const rawTotal = picks.reduce((s, p) => s + p.servingCalories, 0);
  if (rawTotal === 0) return picks;

  const ratio = Math.min(Math.max(targetCalories / rawTotal, 0.6), 1.5); // 限制缩放范围

  return picks.map(p => ({
    ...p,
    servingCalories: Math.round(p.servingCalories * ratio),
    servingProtein: Math.round(p.servingProtein * ratio),
    servingFat: Math.round(p.servingFat * ratio),
    servingCarbs: Math.round(p.servingCarbs * ratio),
  }));
}
```

### 2.6 `adjustPlan` 统一使用优化方法

```typescript
// daily-plan.service.ts → adjustPlan()
// 将 this.recommendationEngine.recommendMeal(...) 改为
// this.recommendationEngine.recommendMealFromPool(allFoods, ...)
```

### 2.7 交付物

- [ ] `scoreFood()` 支持独立评分 + 加工惩罚 + 纤维加分
- [ ] `filterFoods()` 支持 `mealTypes` 结构化过滤
- [ ] `recommendMealFromPool()` 改为角色化套餐组合
- [ ] `similarity()` 升级支持 `mainIngredient` + `subCategory`
- [ ] `adjustPortions()` 动态份量调节
- [ ] `adjustPlan()` 统一使用 `recommendMealFromPool`

---

## Phase 3：个性化推荐

> **目标**：融合用户行为画像，让推荐"越用越准"  
> **预期效果**：推荐结果贴合用户口味，避开不喜欢的食物

### 3.1 用户偏好评分融合

利用已有的 `UserBehaviorProfile` 中的 `foodPreferences.loves / avoids / frequentFoods`。

```typescript
// scoreFood() 中新增用户偏好项
scoreFoodWithPreference(
  food: FoodLibrary,
  goalType: string,
  behaviorProfile?: UserBehaviorProfile,
): number {
  let baseScore = this.scoreFood(food, goalType);

  if (behaviorProfile?.foodPreferences) {
    const prefs = behaviorProfile.foodPreferences;

    // 用户喜欢的食物加分
    if (prefs.loves?.includes(food.name)) baseScore *= 1.15;

    // 用户不喜欢的食物降分
    if (prefs.avoids?.includes(food.name)) baseScore *= 0.3;

    // 用户常吃的食物轻微加分（但不过度）
    if (prefs.frequentFoods?.includes(food.name)) baseScore *= 1.05;
  }

  return baseScore;
}
```

### 3.2 饮食偏好标签映射

利用 `UserProfile.foodPreferences[]`（sweet/fried/carbs/meat/spicy）调整约束。

```typescript
// generateConstraints() 新增
if (userProfile?.foodPreferences) {
  const prefTags = userProfile.foodPreferences;

  // 如果用户偏好 sweet，include 相关标签但避免过量
  if (prefTags.includes('sweet') && goalType !== 'fat_loss') {
    includeTags.push('甜品');
  }

  // 如果用户偏好 fried 但目标是减脂，排除
  if (prefTags.includes('fried') && goalType === 'fat_loss') {
    excludeTags.push('油炸');
  }

  // 如果用户偏好 spicy
  if (prefTags.includes('spicy')) {
    // 不排除重口味
  } else {
    // 默认早餐排除重口味已在 MEAL_PREFERENCES 中
  }
}

// 利用 dietaryRestrictions 做硬排除
if (userProfile?.dietaryRestrictions?.length) {
  excludeTags.push(...userProfile.dietaryRestrictions);
}
```

### 3.3 行为画像驱动的推荐策略

利用 `weakTimeSlots`、`bingeTriggers`、`discipline` 调整推荐。

```typescript
// 低自律用户 → 减少高诱惑食物
if (userProfile?.discipline === 'low') {
  excludeTags.push('甜品', '油炸', '零食');
}

// 下午是弱势时段 → 加餐推荐高饱腹低热量
if (userProfile?.weakTimeSlots?.includes('afternoon') && mealType === 'snack') {
  includeTags.push('高饱腹', '低热量');
}

// 晚上是弱势时段 → 晚餐推荐高饱腹
if (userProfile?.weakTimeSlots?.includes('evening') && mealType === 'dinner') {
  includeTags.push('高饱腹');
}
```

### 3.4 隐式偏好学习

从用户实际饮食记录中学习偏好，自动更新 `behaviorProfile.foodPreferences`。

```typescript
// behavior.service.ts 新增
async updateFoodPreferences(userId: string): Promise<void> {
  // 统计最近30天食物频次
  const records = await this.getRecentRecords(userId, 30);
  const foodCounts = new Map<string, number>();
  for (const record of records) {
    for (const food of record.foods) {
      foodCounts.set(food.name, (foodCounts.get(food.name) || 0) + 1);
    }
  }

  // Top 10 = loves（用户反复吃的就是喜欢的）
  const sorted = [...foodCounts.entries()].sort((a, b) => b[1] - a[1]);
  const loves = sorted.slice(0, 10).map(([name]) => name);
  const frequentFoods = sorted.slice(0, 20).map(([name]) => name);

  // 更新行为画像
  await this.updateProfile(userId, {
    foodPreferences: { loves, frequentFoods, avoids: [] },
  });
}
```

### 3.5 交付物

- [ ] `scoreFoodWithPreference()` 融合行为画像偏好
- [ ] `generateConstraints()` 融合 `dietaryRestrictions` + `foodPreferences`
- [ ] 弱势时段策略 + 自律度适配
- [ ] `updateFoodPreferences()` 隐式偏好学习（定时任务）
- [ ] `recommendMealFromPool()` 接入 `userProfile` + `behaviorProfile`

---

## Phase 4：智能化与反馈闭环

> **目标**：AI 辅助数据维护 + 推荐效果可度量 + 自适应优化  
> **预期效果**：系统能自我进化

### 4.1 AI 自动打标签

新增食物入库时，用 AI 自动生成：
- `mealTypes`（适合餐次）
- `qualityScore / satietyScore`
- `mainIngredient`
- `subCategory`
- `isProcessed / isFried`

```typescript
// food-library.service.ts 新增
async enrichFoodWithAI(food: Partial<FoodLibrary>): Promise<Partial<FoodLibrary>> {
  const prompt = `根据这个食物的信息，返回 JSON：
    食物名: ${food.name}
    分类: ${food.category}
    热量: ${food.caloriesPer100g} kcal/100g
    蛋白质: ${food.proteinPer100g} g/100g

    请返回：
    {
      "mealTypes": ["breakfast"|"lunch"|"dinner"|"snack"],
      "qualityScore": 1-10,
      "satietyScore": 1-10,
      "mainIngredient": "主要食材英文",
      "subCategory": "子分类英文",
      "isProcessed": boolean,
      "isFried": boolean
    }`;

  const result = await this.aiService.chat(prompt);
  return { ...food, ...JSON.parse(result) };
}
```

### 4.2 推荐效果追踪

新增推荐-执行关联表，追踪推荐被采纳率。

```typescript
// 新建 recommendation-feedback.entity.ts
@Entity('recommendation_feedback')
class RecommendationFeedback {
  id: string;
  userId: string;
  date: string;
  mealType: string;
  recommendedFoods: string[];    // 推荐了什么
  actualFoods: string[];         // 实际吃了什么
  adoptionRate: number;          // 采纳率 0-1
  createdAt: Date;
}
```

当用户记录饮食时，自动对比当天推荐 vs 实际：

```typescript
// food.service.ts → addRecord() 中新增
async trackRecommendationAdoption(userId: string, mealType: string, actualFoods: string[]) {
  const plan = await this.dailyPlanService.getPlan(userId);
  const recommended = this.extractFoodNames(plan, mealType);
  const overlap = actualFoods.filter(f => recommended.includes(f));
  const adoptionRate = recommended.length > 0 ? overlap.length / recommended.length : 0;

  await this.feedbackRepo.save({
    userId, date: today, mealType,
    recommendedFoods: recommended,
    actualFoods,
    adoptionRate,
  });
}
```

### 4.3 自适应评分权重

根据用户采纳率反馈，动态调整该用户的评分权重：

```typescript
// 如果用户总是选高饱腹食物，提升该维度权重
async getPersonalizedWeights(userId: string, goalType: GoalType): Promise<number[]> {
  const baseWeights = SCORE_WEIGHTS[goalType];
  const feedbacks = await this.feedbackRepo.find({ where: { userId }, take: 30 });

  if (feedbacks.length < 10) return baseWeights; // 数据不够，用默认

  // 分析采纳的食物 vs 未采纳的食物在各维度的差异
  // 调整权重向用户实际偏好倾斜
  // ...
  return adjustedWeights;
}
```

### 4.4 食物搭配规则引擎

基于 `compatibility` 数据，生成更合理的组合：

```typescript
// 未来扩展
interface FoodCompatibility {
  goodWith: string[];    // 搭配推荐
  badWith: string[];     // 避免搭配
}

// 在套餐组合时检查搭配
if (food.compatibility?.badWith?.some(b => picks.some(p => p.food.mainIngredient === b))) {
  skip this food;
}
```

### 4.5 交付物

- [ ] AI 自动打标脚本（批量 + 新增时自动）
- [ ] `recommendation_feedback` 表 + 追踪逻辑
- [ ] 采纳率仪表盘（Admin）
- [ ] 自适应权重（基于反馈）
- [ ] 食物搭配规则

---

## 三、迭代优先级与依赖关系

```
                     ┌─────────────────────────┐
                     │     Phase 1（数据基建）    │
                     │  食物库字段 + 数据补充     │
                     └────────┬────────────────┘
                              │
                              │ 依赖：新字段
                              ▼
      ┌───────────────────────┴──────────────────────┐
      │                                              │
      ▼                                              ▼
┌──────────────┐                          ┌──────────────────┐
│ Phase 2a     │                          │ Phase 2b          │
│ 评分优化     │                          │ 套餐组合          │
│ +加工惩罚    │                          │ +份量调节         │
│ +mealTypes   │                          │ +角色模板         │
└──────┬───────┘                          └────────┬─────────┘
       │                                           │
       └──────────────┬────────────────────────────┘
                      │
                      ▼
           ┌──────────────────┐
           │    Phase 3       │
           │   个性化推荐      │
           │ +偏好学习         │
           │ +行为融合         │
           └────────┬─────────┘
                    │
                    ▼
           ┌──────────────────┐
           │    Phase 4       │
           │   智能化闭环      │
           │ +AI打标           │
           │ +反馈追踪         │
           │ +自适应权重       │
           └──────────────────┘
```

### 优先级排序

| 优先级 | 任务 | 所属阶段 | 依赖 | 效果 |
|--------|------|---------|------|------|
| **P0** | Entity 字段扩展 + Migration | Phase 1 | 无 | 后续所有优化的基础 |
| **P0** | 种子数据补充（核心 50 个食物） | Phase 1 | Migration | 立即提升推荐质量 |
| **P1** | 评分模型优化（独立品质分+加工惩罚） | Phase 2a | 新字段 | 评分更精准 |
| **P1** | 套餐组合（角色化选取） | Phase 2b | 无硬依赖 | 每餐结构合理 |
| **P1** | 相似度升级（mainIngredient） | Phase 2a | 新字段 | 消除同食材重复 |
| **P2** | mealTypes 结构化过滤 | Phase 2a | 新字段 | 餐次推荐更精确 |
| **P2** | 动态份量调节 | Phase 2b | 无 | 预算匹配度提升 |
| **P2** | 用户偏好融合 | Phase 3 | 行为画像 | 个性化 |
| **P2** | adjustPlan 统一方法 | Phase 2 | 无 | 代码一致性 |
| **P3** | 弱势时段 + 自律度策略 | Phase 3 | UserProfile | 行为干预 |
| **P3** | 隐式偏好学习 | Phase 3 | 饮食记录 | 自动化 |
| **P3** | AI 自动打标 | Phase 4 | AI Service | 数据维护效率 |
| **P4** | 推荐采纳率追踪 | Phase 4 | 无 | 效果可度量 |
| **P4** | 自适应权重 | Phase 4 | 采纳率数据 | 自我进化 |
| **P4** | 食物搭配规则 | Phase 4 | 搭配数据 | 组合质量 |
| **P4** | Admin 食物管理页 | Phase 1 | Entity | 数据维护 |

---

## 四、快速见效改动（可立即执行，不依赖数据库改动）

以下优化不需要新增字段，可在当前代码基础上直接实施：

### 4.1 套餐角色化（立即可做）

基于现有 `category` 字段实现初版角色模板，无需新字段。

### 4.2 adjustPlan 统一方法（立即可做）

将 `daily-plan.service.ts` 中 `adjustPlan()` 的 `recommendMeal()` 调用改为 `recommendMealFromPool()`。

### 4.3 用户偏好硬排除（立即可做）

利用已有 `UserProfile.dietaryRestrictions[]` 在约束生成中做 excludeTags。

### 4.4 弱势时段策略（立即可做）

利用已有 `UserProfile.weakTimeSlots[]` + `discipline` 调整约束。

---

## 五、指标体系

### 效果度量

| 指标 | 计算方式 | 目标值 |
|------|---------|--------|
| 四餐不重复率 | 计划中无重复食物的天数 / 总天数 | > 95% |
| 餐次结构合理率 | 含主食+蛋白+蔬菜的餐次比例 | > 80% |
| 推荐采纳率 | 实际吃的 ∩ 推荐的 / |推荐的| | > 30%（初期） |
| 食物多样性指数 | 7 天内不重复食物数 | > 20 种 |
| 营养达标率 | 推荐总热量在预算 ±15% 内 | > 90% |

---

## 六、技术风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| 食物库数据不足 | 新字段大量 null，推荐 fallback 到旧逻辑 | 所有新字段逻辑都有 fallback，渐进式迁移 |
| 角色化选取候选不足 | 某角色分类下食物太少 | 允许 fallback 到全品类选取 |
| 用户偏好数据冷启动 | 新用户无历史记录 | 默认用目标驱动权重，积累 10 条记录后启用 |
| AI 打标不准确 | 部分食物 mealTypes / qualityScore 有误 | AI 结果需人工审核，admin 提供修正入口 |
