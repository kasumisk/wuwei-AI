/**
 * V6.1 Phase 2.3 — 图片食物分析服务
 *
 * 从 AnalyzeService 中拆分出的核心图片分析逻辑。
 * 负责: 图片识别 → 多食物拆解 → 营养估算 → 目标导向决策 → 组装统一结果结构。
 *
 * 职责边界:
 * - AnalyzeService: 队列管理 + 缓存 + 异步调度（不变）
 * - ImageFoodAnalysisService: AI 调用 + 数据加工 + 结果组装（本服务）
 *
 * 输出:
 * - 旧格式 AnalysisResult（向后兼容，供 AnalyzeService 缓存）
 * - 新格式 FoodAnalysisResultV61（统一结构，供订阅裁剪 + 入库管道）
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { BehaviorService } from '../../../diet/app/services/behavior.service';
import { UserContextBuilderService } from '../../../decision/decision/user-context-builder.service';
import {
  FoodAnalysisResultV61,
  AnalyzedFoodItem,
} from '../../../decision/types/analysis-result.types';
import { AnalysisResult } from './analyze.service';
import { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import { FoodScoringService } from '../../../decision/score/food-scoring.service';
import { buildTonePrompt } from '../../../coach/app/config/coach-tone.config';
import { AnalysisPipelineService } from '../../../decision/analyze/analysis-pipeline.service';
import { AnalysisPersistenceService } from '../../../decision/analyze/analysis-persistence.service';

// ==================== Prompt 常量（从 analyze.service.ts 迁移） ====================

// V2.0: PERSONA_PROMPTS 已移除，统一使用 coach-tone.config.ts 的 buildTonePrompt()

const BASE_PROMPT = `你是专业饮食教练，风格：朋友式、简洁、可执行。
你的目标不是提供营养知识，而是帮助用户做"吃或不吃"的决策。

用户上传了一张外卖或餐食图片。请识别图中所有菜品，估算多维营养数据，并做出决策判断。

以 JSON 格式返回（不要输出任何其他文字，只输出纯 JSON）：
{
  "foods": [
    {
      "name": "菜名",
      "calories": 数字,
      "protein": 数字,
      "fat": 数字,
      "carbs": 数字,
      "fiber": 数字或null,
      "sodium": 数字或null,
      "saturatedFat": 数字或null,
      "addedSugar": 数字或null,
      "vitaminA": 数字或null,
      "vitaminC": 数字或null,
      "calcium": 数字或null,
      "iron": 数字或null,
      "quantity": "份量描述",
      "category": "分类",
      "quality": 数字1到10,
      "satiety": 数字1到10,
      "confidence": 0到1之间的数字表示识别置信度,
      "estimated": true或false
    }
  ],
  "totalCalories": 总热量数字,
  "totalProtein": 总蛋白质克数,
  "totalFat": 总脂肪克数,
  "totalCarbs": 总碳水克数,
  "avgQuality": 所有食物质量分均值(保留1位小数),
  "avgSatiety": 所有食物饱腹感均值(保留1位小数),
  "mealType": "breakfast|lunch|dinner|snack",
  "decision": "SAFE|OK|LIMIT|AVOID",
  "riskLevel": "🟢|🟡|🟠|🔴",
  "reason": "一句话原因，不超过20字",
  "suggestion": "具体可执行建议，不超过25字",
  "insteadOptions": ["替代方案1", "替代方案2", "替代方案3"],
  "compensation": {
    "diet": "饮食补救，一句话",
    "activity": "运动补救，一句话",
    "nextMeal": "下一餐建议，一句话"
  },
  "contextComment": "基于今日多维营养状态的点评，一句话",
  "encouragement": "积极鼓励语，一句话",
  "advice": "综合营养建议，不超过30字",
  "isHealthy": true或false
}

营养估算规则：
- 必须返回（4维）：calories(kcal)、protein(g)、fat(g)、carbs(g)，精确到整数
- 尽量返回（8维）：fiber(g)、sodium(mg)、saturatedFat(g)、addedSugar(g)、vitaminA(μg RAE)、vitaminC(mg)、calcium(mg)、iron(mg)
- 如果微量营养素不确定，返回 null 并设 estimated: true
- confidence 表示你对该食物识别的把握程度：
  - 0.9-1.0: 非常确定（清晰可见的常见食物）
  - 0.7-0.89: 比较确定（可辨识但有遮挡或角度问题）
  - 0.5-0.69: 不太确定（模糊或不常见食物）
  - 0.3-0.49: 猜测（严重遮挡或看不清）
- quality（食物质量）评分标准：
  - 9-10: 天然未加工（水煮蛋、三文鱼、西兰花）
  - 7-8: 轻加工（烤鸡胸、糙米、无糖酸奶）
  - 5-6: 中度加工（白米饭、炒菜少油）
  - 3-4: 深度加工（炸鸡、红烧肉、蛋糕）
  - 1-2: 超加工（薯片、碳酸饮料、方便面）
- satiety（饱腹感）评分标准：
  - 9-10: 高蛋白+高纤维+大体积（鸡胸+蔬菜、燕麦粥）
  - 7-8: 中等蛋白或纤维（米饭+肉菜）
  - 5-6: 一般（炒饭、面条）
  - 3-4: 低饱腹（甜品、白面包、果汁）
  - 1-2: 几乎无饱腹（碳酸饮料、糖果）

替代方案规则：
- 替代方案应补足当前缺失的维度（如蛋白不足→推荐高蛋白替代）
- 每条不超过15字

其他规则：
- category 只能是 主食/蔬菜/蛋白质/汤类/水果/饮品/零食
- 热量和营养素估算保守（宁少不多）
- 无法识别时，foods 返回空数组
- 像朋友一样说话`;

/** 目标差异化 Prompt 块 */
const GOAL_FOCUS_BLOCK: Record<string, string> = {
  fat_loss: `
【减脂用户特别指令 — 你最关注的是热量和蛋白质】
决策优先级：1.热量在剩余预算内？超出太多直接LIMIT/AVOID 2.蛋白质占比≥25%？不够在suggestion提醒 3.食物质量 4.饱腹感
语气：对高蛋白低热量热情肯定，对高碳水低蛋白直接指出。contextComment必须提到热量预算和蛋白质缺口。`,
  muscle_gain: `
【增肌用户特别指令 — 你最关注的是蛋白质和够不够吃】
决策优先级：1.蛋白质是否充足(本餐≥30g)？不够明确建议加量 2.热量足够？不够提醒"增肌得吃够" 3.碳水支撑训练 4.质量参考
语气：对大份高蛋白热情肯定，对吃太少温和提醒。不要因为热量高就判LIMIT。contextComment必须提到蛋白质进度。`,
  health: `
【健康均衡用户特别指令 — 你最关注的是食物质量和营养均衡】
决策优先级：1.食物是否天然少加工？quality<5要提醒 2.三大营养素比例均衡 3.热量大致合理(±20%可接受) 4.饱腹感
语气：对天然食物真诚肯定，对加工食品温和建议。热量不敏感。contextComment聚焦食物质量和搭配。`,
  habit: `
【改善习惯用户特别指令 — 你最关注的是食物质量和坚持记录】
决策优先级：1.记录本身值得肯定 2.食物质量和天然食物占比 3.饱腹感 4.热量不是重点
语气：全程正向为主，"记录就是最大的进步！"即使选择不太好也先肯定再建议。热量判断很宽松。`,
};

