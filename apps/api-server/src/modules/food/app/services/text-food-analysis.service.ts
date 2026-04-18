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
import { validateAndCorrectFoods } from '../../../decision/analyze/nutrition-sanity-validator';
import { UserContextBuilderService } from '../../../decision/decision/user-context-builder.service';

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
 * 文本分析 LLM Prompt（基础版，无用户上下文时使用）
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
      "sodium": 数字（毫克），
      "saturatedFat": 数字（克）或null,
      "addedSugar": 数字（克）或null,
      "vitaminA": 数字（微克RAE）或null,
      "vitaminC": 数字（毫克）或null,
      "calcium": 数字（毫克）或null,
      "iron": 数字（毫克）或null,
      "estimated": true或false
    }
  ],
  "summary": "一句话总结这顿饭的特点",
  "alternatives": [
    { "name": "替代食物名", "reason": "推荐理由（不超过15字）" }
  ]
}

规则：
- 必须返回（6维）：calories、protein、fat、carbs、fiber、sodium
- 尽量返回（6维）：saturatedFat、addedSugar、vitaminA、vitaminC、calcium、iron
- 如果微量营养素（saturatedFat/addedSugar/vitaminA/vitaminC/calcium/iron）不确定，返回 null 并设 estimated: true
- 热量和营养素估算保守（宁少不多）
- 每种食物单独列出，不要合并
- 组合食物（如牛肉面）拆解为主要组成（面条、牛肉、汤底等）
- category 使用英文编码: protein/grain/veggie/fruit/dairy/fat/beverage/snack/composite
- 替代方案不超过 3 个，每条不超过 15 字
- 如果描述不是食物，返回空 foods 数组`;

/**
 * V3.4 P1.3: 构建用户上下文感知的文本分析 Prompt
 *
 * 在通用 TEXT_ANALYSIS_PROMPT 基础上注入：
 * - 用户目标类型和营养优先级
 * - 健康条件特异性估算指令
 * - 决策导向的重点（决定 summary 和 alternatives 方向）
 */
function buildContextAwareTextPrompt(params: {
  goalType: string;
  nutritionPriority: string[];
  healthConditions: string[];
  budgetStatus: string;
  remainingCalories: number;
  remainingProtein: number;
}): string {
  const contextLines: string[] = [
    '\n\n【用户目标上下文 — 影响你的营养估算精度和替代方案方向】',
  ];

  const goalLabels: Record<string, string> = {
    fat_loss: '减脂',
    muscle_gain: '增肌',
    health: '均衡健康',
    habit: '改善饮食习惯',
  };
  contextLines.push(`- 目标：${goalLabels[params.goalType] || '健康'}`);

  if (params.budgetStatus === 'over_limit') {
    contextLines.push(`- 今日热量已超标，calories 估算需要特别精确`);
  } else if (params.remainingCalories > 0) {
    contextLines.push(`- 今日剩余热量预算约 ${params.remainingCalories} kcal`);
  }

  if (params.nutritionPriority.includes('protein_gap')) {
    contextLines.push(
      `- 今日蛋白质不足，protein 字段估算要尽量准确，替代方案优先推荐高蛋白食物`,
    );
  }
  if (params.nutritionPriority.includes('fat_excess')) {
    contextLines.push(
      `- 今日脂肪已超标，fat 和 saturatedFat 字段要认真估算，替代方案推荐低脂选择`,
    );
  }
  if (params.nutritionPriority.includes('carb_excess')) {
    contextLines.push(
      `- 今日碳水已超标，carbs 估算要精确，替代方案推荐低碳水食物`,
    );
  }

  // 健康条件特异性估算指令
  if (params.healthConditions.includes('diabetes')) {
    contextLines.push(
      `- 用户有糖尿病：carbs 和 addedSugar 必须精确估算，升糖风险高的食物在 summary 中标注`,
    );
  }
  if (params.healthConditions.includes('hypertension')) {
    contextLines.push(
      `- 用户有高血压：sodium 必须认真估算（不要填 null），腌制/重口食物的钠含量要估高而非低`,
    );
  }
  if (
    params.healthConditions.includes('heart_disease') ||
    params.healthConditions.includes('cardiovascular')
  ) {
    contextLines.push(
      `- 用户有心脏病：saturatedFat 必须认真估算，油炸/肥肉/全脂乳制品的饱和脂肪要估准`,
    );
  }

  return TEXT_ANALYSIS_PROMPT + contextLines.join('\n');
}

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
  /** V6.3 P1-11: 饱和脂肪（克） */
  saturatedFat?: number | null;
  /** V6.3 P1-11: 添加糖（克） */
  addedSugar?: number | null;
  /** V6.3 P1-11: 维生素A（μg RAE） */
  vitaminA?: number | null;
  /** V6.3 P1-11: 维生素C（mg） */
  vitaminC?: number | null;
  /** V6.3 P1-11: 钙（mg） */
  calcium?: number | null;
  /** V6.3 P1-11: 铁（mg） */
  iron?: number | null;
  /** V6.3 P1-11: 是否为 AI 估算值 */
  estimated?: boolean;
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
    /** V6.3 P1-11: 扩展营养维度 (6 → 12) */
    saturatedFat?: number | null;
    addedSugar?: number | null;
    vitaminA?: number | null;
    vitaminC?: number | null;
    calcium?: number | null;
    iron?: number | null;
    estimated?: boolean;
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
    const scoringFoods: ScoringFoodItem[] = parsedFoods.map((f) => ({
      name: f.name,
      confidence: f.confidence,
      calories: f.calories,
      protein: f.protein,
      fat: f.fat,
      carbs: f.carbs,
      fiber: f.fiber,
      sodium: f.sodium,
      saturatedFat: f.saturatedFat,
      addedSugar: f.addedSugar,
      estimatedWeightGrams: f.estimatedWeightGrams,
      libraryMatch: f.libraryMatch,
    }));

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

    // 3a. 逐个词条尝试精确/模糊匹配标准食物库
    for (const term of foodTerms) {
      const { quantity, foodName } = this.extractQuantity(term);
      const matchResult = await this.matchFoodLibrary(foodName);

      if (matchResult) {
        const { match, simScore } = matchResult;
        const servingGrams = this.resolveServingGrams(quantity, match);
        const parsed = this.buildFromLibraryMatch(
          match,
          quantity,
          servingGrams,
        );
        // V1.1 P1-2: 动态置信度 — 基于 sim_score 而非固定 0.95
        parsed.confidence = simScore >= 1.0 ? 0.95 : 0.6 + simScore * 0.3;
        results.push(parsed);
      } else {
        unmatchedTerms.push({ term, quantity, foodName });
      }
    }

    // 3b. 未命中的词条走 LLM 拆解
    if (unmatchedTerms.length > 0) {
      const llmResults = await this.llmParseFoods(
        unmatchedTerms.map((t) => t.term).join(', '),
        originalText,
        userCtx,
      );
      results.push(...llmResults);

      // 若仍有缺失，再对完整原文进行一次全量解析，降低输入格式约束
      const expectedCount = Math.max(
        foodTerms.length,
        this.estimateExpectedFoodCount(originalText),
      );
      if (results.length < expectedCount) {
        const llmFullTextResults = await this.llmParseFoods(
          originalText,
          originalText,
          userCtx,
        );
        results.push(...llmFullTextResults);
      }

      // 仍未覆盖的词条使用启发式保底，避免直接丢失食物
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

    const merged = this.mergeParsedFoods(results);

    // 3c. 如果全部为空（匹配失败 + LLM 也无结果），返回降级结果
    if (merged.length === 0) {
      this.logger.warn(`文本分析无法识别任何食物: "${originalText}"`);
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
    if (!quantity) {
      return food.standardServingG || DEFAULT_SERVING_GRAMS;
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

    return food.standardServingG || DEFAULT_SERVING_GRAMS;
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
      // V1.2: 从标准库提取扩展营养字段
      saturatedFat:
        food.saturatedFat != null
          ? Math.round(Number(food.saturatedFat) * ratio * 10) / 10
          : undefined,
      addedSugar:
        food.addedSugar != null
          ? Math.round(Number(food.addedSugar) * ratio * 10) / 10
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
  ): Promise<ParsedFoodItem[]> {
    if (!this.apiKey) {
      this.logger.warn('LLM API 未配置，跳过 LLM 解析');
      return [];
    }

    try {
      // V3.4 P1.3: 根据用户上下文选择 system prompt
      const systemPrompt = userCtx
        ? buildContextAwareTextPrompt({
            goalType: userCtx.goalType || 'health',
            nutritionPriority: userCtx.nutritionPriority || [],
            healthConditions: userCtx.healthConditions || [],
            budgetStatus: userCtx.budgetStatus || 'under_target',
            remainingCalories: userCtx.remainingCalories ?? 2000,
            remainingProtein: userCtx.remainingProtein ?? 65,
          })
        : TEXT_ANALYSIS_PROMPT;

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

      const resolved: ParsedFoodItem[] = [];
      for (const f of parsed.foods) {
        const llmName = this.normalizeFoodTerm(f.name || '');
        if (!llmName) continue;

        const libraryMatch = await this.matchFoodLibrary(llmName);
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
          name: llmName,
          normalizedName: llmName,
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
          // V6.3 P1-11: 扩展营养维度 — null 表示 LLM 无法确定
          saturatedFat: f.saturatedFat ?? null,
          addedSugar: f.addedSugar ?? null,
          vitaminA: f.vitaminA ?? null,
          vitaminC: f.vitaminC ?? null,
          calcium: f.calcium ?? null,
          iron: f.iron ?? null,
          estimated: f.estimated,
        });
      }

      // V3.6 P1.2: 校验并纠偏 LLM 估算的营养数据（热力学一致性）
      return validateAndCorrectFoods(resolved);
    } catch (err) {
      this.logger.warn(`LLM 文本解析失败: ${(err as Error).message}`);
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
        alternatives: Array.isArray(parsed.alternatives)
          ? parsed.alternatives
          : [],
      };
    } catch {
      this.logger.warn(`LLM 返回解析失败: ${content.substring(0, 200)}`);
      return { foods: [], alternatives: [] };
    }
  }

  // ==================== V2.1: Steps 4-10 已迁移至 AnalysisPipelineService ====================

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
      // V6.3 P1-11: 扩展营养维度
      saturatedFat: food.saturatedFat,
      addedSugar: food.addedSugar,
      vitaminA: food.vitaminA,
      vitaminC: food.vitaminC,
      calcium: food.calcium,
      iron: food.iron,
      estimated: food.estimated,
    };
  }
}
