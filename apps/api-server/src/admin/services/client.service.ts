import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import * as bcrypt from 'bcrypt';
import { Client } from '../../entities/client.entity';
import { UsageRecord } from '../../entities/usage-record.entity';
import {
  CreateClientDto,
  UpdateClientDto,
  GetClientsQueryDto,
  GetClientUsageQueryDto,
} from '../dto/client-management.dto';

@Injectable()
export class ClientService {
  constructor(
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
    @InjectRepository(UsageRecord)
    private readonly usageRecordRepository: Repository<UsageRecord>,
  ) {}

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

    const queryBuilder = this.clientRepository.createQueryBuilder('client');

    // 搜索条件
    if (keyword) {
      queryBuilder.andWhere(
        '(client.name LIKE :keyword OR client.description LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }

    if (status) {
      queryBuilder.andWhere('client.status = :status', { status });
    }

    // 排序
    queryBuilder.orderBy('client.createdAt', 'DESC');

    // 分页
    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);

    const [list, total] = await queryBuilder.getManyAndCount();

    // 隐藏 API Secret
    const sanitizedList = list.map((client) => {
      const { apiSecret, ...rest } = client;
      return {
        ...rest,
        apiSecret: '********', // 隐藏敏感信息
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
    const client = await this.clientRepository.findOne({
      where: { id },
      relations: ['permissions'],
    });

    if (!client) {
      throw new NotFoundException(`客户端 #${id} 不存在`);
    }

    const { apiSecret, ...rest } = client;
    return {
      ...rest,
      apiSecret: '********',
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

    const client = this.clientRepository.create({
      ...createClientDto,
      apiKey,
      apiSecret: hashedSecret,
      status: 'active',
    });

    const savedClient = await this.clientRepository.save(client);

    return {
      client: {
        ...savedClient,
        apiSecret: '********',
      },
      apiKey,
      apiSecret, // 仅在创建时返回明文 Secret
    };
  }

  /**
   * 更新客户端
   */
  async update(id: string, updateClientDto: UpdateClientDto) {
    const client = await this.clientRepository.findOne({ where: { id } });

    if (!client) {
      throw new NotFoundException(`客户端 #${id} 不存在`);
    }

    Object.assign(client, updateClientDto);

    const updatedClient = await this.clientRepository.save(client);

    const { apiSecret, ...rest } = updatedClient;
    return {
      ...rest,
      apiSecret: '********',
    };
  }

  /**
   * 删除客户端
   */
  async remove(id: string) {
    const client = await this.clientRepository.findOne({ where: { id } });

    if (!client) {
      throw new NotFoundException(`客户端 #${id} 不存在`);
    }

    await this.clientRepository.remove(client);

    return { message: '客户端删除成功' };
  }

  /**
   * 重新生成 API Secret
   */
  async regenerateSecret(id: string) {
    const client = await this.clientRepository.findOne({ where: { id } });

    if (!client) {
      throw new NotFoundException(`客户端 #${id} 不存在`);
    }

    const newApiSecret = this.generateApiSecret();
    const hashedSecret = await bcrypt.hash(newApiSecret, 10);

    client.apiSecret = hashedSecret;
    await this.clientRepository.save(client);

    return {
      apiKey: client.apiKey,
      apiSecret: newApiSecret, // 返回新的明文 Secret
      message: 'API Secret 已重新生成，请妥善保存',
    };
  }

  /**
   * 根据 API Key 查找客户端
   */
  async findByApiKey(apiKey: string): Promise<Client | null> {
    return this.clientRepository.findOne({ where: { apiKey } });
  }

  /**
   * 验证 API Secret
   */
  async validateApiSecret(client: Client, apiSecret: string): Promise<boolean> {
    return bcrypt.compare(apiSecret, client.apiSecret);
  }

  /**
   * 获取客户端使用统计
   */
  async getUsageStats(clientId: string, query: GetClientUsageQueryDto) {
    // 检查客户端是否存在
    const client = await this.clientRepository.findOne({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException(`客户端 #${clientId} 不存在`);
    }

    const { startDate, endDate } = query;

    // 基础统计查询
    const statsQuery = this.usageRecordRepository
      .createQueryBuilder('record')
      .where('record.clientId = :clientId', { clientId })
      .andWhere('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      });

    // 总请求数
    const totalRequests = await statsQuery.getCount();

    // 成功请求数
    const successRequests = await this.usageRecordRepository
      .createQueryBuilder('record')
      .where('record.clientId = :clientId', { clientId })
      .andWhere('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .andWhere('record.status = :status', { status: 'success' })
      .getCount();

    // 失败请求数
    const failedRequests = totalRequests - successRequests;

    // 成功率
    const successRate =
      totalRequests > 0
        ? Math.round((successRequests / totalRequests) * 10000) / 100
        : 0;

    // 聚合统计（总成本、平均响应时间、Tokens）
    const aggregateResult = await this.usageRecordRepository
      .createQueryBuilder('record')
      .select('SUM(record.cost)', 'totalCost')
      .addSelect('AVG(record.responseTime)', 'avgResponseTime')
      .addSelect("SUM((record.usage->>'inputTokens')::int)", 'totalInputTokens')
      .addSelect(
        "SUM((record.usage->>'outputTokens')::int)",
        'totalOutputTokens',
      )
      .where('record.clientId = :clientId', { clientId })
      .andWhere('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .getRawOne();

    const totalCost = parseFloat(aggregateResult.totalCost) || 0;
    const avgResponseTime = Math.round(
      parseFloat(aggregateResult.avgResponseTime) || 0,
    );
    const totalInputTokens = parseInt(aggregateResult.totalInputTokens) || 0;
    const totalOutputTokens = parseInt(aggregateResult.totalOutputTokens) || 0;
    const totalTokens = totalInputTokens + totalOutputTokens;

    // 按能力类型统计
    const byCapabilityRaw = await this.usageRecordRepository
      .createQueryBuilder('record')
      .select('record.capabilityType', 'capabilityType')
      .addSelect('COUNT(*)', 'requestCount')
      .addSelect('SUM(record.cost)', 'cost')
      .addSelect(
        "SUM((record.usage->>'inputTokens')::int + (record.usage->>'outputTokens')::int)",
        'tokens',
      )
      .where('record.clientId = :clientId', { clientId })
      .andWhere('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('record.capabilityType')
      .orderBy('requestCount', 'DESC')
      .getRawMany();

    const byCapability = byCapabilityRaw.map((item) => ({
      capabilityType: item.capabilityType,
      requestCount: parseInt(item.requestCount),
      cost: parseFloat(item.cost) || 0,
      tokens: parseInt(item.tokens) || 0,
    }));

    // 时间序列数据（按天）
    const timeSeriesRaw = await this.usageRecordRepository
      .createQueryBuilder('record')
      .select('TO_CHAR(record.timestamp, :format)', 'date')
      .addSelect('COUNT(*)', 'requests')
      .addSelect('SUM(record.cost)', 'cost')
      .addSelect(
        "SUM((record.usage->>'inputTokens')::int + (record.usage->>'outputTokens')::int)",
        'tokens',
      )
      .where('record.clientId = :clientId', { clientId })
      .andWhere('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('date')
      .orderBy('date', 'ASC')
      .setParameters({ format: 'YYYY-MM-DD' })
      .getRawMany();

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
