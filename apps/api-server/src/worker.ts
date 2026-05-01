/**
 * EatCheck Worker 进程入口
 *
 * 用途：
 *   独立于 HTTP 服务运行 BullMQ 消费者，避免 Cloud Run scale-to-zero 时
 *   把队列 worker 一并杀掉（导致延迟任务、重试任务、续期 cron 全部停摆）。
 *
 * 与 main.ts 的差异：
 *   1. 用 NestFactory.createApplicationContext —— 不启动 Express，不监听端口
 *   2. 不注册全局 ValidationPipe / ExceptionFilter（Worker 内部不接 HTTP 请求）
 *   3. 仍开启 shutdownHooks，让 SIGTERM 触发 Bull Worker.close + Prisma/Redis 优雅断开
 *
 * 部署：
 *   作为独立 Cloud Run 服务运行（区分于 HTTP 服务），并设置：
 *     - --cpu-throttling=false    // 容器 idle 时仍保留 CPU，让 BullMQ 长轮询不被冻结
 *     - --min-instances=1         // 不允许 scale-to-zero
 *     - --max-instances=1         // 单实例消费，避免重复处理（BullMQ 自身有抢锁，但单实例最稳）
 *     - --no-allow-unauthenticated
 *     - 镜像 CMD 改为 "node dist/worker.js"
 *
 * 重要：
 *   Worker 进程仍然加载完整 AppModule（含 controllers 类的元数据约 30-50MB 内存代价），
 *   因为不监听端口，所以路由不会注册。这样换来：业务模块依赖图不必拆分，
 *   每加一个 processor 不需要同时维护 WorkerModule。
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';

async function bootstrapWorker(): Promise<void> {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';

  // JWT_SECRET 在 worker 进程也是必须 —— 内部任务可能签发短期 token、
  // 比如续费成功后给前端推送时复用 JwtService
  if (!process.env.JWT_SECRET) {
    if (isProduction) {
      Logger.error(
        '[Worker] JWT_SECRET 未设置，生产环境拒绝启动',
        'WorkerBootstrap',
      );
      process.exit(1);
    }
    Logger.warn(
      '[Worker] JWT_SECRET 未设置，使用开发默认值',
      'WorkerBootstrap',
    );
  }

  // createApplicationContext：不启 HTTP server，仅初始化依赖图
  const ctx = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });

  const logger = ctx.get(WINSTON_MODULE_NEST_PROVIDER);
  ctx.useLogger(logger);

  // 关键：开启 shutdownHooks，SIGTERM 时会按 onModuleDestroy 顺序关闭：
  //   - BullMQ Worker（停止消费 + 等当前 job 完成）
  //   - Redis 连接
  //   - Prisma 连接池
  ctx.enableShutdownHooks();

  Logger.log(
    `EatCheck Worker started (env=${nodeEnv}, pid=${process.pid})`,
    'WorkerBootstrap',
  );

  // Cloud Run / k8s 用 SIGTERM 通知关闭，进程会随 enableShutdownHooks 链式关闭
  // 这里不需要 await close —— 容器 runtime 会等到所有 hook 完成或超时（Cloud Run: 默认 10s, 可调到 600s）
}

void bootstrapWorker();
