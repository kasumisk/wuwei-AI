import { ImageNutritionFillService } from '../../../src/modules/food/app/services/image/image-nutrition-fill.service';
import { AiRuntimeFeature } from '../../../src/core/ai-runtime/ai-runtime.types';

describe('ImageNutritionFillService model routing', () => {
  it('uses food text analysis route for nutrition fill AI runtime calls', async () => {
    const aiRuntime = {
      chat: jest.fn().mockResolvedValue({
        content: JSON.stringify({
          foods: [
            {
              name: 'unknown stew',
              calories: 100,
              protein: 5,
              fat: 3,
              carbs: 12,
            },
          ],
        }),
      }),
    };
    const i18n = {
      currentLocale: jest.fn().mockReturnValue('en-US'),
      t: jest.fn((key: string) =>
        key.endsWith('.system') ? 'system prompt' : 'fill foods:',
      ),
    };
    const aiModelRouting = {
      resolveFoodTextAnalysis: jest.fn().mockResolvedValue({
        region: 'GLOBAL',
        provider: 'deepseek',
        model: 'deepseek-chat',
        apiKey: 'deepseek-key',
        baseUrl: 'https://api.deepseek.com/v1',
      }),
    };
    const service = new ImageNutritionFillService(
      aiRuntime as any,
      i18n as any,
      aiModelRouting as any,
    );
    const foods = [
      {
        name: 'unknown stew',
        category: 'composite',
        confidence: 0.7,
        calories: 0,
        estimatedWeightGrams: 200,
      },
    ];

    await service.fillMissing(foods as any, 'user-1', 'en-US');

    expect(aiModelRouting.resolveFoodTextAnalysis).toHaveBeenCalledWith({
      locale: 'en-US',
    });
    expect(aiRuntime.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: AiRuntimeFeature.FoodImage,
        provider: 'deepseek',
        model: 'deepseek-chat',
        apiKey: 'deepseek-key',
        baseUrl: 'https://api.deepseek.com/v1',
      }),
    );
  });
});
