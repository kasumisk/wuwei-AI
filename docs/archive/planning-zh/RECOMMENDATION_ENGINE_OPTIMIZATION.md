# 推荐引擎优化方案（最终版）

> 基于 `RecommendationEngineService` + `DailyPlanService` 的完整优化方案  
> 目标：解决每日计划推荐重复、缺乏多样性的问题

---

## 一、当前架构分析

### 1.1 核心流程

```
用户请求每日计划
  → DailyPlanService.generatePlan()
    → 获取用户状态（consumed）+ 用户档案（profile）
    → 计算每日营养目标（goals）
    → 按比例分配4餐预算（25/35/30/10）
    → 并行调用 recommendMeal() × 4
    → 存储计划
```

### 1.2 推荐引擎流程（单餐）

```
recommendMeal(userId, mealType, goalType, consumed, target, dailyTarget)
  → 获取所有已验证食物（foodLibraryRepo.find）
  → generateConstraints() → 约束生成
  → filterFoods() → 食物筛选
  → scoreFood() → 6维评分排序
  → diversify() → 多样性控制（取Top3）
  → 返回 MealRecommendation
```

### 1.3 评分模型（6维加权）

| 维度             | fat_loss | muscle_gain | health | habit |
| ---------------- | -------- | ----------- | ------ | ----- |
| 热量（越低越好） | 0.30     | 0.25        | 0.15   | 0.20  |
| 蛋白质           | 0.25     | 0.30        | 0.10   | 0.15  |
| 碳水（越低越好） | 0.15     | 0.20        | 0.10   | 0.10  |
| 脂肪（越低越好） | 0.10     | 0.10        | 0.10   | 0.10  |
| 食物品质         | 0.10     | 0.10        | 0.30   | 0.25  |
| 饱腹感           | 0.10     | 0.05        | 0.25   | 0.20  |

### 1.4 现有多样性控制 `diversify()`

```typescript
diversify(foods: ScoredFood[], recentFoodNames: string[], limit = 3) {
  // 1. 跳过最近3天吃过的食物
  // 2. 同分类最多2个
  // 3. 不够则放开限制补齐
}
```

---

## 二、问题诊断

### 2.1 核心问题：四餐推荐结果完全相同

**实际 API 返回示例**（`/api/app/food/daily-plan`）：

| 餐次 | 推荐结果                                  |
| ---- | ----------------------------------------- |
| 早餐 | 鸡胸肉 + 水煮虾 + 肯德基原味鸡（640kcal） |
| 午餐 | 鸡胸肉 + 水煮虾 + 肯德基原味鸡（640kcal） |
| 晚餐 | 鸡胸肉 + 水煮虾 + 肯德基原味鸡（640kcal） |
| 加餐 | 鸡胸肉 + 水煮虾 + 蒜蓉西兰花（436kcal）   |

### 2.2 根因分析

| #   | 根因                   | 说明                                                                              |
| --- | ---------------------- | --------------------------------------------------------------------------------- |
| 1   | **并行调用无信息共享** | 4次 `recommendMeal()` 是 `Promise.all()` 并行，每次调用拿到的 `consumed` 完全相同 |
| 2   | **无餐次策略差异**     | 早/午/晚/加餐只有 `mealType` 字面不同，但 `generateConstraints()` 不区分餐次      |
| 3   | **贪心评分**           | `scoreFood()` 是纯函数，同一 `goalType` 每次排名一致，鸡胸肉永远第一              |
| 4   | **多样性控制范围太窄** | `diversify()` 只在单次调用内去重（同类别 ≤ 2），不在跨餐次层面去重                |
| 5   | **无随机探索**         | 完全确定性排序，用户会觉得"AI很死板"                                              |

---

## 三、优化方案

### 3.1 总体策略

```
优化后流程：

DailyPlanService.generatePlan()
  → 获取状态 + 档案 + 目标
  → 获取所有食物（1次查询，共享给4餐）
  → 获取最近吃过的食物（1次查询）
  → 串行生成4餐（非并行）：
      breakfast → lunch → dinner → snack
      每餐选完后，将选中食物加入 excludeNames
  → 每餐餐次有独立约束策略
  → 评分后加随机探索
  → 相似度惩罚 + 类别去重
  → 存储计划
```

