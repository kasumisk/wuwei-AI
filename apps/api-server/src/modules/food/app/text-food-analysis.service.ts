/**
 * V6.1 Phase 1.6 — 文本食物分析服务
 *
 * 职责:
 * - 接收食物文本描述（标准词或自然语言），返回统一的 FoodAnalysisResultV61
 * - 优先匹配标准食物库（零 AI 成本），未命中再走 LLM 规则拆解
 * - 复用现有 FoodService、UserProfileService、BehaviorService、NutritionScoreService
 *
 * 设计文档参考: Section 4.1, 9.1, 12.1
 *
 * 处理流程:
 * 1. InputPreprocessor: 去空格、统一简繁/大小写/常见别称
 * 2. FoodNormalizationService: 精确名/别名匹配 → FoodLibrary
 * 3. TextParseService: 未命中则走 LLM 拆解组合食物和数量
 * 4. PortionEstimationService: 估算克重、份数
 * 5. NutritionEstimationService: 优先标准库营养，次选估算
 * 6. FoodDecisionService: 结合目标/禁忌/当前摄入给出建议
 * 7. AnalysisResultAssembler: 组装统一 FoodAnalysisResultV61
 * 8. 异步保存 food_analysis_record
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { FoodLibraryService } from './food-library.service';
import { AnalysisRecordStatus, PersistStatus } from '../food.types';
import { FoodService } from '../../diet/app/food.service';
import { UserProfileService } from '../../user/app/user-profile.service';
import { BehaviorService } from '../../diet/app/behavior.service';
import {
  NutritionScoreService,
  NutritionScoreBreakdown,
} from '../../diet/app/nutrition-score.service';
import {
  FoodAnalysisResultV61,
  AnalyzedFoodItem,
  NutritionTotals,
  AnalysisScore,
  FoodDecision,
  FoodAlternative,
  AnalysisExplanation,
  IngestionDecision,
} from './analysis-result.types';
import {
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../common/utils/timezone.util';
import {
  DomainEvents,
  AnalysisCompletedEvent,
} from '../../../core/events/domain-events';
import { PrismaService } from '../../../core/prisma/prisma.service';

// ==================== 常量 ====================

/** 默认份量（克），用于标准食物库命中但无数量描述时 */
const DEFAULT_SERVING_GRAMS = 100;

/** 常见数量词映射到克数的粗估表 */
const QUANTITY_GRAMS_MAP: Record<string, number> = {
  一份: 200,
  一碗: 300,
  一杯: 250,
  一盘: 300,
  一个: 150,
  半份: 100,
  半碗: 150,
  小份: 150,
  大份: 350,
  一块: 80,
  一片: 30,
  一根: 100,
  一条: 120,
};

/** 目标类型中文标签 */
const GOAL_LABELS: Record<string, string> = {
  fat_loss: '减脂',
  muscle_gain: '增肌',
  health: '均衡健康',
  habit: '改善饮食习惯',
};

/** 目标重点关注 */
const GOAL_FOCUS: Record<string, string> = {
  fat_loss: '优先关注：热量不超标 + 蛋白质充足',
  muscle_gain: '优先关注：蛋白质是否充足 + 热量不能太低',
  health: '优先关注：食物质量和营养均衡',
  habit: '优先关注：食物质量和饱腹感，鼓励坚持记录',
};

// ==================== LLM Prompt ====================

/**
 * 文本分析 LLM Prompt
 *
 * 仅在标准食物库未命中时使用，用于拆解自然语言描述中的食物名/数量/营养
 */
