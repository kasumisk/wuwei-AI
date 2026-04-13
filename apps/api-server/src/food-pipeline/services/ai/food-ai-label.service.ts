import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';
import { FoodLibrary } from '../../../modules/food/food.types';

export interface AiLabelResult {
  category: string;
  subCategory: string;
  foodGroup: string;
  mainIngredient: string;
  processingLevel: number;
  mealTypes: string[];
  allergens: string[];
  compatibility: { goodWith: string[]; badWith: string[] };
  tags: string[];
  confidence: number;
}

/**
 * AI 食物标注服务
 * 使用 DeepSeek V3 对食物进行分类、标签、评分等标注
 */
@Injectable()
export class FoodAiLabelService {
  private readonly logger = new Logger(FoodAiLabelService.name);
  private readonly client: AxiosInstance;
  private readonly apiKey: string;
  private readonly maxRetries = 3;

  private readonly VALID_CATEGORIES = [
    'protein',
    'grain',
    'veggie',
    'fruit',
    'dairy',
    'fat',
    'beverage',
    'snack',
    'condiment',
    'composite',
  ];

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('DEEPSEEK_API_KEY') || '';
    this.client = axios.create({
      baseURL: 'https://api.deepseek.com',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 60000,
    });
  }

  /**
   * 标注单个食物
   */
  async labelFood(food: Partial<FoodLibrary>): Promise<AiLabelResult | null> {
    if (!this.apiKey) {
      this.logger.warn('DEEPSEEK_API_KEY not configured');
      return null;
    }

    const prompt = this.buildSinglePrompt(food);

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.post('/chat/completions', {
          model: 'deepseek-chat',
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content:
                '你是食品营养分析专家。对输入的食物数据进行分类标注，严格按指定JSON格式返回。不要添加任何多余文字。',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.1,
          max_tokens: 800,
        });

        const content = response.data.choices[0]?.message?.content;
        if (!content) continue;

        const result = JSON.parse(content) as AiLabelResult;
        const validated = this.validateResult(result);
        if (validated) return validated;

        this.logger.warn(
          `Label attempt ${attempt} validation failed for "${food.name}"`,
        );
      } catch (e) {
        this.logger.warn(
          `Label attempt ${attempt} failed for "${food.name}": ${e.message}`,
        );
        if (attempt < this.maxRetries) await this.sleep(1000 * attempt);
      }
    }

    this.logger.error(`All label attempts failed for "${food.name}"`);
    return null;
  }

  /**
   * 批量标注食物（分批处理，每批最多10个）
   */
  async labelBatch(
    foods: Partial<FoodLibrary>[],
    batchSize = 10,
  ): Promise<Map<number, AiLabelResult>> {
    const results = new Map<number, AiLabelResult>();

    for (let i = 0; i < foods.length; i += batchSize) {
      const batch = foods.slice(i, i + batchSize);
      this.logger.log(
        `Labeling batch ${Math.floor(i / batchSize) + 1}, items: ${batch.length}`,
      );

      try {
        const batchResults = await this.labelBatchRequest(batch);
        for (const [idx, result] of batchResults) {
          results.set(i + idx, result);
        }
      } catch (e) {
        this.logger.error(`Batch labeling failed at offset ${i}: ${e.message}`);
        // 降级为逐条标注
        for (let j = 0; j < batch.length; j++) {
          const result = await this.labelFood(batch[j]);
          if (result) results.set(i + j, result);
        }
      }

      // Rate limiting
      await this.sleep(500);
    }

    return results;
  }

  private async labelBatchRequest(
    foods: Partial<FoodLibrary>[],
  ): Promise<Map<number, AiLabelResult>> {
    const prompt = this.buildBatchPrompt(foods);
    const results = new Map<number, AiLabelResult>();

    const response = await this.client.post('/chat/completions', {
      model: 'deepseek-chat',
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            '你是食品营养分析专家。对输入的食物数据进行批量标注，严格按指定JSON格式返回。',
        },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 4000,
    });

    const content = response.data.choices[0]?.message?.content;
    if (!content) return results;

    const parsed = JSON.parse(content);
    const items = parsed.results || parsed;

    if (Array.isArray(items)) {
      for (const item of items) {
        const idx = item.index ?? items.indexOf(item);
        const validated = this.validateResult(item);
        if (validated) results.set(idx, validated);
      }
    }

    return results;
  }

  private buildSinglePrompt(food: Partial<FoodLibrary>): string {
    return `食物数据:
- 名称: ${food.name || 'unknown'}
- 热量: ${food.calories ?? '-'} kcal/100g
- 蛋白质: ${food.protein ?? '-'} g/100g
- 脂肪: ${food.fat ?? '-'} g/100g
- 碳水化合物: ${food.carbs ?? '-'} g/100g
- 膳食纤维: ${food.fiber ?? '-'} g/100g
- 糖: ${food.sugar ?? '-'} g/100g
- 钠: ${food.sodium ?? '-'} mg/100g

请严格按以下JSON格式返回:
{
  "category": "protein|grain|veggie|fruit|dairy|fat|beverage|snack|condiment|composite 中选一",
  "sub_category": "更精细的二级分类英文编码(如lean_meat/whole_grain/leafy_green等)",
  "food_group": "多样性分组(如meat/poultry/fish/seafood/egg/tofu/legume/rice/noodle/bread/potato/leafy/cruciferous/root/citrus/berry/tropical/nut/seed等)",
  "main_ingredient": "主要食材英文名",
  "processing_level": 1,
  "meal_types": ["breakfast","lunch","dinner","snack"],
  "allergens": ["过敏原:gluten/dairy/nuts/soy/egg/shellfish/fish/wheat按实际"],
  "compatibility": {"goodWith": ["最多5个适合搭配的食物英文名"], "badWith": ["最多3个不建议搭配的食物英文名"]},
  "tags": ["从标准标签中选:high_protein/low_fat/low_carb/high_fiber/low_calorie/low_sodium/low_sugar/low_gi/weight_loss/muscle_gain/keto/vegan/vegetarian/gluten_free/diabetes_friendly/heart_healthy/natural/whole_food/quick_prep/meal_prep_friendly/budget_friendly"],
  "confidence": 0.85
}`;
  }

  private buildBatchPrompt(foods: Partial<FoodLibrary>[]): string {
    const foodList = foods
      .map(
        (f, i) =>
          `[${i}] ${f.name || 'unknown'}: ${f.calories ?? '-'}kcal, P:${f.protein ?? '-'}g, F:${f.fat ?? '-'}g, C:${f.carbs ?? '-'}g, Fiber:${f.fiber ?? '-'}g`,
      )
      .join('\n');

    return `请对以下 ${foods.length} 个食物进行批量标注。

食物列表:
${foodList}

返回JSON格式: {"results": [{"index": 0, "category": "...", "sub_category": "...", "food_group": "...", "main_ingredient": "...", "processing_level": 1, "meal_types": [...], "allergens": [...], "compatibility": {"goodWith": [...], "badWith": [...]}, "tags": [...], "confidence": 0.85}, ...]}

每条记录字段说明:
- category: protein|grain|veggie|fruit|dairy|fat|beverage|snack|condiment|composite
- sub_category: 二级分类英文编码
- food_group: 多样性分组英文编码
- processing_level: NOVA分级1-4
- tags: 从标准标签库选择`;
  }

  private validateResult(result: any): AiLabelResult | null {
    if (!result || typeof result !== 'object') return null;

    const r: any = {};
    r.category = result.category || result.subCategory;
    r.subCategory = result.subCategory || '';
    r.foodGroup = result.foodGroup || '';
    r.mainIngredient = result.mainIngredient || '';
    r.processingLevel = result.processingLevel || 1;
    r.mealTypes = result.mealTypes || [];
    r.allergens = result.allergens || [];
    r.compatibility = result.compatibility || { goodWith: [], badWith: [] };
    r.tags = result.tags || [];
    r.confidence = result.confidence || 0.5;

    // 基本验证
    if (!r.category || !this.VALID_CATEGORIES.includes(r.category)) return null;
    if (
      typeof r.processingLevel !== 'number' ||
      r.processingLevel < 1 ||
      r.processingLevel > 4
    ) {
      r.processingLevel = 1;
    }
    if (!Array.isArray(r.mealTypes)) r.mealTypes = [];
    if (!Array.isArray(r.allergens)) r.allergens = [];
    if (!Array.isArray(r.tags)) r.tags = [];
    if (typeof r.confidence !== 'number') r.confidence = 0.5;
    r.confidence = Math.max(0, Math.min(1, r.confidence));

    return r as AiLabelResult;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
