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
 * 8. 异步保存 food_analysis_records
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FoodLibraryService } from './food-library.service';
import {
  FoodAnalysisResultV61,
  AnalyzedFoodItem,
} from '../../../decision/types/analysis-result.types';
import {
  t,
  Locale,
} from '../../../diet/app/recommendation/utils/i18n-messages';
import { ScoringFoodItem } from '../../../decision/score/food-scoring.service';
import { AnalysisPipelineService } from '../../../decision/analyze/analysis-pipeline.service';
import {
  validateAndCorrectFoods,
  NutritionInput,
} from '../../../decision/analyze/nutrition-sanity-validator';
import { UserContextBuilderService } from '../../../decision/analyze/user-context-builder.service';
import { AnalysisPromptSchemaService } from './analysis-prompt-schema.service';

// ==================== 常量 ====================

/** 默认份量（克），用于标准食物库命中但无数量描述时 */
const DEFAULT_SERVING_GRAMS = 100;

/**
 * 按食物类别设定更合理的默认份量（无量词且库中 standardServingG=100 时使用）
 *
 * 依据：中国居民膳食指南常见一餐份量参考
 * - grain: 米饭/面条熟重约 150g（约半碗）
 * - protein: 肉/蛋/豆腐一份约 100g
 * - veggie: 蔬菜一盘约 120g
 * - fruit: 水果一份约 150g
 * - dairy: 牛奶/酸奶一杯约 200g
 * - fat: 油脂/坚果一份约 15g
 * - beverage: 饮料一杯约 250g
 * - snack: 零食一份约 30g
 * - composite: 复合菜肴（盖饭/套餐/炒饭/烩面）约 350g（米饭~200g + 主菜~150g）
 */
const CATEGORY_DEFAULT_SERVING: Record<string, number> = {
  grain: 150,
  protein: 100,
  veggie: 120,
  fruit: 150,
  dairy: 200,
  fat: 15,
  beverage: 250,
  snack: 30,
  composite: 350,
  condiment: 10,
  soup: 300,
};

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

/** 食物类别默认营养模板（每100g），用于无法命中标准库和LLM时的保底估算 */
const CATEGORY_DEFAULT_NUTRITION: Record<
  string,
  { calories: number; protein: number; fat: number; carbs: number }
> = {
  protein: { calories: 165, protein: 24, fat: 7, carbs: 2 },
  grain: { calories: 130, protein: 3, fat: 1, carbs: 27 },
  veggie: { calories: 32, protein: 2, fat: 0.3, carbs: 6 },
  fruit: { calories: 52, protein: 0.5, fat: 0.2, carbs: 13 },
  dairy: { calories: 65, protein: 3.4, fat: 3.5, carbs: 4.8 },
  beverage: { calories: 24, protein: 0.2, fat: 0, carbs: 5.8 },
  snack: { calories: 430, protein: 8, fat: 18, carbs: 58 },
  fat: { calories: 884, protein: 0, fat: 100, carbs: 0 },
  composite: { calories: 180, protein: 8, fat: 6, carbs: 22 },
};

/**
 * 每 100g 热量物理上限（kcal/100g）。
 * 来源：纯脂肪 ~900；坚果/油炸 ~600；常规熟食 ~300-400。
 * 用于检测 LLM 返回值是否把 per-serving 误当 per-100g。
 */
const CALORIES_PER_100G_HARD_CAP: Record<string, number> = {
  fat: 950, // 纯油脂理论最大值（100g 全脂肪 = 900kcal）
  nut: 700, // 坚果/种子
  snack: 600, // 油炸/酥皮零食
  condiment: 600, // 重油调料
  dairy: 500, // 奶酪/黄油偏高
  meat: 450, // 肥肉、培根
  egg: 400,
  seafood: 400,
  protein: 450, // 旧分类兼容
  grain: 420, // 干谷物/油炒饭
  legume: 400,
  vegetable: 200,
  veggie: 200,
  fruit: 350, // 干果允许偏高
  beverage: 250, // 含糖饮料
  composite: 300, // 复合菜肴一份本身大都 < 300/100g（油炸/糕点除外，已单列）
  dish: 280, // 中式正餐菜肴（拉面、盖饭、椰子鸡等）真实密度 ~150-250/100g
  soup: 200,
  other: 400,
};
const CALORIES_PER_100G_DEFAULT_CAP = 400;

// ==================== LLM Prompt ====================

/**
 * V5.0: 文本分析 prompt 使用统一 buildBasePrompt + buildUserContextPrompt
 */

// 注：原 buildContextAwareTextPrompt 已内联到 caller，直接调用 promptSchema.buildBasePrompt + buildUserContextPrompt

// ==================== 内部类型 ====================

/**
 * V4.8: 文本解析出的食物项 — 扩展 AnalyzedFoodItem 以携带食物库匹配引用
 *
 * 与 AnalyzedFoodItem 字段完全对齐，仅新增 libraryMatch 用于内部处理。
 * toAnalyzedFoodItem() 转换时会剥离 libraryMatch，提取 foodLibraryId。
 */
type ParsedFoodItem = AnalyzedFoodItem & {
  /** 匹配到的标准食物库条目（内部使用，不暴露到最终输出） */
  libraryMatch?: any;
};