/** 目标上下文描述 */
const GOAL_CONTEXT: Record<string, { label: string; focus: string }> = {
  fat_loss: { label: '减脂', focus: '优先关注：热量不超标 + 蛋白质充足' },
  muscle_gain: {
    label: '增肌',
    focus: '优先关注：蛋白质是否充足 + 热量不能太低',
  },
  health: { label: '均衡健康', focus: '优先关注：食物质量和营养均衡' },
  habit: {
    label: '改善饮食习惯',
    focus: '优先关注：食物质量和饱腹感，鼓励坚持记录',
  },
};

// ==================== 辅助函数 ====================

/** 构建目标感知 Prompt */
function buildGoalAwarePrompt(goalType: string, userContext: string): string {
  const focusBlock = GOAL_FOCUS_BLOCK[goalType] || GOAL_FOCUS_BLOCK.health;
  return [BASE_PROMPT, focusBlock, userContext].join('\n\n');
}

/** 评分覆盖：AI decision 仅参考，引擎为准 */
function resolveDecision(
  aiDecision: string,
  engineDecision: string,
): 'SAFE' | 'OK' | 'LIMIT' | 'AVOID' {
  const rank: Record<string, number> = { SAFE: 0, OK: 1, LIMIT: 2, AVOID: 3 };
  const aiRank = rank[aiDecision] ?? 1;
  const engineRank = rank[engineDecision] ?? 1;
  const decisions: Array<'SAFE' | 'OK' | 'LIMIT' | 'AVOID'> = [
    'SAFE',
    'OK',
    'LIMIT',
    'AVOID',
  ];
  if (Math.abs(aiRank - engineRank) > 1) {
    return decisions[Math.max(aiRank, engineRank)];
  }
  return decisions[engineRank];
}

