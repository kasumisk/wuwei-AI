/**
 * IdempotencyService — 基于 Postgres 的幂等执行器
 *
 * 设计目的：
 *   - 替代 Redis setNX 用于关键链路（subscription/payment webhook、Cloud Tasks
 *     handler、Scheduler cron）。Redis 锁在 Upstash 限流下会失败，导致重复执行
 *     或漏执行；Postgres 唯一索引可绝对保证 (scope, key) 在并发下只有一行成功。
 *
 * 执行语义：
 *   - 首次到达：插入 status=pending → 执行 fn → 更新 succeeded/failed → 返回结果。
 *   - 并发到达：唯一索引冲突 → 命中 wait/replay 分支：
 *       a) 已 succeeded → 直接返回 result（如有），否则返回 undefined（表示 noop）。
 *       b) 仍 pending → 抛 IdempotencyInFlightError，调用方决定 503 / Cloud Tasks 重试。
 *       c) 已 failed → 重新执行（典型 webhook 重试场景）；如果不希望重试，调用方传 retryFailed=false。
 *   - fn 抛错：写 failed + errorMessage，再向上抛。
 *
 * 不做的事：
 *   - 不做"等待首次执行完成"的 polling。复杂度高、对 DB 不友好；让上游（Cloud Tasks/
 *     Scheduler）按 backoff 重试，下次到达时如果首次已完成会直接 replay。
 *
 * 适用 scope 命名约定：
 *   - "rc-webhook"            RevenueCat webhook event_id
 *   - "task:<queue-name>"     Cloud Tasks 单个任务幂等（key = taskId 或业务键）
 *   - "cron:<cron-name>"      Cloud Scheduler 触发的 cron（key = 触发时间窗口字符串）
 *   - "internal:<purpose>"    其它内部用途
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export class IdempotencyInFlightError extends Error {
  constructor(scope: string, key: string) {
    super(`Idempotency in-flight: scope=${scope} key=${key}`);
    this.name = 'IdempotencyInFlightError';
  }
}

export interface RunIdempotentOptions {
  /** 业务域，如 "task:food-analysis" */
  scope: string;
  /** 幂等键，如 webhook event_id / Cloud Tasks taskId */
  key: string;
  /** 失败后是否允许下次重试再次执行 fn（默认 true） */
  retryFailed?: boolean;
  /** TTL（秒）；用于 expires_at 字段，定期清理任务用。默认 30 天。 */
  ttlSeconds?: number;
}

export interface RunIdempotentResult<T> {
  /** 是否本次实际执行了 fn（false = replay） */
  executed: boolean;
  /** 上次或本次结果。replay 命中且历史 result 为 NULL 时返回 undefined。 */
  result?: T;
}

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private static readonly DEFAULT_TTL_SECONDS = 30 * 24 * 60 * 60;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 以 (scope, key) 幂等执行 fn。
   * - 首次执行：返回 { executed: true, result }。
   * - 重复到达且首次成功：返回 { executed: false, result: 历史结果 }。
   * - 重复到达且首次仍 pending：抛 IdempotencyInFlightError。
   * - 重复到达且首次失败：根据 retryFailed 决定重跑或抛错。
   *
   * 注意：若 fn 返回结果不可序列化为 JSON（含 BigInt、循环引用等），
   * result 不会被持久化（catch 后写 NULL），但 status 仍正确。
   */
  async runIdempotent<T>(
    opts: RunIdempotentOptions,
    fn: () => Promise<T>,
    _depth = 0,
  ): Promise<RunIdempotentResult<T>> {
    if (_depth > 3) {
      throw new Error(
        `Idempotency runIdempotent exceeded max recursion depth: scope=${opts.scope} key=${opts.key}`,
      );
    }
    const { scope, key } = opts;
    const retryFailed = opts.retryFailed ?? true;
    const ttlSeconds = opts.ttlSeconds ?? IdempotencyService.DEFAULT_TTL_SECONDS;
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    // 1) 尝试占位（INSERT pending）。冲突立即转入重复处理分支。
    let acquired = false;
    try {
      await this.prisma.idempotencyKey.create({
        data: {
          scope,
          key,
          status: 'pending',
          expiresAt,
        },
      });
      acquired = true;
    } catch (err) {
      if (!this.isUniqueViolation(err)) throw err;
    }

    if (acquired) {
      return await this.executeAndFinalize(scope, key, fn);
    }

    // 2) 重复到达：读取既有记录决定动作。
    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (!existing) {
      // 极少见竞态：插入冲突但记录被删。重新插一次。
      return this.runIdempotent(opts, fn, _depth + 1);
    }

    if (existing.status === 'succeeded') {
      this.logger.debug(`Idempotency replay (succeeded): ${scope}/${key}`);
      return {
        executed: false,
        result: (existing.result as T | null) ?? undefined,
      };
    }

    if (existing.status === 'pending') {
      throw new IdempotencyInFlightError(scope, key);
    }

    // status === 'failed'
    if (!retryFailed) {
      this.logger.debug(`Idempotency replay (failed, no retry): ${scope}/${key}`);
      return {
        executed: false,
        result: (existing.result as T | null) ?? undefined,
      };
    }

    // 重试：把 failed 行回滚到 pending，再执行。
    // 这里用 updateMany + status='failed' 作为乐观条件，避免抢回已被并发线程刚改成 pending 的行。
    const updated = await this.prisma.idempotencyKey.updateMany({
      where: { scope, key, status: 'failed' },
      data: {
        status: 'pending',
        errorMessage: null,
        completedAt: null,
        expiresAt,
      },
    });
    if (updated.count === 0) {
      // 另一个进程刚刚抢先重试并占位。视作 in-flight，让上游 backoff。
      throw new IdempotencyInFlightError(scope, key);
    }

    return await this.executeAndFinalize(scope, key, fn);
  }

  // ─── private ───────────────────────────────────────────────────────────

  private async executeAndFinalize<T>(
    scope: string,
    key: string,
    fn: () => Promise<T>,
  ): Promise<RunIdempotentResult<T>> {
    try {
      const result = await fn();
      const safeResult = this.toJsonOrNull(result);
      await this.prisma.idempotencyKey.update({
        where: { scope_key: { scope, key } },
        data: {
          status: 'succeeded',
          result: safeResult,
          completedAt: new Date(),
        },
      });
      return { executed: true, result };
    } catch (err) {
      const message =
        err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000);
      await this.prisma.idempotencyKey
        .update({
          where: { scope_key: { scope, key } },
          data: {
            status: 'failed',
            errorMessage: message,
            completedAt: new Date(),
          },
        })
        .catch((updateErr) => {
          this.logger.error(
            `Failed to mark idempotency key as failed: ${scope}/${key}`,
            updateErr instanceof Error ? updateErr.stack : String(updateErr),
          );
        });
      throw err;
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
    );
  }

  private toJsonOrNull(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
    if (value === undefined || value === null) return Prisma.JsonNull;
    try {
      // 通过 JSON 往返一次确保可序列化
      return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    } catch {
      this.logger.warn('Idempotency result not JSON-serializable; storing NULL');
      return Prisma.JsonNull;
    }
  }
}
