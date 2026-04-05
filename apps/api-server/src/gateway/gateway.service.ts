import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Client } from '../entities/client.entity';
import { UsageRecord } from '../entities/usage-record.entity';
import { CapabilityRouter } from './services/capability-router.service';

@Injectable()
export class GatewayService {
  constructor(
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
    @InjectRepository(UsageRecord)
    private readonly usageRecordRepository: Repository<UsageRecord>,
    private readonly capabilityRouter: CapabilityRouter,
  ) {}

  /**
   * 验证客户端 API Key 和 Secret
   */
  async validateClient(
    apiKey: string,
    apiSecret: string,
  ): Promise<Client | null> {
    const client = await this.clientRepository.findOne({
      where: { apiKey },
    });

    if (!client) {
      return null;
    }

    // 检查客户端状态
    if (client.status !== 'active') {
      throw new UnauthorizedException('客户端已被停用');
    }

    // 验证 API Secret
    const isValid = await bcrypt.compare(apiSecret, client.apiSecret);
    if (!isValid) {
      return null;
    }

    return client;
  }

  /**
   * 记录使用情况
   */
  async recordUsage(data: {
    clientId: string;
    requestId: string;
    capabilityType: string;
    provider: string;
    model: string;
    status: 'success' | 'failed' | 'timeout';
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      [key: string]: any;
    };
    cost: number;
    responseTime: number;
    metadata?: any;
  }): Promise<UsageRecord> {
    const usageRecord = this.usageRecordRepository.create({
      clientId: data.clientId,
      requestId: data.requestId,
      capabilityType: data.capabilityType,
      provider: data.provider,
      model: data.model,
      status: data.status,
      usage: data.usage || {},
      cost: data.cost,
      responseTime: data.responseTime,
      metadata: data.metadata,
      timestamp: new Date(),
    });

    return await this.usageRecordRepository.save(usageRecord);
  }
}
