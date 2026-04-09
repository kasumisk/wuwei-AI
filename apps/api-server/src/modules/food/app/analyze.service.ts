import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FoodService } from '../../diet/app/food.service';
import { UserProfileService } from '../../user/app/user-profile.service';
import { BehaviorService } from '../../diet/app/behavior.service';
import {
  NutritionScoreService,
  NutritionScoreBreakdown,
} from '../../diet/app/nutrition-score.service';

// V5: AI 人格 Prompt
const PERSONA_PROMPTS: Record<string, string> = {
  strict: `你的风格是严格教练：直接了当，不拐弯抹角。重点强调目标和纪律。语气：坚定但不攻击。用语示例："不建议""应该""必须控制"`,
  friendly: `你的风格是暖心朋友：温和鼓励，理解失败很正常。避免强烈否定，多给替代方案。语气：像朋友聊天。用语示例："可以少吃一点""没关系""慢慢来"`,
  data: `你的风格是数据分析师：客观冷静，用数字说话。减少情感表达，强调数据对比。语气：专业理性。用语示例："数据显示""建议控制在 X% 以内""根据你的记录"`,
};

export interface AnalysisResult {
  foods: Array<{
    name: string;
    calories: number;
    quantity?: string;
    category?: string;
    protein?: number;
    fat?: number;
    carbs?: number;
    quality?: number;
    satiety?: number;
  }>;
  totalCalories: number;
  totalProtein: number;
  totalFat: number;
  totalCarbs: number;
  avgQuality: number;
  avgSatiety: number;
  mealType: string;
  advice: string;
  isHealthy: boolean;
  imageUrl?: string;
  // V1: 决策字段
  decision: 'SAFE' | 'OK' | 'LIMIT' | 'AVOID';
  riskLevel: string;
  reason: string;
  suggestion: string;
  insteadOptions: string[];
  compensation: {
    diet?: string;
    activity?: string;
    nextMeal?: string;
  };
  contextComment: string;
  encouragement: string;
  // V6: 多维营养评分
  nutritionScore: number;
  scoreBreakdown?: NutritionScoreBreakdown;
  highlights?: string[];
}

// ==================== V6: 目标差异化 Prompt 架构 ====================

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
      "quantity": "份量描述",
      "category": "分类",
      "quality": 数字1到10,
      "satiety": 数字1到10
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
- protein/fat/carbs 单位为克(g)，精确到整数
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

function buildGoalAwarePrompt(goalType: string, userContext: string): string {
  const focusBlock = GOAL_FOCUS_BLOCK[goalType] || GOAL_FOCUS_BLOCK.health;
  return [BASE_PROMPT, focusBlock, userContext].join('\n\n');
}

// 评分覆盖：AI decision 仅参考，引擎为准
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

// 目标上下文构建
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

// AI 容错：未返回营养数据时的粗估
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

/**
 * AI 食物图片分析服务
 * 通过 OpenRouter 调用 GPT-4o Vision 进行多模态分析
 */
@Injectable()
export class AnalyzeService {
  private readonly logger = new Logger(AnalyzeService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;

  // 内存暂存分析结果（生产环境应使用 Redis）
  private readonly resultCache = new Map<
    string,
    { data: AnalysisResult; expiresAt: number }
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
    private readonly behaviorService: BehaviorService,
    private readonly nutritionScoreService: NutritionScoreService,
  ) {
    // 优先用 OPENROUTER_API_KEY，向后兼容 OPENAI_API_KEY
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

    if (!this.apiKey) {
      this.logger.warn('OPENROUTER_API_KEY 未配置，AI 分析功能将不可用');
    } else {
      this.logger.log(
        `AI 分析服务已初始化: model=${this.model}, baseUrl=${this.baseUrl}`,
      );
    }
  }

