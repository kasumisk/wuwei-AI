import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FoodService } from './food.service';
import { UserProfileService } from './user-profile.service';
import { BehaviorService } from './behavior.service';

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
  }>;
  totalCalories: number;
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
}

const buildFoodAnalysisPrompt = (userContext: string) =>
`你是专业减脂饮食教练，风格：朋友式、简洁、可执行。
你的目标不是提供营养知识，而是帮助用户做"吃或不吃"的决策。

${userContext}

用户上传了一张外卖或餐食图片。请识别图中所有菜品并做出决策判断。

以 JSON 格式返回（不要输出任何其他文字，只输出纯 JSON）：
{
  "foods": [
    { "name": "菜名", "calories": 数字, "quantity": "份量描述", "category": "分类" }
  ],
  "totalCalories": 总热量数字,
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
  "contextComment": "基于今日状态的点评，一句话",
  "encouragement": "积极鼓励语，一句话",
  "advice": "综合营养建议，不超过30字",
  "isHealthy": true或false
}

决策规则：
- SAFE(🟢): 健康食物且剩余热量充足，放心吃
- OK(🟡): 整体可控，注意份量即可
- LIMIT(🟠): 热量偏高或营养失衡，建议减量或替换
- AVOID(🔴): 已超标或极高热量，强烈建议不吃
- 结合用户当日已摄入热量和剩余额度来判断（关键！）
- 如果剩余热量不足该食物总热量的80%，至少判为LIMIT

替代方案规则：
- insteadOptions 必须接近用户原始需求（想吃肉→推荐烤鸡而非沙拉）
- 必须现实可执行（不要"吃水煮菜"，而是"换少油版本"）
- 每条不超过15字

补救规则：
- compensation 给"可恢复路径"，不要惩罚用户
- 如果 decision 是 SAFE，compensation 各字段可为空字符串
- diet/activity/nextMeal 每条不超过15字

其他规则：
- category 只能是 主食/蔬菜/蛋白质/汤类/水果/饮品/零食
- 热量估算保守（宁少不多）
- 无法识别图片时，foods 返回空数组，decision 为 SAFE
- 像朋友一样说话，不要说"建议咨询医生"`;

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
      this.configService.get<string>('VISION_MODEL') || 'baidu/ernie-4.5-vl-28b-a3b';

    if (!this.apiKey) {
      this.logger.warn('OPENROUTER_API_KEY 未配置，AI 分析功能将不可用');
    } else {
      this.logger.log(
        `AI 分析服务已初始化: model=${this.model}, baseUrl=${this.baseUrl}`,
      );
    }
  }

  /**
   * 构建用户上下文（注入 AI Prompt）
   */
  private async buildUserContext(userId?: string): Promise<string> {
    if (!userId) return '';

    try {
      const [summary, profile] = await Promise.all([
        this.foodService.getTodaySummary(userId),
        this.userProfileService.getProfile(userId),
      ]);

      const goal = summary.calorieGoal || await this.userProfileService.getDailyCalorieGoal(userId);
      const remaining = goal - summary.totalCalories;
      const hour = new Date().getHours();
      const mealHint = hour < 10 ? '早餐' : hour < 14 ? '午餐' : hour < 18 ? '下午茶' : '晚餐';

      let ctx = `【用户今日饮食状态】
- 每日热量目标：${goal} kcal
- 今日已摄入：${summary.totalCalories} kcal
- 剩余额度：${remaining} kcal
- 已记录餐数：${summary.mealCount} 餐
- 当前时段：${mealHint}`;

      if (profile) {
        ctx += `\n- 用户目标：减脂`;
        if (profile.gender) ctx += `\n- 性别：${profile.gender === 'male' ? '男' : '女'}`;
        if (profile.activityLevel) ctx += `\n- 活动等级：${profile.activityLevel}`;
      }
      return ctx;
    } catch (err) {
      this.logger.warn(`构建用户上下文失败: ${(err as Error).message}`);
      return '';
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
    const userContext = await this.buildUserContext(userId);

    // V3: 行为画像上下文
    let behaviorContext = '';
    if (userId) {
      behaviorContext = await this.behaviorService.getBehaviorContext(userId).catch(() => '');
    }

    // V5: AI 人格
    let personaPrompt = '';
    if (userId) {
      const behaviorProfile = await this.behaviorService.getProfile(userId).catch(() => null);
      const style = behaviorProfile?.coachStyle || 'friendly';
      personaPrompt = PERSONA_PROMPTS[style] || PERSONA_PROMPTS.friendly;
    }

    const fullContext = [personaPrompt, userContext, behaviorContext].filter(Boolean).join('\n\n');
    const systemPrompt = buildFoodAnalysisPrompt(fullContext);

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

      return {
        foods: Array.isArray(parsed.foods) ? parsed.foods : [],
        totalCalories:
          typeof parsed.totalCalories === 'number'
            ? parsed.totalCalories
            : 0,
        mealType: parsed.mealType || 'lunch',
        advice: parsed.advice || '',
        isHealthy: typeof parsed.isHealthy === 'boolean' ? parsed.isHealthy : true,
        // V1: 决策字段
        decision: ['SAFE', 'OK', 'LIMIT', 'AVOID'].includes(parsed.decision) ? parsed.decision : 'SAFE',
        riskLevel: parsed.riskLevel || '🟢',
        reason: parsed.reason || '',
        suggestion: parsed.suggestion || '',
        insteadOptions: Array.isArray(parsed.insteadOptions) ? parsed.insteadOptions : [],
        compensation: parsed.compensation || {},
        contextComment: parsed.contextComment || '',
        encouragement: parsed.encouragement || '',
      };
    } catch {
      this.logger.warn(`AI 返回解析失败: ${content.substring(0, 200)}`);
      return {
        foods: [],
        totalCalories: 0,
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
