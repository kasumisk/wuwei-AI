import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { CapabilityRouter } from '../src/gateway/services/capability-router.service';
import { ModelConfig } from '../src/entities/model-config.entity';
import { Provider } from '../src/entities/provider.entity';
import { ClientCapabilityPermission } from '../src/entities/client-capability-permission.entity';

describe('CapabilityRouter', () => {
  let service: CapabilityRouter;
  let modelRepository: Repository<ModelConfig>;
  let providerRepository: Repository<Provider>;
  let permissionRepository: Repository<ClientCapabilityPermission>;

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
    provider: mockProvider,
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
    allowedProviders: null,
    allowedModels: null,
    preferredProvider: null,
    config: {
      fallbackEnabled: true,
    },
  };

  // Mock QueryBuilder
  const createMockQueryBuilder = () => {
    const queryBuilder = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      leftJoinAndSelect: jest.fn().mockReturnThis(),
      addSelect: jest.fn().mockReturnThis(),
      setParameter: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      getMany: jest.fn(),
    };
    return queryBuilder;
  };

  const mockModelRepository = {
    findOne: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockProviderRepository = {
    findOne: jest.fn(),
  };

  const mockPermissionRepository = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CapabilityRouter,
        {
          provide: getRepositoryToken(ModelConfig),
          useValue: mockModelRepository,
        },
        {
          provide: getRepositoryToken(Provider),
          useValue: mockProviderRepository,
        },
        {
          provide: getRepositoryToken(ClientCapabilityPermission),
          useValue: mockPermissionRepository,
        },
      ],
    }).compile();

    service = module.get<CapabilityRouter>(CapabilityRouter);
    modelRepository = module.get<Repository<ModelConfig>>(
      getRepositoryToken(ModelConfig),
    );
    providerRepository = module.get<Repository<Provider>>(
      getRepositoryToken(Provider),
    );
    permissionRepository = module.get<Repository<ClientCapabilityPermission>>(
      getRepositoryToken(ClientCapabilityPermission),
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('route', () => {
    it('应该成功路由到默认模型', async () => {
      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([mockModelConfig]);

      mockPermissionRepository.findOne.mockResolvedValue(mockPermission);
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

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

      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([customModelConfig]);

      mockPermissionRepository.findOne.mockResolvedValue(mockPermission);
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      const result = await service.route('client-1', 'TEXT_GENERATION');

      expect(result.endpoint).toBe('https://custom.api.com');
      expect(result.apiKey).toBe('custom-key');
      expect(result.config.timeout).toBe(60000);
      expect(result.config.retries).toBe(5);
    });

    it('应该尊重允许的提供商列表', async () => {
      const permissionWithProviders = {
        ...mockPermission,
        allowedProviders: ['OpenAI', 'Anthropic'],
      };

      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([mockModelConfig]);

      mockPermissionRepository.findOne.mockResolvedValue(
        permissionWithProviders,
      );
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      await service.route('client-1', 'TEXT_GENERATION');

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'LOWER(provider.name) IN (:...providers)',
        {
          providers: ['openai', 'anthropic'],
        },
      );
    });

    it('应该尊重允许的模型列表', async () => {
      const permissionWithModels = {
        ...mockPermission,
        allowedModels: ['gpt-4', 'gpt-3.5-turbo'],
      };

      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([mockModelConfig]);

      mockPermissionRepository.findOne.mockResolvedValue(permissionWithModels);
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      await service.route('client-1', 'TEXT_GENERATION');

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'model.modelName IN (:...models)',
        {
          models: ['gpt-4', 'gpt-3.5-turbo'],
        },
      );
    });

    it('应该验证请求的模型在允许列表中', async () => {
      const permissionWithModels = {
        ...mockPermission,
        allowedModels: ['gpt-3.5-turbo'],
      };

      mockPermissionRepository.findOne.mockResolvedValue(permissionWithModels);

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
        preferredProvider: 'OpenAI',
      };

      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([mockModelConfig]);

      mockPermissionRepository.findOne.mockResolvedValue(
        permissionWithPreferred,
      );
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      await service.route('client-1', 'TEXT_GENERATION');

      expect(queryBuilder.addSelect).toHaveBeenCalledWith(
        'CASE WHEN LOWER(provider.name) = :preferred THEN 0 ELSE 1 END',
        'provider_priority',
      );
      expect(queryBuilder.setParameter).toHaveBeenCalledWith(
        'preferred',
        'openai',
      );
      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'provider_priority',
        'ASC',
      );
    });

    it('应该在没有可用模型时抛出异常', async () => {
      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([]);

      mockPermissionRepository.findOne.mockResolvedValue(mockPermission);
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow(NotFoundException);
      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow('未找到可用的 TEXT_GENERATION 模型配置');
    });

    it('应该选择优先级最高的模型', async () => {
      const lowPriorityModel = {
        ...mockModelConfig,
        id: 'model-2',
        priority: 10,
      };

      const highPriorityModel = {
        ...mockModelConfig,
        id: 'model-3',
        priority: 1,
      };

      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([
        lowPriorityModel,
        highPriorityModel,
      ]);

      mockPermissionRepository.findOne.mockResolvedValue(mockPermission);
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      const result = await service.route('client-1', 'TEXT_GENERATION');

      // 应该选择第一个返回的模型（已按优先级排序）
      expect(result.modelConfig.id).toBe('model-2');
    });

    it('应该处理没有权限配置的情况', async () => {
      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([mockModelConfig]);

      mockPermissionRepository.findOne.mockResolvedValue(null);
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

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

      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([modelWithMetadata]);

      mockPermissionRepository.findOne.mockResolvedValue(mockPermission);
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      const result = await service.route('client-1', 'TEXT_GENERATION');

      expect(result.config.maxTokens).toBe(4096);
      expect(result.config.temperature).toBe(0.7);
    });
  });

  describe('fallback', () => {
    it('应该成功找到备用模型', async () => {
      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([mockModelConfig]);

      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      const result = await service.fallback('client-1', 'TEXT_GENERATION', [
        'failed-provider-1',
      ]);

      expect(result).toBeDefined();
      expect(result?.model).toBe('gpt-4');
      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'model.providerId NOT IN (:...excludeProviderIds)',
        {
          excludeProviderIds: ['failed-provider-1'],
        },
      );
    });

    it('应该排除失败的提供商', async () => {
      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([mockModelConfig]);

      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      await service.fallback('client-1', 'TEXT_GENERATION', [
        'provider-1',
        'provider-2',
      ]);

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'model.providerId NOT IN (:...excludeProviderIds)',
        {
          excludeProviderIds: ['provider-1', 'provider-2'],
        },
      );
    });

    it('应该在没有备用模型时返回 null', async () => {
      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([]);

      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      const result = await service.fallback('client-1', 'TEXT_GENERATION', []);

      expect(result).toBeNull();
    });

    it('应该处理空的排除列表', async () => {
      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([mockModelConfig]);

      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      const result = await service.fallback('client-1', 'TEXT_GENERATION', []);

      expect(result).toBeDefined();
      // 不应该调用排除条件
      expect(queryBuilder.andWhere).not.toHaveBeenCalledWith(
        expect.stringContaining('NOT IN'),
        expect.anything(),
      );
    });

    it('应该使用自定义配置', async () => {
      const customModel = {
        ...mockModelConfig,
        customTimeout: 45000,
        customRetries: 2,
      };

      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([customModel]);

      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      const result = await service.fallback('client-1', 'TEXT_GENERATION', []);

      expect(result?.config.timeout).toBe(45000);
      expect(result?.config.retries).toBe(2);
    });

    it('应该选择优先级最高的备用模型', async () => {
      const models = [
        { ...mockModelConfig, id: 'model-1', priority: 5 },
        { ...mockModelConfig, id: 'model-2', priority: 2 },
        { ...mockModelConfig, id: 'model-3', priority: 8 },
      ];

      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue(models);

      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      const result = await service.fallback('client-1', 'TEXT_GENERATION', []);

      expect(queryBuilder.orderBy).toHaveBeenCalledWith(
        'model.priority',
        'ASC',
      );
      // 应该返回第一个（优先级排序后）
      expect(result?.modelConfig.id).toBe('model-1');
    });
  });

  describe('边缘情况', () => {
    it('应该处理数据库查询错误', async () => {
      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockRejectedValue(new Error('Database error'));

      mockPermissionRepository.findOne.mockResolvedValue(mockPermission);
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow('Database error');
    });

    it('应该处理权限查询错误', async () => {
      mockPermissionRepository.findOne.mockRejectedValue(
        new Error('Permission error'),
      );

      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow('Permission error');
    });

    it('应该处理禁用的提供商', async () => {
      const disabledProviderModel = {
        ...mockModelConfig,
        provider: {
          ...mockProvider,
          enabled: false,
        },
      };

      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([]);

      mockPermissionRepository.findOne.mockResolvedValue(mockPermission);
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow(NotFoundException);
    });

    it('应该处理禁用的模型', async () => {
      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([]);

      mockPermissionRepository.findOne.mockResolvedValue(mockPermission);
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      await expect(
        service.route('client-1', 'TEXT_GENERATION'),
      ).rejects.toThrow(NotFoundException);
    });

    it('应该处理大小写不敏感的提供商匹配', async () => {
      const permissionWithMixedCase = {
        ...mockPermission,
        allowedProviders: ['OpenAI', 'ANTHROPIC', 'google'],
      };

      const queryBuilder = createMockQueryBuilder();
      queryBuilder.getMany.mockResolvedValue([mockModelConfig]);

      mockPermissionRepository.findOne.mockResolvedValue(
        permissionWithMixedCase,
      );
      mockModelRepository.createQueryBuilder.mockReturnValue(
        queryBuilder as any,
      );

      await service.route('client-1', 'TEXT_GENERATION');

      expect(queryBuilder.andWhere).toHaveBeenCalledWith(
        'LOWER(provider.name) IN (:...providers)',
        {
          providers: ['openai', 'anthropic', 'google'],
        },
      );
    });
  });
});
