import { AiRuntimeService } from '../../../src/core/ai-runtime/ai-runtime.service';
import {
  AiRuntimeFeature,
  AiRuntimeStreamChunk,
} from '../../../src/core/ai-runtime/ai-runtime.types';

describe('AiRuntimeService.chatRouted', () => {
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
    fallback: jest.fn(),
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

    const service = new AiRuntimeService(
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
      feature: AiRuntimeFeature.CoachChat,
      capabilityType: 'TEXT_GENERATION',
      requestedModel: 'qwen-plus',
      region: 'CN',
      userId: 'user-1',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.2,
      topP: 0.9,
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
        feature: AiRuntimeFeature.CoachChat,
        provider: 'qwen',
        model: 'qwen-plus',
        apiKey: 'qwen-key',
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        timeoutMs: 45000,
        temperature: 0.2,
        topP: 0.9,
        inputCostPer1k: 0.0008,
        outputCostPer1k: 0.002,
      }),
    );
    expect(result.model).toBe('qwen-plus');
  });

  it('falls back to the next routed model when the first provider execution fails', async () => {
    capabilityRouter.route.mockResolvedValue({
      provider: {
        id: 'provider-primary',
        name: 'OpenRouter',
        timeout: 30000,
      },
      modelConfig: {
        inputCostPer1kTokens: '0.001',
        outputCostPer1kTokens: '0.002',
      },
      model: 'openai/gpt-4o-mini',
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: 'openrouter-key',
      config: {
        timeout: 30000,
        fallbackEnabled: true,
      },
    });
    capabilityRouter.fallback.mockResolvedValue({
      provider: {
        id: 'provider-fallback',
        name: 'DeepSeek',
        timeout: 45000,
      },
      modelConfig: {
        inputCostPer1kTokens: '0.0001',
        outputCostPer1kTokens: '0.0002',
      },
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/v1',
      apiKey: 'deepseek-key',
      config: {
        timeout: 45000,
      },
    });

    const service = new AiRuntimeService(
      circuitBreaker as any,
      metrics as any,
      quota as any,
      recorder as any,
      capabilityRouter as any,
    );
    const executeChat = jest
      .spyOn(service as any, 'executeChat')
      .mockRejectedValueOnce(new Error('primary failed'))
      .mockResolvedValueOnce({
        content: 'fallback ok',
        provider: 'deepseek',
        model: 'deepseek-chat',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        costUsd: 0.000002,
        latencyMs: 18,
      });

    const result = await service.chatRouted({
      clientId: 'app-client',
      feature: AiRuntimeFeature.GatewayTextGeneration,
      capabilityType: 'text.generation',
      messages: [{ role: 'user', content: 'hello' }],
    });

    expect(capabilityRouter.fallback).toHaveBeenCalledWith(
      'app-client',
      'text.generation',
      ['provider-primary'],
    );
    expect(executeChat).toHaveBeenCalledTimes(2);
    expect(executeChat).toHaveBeenLastCalledWith(
      expect.objectContaining({
        provider: 'deepseek',
        model: 'deepseek-chat',
        apiKey: 'deepseek-key',
        baseUrl: 'https://api.deepseek.com/v1',
      }),
    );
    expect(result.content).toBe('fallback ok');
  });

  it('routes stream calls through the selected provider and annotates chunks', async () => {
    capabilityRouter.route.mockResolvedValue({
      provider: {
        id: 'provider-primary',
        name: 'OpenRouter',
      },
      modelConfig: {
        inputCostPer1kTokens: '0.001',
        outputCostPer1kTokens: '0.002',
      },
      model: 'openai/gpt-4o-mini',
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: 'openrouter-key',
      config: {
        timeout: 30000,
      },
    });

    const service = new AiRuntimeService(
      circuitBreaker as any,
      metrics as any,
      quota as any,
      recorder as any,
      capabilityRouter as any,
    );
    const executeStream = jest
      .spyOn(service as any, 'executeStream')
      .mockImplementation(async function* () {
        yield { delta: 'he', done: false };
        yield {
          delta: '',
          done: true,
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
        };
      });

    const chunks: AiRuntimeStreamChunk[] = [];
    for await (const chunk of service.chatRoutedStream({
      clientId: 'app-client',
      feature: AiRuntimeFeature.GatewayTextGeneration,
      capabilityType: 'text.generation',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      chunks.push(chunk);
    }

    expect(executeStream).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
        apiKey: 'openrouter-key',
      }),
    );
    expect(chunks).toEqual([
      expect.objectContaining({
        delta: 'he',
        done: false,
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
      }),
      expect.objectContaining({
        delta: '',
        done: true,
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
      }),
    ]);
  });

  it('falls back for stream calls when the first provider fails before output', async () => {
    capabilityRouter.route.mockResolvedValue({
      provider: {
        id: 'provider-primary',
        name: 'OpenRouter',
      },
      modelConfig: {},
      model: 'openai/gpt-4o-mini',
      endpoint: 'https://openrouter.ai/api/v1',
      apiKey: 'openrouter-key',
      config: {
        fallbackEnabled: true,
      },
    });
    capabilityRouter.fallback.mockResolvedValue({
      provider: {
        id: 'provider-fallback',
        name: 'DeepSeek',
      },
      modelConfig: {},
      model: 'deepseek-chat',
      endpoint: 'https://api.deepseek.com/v1',
      apiKey: 'deepseek-key',
      config: {},
    });

    const service = new AiRuntimeService(
      circuitBreaker as any,
      metrics as any,
      quota as any,
      recorder as any,
      capabilityRouter as any,
    );
    const executeStream = jest
      .spyOn(service as any, 'executeStream')
      .mockImplementationOnce(async function* () {
        throw new Error('stream setup failed');
      })
      .mockImplementationOnce(async function* () {
        yield { delta: 'ok', done: false };
      });

    const chunks: AiRuntimeStreamChunk[] = [];
    for await (const chunk of service.chatRoutedStream({
      clientId: 'app-client',
      feature: AiRuntimeFeature.GatewayTextGeneration,
      capabilityType: 'text.generation',
      messages: [{ role: 'user', content: 'hello' }],
    })) {
      chunks.push(chunk);
    }

    expect(capabilityRouter.fallback).toHaveBeenCalledWith(
      'app-client',
      'text.generation',
      ['provider-primary'],
    );
    expect(executeStream).toHaveBeenCalledTimes(2);
    expect(chunks).toEqual([
      expect.objectContaining({
        delta: 'ok',
        provider: 'deepseek',
        model: 'deepseek-chat',
      }),
    ]);
  });
});
