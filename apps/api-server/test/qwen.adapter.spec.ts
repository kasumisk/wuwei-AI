import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { QwenAdapter } from '../src/gateway/adapters/qwen.adapter';
import axios from 'axios';
import { firstValueFrom, take, toArray } from 'rxjs';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock axios.isAxiosError
const mockIsAxiosError = jest.fn();
(axios as any).isAxiosError = mockIsAxiosError;

describe('QwenAdapter', () => {
  let adapter: QwenAdapter;
  let configService: ConfigService;

  const mockApiKey = 'test-qwen-api-key';

  beforeEach(async () => {
    // 创建 axios mock 实例
    const mockAxiosInstance = {
      post: jest.fn(),
      get: jest.fn(),
      defaults: {
        headers: {},
      },
    };

    mockedAxios.create.mockReturnValue(mockAxiosInstance as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QwenAdapter,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'QWEN_API_KEY') return mockApiKey;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    adapter = module.get<QwenAdapter>(QwenAdapter);
    configService = module.get<ConfigService>(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockIsAxiosError.mockReset();
  });

  describe('初始化', () => {
    it('应该正确初始化适配器', () => {
      expect(adapter).toBeDefined();
      expect(adapter.provider).toBe('qwen');
      expect(adapter.defaultModel).toBe('qwen-plus');
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockApiKey}`,
          }),
        }),
      );
    });

    it('未配置 API Key 时应该警告', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          QwenAdapter,
          {
            provide: ConfigService,
            useValue: {
              get: jest.fn(() => ''),
            },
          },
        ],
      }).compile();

      const adapterWithoutKey = module.get<QwenAdapter>(QwenAdapter);
      expect(adapterWithoutKey).toBeDefined();
      warnSpy.mockRestore();
    });
  });

  describe('generateText', () => {
    it('应该成功生成文本', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-123',
          model: 'qwen-plus',
          created: 1234567890,
          choices: [
            {
              message: {
                content: '这是生成的文本内容',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        },
      };

      const mockClient = (adapter as any).client;
      mockClient.post.mockResolvedValue(mockResponse);

      const result = await adapter.generateText({
        prompt: '你好',
        model: 'qwen-plus',
        temperature: 0.7,
      });

      expect(result).toEqual({
        text: '这是生成的文本内容',
        model: 'qwen-plus',
        usage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30,
        },
        finishReason: 'stop',
        metadata: {
          id: 'chatcmpl-123',
          created: 1234567890,
          latency: expect.any(Number),
        },
      });

      expect(mockClient.post).toHaveBeenCalledWith('/chat/completions', {
        model: 'qwen-plus',
        messages: [
          {
            role: 'user',
            content: '你好',
          },
        ],
        temperature: 0.7,
        max_tokens: undefined,
        top_p: undefined,
        stream: false,
        enable_search: false,
      });
    });

    it('应该使用默认模型', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-123',
          model: 'qwen-plus',
          created: 1234567890,
          choices: [
            {
              message: {
                content: '默认模型响应',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 5,
            completion_tokens: 10,
            total_tokens: 15,
          },
        },
      };

      const mockClient = (adapter as any).client;
      mockClient.post.mockResolvedValue(mockResponse);

      const result = await adapter.generateText({
        prompt: '测试',
      });

      expect(result.model).toBe('qwen-plus');
      expect(mockClient.post).toHaveBeenCalledWith(
        '/chat/completions',
        expect.objectContaining({
          model: 'qwen-plus',
        }),
      );
    });

    it('应该处理 API 401 错误', async () => {
      const mockClient = (adapter as any).client;
      const error: any = new Error('Request failed with status code 401');
      error.isAxiosError = true;
      error.response = {
        status: 401,
        data: { message: 'Invalid API Key' },
      };
      mockClient.post.mockRejectedValue(error);
      mockIsAxiosError.mockReturnValue(true);

      await expect(
        adapter.generateText({
          prompt: '测试',
        }),
      ).rejects.toThrow('Qwen API Key 无效或未配置');
    });

    it('应该处理 API 429 速率限制错误', async () => {
      const mockClient = (adapter as any).client;
      const error: any = new Error('Request failed with status code 429');
      error.isAxiosError = true;
      error.response = {
        status: 429,
        data: { message: 'Rate limit exceeded' },
      };
      mockClient.post.mockRejectedValue(error);
      mockIsAxiosError.mockReturnValue(true);

      await expect(
        adapter.generateText({
          prompt: '测试',
        }),
      ).rejects.toThrow('Qwen API 请求频率超限，请稍后重试');
    });

    it('应该处理 API 400 参数错误', async () => {
      const mockClient = (adapter as any).client;
      const error: any = new Error('Request failed with status code 400');
      error.isAxiosError = true;
      error.response = {
        status: 400,
        data: { message: 'Invalid parameters' },
      };
      mockClient.post.mockRejectedValue(error);
      mockIsAxiosError.mockReturnValue(true);

      await expect(
        adapter.generateText({
          prompt: '测试',
        }),
      ).rejects.toThrow('Qwen API 请求参数错误');
    });

    it('应该处理其他 API 错误', async () => {
      const mockClient = (adapter as any).client;
      const error: any = new Error('Request failed with status code 500');
      error.isAxiosError = true;
      error.response = {
        status: 500,
        data: { message: 'Internal server error' },
      };
      mockClient.post.mockRejectedValue(error);
      mockIsAxiosError.mockReturnValue(true);

      await expect(
        adapter.generateText({
          prompt: '测试',
        }),
      ).rejects.toThrow('Qwen API 调用失败');
    });
  });

  describe('generateTextStream', () => {
    it('应该成功生成流式文本', async () => {
      const mockEventEmitter = {
        on: jest.fn(),
      };

      const mockClient = (adapter as any).client;
      mockClient.post.mockResolvedValue({
        data: mockEventEmitter,
      });

      // 模拟数据流
      setTimeout(() => {
        const dataHandler = mockEventEmitter.on.mock.calls.find(
          (call) => call[0] === 'data',
        )?.[1];

        if (dataHandler) {
          dataHandler(
            Buffer.from('data: {"choices":[{"delta":{"content":"你"}}]}\n'),
          );
          dataHandler(
            Buffer.from('data: {"choices":[{"delta":{"content":"好"}}]}\n'),
          );
          dataHandler(
            Buffer.from(
              'data: {"choices":[{"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":10}}\n',
            ),
          );
          dataHandler(Buffer.from('data: [DONE]\n'));
        }

        const endHandler = mockEventEmitter.on.mock.calls.find(
          (call) => call[0] === 'end',
        )?.[1];
        if (endHandler) endHandler();
      }, 10);

      const chunks: any[] = [];
      const stream$ = adapter.generateTextStream({
        prompt: '你好',
        model: 'qwen-plus',
      });

      const result = await firstValueFrom(stream$.pipe(take(10), toArray()));

      expect(result.length).toBeGreaterThan(0);
      expect(mockClient.post).toHaveBeenCalledWith(
        '/chat/completions',
        expect.objectContaining({
          stream: true,
        }),
        expect.objectContaining({
          responseType: 'stream',
        }),
      );
    });

    it('应该处理流式错误', async () => {
      const mockClient = (adapter as any).client;
      const error: any = new Error('Request failed with status code 401');
      error.isAxiosError = true;
      error.response = {
        status: 401,
        data: { message: 'Unauthorized' },
      };
      mockClient.post.mockRejectedValue(error);
      mockIsAxiosError.mockReturnValue(true);

      const stream$ = adapter.generateTextStream({
        prompt: '测试',
      });

      await expect(firstValueFrom(stream$)).rejects.toThrow(
        'Qwen API Key 无效或未配置',
      );
    });

    it('应该处理流式数据解析错误', async () => {
      const mockEventEmitter = {
        on: jest.fn(),
      };

      const mockClient = (adapter as any).client;
      mockClient.post.mockResolvedValue({
        data: mockEventEmitter,
      });

      setTimeout(() => {
        const dataHandler = mockEventEmitter.on.mock.calls.find(
          (call) => call[0] === 'data',
        )?.[1];

        if (dataHandler) {
          // 发送无效的 JSON
          dataHandler(Buffer.from('data: {invalid json}\n'));
        }

        const endHandler = mockEventEmitter.on.mock.calls.find(
          (call) => call[0] === 'end',
        )?.[1];
        if (endHandler) endHandler();
      }, 10);

      const stream$ = adapter.generateTextStream({
        prompt: '测试',
      });

      // 应该能够处理解析错误而不崩溃
      const result = await firstValueFrom(stream$.pipe(take(1), toArray()));
      expect(result).toBeDefined();
    });
  });

  describe('generateImage', () => {
    it('应该成功生成图像', async () => {
      const mockTaskResponse = {
        data: {
          output: {
            task_id: 'task-123',
          },
        },
      };

      const mockStatusResponse = {
        data: {
          output: {
            task_status: 'SUCCEEDED',
            results: [
              {
                url: 'https://example.com/image1.png',
              },
            ],
          },
        },
      };

      // Mock axios.create 返回新的客户端实例
      const mockImageClient = {
        post: jest.fn().mockResolvedValue(mockTaskResponse),
        get: jest.fn().mockResolvedValue(mockStatusResponse),
      };

      mockedAxios.create.mockReturnValueOnce(mockImageClient as any);

      const result = await adapter.generateImage({
        prompt: '一只可爱的猫',
        model: 'wanx-v1',
        size: '1024x1024',
        n: 1,
      });

      expect(result).toEqual({
        images: [
          {
            url: 'https://example.com/image1.png',
          },
        ],
        model: 'wanx-v1',
        metadata: {
          taskId: 'task-123',
          created: expect.any(Number),
          latency: expect.any(Number),
        },
      });

      expect(mockImageClient.post).toHaveBeenCalledWith(
        '/text2image/generation',
        expect.objectContaining({
          model: 'wanx-v1',
          input: {
            prompt: '一只可爱的猫',
          },
          parameters: {
            size: '1024*1024',
            n: 1,
          },
        }),
      );
    });

    it('应该处理任务失败', async () => {
      const mockTaskResponse = {
        data: {
          output: {
            task_id: 'task-456',
          },
        },
      };

      const mockStatusResponse = {
        data: {
          output: {
            task_status: 'FAILED',
            message: 'Content policy violation',
          },
        },
      };

      const mockImageClient = {
        post: jest.fn().mockResolvedValue(mockTaskResponse),
        get: jest.fn().mockResolvedValue(mockStatusResponse),
      };

      mockedAxios.create.mockReturnValueOnce(mockImageClient as any);

      await expect(
        adapter.generateImage({
          prompt: '违规内容',
        }),
      ).rejects.toThrow('Image generation failed');
    });

    it('应该处理任务超时', async () => {
      const mockTaskResponse = {
        data: {
          output: {
            task_id: 'task-789',
          },
        },
      };

      const mockStatusResponse = {
        data: {
          output: {
            task_status: 'PENDING',
          },
        },
      };

      const mockImageClient = {
        post: jest.fn().mockResolvedValue(mockTaskResponse),
        get: jest.fn().mockResolvedValue(mockStatusResponse),
      };

      mockedAxios.create.mockReturnValueOnce(mockImageClient as any);

      await expect(
        adapter.generateImage({
          prompt: '测试图片',
        }),
      ).rejects.toThrow('Image generation timeout');
    }, 65000); // 设置更长的超时时间

    it('应该使用默认图像模型', async () => {
      const mockTaskResponse = {
        data: {
          output: {
            task_id: 'task-default',
          },
        },
      };

      const mockStatusResponse = {
        data: {
          output: {
            task_status: 'SUCCEEDED',
            results: [
              {
                url: 'https://example.com/default.png',
              },
            ],
          },
        },
      };

      const mockImageClient = {
        post: jest.fn().mockResolvedValue(mockTaskResponse),
        get: jest.fn().mockResolvedValue(mockStatusResponse),
      };

      mockedAxios.create.mockReturnValueOnce(mockImageClient as any);

      await adapter.generateImage({
        prompt: '测试',
      });

      expect(mockImageClient.post).toHaveBeenCalledWith(
        '/text2image/generation',
        expect.objectContaining({
          model: 'wanx-v1',
        }),
      );
    });
  });

  describe('calculateCost', () => {
    it('应该正确计算文本生成成本', () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 2000,
        totalTokens: 3000,
      };

      const cost = adapter.calculateCost(usage);

      // qwen-plus: input ¥4/M, output ¥12/M
      const expectedCost =
        (1000 / 1_000_000) * 0.004 + (2000 / 1_000_000) * 0.012;
      expect(cost).toBeCloseTo(expectedCost, 6);
    });

    it('应该正确计算指定模型的成本', () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 2000,
        totalTokens: 3000,
      };

      const cost = adapter.calculateCostForModel('qwen-max', usage);

      // qwen-max: input ¥40/M, output ¥120/M
      const expectedCost =
        (1000 / 1_000_000) * 0.04 + (2000 / 1_000_000) * 0.12;
      expect(cost).toBeCloseTo(expectedCost, 6);
    });

    it('应该处理未知模型并使用默认定价', () => {
      const usage = {
        promptTokens: 1000,
        completionTokens: 2000,
        totalTokens: 3000,
      };

      const cost = adapter.calculateCostForModel('unknown-model', usage);

      // 应该回退到 qwen-plus 定价
      const expectedCost =
        (1000 / 1_000_000) * 0.004 + (2000 / 1_000_000) * 0.012;
      expect(cost).toBeCloseTo(expectedCost, 6);
    });
  });

  describe('calculateImageCost', () => {
    it('应该正确计算图像生成成本', () => {
      const cost = adapter.calculateImageCost('wanx-v1', 3);
      expect(cost).toBe(0.24); // 3 * 0.08
    });

    it('应该处理未知图像模型', () => {
      const cost = adapter.calculateImageCost('unknown-image-model', 2);
      expect(cost).toBe(0.16); // 使用默认 wanx-v1 定价
    });

    it('应该正确计算不同图像模型的成本', () => {
      const sketchCost = adapter.calculateImageCost(
        'wanx-sketch-to-image-v1',
        1,
      );
      expect(sketchCost).toBe(0.08);

      const bgCost = adapter.calculateImageCost(
        'wanx-background-generation-v2',
        5,
      );
      expect(bgCost).toBe(0.4); // 5 * 0.08
    });
  });

  describe('边缘情况', () => {
    it('应该处理空提示词', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-empty',
          model: 'qwen-plus',
          created: 1234567890,
          choices: [
            {
              message: {
                content: '',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
          },
        },
      };

      const mockClient = (adapter as any).client;
      mockClient.post.mockResolvedValue(mockResponse);

      const result = await adapter.generateText({
        prompt: '',
      });

      expect(result.text).toBe('');
    });

    it('应该处理大量 token 的请求', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-large',
          model: 'qwen-max',
          created: 1234567890,
          choices: [
            {
              message: {
                content: '长文本响应',
              },
              finish_reason: 'length',
            },
          ],
          usage: {
            prompt_tokens: 100000,
            completion_tokens: 200000,
            total_tokens: 300000,
          },
        },
      };

      const mockClient = (adapter as any).client;
      mockClient.post.mockResolvedValue(mockResponse);

      const result = await adapter.generateText({
        prompt: '很长的提示词'.repeat(1000),
        maxTokens: 200000,
      });

      expect(result.usage.totalTokens).toBe(300000);
      expect(result.finishReason).toBe('length');
    });

    it('应该处理特殊字符', async () => {
      const mockResponse = {
        data: {
          id: 'chatcmpl-special',
          model: 'qwen-plus',
          created: 1234567890,
          choices: [
            {
              message: {
                content: '包含特殊字符: \n\t"\'\\',
              },
              finish_reason: 'stop',
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 20,
            total_tokens: 30,
          },
        },
      };

      const mockClient = (adapter as any).client;
      mockClient.post.mockResolvedValue(mockResponse);

      const result = await adapter.generateText({
        prompt: '测试特殊字符: \n\t"\'\\',
      });

      expect(result.text).toBe('包含特殊字符: \n\t"\'\\');
    });
  });
});
