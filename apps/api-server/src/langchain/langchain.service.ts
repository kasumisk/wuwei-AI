import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import { CapabilityRouter } from '../gateway/services/capability-router.service';
import { CapabilityType } from '@ai-platform/shared';

@Injectable()
export class LangChainService {
  constructor(private readonly capabilityRouter: CapabilityRouter) {}

  /**
   * Get a configured ChatOpenAI instance based on client permissions and routing rules.
   * @param clientId The ID of the client making the request.
   * @param modelName Optional specific model name requested by the client.
   * @returns Configured ChatOpenAI instance.
   */
  async getChatModel(
    clientId: string,
    modelName?: string,
  ): Promise<ChatOpenAI> {
    const routeResult = await this.capabilityRouter.route(
      clientId,
      CapabilityType.TEXT_GENERATION,
      modelName,
    );

    const { apiKey, endpoint, model, config } = routeResult;

    return new ChatOpenAI({
      openAIApiKey: apiKey,
      modelName: model,
      configuration: {
        baseURL: endpoint,
      },
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens,
      streaming: true, // Default to streaming enabled for chat models
      // Map other configurations as needed
      ...config,
    });
  }
}