const TEXT_ANALYSIS_PROMPT = `你是专业营养分析助手。用户输入了一段食物描述文本，请识别其中所有食物，估算份量和营养。

以 JSON 格式返回（不要输出任何其他文字，只输出纯 JSON）：
{
  "foods": [
    {
      "name": "食物名称",
      "quantity": "份量描述（如一份、200g）",
      "estimatedWeightGrams": 数字,
      "category": "分类（protein/grain/veggie/fruit/dairy/fat/beverage/snack/composite）",
      "calories": 数字（千卡），
      "protein": 数字（克），
      "fat": 数字（克），
      "carbs": 数字（克），
      "fiber": 数字（克），
      "sodium": 数字（毫克）
    }
  ],
  "summary": "一句话总结这顿饭的特点",
  "alternatives": [
    { "name": "替代食物名", "reason": "推荐理由（不超过15字）" }
  ]
}

规则：
- 热量和营养素估算保守（宁少不多）
- 每种食物单独列出，不要合并
- 组合食物（如牛肉面）拆解为主要组成（面条、牛肉、汤底等）
- category 使用英文编码: protein/grain/veggie/fruit/dairy/fat/beverage/snack/composite
- 替代方案不超过 3 个，每条不超过 15 字
- 如果描述不是食物，返回空 foods 数组`;

// ==================== 内部类型 ====================

/** 文本解析出的食物项（LLM 或标准库） */
interface ParsedFoodItem {
  /** 原始名称 */
  name: string;
  /** 标准化名称 */
  normalizedName?: string;
  /** 匹配到的标准食物库条目 */
  libraryMatch?: any;
  /** 数量描述 */
  quantity?: string;
  /** 估算重量（克） */
  estimatedWeightGrams: number;
  /** 分类 */
  category?: string;
  /** 置信度 0-1 */
  confidence: number;
  /** 热量（千卡） */
  calories: number;
  /** 蛋白质（克） */
  protein: number;
  /** 脂肪（克） */
  fat: number;
  /** 碳水化合物（克） */
  carbs: number;
  /** 膳食纤维（克） */
  fiber?: number;
  /** 钠（毫克） */
  sodium?: number;
}

/** LLM 返回的解析结构 */
interface LlmTextParseResult {
  foods: Array<{
    name: string;
    quantity?: string;
    estimatedWeightGrams?: number;
    category?: string;
    calories: number;
    protein?: number;
    fat?: number;
    carbs?: number;
    fiber?: number;
    sodium?: number;
  }>;
  summary?: string;
  alternatives?: Array<{ name: string; reason: string }>;
}

@Injectable()
export class TextFoodAnalysisService {
  private readonly logger = new Logger(TextFoodAnalysisService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly textModel: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly foodLibraryService: FoodLibraryService,
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
    private readonly behaviorService: BehaviorService,
    private readonly nutritionScoreService: NutritionScoreService,
    private readonly prisma: PrismaService,
    // V6.1 Phase 2.6: 域事件发射
    private readonly eventEmitter: EventEmitter2,
  ) {
    // 复用与图片分析相同的 API 配置
    this.apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      this.configService.get<string>('OPENAI_API_KEY') ||
      '';
    this.baseUrl =
      this.configService.get<string>('OPENROUTER_BASE_URL') ||
      'https://openrouter.ai/api/v1';
    // 文本分析用轻量模型，成本更低
    this.textModel =
      this.configService.get<string>('TEXT_ANALYSIS_MODEL') ||
      this.configService.get<string>('VISION_MODEL') ||
      'baidu/ernie-4.5-8k';
  }

  // ==================== 主入口 ====================

