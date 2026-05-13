import { ConfigService } from '@nestjs/config';
import { RegionAiModelRoutingService } from '../../../src/core/region/region-ai-model-routing.service';
import { RegionStrategyService } from '../../../src/core/region/region-strategy.service';
import { buildDefaultGlobalProfile } from '../../../src/core/region/region-defaults';

describe('RegionAiModelRoutingService', () => {
  const createService = (
    config: Record<string, string | undefined> = {},
    profile = buildDefaultGlobalProfile({}, 'US'),
    modelConfigs: any[] = [],
  ) => {
    const regionStrategy = {
      resolveCapabilities: jest.fn().mockReturnValue(profile),
    } as unknown as RegionStrategyService;
    const configService = {
      get: jest.fn((key: string) => config[key]),
    } as unknown as ConfigService;
    const prisma = {
      modelConfigs: {
        findMany: jest.fn().mockResolvedValue(modelConfigs),
      },
    };

    return {
      service: new RegionAiModelRoutingService(
        regionStrategy,
        configService,
        prisma as any,
      ),
      regionStrategy,
      prisma,
    };
  };

  it('resolves text analysis model from region strategy and DeepSeek env', async () => {
    const { service, regionStrategy } = createService({
      DEEPSEEK_API_KEY: 'deepseek-key',
    });

    const route = await service.resolveFoodTextAnalysis({ locale: 'en-US' });

    expect(regionStrategy.resolveCapabilities).toHaveBeenCalledWith({
      locale: 'en-US',
    });
    expect(route).toMatchObject({
      region: 'GLOBAL',
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'deepseek-key',
      baseUrl: 'https://api.deepseek.com/v1',
    });
  });

  it('resolves vision primary and fallback models from OpenRouter env', async () => {
    const { service } = createService({
      OPENROUTER_API_KEY: 'openrouter-key',
    });

    const route = await service.resolveFoodImageAnalysis({ locale: 'en-US' });

    expect(route).toMatchObject({
      region: 'GLOBAL',
      provider: 'openrouter',
      model: 'qwen/qwen3-vl-32b-instruct',
      fallbackModel: 'qwen/qwen-vl-plus',
      apiKey: 'openrouter-key',
      baseUrl: 'https://openrouter.ai/api/v1',
    });
  });

  it('uses region override values when admin strategy changes AI model routing', async () => {
    const profile = buildDefaultGlobalProfile({}, 'US');
    profile.aiModelRouting.foodImageAnalysis = {
      provider: 'openrouter',
      primaryModel: 'qwen/qwen-vl-plus',
    };
    const { service } = createService(
      { OPENROUTER_API_KEY: 'openrouter-key' },
      profile,
    );

    const route = await service.resolveFoodImageAnalysis();

    expect(route.model).toBe('qwen/qwen-vl-plus');
    expect(route.fallbackModel).toBeUndefined();
  });

  it('prefers admin model/provider config over env fallback', async () => {
    const { service, prisma } = createService(
      { DEEPSEEK_API_KEY: 'env-deepseek-key' },
      buildDefaultGlobalProfile({}, 'US'),
      [
        {
          id: 'model-1',
          modelName: 'deepseek-chat',
          endpoint: 'https://custom.model/v1',
          customApiKey: 'model-key',
          providers: {
            id: 'provider-1',
            name: 'DeepSeek',
            baseUrl: 'https://provider.deepseek/v1',
            apiKey: 'provider-key',
          },
        },
      ],
    );

    const route = await service.resolveFoodTextAnalysis({ locale: 'en-US' });

    expect(prisma.modelConfigs.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          modelName: 'deepseek-chat',
          capabilityType: 'text_generation',
          enabled: true,
          providers: { enabled: true },
        }),
      }),
    );
    expect(route).toMatchObject({
      provider: 'deepseek',
      model: 'deepseek-chat',
      apiKey: 'model-key',
      baseUrl: 'https://custom.model/v1',
      modelConfigId: 'model-1',
      providerId: 'provider-1',
    });
  });
});
