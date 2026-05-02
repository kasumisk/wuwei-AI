/**
 * CapabilityRouter 单元测试 — V7.7 重写
 *
 * V7.7 变更：TypeORM repository mock → Prisma mock（对齐 V7.4+ 实现）
 * 使用直接构造函数注入 mock，与 v6.9~v7.4 集成测试一致的风格。
 */

import { NotFoundException } from '@nestjs/common';
import { CapabilityRouter } from '../../../src/gateway/services/capability-router.service';

describe('CapabilityRouter', () => {
  let service: CapabilityRouter;
  let mockPrisma: any;

  const mockProvider = {
    id: 'provider-1',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-api-key',
    enabled: true,
    timeout: 30000,
    retryCount: 3,
  };

  const mockModelConfig = {
    id: 'model-1',
    modelName: 'gpt-4',
    displayName: 'GPT-4',
    providerId: 'provider-1',
    providers: mockProvider, // Prisma relation name
    capabilityType: 'TEXT_GENERATION',
    enabled: true,
    priority: 1,
    endpoint: null,
    customApiKey: null,
    customTimeout: null,
    customRetries: null,
    configMetadata: {},
  };

  const mockPermission = {
    id: 'permission-1',
    clientId: 'client-1',
    capabilityType: 'TEXT_GENERATION',
    enabled: true,
    allowedProviders: null as string | null,
    allowedModels: null as string | null,
    preferredProvider: null as string | null,
    config: { fallbackEnabled: true },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      clientCapabilityPermissions: {
        findFirst: jest.fn(),
      },
      modelConfigs: {
        findMany: jest.fn(),
      },
    };

    service = new CapabilityRouter(mockPrisma);
  });

  // ═══════════════════════════════════════════════════════════
  // route
  // ═══════════════════════════════════════════════════════════

  describe('route', () => {
    it('应该成功路由到默认模型', async () => {
      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        mockPermission,
      );
      mockPrisma.modelConfigs.findMany.mockResolvedValue([mockModelConfig]);

      const result = await service.route('client-1', 'TEXT_GENERATION');

      expect(result).toEqual({
        modelConfig: mockModelConfig,
        provider: mockProvider,
        model: 'gpt-4',
        endpoint: 'https://api.openai.com/v1',
        apiKey: 'test-api-key',
        config: {
          timeout: 30000,
          retries: 3,
          fallbackEnabled: true,
        },
      });
    });

    it('应该使用自定义端点和 API Key', async () => {
      const customModelConfig = {
        ...mockModelConfig,
        endpoint: 'https://custom.api.com',
        customApiKey: 'custom-key',
        customTimeout: 60000,
        customRetries: 5,
      };

      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        mockPermission,
      );
      mockPrisma.modelConfigs.findMany.mockResolvedValue([customModelConfig]);

      const result = await service.route('client-1', 'TEXT_GENERATION');

      expect(result.endpoint).toBe('https://custom.api.com');
      expect(result.apiKey).toBe('custom-key');
      expect(result.config.timeout).toBe(60000);
      expect(result.config.retries).toBe(5);
    });

    it('应该尊重允许的提供商列表（JS 级过滤）', async () => {
      const permissionWithProviders = {
        ...mockPermission,
        allowedProviders: 'OpenAI,Anthropic',
      };

      const anthropicProvider = {
        ...mockProvider,
        id: 'provider-2',
        name: 'Anthropic',
      };
      const anthropicModel = {
        ...mockModelConfig,
        id: 'model-2',
        modelName: 'claude-3',
        providers: anthropicProvider,
        providerId: 'provider-2',
      };
      const unknownProvider = {
        ...mockProvider,
        id: 'provider-3',
        name: 'Unknown',
      };
      const unknownModel = {
        ...mockModelConfig,
        id: 'model-3',
        modelName: 'unknown-model',
        providers: unknownProvider,
        providerId: 'provider-3',
      };

      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        permissionWithProviders,
      );
      // Prisma 返回所有 enabled 模型，JS 层过滤 provider
      mockPrisma.modelConfigs.findMany.mockResolvedValue([
        mockModelConfig,
        anthropicModel,
        unknownModel,
      ]);

      const result = await service.route('client-1', 'TEXT_GENERATION');

      // 应该过滤掉 Unknown provider，选择第一个匹配的
      expect(result.model).toBe('gpt-4');
    });

    it('应该尊重允许的模型列表', async () => {
      const permissionWithModels = {
        ...mockPermission,
        allowedModels: 'gpt-4,gpt-3.5-turbo',
      };

      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        permissionWithModels,
      );
      mockPrisma.modelConfigs.findMany.mockResolvedValue([mockModelConfig]);

      const result = await service.route('client-1', 'TEXT_GENERATION');

      // Prisma 查询应该包含 modelName: { in: [...] }
      expect(mockPrisma.modelConfigs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            modelName: { in: ['gpt-4', 'gpt-3.5-turbo'] },
          }),
        }),
      );
      expect(result.model).toBe('gpt-4');
    });

    it('应该验证请求的模型在允许列表中', async () => {
      const permissionWithModels = {
        ...mockPermission,
        allowedModels: 'gpt-3.5-turbo',
      };

      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        permissionWithModels,
      );

      await expect(
        service.route('client-1', 'TEXT_GENERATION', 'gpt-4'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.route('client-1', 'TEXT_GENERATION', 'gpt-4'),
      ).rejects.toThrow('模型 gpt-4 不在允许列表中');
    });

    it('应该优先选择首选提供商', async () => {
      const permissionWithPreferred = {
        ...mockPermission,
        preferredProvider: 'Anthropic',
      };

      const anthropicProvider = {
        ...mockProvider,
        id: 'provider-2',
        name: 'Anthropic',
      };
      const anthropicModel = {
        ...mockModelConfig,
        id: 'model-2',
        modelName: 'claude-3',
        providers: anthropicProvider,
        priority: 2,
      };

      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        permissionWithPreferred,
      );
      // OpenAI 在前（priority=1），Anthropic 在后（priority=2）
      mockPrisma.modelConfigs.findMany.mockResolvedValue([
        mockModelConfig,
        anthropicModel,
      ]);

      const result = await service.route('client-1', 'TEXT_GENERATION');

      // Anthropic 应该被提升到首位
      expect(result.model).toBe('claude-3');
    });

    it('应该在没有可用模型时抛出异常', async () => {
      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        mockPermission,
      );
      mockPrisma.modelConfigs.findMany.mockResolvedValue([]);

      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow('未找到可用的 TEXT_GENERATION 模型配置');
    });

    it('应该选择优先级最高的模型（Prisma orderBy）', async () => {
      const highPriorityModel = {
        ...mockModelConfig,
        id: 'model-3',
        priority: 1,
      };
      const lowPriorityModel = {
        ...mockModelConfig,
        id: 'model-2',
        modelName: 'gpt-3.5-turbo',
        priority: 10,
      };

      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        mockPermission,
      );
      // Prisma 已按 priority asc 排序
      mockPrisma.modelConfigs.findMany.mockResolvedValue([
        highPriorityModel,
        lowPriorityModel,
      ]);

      const result = await service.route('client-1', 'TEXT_GENERATION');

      expect(result.modelConfig.id).toBe('model-3');
      expect(mockPrisma.modelConfigs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { priority: 'asc' },
        }),
      );
    });

    it('应该处理没有权限配置的情况', async () => {
      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        null,
      );
      mockPrisma.modelConfigs.findMany.mockResolvedValue([mockModelConfig]);

      const result = await service.route('client-1', 'TEXT_GENERATION');

      expect(result).toBeDefined();
      expect(result.model).toBe('gpt-4');
    });

    it('应该包含配置元数据', async () => {
      const modelWithMetadata = {
        ...mockModelConfig,
        configMetadata: {
          maxTokens: 4096,
          temperature: 0.7,
        },
      };

      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        mockPermission,
      );
      mockPrisma.modelConfigs.findMany.mockResolvedValue([modelWithMetadata]);

      const result = await service.route('client-1', 'TEXT_GENERATION');

      expect(result.config.maxTokens).toBe(4096);
      expect(result.config.temperature).toBe(0.7);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // fallback
  // ═══════════════════════════════════════════════════════════

  describe('fallback', () => {
    it('应该成功找到备用模型', async () => {
      mockPrisma.modelConfigs.findMany.mockResolvedValue([mockModelConfig]);

      const result = await service.fallback('client-1', 'TEXT_GENERATION', [
        'failed-provider-1',
      ]);

      expect(result).toBeDefined();
      expect(result?.model).toBe('gpt-4');
      // 验证 providerId notIn 排除
      expect(mockPrisma.modelConfigs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            providerId: { notIn: ['failed-provider-1'] },
          }),
        }),
      );
    });

    it('应该排除多个失败的提供商', async () => {
      mockPrisma.modelConfigs.findMany.mockResolvedValue([mockModelConfig]);

      await service.fallback('client-1', 'TEXT_GENERATION', [
        'provider-1',
        'provider-2',
      ]);

      expect(mockPrisma.modelConfigs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            providerId: { notIn: ['provider-1', 'provider-2'] },
          }),
        }),
      );
    });

    it('应该在没有备用模型时返回 null', async () => {
      mockPrisma.modelConfigs.findMany.mockResolvedValue([]);

      const result = await service.fallback('client-1', 'TEXT_GENERATION', [
        'provider-1',
      ]);

      expect(result).toBeNull();
    });

    it('应该处理空的排除列表', async () => {
      mockPrisma.modelConfigs.findMany.mockResolvedValue([mockModelConfig]);

      const result = await service.fallback('client-1', 'TEXT_GENERATION', []);

      expect(result).toBeDefined();
      // 空列表不应该添加 providerId 过滤
      const calledWith = mockPrisma.modelConfigs.findMany.mock.calls[0][0];
      expect(calledWith.where.providerId).toBeUndefined();
    });

    it('应该使用自定义配置', async () => {
      const customModel = {
        ...mockModelConfig,
        customTimeout: 45000,
        customRetries: 2,
      };

      mockPrisma.modelConfigs.findMany.mockResolvedValue([customModel]);

      const result = await service.fallback('client-1', 'TEXT_GENERATION', []);

      expect(result?.config.timeout).toBe(45000);
      expect(result?.config.retries).toBe(2);
    });

    it('应该按优先级排序返回备用模型', async () => {
      const models = [
        { ...mockModelConfig, id: 'model-1', priority: 5 },
        { ...mockModelConfig, id: 'model-2', priority: 2 },
      ];

      // Prisma 已按 priority asc 排序
      mockPrisma.modelConfigs.findMany.mockResolvedValue(models);

      const result = await service.fallback('client-1', 'TEXT_GENERATION', []);

      expect(mockPrisma.modelConfigs.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { priority: 'asc' },
        }),
      );
      // 返回第一个
      expect(result?.modelConfig.id).toBe('model-1');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 边缘情况
  // ═══════════════════════════════════════════════════════════

  describe('边缘情况', () => {
    it('应该处理数据库查询错误', async () => {
      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        mockPermission,
      );
      mockPrisma.modelConfigs.findMany.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow('Database error');
    });

    it('应该处理权限查询错误', async () => {
      mockPrisma.clientCapabilityPermissions.findFirst.mockRejectedValue(
        new Error('Permission error'),
      );

      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow('Permission error');
    });

    it('应该处理禁用的提供商（查询结果为空）', async () => {
      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        mockPermission,
      );
      // Prisma where 条件 providers: { enabled: true } 会排除禁用提供商
      mockPrisma.modelConfigs.findMany.mockResolvedValue([]);

      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow(NotFoundException);
    });

    it('应该处理禁用的模型（查询结果为空）', async () => {
      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        mockPermission,
      );
      mockPrisma.modelConfigs.findMany.mockResolvedValue([]);

      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow(NotFoundException);
    });

    it('应该处理大小写不敏感的提供商匹配', async () => {
      const permissionWithMixedCase = {
        ...mockPermission,
        allowedProviders: 'OpenAI,ANTHROPIC,google',
      };

      const openaiModel = {
        ...mockModelConfig,
        providers: { ...mockProvider, name: 'openai' },
      };
      const anthropicModel = {
        ...mockModelConfig,
        id: 'model-2',
        modelName: 'claude-3',
        providers: { ...mockProvider, id: 'provider-2', name: 'ANTHROPIC' },
      };

      mockPrisma.clientCapabilityPermissions.findFirst.mockResolvedValue(
        permissionWithMixedCase,
      );
      mockPrisma.modelConfigs.findMany.mockResolvedValue([
        openaiModel,
        anthropicModel,
      ]);

      // 实际代码在 JS 层做 toLowerCase 比较
      const result = await service.route('client-1', 'TEXT_GENERATION');

      expect(result).toBeDefined();
    });
  });
});