### 3.2 优化点1：串行生成 + 跨餐排除

**文件**: `daily-plan.service.ts` → `generatePlan()`

**改动要点**：

- 将 `Promise.all()` 并行改为串行
- 每餐选完后收集 `excludeNames`，传入下一餐
- 共享 `allFoods` 和 `recentFoodNames`，减少数据库查询

```typescript
// 改造前（并行）
const [morningRec, lunchRec, dinnerRec, snackRec] = await Promise.all([
  this.recommendationEngine.recommendMeal(userId, 'breakfast', ...),
  this.recommendationEngine.recommendMeal(userId, 'lunch', ...),
  this.recommendationEngine.recommendMeal(userId, 'dinner', ...),
  this.recommendationEngine.recommendMeal(userId, 'snack', ...),
]);

// 改造后（串行 + 跨餐排除）
const allFoods = await this.recommendationEngine.getAllFoods();
const recentFoodNames = await this.recommendationEngine.getRecentFoodNames(userId, 3);
const excludeNames: string[] = [...recentFoodNames];

const morningRec = this.recommendationEngine.recommendMealFromPool(
  allFoods, 'breakfast', goalType, consumed, buildBudget(mealRatios.morning), dailyTarget, excludeNames
);
excludeNames.push(...morningRec.foods.map(f => f.food.name));

const lunchRec = this.recommendationEngine.recommendMealFromPool(
  allFoods, 'lunch', goalType, consumed, buildBudget(mealRatios.lunch), dailyTarget, excludeNames
);
excludeNames.push(...lunchRec.foods.map(f => f.food.name));

const dinnerRec = this.recommendationEngine.recommendMealFromPool(
  allFoods, 'dinner', goalType, consumed, buildBudget(mealRatios.dinner), dailyTarget, excludeNames
);
excludeNames.push(...dinnerRec.foods.map(f => f.food.name));

const snackRec = this.recommendationEngine.recommendMealFromPool(
  allFoods, 'snack', goalType, consumed, buildBudget(mealRatios.snack), dailyTarget, excludeNames
);
```

### 3.3 优化点2：餐次策略差异化

**文件**: `recommendation-engine.service.ts` → `generateConstraints()`

**改动要点**：根据 `mealType` 增加餐次偏好标签

```typescript
// === 餐次策略 ===
const MEAL_PREFERENCES: Record<string, { includeTags: string[]; excludeTags: string[] }> = {
  breakfast: {
    includeTags: ['早餐', '高碳水', '易消化'],     // 早餐偏碳水能量
    excludeTags: ['油炸', '重口味'],
  },
  lunch: {
    includeTags: ['均衡'],                          // 午餐求均衡
    excludeTags: [],
  },
  dinner: {
    includeTags: ['低碳水', '高蛋白', '清淡'],     // 晚餐清淡高蛋白
    excludeTags: ['高碳水', '甜品'],
  },
  snack: {
    includeTags: ['低热量', '零食', '水果'],        // 加餐小份健康
    excludeTags: ['油炸', '高脂肪'],
  },
};

// 在 generateConstraints() 中增加：
generateConstraints(
  goalType: string,
  mealType: string,     // 新增参数
  consumed: {...},
  target: MealTarget,
  dailyTarget: {...},
): Constraint {
  // ...原有逻辑...

  // 餐次偏好
  const mealPref = MEAL_PREFERENCES[mealType];
  if (mealPref) {
    includeTags.push(...mealPref.includeTags);
    excludeTags.push(...mealPref.excludeTags);
  }

  return { includeTags: [...new Set(includeTags)], excludeTags: [...new Set(excludeTags)], ... };
}
```

### 3.4 优化点3：相似度惩罚替代简单去重

**文件**: `recommendation-engine.service.ts` → 新增 `diversifyWithPenalty()`

**改动要点**：已选食物对同类/相似食物的评分施加惩罚

