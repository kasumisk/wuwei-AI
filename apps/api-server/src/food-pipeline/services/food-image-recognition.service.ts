import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface FoodRecognitionResult {
  name: string;
  nameEn: string;
  confidence: number;
  category?: string;
  estimatedCalories?: number;
}

/**
 * 食物图片识别服务 (Phase 3)
 * 使用 DeepSeek-VL 或 GPT-4o-mini 视觉 API 识别食物图片
 */
@Injectable()
export class FoodImageRecognitionService {
  private readonly logger = new Logger(FoodImageRecognitionService.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly provider: string;

  constructor(private readonly configService: ConfigService) {
    this.provider = this.configService.get<string>('FOOD_IMAGE_PROVIDER') || 'deepseek';
    this.apiKey = this.configService.get<string>(
      this.provider === 'openai' ? 'OPENAI_API_KEY' : 'DEEPSEEK_API_KEY',
    ) || '';

    const baseURL = this.provider === 'openai'
      ? 'https://api.openai.com/v1'
      : 'https://api.deepseek.com';

    this.client = axios.create({
      baseURL,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * 识别食物图片
   * @param imageBase64 Base64 编码的图片数据
   * @returns 识别结果列表（按置信度排序）
   */
  async recognizeFood(imageBase64: string): Promise<FoodRecognitionResult[]> {
    if (!this.apiKey) {
      this.logger.warn('Image recognition API key not configured');
      return [];
    }

    const model = this.provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat';

    try {
      const response = await this.client.post('/chat/completions', {
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是食物图片识别专家。请识别图片中的所有食物，返回JSON格式结果。',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `请识别图片中的所有食物。返回JSON:
{"foods": [{"name": "中文名", "name_en": "English name", "confidence": 0.95, "category": "protein|grain|veggie|fruit|dairy|fat|beverage|snack|condiment|composite", "estimated_calories_per_100g": 150}]}
如果无法识别食物，返回 {"foods": []}。`,
              },
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${imageBase64}` },
              },
            ],
          },
        ],
        max_tokens: 1000,
      });

      const content = response.data.choices[0]?.message?.content;
      if (!content) return [];

      const parsed = JSON.parse(content);
      const foods = parsed.foods || [];

      return foods.map((f: any) => ({
        name: f.name || '',
        nameEn: f.name_en || f.nameEn || '',
        confidence: f.confidence || 0.5,
        category: f.category,
        estimatedCalories: f.estimated_calories_per_100g || f.estimatedCalories,
      })).sort((a: FoodRecognitionResult, b: FoodRecognitionResult) => b.confidence - a.confidence);
    } catch (e) {
      this.logger.error(`Food image recognition failed: ${e.message}`);
      return [];
    }
  }

  /**
   * 通过图片 URL 识别食物
   */
  async recognizeFoodByUrl(imageUrl: string): Promise<FoodRecognitionResult[]> {
    if (!this.apiKey) return [];

    const model = this.provider === 'openai' ? 'gpt-4o-mini' : 'deepseek-chat';

    try {
      const response = await this.client.post('/chat/completions', {
        model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: '你是食物图片识别专家。请识别图片中的所有食物，返回JSON格式结果。',
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `请识别图片中的所有食物。返回JSON: {"foods": [{"name": "中文名", "name_en": "English name", "confidence": 0.95, "category": "protein|grain|veggie|fruit|dairy|fat|beverage|snack|condiment|composite", "estimated_calories_per_100g": 150}]}`,
              },
              {
                type: 'image_url',
                image_url: { url: imageUrl },
              },
            ],
          },
        ],
        max_tokens: 1000,
      });

      const content = response.data.choices[0]?.message?.content;
      if (!content) return [];

      const parsed = JSON.parse(content);
      return (parsed.foods || []).map((f: any) => ({
        name: f.name || '',
        nameEn: f.name_en || f.nameEn || '',
        confidence: f.confidence || 0.5,
        category: f.category,
        estimatedCalories: f.estimated_calories_per_100g,
      }));
    } catch (e) {
      this.logger.error(`Food URL recognition failed: ${e.message}`);
      return [];
    }
  }
}