/** LLM 返回的解析结构 */
interface LlmTextParseResult {
  foods: Array<{
    name: string;
    nameEn?: string;
    quantity?: string;
    estimatedWeightGrams?: number;
    category?: string;
    calories: number;
    protein?: number;
    fat?: number;
    carbs?: number;
    fiber?: number;
    sodium?: number;
    saturatedFat?: number | null;
    transFat?: number | null;
    addedSugar?: number | null;
    cholesterol?: number | null;
    omega3?: number | null;
    omega6?: number | null;
    solubleFiber?: number | null;
    vitaminA?: number | null;
    vitaminC?: number | null;
    vitaminD?: number | null;
    calcium?: number | null;
    iron?: number | null;
    potassium?: number | null;
    zinc?: number | null;
    estimated?: boolean;
    /** Big-9 过敏原列表 */
    allergens?: string[];
    /** 饮食标签 */
    tags?: string[];
    /** V4.5: 食物质量评分 1-10（对齐食物库 qualityScore） */
    qualityScore?: number;
    /** V4.5: 饱腹感评分 1-10（对齐食物库 satietyScore） */
    satietyScore?: number;
    /** V4.5: NOVA 加工分级 1-4 */
    processingLevel?: number;
    /** V4.5: 总糖（克） */
    sugar?: number | null;
    /** V4.5: LLM 置信度 0-1 */
    confidence?: number;
    standardServingG?: number;
    standardServingDesc?: string;
    glycemicIndex?: number;
    glycemicLoad?: number | null;
    nutrientDensity?: number | null;
    fodmapLevel?: string | null;
    oxalateLevel?: string | null;
    purine?: string | null;
    cookingMethods?: string[];
    ingredientList?: string[];
  }>;
  summary?: string;
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
    // V2.1: 统一分析管道（替代手工编排）
    private readonly analysisPipeline: AnalysisPipelineService,
    // V3.4 P1.3: 用户上下文（LLM 动态 prompt）
    private readonly userContextBuilder: UserContextBuilderService,
    // V13.3: 注入 prompt schema service，取代模块级 free function
    private readonly promptSchema: AnalysisPromptSchemaService,
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
      'deepseek/deepseek-chat-v3';
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
   * @param locale - V1.1: 语言区域
   * @returns 统一分析结果（未裁剪，Controller 层再调 ResultEntitlementService）
   */
  async analyze(
    text: string,
    mealType?: string,
    userId?: string,
    locale?: Locale,
    localHourOverride?: number,
    hints?: string[],
  ): Promise<FoodAnalysisResultV61> {
    // 1. 预处理文本
    const cleanedText = this.preprocessText(text);
    if (!cleanedText) {
      throw new BadRequestException(
        t('decision.error.invalidInput', {}, locale),
      );
    }

    // 2. 拆分多个食物词条（简单分隔符拆分）
    const foodTerms = this.splitFoodTerms(cleanedText);

    // V3.4 P1.3: 构建用户上下文（用于动态 LLM Prompt）
    const userCtx = userId
      ? await this.userContextBuilder.build(userId, locale).catch(() => null)
      : null;

    // 3. 逐个匹配标准食物库 + LLM 补位
    const parsedFoods = await this.resolveAllFoods(
      foodTerms,
      cleanedText,
      locale,
      userCtx,
      hints,
    );

    // V6.x: parsedFoods 上的营养值是 per-serving 实际摄入（数据契约见 AnalyzedFoodItem JSDoc），
    // 直接透传到 scoring 层即可。
    const scoringFoods: ScoringFoodItem[] = parsedFoods.map((f) => {
      const grams = f.estimatedWeightGrams || f.standardServingG || 100;
      return {
        name: f.name,
        confidence: f.confidence,
        calories: f.calories || 0,
        protein: f.protein || 0,
        fat: f.fat || 0,
        carbs: f.carbs || 0,
        fiber: f.fiber != null ? f.fiber || 0 : undefined,
        sodium: f.sodium != null ? f.sodium || 0 : undefined,
        saturatedFat:
          f.saturatedFat != null ? Number(f.saturatedFat) || 0 : undefined,
        addedSugar:
          f.addedSugar != null ? Number(f.addedSugar) || 0 : undefined,
        estimatedWeightGrams: grams,
        // V4.7: 补全 V4.6 新增字段（此前缺失导致评分链路健康调整失效）
        transFat: f.transFat != null ? Number(f.transFat) || 0 : undefined,
        cholesterol:
          f.cholesterol != null ? Number(f.cholesterol) || 0 : undefined,
        glycemicLoad: f.glycemicLoad,
        nutrientDensity: f.nutrientDensity,
        fodmapLevel: f.fodmapLevel,
        purine: f.purine,
        oxalateLevel: f.oxalateLevel,
        libraryMatch: f.libraryMatch,
      };
    });

    return this.analysisPipeline.execute({
      inputType: 'text',
      rawText: text,
      mealType,
      userId,
      locale,
      localHourOverride,
      foods: parsedFoods.map((f) => this.toAnalyzedFoodItem(f)),
      scoringFoods,
      parsedFoodMeta: parsedFoods.map((f) => ({
        name: f.name,
        quantity: f.quantity,
        fromLibrary: !!f.libraryMatch,
      })),
      prebuiltUserContext: userCtx || undefined,
    });
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
        .replace(/[；;]/g, ',')
        .replace(/[（(]/g, '（')
        .replace(/[）)]/g, '）')
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
    const normalized = text
      .replace(/\s*[+＋]\s*/g, ',')
      .replace(/[，、；;/／|｜＆&]+/g, ',')
      .replace(
        /(?:\b(?:and|with)\b|和|跟|同|加|配|还有|以及|外加|搭配|再加上)/gi,
        ',',
      );

    const terms = normalized
      .split(/[,\n]+/)
      .flatMap((t) => t.split(/\s{2,}/))
      .map((t) => this.normalizeFoodTerm(t))
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
    locale?: Locale,
    userCtx?: any,
    hints?: string[],
  ): Promise<ParsedFoodItem[]> {
    const results: ParsedFoodItem[] = [];
    const unmatchedTerms: Array<{
      term: string;
      quantity?: string;
      foodName: string;
    }> = [];

    // 3a. 并行匹配所有词条的标准食物库（优化：Promise.all 替代顺序循环）
    const termData = foodTerms.map((term) => {
      const { quantity, foodName } = this.extractQuantity(term);
      return { term, quantity, foodName };
    });
    const matchResults = await Promise.all(
      termData.map((td) =>
        this.matchFoodLibrary(td.foodName).catch(() => null),
      ),
    );

    for (let i = 0; i < termData.length; i++) {
      const { quantity, foodName } = termData[i];
      const matchResult = matchResults[i];

      if (matchResult) {
        const { match, simScore } = matchResult;
        const servingGrams = this.resolveServingGrams(quantity, match);
        const parsed = this.buildFromLibraryMatch(
          match,
          quantity,
          servingGrams,
        );
        // 置信度：精确命中 0.95；模糊命中按 simScore 线性映射 0.65~0.9
        parsed.confidence =
          simScore >= 1.0 ? 0.95 : Math.min(0.9, 0.65 + (simScore - 0.7) * 0.8);
        results.push(parsed);
      } else {
        // P9: zero-calorie passthrough for water/clear-tea (food library lacks "白开水/纯净水/凉白开"等)
        const zeroCal = this.tryZeroCaloriePassthrough(foodName, quantity);
        if (zeroCal) {
          results.push(zeroCal);
          continue;
        }
        unmatchedTerms.push({ term: foodTerms[i], quantity, foodName });
      }
    }

    // 3b. 未命中的词条走 LLM 拆解
    if (unmatchedTerms.length > 0) {
      const llmResults = await this.llmParseFoods(
        unmatchedTerms.map((t) => t.term).join(', '),
        originalText,
        userCtx,
        locale,
        hints,
      );
      results.push(...llmResults);

      // 仅当 LLM 返回零结果且有多词条时，才对完整原文进行全量重试
      // （避免大多数场景下的第二次 LLM 调用，节省 5-15s）
      if (llmResults.length === 0 && unmatchedTerms.length > 1) {
        const llmFullTextResults = await this.llmParseFoods(
          originalText,
          originalText,
          userCtx,
          locale,
          hints,
        );
        results.push(...llmFullTextResults);
      }

      // Bug 5a 修复: 仅当 LLM 完全无结果时，才启用启发式保底
      // 若 LLM 有任何返回，视为已覆盖所有未命中词条（避免组合食物拆解后原词重复入账）
      if (llmResults.length === 0) {
        const coveredKeys = new Set(
          results.map((r) => this.normalizeFoodKey(r.name)),
        );
        for (const item of unmatchedTerms) {
          const key = this.normalizeFoodKey(item.foodName);
          if (coveredKeys.has(key)) continue;
          if (
            this.isSemanticallyCoveredByResolvedFoods(
              item.foodName,
              results.map((r) => r.name),
            )
          ) {
            continue;
          }

          // P3 修复: 跳过明显非食物输入，避免给"空气/一大堆/我吃了点东西"伪造 630kcal
          if (this.isLikelyNonFood(item.foodName)) {
            this.logger.warn(
              `Skip heuristic fallback for non-food input: "${item.foodName}"`,
            );
            continue;
          }

          results.push(
            this.buildHeuristicFallbackFood(item.foodName, item.quantity),
          );
          coveredKeys.add(key);
        }
      }
    }

    const merged = this.mergeParsedFoods(results);

    // 3c. 如果全部为空（匹配失败 + LLM 也无结果），返回降级结果
    if (merged.length === 0) {
      this.logger.warn(
        `Text analysis could not identify any food: "${originalText}"`,
      );
      throw new BadRequestException(t('decision.error.noFood', {}, locale));
    }

    return merged;
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
    const normalizedTerm = this.normalizeFoodTerm(term);

    // 匹配中文数量词
    // 注意：单字量词（条/个/块/片/根/碗/杯…）必须有前置数词（一/二/半/小/大/几等），
    // 否则会把"薯条/油条/红薯片"等食物名误识别为量词。
    const chinesePattern =
      /^(一|二|两|三|四|五|六|七|八|九|十|半|小|大|几)(份|碗|杯|盘|个|块|片|根|条|勺|把)/;
    const chineseMatch = normalizedTerm.match(chinesePattern);
    if (chineseMatch) {
      const quantity = chineseMatch[0];
      const foodName = this.normalizeFoodTerm(
        normalizedTerm.slice(quantity.length),
      );
      return foodName ? { quantity, foodName } : { foodName: normalizedTerm };
    }

    // 匹配数字+单位（如 200g、100ml）
    const numPattern = /^(\d+)\s*(g|ml|克|毫升)/i;
    const numMatch = normalizedTerm.match(numPattern);
    if (numMatch) {
      const quantity = numMatch[0];
      const foodName = this.normalizeFoodTerm(
        normalizedTerm.slice(quantity.length),
      );
      return foodName ? { quantity, foodName } : { foodName: normalizedTerm };
    }

    // 匹配后缀数量（如 牛奶200ml / 米饭150g）
    const suffixNumPattern = /^(.*?)(\d+\s*(g|ml|克|毫升))$/i;
    const suffixNumMatch = normalizedTerm.match(suffixNumPattern);
    if (suffixNumMatch) {
      const foodName = this.normalizeFoodTerm(suffixNumMatch[1]);
      const quantity = suffixNumMatch[2];
      if (foodName) return { quantity, foodName };
    }

    // 匹配后缀中文数量（如 牛奶一杯 / 米饭两碗）
    // 同前缀模式：单字量词必须有前置数词，否则会把"薯条/红薯片/油条"等剥成"薯/红薯/油"
    const suffixChinesePattern =
      /^(.+?)(一|二|两|三|四|五|六|七|八|九|十|半|小|大|几)(份|碗|杯|盘|个|块|片|根|条|勺|把)$/;
    const suffixChineseMatch = normalizedTerm.match(suffixChinesePattern);
    if (suffixChineseMatch) {
      const foodName = this.normalizeFoodTerm(suffixChineseMatch[1]);
      const quantity = `${suffixChineseMatch[2] || ''}${suffixChineseMatch[3]}`;
      if (foodName) return { quantity, foodName };
    }

    return { foodName: normalizedTerm };
  }

