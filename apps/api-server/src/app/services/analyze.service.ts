import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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
}

const FOOD_ANALYSIS_PROMPT = `你是专业营养师，用户上传了一张外卖或餐食图片。

请识别图中所有菜品，以 JSON 格式返回（不要输出任何其他文字，只输出纯 JSON）：
{
  "foods": [
    {
      "name": "宫保鸡丁",
      "calories": 520,
      "quantity": "1份约200g",
      "category": "蛋白质"
    }
  ],
  "totalCalories": 850,
  "mealType": "lunch",
  "advice": "蔬菜偏少，建议加一份绿叶菜",
  "isHealthy": true
}

规则：
- 无法识别的菜品根据外卖常见份量估算
- 热量估算保守一些（宁少不多）
- advice 必须具体且不超过 30 字
- mealType 只能是 breakfast / lunch / dinner / snack
- category 只能是 主食 / 蔬菜 / 蛋白质 / 汤类 / 水果 / 饮品 / 零食
- 无法识别图片时，foods 返回空数组，并在 advice 中说明`;

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

  constructor(private readonly configService: ConfigService) {
    // 优先用 OPENROUTER_API_KEY，向后兼容 OPENAI_API_KEY
    this.apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') ||
      this.configService.get<string>('OPENAI_API_KEY') ||
      '';
    this.baseUrl =
      this.configService.get<string>('OPENROUTER_BASE_URL') ||
      'https://openrouter.ai/api/v1';
    this.model =
      this.configService.get<string>('VISION_MODEL') || 'openai/gpt-4o';

    if (!this.apiKey) {
      this.logger.warn('OPENROUTER_API_KEY 未配置，AI 分析功能将不可用');
    } else {
      this.logger.log(
        `AI 分析服务已初始化: model=${this.model}, baseUrl=${this.baseUrl}`,
      );
    }
  }

  /**
   * 分析食物图片
   * @param imageUrl 图片URL（R2 公开链接或 base64 data URL）
   * @param mealType 可选餐食类型提示
   */
  async analyzeImage(
    imageUrl: string,
    mealType?: string,
  ): Promise<{ requestId: string } & AnalysisResult> {
    if (!this.apiKey) {
      throw new BadRequestException('AI 分析服务未配置');
    }

    const userHint = mealType ? `用户提示这是${mealType}。` : '';

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
              content: FOOD_ANALYSIS_PROMPT,
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
      };
    } catch {
      this.logger.warn(`AI 返回解析失败: ${content.substring(0, 200)}`);
      return {
        foods: [],
        totalCalories: 0,
        mealType: 'lunch',
        advice: '无法识别图片内容，请重新上传清晰的食物图片',
        isHealthy: true,
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