```typescript
/**
 * 相似度计算：同类别 +0.5，共同标签 +0.1/个
 */
private similarity(a: FoodLibrary, b: FoodLibrary): number {
  let score = 0;
  if (a.category === b.category) score += 0.5;
  const tagsA = a.tags || [];
  const tagsB = b.tags || [];
  score += tagsA.filter(t => tagsB.includes(t)).length * 0.1;
  return score;
}

/**
 * 带惩罚的多样性选择（替代原 diversify）
 * 已选食物会降低相似候选的最终得分
 */
diversifyWithPenalty(
  scored: ScoredFood[],
  excludeNames: string[],
  limit: number = 3,
): ScoredFood[] {
  const candidates = scored.filter(sf => !excludeNames.includes(sf.food.name));
  const result: ScoredFood[] = [];

  while (result.length < limit && candidates.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;

    candidates.forEach((item, i) => {
      let penalty = 0;
      for (const selected of result) {
        penalty += this.similarity(item.food, selected.food) * 0.3;
      }
      const finalScore = item.score - penalty;
      if (finalScore > bestScore) {
        bestScore = finalScore;
        bestIdx = i;
      }
    });

    result.push(candidates[bestIdx]);
    candidates.splice(bestIdx, 1);
  }

  return result;
}
```

### 3.5 优化点4：随机探索

**改动要点**：在 Top 评分中加入 ε-greedy 策略

```typescript
/**
 * 在评分排序后加入轻微扰动
 * 让 Top5~Top10 有机会替代 Top1~Top3
 */
private addExploration(scored: ScoredFood[], epsilon: number = 0.15): ScoredFood[] {
  return scored.map(sf => ({
    ...sf,
    score: sf.score * (1 + (Math.random() - 0.5) * epsilon),
  })).sort((a, b) => b.score - a.score);
}
```

在 `recommendMealFromPool()` 中使用：

```typescript
// 评分排序
let scored = candidates.map(food => ({...})).sort((a, b) => b.score - a.score);

// 加入随机探索
scored = this.addExploration(scored, 0.15);

// 相似度惩罚多样化选择
const picks = this.diversifyWithPenalty(scored, excludeNames, 3);
```

### 3.6 优化点5：新增 `recommendMealFromPool()`

**文件**: `recommendation-engine.service.ts`

**说明**：新增同步方法，接受外部传入的食物库和排除列表，避免重复查库

```typescript
/**
 * 从已加载的食物池中推荐（供 DailyPlanService 串行调用）
 * 与 recommendMeal() 保持同签名，但：
 *   1. 接受外部 allFoods（不查库）
 *   2. 接受 excludeNames（跨餐排除）
 *   3. 使用 diversifyWithPenalty 替代 diversify
 *   4. 加入随机探索
 */
recommendMealFromPool(
  allFoods: FoodLibrary[],
  mealType: string,
  goalType: string,
  consumed: { calories: number; protein: number },
  target: MealTarget,
  dailyTarget: { calories: number; protein: number },
  excludeNames: string[],
): MealRecommendation {
  // 约束生成（带餐次策略）
  const constraints = this.generateConstraints(goalType, mealType, consumed, target, dailyTarget);

  // 筛选
  let candidates = this.filterFoods(allFoods, constraints);
  if (candidates.length < 5) {
    candidates = this.filterFoods(allFoods, { ...constraints, includeTags: [] });
  }

  // 评分
  let scored: ScoredFood[] = candidates.map(food => ({
    food,
    score: this.scoreFood(food, goalType),
    servingCalories: Math.round((food.caloriesPer100g * food.standardServingG) / 100),
    servingProtein: Math.round(((food.proteinPer100g || 0) * food.standardServingG) / 100),
    servingFat: Math.round(((food.fatPer100g || 0) * food.standardServingG) / 100),
    servingCarbs: Math.round(((food.carbsPer100g || 0) * food.standardServingG) / 100),
  })).sort((a, b) => b.score - a.score);

  // 随机探索
  scored = this.addExploration(scored, 0.15);

  // 相似度惩罚 + 跨餐排除
  const picks = this.diversifyWithPenalty(scored, excludeNames, 3);

  // 聚合
  const totalCalories = picks.reduce((s, p) => s + p.servingCalories, 0);
  const totalProtein = picks.reduce((s, p) => s + p.servingProtein, 0);
  const totalFat = picks.reduce((s, p) => s + p.servingFat, 0);
  const totalCarbs = picks.reduce((s, p) => s + p.servingCarbs, 0);

  const displayText = picks
    .map(p => `${p.food.name}（${p.food.standardServingDesc}，${p.servingCalories}kcal）`)
    .join(' + ');

  const tip = this.buildTip(mealType, goalType, target, totalCalories);

  return { foods: picks, totalCalories, totalProtein, totalFat, totalCarbs, displayText, tip };
}

/**
 * 暴露食物库查询（供 DailyPlanService 一次性获取）
 */
async getAllFoods(): Promise<FoodLibrary[]> {
  return this.foodLibraryRepo.find({ where: { isVerified: true } });
}
```