  /**
   * 构建用户上下文（V6: 多维目标 + 目标导向）
   */
  private async buildUserContext(
    userId?: string,
  ): Promise<{ context: string; goalType: string; profile: any }> {
    if (!userId) return { context: '', goalType: 'health', profile: null };

    try {
      const [summary, profile] = await Promise.all([
        this.foodService.getTodaySummary(userId),
        this.userProfileService.getProfile(userId),
      ]);

      const goalType = profile?.goal || 'health';
      const goals = this.nutritionScoreService.calculateDailyGoals(profile);

      const todayTotals = {
        calories: summary.totalCalories,
        protein: Number(summary.totalProtein) || 0,
        fat: Number(summary.totalFat) || 0,
        carbs: Number(summary.totalCarbs) || 0,
      };

      const remaining = {
        calories: goals.calories - todayTotals.calories,
        protein: goals.protein - todayTotals.protein,
        fat: goals.fat - todayTotals.fat,
        carbs: goals.carbs - todayTotals.carbs,
      };

      const gc = GOAL_CONTEXT[goalType] || GOAL_CONTEXT.health;
      const hour = new Date().getHours();
      const mealHint =
        hour < 10 ? '早餐' : hour < 14 ? '午餐' : hour < 18 ? '下午茶' : '晚餐';

      let ctx = `【用户饮食目标】${gc.label}
${gc.focus}

【今日营养预算剩余】
- 热量：剩余 ${remaining.calories} kcal（总目标 ${goals.calories}，已摄入 ${todayTotals.calories}）
- 蛋白质：剩余 ${remaining.protein}g（总目标 ${goals.protein}g，已摄入 ${todayTotals.protein}g）
- 脂肪：剩余 ${remaining.fat}g（总目标 ${goals.fat}g，已摄入 ${todayTotals.fat}g）
- 碳水：剩余 ${remaining.carbs}g（总目标 ${goals.carbs}g，已摄入 ${todayTotals.carbs}g）
- 已记录餐数：${summary.mealCount} 餐
- 当前时段：${mealHint}`;

      if (profile) {
        if (profile.gender)
          ctx += `\n- 性别：${profile.gender === 'male' ? '男' : '女'}`;
        if (profile.activityLevel)
          ctx += `\n- 活动等级：${profile.activityLevel}`;
        if (profile.foodPreferences?.length)
          ctx += `\n- 饮食偏好：${profile.foodPreferences.join('、')}`;
        if (profile.dietaryRestrictions?.length)
          ctx += `\n- 忌口：${profile.dietaryRestrictions.join('、')}`;
      }

      return { context: ctx, goalType, profile };
    } catch (err) {
      this.logger.warn(`构建用户上下文失败: ${(err as Error).message}`);
      return { context: '', goalType: 'health', profile: null };
    }
  }

