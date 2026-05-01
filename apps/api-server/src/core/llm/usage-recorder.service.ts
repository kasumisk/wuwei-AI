/**
 * UsageRecorder — fire-and-forget 写 `usage_records`
 *
 * 设计：
 *  - 主流程不能因为 metric 落库失败而失败，所以全部 catch 后只记日志
 *  - 全部走 prisma.$queryRaw，避免 schema 字段 rename 影响
 *  - 不在事务里跑（避免长事务持锁）
 *
 * 字段映射：
 *  - clientId 必填（schema 强制）；系统调用时使用环境变量 `SYSTEM_CLIENT_ID`
 *    或一个保留 UUID（默认 `00000000-0000-0000-0000-000000000000`）
 *  - capabilityType = LlmFeature 字符串值
 *  - status: success | failed | timeout
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmFeature, LlmTokenUsage, LlmProvider } from './llm.types';

export interface UsageRecordInput {
  clientId: string;
  /** 发起调用的用户 ID（可选，系统级任务传 undefined） */
  userId?: string;
  requestId: string;
  feature: LlmFeature;
  provider: LlmProvider;
  model: string;
  status: 'success' | 'failed' | 'timeout';
  usage: LlmTokenUsage;
  costUsd: number;
  responseTimeMs: number;
  metadata?: Record<string, unknown>;
}

const SYSTEM_CLIENT_FALLBACK = '00000000-0000-0000-0000-000000000000';

@Injectable()
export class UsageRecorderService {
  private readonly logger = new Logger(UsageRecorderService.name);
  private readonly systemClientId: string;

  constructor(private readonly prisma: PrismaService) {
    this.systemClientId =
      process.env.SYSTEM_CLIENT_ID?.trim() || SYSTEM_CLIENT_FALLBACK;
  }

  /**
   * 异步记录一次 LLM 调用。永远不会抛错。
   * 调用方应直接 `void recorder.record(...)` 不 await。
   */
  record(input: UsageRecordInput): void {
    // 不 await — fire & forget。失败只记日志。
    this.persist(input).catch((err) => {
      this.logger.error(
        `Failed to persist usage record (feature=${input.feature}, requestId=${input.requestId}): ${err?.message ?? err}`,
      );
    });
  }

  private async persist(input: UsageRecordInput): Promise<void> {
    const clientId = this.normalizeClientId(input.clientId);
    await this.prisma.usageRecords.create({
      data: {
        clientId,
        userId: input.userId ?? null,
        requestId: input.requestId,
        capabilityType: input.feature,
        provider: input.provider,
        model: input.model,
        status: input.status,
        usage: {
          prompt_tokens: input.usage.promptTokens,
          completion_tokens: input.usage.completionTokens,
          total_tokens: input.usage.totalTokens,
        },
        cost: input.costUsd.toFixed(6),
        responseTime: Math.round(input.responseTimeMs),
        metadata: (input.metadata ?? null) as never,
      },
    });
  }

  /** 客户端 ID 可能为 undefined（系统调用），统一回填 system uuid */
  private normalizeClientId(input: string | undefined): string {
    if (!input || !this.isUuid(input)) {
      return this.systemClientId;
    }
    return input;
  }

  private isUuid(v: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      v,
    );
  }
}
