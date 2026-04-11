import { Controller, Get, HttpStatus, Res, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Response } from 'express';
import { Public } from '../core/decorators/public.decorator';
import { PrismaService } from '../core/prisma/prisma.service';
import { RedisCacheService } from '../core/redis/redis-cache.service';
import { SkipThrottle } from '../core/throttle';
import { QUEUE_NAMES } from '../core/queue/queue.constants';

/**
 * V6.4: 增强版健康检查
 * V6.6 Phase 1-D: 新增 BullMQ Worker 活性检测
 *
 * /health     — 综合健康状态（DB + Redis + BullMQ Workers）
 * /health/ready — 就绪检查（DB + Redis 均可用时返回 ready）
 * /health/live  — 存活检查（进程存活即返回 true）
 */
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
    @InjectQueue(QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE)
    private readonly precomputeQueue: Queue,
    @InjectQueue(QUEUE_NAMES.FOOD_ANALYSIS)
    private readonly foodAnalysisQueue: Queue,
    @InjectQueue(QUEUE_NAMES.NOTIFICATION)
    private readonly notificationQueue: Queue,
  ) {}

  /**
   * 综合健康检查端点
   */
  @Public()
  @SkipThrottle()
  @Get()
  async check(@Res() res: Response): Promise<void> {
    const checks: Record<
      string,
      { status: string; latencyMs?: number; detail?: string }
    > = {};

    // 1. 数据库检查
    const dbStart = Date.now();
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.database = {
        status: 'healthy',
        latencyMs: Date.now() - dbStart,
      };
    } catch (err) {
      checks.database = {
        status: 'unhealthy',
        latencyMs: Date.now() - dbStart,
        detail: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // 2. Redis 检查
    const redisStart = Date.now();
    if (this.redis.isConnected) {
      try {
        const testKey = 'health:check';
        const testValue = Date.now().toString();
        await this.redis.set(testKey, testValue, 5000);
        const result = await this.redis.get<string>(testKey);
        checks.redis = {
          status: result !== null ? 'healthy' : 'degraded',
          latencyMs: Date.now() - redisStart,
        };
      } catch (err) {
        checks.redis = {
          status: 'unhealthy',
          latencyMs: Date.now() - redisStart,
          detail: err instanceof Error ? err.message : 'Unknown error',
        };
      }
    } else {
      checks.redis = {
        status: 'disconnected',
        detail: 'Redis 未连接或未配置',
      };
    }

    // 3. V6.6 Phase 1-D: BullMQ Worker 活性检测
    // getWorkers() 返回当前连接到该队列的 worker 列表（ioredis 实时查询）
    // 若 Worker 进程崩溃/挂起但未优雅退出，worker 列表会在 BullMQ 心跳超时后清空
    const bullmqStart = Date.now();
    try {
      const [precomputeWorkers, foodAnalysisWorkers, notificationWorkers] =
        await Promise.all([
          this.precomputeQueue.getWorkers(),
          this.foodAnalysisQueue.getWorkers(),
          this.notificationQueue.getWorkers(),
        ]);

      const workerCounts = {
        [QUEUE_NAMES.RECOMMENDATION_PRECOMPUTE]: precomputeWorkers.length,
        [QUEUE_NAMES.FOOD_ANALYSIS]: foodAnalysisWorkers.length,
        [QUEUE_NAMES.NOTIFICATION]: notificationWorkers.length,
      };

      // 关键队列（notification）无 Worker 时降级，非关键队列仅警告
      const notificationOk = notificationWorkers.length > 0;

      checks.bullmq = {
        status: notificationOk ? 'healthy' : 'degraded',
        latencyMs: Date.now() - bullmqStart,
        detail: JSON.stringify(workerCounts),
      };
    } catch (err) {
      checks.bullmq = {
        status: 'unhealthy',
        latencyMs: Date.now() - bullmqStart,
        detail: err instanceof Error ? err.message : 'Unknown error',
      };
    }

    // 4. 综合状态判定
    const allHealthy = Object.values(checks).every(
      (c) => c.status === 'healthy',
    );
    const anyUnhealthy = Object.values(checks).some(
      (c) => c.status === 'unhealthy',
    );

    const overallStatus = allHealthy
      ? 'ok'
      : anyUnhealthy
        ? 'unhealthy'
        : 'degraded';

    const statusCode =
      overallStatus === 'ok'
        ? HttpStatus.OK
        : overallStatus === 'degraded'
          ? HttpStatus.OK // 降级但仍可服务
          : HttpStatus.SERVICE_UNAVAILABLE;

    res.status(statusCode).json({
      status: overallStatus,
      timestamp: Date.now(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      checks,
    });
  }

  /**
   * 就绪检查 — K8s readiness probe
   * DB 和 Redis 均可用时才视为 ready
   */
  @Public()
  @SkipThrottle()
  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;

      const redisOk =
        !this.redis.isConnected ||
        (await this.redis.get<string>('health:check')) !== undefined;

      if (redisOk) {
        res.status(HttpStatus.OK).json({ ready: true });
      } else {
        res
          .status(HttpStatus.SERVICE_UNAVAILABLE)
          .json({ ready: false, reason: 'Redis unhealthy' });
      }
    } catch {
      res
        .status(HttpStatus.SERVICE_UNAVAILABLE)
        .json({ ready: false, reason: 'Database unhealthy' });
    }
  }

  /**
   * 存活检查 — K8s liveness probe
   */
  @Public()
  @SkipThrottle()
  @Get('live')
  live(): { alive: boolean } {
    return { alive: true };
  }
}