/** AI 容错：未返回营养数据时的粗估 */
function estimateNutrition(
  totalCalories: number,
  category?: string,
): {
  protein: number;
  fat: number;
  carbs: number;
  quality: number;
  satiety: number;
} {
  const CATEGORY_DEFAULTS: Record<
    string,
    { quality: number; satiety: number }
  > = {
    蛋白质: { quality: 7, satiety: 8 },
    蔬菜: { quality: 8, satiety: 6 },
    主食: { quality: 5, satiety: 6 },
    零食: { quality: 3, satiety: 3 },
    饮品: { quality: 4, satiety: 2 },
    水果: { quality: 7, satiety: 5 },
    汤类: { quality: 6, satiety: 5 },
  };
  const defaults = CATEGORY_DEFAULTS[category || ''] || {
    quality: 5,
    satiety: 5,
  };
  return {
    protein: Math.round((totalCalories * 0.15) / 4),
    fat: Math.round((totalCalories * 0.3) / 9),
    carbs: Math.round((totalCalories * 0.55) / 4),
    ...defaults,
  };
}

/** V6.1 三档决策映射 */
function mapToRecommendation(
  decision: string,
): 'recommend' | 'caution' | 'avoid' {
  switch (decision) {
    case 'SAFE':
      return 'recommend';
    case 'OK':
      return 'recommend';
    case 'LIMIT':
      return 'caution';
    case 'AVOID':
      return 'avoid';
    default:
      return 'caution';
  }
}

/** 风险等级映射 */
function mapRiskLevel(riskLevel: string): 'low' | 'medium' | 'high' {
  if (riskLevel.includes('🟢')) return 'low';
  if (riskLevel.includes('🟡') || riskLevel.includes('🟠')) return 'medium';
  if (riskLevel.includes('🔴')) return 'high';
  return 'low';
}

@Injectable()
export class ImageFoodAnalysisService {
  private readonly logger = new Logger(ImageFoodAnalysisService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly behaviorService: BehaviorService,
    // V1.6: 评分门面服务
    private readonly foodScoringService: FoodScoringService,
    // V1.9: 统一用户上下文构建
    private readonly userContextBuilder: UserContextBuilderService,
    // V2.1: 统一分析管道（替代手工编排 Steps 2-8）
    private readonly analysisPipeline: AnalysisPipelineService,
    // V2.1: 持久化服务（供 persistAnalysisRecord 使用）
    private readonly persistence: AnalysisPersistenceService,
  ) {
    this.apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      this.configService.get<string>('OPENAI_API_KEY') ||
      '';
    this.baseUrl =
      this.configService.get<string>('OPENROUTER_BASE_URL') ||
      'https://openrouter.ai/api/v1';
    this.model =
      this.configService.get<string>('VISION_MODEL') ||
      'baidu/ernie-4.5-vl-28b-a3b';
  }

  // ==================== 公共方法 ====================

