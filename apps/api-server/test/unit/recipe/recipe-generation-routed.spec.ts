import { ConfigService } from '@nestjs/config';
import {
  RecipeGenerationService,
  type RecipeGenerationRequest,
} from '../../../src/modules/recipe/app/recipe-generation.service';

describe('RecipeGenerationService routed mode', () => {
  const request: RecipeGenerationRequest = {
    cuisine: '中餐',
    goalType: 'health',
    count: 1,
    maxDifficulty: 2,
  };

  const llmContent = JSON.stringify({
    recipes: [
      {
        name: '清炒西兰花',
        cuisine: '中餐',
        difficulty: 1,
        servings: 1,
        tags: ['健康'],
        ingredients: [{ ingredientName: '西兰花', amount: 200, unit: 'g' }],
      },
    ],
  });

  function createService(config: Record<string, string | undefined>) {
    const configService = {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
    const llm = {
      chat: jest.fn().mockResolvedValue({ content: llmContent }),
      chatRouted: jest.fn().mockResolvedValue({ content: llmContent }),
    };

    const service = new RecipeGenerationService(
      configService,
      {} as any,
      {} as any,
      {} as any,
      llm as any,
    );

    return { service, llm };
  }

  it('uses direct OpenRouter mode by default', async () => {
    const { service, llm } = createService({
      OPENROUTER_API_KEY: 'openrouter-key',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
    });

    const recipes = await service.callLLM(request);

    expect(recipes).toHaveLength(1);
    expect(llm.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openrouter',
        apiKey: 'openrouter-key',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
    );
    expect(llm.chatRouted).not.toHaveBeenCalled();
  });

  it('uses routed mode when recipe routed client is configured', async () => {
    const { service, llm } = createService({
      RECIPE_LLM_ROUTED_CLIENT_ID: 'app-client',
      RECIPE_LLM_ROUTED_REGION: 'CN',
      RECIPE_LLM_ROUTED_MODEL: 'qwen-plus',
    });

    const recipes = await service.callLLM(request);

    expect(recipes).toHaveLength(1);
    expect(llm.chatRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'app-client',
        capabilityType: 'text.generation',
        requestedModel: 'qwen-plus',
        region: 'CN',
      }),
    );
    expect(llm.chat).not.toHaveBeenCalled();
  });
});
