import { LlmService } from '../../../src/core/llm/llm.service';
import { LlmFeature } from '../../../src/core/llm/llm.types';

describe('LlmService.chatRouted', () => {
  const circuitBreaker = {
    getBreaker: jest.fn(),
  };
  const metrics = {
    recommendationStageDuration: {
      observe: jest.fn(),
    },
  };
  const quota = {
    consume: jest.fn(),
    refund: jest.fn(),
  };
  const recorder = {
    record: jest.fn(),
  };
  const capabilityRouter = {
    route: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('routes by capability and region, then delegates to the existing chat executor', async () => {
    capabilityRouter.route.mockResolvedValue({
      provider: {
        name: 'Qwen',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: 'qwen-key',
        timeout: 45000,
        retryCount: 2,
      },
      modelConfig: {
        modelName: 'qwen-plus',
        inputCostPer1kTokens: { toNumber: () => 0.0008 },
        outputCostPer1kTokens: { toNumber: () => 0.002 },
      },
      model: 'qwen-plus',
      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'qwen-key',
      config: {
        timeout: 45000,
        retries: 2,
      },
    });

    const service = new LlmService(
      circuitBreaker as any,
      metrics as any,
      quota as any,
      recorder as any,
      capabilityRouter as any,
    );
    const executeChat = jest
      .spyOn(service as any, 'executeChat')
      .mockResolvedValue({
        content: 'ok',
        provider: 'qwen',
        model: 'qwen-plus',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        costUsd: 0.000018,
        latencyMs: 12,
      });

    const result = await service.chatRouted({
      clientId: 'app-client',
      feature: LlmFeature.CoachChat,
      capabilityType: 'TEXT_GENERATION',
      requestedModel: 'qwen-plus',
      region: 'CN',
      userId: 'user-1',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
    });

    expect(capabilityRouter.route).toHaveBeenCalledWith(
      'app-client',
      'TEXT_GENERATION',
      'qwen-plus',
      { region: 'CN' },
    );
    expect(executeChat).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'app-client',
        userId: 'user-1',
        feature: LlmFeature.CoachChat,
        provider: 'qwen',
        model: 'qwen-plus',
        apiKey: 'qwen-key',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        timeoutMs: 45000,
        temperature: 0.2,
        inputCostPer1k: 0.0008,
        outputCostPer1k: 0.002,
      }),
    );
    expect(result.model).toBe('qwen-plus');
  });
});
