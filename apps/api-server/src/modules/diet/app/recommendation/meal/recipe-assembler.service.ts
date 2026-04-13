import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { FoodLibrary } from '../../../../food/food.types';
import {
  AcquisitionChannel,
  AssembledRecipe,
  RecipeNutrition,
  SceneContext,
  ScoredFood,
} from '../types/recommendation.types';

/**
 * V6.9 Phase 1-B: 菜谱组装器
 *
 * 职责：将排序后的食材候选组装为菜谱方案，使推荐结果从"食材列表"升级为"可执行的菜品方案"。
 *
 * 两阶段策略：
 * 1. 数据库匹配 — 用候选食材的 mainIngredient 查询数据库菜谱，匹配率 >= 60% 且渠道/烹饪时间兼容时采用
 * 2. 智能组装 — 无数据库匹配时，按食材角色（protein/carb/veggie/side）分组，组合为菜品方案
 *
 * 降级策略：菜谱组装失败时 graceful 降级，返回空数组（调用方继续使用 ScoredFood[]）。
 */
@Injectable()
export class RecipeAssemblerService {
  private readonly logger = new Logger(RecipeAssemblerService.name);

  /** 数据库菜谱匹配阈值 */
  private static readonly MATCH_RATE_THRESHOLD = 0.6;
  /** 数据库查询返回上限 */
  private static readonly DB_QUERY_LIMIT = 10;

  constructor(private readonly prisma: PrismaService) {}

  // ==================== 公开方法 ====================

