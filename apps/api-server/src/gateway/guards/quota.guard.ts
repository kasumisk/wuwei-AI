import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsageRecord } from '../../entities/usage-record.entity';

// 简单的内存缓存（生产环境应使用 Redis）
const quotaCache = new Map<string, { value: number; expiresAt: number }>();

@Injectable()
export class QuotaGuard implements CanActivate {
  constructor(
    @InjectRepository(UsageRecord)
    private readonly usageRecordRepository: Repository<UsageRecord>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const client = request.client;
    const permission = request.permission;
    const capabilityType = request.capabilityType;

    // 1. 检查 Client 级别的成本配额（美元）
    if (client?.quotaConfig) {
      const { dailyQuota, monthlyQuota } = client.quotaConfig;

      // 检查日配额
      if (dailyQuota && dailyQuota > 0) {
        const dailyUsage = await this.getDailyCostUsage(client.id);
        if (dailyUsage >= dailyQuota) {
          throw new ForbiddenException(
            `已超出日成本配额 $${dailyQuota}（已使用: $${dailyUsage.toFixed(2)}）`,
          );
        }
      }

      // 检查月配额
      if (monthlyQuota && monthlyQuota > 0) {
        const monthlyUsage = await this.getMonthlyCostUsage(client.id);
        if (monthlyUsage >= monthlyQuota) {
          throw new ForbiddenException(
            `已超出月成本配额 $${monthlyQuota}（已使用: $${monthlyUsage.toFixed(2)}）`,
          );
        }
      }
    }

    // 2. 检查 Permission 级别的使用量配额（token/图片数）
    if (permission?.quotaLimit && capabilityType) {
      const usage = await this.getCapabilityUsage(client.id, capabilityType);
      if (usage >= permission.quotaLimit) {
        throw new ForbiddenException(
          `${capabilityType} 能力已超出配额限制（${permission.quotaLimit.toLocaleString()}）`,
        );
      }
    }

    // 3. 检查单次请求成本限制（预估）
    if (permission?.config?.costLimit) {
      const estimatedCost = this.estimateRequestCost(
        request.body,
        capabilityType,
      );
      if (estimatedCost > permission.config.costLimit) {
        throw new ForbiddenException(
          `预估成本 $${estimatedCost.toFixed(4)} 超过单次限制 $${permission.config.costLimit}`,
        );
      }
    }

    return true;
  }

  /**
   * 获取客户端今日成本使用额度
   */
  private async getDailyCostUsage(clientId: string): Promise<number> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const cacheKey = `daily_cost:${clientId}:${today.toISOString().split('T')[0]}`;
    const now = Date.now();
    const cached = quotaCache.get(cacheKey);
    if (cached && now < cached.expiresAt) {
      return cached.value;
    }

    const result = await this.usageRecordRepository
      .createQueryBuilder('record')
      .select('SUM(record.cost)', 'total')
      .where('record.clientId = :clientId', { clientId })
      .andWhere('record.timestamp >= :start', { start: today })
      .andWhere('record.timestamp < :end', { end: tomorrow })
      .getRawOne();

    const total = parseFloat(result?.total) || 0;
    quotaCache.set(cacheKey, { value: total, expiresAt: now + 5 * 60 * 1000 });

    return total;
  }

  /**
   * 获取客户端本月成本使用额度
   */
  private async getMonthlyCostUsage(clientId: string): Promise<number> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const cacheKey = `monthly_cost:${clientId}:${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const nowMs = Date.now();
    const cached = quotaCache.get(cacheKey);
    if (cached && nowMs < cached.expiresAt) {
      return cached.value;
    }

    const result = await this.usageRecordRepository
      .createQueryBuilder('record')
      .select('SUM(record.cost)', 'total')
      .where('record.clientId = :clientId', { clientId })
      .andWhere('record.timestamp >= :start', { start: monthStart })
      .andWhere('record.timestamp < :end', { end: monthEnd })
      .getRawOne();

    const total = parseFloat(result?.total) || 0;
    quotaCache.set(cacheKey, {
      value: total,
      expiresAt: nowMs + 10 * 60 * 1000,
    });

    return total;
  }

  /**
   * 获取能力级别的使用量（token 数或图片数）
   */
  private async getCapabilityUsage(
    clientId: string,
    capabilityType: string,
  ): Promise<number> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const cacheKey = `capability:${clientId}:${capabilityType}:${now.getFullYear()}-${now.getMonth() + 1}`;
    const cached = quotaCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }

    let total = 0;

    if (capabilityType.startsWith('text.')) {
      // 统计 token 总数
      const result = await this.usageRecordRepository
        .createQueryBuilder('record')
        .select("SUM(CAST(record.usage->>'totalTokens' AS INTEGER))", 'total')
        .where('record.clientId = :clientId', { clientId })
        .andWhere('record.capabilityType = :capabilityType', { capabilityType })
        .andWhere('record.timestamp >= :start', { start: monthStart })
        .getRawOne();

      total = parseInt(result?.total) || 0;
    } else if (capabilityType.startsWith('image.')) {
      // 统计图片数量
      const result = await this.usageRecordRepository
        .createQueryBuilder('record')
        .select("SUM(CAST(record.usage->>'imageCount' AS INTEGER))", 'total')
        .where('record.clientId = :clientId', { clientId })
        .andWhere('record.capabilityType = :capabilityType', { capabilityType })
        .andWhere('record.timestamp >= :start', { start: monthStart })
        .getRawOne();

      total = parseInt(result?.total) || 0;
    }

    quotaCache.set(cacheKey, {
      value: total,
      expiresAt: Date.now() + 5 * 60 * 1000,
    });

    return total;
  }

  /**
   * 预估请求成本
   */
  private estimateRequestCost(body: any, capabilityType?: string): number {
    // 简单的成本预估逻辑
    if (capabilityType?.startsWith('text.')) {
      const maxTokens = body.maxTokens || 1000;
      const promptLength = (body.prompt || '').length;
      const estimatedInputTokens = Math.ceil(promptLength / 4); // 粗略估计

      // 假设平均成本 $0.01/1K tokens
      return ((estimatedInputTokens + maxTokens) / 1000) * 0.01;
    } else if (capabilityType?.startsWith('image.')) {
      const count = body.n || 1;
      // 假设平均成本 $0.04/图
      return count * 0.04;
    }

    return 0;
  }
}
