/**
 * InternalTaskController — Cloud Tasks HTTP target。
 *
 * 路径：POST /internal/tasks/:queueName/:jobName
 *   body: { jobName: string, data: any }   ← 由 QueueProducer 包装
 *   header:
 *     Authorization: Bearer <OIDC ID token>   ← Cloud Tasks 注入
 *     X-Internal-Token: <CLOUD_TASKS_INTERNAL_TOKEN>  ← Cloud Tasks header config 注入
 *     X-CloudTasks-TaskName / X-CloudTasks-TaskRetryCount / X-CloudTasks-QueueName  ← Cloud Tasks 自动注入
 *
 * 行为：
 *   1) Guard 完成鉴权（测试环境放行）。
 *   2) 解析 (queueName, jobName) → 查 TaskHandlerRegistry。
 *   3) 写 TaskExecutionLog（status=running）。
 *   4) await handler(data, ctx)。
 *   5) 成功：log status=succeeded + duration；返回 200。
 *      失败：log status=failed + error；返回 500，让 Cloud Tasks 按 queue 配置重试。
 *      已超过 MAX_ATTEMPTS（X-CloudTasks-TaskRetryCount >= maxAttempts-1）：log status=dead，
 *      仍返回 200 让 Cloud Tasks 不再重试，靠 dashboard 报警 + DLQ Prisma 行兜底。
 *
 * 设计权衡：
 *   - 不接 IdempotencyService，因为幂等键是业务概念（user_id+meal_id+date 等），
 *     由各 handler 内部决定。Controller 只做"任务被实际执行"的执行日志。
 *   - X-CloudTasks-TaskRetryCount 不可信？官方文档说由 Cloud Tasks 注入，外部
 *     伪造需先突破 Guard，可信度等价 OIDC + shared token。
 */
import {
  Body,
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
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { InternalTaskGuard } from './internal-task.guard';
import { TaskHandlerRegistry, type TaskHandlerContext } from './task-handler.registry';

interface TaskBody {
  /** 与 path 中的 jobName 必须一致；冗余便于日志/防错路由 */
  jobName: string;
  data: unknown;
}

@Controller('internal/tasks')
@UseGuards(InternalTaskGuard)
export class InternalTaskController {
  private readonly logger = new Logger(InternalTaskController.name);

  constructor(
    private readonly registry: TaskHandlerRegistry,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post(':queueName/:jobName')
  @HttpCode(HttpStatus.OK)
  async dispatch(
    @Param('queueName') queueName: string,
    @Param('jobName') jobName: string,
    @Body() body: TaskBody,
    @Headers('x-cloudtasks-taskname') taskName: string | undefined,
    @Headers('x-cloudtasks-taskretrycount') retryCountHeader: string | undefined,
    @Headers('x-cloudtasks-queuename') headerQueueName: string | undefined,
  ): Promise<{ ok: true; status: 'succeeded' | 'dead' }> {
    // 防呆：path 与 body.jobName 不一致直接 400（Producer 应当保证一致）
    if (body?.jobName && body.jobName !== jobName) {
      throw new HttpException(
        `path jobName="${jobName}" mismatches body.jobName="${body.jobName}"`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (headerQueueName && headerQueueName !== queueName) {
      this.logger.warn(
        `queueName mismatch: path=${queueName} header=${headerQueueName}; trusting path`,
      );
    }

    const handler = this.registry.resolve(queueName, jobName);
    if (!handler) {
      // 没有注册的 handler：可能是部署滞后/已下线 job。
      // 返回 404 让 Cloud Tasks 重试；如果是已删除的 job，应当先清空队列再发版。
      throw new HttpException(
        `no handler for ${queueName}:${jobName}`,
        HttpStatus.NOT_FOUND,
      );
    }

    const attempt = retryCountHeader ? parseInt(retryCountHeader, 10) || 0 : 0;
    const ctx: TaskHandlerContext = {
      queueName,
      jobName,
      meta: { taskName, attempt, jobId: taskName },
    };

    const startedAt = Date.now();
    const logRow = await this.startLog(queueName, jobName, taskName, attempt, body?.data);

    try {
      await handler(body?.data, ctx);
      await this.finishLog(logRow.id, 'succeeded', Date.now() - startedAt);
      return { ok: true, status: 'succeeded' };
    } catch (err) {
      const error = err as Error;
      const maxAttempts = this.maxAttemptsFor(queueName);
      const isTerminal = attempt + 1 >= maxAttempts;

      await this.finishLog(
        logRow.id,
        isTerminal ? 'dead' : 'failed',
        Date.now() - startedAt,
        error,
      );

      if (isTerminal) {
        // 死信：返回 200 阻止 Cloud Tasks 继续重试；状态已写 dead，
        // 由独立的 DLQ replay 工具/告警决定后续动作。
        this.logger.error(
          `task DEAD ${queueName}:${jobName} after ${attempt + 1} attempts: ${error.message}`,
        );
        return { ok: true, status: 'dead' };
      }

      // 非终态：500 触发 Cloud Tasks 重试（按 queue retry config）
      throw new HttpException(
        `task failed: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * 每队列的最大尝试次数。理论上应与 setup-cloud-tasks.sh 中配置的 max-attempts 对齐；
   * 这里读 env，缺省给一个保守的 5。
   * env: TASK_MAX_ATTEMPTS_<QUEUE>  / TASK_MAX_ATTEMPTS_DEFAULT
   */
  private maxAttemptsFor(queueName: string): number {
    const key = `TASK_MAX_ATTEMPTS_${queueName.toUpperCase().replace(/-/g, '_')}`;
    const perQueue = this.config.get<string>(key);
    const fallback = this.config.get<string>('TASK_MAX_ATTEMPTS_DEFAULT', '5');
    const v = parseInt(perQueue ?? fallback, 10);
    return Number.isFinite(v) && v > 0 ? v : 5;
  }

  private async startLog(
    queueName: string,
    jobName: string,
    externalId: string | undefined,
    attempt: number,
    data: unknown,
  ) {
    return this.prisma.taskExecutionLog.create({
      data: {
        backend: 'cloud-tasks',
        taskName: `${queueName}:${jobName}`,
        externalId: externalId ?? null,
        status: 'running',
        attempt,
        // payload 摘要：保存前 2KB 的 JSON 以便排错；超长会被截断
        payloadDigest: digestPayload(data) as any,
      },
      select: { id: true },
    });
  }

  private async finishLog(
    id: string,
    status: 'succeeded' | 'failed' | 'dead',
    durationMs: number,
    error?: Error,
  ): Promise<void> {
    await this.prisma.taskExecutionLog.update({
      where: { id },
      data: {
        status,
        finishedAt: new Date(),
        durationMs,
        errorMessage: error?.message ?? null,
        errorStack: error?.stack?.slice(0, 8000) ?? null,
      },
    });
  }
}

/**
 * payload 摘要：完整 JSON > 2KB 时存 { _truncated: true, sample: <前 2KB> }；
 * 否则原样存。绝不直接吞 PII / 大 payload 进 task_execution_log。
 */
function digestPayload(data: unknown): unknown {
  try {
    const serialized = JSON.stringify(data);
    if (serialized === undefined) return null;
    if (serialized.length <= 2048) return data;
    return {
      _truncated: true,
      length: serialized.length,
      sample: serialized.slice(0, 2048),
    };
  } catch {
    return { _unserializable: true };
  }
}