  /**
   * 执行图片食物分析，返回旧格式（向后兼容 AnalyzeService.processAnalysis）
   */
  async executeAnalysis(
    imageUrl: string,
    mealType?: string,
    userId?: string,
  ): Promise<AnalysisResult> {
    const userHint = mealType ? `用户提示这是${mealType}。` : '';
    const {
      context: userContext,
      goalType,
      profile,
    } = await this.buildUserContext(userId);

    // 行为画像上下文
    let behaviorContext = '';
    if (userId) {
      behaviorContext = await this.behaviorService
        .getBehaviorContext(userId)
        .catch(() => '');
    }

    // AI 人格 (V2.0: 使用统一的 coach-tone.config)
    let personaPrompt = '';
    if (userId) {
      const behaviorProfile = await this.behaviorService
        .getProfile(userId)
        .catch(() => null);
      const style = behaviorProfile?.coachStyle || 'friendly';
      personaPrompt = buildTonePrompt(style, goalType);
    }

    const fullContext = [personaPrompt, userContext, behaviorContext]
      .filter(Boolean)
      .join('\n\n');
    const systemPrompt = buildGoalAwarePrompt(goalType, fullContext);

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
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `${userHint}请分析这张图片中的食物和热量。`,
                },
                {
                  type: 'image_url',
                  imageUrl: { url: imageUrl, detail: 'low' },
                },
              ],
            },
          ],
          max_tokens: 1000,
          temperature: 0.3,
        }),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const err = await response.text();
        this.logger.error(`OpenRouter API 错误: ${response.status} ${err}`);
        throw new BadRequestException('AI 分析失败，请稍后重试');
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      this.logger.debug(
        `AI 图片分析完成: model=${data.model}, tokens=${data.usage?.total_tokens || 'N/A'}`,
      );

      // 解析 AI 返回
      const result = this.parseAnalysisResult(content);
      result.imageUrl = imageUrl;

      // 评分引擎覆盖
      if (userId && profile) {
        await this.applyScoreEngine(result, userId, goalType, profile);
      }

      return result;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`AI 图片分析异常: ${(err as Error).message}`);
      throw new BadRequestException('AI 分析超时，请重试');
    }
  }

  /**
   * V6.1: 执行图片分析并返回统一结构 FoodAnalysisResultV61
   *
   * 完整流程: AI 识别 → 多食物拆解 → 置信度标注 → 营养估算 → 决策 → 组装统一结构 → 异步保存分析记录
   */
  async analyzeToV61(
    imageUrl: string,
    mealType: string | undefined,
    userId: string,
  ): Promise<FoodAnalysisResultV61> {
    // 1. 执行 AI 分析（复用已有逻辑）
    const legacyResult = await this.executeAnalysis(imageUrl, mealType, userId);

    // 2. 转换为统一 AnalyzedFoodItem[]
    const foods = this.legacyFoodsToAnalyzed(legacyResult);

    // 3. V2.1: 委托统一管道（评分 → 决策 → 组装 → 持久化 → 事件）
    return this.analysisPipeline.execute({
      inputType: 'image',
      imageUrl,
      mealType,
      userId,
      foods,
      precomputedScore: legacyResult.nutritionScore
        ? {
            healthScore: legacyResult.nutritionScore,
            nutritionScore: legacyResult.nutritionScore,
            confidenceScore: Math.round(
              (foods.reduce((s, f) => s + f.confidence, 0) /
                Math.max(1, foods.length)) *
                100,
            ),
            breakdown: legacyResult.scoreBreakdown,
          }
        : undefined,
      precomputedTotals: {
        calories: legacyResult.totalCalories,
        protein: legacyResult.totalProtein,
        fat: legacyResult.totalFat,
        carbs: legacyResult.totalCarbs,
      },
    });
  }

  // ==================== 私有方法 ====================

  /**
   * V6.1 Phase 2.4: 将已有的旧格式结果转换为 V61 并异步保存分析记录
   *
   * 适用于 Processor 链路：AI 调用已完成（executeAnalysis），无需再次调用。
   * 对外暴露，供 AnalyzeService.processAnalysis() 异步触发。
   *
   * @returns 生成的 analysisId
   */
  async persistAnalysisRecord(
    legacyResult: AnalysisResult,
    userId: string,
    imageUrl: string,
    mealType?: string,
  ): Promise<string> {
    const analysisId = crypto.randomUUID();
    const foods = this.legacyFoodsToAnalyzed(legacyResult);
    const avgConfidence =
      foods.length > 0
        ? foods.reduce((s, f) => s + f.confidence, 0) / foods.length
        : 0.5;

    const result: FoodAnalysisResultV61 = {
      analysisId,
      inputType: 'image',
      inputSnapshot: { imageUrl, mealType: mealType as any },
      foods,
      totals: {
        calories: legacyResult.totalCalories,
        protein: legacyResult.totalProtein,
        fat: legacyResult.totalFat,
        carbs: legacyResult.totalCarbs,
      },
      score: {
        healthScore: legacyResult.nutritionScore || 50,
        nutritionScore: legacyResult.nutritionScore || 50,
        confidenceScore: Math.round(avgConfidence * 100),
      },
      decision: {
        recommendation: mapToRecommendation(legacyResult.decision),
        shouldEat: legacyResult.decision !== 'AVOID',
        reason: legacyResult.reason || legacyResult.advice,
        riskLevel: mapRiskLevel(legacyResult.riskLevel),
      },
      alternatives: (legacyResult.insteadOptions || []).map((name) => ({
        name,
        reason: '更适合当前目标',
      })),
      explanation: {
        summary: legacyResult.advice || legacyResult.contextComment || '',
      },
      ingestion: {
        matchedExistingFoods: false,
        shouldPersistCandidate: avgConfidence >= 0.5 && foods.length > 0,
        reviewRequired: avgConfidence < 0.7,
      },
      entitlement: { tier: 'free' as any, fieldsHidden: [] },
    };

    // 异步保存（不阻塞返回）
    this.persistence
      .saveImageRecord({ analysisId, userId, imageUrl, mealType, result })
      .catch((err) =>
        this.logger.warn(`异步保存图片分析记录失败: ${(err as Error).message}`),
      );

    return analysisId;
  }

  // ==================== 以下为内部私有方法 ====================

  /**
   * 将 legacy AnalysisResult.foods 转换为 AnalyzedFoodItem[]
   *
   * analyzeToV61 和 persistAnalysisRecord 共用
   */
  private legacyFoodsToAnalyzed(legacy: AnalysisResult): AnalyzedFoodItem[] {
    return legacy.foods.map((f: any) => ({
      name: f.name,
      quantity: f.quantity,
      category: f.category,
      confidence: typeof f.confidence === 'number' ? f.confidence : 0.6,
      calories: f.calories || 0,
      protein: f.protein || 0,
      fat: f.fat || 0,
      carbs: f.carbs || 0,
      fiber: f.fiber,
      sodium: f.sodium,
      saturatedFat: f.saturatedFat,
      addedSugar: f.addedSugar,
      vitaminA: f.vitaminA,
      vitaminC: f.vitaminC,
      calcium: f.calcium,
      iron: f.iron,
      estimated: f.estimated,
    }));
  }

  /**
   * 构建用户上下文（与 AnalyzeService 中逻辑一致）
   */
  /**
   * V1.9: 委托给 UserContextBuilderService
   */
  private async buildUserContext(
    userId?: string,
  ): Promise<{ context: string; goalType: string; profile: any }> {
    const ctx = await this.userContextBuilder.build(userId);
    return {
      context: this.userContextBuilder.formatAsPromptString(ctx),
      goalType: ctx.goalType,
      profile: ctx.profile,
    };
  }

  /**
   * 应用评分引擎覆盖 AI 决策（从 AnalyzeService 中提取）
   */
  private async applyScoreEngine(
    result: AnalysisResult,
    userId: string,
    goalType: string,
    profile: any,
    locale: Locale = 'zh-CN',
  ): Promise<void> {
    try {
      // V1.6: 委托给 FoodScoringService
      const scoreResult = await this.foodScoringService.calculateImageScore(
        {
          calories: result.totalCalories,
          protein: result.totalProtein,
          fat: result.totalFat,
          carbs: result.totalCarbs,
          avgQuality: result.avgQuality,
          avgSatiety: result.avgSatiety,
        },
        userId,
        goalType,
        profile,
        locale,
      );

      result.nutritionScore = scoreResult.score;
      result.scoreBreakdown = scoreResult.breakdown;
      result.highlights = scoreResult.highlights;
      result.decision = resolveDecision(result.decision, scoreResult.decision);
    } catch (err) {
      this.logger.warn(`评分计算失败: ${(err as Error).message}`);
    }
  }

  /**
   * 解析 AI 返回的文本为结构化结果
   *
   * V6.1 增强: 支持 per-food confidence 字段
   */
  private parseAnalysisResult(content: string): AnalysisResult {
    try {
      const cleaned = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      const foods = Array.isArray(parsed.foods) ? parsed.foods : [];
      let totalProtein =
        typeof parsed.totalProtein === 'number' ? parsed.totalProtein : 0;
      let totalFat = typeof parsed.totalFat === 'number' ? parsed.totalFat : 0;
      let totalCarbs =
        typeof parsed.totalCarbs === 'number' ? parsed.totalCarbs : 0;
      let avgQuality =
        typeof parsed.avgQuality === 'number' ? parsed.avgQuality : 0;
      let avgSatiety =
        typeof parsed.avgSatiety === 'number' ? parsed.avgSatiety : 0;
      const totalCalories =
        typeof parsed.totalCalories === 'number' ? parsed.totalCalories : 0;

      // AI 容错：如果没返回汇总营养，从 foods 或粗估
      if (totalProtein === 0 && totalFat === 0 && totalCarbs === 0) {
        if (foods.some((f: any) => f.protein > 0)) {
          totalProtein = foods.reduce(
            (s: number, f: any) => s + (f.protein || 0),
            0,
          );
          totalFat = foods.reduce((s: number, f: any) => s + (f.fat || 0), 0);
          totalCarbs = foods.reduce(
            (s: number, f: any) => s + (f.carbs || 0),
            0,
          );
        } else {
          const est = estimateNutrition(totalCalories);
          totalProtein = est.protein;
          totalFat = est.fat;
          totalCarbs = est.carbs;
        }
      }

      if (avgQuality === 0 || avgSatiety === 0) {
        if (foods.some((f: any) => f.quality > 0)) {
          avgQuality =
            avgQuality ||
            Math.round(
              (foods.reduce((s: number, f: any) => s + (f.quality || 5), 0) /
                Math.max(1, foods.length)) *
                10,
            ) / 10;
          avgSatiety =
            avgSatiety ||
            Math.round(
              (foods.reduce((s: number, f: any) => s + (f.satiety || 5), 0) /
                Math.max(1, foods.length)) *
                10,
            ) / 10;
        } else {
          const mainCategory = foods[0]?.category;
          const est = estimateNutrition(totalCalories, mainCategory);
          avgQuality = est.quality;
          avgSatiety = est.satiety;
        }
      }

      // 给 foods 中缺失数据的项填充粗估值
      for (const food of foods) {
        if (!food.protein && !food.fat && !food.carbs) {
          const est = estimateNutrition(food.calories || 0, food.category);
          food.protein = est.protein;
          food.fat = est.fat;
          food.carbs = est.carbs;
        }
        if (!food.quality) food.quality = avgQuality || 5;
        if (!food.satiety) food.satiety = avgSatiety || 5;
        // V6.1: 确保 confidence 字段存在
        if (typeof food.confidence !== 'number') food.confidence = 0.6;
      }

      return {
        foods,
        totalCalories,
        totalProtein,
        totalFat,
        totalCarbs,
        avgQuality,
        avgSatiety,
        mealType: parsed.mealType || 'lunch',
        advice: parsed.advice || '',
        isHealthy:
          typeof parsed.isHealthy === 'boolean' ? parsed.isHealthy : true,
        decision: ['SAFE', 'OK', 'LIMIT', 'AVOID'].includes(parsed.decision)
          ? parsed.decision
          : 'SAFE',
        riskLevel: parsed.riskLevel || '🟢',
        reason: parsed.reason || '',
        suggestion: parsed.suggestion || '',
        insteadOptions: Array.isArray(parsed.insteadOptions)
          ? parsed.insteadOptions
          : [],
        compensation: parsed.compensation || {},
        contextComment: parsed.contextComment || '',
        encouragement: parsed.encouragement || '',
        nutritionScore: 0,
      };
    } catch {
      this.logger.warn(`AI 返回解析失败: ${content.substring(0, 200)}`);
      return {
        foods: [],
        totalCalories: 0,
        totalProtein: 0,
        totalFat: 0,
        totalCarbs: 0,
        avgQuality: 5,
        avgSatiety: 5,
        mealType: 'lunch',
        advice: '无法识别图片内容，请重新上传清晰的食物图片',
        isHealthy: true,
        decision: 'SAFE' as const,
        riskLevel: '🟢',
        reason: '',
        suggestion: '',
        insteadOptions: [],
        compensation: {},
        contextComment: '',
        encouragement: '',
        nutritionScore: 0,
      };
    }
  }
}
