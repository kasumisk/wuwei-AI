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
import { validateAndCorrectFoods, NutritionInput } from '../../../decision/analyze/nutrition-sanity-validator';
import { UserContextBuilderService } from '../../../decision/analyze/user-context-builder.service';
import { buildBasePrompt, buildUserContextPrompt, getUserMessage } from './analysis-prompt-schema';

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
 * - composite: 复合菜肴（如炒菜、炖汤）约 200g
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
  composite: 200,
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

// ==================== LLM Prompt ====================

/**
 * V5.0: 文本分析 prompt 使用统一 buildBasePrompt + buildUserContextPrompt
 */

function buildContextAwareTextPrompt(
  params: {
    goalType: string;
    nutritionPriority: string[];
    healthConditions: string[];
    budgetStatus: string;
    remainingCalories: number;
    remainingProtein: number;
  },
  locale: Locale = 'zh-CN',
): string {
  return (
    buildBasePrompt(undefined, locale) + buildUserContextPrompt({ ...params, locale })
  );
}

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
    );

    // V2.1: Steps 4-13 委托给统一分析管道
    // V4.9: scoringFoods 需要 per-serving 值（从 per-100g 换算）
    const scoringFoods: ScoringFoodItem[] = parsedFoods.map((f) => {
      const grams = f.estimatedWeightGrams || f.standardServingG || 100;
      const factor = grams / 100;
      return {
        name: f.name,
        confidence: f.confidence,
        calories: (f.calories || 0) * factor,
        protein: (f.protein || 0) * factor,
        fat: (f.fat || 0) * factor,
        carbs: (f.carbs || 0) * factor,
        fiber: f.fiber != null ? (f.fiber || 0) * factor : undefined,
        sodium: f.sodium != null ? (f.sodium || 0) * factor : undefined,
        saturatedFat:
          f.saturatedFat != null
            ? (Number(f.saturatedFat) || 0) * factor
            : undefined,
        addedSugar:
          f.addedSugar != null
            ? (Number(f.addedSugar) || 0) * factor
            : undefined,
        estimatedWeightGrams: grams,
        // V4.7: 补全 V4.6 新增字段（此前缺失导致评分链路健康调整失效）
        transFat:
          f.transFat != null
            ? (Number(f.transFat) || 0) * factor
            : undefined,
        cholesterol:
          f.cholesterol != null
            ? (Number(f.cholesterol) || 0) * factor
            : undefined,
        glycemicLoad: f.glycemicLoad,
        nutrientDensity: f.nutrientDensity,
        fodmapLevel: f.fodmapLevel as ScoringFoodItem['fodmapLevel'],
        purine: f.purine as ScoringFoodItem['purine'],
        oxalateLevel: f.oxalateLevel as ScoringFoodItem['oxalateLevel'],
        libraryMatch: f.libraryMatch,
      };
    });

    return this.analysisPipeline.execute({
      inputType: 'text',
      rawText: text,
      mealType,
      userId,
      locale,
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
        parsed.confidence = simScore >= 1.0 ? 0.95 : 0.6 + simScore * 0.3;
        results.push(parsed);
      } else {
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
      this.logger.warn(`Text analysis could not identify any food: "${originalText}"`);
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
    const chinesePattern =
      /^(一|二|两|三|四|五|六|七|八|九|十|半|小|大|几)?(份|碗|杯|盘|个|块|片|根|条|勺|把)/;
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

    // 匹配后缀中文数量（如 牛奶一杯）
    const suffixChinesePattern =
      /^(.*?)(一|二|两|三|四|五|六|七|八|九|十|半|小|大|几)?(份|碗|杯|盘|个|块|片|根|条|勺|把)$/;
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
          const aliasMatched =
            !!candidate.aliases &&
            candidate.aliases
              .split(',')
              .map((a: string) => a.trim())
              .includes(query);
          const includeMatched =
            !hasCompositeDelimiter &&
            (name.includes(query) || query.includes(name));
          const accepted = simScore >= 0.3 || aliasMatched || includeMatched;

          if (!accepted) continue;

          const normalizedScore = Math.max(
            simScore,
            includeMatched || aliasMatched ? 0.3 : 0,
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
  ): Promise<ParsedFoodItem[]> {
    if (!this.apiKey) {
      this.logger.warn('LLM API not configured, skipping LLM parsing');
      return [];
    }

    try {
      // V3.4 P1.3: 根据用户上下文选择 system prompt
      const systemPrompt = userCtx
        ? buildContextAwareTextPrompt(
            {
              goalType: userCtx.goalType || 'health',
              nutritionPriority: userCtx.nutritionPriority || [],
              healthConditions: userCtx.healthConditions || [],
              budgetStatus: userCtx.budgetStatus || 'under_target',
              remainingCalories: userCtx.remainingCalories ?? 2000,
              remainingProtein: userCtx.remainingProtein ?? 65,
            },
            locale,
          )
        : buildBasePrompt(undefined, locale);

      this.logger.log(
        `[LLM] Text parsing call | input: "${unmatchedText.slice(0, 80)}"`,
      );

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
              content: getUserMessage('text', unmatchedText, locale),
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

        resolved.push({
          name: f.llmName,
          normalizedName: f.llmName,
          nameEn: f.nameEn ?? undefined,
          quantity: f.quantity,
          estimatedWeightGrams: f.estimatedWeightGrams || DEFAULT_SERVING_GRAMS,
          category: f.category,
          confidence: 0.7,
          calories: f.calories || 0,
          protein: f.protein || 0,
          fat: f.fat || 0,
          carbs: f.carbs || 0,
          fiber: f.fiber,
          sodium: f.sodium,
          saturatedFat: f.saturatedFat ?? null,
          transFat: f.transFat ?? null,
          addedSugar: f.addedSugar ?? null,
          cholesterol: f.cholesterol ?? null,
          omega3: f.omega3 ?? null,
          omega6: f.omega6 ?? null,
          solubleFiber: f.solubleFiber ?? null,
          vitaminA: f.vitaminA ?? null,
          vitaminC: f.vitaminC ?? null,
          vitaminD: f.vitaminD ?? null,
          calcium: f.calcium ?? null,
          iron: f.iron ?? null,
          potassium: f.potassium ?? null,
          zinc: f.zinc ?? null,
          estimated: f.estimated,
          allergens: Array.isArray(f.allergens) ? f.allergens : undefined,
          tags: Array.isArray(f.tags) ? f.tags : undefined,
          // V4.6: 统一字段名
          qualityScore: f.qualityScore ?? undefined,
          satietyScore: f.satietyScore ?? undefined,
          processingLevel: f.processingLevel ?? undefined,
          sugar: f.sugar ?? undefined,
          standardServingG: f.standardServingG ?? undefined,
          standardServingDesc: f.standardServingDesc ?? undefined,
          glycemicIndex: f.glycemicIndex ?? undefined,
          glycemicLoad: f.glycemicLoad ?? undefined,
          nutrientDensity: f.nutrientDensity ?? undefined,
          fodmapLevel: (f.fodmapLevel ?? undefined) as AnalyzedFoodItem['fodmapLevel'],
          oxalateLevel: (f.oxalateLevel ?? undefined) as AnalyzedFoodItem['oxalateLevel'],
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
   * 基于关键词推测食物类别
   */
  private inferCategoryByKeywords(foodName: string): string {
    const name = foodName.toLowerCase();

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
      this.logger.warn(`LLM response parse failed: ${content.substring(0, 200)}`);
      return { foods: [] };
    }
  }

  // ==================== V2.1: Steps 4-10 已迁移至 AnalysisPipelineService ====================

  // ==================== 工具方法 ====================

  /**
   * ParsedFoodItem → AnalyzedFoodItem（统一输出格式）
   */
  private toAnalyzedFoodItem(food: ParsedFoodItem): AnalyzedFoodItem {
    // 食物库命中时，allergens 优先用库字段（结构化、人工核验）
    const allergens: string[] | undefined = food.libraryMatch?.allergens?.length
      ? (food.libraryMatch.allergens as string[])
      : food.allergens?.length
        ? food.allergens
        : undefined;

    // V4.6: 食物库命中时优先用库值
    const lib = food.libraryMatch;
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
    const sugar =
      lib?.sugar != null ? Number(lib.sugar) : (food.sugar ?? undefined);

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
      // V4.6: 决策辅助字段
      qualityScore,
      satietyScore,
      processingLevel,
      sugar,
      // V4.6: 新增字段（食物库优先，LLM 补位）
      nameEn: food.nameEn ?? undefined,
      standardServingDesc: food.standardServingDesc ?? undefined,
      transFat:
        lib?.transFat != null
          ? Number(lib.transFat)
          : (food.transFat ?? undefined),
      cholesterol:
        lib?.cholesterol != null
          ? Number(lib.cholesterol)
          : (food.cholesterol ?? undefined),
      omega3:
        lib?.omega3 != null ? Number(lib.omega3) : (food.omega3 ?? undefined),
      omega6:
        lib?.omega6 != null ? Number(lib.omega6) : (food.omega6 ?? undefined),
      solubleFiber:
        lib?.solubleFiber != null
          ? Number(lib.solubleFiber)
          : (food.solubleFiber ?? undefined),
      vitaminD:
        lib?.vitaminD != null
          ? Number(lib.vitaminD)
          : (food.vitaminD ?? undefined),
      potassium:
        lib?.potassium != null
          ? Number(lib.potassium)
          : (food.potassium ?? undefined),
      zinc: lib?.zinc != null ? Number(lib.zinc) : (food.zinc ?? undefined),
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
