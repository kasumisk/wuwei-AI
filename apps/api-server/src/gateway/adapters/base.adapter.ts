import { Observable } from 'rxjs';

/**
 * 消息接口（OpenAI 标准）
 */
export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * 文本生成请求参数
 */
export interface GenerateTextRequest {
  // 支持 messages 格式（OpenAI 标准）
  messages?: Message[];
  // 兼容旧的 prompt 格式
  prompt?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string[];
  stream?: boolean;
  [key: string]: any; // 允许提供商特定的参数
}

/**
 * 文本生成响应
 */
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

/**
 * 流式响应数据块
 */
export interface StreamChunk {
  delta: string; // 增量文本内容
  done?: boolean; // 是否完成
  model?: string; // 使用的模型
  finishReason?: string; // 结束原因
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, any>;
}

/**
 * 图像生成请求参数
 */
export interface GenerateImageRequest {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  n?: number;
  [key: string]: any;
}

/**
 * 图像生成响应
 */
export interface GenerateImageResponse {
  images: Array<{
    url?: string;
    b64Json?: string;
  }>;
  model: string;
  revisedPrompt?: string; // DALL-E 3 会修改提示词
  metadata?: Record<string, any>;
}

/**
 * 音频转文本请求参数
 */
export interface AudioToTextRequest {
  audio: Buffer;
  model?: string;
  language?: string;
  temperature?: number;
  [key: string]: any;
}

/**
 * 音频转文本响应
 */
export interface AudioToTextResponse {
  text: string;
  model: string;
  language?: string;
  duration?: number;
  metadata?: Record<string, any>;
}

/**
 * 能力适配器基类
 * 所有第三方 AI 提供商适配器都需要继承此类
 */
export abstract class BaseCapabilityAdapter {
  /**
   * 提供商名称
   */
  abstract readonly provider: string;

  /**
   * 默认模型
   */
  abstract readonly defaultModel: string;

  /**
   * 文本生成（同步）
   */
  async generateText(
    request: GenerateTextRequest,
  ): Promise<GenerateTextResponse> {
    throw new Error(
      `${this.provider} adapter does not support generateText method`,
    );
  }

  /**
   * 文本生成（流式）
   */
  generateTextStream(request: GenerateTextRequest): Observable<StreamChunk> {
    throw new Error(
      `${this.provider} adapter does not support generateTextStream method`,
    );
  }

  /**
   * 图像生成
   */
  async generateImage(
    request: GenerateImageRequest,
  ): Promise<GenerateImageResponse> {
    throw new Error(
      `${this.provider} adapter does not support generateImage method`,
    );
  }

  /**
   * 音频转文本
   */
  async audioToText(request: AudioToTextRequest): Promise<AudioToTextResponse> {
    throw new Error(
      `${this.provider} adapter does not support audioToText method`,
    );
  }

  /**
   * 计算请求的成本
   */
  abstract calculateCost(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): number;

  /**
   * 验证请求参数
   */
  protected validateRequest(request: any): void {
    if (!request) {
      throw new Error('Request cannot be null or undefined');
    }
  }

  /**
   * 标准化错误响应
   */
  protected handleError(error: any): never {
    if (error.response) {
      // API 返回的错误
      throw new Error(
        `${this.provider} API Error: ${error.response.status} - ${
          error.response.data?.error?.message || error.message
        }`,
      );
    } else if (error.request) {
      // 请求发送但没有响应
      throw new Error(`${this.provider} Network Error: No response received`);
    } else {
      // 其他错误
      throw new Error(`${this.provider} Error: ${error.message}`);
    }
  }
}
