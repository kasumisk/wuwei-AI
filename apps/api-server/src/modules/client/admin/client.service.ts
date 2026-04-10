import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  CreateClientDto,
  UpdateClientDto,
  GetClientsQueryDto,
  GetClientUsageQueryDto,
} from './dto/client-management.dto';

@Injectable()
export class ClientService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 生成 API Key
   */
  private generateApiKey(): string {
    const randomString = crypto.randomBytes(16).toString('hex');
    return `ak_${randomString}`;
  }

  /**
   * 生成 API Secret
   */
  private generateApiSecret(): string {
    const randomString = crypto.randomBytes(32).toString('hex');
    return `sk_${randomString}`;
  }

  /**
   * 获取客户端列表（分页）
   */
  async findAll(query: GetClientsQueryDto) {
    const { page = 1, pageSize = 10, keyword, status } = query;

    const where: Prisma.clientsWhereInput = {};

    // 搜索条件
    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    // 分页
    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.clients.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.clients.count({ where }),
    ]);

    // 隐藏 API Secret
    const sanitizedList = list.map((client) => {
      const { api_secret, ...rest } = client;
      return {
        ...rest,
        api_secret: '********', // 隐藏敏感信息
      };
    });

    return {
      list: sanitizedList,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取客户端详情
   */
  async findOne(id: string) {
    const client = await this.prisma.clients.findUnique({
      where: { id },
      include: { client_capability_permissions: true },
    });

    if (!client) {
      throw new NotFoundException(`客户端 #${id} 不存在`);
    }

    const { api_secret, ...rest } = client;
    return {
      ...rest,
      api_secret: '********',
    };
  }

  /**
   * 创建客户端
   */
  async create(createClientDto: CreateClientDto) {
    // 生成 API Key 和 Secret
    const apiKey = this.generateApiKey();
    const apiSecret = this.generateApiSecret();
    const hashedSecret = await bcrypt.hash(apiSecret, 10);

    const savedClient = await this.prisma.clients.create({
      data: {
        ...createClientDto,
        metadata: createClientDto.metadata as any,
        api_key: apiKey,
        api_secret: hashedSecret,
        status: 'active',
      },
    });

    return {
      client: {
        ...savedClient,
        api_secret: '********',
      },
      apiKey,
      apiSecret, // 仅在创建时返回明文 Secret
    };
  }

  /**
   * 更新客户端
   */
  async update(id: string, updateClientDto: UpdateClientDto) {
    const client = await this.prisma.clients.findUnique({ where: { id } });

    if (!client) {
      throw new NotFoundException(`客户端 #${id} 不存在`);
    }

    const updatedClient = await this.prisma.clients.update({
      where: { id },
      data: {
        ...updateClientDto,
        metadata: updateClientDto.metadata as any,
      },
    });

    const { api_secret, ...rest } = updatedClient;
    return {
      ...rest,
      api_secret: '********',
    };
  }

  /**
   * 删除客户端
   */
  async remove(id: string) {
    const client = await this.prisma.clients.findUnique({ where: { id } });

    if (!client) {
      throw new NotFoundException(`客户端 #${id} 不存在`);
    }

    await this.prisma.clients.delete({ where: { id } });

    return { message: '客户端删除成功' };
  }

  /**
   * 重新生成 API Secret
   */
  async regenerateSecret(id: string) {
    const client = await this.prisma.clients.findUnique({ where: { id } });

    if (!client) {
      throw new NotFoundException(`客户端 #${id} 不存在`);
    }

    const newApiSecret = this.generateApiSecret();
    const hashedSecret = await bcrypt.hash(newApiSecret, 10);

    await this.prisma.clients.update({
      where: { id },
      data: { api_secret: hashedSecret },
    });

    return {
      apiKey: client.api_key,
      apiSecret: newApiSecret, // 返回新的明文 Secret
      message: 'API Secret 已重新生成，请妥善保存',
    };
  }

  /**
   * 根据 API Key 查找客户端
   */
  async findByApiKey(apiKey: string) {
    return this.prisma.clients.findFirst({ where: { api_key: apiKey } });
  }

  /**
   * 验证 API Secret
   */
  async validateApiSecret(
    client: { api_secret: string },
    apiSecret: string,
  ): Promise<boolean> {
    return bcrypt.compare(apiSecret, client.api_secret);
  }

  /**
   * 获取客户端使用统计
   */
  async getUsageStats(clientId: string, query: GetClientUsageQueryDto) {
    // 检查客户端是否存在
    const client = await this.prisma.clients.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException(`客户端 #${clientId} 不存在`);
    }

    const { startDate, endDate } = query;

    // 总请求数
    const totalRequests = await this.prisma.usage_records.count({
      where: {
        client_id: clientId,
        timestamp: { gte: new Date(startDate), lte: new Date(endDate) },
      },
    });

    // 成功请求数
    const successRequests = await this.prisma.usage_records.count({
      where: {
        client_id: clientId,
        timestamp: { gte: new Date(startDate), lte: new Date(endDate) },
        status: 'success',
      },
    });

    // 失败请求数
    const failedRequests = totalRequests - successRequests;

    // 成功率
    const successRate =
      totalRequests > 0
        ? Math.round((successRequests / totalRequests) * 10000) / 100
        : 0;

    // 聚合统计（总成本、平均响应时间、Tokens）
    const aggregateResult: any[] = await this.prisma.$queryRaw(Prisma.sql`
      SELECT
        SUM(cost) AS "totalCost",
        AVG(response_time) AS "avgResponseTime",
        SUM((usage->>'inputTokens')::int) AS "totalInputTokens",
        SUM((usage->>'outputTokens')::int) AS "totalOutputTokens"
      FROM usage_records
      WHERE client_id = ${clientId}
        AND timestamp BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}
    `);

    const agg = aggregateResult[0] || {};
    const totalCost = parseFloat(agg.totalCost) || 0;
    const avgResponseTime = Math.round(parseFloat(agg.avgResponseTime) || 0);
    const totalInputTokens = parseInt(agg.totalInputTokens) || 0;
    const totalOutputTokens = parseInt(agg.totalOutputTokens) || 0;
    const totalTokens = totalInputTokens + totalOutputTokens;

    // 按能力类型统计
    const byCapabilityRaw: any[] = await this.prisma.$queryRaw(Prisma.sql`
      SELECT
        capability_type AS "capabilityType",
        COUNT(*) AS "requestCount",
        SUM(cost) AS "cost",
        SUM((usage->>'inputTokens')::int + (usage->>'outputTokens')::int) AS "tokens"
      FROM usage_records
      WHERE client_id = ${clientId}
        AND timestamp BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}
      GROUP BY capability_type
      ORDER BY COUNT(*) DESC
    `);

    const byCapability = byCapabilityRaw.map((item) => ({
      capabilityType: item.capabilityType,
      requestCount: parseInt(item.requestCount),
      cost: parseFloat(item.cost) || 0,
      tokens: parseInt(item.tokens) || 0,
    }));

    // 时间序列数据（按天）
    const timeSeriesRaw: any[] = await this.prisma.$queryRaw(Prisma.sql`
      SELECT
        TO_CHAR(timestamp, 'YYYY-MM-DD') AS "date",
        COUNT(*) AS "requests",
        SUM(cost) AS "cost",
        SUM((usage->>'inputTokens')::int + (usage->>'outputTokens')::int) AS "tokens"
      FROM usage_records
      WHERE client_id = ${clientId}
        AND timestamp BETWEEN ${new Date(startDate)} AND ${new Date(endDate)}
      GROUP BY TO_CHAR(timestamp, 'YYYY-MM-DD')
      ORDER BY "date" ASC
    `);

    const timeSeries = timeSeriesRaw.map((item) => ({
      date: item.date,
      requests: parseInt(item.requests),
      cost: parseFloat(item.cost) || 0,
      tokens: parseInt(item.tokens) || 0,
    }));

    return {
      totalRequests,
      successRequests,
      failedRequests,
      successRate,
      avgResponseTime,
      totalCost,
      totalInputTokens,
      totalOutputTokens,
      totalTokens,
      byCapability,
      timeSeries,
    };
  }
}