  /**
   * 匹配标准食物库（精确名 → 模糊搜索 sim_score 排序）
   *
   * V1.1 P1-1: 使用 sim_score 排序最佳匹配（而非 find 取第一个）
   * V1.1 P1-2: 返回 sim_score 用于动态置信度计算
   */
  private async matchFoodLibrary(
    foodName: string,
  ): Promise<{ match: any; simScore: number } | null> {
    const hasCompositeDelimiter = /[+＋,，、；;/／|｜＆&]/.test(foodName);
    // 复合菜品尾字（饭/面/粉/汤/煲/锅/堡/卷/串/丼/炒等）：禁止用"短库名 includes 长输入"反匹配
    // 例如："椰子鸡饭" 不应反向匹配到库内的 "椰子"
    const isCompositeDish =
      /(饭|面|麵|粉|米线|河粉|汤|羹|煲|锅|堡|卷|串|丼|盖浇|拌饭|炒饭|炒面|沙拉|意面|披萨|比萨|寿司|便当|套餐|套餐饭|盒饭|定食|拉面)$/.test(
        foodName,
      );
    const queryLooksSimpleIngredient =
      !hasCompositeDelimiter &&
      !isCompositeDish &&
      !/\b(with|and|combo|set|meal|dinner|lunch|breakfast)\b/i.test(foodName) &&
      foodName.trim().split(/\s+/).length <= 3;

    // 模糊匹配 sim_score 准入门槛：收紧到 0.72，宁可走 LLM 也不要错匹配库
    const SIM_ACCEPT_THRESHOLD = 0.72;
    // includes 反向匹配（query.includes(name)）的最小覆盖率：库名长度需达到 query 70% 以上
    const REVERSE_INCLUDE_MIN_RATIO = 0.7;

    const lookupQueries = this.expandLookupQueries(foodName);

    try {
      for (const query of lookupQueries) {
        // 精确匹配
        const exact = await this.foodLibraryService
          .findByName(query)
          .catch(() => null);
        if (exact) return { match: exact, simScore: 1.0 };

        // 模糊搜索：遍历候选并择优，避免“只看第一条”漏匹配
        const results = (await this.foodLibraryService.search(
          query,
          8,
        )) as any[];
        if (!results.length) continue;

        let bestAcceptable: { item: any; score: number } | null = null;
        for (const candidate of results) {
          const simScore = Number(candidate.sim_score) || 0;
          const name: string = candidate.name || '';
          const candidateLooksComposite =
            /,|，|\b(with|and|combo|set|meal|dinner|lunch|breakfast|junior|baby food)\b/i.test(
              name,
            ) ||
            /(饭|面|麵|粉|米线|河粉|汤|羹|煲|锅|堡|卷|串|丼|盖浇|拌饭|炒饭|炒面|沙拉|意面|披萨|比萨|寿司|便当|套餐|套餐饭|盒饭|定食|拉面)$/.test(
              name,
            );

          // 1) 别名精确命中：高置信信号，保留
          const aliasMatched =
            !!candidate.aliases &&
            candidate.aliases
              .split(',')
              .map((a: string) => a.trim())
              .includes(query);

          // 2) 包含匹配：
          //    - 正向：库名包含整个 query（query 较短，库名是其扩展）→ 通常可信，如 "鸡胸肉" ⊂ "去皮鸡胸肉"
          //    - 反向：query 包含整个库名（库名是 query 的子串）→ 高风险，复合菜禁用；
          //      非复合菜也要求库名长度 ≥ query 70%，否则视为短词误伤
          const forwardInclude = !!query && name.includes(query);
          const reverseInclude =
            !!name &&
            query.includes(name) &&
            !isCompositeDish &&
            !hasCompositeDelimiter &&
            name.length / Math.max(query.length, 1) >=
              REVERSE_INCLUDE_MIN_RATIO;
          const includeMatched =
            !hasCompositeDelimiter && (forwardInclude || reverseInclude);

          // 对简单单食材词，拒绝仅靠宽松 includes 命中的复合菜/婴儿辅食候选，
          // 否则类似 "rice" / "broccoli" 会误命中 "Baby Food, ... Dinner"。
          if (
            queryLooksSimpleIngredient &&
            candidateLooksComposite &&
            includeMatched &&
            !aliasMatched &&
            simScore < SIM_ACCEPT_THRESHOLD
          ) {
            continue;
          }

          // 3) sim_score 阈值收紧
          const accepted =
            simScore >= SIM_ACCEPT_THRESHOLD || aliasMatched || includeMatched;
          if (!accepted) continue;

          const normalizedScore = Math.max(
            simScore,
            aliasMatched ? 0.9 : includeMatched ? 0.75 : 0,
          );
          if (!bestAcceptable || normalizedScore > bestAcceptable.score) {
            bestAcceptable = { item: candidate, score: normalizedScore };
          }
        }

        if (bestAcceptable) {
          return { match: bestAcceptable.item, simScore: bestAcceptable.score };
        }
      }
    } catch {
      // 匹配失败不阻断流程
    }
    return null;
  }

