/**
 * UsageArchiveCronService — usage_records 冷归档定时任务
 *
 * 策略：
 *  - 每日凌晨 2:00 UTC 执行（Cloud Run 低峰期）
 *  - 将 timestamp < NOW() - ARCHIVE_DAYS（默认 90 天）的记录
 *    批量 INSERT INTO usage_records_archive ... SELECT，然后 DELETE
 *  - 分批次执行（BATCH_SIZE=500），避免长事务锁表
 *  - 整个归档过程在同一事务内（INSERT + DELETE 原子），防止数据丢失
 *  - 记录归档行数 / 耗时到日志，方便运维观察
 *
 * 为什么不用 partition：
 *  Neon Serverless Postgres 暂不支持声明式分区（Declarative Partitioning）
 *  的自动裂变，手动归档更易控制且无需改现有 ORM 查询。
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { CronBackend, CronHandlerRegistry } from '../cron';

/** 超过此天数的记录移入归档表 */
const ARCHIVE_DAYS = 90;

/** 每批处理行数（避免单次事务过大） */
const BATCH_SIZE = 500;

/** 单次 cron 最多归档批次（防止 Cloud Run 超时） */
const MAX_BATCHES_PER_RUN = 40; // 最多 20,000 行/次

@Injectable()
export class UsageArchiveCronService implements OnModuleInit {
  private readonly logger = new Logger(UsageArchiveCronService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cronBackend: CronBackend,
    private readonly cronRegistry: CronHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.cronRegistry.register('usage-archive', () => this.runArchiveCron());
  }

  /**
   * 每日 UTC 02:00 执行归档
   * 若需手动触发，可直接调用 archiveOldRecords()
   */
  @Cron('0 2 * * *', { name: 'usage-archive', timeZone: 'UTC' })
  async runArchiveCronTick(): Promise<void> {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.runArchiveCron();
  }

  async runArchiveCron(): Promise<void> {
    this.logger.log('Usage archive cron started');
    const start = Date.now();

    try {
      const { totalArchived, batches } = await this.archiveOldRecords();
      this.logger.log(
        `Usage archive done: archived=${totalArchived} rows, batches=${batches}, ` +
          `elapsed=${Date.now() - start}ms`,
      );
    } catch (err) {
      this.logger.error(
        `Usage archive cron failed: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /**
   * 归档旧记录（可被手动调用 / 测试）
   *
   * @returns 本次归档的总行数和批次数
   */
  async archiveOldRecords(): Promise<{
    totalArchived: number;
    batches: number;
  }> {
    const cutoff = new Date(Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000);
    let totalArchived = 0;
    let batches = 0;

    for (let i = 0; i < MAX_BATCHES_PER_RUN; i++) {
      const archived = await this.archiveBatch(cutoff);
      if (archived === 0) break;

      totalArchived += archived;
      batches++;

      // 短暂让出事件循环，避免饿死其他请求
      await this.sleep(10);
    }

    return { totalArchived, batches };
  }

  /**
   * 单批次归档：在事务中先 INSERT SELECT，再 DELETE（原子）
   *
   * 使用 $queryRaw 绕过 Prisma 不支持 INSERT ... SELECT 的限制。
   * 返回本批次实际归档行数（0 = 无更多数据）。
   */
  private async archiveBatch(cutoff: Date): Promise<number> {
    return this.prisma.$transaction(async (tx) => {
      // 1. 取出要归档的 ID（批量上限）
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM usage_records
        WHERE timestamp < ${cutoff}
        ORDER BY timestamp ASC
        LIMIT ${BATCH_SIZE}
      `;

      if (rows.length === 0) return 0;

      const ids = rows.map((r) => r.id);

      // 2. INSERT INTO archive ... SELECT（一次 SQL，避免应用层搬运数据）
      await tx.$executeRaw`
        INSERT INTO usage_records_archive
          (id, client_id, user_id, request_id, capability_type, provider, model,
           status, usage, cost, response_time, metadata, timestamp, archived_at)
        SELECT
          id, client_id, user_id, request_id, capability_type, provider, model,
          status, usage, cost, response_time, metadata, timestamp, NOW()
        FROM usage_records
        WHERE id = ANY(${ids}::uuid[])
        ON CONFLICT (id) DO NOTHING
      `;

      // 3. DELETE 原始记录
      await tx.$executeRaw`
        DELETE FROM usage_records
        WHERE id = ANY(${ids}::uuid[])
      `;

      return rows.length;
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