  /**
   * 分析食物文本描述
   *
   * 完整流程:
   * 1. 预处理文本
   * 2. 尝试匹配标准食物库
   * 3. 未命中走 LLM 拆解
   * 4. 估份量 + 估营养
   * 5. 输出决策建议
   * 6. 组装统一结果结构
   * 7. 异步保存分析记录
   *
   * @param text - 食物文本描述
   * @param mealType - 餐次
   * @param userId - 用户 ID
   * @returns 统一分析结果（未裁剪，Controller 层再调 ResultEntitlementService）
   */
  async analyze(
    text: string,
    mealType?: string,
    userId?: string,
  ): Promise<FoodAnalysisResultV61> {
    // 1. 预处理文本
    const cleanedText = this.preprocessText(text);
    if (!cleanedText) {
      throw new BadRequestException('请输入有效的食物描述');
    }

    // 2. 拆分多个食物词条（简单分隔符拆分）
    const foodTerms = this.splitFoodTerms(cleanedText);

    // 3. 逐个匹配标准食物库 + LLM 补位
    const parsedFoods = await this.resolveAllFoods(foodTerms, cleanedText);

    // 4. 构建用户上下文（目标、今日摄入等）
    const userContext = await this.buildUserContext(userId);

    // 5. 用评分引擎计算决策
    const decision = this.computeDecision(parsedFoods, userContext);

    // 6. 生成替代建议
    const alternatives = this.generateAlternatives(parsedFoods, userContext);

    // 7. 生成解释说明
    const explanation = this.generateExplanation(
      parsedFoods,
      decision,
      userContext,
    );

    // 8. 计算汇总营养
    const totals = this.calculateTotals(parsedFoods);

    // 9. 计算综合评分
    const score = this.calculateScore(parsedFoods, totals, userContext);

    // 10. 判断入库决策
    const ingestion = this.evaluateIngestion(parsedFoods);

    // 11. 组装统一结果
    const analysisId = crypto.randomUUID();
    const result: FoodAnalysisResultV61 = {
      analysisId,
      inputType: 'text',
      inputSnapshot: {
        rawText: text,
        mealType: mealType as any,
      },
      foods: parsedFoods.map((f) => this.toAnalyzedFoodItem(f)),
      totals,
      score,
      decision,
      alternatives,
      explanation,
      ingestion,
      entitlement: {
        tier: 'free' as any, // 由 Controller 层设置真实值
        fieldsHidden: [],
      },
    };

    // 12. 异步保存分析记录（不阻塞主流程）
    this.saveAnalysisRecord(
      analysisId,
      text,
      mealType,
      userId,
      result,
      parsedFoods,
    ).catch((err) =>
      this.logger.warn(`保存分析记录失败: ${(err as Error).message}`),
    );

    // 13. V6.1 Phase 2.6: 发射分析完成事件（推动画像更新和推荐联动）
    if (userId) {
      const foodNames = parsedFoods.map((f) => f.name);
      const foodCategories = [
        ...new Set(
          parsedFoods.map((f) => f.category).filter(Boolean) as string[],
        ),
      ];
      const avgConfidence =
        parsedFoods.length > 0
          ? parsedFoods.reduce((s, f) => s + f.confidence, 0) /
            parsedFoods.length
          : 0.5;

      this.eventEmitter.emit(
        DomainEvents.ANALYSIS_COMPLETED,
        new AnalysisCompletedEvent(
          userId,
          analysisId,
          'text',
          foodNames,
          foodCategories,
          totals.calories,
          decision.recommendation,
          avgConfidence,
        ),
      );
    }

    return result;
  }

  // ==================== Step 1: 预处理 ====================

  /**
   * 预处理文本: 去首尾空格、统一简繁、去除无意义字符
   */
  private preprocessText(text: string): string {
    return (
      text
        .trim()
        // 统一全角数字和字母为半角
        .replace(/[\uff10-\uff19]/g, (ch) =>
          String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
        )
        .replace(/[\uff21-\uff3a\uff41-\uff5a]/g, (ch) =>
          String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
        )
        // 统一常见标点
        .replace(/，/g, ',')
        .replace(/。/g, '.')
        .replace(/、/g, ',')
        .replace(/\s+/g, ' ')
        .trim()
    );
  }

  // ==================== Step 2: 分词拆解 ====================