  /**
   * 尝试将排序后的食材候选组装为菜谱方案
   *
   * @param scoredFoods  排序后的候选食物（已通过 RealisticFilter）
   * @param sceneContext 当前场景上下文
   * @param mealType     餐次类型
   * @returns recipes + planTheme + executionDifficulty（均可为空）
   */
  async assembleRecipes(
    scoredFoods: ScoredFood[],
    sceneContext: SceneContext,
    mealType: string,
  ): Promise<{
    recipes: AssembledRecipe[];
    planTheme: string;
    executionDifficulty: number;
  }> {
    if (scoredFoods.length === 0) {
      return { recipes: [], planTheme: '', executionDifficulty: 0 };
    }

    try {
      // 阶段 1: 尝试数据库菜谱匹配
      const dbRecipes = await this.matchDatabaseRecipes(
        scoredFoods,
        sceneContext,
      );

      if (dbRecipes.length > 0) {
        return {
          recipes: dbRecipes,
          planTheme: this.generateTheme(sceneContext, mealType),
          executionDifficulty: this.calcDifficulty(dbRecipes),
        };
      }

      // 阶段 2: 智能组装
      const assembled = this.smartAssemble(scoredFoods, sceneContext);
      return {
        recipes: assembled,
        planTheme: this.generateTheme(sceneContext, mealType),
        executionDifficulty: this.calcDifficulty(assembled),
      };
    } catch (err) {
      this.logger.warn(`RecipeAssembler failed, degrading gracefully: ${err}`);
      return { recipes: [], planTheme: '', executionDifficulty: 0 };
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 阶段 1: 从数据库匹配菜谱
   *
   * 匹配逻辑：
   * - 用候选食物的 mainIngredient 查询数据库菜谱的 recipe_ingredients
   * - 匹配率 = 匹配食材数 / 菜谱总食材数
   * - 筛选: 匹配率 >= 60% + 渠道兼容 + 烹饪时间满足场景约束
   */
  private async matchDatabaseRecipes(
    foods: ScoredFood[],
    scene: SceneContext,
  ): Promise<AssembledRecipe[]> {
    const ingredientNames = foods
      .map((f) => f.food.mainIngredient)
      .filter((n): n is string => !!n);

    if (ingredientNames.length === 0) return [];

    // 查询包含至少一个匹配食材的菜谱
    const recipes = await this.prisma.recipes.findMany({
      where: {
        is_active: true,
        recipe_ingredients: {
          some: {
            ingredient_name: { in: ingredientNames },
          },
        },
      },
      include: { recipe_ingredients: true },
      take: RecipeAssemblerService.DB_QUERY_LIMIT,
      orderBy: { quality_score: 'desc' },
    });

    const results: AssembledRecipe[] = [];

    for (const recipe of recipes) {
      const recipeIngredients = recipe.recipe_ingredients.map(
        (i) => i.ingredient_name,
      );
      const matchedCount = ingredientNames.filter((name) =>
        recipeIngredients.includes(name),
      ).length;
      const matchRate =
        recipeIngredients.length > 0
          ? matchedCount / recipeIngredients.length
          : 0;

      // 匹配率过低
      if (matchRate < RecipeAssemblerService.MATCH_RATE_THRESHOLD) continue;

      // 烹饪时间约束检查
      const maxCook = scene.sceneConstraints.maxCookTime;
      if (maxCook != null && (recipe.cook_time_minutes ?? 0) > maxCook) {
        continue;
      }

      // 渠道兼容检查
      if (
        scene.channel !== AcquisitionChannel.UNKNOWN &&
        !this.isChannelCompatible(recipe.available_channels, scene.channel)
      ) {
        continue;
      }

      // 找出匹配的 ScoredFood
      const matchedFoods = foods.filter((f) =>
        recipeIngredients.includes(f.food.mainIngredient ?? ''),
      );

      const availableChannels = this.parseAvailableChannels(
        recipe.available_channels,
      );

      results.push({
        recipeId: recipe.id,
        name: recipe.name,
        ingredients: matchedFoods,
        totalCalories: matchedFoods.reduce((s, f) => s + f.servingCalories, 0),
        totalProtein: matchedFoods.reduce((s, f) => s + f.servingProtein, 0),
        estimatedCookTime: recipe.cook_time_minutes ?? 0,
        skillLevel: this.difficultyToSkill(recipe.difficulty),
        suitableChannels: availableChannels,
        recipeScore: matchRate,
        isAssembled: false,
      });
    }

    return results.sort((a, b) => b.recipeScore - a.recipeScore);
  }

  /**
   * V6.9 Phase 3-D: 智能组装增强 — 按食材角色分组，结合餐次模式组合为菜品方案
   *
   * 改进点：
   * 1. 餐次模式感知 — 早餐/午晚餐/加餐使用不同组装策略
   * 2. 多蛋白源支持 — 多种蛋白质食材各自与蔬菜搭配成独立主菜
   * 3. 复合食物直出 — composite 类食物本身就是完整菜品，不做拆解
   * 4. 自然菜名生成 — 使用烹饪手法模板 + 语序优化，避免机械拼接
   */
  private smartAssemble(
    foods: ScoredFood[],
    scene: SceneContext,
  ): AssembledRecipe[] {
    // 按角色分组
    const grouped: Record<string, ScoredFood[]> = {};
    for (const f of foods) {
      const role = this.inferRole(f.food);
      if (!grouped[role]) grouped[role] = [];
      grouped[role].push(f);
    }

    const mealType = scene.sceneType;

    // 按餐次类型选择组装策略
    if (['quick_breakfast', 'leisurely_brunch'].includes(mealType)) {
      return this.assembleBreakfast(grouped, scene);
    }
    if (mealType === 'late_night_snack') {
      return this.assembleSnack(grouped, scene);
    }
    if (mealType === 'post_workout') {
      return this.assemblePostWorkout(grouped, scene);
    }
    // 午餐/晚餐/通用 — 标准主菜+主食+配菜模式
    return this.assembleStandardMeal(grouped, scene);
  }

  /**
   * 早餐组装策略 — 主食为核心，蛋白质为辅
   * 典型模式：粥/面包 + 鸡蛋/牛奶 + 水果/小菜
   */
  private assembleBreakfast(
    grouped: Record<string, ScoredFood[]>,
    scene: SceneContext,
  ): AssembledRecipe[] {
    const recipes: AssembledRecipe[] = [];
    const carbs = grouped['carb'] ?? [];
    const proteins = grouped['protein'] ?? [];
    const sides = grouped['side'] ?? [];
    const composites = grouped['composite'] ?? [];

    // 复合食物直出（如三明治、包子等）
    for (const comp of composites) {
      recipes.push(this.buildSingleRecipe(comp, scene));
    }

    // 主食 + 蛋白搭配
    if (carbs.length > 0 && proteins.length > 0) {
      const carb = carbs[0];
      const protein = proteins[0];
      const ingredients = [carb, protein];
      recipes.push({
        name: this.generateBreakfastName(carb, protein),
        ingredients,
        totalCalories: ingredients.reduce((s, f) => s + f.servingCalories, 0),
        totalProtein: ingredients.reduce((s, f) => s + f.servingProtein, 0),
        estimatedCookTime: Math.max(
          carb.food.cookTimeMinutes ?? 10,
          protein.food.cookTimeMinutes ?? 5,
        ),
        skillLevel: 'easy',
        suitableChannels: [scene.channel],
        recipeScore:
          ingredients.reduce((s, f) => s + f.score, 0) / ingredients.length,
        isAssembled: true,
      });
      // 额外蛋白质（如多出的牛奶）单独列出
      for (let i = 1; i < proteins.length; i++) {
        recipes.push(this.buildSingleRecipe(proteins[i], scene));
      }
      // 额外主食
      for (let i = 1; i < carbs.length; i++) {
        recipes.push(this.buildSingleRecipe(carbs[i], scene));
      }
    } else {
      // 仅有其中一类时独立列出
      for (const carb of carbs) {
        recipes.push(this.buildSingleRecipe(carb, scene));
      }
      for (const protein of proteins) {
        recipes.push(this.buildSingleRecipe(protein, scene));
      }
    }

    // 配菜（水果、饮品等）
    for (const side of sides) {
      recipes.push(this.buildSingleRecipe(side, scene));
    }

    return recipes;
  }

  /**
   * 标准午/晚餐组装 — 主菜+主食+配菜
   * 改进：多蛋白源各自成菜，蔬菜轮流搭配
   */
  private assembleStandardMeal(
    grouped: Record<string, ScoredFood[]>,
    scene: SceneContext,
  ): AssembledRecipe[] {
    const recipes: AssembledRecipe[] = [];
    const proteins = grouped['protein'] ?? [];
    const veggies = grouped['veggie'] ?? [];
    const carbs = grouped['carb'] ?? [];
    const sides = grouped['side'] ?? [];
    const composites = grouped['composite'] ?? [];

    // 复合食物直出（如盖饭、饺子等）
    for (const comp of composites) {
      recipes.push(this.buildSingleRecipe(comp, scene));
    }

    // 每个蛋白质食材与一个蔬菜搭配成主菜
    const usedVeggieIndices = new Set<number>();
    for (let pi = 0; pi < proteins.length; pi++) {
      const protein = proteins[pi];
      // 轮流搭配蔬菜
      const veggieIdx = veggies.length > 0 ? pi % veggies.length : -1;
      const veggie = veggieIdx >= 0 ? veggies[veggieIdx] : undefined;
      if (veggieIdx >= 0) usedVeggieIndices.add(veggieIdx);

      const ingredients = veggie ? [protein, veggie] : [protein];
      recipes.push({
        name: this.generateDishName(protein, veggie),
        ingredients,
        totalCalories: ingredients.reduce((s, f) => s + f.servingCalories, 0),
        totalProtein: ingredients.reduce((s, f) => s + f.servingProtein, 0),
        estimatedCookTime: Math.max(
          protein.food.cookTimeMinutes ?? 15,
          veggie?.food.cookTimeMinutes ?? 10,
        ),
        skillLevel: protein.food.skillRequired ?? 'easy',
        suitableChannels: [scene.channel],
        recipeScore:
          ingredients.reduce((s, f) => s + f.score, 0) / ingredients.length,
        isAssembled: true,
      });
    }

    // 未被搭配的蔬菜作为独立素菜
    for (let vi = 0; vi < veggies.length; vi++) {
      if (!usedVeggieIndices.has(vi) || proteins.length === 0) {
        const veggie = veggies[vi];
        recipes.push({
          name: this.generateVeggieDishName(veggie),
          ingredients: [veggie],
          totalCalories: veggie.servingCalories,
          totalProtein: veggie.servingProtein,
          estimatedCookTime: veggie.food.cookTimeMinutes ?? 10,
          skillLevel: 'easy',
          suitableChannels: [scene.channel],
          recipeScore: veggie.score,
          isAssembled: true,
        });
      }
    }

    // 主食
    for (const carb of carbs) {
      recipes.push(this.buildSingleRecipe(carb, scene));
    }

    // 配菜/汤/饮品
    for (const side of sides) {
      recipes.push(this.buildSingleRecipe(side, scene));
    }

    return recipes;
  }

  /**
   * 加餐/夜宵组装 — 简约模式，不做复杂搭配
   */
  private assembleSnack(
    grouped: Record<string, ScoredFood[]>,
    scene: SceneContext,
  ): AssembledRecipe[] {
    const recipes: AssembledRecipe[] = [];
    // 所有食物独立列出
    for (const role of ['composite', 'protein', 'carb', 'veggie', 'side']) {
      for (const food of grouped[role] ?? []) {
        recipes.push(this.buildSingleRecipe(food, scene));
      }
    }
    return recipes;
  }

  /**
   * 运动后补给组装 — 蛋白质优先，碳水补充
   */
  private assemblePostWorkout(
    grouped: Record<string, ScoredFood[]>,
    scene: SceneContext,
  ): AssembledRecipe[] {
    const recipes: AssembledRecipe[] = [];
    const proteins = grouped['protein'] ?? [];
    const carbs = grouped['carb'] ?? [];
    const composites = grouped['composite'] ?? [];

    for (const comp of composites) {
      recipes.push(this.buildSingleRecipe(comp, scene));
    }

    // 蛋白+碳水 1:1 搭配（运动后黄金组合）
    if (proteins.length > 0 && carbs.length > 0) {
      const protein = proteins[0];
      const carb = carbs[0];
      const ingredients = [protein, carb];
      recipes.push({
        name: `${protein.food.name}搭配${carb.food.name}`,
        ingredients,
        totalCalories: ingredients.reduce((s, f) => s + f.servingCalories, 0),
        totalProtein: ingredients.reduce((s, f) => s + f.servingProtein, 0),
        estimatedCookTime: Math.max(
          protein.food.cookTimeMinutes ?? 5,
          carb.food.cookTimeMinutes ?? 5,
        ),
        skillLevel: 'easy',
        suitableChannels: [scene.channel],
        recipeScore:
          ingredients.reduce((s, f) => s + f.score, 0) / ingredients.length,
        isAssembled: true,
      });
      for (let i = 1; i < proteins.length; i++) {
        recipes.push(this.buildSingleRecipe(proteins[i], scene));
      }
      for (let i = 1; i < carbs.length; i++) {
        recipes.push(this.buildSingleRecipe(carbs[i], scene));
      }
    } else {
      for (const p of proteins) recipes.push(this.buildSingleRecipe(p, scene));
      for (const c of carbs) recipes.push(this.buildSingleRecipe(c, scene));
    }

    // 其他
    for (const role of ['veggie', 'side']) {
      for (const food of grouped[role] ?? []) {
        recipes.push(this.buildSingleRecipe(food, scene));
      }
    }
    return recipes;
  }

  /**
   * 构建单食材菜品（通用辅助方法）
   */
  private buildSingleRecipe(
    food: ScoredFood,
    scene: SceneContext,
  ): AssembledRecipe {
    return {
      name: food.food.name,
      ingredients: [food],
      totalCalories: food.servingCalories,
      totalProtein: food.servingProtein,
      estimatedCookTime: food.food.cookTimeMinutes ?? 5,
      skillLevel: food.food.skillRequired ?? 'easy',
      suitableChannels: [scene.channel],
      recipeScore: food.score,
      isAssembled: true,
    };
  }

  /**
   * 推断食材角色（protein / carb / veggie / composite / side）
   *
   * V6.9 Phase 3-D: 新增 composite 角色，复合菜品独立处理不拆解
   */
  private inferRole(food: FoodLibrary): string {
    const cat = food.category?.toLowerCase();
    if (!cat) return 'side';

    // 将 category 拆分为 token（支持 "lean_protein", "root_vegetable" 等复合分类）
    const tokens = cat.split(/[_\-\s]+/);
    const matchToken = (keywords: string[]) =>
      cat === keywords.find((k) => k === cat) ||
      tokens.some((t) => keywords.includes(t));

    // 复合菜品: 独立角色（盖饭、饺子、三明治等）
    if (cat === 'composite') {
      return 'composite';
    }
    // 蔬菜类（优先于蛋白质，避免 "veggie" 被 "egg" substring 匹配）
    if (matchToken(['vegetable', 'veggie', 'salad', 'mushroom'])) {
      return 'veggie';
    }
    // 蛋白质类
    if (
      matchToken([
        'meat',
        'seafood',
        'poultry',
        'egg',
        'protein',
        'dairy',
        'legume',
      ])
    ) {
      return 'protein';
    }
    // 碳水/主食类
    if (matchToken(['grain', 'cereal', 'rice', 'noodle', 'bread', 'starch'])) {
      return 'carb';
    }
    // 其他（水果、饮品、调味等）归为配菜
    return 'side';
  }

  /**
   * V6.9 Phase 3-D: 生成更自然的主菜菜名
   *
   * 策略：根据烹饪方式选择合理的中文菜名语序模板
   * - 炒/煎类: "蔬菜 + 炒 + 蛋白" （如"青椒炒牛肉"）
   * - 炖/煮/蒸类: "蛋白 + 炖/煮/蒸 + 蔬菜" 或 "蔬菜 + 蛋白 + 汤" （如"牛肉炖土豆"）
   * - 烤/煎类: "烤/煎 + 蛋白 + 配蔬菜" （如"烤鸡配西兰花"）
   * - 无明确方式: "蛋白 + 配 + 蔬菜"
   */
  private generateDishName(protein: ScoredFood, veggie?: ScoredFood): string {
    if (!veggie) {
      return protein.food.name;
    }

    const method = protein.food.cookingMethod ?? '';
    const proteinName = protein.food.name;
    const veggieName = veggie.food.name;

    // 炒/爆/熘/溜 → "蔬菜 + 方法 + 蛋白"
    if (['炒', '爆', '熘', '溜'].includes(method)) {
      return `${veggieName}${method}${proteinName}`;
    }
    // 炖/煮/焖/烩 → "蛋白 + 方法 + 蔬菜"
    if (['炖', '煮', '焖', '烩'].includes(method)) {
      return `${proteinName}${method}${veggieName}`;
    }
    // 蒸/清蒸 → "清蒸蛋白配蔬菜"
    if (['蒸', '清蒸'].includes(method)) {
      return `清蒸${proteinName}配${veggieName}`;
    }
    // 烤/烧/焗 → "烤蛋白配蔬菜"
    if (['烤', '烧', '焗'].includes(method)) {
      return `${method}${proteinName}配${veggieName}`;
    }
    // 煎/炸 → "煎蛋白配蔬菜"
    if (['煎', '炸'].includes(method)) {
      return `${method}${proteinName}配${veggieName}`;
    }
    // 通用兜底: "蛋白配蔬菜"
    return `${proteinName}配${veggieName}`;
  }

  /**
   * V6.9 Phase 3-D: 生成早餐搭配名
   */
  private generateBreakfastName(carb: ScoredFood, protein: ScoredFood): string {
    return `${carb.food.name}搭${protein.food.name}`;
  }

  /**
   * V6.9 Phase 3-D: 生成素菜菜名
   */
  private generateVeggieDishName(veggie: ScoredFood): string {
    const method = veggie.food.cookingMethod;
    if (method && ['炒', '拌', '蒸', '烤', '煮'].includes(method)) {
      return `${method}${veggie.food.name}`;
    }
    return veggie.food.name;
  }

  /**
   * 生成方案主题标签
   */
  private generateTheme(scene: SceneContext, mealType: string): string {
    const sceneLabel: Record<string, string> = {
      quick_breakfast: '快手早餐',
      leisurely_brunch: '悠闲早午餐',
      office_lunch: '工作日午餐',
      home_cooking: '家常菜',
      eating_out: '外出用餐',
      convenience_meal: '便捷餐',
      canteen_meal: '食堂推荐',
      post_workout: '运动后补给',
      late_night_snack: '健康夜宵',
      family_dinner: '家庭晚餐',
      meal_prep: '批量备餐',
      general: '均衡搭配',
    };
    return sceneLabel[scene.sceneType] ?? '均衡搭配';
  }

  /**
   * 计算执行难度 (0-1)
   *
   * 加权: 技能等级 60% + 烹饪时间 40%
   */
  private calcDifficulty(recipes: AssembledRecipe[]): number {
    if (recipes.length === 0) return 0;

    const skillMap: Record<string, number> = {
      easy: 0.1,
      beginner: 0.2,
      medium: 0.4,
      intermediate: 0.5,
      hard: 0.7,
      advanced: 0.9,
    };

    const avgCookTime =
      recipes.reduce((s, r) => s + r.estimatedCookTime, 0) / recipes.length;
    const avgSkill =
      recipes.reduce((s, r) => s + (skillMap[r.skillLevel] ?? 0.3), 0) /
      recipes.length;

    return avgSkill * 0.6 + Math.min(1, avgCookTime / 120) * 0.4;
  }

  /**
   * 检查渠道兼容性（available_channels 是 Json 类型，可能是数组或字符串）
   */
  private isChannelCompatible(
    availableChannels: unknown,
    channel: AcquisitionChannel,
  ): boolean {
    if (Array.isArray(availableChannels)) {
      return availableChannels.includes(channel);
    }
    if (typeof availableChannels === 'string') {
      try {
        const parsed = JSON.parse(availableChannels);
        return Array.isArray(parsed) && parsed.includes(channel);
      } catch {
        return false;
      }
    }
    return false;
  }

  /**
   * 解析 available_channels Json 字段为 AcquisitionChannel 数组
   */
  private parseAvailableChannels(raw: unknown): AcquisitionChannel[] {
    const validChannels = Object.values(AcquisitionChannel) as string[];

    let arr: string[] = [];
    if (Array.isArray(raw)) {
      arr = raw;
    } else if (typeof raw === 'string') {
      try {
        const parsed = JSON.parse(raw);
        arr = Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    return arr.filter((c) => validChannels.includes(c)) as AcquisitionChannel[];
  }

  /**
   * 数据库 difficulty (1-5) → 技能等级字符串
   */
  private difficultyToSkill(difficulty: number): string {
    if (difficulty <= 1) return 'easy';
    if (difficulty <= 2) return 'beginner';
    if (difficulty <= 3) return 'medium';
    if (difficulty <= 4) return 'intermediate';
    return 'advanced';
  }

  // ==================== V7.3 P2-D: 菜谱营养聚合 ====================

  /**
   * 计算菜谱的组合营养数据
   *
   * 将菜谱中所有食材的营养素按份量（serving, 默认 100g）加权聚合。
   * 缺失值视为 0，不影响其他营养素的计算。
   *
   * @param recipe 已组装的菜谱
   * @returns 聚合后的营养数据
   */
  computeRecipeNutrition(recipe: AssembledRecipe): RecipeNutrition {
    const nutrition: RecipeNutrition = {
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      fiber: 0,
      sodium: 0,
      saturatedFat: 0,
      transFat: 0,
      sugar: 0,
      addedSugar: 0,
      vitaminA: 0,
      vitaminC: 0,
      vitaminD: 0,
      vitaminE: 0,
      calcium: 0,
      iron: 0,
      potassium: 0,
      zinc: 0,
      magnesium: 0,
      cholesterol: 0,
    };

    for (const ing of recipe.ingredients) {
      if (!ing.food) continue;
      // ScoredFood 已有 servingCalories/servingProtein 等按份量计算的值，
      // 但这些只覆盖宏量素。微量营养素需要从 FoodLibrary per 100g 数据按 serving 换算。
      // serving(g) = servingCalories / (food.calories/100) — 但 calories 可能为 0
      // 安全回退: 使用 food.standardServingG 或默认 100g
      const servingG = Number(ing.food.standardServingG) || 100;
      const ratio = servingG / 100;

      // 宏量素直接取 ScoredFood 已计算的值
      nutrition.calories += ing.servingCalories || 0;
      nutrition.protein += ing.servingProtein || 0;
      nutrition.fat += ing.servingFat || 0;
      nutrition.carbs += ing.servingCarbs || 0;
      nutrition.fiber += ing.servingFiber || 0;

      // 微量营养素从 FoodLibrary per 100g 按 ratio 换算
      nutrition.sodium += (Number(ing.food.sodium) || 0) * ratio;
      nutrition.saturatedFat += (Number(ing.food.saturatedFat) || 0) * ratio;
      nutrition.transFat += (Number(ing.food.transFat) || 0) * ratio;
      nutrition.sugar += (Number(ing.food.sugar) || 0) * ratio;
      nutrition.addedSugar += (Number(ing.food.addedSugar) || 0) * ratio;
      nutrition.vitaminA += (Number(ing.food.vitaminA) || 0) * ratio;
      nutrition.vitaminC += (Number(ing.food.vitaminC) || 0) * ratio;
      nutrition.vitaminD += (Number(ing.food.vitaminD) || 0) * ratio;
      nutrition.vitaminE += (Number(ing.food.vitaminE) || 0) * ratio;
      nutrition.calcium += (Number(ing.food.calcium) || 0) * ratio;
      nutrition.iron += (Number(ing.food.iron) || 0) * ratio;
      nutrition.potassium += (Number(ing.food.potassium) || 0) * ratio;
      nutrition.zinc += (Number(ing.food.zinc) || 0) * ratio;
      nutrition.magnesium += (Number(ing.food.magnesium) || 0) * ratio;
      nutrition.cholesterol += (Number(ing.food.cholesterol) || 0) * ratio;
    }

    // 四舍五入到 1 位小数
    for (const key of Object.keys(nutrition) as (keyof RecipeNutrition)[]) {
      nutrition[key] = Math.round(nutrition[key] * 10) / 10;
    }

    return nutrition;
  }
}