  /**
   * 展开食物检索词（同义词/常见说法）
   */
  private expandLookupQueries(foodName: string): string[] {
    const base = foodName.trim();
    if (!base) return [];

    const normalized = this.normalizeFoodTerm(base);
    const noParen = normalized.replace(/（[^）]*）/g, '').trim();
    const noDescriptor = noParen
      .replace(
        /^(无糖|低脂|脱脂|全脂|原味|即食|鲜|纯|熟|生|冻干|烘焙|油炸|蒸|煮|炒|烤|凉拌|速冻)/,
        '',
      )
      .replace(
        /(无糖|低脂|脱脂|全脂|原味|即食|鲜|纯|熟|生|冻干|烘焙|油炸|蒸|煮|炒|烤|凉拌|速冻)$/,
        '',
      )
      .trim();

    const compact = noDescriptor.replace(/[\s\-_]+/g, '');
    const lowercase = compact.toLowerCase();

    const expanded = [
      base,
      normalized,
      noParen,
      noDescriptor,
      compact,
      lowercase,
    ].filter((q) => !!q);
    return Array.from(new Set(expanded));
  }

  /**
   * 解析份量克数
   */
  private resolveServingGrams(quantity: string | undefined, food: any): number {
    /**
     * 当食物库中 standardServingG=100 时，无法区分"真的是 100g"和"schema 默认值"。
     * 因此当无量词输入且库值为 100 时，优先使用按类别设定的合理默认份量。
     */
    const categoryServingFallback = (): number => {
      const libVal = food.standardServingG;
      if (libVal && libVal !== 100) return libVal;
      const cat = food.category as string | undefined;
      return (cat && CATEGORY_DEFAULT_SERVING[cat]) || DEFAULT_SERVING_GRAMS;
    };

    if (!quantity) {
      return categoryServingFallback();
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
    if (food.commonPortions && (food.commonPortions as any[]).length > 0) {
      const portion = (food.commonPortions as any[]).find((p: any) =>
        quantity.includes(p.name),
      );
      if (portion) return portion.grams;
    }

    return categoryServingFallback();
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
      // GI 是食物固有属性，不按份量缩放
      glycemicIndex:
        food.glycemicIndex != null ? Number(food.glycemicIndex) : undefined,
      // V1.2: 从标准库提取扩展营养字段
      saturatedFat:
        food.saturatedFat != null
          ? Math.round(Number(food.saturatedFat) * ratio * 10) / 10
          : undefined,
      addedSugar:
        food.addedSugar != null
          ? Math.round(Number(food.addedSugar) * ratio * 10) / 10
          : undefined,
      // V4.6: 新增营养字段
      transFat:
        food.transFat != null
          ? Math.round(Number(food.transFat) * ratio * 10) / 10
          : undefined,
      cholesterol:
        food.cholesterol != null
          ? Math.round(Number(food.cholesterol) * ratio)
          : undefined,
      omega3:
        food.omega3 != null
          ? Math.round(Number(food.omega3) * ratio)
          : undefined,
      omega6:
        food.omega6 != null
          ? Math.round(Number(food.omega6) * ratio)
          : undefined,
      solubleFiber:
        food.solubleFiber != null
          ? Math.round(Number(food.solubleFiber) * ratio * 10) / 10
          : undefined,
      vitaminD:
        food.vitaminD != null
          ? Math.round(Number(food.vitaminD) * ratio * 10) / 10
          : undefined,
      potassium:
        food.potassium != null
          ? Math.round(Number(food.potassium) * ratio)
          : undefined,
      zinc:
        food.zinc != null
          ? Math.round(Number(food.zinc) * ratio * 10) / 10
          : undefined,
      // V4.5: 统一为新字段名
      qualityScore:
        food.qualityScore != null ? Number(food.qualityScore) : undefined,
      satietyScore:
        food.satietyScore != null ? Number(food.satietyScore) : undefined,
      processingLevel:
        food.processingLevel != null ? Number(food.processingLevel) : undefined,
      sugar:
        food.sugar != null
          ? Math.round(Number(food.sugar) * ratio * 10) / 10
          : undefined,
      standardServingG:
        food.standardServingG != null
          ? Number(food.standardServingG)
          : undefined,
      // V4.6: 新增非营养字段（不按份量缩放）
      nameEn: food.nameEn ?? undefined,
      standardServingDesc: food.standardServingDesc ?? undefined,
      glycemicLoad:
        food.glycemicLoad != null ? Number(food.glycemicLoad) : undefined,
      nutrientDensity:
        food.nutrientDensity != null ? Number(food.nutrientDensity) : undefined,
      fodmapLevel: food.fodmapLevel ?? undefined,
      oxalateLevel: food.oxalateLevel ?? undefined,
      purine: food.purine ?? undefined,
      cookingMethods: Array.isArray(food.cookingMethods)
        ? food.cookingMethods
        : undefined,
      ingredientList: Array.isArray(food.ingredientList)
        ? food.ingredientList
        : undefined,
    };
  }