  /**
   * 分析食物图片
   * @param imageUrl 图片URL（R2 公开链接或 base64 data URL）
   * @param mealType 可选餐食类型提示
   * @param userId 用户ID（用于注入上下文）
   */
  async analyzeImage(
    imageUrl: string,
    mealType?: string,
    userId?: string,
  ): Promise<{ requestId: string } & AnalysisResult> {
    if (!this.apiKey) {
      throw new BadRequestException('AI 分析服务未配置');
    }

    const userHint = mealType ? `用户提示这是${mealType}。` : '';
    const {
      context: userContext,
      goalType,
      profile,
    } = await this.buildUserContext(userId);

    // V3: 行为画像上下文
    let behaviorContext = '';
    if (userId) {
      behaviorContext = await this.behaviorService
        .getBehaviorContext(userId)
        .catch(() => '');
    }

    // V5: AI 人格
    let personaPrompt = '';
    if (userId) {
      const behaviorProfile = await this.behaviorService
        .getProfile(userId)
        .catch(() => null);
      const style = behaviorProfile?.coachStyle || 'friendly';
      personaPrompt = PERSONA_PROMPTS[style] || PERSONA_PROMPTS.friendly;
    }

    const fullContext = [personaPrompt, userContext, behaviorContext]
      .filter(Boolean)
      .join('\n\n');
    // V6: 目标差异化 Prompt
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
            {
              role: 'system',
              content: systemPrompt,
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `${userHint}请分析这张图片中的食物和热量。`,
                },
                {
                  type: 'image_url',
                  image_url: { url: imageUrl, detail: 'low' },
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
        `AI 分析完成: model=${data.model}, tokens=${data.usage?.total_tokens || 'N/A'}`,
      );

      // 从返回内容中提取 JSON
      const result = this.parseAnalysisResult(content);
      result.imageUrl = imageUrl;

      // V6: 用评分引擎计算分数（权威性 > AI 文本判断）
      if (userId && profile) {
        try {
          const goals = this.nutritionScoreService.calculateDailyGoals(profile);
          const summary = await this.foodService.getTodaySummary(userId);
          const todayTotals = {
            calories: summary.totalCalories,
            protein: Number(summary.totalProtein) || 0,
            fat: Number(summary.totalFat) || 0,
            carbs: Number(summary.totalCarbs) || 0,
          };

          // 获取稳定性数据
          let stabilityData:
            | {
                streakDays: number;
                avgMealsPerDay: number;
                targetMeals: number;
              }
            | undefined;
          try {
            const behaviorProfile =
              await this.behaviorService.getProfile(userId);
            if (behaviorProfile) {
              stabilityData = {
                streakDays: behaviorProfile.streakDays || 0,
                avgMealsPerDay:
                  behaviorProfile.totalRecords > 0
                    ? behaviorProfile.totalRecords /
                      Math.max(1, behaviorProfile.streakDays || 1)
                    : 3,
                targetMeals: profile.mealsPerDay || 3,
              };
            }
          } catch {
            /* ignore */
          }

          const scoreResult = this.nutritionScoreService.calculateMealScore(
            {
              calories: result.totalCalories,
              protein: result.totalProtein,
              fat: result.totalFat,
              carbs: result.totalCarbs,
              avgQuality: result.avgQuality,
              avgSatiety: result.avgSatiety,
            },
            todayTotals,
            goals,
            goalType,
            stabilityData,
          );

          result.nutritionScore = scoreResult.score;
          result.scoreBreakdown = scoreResult.breakdown;
          result.highlights = scoreResult.highlights;
          result.decision = resolveDecision(
            result.decision,
            scoreResult.decision,
          );
        } catch (err) {
          this.logger.warn(`评分计算失败: ${(err as Error).message}`);
        }
      }

      // 生成 requestId 并暂存（30 分钟 TTL）
      const requestId = crypto.randomUUID();
      this.resultCache.set(requestId, {
        data: result,
        expiresAt: Date.now() + 30 * 60 * 1000,
      });

      // 清理过期缓存
      this.cleanupCache();

      return { requestId, ...result };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`AI 分析异常: ${(err as Error).message}`);
      throw new BadRequestException('AI 分析超时，请重试');
    }
  }

  /**
   * 获取暂存的分析结果
   */
  getCachedResult(requestId: string): AnalysisResult | null {
    const cached = this.resultCache.get(requestId);
    if (!cached || cached.expiresAt < Date.now()) {
      this.resultCache.delete(requestId);
      return null;
    }
    return cached.data;
  }

  /**
   * 解析 AI 返回的文本为结构化结果
   */
  private parseAnalysisResult(content: string): AnalysisResult {
    try {
      // 尝试直接解析
      const cleaned = content
        .replace(/```json\s*/g, '')
        .replace(/```\s*/g, '')
        .trim();
      const parsed = JSON.parse(cleaned);

      // 计算汇总的营养数据（foods 级别）
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

      // 给 foods 中缺失营养数据的项填充粗估值
      for (const food of foods) {
        if (!food.protein && !food.fat && !food.carbs) {
          const est = estimateNutrition(food.calories || 0, food.category);
          food.protein = est.protein;
          food.fat = est.fat;
          food.carbs = est.carbs;
        }
        if (!food.quality) food.quality = avgQuality || 5;
        if (!food.satiety) food.satiety = avgSatiety || 5;
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
        // V1: 决策字段
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
        // V6: 评分字段（后面由引擎覆盖）
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

  private cleanupCache(): void {
    const now = Date.now();
    for (const [key, val] of this.resultCache) {
      if (val.expiresAt < now) {
        this.resultCache.delete(key);
      }
    }
  }
}