---

## 四、改造总结

### 4.1 改动文件清单

| 文件                               | 改动类型 | 说明                                                                                                                              |
| ---------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `recommendation-engine.service.ts` | 增强     | 新增 `MEAL_PREFERENCES`、`similarity()`、`diversifyWithPenalty()`、`addExploration()`、`recommendMealFromPool()`、`getAllFoods()` |
| `recommendation-engine.service.ts` | 修改     | `generateConstraints()` 增加 `mealType` 参数和餐次偏好逻辑                                                                        |
| `daily-plan.service.ts`            | 修改     | `generatePlan()` 从并行改串行，使用 `recommendMealFromPool()`，传递 `excludeNames`                                                |
| `recommendation-engine.service.ts` | 保留     | 原 `recommendMeal()`、`recommendByScenario()`、`diversify()` 保留不动（供 MealSuggestion 实时调用）                               |

### 4.2 兼容性

- **`recommendMeal()`**：保持原签名不变，`FoodService.getMealSuggestion()` 继续使用
- **`recommendByScenario()`**：保持原签名不变
- **新增方法均为增量**，不破坏现有 API

### 4.3 优化前后对比

| 维度       | 优化前                        | 优化后                                    |
| ---------- | ----------------------------- | ----------------------------------------- |
| 四餐结果   | 完全相同（鸡胸肉×4）          | 每餐不同食物                              |
| 餐次策略   | 无差异                        | 早餐碳水 / 午餐均衡 / 晚餐清淡 / 加餐轻食 |
| 多样性控制 | 单餐内类别 ≤2                 | 跨餐食物排除 + 相似度惩罚                 |
| 确定性     | 100%确定性                    | ε-greedy 随机探索（15%扰动）              |
| 数据库查询 | 4次食物库 + 4次最近记录 = 8次 | 1次食物库 + 1次最近记录 = 2次             |
| 调用方式   | 4次并行                       | 4次串行（有依赖）                         |

### 4.4 预期效果示例

```
早餐: 燕麦粥（1碗200g，180kcal）+ 水煮蛋（2个100g，156kcal）+ 牛奶（1杯250ml，162kcal）
午餐: 鸡胸肉（1块150g，200kcal）+ 糙米饭（1碗150g，165kcal）+ 蒜蓉西兰花（1份200g，96kcal）
晚餐: 清蒸鲈鱼（1份200g，196kcal）+ 水煮虾（1份150g，140kcal）+ 凉拌黄瓜（1份150g，24kcal）
加餐: 苹果（1个200g，104kcal）+ 无糖酸奶（1杯150g，93kcal）
```

---

## 五、实施优先级

| 优先级 | 优化点                            | 复杂度 | 效果                     |
| ------ | --------------------------------- | ------ | ------------------------ |
| P0     | 串行生成 + 跨餐排除               | 低     | 立刻消除重复             |
| P0     | 相似度惩罚 `diversifyWithPenalty` | 中     | 单餐内多样性提升         |
| P1     | 餐次策略差异化                    | 低     | 早/午/晚推荐合理性       |
| P1     | 随机探索                          | 低     | 用户体验，每次生成略不同 |
| P2     | 数据库查询优化（共享食物池）      | 低     | 性能：8次→2次查询        |

---

## 六、后续扩展方向

1. **用户偏好学习**：基于用户实际进食记录，动态调整评分权重
2. **季节性推荐**：夏季清凉 / 冬季温热食物偏好
3. **食材搭配规则**：蛋白+碳水+蔬菜的组合模板
4. **预算约束**：根据用户消费水平过滤价格区间
5. **过敏/禁忌**：基于用户 `allergyTags` 严格排除
