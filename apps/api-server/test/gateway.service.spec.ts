import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { GatewayService } from '../src/gateway/gateway.service';
import { Client } from '../src/entities/client.entity';
import { UsageRecord } from '../src/entities/usage-record.entity';
import { CapabilityRouter } from '../src/gateway/services/capability-router.service';

// Mock bcrypt
jest.mock('bcrypt');
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('GatewayService', () => {
  let service: GatewayService;
  let clientRepository: Repository<Client>;
  let usageRecordRepository: Repository<UsageRecord>;
  let capabilityRouter: CapabilityRouter;

  const mockClient = {
    id: 'client-123',
    name: 'Test Client',
    apiKey: 'test-api-key',
    apiSecret: '$2b$10$hashedSecret',
    status: 'active',
    description: 'Test description',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockClientRepository = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockUsageRecordRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockCapabilityRouter = {
    route: jest.fn(),
    getAvailableProviders: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GatewayService,
        {
          provide: getRepositoryToken(Client),
          useValue: mockClientRepository,
        },
        {
          provide: getRepositoryToken(UsageRecord),
          useValue: mockUsageRecordRepository,
        },
        {
          provide: CapabilityRouter,
          useValue: mockCapabilityRouter,
        },
      ],
    }).compile();

    service = module.get<GatewayService>(GatewayService);
    clientRepository = module.get<Repository<Client>>(
      getRepositoryToken(Client),
    );
    usageRecordRepository = module.get<Repository<UsageRecord>>(
      getRepositoryToken(UsageRecord),
    );
    capabilityRouter = module.get<CapabilityRouter>(CapabilityRouter);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateClient', () => {
    it('应该成功验证有效的客户端凭据', async () => {
      mockClientRepository.findOne.mockResolvedValue(mockClient);
      mockedBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.validateClient(
        'test-api-key',
        'test-secret',
      );

      expect(result).toEqual(mockClient);
      expect(mockClientRepository.findOne).toHaveBeenCalledWith({
        where: { apiKey: 'test-api-key' },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'test-secret',
        mockClient.apiSecret,
      );
    });

    it('应该在客户端不存在时返回 null', async () => {
      mockClientRepository.findOne.mockResolvedValue(null);

      const result = await service.validateClient(
        'invalid-api-key',
        'test-secret',
      );

      expect(result).toBeNull();
      expect(mockClientRepository.findOne).toHaveBeenCalledWith({
        where: { apiKey: 'invalid-api-key' },
      });
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('应该在客户端被停用时抛出 UnauthorizedException', async () => {
      const inactiveClient = {
        ...mockClient,
        status: 'inactive',
      };
      mockClientRepository.findOne.mockResolvedValue(inactiveClient);

      await expect(
        service.validateClient('test-api-key', 'test-secret'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.validateClient('test-api-key', 'test-secret'),
      ).rejects.toThrow('客户端已被停用');
    });

    it('应该在 API Secret 不匹配时返回 null', async () => {
      mockClientRepository.findOne.mockResolvedValue(mockClient);
      mockedBcrypt.compare.mockResolvedValue(false as never);

      const result = await service.validateClient(
        'test-api-key',
        'wrong-secret',
      );

      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'wrong-secret',
        mockClient.apiSecret,
      );
    });

    it('应该处理数据库查询错误', async () => {
      mockClientRepository.findOne.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        service.validateClient('test-api-key', 'test-secret'),
      ).rejects.toThrow('Database error');
    });

    it('应该处理 bcrypt 比较错误', async () => {
      mockClientRepository.findOne.mockResolvedValue(mockClient);
      mockedBcrypt.compare.mockRejectedValue(
        new Error('Bcrypt error') as never,
      );

      await expect(
        service.validateClient('test-api-key', 'test-secret'),
      ).rejects.toThrow('Bcrypt error');
    });
  });

  describe('recordUsage', () => {
    const mockUsageData = {
      clientId: 'client-123',
      requestId: 'req-456',
      capabilityType: 'TEXT_GENERATION',
      provider: 'openai',
      model: 'gpt-4',
      status: 'success' as const,
      usage: {
        inputTokens: 100,
        outputTokens: 200,
      },
      cost: 0.05,
      responseTime: 1500,
      metadata: {
        temperature: 0.7,
      },
    };

    it('应该成功记录使用情况', async () => {
      const mockUsageRecord = {
        id: 'usage-789',
        ...mockUsageData,
        timestamp: expect.any(Date),
      };

      mockUsageRecordRepository.create.mockReturnValue(mockUsageRecord);
      mockUsageRecordRepository.save.mockResolvedValue(mockUsageRecord);

      const result = await service.recordUsage(mockUsageData);

      expect(result).toEqual(mockUsageRecord);
      expect(mockUsageRecordRepository.create).toHaveBeenCalledWith({
        ...mockUsageData,
        timestamp: expect.any(Date),
      });
      expect(mockUsageRecordRepository.save).toHaveBeenCalledWith(
        mockUsageRecord,
      );
    });

    it('应该处理没有 usage 字段的情况', async () => {
      const dataWithoutUsage = {
        ...mockUsageData,
        usage: undefined,
      };

      const mockUsageRecord = {
        id: 'usage-789',
        ...dataWithoutUsage,
        usage: {},
        timestamp: expect.any(Date),
      };

      mockUsageRecordRepository.create.mockReturnValue(mockUsageRecord);
      mockUsageRecordRepository.save.mockResolvedValue(mockUsageRecord);

      const result = await service.recordUsage(dataWithoutUsage);

      expect(result.usage).toEqual({});
      expect(mockUsageRecordRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          usage: {},
        }),
      );
    });

    it('应该记录失败状态', async () => {
      const failedUsageData = {
        ...mockUsageData,
        status: 'failed' as const,
        cost: 0,
        metadata: {
          error: 'API timeout',
        },
      };

      const mockUsageRecord = {
        id: 'usage-fail',
        ...failedUsageData,
        timestamp: expect.any(Date),
      };

      mockUsageRecordRepository.create.mockReturnValue(mockUsageRecord);
      mockUsageRecordRepository.save.mockResolvedValue(mockUsageRecord);

      const result = await service.recordUsage(failedUsageData);

      expect(result.status).toBe('failed');
      expect(result.cost).toBe(0);
      expect(result.metadata?.error).toBe('API timeout');
    });

    it('应该记录超时状态', async () => {
      const timeoutUsageData = {
        ...mockUsageData,
        status: 'timeout' as const,
      };

      const mockUsageRecord = {
        id: 'usage-timeout',
        ...timeoutUsageData,
        timestamp: expect.any(Date),
      };

      mockUsageRecordRepository.create.mockReturnValue(mockUsageRecord);
      mockUsageRecordRepository.save.mockResolvedValue(mockUsageRecord);

      const result = await service.recordUsage(timeoutUsageData);

      expect(result.status).toBe('timeout');
    });

    it('应该处理保存错误', async () => {
      mockUsageRecordRepository.create.mockReturnValue({
        ...mockUsageData,
        timestamp: new Date(),
      });
      mockUsageRecordRepository.save.mockRejectedValue(
        new Error('Database save error'),
      );

      await expect(service.recordUsage(mockUsageData)).rejects.toThrow(
        'Database save error',
      );
    });

    it('应该记录不同的能力类型', async () => {
      const imageUsageData = {
        ...mockUsageData,
        capabilityType: 'IMAGE_GENERATION',
        model: 'dall-e-3',
        usage: {
          imagesGenerated: 1,
        },
      };

      const mockUsageRecord = {
        id: 'usage-image',
        ...imageUsageData,
        timestamp: expect.any(Date),
      };

      mockUsageRecordRepository.create.mockReturnValue(mockUsageRecord);
      mockUsageRecordRepository.save.mockResolvedValue(mockUsageRecord);

      const result = await service.recordUsage(imageUsageData);

      expect(result.capabilityType).toBe('IMAGE_GENERATION');
      expect(result.usage.imagesGenerated).toBe(1);
    });

    it('应该正确处理成本计算', async () => {
      const highCostData = {
        ...mockUsageData,
        usage: {
          inputTokens: 10000,
          outputTokens: 20000,
        },
        cost: 5.5,
      };

      const mockUsageRecord = {
        id: 'usage-high-cost',
        ...highCostData,
        timestamp: expect.any(Date),
      };

      mockUsageRecordRepository.create.mockReturnValue(mockUsageRecord);
      mockUsageRecordRepository.save.mockResolvedValue(mockUsageRecord);

      const result = await service.recordUsage(highCostData);

      expect(result.cost).toBe(5.5);
      expect(result.usage.inputTokens).toBe(10000);
      expect(result.usage.outputTokens).toBe(20000);
    });

    it('应该记录响应时间', async () => {
      const slowRequestData = {
        ...mockUsageData,
        responseTime: 5000, // 5 秒
      };

      const mockUsageRecord = {
        id: 'usage-slow',
        ...slowRequestData,
        timestamp: expect.any(Date),
      };

      mockUsageRecordRepository.create.mockReturnValue(mockUsageRecord);
      mockUsageRecordRepository.save.mockResolvedValue(mockUsageRecord);

      const result = await service.recordUsage(slowRequestData);

      expect(result.responseTime).toBe(5000);
    });

    it('应该处理复杂的元数据', async () => {
      const complexMetadata = {
        ...mockUsageData,
        metadata: {
          temperature: 0.9,
          maxTokens: 2000,
          topP: 0.95,
          frequencyPenalty: 0.5,
          presencePenalty: 0.5,
          customHeaders: {
            'X-Custom-Header': 'value',
          },
          additionalInfo: {
            nested: {
              data: true,
            },
          },
        },
      };

      const mockUsageRecord = {
        id: 'usage-complex',
        ...complexMetadata,
        timestamp: expect.any(Date),
      };

      mockUsageRecordRepository.create.mockReturnValue(mockUsageRecord);
      mockUsageRecordRepository.save.mockResolvedValue(mockUsageRecord);

      const result = await service.recordUsage(complexMetadata);

      expect(result.metadata).toEqual(complexMetadata.metadata);
      expect(result.metadata?.additionalInfo.nested.data).toBe(true);
    });
  });

  describe('边缘情况', () => {
    it('应该处理空字符串 API Key', async () => {
      mockClientRepository.findOne.mockResolvedValue(null);

      const result = await service.validateClient('', 'test-secret');

      expect(result).toBeNull();
    });

    it('应该处理空字符串 API Secret', async () => {
      mockClientRepository.findOne.mockResolvedValue(mockClient);
      mockedBcrypt.compare.mockResolvedValue(false as never);

      const result = await service.validateClient('test-api-key', '');

      expect(result).toBeNull();
    });

    it('应该处理零成本的使用记录', async () => {
      const zeroCostData = {
        ...{
          clientId: 'client-123',
          requestId: 'req-456',
          capabilityType: 'TEXT_GENERATION',
          provider: 'openai',
          model: 'gpt-4',
          status: 'success' as const,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
          },
          cost: 0,
          responseTime: 100,
        },
      };

      const mockUsageRecord = {
        id: 'usage-zero',
        ...zeroCostData,
        timestamp: expect.any(Date),
      };

      mockUsageRecordRepository.create.mockReturnValue(mockUsageRecord);
      mockUsageRecordRepository.save.mockResolvedValue(mockUsageRecord);

      const result = await service.recordUsage(zeroCostData);

      expect(result.cost).toBe(0);
      expect(result.usage.inputTokens).toBe(0);
      expect(result.usage.outputTokens).toBe(0);
    });

    it('应该处理极短的响应时间', async () => {
      const quickRequestData = {
        clientId: 'client-123',
        requestId: 'req-quick',
        capabilityType: 'TEXT_GENERATION',
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        status: 'success' as const,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
        },
        cost: 0.000001,
        responseTime: 1, // 1ms
      };

      const mockUsageRecord = {
        id: 'usage-quick',
        ...quickRequestData,
        timestamp: expect.any(Date),
      };

      mockUsageRecordRepository.create.mockReturnValue(mockUsageRecord);
      mockUsageRecordRepository.save.mockResolvedValue(mockUsageRecord);

      const result = await service.recordUsage(quickRequestData);

      expect(result.responseTime).toBe(1);
    });
  });
});
