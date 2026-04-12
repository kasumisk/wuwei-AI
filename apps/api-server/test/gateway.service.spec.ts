/**
 * GatewayService 单元测试 — V7.7 重写
 *
 * V7.7 变更：TypeORM repository mock → Prisma mock（对齐 V7.4+ 实现）
 * 使用直接构造函数注入 mock，与 v6.9~v7.4 集成测试一致的风格。
 */

import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { GatewayService } from '../src/gateway/gateway.service';
import { CapabilityRouter } from '../src/gateway/services/capability-router.service';

// Mock bcrypt
jest.mock('bcrypt');
const mockedBcrypt = bcrypt as jest.Mocked<typeof bcrypt>;

describe('GatewayService', () => {
  let service: GatewayService;
  let mockPrisma: any;
  let mockCapabilityRouter: any;

  // 使用 snake_case 字段名（Prisma schema 格式）
  const mockClient = {
    id: 'client-123',
    name: 'Test Client',
    api_key: 'test-api-key',
    api_secret: '$2b$10$hashedSecret',
    status: 'active',
    description: 'Test description',
    created_at: new Date(),
    updated_at: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockPrisma = {
      clients: {
        findFirst: jest.fn(),
      },
      usage_records: {
        create: jest.fn(),
      },
    };

    mockCapabilityRouter = {
      route: jest.fn(),
      fallback: jest.fn(),
    };

    service = new GatewayService(mockPrisma, mockCapabilityRouter);
  });

  // ═══════════════════════════════════════════════════════════
  // validateClient
  // ═══════════════════════════════════════════════════════════

  describe('validateClient', () => {
    it('应该成功验证有效的客户端凭据', async () => {
      mockPrisma.clients.findFirst.mockResolvedValue(mockClient);
      mockedBcrypt.compare.mockResolvedValue(true as never);

      const result = await service.validateClient(
        'test-api-key',
        'test-secret',
      );

      expect(result).toEqual(mockClient);
      expect(mockPrisma.clients.findFirst).toHaveBeenCalledWith({
        where: { api_key: 'test-api-key' },
      });
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'test-secret',
        mockClient.api_secret,
      );
    });

    it('应该在客户端不存在时返回 null', async () => {
      mockPrisma.clients.findFirst.mockResolvedValue(null);

      const result = await service.validateClient(
        'invalid-api-key',
        'test-secret',
      );

      expect(result).toBeNull();
      expect(mockPrisma.clients.findFirst).toHaveBeenCalledWith({
        where: { api_key: 'invalid-api-key' },
      });
      expect(bcrypt.compare).not.toHaveBeenCalled();
    });

    it('应该在客户端被停用时抛出 UnauthorizedException', async () => {
      const inactiveClient = { ...mockClient, status: 'inactive' };
      mockPrisma.clients.findFirst.mockResolvedValue(inactiveClient);

      await expect(
        service.validateClient('test-api-key', 'test-secret'),
      ).rejects.toThrow(UnauthorizedException);
      await expect(
        service.validateClient('test-api-key', 'test-secret'),
      ).rejects.toThrow('客户端已被停用');
    });

    it('应该在 API Secret 不匹配时返回 null', async () => {
      mockPrisma.clients.findFirst.mockResolvedValue(mockClient);
      mockedBcrypt.compare.mockResolvedValue(false as never);

      const result = await service.validateClient(
        'test-api-key',
        'wrong-secret',
      );

      expect(result).toBeNull();
      expect(bcrypt.compare).toHaveBeenCalledWith(
        'wrong-secret',
        mockClient.api_secret,
      );
    });

    it('应该处理数据库查询错误', async () => {
      mockPrisma.clients.findFirst.mockRejectedValue(
        new Error('Database error'),
      );

      await expect(
        service.validateClient('test-api-key', 'test-secret'),
      ).rejects.toThrow('Database error');
    });

    it('应该处理 bcrypt 比较错误', async () => {
      mockPrisma.clients.findFirst.mockResolvedValue(mockClient);
      mockedBcrypt.compare.mockRejectedValue(
        new Error('Bcrypt error') as never,
      );

      await expect(
        service.validateClient('test-api-key', 'test-secret'),
      ).rejects.toThrow('Bcrypt error');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // recordUsage
  // ═══════════════════════════════════════════════════════════

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
      const createdRecord = {
        id: 'usage-789',
        client_id: 'client-123',
        request_id: 'req-456',
        capability_type: 'TEXT_GENERATION',
        provider: 'openai',
        model: 'gpt-4',
        status: 'success',
        usage: { inputTokens: 100, outputTokens: 200 },
        cost: 0.05,
        response_time: 1500,
        metadata: { temperature: 0.7 },
        timestamp: expect.any(Date),
      };

      mockPrisma.usage_records.create.mockResolvedValue(createdRecord);

      const result = await service.recordUsage(mockUsageData);

      expect(result).toEqual(createdRecord);
      expect(mockPrisma.usage_records.create).toHaveBeenCalledWith({
        data: {
          client_id: 'client-123',
          request_id: 'req-456',
          capability_type: 'TEXT_GENERATION',
          provider: 'openai',
          model: 'gpt-4',
          status: 'success',
          usage: { inputTokens: 100, outputTokens: 200 },
          cost: 0.05,
          response_time: 1500,
          metadata: { temperature: 0.7 },
          timestamp: expect.any(Date),
        },
      });
    });

    it('应该处理没有 usage 字段的情况', async () => {
      const dataWithoutUsage = { ...mockUsageData, usage: undefined };

      const createdRecord = {
        id: 'usage-789',
        usage: {},
        status: 'success',
      };
      mockPrisma.usage_records.create.mockResolvedValue(createdRecord);

      const result = await service.recordUsage(dataWithoutUsage);

      // 实际代码 data.usage || {} 会传 {}
      expect(mockPrisma.usage_records.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ usage: {} }),
        }),
      );
    });

    it('应该记录失败状态', async () => {
      const failedUsageData = {
        ...mockUsageData,
        status: 'failed' as const,
        cost: 0,
        metadata: { error: 'API timeout' },
      };

      const createdRecord = {
        id: 'usage-fail',
        status: 'failed',
        cost: 0,
        metadata: { error: 'API timeout' },
      };
      mockPrisma.usage_records.create.mockResolvedValue(createdRecord);

      const result = await service.recordUsage(failedUsageData);

      expect(result.status).toBe('failed');
      expect(result.cost).toBe(0);
      expect((result as any).metadata?.error).toBe('API timeout');
    });

    it('应该记录超时状态', async () => {
      const timeoutUsageData = {
        ...mockUsageData,
        status: 'timeout' as const,
      };

      const createdRecord = { id: 'usage-timeout', status: 'timeout' };
      mockPrisma.usage_records.create.mockResolvedValue(createdRecord);

      const result = await service.recordUsage(timeoutUsageData);

      expect(result.status).toBe('timeout');
    });

    it('应该处理保存错误', async () => {
      mockPrisma.usage_records.create.mockRejectedValue(
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
        usage: { imagesGenerated: 1 },
      };

      const createdRecord = {
        id: 'usage-image',
        capability_type: 'IMAGE_GENERATION',
        usage: { imagesGenerated: 1 },
      };
      mockPrisma.usage_records.create.mockResolvedValue(createdRecord);

      const result = await service.recordUsage(imageUsageData);

      expect(result.capability_type).toBe('IMAGE_GENERATION');
      expect((result as any).usage.imagesGenerated).toBe(1);
    });

    it('应该正确处理成本计算', async () => {
      const highCostData = {
        ...mockUsageData,
        usage: { inputTokens: 10000, outputTokens: 20000 },
        cost: 5.5,
      };

      const createdRecord = {
        id: 'usage-high-cost',
        cost: 5.5,
        usage: { inputTokens: 10000, outputTokens: 20000 },
      };
      mockPrisma.usage_records.create.mockResolvedValue(createdRecord);

      const result = await service.recordUsage(highCostData);

      expect(result.cost).toBe(5.5);
      expect((result as any).usage.inputTokens).toBe(10000);
      expect((result as any).usage.outputTokens).toBe(20000);
    });

    it('应该记录响应时间', async () => {
      const slowRequestData = { ...mockUsageData, responseTime: 5000 };

      const createdRecord = {
        id: 'usage-slow',
        response_time: 5000,
      };
      mockPrisma.usage_records.create.mockResolvedValue(createdRecord);

      const result = await service.recordUsage(slowRequestData);

      expect(result.response_time).toBe(5000);
    });

    it('应该处理复杂的元数据', async () => {
      const complexMetadata = {
        ...mockUsageData,
        metadata: {
          temperature: 0.9,
          maxTokens: 2000,
          nested: { data: true },
        },
      };

      const createdRecord = {
        id: 'usage-complex',
        metadata: complexMetadata.metadata,
      };
      mockPrisma.usage_records.create.mockResolvedValue(createdRecord);

      const result = await service.recordUsage(complexMetadata);

      expect(result.metadata).toEqual(complexMetadata.metadata);
      expect((result as any).metadata.nested.data).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 边缘情况
  // ═══════════════════════════════════════════════════════════

  describe('边缘情况', () => {
    it('应该处理空字符串 API Key', async () => {
      mockPrisma.clients.findFirst.mockResolvedValue(null);

      const result = await service.validateClient('', 'test-secret');

      expect(result).toBeNull();
    });

    it('应该处理空字符串 API Secret', async () => {
      mockPrisma.clients.findFirst.mockResolvedValue(mockClient);
      mockedBcrypt.compare.mockResolvedValue(false as never);

      const result = await service.validateClient('test-api-key', '');

      expect(result).toBeNull();
    });

    it('应该处理零成本的使用记录', async () => {
      const zeroCostData = {
        clientId: 'client-123',
        requestId: 'req-456',
        capabilityType: 'TEXT_GENERATION',
        provider: 'openai',
        model: 'gpt-4',
        status: 'success' as const,
        usage: { inputTokens: 0, outputTokens: 0 },
        cost: 0,
        responseTime: 100,
      };

      const createdRecord = {
        id: 'usage-zero',
        cost: 0,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
      mockPrisma.usage_records.create.mockResolvedValue(createdRecord);

      const result = await service.recordUsage(zeroCostData);

      expect(result.cost).toBe(0);
      expect((result as any).usage.inputTokens).toBe(0);
    });

    it('应该处理极短的响应时间', async () => {
      const quickRequestData = {
        clientId: 'client-123',
        requestId: 'req-quick',
        capabilityType: 'TEXT_GENERATION',
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        status: 'success' as const,
        usage: { inputTokens: 1, outputTokens: 1 },
        cost: 0.000001,
        responseTime: 1,
      };

      const createdRecord = {
        id: 'usage-quick',
        response_time: 1,
      };
      mockPrisma.usage_records.create.mockResolvedValue(createdRecord);

      const result = await service.recordUsage(quickRequestData);

      expect(result.response_time).toBe(1);
    });
  });
});