  /**
   * 将输入文本拆分为多个食物词条
   *
   * 支持的分隔方式:
   * - 逗号: "鸡胸肉,米饭,西兰花"
   * - "和"、"加"、"配": "牛肉面加卤蛋"
   * - 顿号: "苹果、香蕉"
   * - 换行符
   *
   * 如果无法拆分则返回原文本作为单一词条
   */
  private splitFoodTerms(text: string): string[] {
    const terms = text
      .split(/[,\n]+|(?:和|加|配|还有|以及|外加)/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    return terms.length > 0 ? terms : [text];
  }

  // ==================== Step 3: 食物解析 ====================

  /**
   * 解析所有食物词条: 标准库优先 → LLM 补位
   */
  private async resolveAllFoods(
    foodTerms: string[],
    originalText: string,
  ): Promise<ParsedFoodItem[]> {
    const results: ParsedFoodItem[] = [];
    const unmatchedTerms: string[] = [];

    // 3a. 逐个词条尝试精确/模糊匹配标准食物库
    for (const term of foodTerms) {
      const { quantity, foodName } = this.extractQuantity(term);
      const match = await this.matchFoodLibrary(foodName);

      if (match) {
        const servingGrams = this.resolveServingGrams(quantity, match);
        results.push(this.buildFromLibraryMatch(match, quantity, servingGrams));
      } else {
        unmatchedTerms.push(term);
      }
    }

    // 3b. 未命中的词条走 LLM 拆解
    if (unmatchedTerms.length > 0) {
      const llmResults = await this.llmParseFoods(
        unmatchedTerms.join(', '),
        originalText,
      );
      results.push(...llmResults);
    }

    // 3c. 如果全部为空（匹配失败 + LLM 也无结果），返回降级结果
    if (results.length === 0) {
      this.logger.warn(`文本分析无法识别任何食物: "${originalText}"`);
      throw new BadRequestException(
        '无法识别输入中的食物，请尝试输入具体的食物名称',
      );
    }

    return results;
  }

  /**
   * 从文本中提取数量描述和纯食物名
   *
   * 示例:
   * - "一份鸡胸肉" → { quantity: "一份", foodName: "鸡胸肉" }
   * - "200g米饭" → { quantity: "200g", foodName: "米饭" }
   * - "鸡胸肉" → { quantity: undefined, foodName: "鸡胸肉" }
   */
  private extractQuantity(term: string): {
    quantity?: string;
    foodName: string;
  } {
    // 匹配中文数量词
    const chinesePattern =
      /^(一|二|两|三|四|五|六|七|八|九|十|半|小|大|几)?(份|碗|杯|盘|个|块|片|根|条|勺|把)/;
    const chineseMatch = term.match(chinesePattern);
    if (chineseMatch) {
      const quantity = chineseMatch[0];
      const foodName = term.slice(quantity.length).trim();
      return foodName ? { quantity, foodName } : { foodName: term };
    }

    // 匹配数字+单位（如 200g、100ml）
    const numPattern = /^(\d+)\s*(g|ml|克|毫升)/i;
    const numMatch = term.match(numPattern);
    if (numMatch) {
      const quantity = numMatch[0];
      const foodName = term.slice(quantity.length).trim();
      return foodName ? { quantity, foodName } : { foodName: term };
    }

    return { foodName: term };
  }

  /**
   * 匹配标准食物库（精确名 → 模糊搜索）
   */
  private async matchFoodLibrary(foodName: string): Promise<any | null> {
    try {
      // 精确匹配
      const exact = await this.foodLibraryService
        .findByName(foodName)
        .catch(() => null);
      if (exact) return exact;

      // 模糊搜索取第一个高相关结果
      const results = (await this.foodLibraryService.search(
        foodName,
        3,
      )) as any[];
      if (results.length > 0) {
        // 如果模糊搜索结果的名称包含搜索词或搜索词包含结果名称，认为匹配
        const bestMatch = results.find(
          (r: any) =>
            r.name.includes(foodName) ||
            foodName.includes(r.name) ||
            (r.aliases &&
              r.aliases.split(',').some((a: string) => a.trim() === foodName)),
        );
        if (bestMatch) return bestMatch;
      }
    } catch {
      // 匹配失败不阻断流程
    }
    return null;
  }

  /**
   * 解析份量克数
   */
  private resolveServingGrams(quantity: string | undefined, food: any): number {
    if (!quantity) {
      return food.standard_serving_g || DEFAULT_SERVING_GRAMS;
    }

    // 数字单位（200g、100ml）
    const numMatch = quantity.match(/(\d+)\s*(g|克)/i);
    if (numMatch) return parseInt(numMatch[1], 10);

    const mlMatch = quantity.match(/(\d+)\s*(ml|毫升)/i);
    if (mlMatch) return parseInt(mlMatch[1], 10); // 简化：1ml≈1g

    // 中文数量词映射
    const mapped = QUANTITY_GRAMS_MAP[quantity];
    if (mapped) return mapped;

    // 食物库自带的常用份量匹配
    if (food.common_portions && (food.common_portions as any[]).length > 0) {
      const portion = (food.common_portions as any[]).find((p: any) =>
        quantity!.includes(p.name),
      );
      if (portion) return portion.grams;
    }

    return food.standard_serving_g || DEFAULT_SERVING_GRAMS;
  }

  /**
   * 从标准食物库匹配结果构建 ParsedFoodItem
   */
  private buildFromLibraryMatch(
    food: any,
    quantity: string | undefined,
    servingGrams: number,
  ): ParsedFoodItem {
    const ratio = servingGrams / 100; // 食物库营养数据是 per 100g

    return {
      name: food.name,
      normalizedName: food.name,
      libraryMatch: food,
      quantity: quantity || `${servingGrams}g`,
      estimatedWeightGrams: servingGrams,
      category: food.category,
      confidence: 0.95, // 标准库匹配高置信度
      calories: Math.round(Number(food.calories) * ratio),
      protein: Math.round((Number(food.protein) || 0) * ratio),
      fat: Math.round((Number(food.fat) || 0) * ratio),
      carbs: Math.round((Number(food.carbs) || 0) * ratio),
      fiber: food.fiber
        ? Math.round(Number(food.fiber) * ratio * 10) / 10
        : undefined,
      sodium: food.sodium ? Math.round(Number(food.sodium) * ratio) : undefined,
    };
  }

  // ==================== Step 3b: LLM 补位 ====================

  /**
   * 调用 LLM 拆解未匹配的食物文本
   */
  private async llmParseFoods(
    unmatchedText: string,
    originalText: string,
  ): Promise<ParsedFoodItem[]> {
    if (!this.apiKey) {
      this.logger.warn('LLM API 未配置，跳过 LLM 解析');
      return [];
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          'HTTP-Referer': 'https://uway.dev-net.uk',
          'X-Title': 'Wuwei Health',
        },
        body: JSON.stringify({
          model: this.textModel,
          messages: [
            { role: 'system', content: TEXT_ANALYSIS_PROMPT },
            {
              role: 'user',
              content: `分析以下食物描述：${unmatchedText}`,
            },
          ],
          max_tokens: 800,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error(`LLM API 错误: ${response.status} ${err}`);
        return [];
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const parsed = this.parseLlmResponse(content);

      return parsed.foods.map((f) => ({
        name: f.name,
        normalizedName: f.name,
        quantity: f.quantity,
        estimatedWeightGrams: f.estimatedWeightGrams || DEFAULT_SERVING_GRAMS,
        category: f.category,
        confidence: 0.7, // LLM 解析中等置信度
        calories: f.calories || 0,
        protein: f.protein || 0,
        fat: f.fat || 0,
        carbs: f.carbs || 0,
        fiber: f.fiber,
        sodium: f.sodium,
      }));
    } catch (err) {
      this.logger.warn(`LLM 文本解析失败: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * 解析 LLM 返回的 JSON 文本
   */
  private parseLlmResponse(content: string): LlmTextParseResult {
    try {
      const cleaned = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);
      return {
        foods: Array.isArray(parsed.foods) ? parsed.foods : [],
        summary: parsed.summary,
        alternatives: Array.isArray(parsed.alternatives)
          ? parsed.alternatives
          : [],
      };
    } catch {
      this.logger.warn(`LLM 返回解析失败: ${content.substring(0, 200)}`);
      return { foods: [], alternatives: [] };
    }
  }

  // ==================== Step 4: 用户上下文 ====================

  /** 用户上下文信息 */
  private async buildUserContext(userId?: string): Promise<{
    goalType: string;
    goalLabel: string;
    todayCalories: number;
    todayProtein: number;
    todayFat: number;
    todayCarbs: number;
    goalCalories: number;
    goalProtein: number;
    goalFat: number;
    goalCarbs: number;
    remainingCalories: number;
    profile: any;
  }> {
    const defaults = {
      goalType: 'health',
      goalLabel: '均衡健康',
      todayCalories: 0,
      todayProtein: 0,
      todayFat: 0,
      todayCarbs: 0,
      goalCalories: 2000,
      goalProtein: 65,
      goalFat: 65,
      goalCarbs: 275,
      remainingCalories: 2000,
      profile: null,
    };

    if (!userId) return defaults;

    try {
      const [summary, profile] = await Promise.all([
        this.foodService.getTodaySummary(userId),
        this.userProfileService.getProfile(userId),
      ]);

      const goalType = profile?.goal || 'health';
      const goals = this.nutritionScoreService.calculateDailyGoals(profile);

      const todayCalories = summary.totalCalories;
      const todayProtein = Number(summary.totalProtein) || 0;
      const todayFat = Number(summary.totalFat) || 0;
      const todayCarbs = Number(summary.totalCarbs) || 0;

      return {
        goalType,
        goalLabel: GOAL_LABELS[goalType] || '均衡健康',
        todayCalories,
        todayProtein,
        todayFat,
        todayCarbs,
        goalCalories: goals.calories,
        goalProtein: goals.protein,
        goalFat: goals.fat,
        goalCarbs: goals.carbs,
        remainingCalories: goals.calories - todayCalories,
        profile,
      };
    } catch (err) {
      this.logger.warn(`构建用户上下文失败: ${(err as Error).message}`);
      return defaults;
    }
  }

  // ==================== Step 5: 决策计算 ====================

  /**
   * 基于评分引擎计算饮食决策
   */
  private computeDecision(
    foods: ParsedFoodItem[],
    ctx: Awaited<ReturnType<typeof this.buildUserContext>>,
  ): FoodDecision {
    const totalCalories = foods.reduce((s, f) => s + f.calories, 0);
    const totalProtein = foods.reduce((s, f) => s + f.protein, 0);

    // 基于热量预算和营养比例计算
    const calorieRatio =
      ctx.goalCalories > 0 ? totalCalories / ctx.goalCalories : 0;
    const remainingAfter = ctx.remainingCalories - totalCalories;

    // 目标导向决策
    if (ctx.goalType === 'fat_loss') {
      // 减脂: 严格看热量
      if (remainingAfter < -100) {
        return {
          recommendation: 'avoid',
          shouldEat: false,
          reason: `热量超出今日预算 ${Math.abs(Math.round(remainingAfter))} kcal`,
          riskLevel: 'high',
        };
      }
      if (remainingAfter < 0) {
        return {
          recommendation: 'caution',
          shouldEat: true,
          reason: `接近今日热量上限，建议减少份量`,
          riskLevel: 'medium',
        };
      }
      if (totalProtein < 15 && totalCalories > 300) {
        return {
          recommendation: 'caution',
          shouldEat: true,
          reason: '蛋白质偏低，建议搭配高蛋白食物',
          riskLevel: 'medium',
        };
      }
    }

    if (ctx.goalType === 'muscle_gain') {
      // 增肌: 看蛋白质
      if (totalProtein >= 25) {
        return {
          recommendation: 'recommend',
          shouldEat: true,
          reason: '蛋白质充足，适合增肌目标',
          riskLevel: 'low',
        };
      }
      if (totalProtein < 10 && totalCalories > 300) {
        return {
          recommendation: 'caution',
          shouldEat: true,
          reason: '蛋白质不足，建议搭配蛋白质食物',
          riskLevel: 'medium',
        };
      }
    }

    // 通用决策
    if (totalCalories > 0 && calorieRatio > 0.5) {
      return {
        recommendation: 'caution',
        shouldEat: true,
        reason: '这一餐热量偏高，注意控制其他餐次',
        riskLevel: 'medium',
      };
    }

    return {
      recommendation: 'recommend',
      shouldEat: true,
      reason: '适合当前饮食目标',
      riskLevel: 'low',
    };
  }

  // ==================== Step 6: 替代建议 ====================

  /**
   * 生成替代食物建议
   */
  private generateAlternatives(
    foods: ParsedFoodItem[],
    ctx: Awaited<ReturnType<typeof this.buildUserContext>>,
  ): FoodAlternative[] {
    const alternatives: FoodAlternative[] = [];
    const totalProtein = foods.reduce((s, f) => s + f.protein, 0);
    const totalCalories = foods.reduce((s, f) => s + f.calories, 0);

    // 高热量食物推荐低卡替代
    for (const food of foods) {
      if (food.calories > 400 && food.category !== 'protein') {
        alternatives.push({
          name: '鸡胸肉沙拉',
          reason: `低卡高蛋白，替代高热量${food.name}`,
        });
        break;
      }
    }

    // 蛋白质不足推荐补充
    if (totalProtein < 20 && totalCalories > 200) {
      alternatives.push({
        name: '水煮蛋',
        reason: '低成本补充优质蛋白质',
      });
    }

    // 碳水过多推荐替换
    const totalCarbs = foods.reduce((s, f) => s + f.carbs, 0);
    if (totalCarbs > 80) {
      alternatives.push({
        name: '糙米/燕麦',
        reason: '用粗粮替代精制碳水',
      });
    }

    return alternatives.slice(0, 3);
  }

  // ==================== Step 7: 解释说明 ====================

  /**
   * 生成分析解释说明
   */
  private generateExplanation(
    foods: ParsedFoodItem[],
    decision: FoodDecision,
    ctx: Awaited<ReturnType<typeof this.buildUserContext>>,
  ): AnalysisExplanation {
    const totalCalories = foods.reduce((s, f) => s + f.calories, 0);
    const totalProtein = foods.reduce((s, f) => s + f.protein, 0);
    const foodNames = foods.map((f) => f.name).join('、');

    const summary = `${foodNames}共约 ${totalCalories} 千卡，${decision.shouldEat ? '适合食用' : '建议调整'}`;

    const primaryReason = decision.reason;

    const userContextImpact: string[] = [];
    if (ctx.goalType !== 'health') {
      userContextImpact.push(`当前目标: ${ctx.goalLabel}`);
    }
    if (ctx.remainingCalories < totalCalories && ctx.goalCalories > 0) {
      userContextImpact.push(
        `今日剩余热量 ${Math.round(ctx.remainingCalories)} kcal，此餐 ${totalCalories} kcal`,
      );
    }
    if (totalProtein > 0) {
      const proteinPercent = Math.round(
        (totalProtein * 4 * 100) / Math.max(1, totalCalories),
      );
      userContextImpact.push(`蛋白质供能比 ${proteinPercent}%`);
    }

    return {
      summary,
      primaryReason,
      userContextImpact:
        userContextImpact.length > 0 ? userContextImpact : undefined,
    };
  }

  // ==================== Step 8: 营养汇总 ====================

  private calculateTotals(foods: ParsedFoodItem[]): NutritionTotals {
    return {
      calories: foods.reduce((s, f) => s + f.calories, 0),
      protein: foods.reduce((s, f) => s + f.protein, 0),
      fat: foods.reduce((s, f) => s + f.fat, 0),
      carbs: foods.reduce((s, f) => s + f.carbs, 0),
      fiber: foods.some((f) => f.fiber != null)
        ? Math.round(foods.reduce((s, f) => s + (f.fiber || 0), 0) * 10) / 10
        : undefined,
      sodium: foods.some((f) => f.sodium != null)
        ? Math.round(foods.reduce((s, f) => s + (f.sodium || 0), 0))
        : undefined,
    };
  }

  // ==================== Step 9: 综合评分 ====================

  private calculateScore(
    foods: ParsedFoodItem[],
    totals: NutritionTotals,
    ctx: Awaited<ReturnType<typeof this.buildUserContext>>,
  ): AnalysisScore {
    // 置信度: 标准库匹配高置信、LLM 中等置信
    const avgConfidence =
      foods.length > 0
        ? Math.round(
            (foods.reduce((s, f) => s + f.confidence, 0) / foods.length) * 100,
          )
        : 50;

    // 营养评分: 利用现有的 NutritionScoreService（如果有足够上下文）
    let nutritionScore = 70; // 默认中等
    let healthScore = 70;

    try {
      if (ctx.profile) {
        const goals = this.nutritionScoreService.calculateDailyGoals(
          ctx.profile,
        );
        const todayTotals = {
          calories: ctx.todayCalories,
          protein: ctx.todayProtein,
          fat: ctx.todayFat,
          carbs: ctx.todayCarbs,
        };

        // 使用评分引擎为此餐评分
        const avgQuality =
          foods.reduce(
            (s, f) =>
              s +
              (f.libraryMatch ? Number(f.libraryMatch.quality_score) || 5 : 5),
            0,
          ) / Math.max(1, foods.length);
        const avgSatiety =
          foods.reduce(
            (s, f) =>
              s +
              (f.libraryMatch ? Number(f.libraryMatch.satiety_score) || 5 : 5),
            0,
          ) / Math.max(1, foods.length);

        const scoreResult = this.nutritionScoreService.calculateMealScore(
          {
            calories: totals.calories,
            protein: totals.protein,
            fat: totals.fat,
            carbs: totals.carbs,
            avgQuality,
            avgSatiety,
          },
          todayTotals,
          goals,
          ctx.goalType,
        );

        nutritionScore = scoreResult.score;
        healthScore = Math.round(nutritionScore * 0.6 + avgQuality * 10 * 0.4);
      }
    } catch {
      // 评分失败不阻断
    }

    return {
      healthScore: Math.min(100, Math.max(0, healthScore)),
      nutritionScore: Math.min(100, Math.max(0, nutritionScore)),
      confidenceScore: avgConfidence,
    };
  }

  // ==================== Step 10: 入库决策 ====================

  private evaluateIngestion(foods: ParsedFoodItem[]): IngestionDecision {
    const matchedCount = foods.filter((f) => f.libraryMatch).length;
    const totalCount = foods.length;
    const unmatchedCount = totalCount - matchedCount;

    return {
      matchedExistingFoods: matchedCount > 0,
      shouldPersistCandidate:
        unmatchedCount > 0 &&
        foods.some((f) => !f.libraryMatch && f.confidence >= 0.6),
      reviewRequired: foods.some((f) => !f.libraryMatch && f.confidence < 0.6),
    };
  }

  // ==================== 工具方法 ====================

  /**
   * ParsedFoodItem → AnalyzedFoodItem（统一输出格式）
   */
  private toAnalyzedFoodItem(food: ParsedFoodItem): AnalyzedFoodItem {
    return {
      name: food.name,
      normalizedName: food.normalizedName,
      foodLibraryId: food.libraryMatch?.id,
      quantity: food.quantity,
      estimatedWeightGrams: food.estimatedWeightGrams,
      category: food.category,
      confidence: food.confidence,
      calories: food.calories,
      protein: food.protein,
      fat: food.fat,
      carbs: food.carbs,
      fiber: food.fiber,
      sodium: food.sodium,
    };
  }

  /**
   * 异步保存分析记录到 food_analysis_record 表
   */
  private async saveAnalysisRecord(
    analysisId: string,
    rawText: string,
    mealType: string | undefined,
    userId: string | undefined,
    result: FoodAnalysisResultV61,
    parsedFoods: ParsedFoodItem[],
  ): Promise<void> {
    if (!userId) return; // 匿名用户不保存记录

    const matchedCount = parsedFoods.filter((f) => f.libraryMatch).length;
    const candidateCount = parsedFoods.length - matchedCount;

    await this.prisma.food_analysis_record.create({
      data: {
        id: analysisId,
        user_id: userId,
        input_type: 'text',
        raw_text: rawText,
        meal_type: mealType || null,
        status: AnalysisRecordStatus.COMPLETED,
        recognized_payload: {
          terms: parsedFoods.map((f) => ({
            name: f.name,
            quantity: f.quantity,
            fromLibrary: !!f.libraryMatch,
          })),
        } as any,
        normalized_payload: {
          foods: result.foods,
        } as any,
        nutrition_payload: {
          totals: result.totals,
          score: result.score,
        } as any,
        decision_payload: {
          decision: result.decision,
          alternatives: result.alternatives,
          explanation: result.explanation,
        } as any,
        confidence_score: result.score.confidenceScore,
        quality_score: result.score.healthScore,
        matched_food_count: matchedCount,
        candidate_food_count: candidateCount,
        persist_status: PersistStatus.PENDING,
      },
    });
    this.logger.debug(`分析记录已保存: ${analysisId}`);
  }
}
