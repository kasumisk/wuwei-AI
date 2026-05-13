import { EnrichmentAiClient } from '../../../src/food-pipeline/services/enrichment/services/ai-client.service';
import { LlmFeature } from '../../../src/core/llm/llm.types';

describe('EnrichmentAiClient routed LLM mode', () => {
  const llm = {
    chat: jest.fn(),
    chatRouted: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
  });

  function createClient(config: Record<string, string | undefined>) {
    const configService = {
      get: jest.fn((key: string) => config[key]),
    };

    return new EnrichmentAiClient(configService as any, llm as any);
  }

  it('keeps direct DeepSeek mode when LLM_ROUTED_CLIENT_ID is not configured', async () => {
    llm.chat.mockResolvedValue({
      content: '{"confidence":0.8,"reasoning":"ok"}',
    });
    const client = createClient({
      DEEPSEEK_API_KEY: 'deepseek-key',
    });

    const result = await client.callAIRaw('apple', 'prompt');

    expect(result).toEqual({ confidence: 0.8, reasoning: 'ok' });
    expect(llm.chat).toHaveBeenCalledWith(
      expect.objectContaining({
        feature: LlmFeature.FoodEnrichment,
        provider: 'deepseek',
        apiKey: 'deepseek-key',
        baseUrl: 'https://api.deepseek.com/v1',
        model: 'deepseek-chat',
      }),
    );
    expect(llm.chatRouted).not.toHaveBeenCalled();
  });

  it('uses chatRouted when LLM_ROUTED_CLIENT_ID is configured', async () => {
    llm.chatRouted.mockResolvedValue({
      content: '{"confidence":0.9,"reasoning":"routed"}',
    });
    const client = createClient({
      LLM_ROUTED_CLIENT_ID: 'app-client',
      LLM_ROUTED_REGION: 'CN',
      LLM_ROUTED_MODEL: 'qwen-plus',
    });

    const result = await client.callAIRaw('apple', 'prompt', {
      maxTokens: 900,
    });

    expect(result).toEqual({ confidence: 0.9, reasoning: 'routed' });
    expect(llm.chatRouted).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'app-client',
        feature: LlmFeature.FoodEnrichment,
        capabilityType: 'text.generation',
        requestedModel: 'qwen-plus',
        region: 'CN',
        maxTokens: 900,
        responseFormat: { type: 'json_object' },
      }),
    );
    expect(llm.chat).not.toHaveBeenCalled();
  });
});
