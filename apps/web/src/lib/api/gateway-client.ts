/**
 * Gateway API 客户端
 * 统一处理认证、请求和错误
 */

const GATEWAY_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005/api/gateway';

export interface ApiKeyConfig {
  apiKey: string;
  apiSecret: string;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

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
}

export interface GenerateImageRequest {
  model: string;
  prompt: string;
  size?: string;
  quality?: string;
  n?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data?: T;
}

export interface TextGenerationResponse {
  text: string;
  model: string;
  provider: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  cost: number;
  latency: number;
  finishReason?: string;
}

export interface ImageGenerationResponse {
  images: Array<{
    url: string;
    revisedPrompt?: string;
  }>;
  model: string;
  cost: {
    amount: number;
    currency: string;
  };
  requestId: string;
}

/**
 * 从 localStorage 获取 API Key 配置
 */
export function getApiKeyConfig(): ApiKeyConfig | null {
  if (typeof window === 'undefined') return null;

  const apiKey = localStorage.getItem('gateway_api_key');
  const apiSecret = localStorage.getItem('gateway_api_secret');

  if (!apiKey || !apiSecret) return null;

  return { apiKey, apiSecret };
}

/**
 * 保存 API Key 配置到 localStorage
 */
export function saveApiKeyConfig(config: ApiKeyConfig): void {
  localStorage.setItem('gateway_api_key', config.apiKey);
  localStorage.setItem('gateway_api_secret', config.apiSecret);
}

/**
 * 清除 API Key 配置
 */
export function clearApiKeyConfig(): void {
  localStorage.removeItem('gateway_api_key');
  localStorage.removeItem('gateway_api_secret');
}

/**
 * 生成请求头
 */
function getHeaders(config?: ApiKeyConfig): HeadersInit {
  const authConfig = config || getApiKeyConfig();

  if (!authConfig) {
    throw new Error('API Key 配置未找到，请先配置 API Key');
  }

  console.log('[Gateway Client] 使用 API Key:', authConfig.apiKey);
  console.log(
    '[Gateway Client] 使用 API Secret:',
    authConfig.apiSecret ? '***' + authConfig.apiSecret.slice(-4) : 'undefined'
  );

  return {
    'Content-Type': 'application/json',
    'X-API-Key': authConfig.apiKey,
    'X-API-Secret': authConfig.apiSecret,
  };
}

/**
 * 文本生成（同步）
 */
export async function generateText(
  request: GenerateTextRequest,
  config?: ApiKeyConfig
): Promise<ApiResponse<TextGenerationResponse>> {
  try {
    const response = await fetch(`${GATEWAY_BASE_URL}/gateway/text/generation`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(request),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: true,
        ...data,
      };
    }

    return data;
  } catch (error) {
    return {
      success: false,
    };
  }
}

/**
 * 流式文本生成
 */
export function generateTextStream(
  request: GenerateTextRequest,
  onMessage: (chunk: string) => void,
  onComplete: (usage?: any) => void,
  onError: (error: Error) => void,
  config?: ApiKeyConfig
): () => void {
  const authConfig = config || getApiKeyConfig();

  if (!authConfig) {
    onError(new Error('API Key 配置未找到，请先配置 API Key'));
    return () => {};
  }

  const controller = new AbortController();
  const signal = controller.signal;

  // 使用 fetch 发起 POST 请求
  fetch(`${GATEWAY_BASE_URL}/gateway/text/generation/stream`, {
    method: 'POST',
    headers: getHeaders(config),
    body: JSON.stringify(request),
    signal,
  })
    .then(async (response) => {
      if (!response.ok) {
        const errorText = await response.text();
        try {
            const errorJson = JSON.parse(errorText);
            throw new Error(errorJson.message || `HTTP error! status: ${response.status}`);
        } catch (e) {
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }
      }

      if (!response.body) {
        throw new Error('Response body is null');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        // 保留最后一个可能不完整的行
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          
          // 解析 SSE 格式 (data: {...})
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);

              // 处理错误
              if (data.error) {
                throw new Error(data.message || 'Stream error');
              }

              // 处理文本增量
              if (data.delta) {
                onMessage(data.delta);
              }

              // 处理结束和用量
              if (data.usage) {
                onComplete(data.usage);
              }
              
              // 如果有 finishReason 且不是 null，也可以视为结束（虽然通常伴随 usage）
              if (data.finishReason === 'stop' && !data.usage) {
                  // 如果没有 usage 但结束了，可能需要等待 usage 或者直接结束
                  // 这里不做操作，等待 usage
              }

            } catch (e) {
              console.error('Failed to parse SSE message:', e);
            }
          }
        }
      }
    })
    .catch((error) => {
      if (error.name === 'AbortError') {
        console.log('Stream aborted');
      } else {
        console.error('Stream error:', error);
        onError(error);
      }
    });

  return () => {
    controller.abort();
  };
}

/**
 * 图像生成
 */
export async function generateImage(
  request: GenerateImageRequest,
  config?: ApiKeyConfig
): Promise<ApiResponse<ImageGenerationResponse>> {
  try {
    const response = await fetch(`${GATEWAY_BASE_URL}/gateway/image/generation`, {
      method: 'POST',
      headers: getHeaders(config),
      body: JSON.stringify(request),
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        success: false,
        ...data,
      };
    }

    return {
      success: true,
      data,
    };
  } catch (error) {
    return {
      success: false,
      message: error instanceof Error ? error.message : '网络请求失败',
    };
  }
}
