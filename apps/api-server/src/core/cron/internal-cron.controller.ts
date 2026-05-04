/**
 * InternalCronController — Cloud Scheduler / Cloud Run Jobs HTTP target。
 *
 * 路径：POST /internal/cron/:cronName
 *   header:
 *     Authorization: Bearer <OIDC ID token>            ← Scheduler/Tasks 注入
 *     X-Internal-Token: <CLOUD_TASKS_INTERNAL_TOKEN>   ← 共享密钥（双重防御）
 *
 * 行为：
 *   1) Guard 鉴权（dev/test 自动放行）。
 *   2) 解析 cronName → 查 CronHandlerRegistry。
 *   3) 写 TaskExecutionLog（backend='cloud-scheduler', taskName=cron:<name>, status=running）。
 *   4) await handler(ctx)。
 *   5) 成功 → succeeded + 200；失败 → failed + 500（让 Scheduler 按 retry 配置重试）。
 *      不实现 'dead' 终态：cron 任务通常每天/每小时重新触发，
 *      连续失败靠告警 + 人工介入比靠重试上限更合适。
 *
 * 与 InternalTaskController 的区别：
 *   - cron 没有"业务 jobName"，每次只有一个 cronName；
 *   - 没有 retryCount header（Scheduler 不注入相应 header）；
 *   - 不区分 attempt → dead，所有失败都返回 500 让外层重试或告警。
 */
import {
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InternalTaskGuard } from '../queue/internal-task.guard';
import { CronHandlerRegistry } from './cron-handler.registry';

@Controller('internal/cron')
@UseGuards(InternalTaskGuard)
export class InternalCronController {
  private readonly logger = new Logger(InternalCronController.name);

  constructor(
    private readonly registry: CronHandlerRegistry,
    private readonly prisma: PrismaService,
  ) {}

  @Post(':cronName')
  @HttpCode(HttpStatus.OK)
  async dispatch(
    @Param('cronName') cronName: string,
    @Headers('x-cloudscheduler-jobname') schedulerJobName: string | undefined,
    @Headers('x-cloudscheduler-scheduletime') schedulerScheduleTime: string | undefined,
  ): Promise<{ ok: true; cronName: string }> {
    const handler = this.registry.resolve(cronName);
    if (!handler) {
      throw new HttpException(
        `no cron handler for ${cronName}`,
        HttpStatus.NOT_FOUND,
      );
    }

    // Cloud Scheduler 注入的可识别外部 ID：组合 job name + schedule time 作为幂等键
    const externalId = [schedulerJobName, schedulerScheduleTime]
      .filter(Boolean)
      .join('|') || null;

    // 幂等防护：同 cronName + scheduleTime（即同一次计划触发）已有 running/succeeded 则跳过。
    // Scheduler 在 HTTP 超时时会重试，防止同一 scheduleTime 的 cron 被执行两次。
    if (schedulerScheduleTime) {
      const idempotencyKey = `cron:${cronName}`;
      const existing = await this.prisma.taskExecutionLog.findFirst({
        where: {
          taskName: idempotencyKey,
          externalId: { contains: schedulerScheduleTime },
          status: { in: ['running', 'succeeded'] },
          startedAt: { gte: new Date(Date.now() - 2 * 60 * 60 * 1000) }, // 2h 窗口
        },
        select: { id: true, status: true },
      });
      if (existing) {
        this.logger.warn(
          `Cron idempotent skip: cronName=${cronName} scheduleTime=${schedulerScheduleTime} existingStatus=${existing.status}`,
        );
        return { ok: true, cronName };
      }
    }

    const startedAt = Date.now();
    const logRow = await this.prisma.taskExecutionLog.create({
      data: {
        backend: 'cloud-scheduler',
        taskName: `cron:${cronName}`,
        externalId,
        status: 'running',
        attempt: 1,
      },
      select: { id: true },
    });

    try {
      await handler({
        trigger: 'scheduler',
        triggeredAt: new Date().toISOString(),
      });
      await this.prisma.taskExecutionLog.update({
        where: { id: logRow.id },
        data: {
          status: 'succeeded',
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      });
      return { ok: true, cronName };
    } catch (err) {
      const error = err as Error;
      await this.prisma.taskExecutionLog.update({
        where: { id: logRow.id },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
          errorMessage: error.message ?? null,
          errorStack: error.stack?.slice(0, 8000) ?? null,
        },
      });
      this.logger.error(
        `cron ${cronName} FAILED: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        `cron failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
