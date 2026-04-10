import { Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../core/prisma/prisma.service';
import { CapabilityRouter } from './services/capability-router.service';

@Injectable()
export class GatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilityRouter: CapabilityRouter,
  ) {}

  /**
   * 验证客户端 API Key 和 Secret
   */
  async validateClient(apiKey: string, apiSecret: string) {
    const client = await this.prisma.clients.findFirst({
      where: { api_key: apiKey },
    });

    if (!client) {
      return null;
    }

    // 检查客户端状态
    if (client.status !== 'active') {
      throw new UnauthorizedException('客户端已被停用');
    }

    // 验证 API Secret
    const isValid = await bcrypt.compare(apiSecret, client.api_secret);
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
  }) {
    return await this.prisma.usage_records.create({
      data: {
        client_id: data.clientId,
        request_id: data.requestId,
        capability_type: data.capabilityType,
        provider: data.provider,
        model: data.model,
        status: data.status,
        usage: data.usage || {},
        cost: data.cost,
        response_time: data.responseTime,
        metadata: data.metadata,
        timestamp: new Date(),
      },
    });
  }
}