  // ==================== Step 3b: LLM 补位 ====================

  /**
   * 调用 LLM 拆解未匹配的食物文本
   *
   * V3.4 P1.3: 支持用户上下文注入，构建决策导向的动态 system prompt
   */
  private async llmParseFoods(
    unmatchedText: string,
    _originalText: string,
    userCtx?: any,
    locale?: Locale,
    hints?: string[],
  ): Promise<ParsedFoodItem[]> {
    if (!this.apiKey) {
      this.logger.warn('LLM API not configured, skipping LLM parsing');
      return [];
    }

    try {
      // V3.4 P1.3: 根据用户上下文选择 system prompt
      const systemPrompt = userCtx
        ? this.promptSchema.buildBasePrompt(undefined, locale) +
          this.promptSchema.buildUserContextPrompt({
            goalType: userCtx.goalType || 'health',
            nutritionPriority: userCtx.nutritionPriority || [],
            healthConditions: userCtx.healthConditions || [],
            budgetStatus: userCtx.budgetStatus || 'under_target',
            remainingCalories: userCtx.remainingCalories ?? 2000,
            remainingProtein: userCtx.remainingProtein ?? 65,
            locale,
          })
        : this.promptSchema.buildBasePrompt(undefined, locale);

      this.logger.log(
        `[LLM] Text parsing call | input: "${unmatchedText.slice(0, 80)}"`,
      );

      // 将 hints 拼接到 user message 末尾（作为估算指导，不作为食物词条）
      let userContent = this.promptSchema.getUserMessage(
        'text',
        unmatchedText,
        locale,
      );
      if (hints && hints.length > 0) {
        userContent += `\n\n【估算指导】${hints.join('；')}`;
      }

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
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: userContent,
            },
          ],
          max_tokens: 800,
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error(`LLM API error: ${response.status} ${err}`);
        return [];
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      const parsed = this.parseLlmResponse(content);

      // 并行查询所有 LLM 解析食物的食物库匹配
      const llmFoods = parsed.foods
        .map((f) => ({ ...f, llmName: this.normalizeFoodTerm(f.name || '') }))
        .filter((f) => f.llmName);
      const libraryMatches = await Promise.all(
        llmFoods.map((f) => this.matchFoodLibrary(f.llmName).catch(() => null)),
      );

      const resolved: ParsedFoodItem[] = [];
      for (let i = 0; i < llmFoods.length; i++) {
        const f = llmFoods[i];
        const libraryMatch = libraryMatches[i];

        if (libraryMatch) {
          const servingGrams = this.resolveServingGrams(
            f.quantity,
            libraryMatch.match,
          );
          const fromLibrary = this.buildFromLibraryMatch(
            libraryMatch.match,
            f.quantity,
            servingGrams,
          );
          fromLibrary.confidence = Math.max(
            fromLibrary.confidence,
            libraryMatch.simScore >= 1 ? 0.9 : 0.72,
          );
          resolved.push(fromLibrary);
          continue;
        }

        const fallbackGrams = f.estimatedWeightGrams || DEFAULT_SERVING_GRAMS;

        // ==== Bug #2 修复：检测 LLM 返回的"假 per-100g"（实为 per-serving）====
        // LLM 偶尔会忽略 per-100g 约定，按一份的总量返回。
        // 例如海南鸡饭 calories=600（实际是一份 350g 的总量），
        // 经 ratio 3.5 缩放后 = 2100kcal，验证器仅做宏量自洽时无法发现。
        // 检测方法：与按类别的 per-100g 物理上限对比。
        const cap =
          CALORIES_PER_100G_HARD_CAP[f.category as string] ??
          CALORIES_PER_100G_DEFAULT_CAP;
        const reportedCalPer100g = Number(f.calories) || 0;
        const looksLikePerServing =
          reportedCalPer100g > cap && fallbackGrams > 100;
        // 若疑似 per-serving，则不再做 ratio 缩放（直接当一份总量），并降低置信度
        const fallbackRatio = looksLikePerServing ? 1 : fallbackGrams / 100;
        const baseConfidence = looksLikePerServing ? 0.45 : 0.7;
        if (looksLikePerServing) {
          this.logger.warn(
            `[LLM] Suspicious per-100g for "${f.llmName}": calories=${reportedCalPer100g} > cap ${cap} (cat=${f.category}). Treat as per-serving (no ratio scaling).`,
          );
        }

        resolved.push({
          name: f.llmName,
          normalizedName: f.llmName,
          nameEn: f.nameEn ?? undefined,
          quantity: f.quantity,
          estimatedWeightGrams: fallbackGrams,
          category: f.category,
          confidence: baseConfidence,
          // per-100g → per-serving 换算（与 buildFromLibraryMatch 保持一致）
          calories: Math.round((f.calories || 0) * fallbackRatio),
          protein: Math.round((f.protein || 0) * fallbackRatio * 10) / 10,
          fat: Math.round((f.fat || 0) * fallbackRatio * 10) / 10,
          carbs: Math.round((f.carbs || 0) * fallbackRatio * 10) / 10,
          fiber:
            f.fiber != null
              ? Math.round((f.fiber || 0) * fallbackRatio * 10) / 10
              : undefined,
          sodium:
            f.sodium != null
              ? Math.round((f.sodium || 0) * fallbackRatio)
              : undefined,
          // V6.x: 扩展营养字段同样需按 fallbackRatio 缩放（LLM 输出 per-100g）
          saturatedFat:
            f.saturatedFat != null
              ? Math.round((Number(f.saturatedFat) || 0) * fallbackRatio * 10) /
                10
              : undefined,
          transFat:
            f.transFat != null
              ? Math.round((Number(f.transFat) || 0) * fallbackRatio * 10) / 10
              : undefined,
          addedSugar:
            f.addedSugar != null
              ? Math.round((Number(f.addedSugar) || 0) * fallbackRatio * 10) /
                10
              : undefined,
          cholesterol:
            f.cholesterol != null
              ? Math.round((Number(f.cholesterol) || 0) * fallbackRatio)
              : undefined,
          omega3:
            f.omega3 != null
              ? Math.round((Number(f.omega3) || 0) * fallbackRatio)
              : undefined,
          omega6:
            f.omega6 != null
              ? Math.round((Number(f.omega6) || 0) * fallbackRatio)
              : undefined,
          solubleFiber:
            f.solubleFiber != null
              ? Math.round((Number(f.solubleFiber) || 0) * fallbackRatio * 10) /
                10
              : undefined,
          vitaminA:
            f.vitaminA != null
              ? Math.round((Number(f.vitaminA) || 0) * fallbackRatio)
              : undefined,
          vitaminC:
            f.vitaminC != null
              ? Math.round((Number(f.vitaminC) || 0) * fallbackRatio * 10) / 10
              : undefined,
          vitaminD:
            f.vitaminD != null
              ? Math.round((Number(f.vitaminD) || 0) * fallbackRatio * 10) / 10
              : undefined,
          calcium:
            f.calcium != null
              ? Math.round((Number(f.calcium) || 0) * fallbackRatio)
              : undefined,
          iron:
            f.iron != null
              ? Math.round((Number(f.iron) || 0) * fallbackRatio * 10) / 10
              : undefined,
          potassium:
            f.potassium != null
              ? Math.round((Number(f.potassium) || 0) * fallbackRatio)
              : undefined,
          zinc:
            f.zinc != null
              ? Math.round((Number(f.zinc) || 0) * fallbackRatio * 10) / 10
              : undefined,
          sugar:
            f.sugar != null
              ? Math.round((Number(f.sugar) || 0) * fallbackRatio * 10) / 10
              : undefined,
          estimated: f.estimated,
          allergens: Array.isArray(f.allergens) ? f.allergens : undefined,
          tags: Array.isArray(f.tags) ? f.tags : undefined,
          // V4.6: 统一字段名（评分/分级类与重量无关，不缩放）
          qualityScore: f.qualityScore ?? undefined,
          satietyScore: f.satietyScore ?? undefined,
          processingLevel: f.processingLevel ?? undefined,
          standardServingG: f.standardServingG ?? undefined,
          standardServingDesc: f.standardServingDesc ?? undefined,
          glycemicIndex: f.glycemicIndex ?? undefined,
          glycemicLoad: f.glycemicLoad ?? undefined,
          nutrientDensity: f.nutrientDensity ?? undefined,
          fodmapLevel: (f.fodmapLevel ??
            undefined) as AnalyzedFoodItem['fodmapLevel'],
          oxalateLevel: (f.oxalateLevel ??
            undefined) as AnalyzedFoodItem['oxalateLevel'],
          purine: (f.purine ?? undefined) as AnalyzedFoodItem['purine'],
          cookingMethods: Array.isArray(f.cookingMethods)
            ? f.cookingMethods
            : undefined,
          ingredientList: Array.isArray(f.ingredientList)
            ? f.ingredientList
            : undefined,
        });
      }

