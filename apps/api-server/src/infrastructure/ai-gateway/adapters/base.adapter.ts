import { Observable } from 'rxjs';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateTextRequest {
  messages?: Message[];
  prompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  stream?: boolean;
  [key: string]: any;
}

export interface GenerateTextResponse {
  text: string;
  model: string;
  finishReason?: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, any>;
}

export interface StreamChunk {
  delta: string;
  done?: boolean;
  model?: string;
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export abstract class BaseAdapter {
  abstract readonly provider: string;
  abstract readonly defaultModel: string;

  async generateText(_request: GenerateTextRequest): Promise<GenerateTextResponse> {
    throw new Error(`${this.provider} does not support generateText`);
  }

  generateTextStream(_request: GenerateTextRequest): Observable<StreamChunk> {
    throw new Error(`${this.provider} does not support generateTextStream`);
  }

  abstract calculateCost(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): number;

  protected validateRequest(request: any): void {
    if (!request) throw new Error('Request cannot be null');
  }

  protected handleError(error: any): never {
    if (error.response) {
      throw new Error(
        `${this.provider} API Error: ${error.response.status} - ${error.response.data?.error?.message || error.message}`,
      );
    } else if (error.request) {
      throw new Error(`${this.provider} Network Error: No response received`);
    }
    throw new Error(`${this.provider} Error: ${error.message}`);
  }
}
