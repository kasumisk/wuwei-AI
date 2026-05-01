import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * V6.4 Phase 2 — Prisma 连接池配置化
 *
 * 改进：
 * - 连接池参数通过环境变量控制（DB_CONNECTION_LIMIT / DB_POOL_TIMEOUT）
 * - 非 production 启用查询日志
 * - 慢查询警告（>500ms，通过 $on('query') 事件监控）
 * - Prisma 内部警告/错误日志输出到 NestJS Logger
 *
 * 环境变量：
 * - DATABASE_URL: 数据库连接字符串（必需）
 * - DB_CONNECTION_LIMIT: 连接池大小（默认 10，根据实例 CPU 数调整）
 * - DB_POOL_TIMEOUT: 连接获取超时秒数（默认 10）
 * - DB_SLOW_QUERY_MS: 慢查询阈值毫秒（默认 500）
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly slowQueryThresholdMs: number;

  constructor(private readonly config: ConfigService) {
    const isProduction = process.env.NODE_ENV === 'production';

    // ── 连接池参数 ──
    const connectionLimit = config.get<number>('DB_CONNECTION_LIMIT', 10);
    const poolTimeout = config.get<number>('DB_POOL_TIMEOUT', 10);

    // 在 DATABASE_URL 末尾追加连接池参数（如果还没有设置的话）
    const baseUrl = config.get<string>('DATABASE_URL', '');
    const datasourceUrl = PrismaService.appendPoolParams(
      baseUrl,
      connectionLimit,
      poolTimeout,
    );

    // ── 日志级别 ──
    const logLevels: Prisma.LogLevel[] = isProduction
      ? ['warn', 'error']
      : ['query', 'warn', 'error'];

    super({
      datasourceUrl,
      log: logLevels.map((level) => ({
        level,
        emit: 'event' as const,
      })),
    });

    this.slowQueryThresholdMs = config.get<number>('DB_SLOW_QUERY_MS', 500);
  }

  async onModuleInit(): Promise<void> {
    // ── 事件监听 ──

    // 慢查询警告
    // @ts-expect-error — Prisma event types 与 TypeScript overload 存在已知不兼容
    this.$on('query', (e: Prisma.QueryEvent) => {
      if (e.duration > this.slowQueryThresholdMs) {
        this.logger.warn(
          `Slow query (${e.duration}ms): ${e.query} | params: ${e.params}`,
        );
      }
    });

    // Prisma 内部警告
    // @ts-expect-error — same as above
    this.$on('warn', (e: Prisma.LogEvent) => {
      this.logger.warn(`Prisma: ${e.message}`);
    });

    // Prisma 内部错误
    // @ts-expect-error — same as above
    this.$on('error', (e: Prisma.LogEvent) => {
      this.logger.error(`Prisma: ${e.message}`);
    });

    await this.$connect();

    this.logger.log(
      `Database connected (pool: ${this.config.get('DB_CONNECTION_LIMIT', 10)}, timeout: ${this.config.get('DB_POOL_TIMEOUT', 10)}s)`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * 在 DATABASE_URL 后追加连接池查询参数。
   *
   * 设计原则：
   * - 如果 URL 已显式声明 connection_limit / pool_timeout / pgbouncer，
   *   一概不覆盖（信任运维侧配置，例如 Neon Pooled URL 必须 connection_limit=1）。
   * - 仅在 URL 完全没声明这两个参数时，按 ENV 默认值补齐。
   * - 检测到 PgBouncer hostname（含 `-pooler`）或显式 `pgbouncer=true` 时
   *   不再追加 pool_timeout（PgBouncer 自身排队，Prisma pool_timeout 反而会导致冲突）。
   */
  private static appendPoolParams(
    url: string,
    connectionLimit: number,
    poolTimeout: number,
  ): string {
    if (!url) return url;

    try {
      const u = new URL(url);
      const isPgBouncer =
        u.searchParams.get('pgbouncer') === 'true' ||
        u.hostname.includes('-pooler') ||
        u.hostname.includes('pgbouncer');

      if (!u.searchParams.has('connection_limit')) {
        // PgBouncer 推荐 connection_limit=1（每个 Prisma client 单连接，由 PgBouncer 复用）
        const limit = isPgBouncer ? 1 : connectionLimit;
        u.searchParams.set('connection_limit', String(limit));
      }
      if (!u.searchParams.has('pool_timeout') && !isPgBouncer) {
        u.searchParams.set('pool_timeout', String(poolTimeout));
      }

      return u.toString();
    } catch {
      // URL 解析失败（例如使用 prisma:// 协议），降级直接返回
      return url;
    }
  }
}