      // V3.6 P1.2: 校验并纠偏 LLM 估算的营养数据（热力学一致性）
      // resolved items always have protein/fat/carbs/calories set as numbers
      return validateAndCorrectFoods(
        resolved as Array<ParsedFoodItem & NutritionInput>,
      );
    } catch (err) {
      this.logger.warn(`LLM text parsing failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * 标准化单个食物短语
   */
  private normalizeFoodTerm(term: string): string {
    return term
      .trim()
      .replace(/^[,，;；.。:\s]+/, '')
      .replace(/[,，;；.。:\s]+$/, '')
      .replace(
        /^(我|今天|刚刚|刚才|早餐|午餐|晚餐|夜宵|吃了|喝了|来点|想吃|想喝|要了)/,
        '',
      )
      .trim();
  }

  /**
   * 估算文本理论食物数，用于判断是否需要全量补偿解析
   */
  private estimateExpectedFoodCount(text: string): number {
    const countByDelimiter =
      (text.match(/[+＋,，、；;/／|｜＆&]/g) || []).length + 1;
    const countByConnector =
      (
        text.match(
          /(?:\b(?:and|with)\b|和|跟|同|加|配|还有|以及|外加|搭配|再加上)/gi,
        ) || []
      ).length + 1;
    return Math.max(1, countByDelimiter, countByConnector);
  }

  /**
   * 结果去重融合：同一食物保留置信度更高/有标准库匹配的数据
   */
  private mergeParsedFoods(items: ParsedFoodItem[]): ParsedFoodItem[] {
    const map = new Map<string, ParsedFoodItem>();

    for (const item of items) {
      const key = this.normalizeFoodKey(item.name);
      if (!key) continue;

      const existing = map.get(key);
      if (!existing) {
        map.set(key, item);
        continue;
      }

      const existingScore =
        (existing.libraryMatch ? 0.15 : 0) + existing.confidence;
      const nextScore = (item.libraryMatch ? 0.15 : 0) + item.confidence;
      if (nextScore > existingScore) {
        map.set(key, item);
      }
    }

    return Array.from(map.values());
  }

  /**
   * 统一食物去重键
   */
  private normalizeFoodKey(name: string): string {
    return (name || '')
      .toLowerCase()
      .replace(/[\s()（）[\]{}.,，;；:/\\+＋|｜&＆_-]/g, '')
      .trim();
  }

  /**
   * 语义层去重：当未命中词条与已解析食物是同一语义（仅描述不同）时，跳过启发式保底项。
   * 例如："外卖黄焖鸡" 与 "黄焖鸡米饭"。
   */
  private isSemanticallyCoveredByResolvedFoods(
    foodName: string,
    resolvedNames: string[],
  ): boolean {
    const base = this.normalizeFoodKey(this.stripFoodNameDecorators(foodName));
    if (!base) return false;

    for (const resolvedName of resolvedNames) {
      const resolved = this.normalizeFoodKey(
        this.stripFoodNameDecorators(resolvedName),
      );
      if (!resolved) continue;

      if (resolved === base) return true;
      if (resolved.includes(base) || base.includes(resolved)) return true;
    }

    return false;
  }

  /**
   * 去掉不改变核心食物语义的描述词，提升回退去重的鲁棒性。
   */
  private stripFoodNameDecorators(name: string): string {
    return (name || '')
      .trim()
      .replace(/^(外卖|商家|店里|套餐|加料|加购|打包)/, '')
      .replace(/(外卖|商家|套餐|打包)$/, '')
      .trim();
  }

  /**
   * 保底启发式食物构建，确保未命中项不会直接丢失
   */
  private buildHeuristicFallbackFood(
    foodName: string,
    quantity?: string,
  ): ParsedFoodItem {
    const category = this.inferCategoryByKeywords(foodName);
    const servingGrams = this.resolveServingGrams(quantity, {
      standardServingG: DEFAULT_SERVING_GRAMS,
      commonPortions: [],
      // 关键：把 category 传给 resolveServingGrams，让 categoryServingFallback 走对分支
      // 否则 composite/grain/protein 等的类别默认份量永远用不上，会回落到 100g
      category,
    });
    const ratio = servingGrams / 100;
    const profile =
      CATEGORY_DEFAULT_NUTRITION[category] ||
      CATEGORY_DEFAULT_NUTRITION.composite;
    const sodiumPer100g = this.estimateSodiumByKeywords(foodName, category);

    return {
      name: foodName,
      normalizedName: foodName,
      quantity: quantity || `${servingGrams}g`,
      estimatedWeightGrams: servingGrams,
      category,
      confidence: 0.45,
      calories: Math.round(profile.calories * ratio),
      protein: Math.round(profile.protein * ratio * 10) / 10,
      fat: Math.round(profile.fat * ratio * 10) / 10,
      carbs: Math.round(profile.carbs * ratio * 10) / 10,
      sodium:
        sodiumPer100g != null ? Math.round(sodiumPer100g * ratio) : undefined,
      estimated: true,
    };
  }

  /**
   * 关键词估算钠含量（mg/100g），用于 LLM/食物库都未命中时的安全兜底。
   */
  private estimateSodiumByKeywords(
    foodName: string,
    category: string,
  ): number | null {
    const name = foodName.toLowerCase();

    // 高钠词：腌制/咸制/酱菜
    if (/(咸鱼|泡菜|榨菜|腌|腊|酱菜|咸菜|火腿|培根|午餐肉|腌制)/.test(name)) {
      return 1800;
    }

    // 中高钠词：火锅底料/麻辣烫/卤味
    if (/(麻辣烫|卤|火锅|汤底|方便面|拉面|调味包)/.test(name)) {
      return 1200;
    }

    // 低钠默认值按类别给一个保守估计
    if (category === 'protein') return 90;
    if (category === 'veggie') return 45;
    if (category === 'grain') return 20;
    if (category === 'beverage') return 35;

    return null;
  }

  /**
   * P9: 零热量饮品旁路 — 食物库缺少"白开水/纯净水/凉白开/矿泉水/无糖茶"等条目时，
   * LLM 容易给水类胡乱估热量（曾出现 500g/900kcal）。
   * 这里在进入 LLM fallback 前命中关键词，直接合成一个 0kcal beverage 条目。
   *
   * 命中规则（保守）：
   * - 名称含"水"且不含会污染语义的字（汤/果/糖/盐/调/咸/油 等） → 视为白水
   * - 名称含"凉白开/温开水/沸水/苏打水(无糖)" 也算
   * 不命中场景（继续走 LLM）：可乐、椰子水、橙汁、汤、糖水、咖啡、奶茶
   */
  private tryZeroCaloriePassthrough(
    foodName: string,
    quantity?: string,
  ): ParsedFoodItem | null {
    if (!foodName) return null;
    const name = foodName.trim();
    if (!name) return null;

    // 形如"水煮虾/水果/水饺/糖水/汤水"等需排除
    const exclude =
      /(水果|水饺|水煮|水蒸|汤|糖水|盐水|调味|咸|油|虾|鱼|果汁|椰|柠|蜜|味|奶|咖啡|可乐|雪碧|果)/;
    if (exclude.test(name)) return null;

    const isPlainWater =
      /^(白开水|纯净水|矿泉水|凉白开|温开水|沸水|开水|清水|白水|冰水)$/.test(
        name,
      ) ||
      /^水$/.test(name) ||
      /^苏打水$/.test(name);

    if (!isPlainWater) return null;

    // 估算克数：从 quantity 解析"500ml/一杯/一瓶"，否则默认 250g
    let grams = 250;
    if (quantity) {
      const ml = quantity.match(/(\d+(?:\.\d+)?)\s*(ml|毫升)/i);
      const l = quantity.match(/(\d+(?:\.\d+)?)\s*(l|升)/i);
      if (ml)
        grams = Math.round(parseFloat(ml[1])); // 1ml ≈ 1g
      else if (l) grams = Math.round(parseFloat(l[1]) * 1000);
      else if (/瓶|大瓶/.test(quantity)) grams = 500;
      else if (/杯/.test(quantity)) grams = 250;
    }

    return {
      name,
      normalizedName: name,
      quantity,
      estimatedWeightGrams: grams,
      category: 'beverage',
      confidence: 0.95,
      calories: 0,
      protein: 0,
      fat: 0,
      carbs: 0,
      fiber: 0,
      sugar: 0,
      sodium: 0,
    } as ParsedFoodItem;
  }

  /**
   * P3 修复: 判定输入是否明显不是食物（用于跳过启发式兜底）
   * - 含明确食物字根（米/饭/面/菜/肉/果/奶/茶/酒…）→ 不算非食物
   * - 命中黑名单（空气/东西/一大堆/随便/不知道 等）→ 算非食物
   * - 命中后下游会跳过 fallback，触发 BadRequestException("decision.error.noFood")
   */
  private isLikelyNonFood(foodName: string): boolean {
    if (!foodName) return true;
    const name = foodName.trim().toLowerCase();
    if (name.length === 0) return true;

    // 含明确食物字根 → 不是非食物
    if (
      /(米|饭|面|粉|粥|菜|肉|鱼|虾|蛋|奶|茶|酒|果|汁|汤|包|饼|糕|油|盐|糖|豆|薯|条|包子|馒头|烧烤|沙拉|寿司|披萨|汉堡|鸡|鸭|猪|牛|羊|海鲜|水果|坚果|零食|主食|蔬菜|饮料|咖啡|可乐|巧克力)/.test(
        name,
      )
    ) {
      return false;
    }

    // 黑名单：通用代词、非食物名词
    const NON_FOOD_PATTERNS: RegExp[] = [
      /^空气$/,
      /^水分$/,
      /^石头$/,
      /^沙子$/,
      /^塑料$/,
      /^一大堆$/,
      /^一大盆$/,
      /^一些东西$/,
      /^点东西$/,
      /^东西$/,
      /^食物$/,
      /^饭菜$/,
      /^没吃$/,
      /^啥都没$/,
      /^啥都行$/,
      /^随便$/,
      /^不知道$/,
    ];
    if (NON_FOOD_PATTERNS.some((re) => re.test(name))) return true;

    // 仅量词/代词构成
    if (
      name.length <= 4 &&
      /^(一|二|两|三|四|五|六|七|八|九|十|半|小|大|几|很多|许多|一些|这|那|啥|什么|某)+(份|碗|杯|盘|个|块|片|根|条|勺|把|点|些)?$/.test(
        name,
      )
    ) {
      return true;
    }

    return false;
  }

  /**
   * 基于关键词推测食物类别
   *
   * 顺序敏感：复合主食（盖饭/套餐/炒饭）必须早于单一蛋白和单一谷物匹配，
   * 否则"猪脚饭"会被 /(猪|牛|羊...)/ 命中归为 protein，导致默认 100g/165kcal
   * 严重低估真实摄入（一份盖饭通常 350g+）。
   */
  private inferCategoryByKeywords(foodName: string): string {
    const name = foodName.toLowerCase();

    // 米饭/盖饭类复合菜：饭 + 主菜（猪脚饭、黄焖鸡米饭、鱼香肉丝盖饭、卤肉饭、咖喱饭…）
    // 以及套餐、炒饭、焖饭、烩饭、拌饭、煲仔饭等
    if (
      /(盖饭|盖浇饭|盖浇|套餐|炒饭|焖饭|烩饭|拌饭|煲仔饭|卤肉饭|咖喱饭|烧饭|烤饭|手抓饭)/.test(
        name,
      ) ||
      /(.+饭$)/.test(name)
    ) {
      return 'composite';
    }

    // 面食类复合主食（牛肉面、炸酱面、拉面套餐、麻辣烫…）
    if (
      /(牛肉面|炸酱面|拉面|担担面|刀削面|过桥米线|麻辣烫|盖浇面|捞面|炒面|烩面|汤面|米线|河粉)/.test(
        name,
      )
    ) {
      return 'composite';
    }

    if (/(牛奶|酸奶|奶酪|芝士|乳)/.test(name)) return 'dairy';
    if (/(鸡蛋|鸭蛋|鹅蛋|蛋白|蛋黄)/.test(name)) return 'protein';
    if (/(鸡|牛|羊|猪|鱼|虾|蟹|贝|豆腐|豆干|豆制品|蛋白)/.test(name))
      return 'protein';
    if (/(米|饭|面|粉|粥|馒头|包子|面包|麦片|燕麦|玉米|土豆|红薯)/.test(name))
      return 'grain';
    if (/(菜|西兰花|菠菜|生菜|黄瓜|番茄|胡萝卜|青椒|蘑菇)/.test(name))
      return 'veggie';
    if (/(苹果|香蕉|橙|柚|葡萄|草莓|蓝莓|猕猴桃|水果)/.test(name))
      return 'fruit';
    if (/(可乐|雪碧|果汁|咖啡|茶|饮料|奶茶|豆浆)/.test(name)) return 'beverage';
    if (/(薯片|饼干|蛋糕|巧克力|糖|零食|坚果)/.test(name)) return 'snack';
    if (/(油|黄油|奶油|猪油|橄榄油)/.test(name)) return 'fat';

    return 'composite';
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
      };
    } catch {
      this.logger.warn(
        `LLM response parse failed: ${content.substring(0, 200)}`,
      );
      return { foods: [] };
    }
  }

  // ==================== V2.1: Steps 4-10 已迁移至 AnalysisPipelineService ====================

  // ==================== 工具方法 ====================

  /**
   * ParsedFoodItem → AnalyzedFoodItem（统一输出格式）
   *
   * 数据契约：输出的 AnalyzedFoodItem 上所有营养字段均为 per-serving（实际摄入量）。
   *
   * food.calories/protein/fat/carbs/fiber/sodium/saturatedFat/addedSugar 等
   * 在上游（buildFromLibraryMatch、llmParseFoods fallback、buildHeuristicFallbackFood）
   * 已完成 per-serving 换算，此处直接透传；
   * 而 lib?.* 优先取值的扩展营养字段（transFat、cholesterol、omega3、omega6、
   * solubleFiber、vitaminD、potassium、zinc、sugar 等）来自 food_library 的 per-100g 原始值，
   * 此处需按 ratio = estimatedWeightGrams/100 缩放。
   *
   * 不缩放的字段：GI/GL（食物固有属性）、qualityScore/satietyScore/processingLevel
   * （评分类，与重量无关）、nutrientDensity（密度本身已是单位归一）、fodmapLevel/oxalateLevel/purine（定性）。
   */
  private toAnalyzedFoodItem(food: ParsedFoodItem): AnalyzedFoodItem {
    // 食物库命中时，allergens 优先用库字段（结构化、人工核验）
    const allergens: string[] | undefined = food.libraryMatch?.allergens?.length
      ? (food.libraryMatch.allergens as string[])
      : food.allergens?.length
        ? food.allergens
        : undefined;

    // V4.6: 食物库命中时优先用库值（库值为 per-100g，需按 ratio 缩放）
    const lib = food.libraryMatch;
    const grams = food.estimatedWeightGrams || food.standardServingG || 100;
    const ratio = grams / 100;

    /** 缩放可空数值（保留 1 位小数） */
    const scale1 = (
      libVal: unknown,
      foodVal: number | null | undefined,
    ): number | undefined => {
      if (libVal != null) return Math.round(Number(libVal) * ratio * 10) / 10;
      return foodVal ?? undefined;
    };
    /** 缩放可空数值（整数） */
    const scale0 = (
      libVal: unknown,
      foodVal: number | null | undefined,
    ): number | undefined => {
      if (libVal != null) return Math.round(Number(libVal) * ratio);
      return foodVal ?? undefined;
    };

    const qualityScore =
      lib?.qualityScore != null
        ? Number(lib.qualityScore)
        : (food.qualityScore ?? undefined);
    const satietyScore =
      lib?.satietyScore != null
        ? Number(lib.satietyScore)
        : (food.satietyScore ?? undefined);
    const processingLevel =
      lib?.processingLevel != null
        ? Number(lib.processingLevel)
        : (food.processingLevel ?? undefined);
    const sugar = scale1(lib?.sugar, food.sugar);

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
      // 扩展营养维度
      saturatedFat: food.saturatedFat,
      addedSugar: food.addedSugar,
      vitaminA: food.vitaminA,
      vitaminC: food.vitaminC,
      calcium: food.calcium,
      iron: food.iron,
      estimated: food.estimated,
      allergens,
      tags: food.tags?.length ? food.tags : undefined,
      glycemicIndex: food.glycemicIndex,
      // V4.6: 决策辅助字段（与重量无关，不缩放）
      qualityScore,
      satietyScore,
      processingLevel,
      sugar,
      // V4.6: 库优先字段（库值 per-100g → per-serving 缩放）
      nameEn: food.nameEn ?? undefined,
      standardServingDesc: food.standardServingDesc ?? undefined,
      transFat: scale1(lib?.transFat, food.transFat),
      cholesterol: scale0(lib?.cholesterol, food.cholesterol),
      omega3: scale0(lib?.omega3, food.omega3),
      omega6: scale0(lib?.omega6, food.omega6),
      solubleFiber: scale1(lib?.solubleFiber, food.solubleFiber),
      vitaminD: scale1(lib?.vitaminD, food.vitaminD),
      potassium: scale0(lib?.potassium, food.potassium),
      zinc: scale1(lib?.zinc, food.zinc),
      // GL/nutrientDensity 与重量无关，沿用原值
      glycemicLoad:
        lib?.glycemicLoad != null
          ? Number(lib.glycemicLoad)
          : (food.glycemicLoad ?? undefined),
      nutrientDensity:
        lib?.nutrientDensity != null
          ? Number(lib.nutrientDensity)
          : (food.nutrientDensity ?? undefined),
      fodmapLevel: lib?.fodmapLevel ?? food.fodmapLevel ?? undefined,
      oxalateLevel: lib?.oxalateLevel ?? food.oxalateLevel ?? undefined,
      purine: lib?.purine ?? food.purine ?? undefined,
      cookingMethods: food.cookingMethods ?? undefined,
      ingredientList: food.ingredientList ?? undefined,
    };
  }
}
