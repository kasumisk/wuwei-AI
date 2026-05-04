/**
 * cron-runner.ts — Cloud Run Job 入口
 *
 * 用法（Cloud Scheduler → Cloud Run Job 触发）:
 *   docker run ... node dist/cron-runner.js --name=<cronName>
 *   或 env: CRON_NAME=<cronName>
 *
 * 行为:
 *   1. 启动一个最小化的 NestJS 应用上下文（不启动 HTTP server）
 *   2. 从 CronHandlerRegistry 取出对应 handler
 *   3. 写一条 TaskExecutionLog（backend='cloud-scheduler'）
 *   4. 执行 handler，捕获错误 → 失败码 1；成功 → 退出码 0
 *
 * 设计：所有 cron 都在同一份 image / 同一个 Run Job 中执行，
 *      只是通过 `--name=` 切换具体 handler，避免每个 cron 单独建 Job。
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { CronHandlerRegistry } from './core/cron';
import { PrismaService } from './core/prisma/prisma.service';

function parseCronName(): string {
  // 优先 CLI 参数 --name=xxx
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--name=')) return arg.substring('--name='.length);
  }
  // 否则 env CRON_NAME
  const fromEnv = process.env.CRON_NAME;
  if (fromEnv) return fromEnv;
  throw new Error(
    'cron-runner: 必须通过 --name=<cronName> 或 CRON_NAME 环境变量指定要执行的 cron',
  );
}

async function logExecution(
  prisma: PrismaService,
  cronName: string,
  status: 'succeeded' | 'failed',
  startedAt: Date,
  errorMessage?: string,
  errorStack?: string,
): Promise<void> {
  const finishedAt = new Date();
  await prisma.taskExecutionLog
    .create({
      data: {
        backend: 'cloud-scheduler',
        taskName: `cron:${cronName}`,
        status,
        attempt: 1,
        startedAt,
        finishedAt,
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        errorMessage: errorMessage ?? null,
        errorStack: errorStack ?? null,
      },
    })
    .catch((err) => {
      // 写日志失败不阻断 Job
      Logger.warn(
        `cron-runner: 写 TaskExecutionLog 失败 - ${(err as Error).message}`,
        'CronRunner',
      );
    });
}

async function main(): Promise<void> {
  const cronName = parseCronName();
  const logger = new Logger('CronRunner');
  logger.log(`启动 cron-runner，目标 cron=${cronName}`);

  // 静默化无关日志（Job 启动会拉起整个 AppModule，日志会很多）
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const registry = app.get(CronHandlerRegistry);
    const prisma = app.get(PrismaService);

    const handler = registry.resolve(cronName);
    if (!handler) {
      throw new Error(`未注册的 cron handler: ${cronName}`);
    }

    const startedAt = new Date();
    try {
      await handler({
        trigger: 'scheduler',
        triggeredAt: startedAt.toISOString(),
      });
      await logExecution(prisma, cronName, 'succeeded', startedAt);
      logger.log(`cron=${cronName} 执行成功`);
    } catch (err) {
      const e = err as Error;
      await logExecution(prisma, cronName, 'failed', startedAt, e.message, e.stack);
      logger.error(`cron=${cronName} 执行失败: ${e.message}`, e.stack);
      // 让 Cloud Run Job 标记失败 → Scheduler 自动重试（按 Job 重试策略）
      await app.close();
      process.exit(1);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // 启动阶段失败（例如 AppModule 初始化失败 / 没有 cron 名）
  // eslint-disable-next-line no-console
  console.error('cron-runner fatal:', err);
  process.exit(1);
});
