/**
 * TaskHandlerRegistry — 把 (queueName, jobName) 映射到一个 async handler。
 *
 * 设计动机：
 *   测试环境用 BullMQ Processor，生产用 Cloud Tasks HTTP；二者要复用同一份业务逻辑。
 *   方案是把 processor 的 process() 方法体抽成 service 上的一个普通 async method，
 *   再让 service 在 onModuleInit 时把自己注册进 registry。InternalTaskController
 *   收到 HTTP 请求后从 registry 查 handler 调用即可。
 *
 *   BullMQ 那边的 Processor 仍然存在（@Processor 装饰器 + WorkerHost），
 *   它的 process() 也直接调用同一个 service method —— 一份业务逻辑，两个入口。
 *
 * 注册时机：
 *   各 service 在 NestJS lifecycle 的 onModuleInit 中调用 register()。
 *   重复注册抛错（防止误把同一个 handler 注册两次或被覆盖）。
 *
 * 幂等：
 *   registry 不负责幂等；每个 handler 自己用 IdempotencyService 包裹。
 */
import { Injectable, Logger } from '@nestjs/common';

export interface TaskHandlerContext {
  /** Cloud Tasks 路径携带；BullMQ 路径下从 job.queueName 传入 */
  queueName: string;
  /** Cloud Tasks 路径携带；BullMQ 路径下从 job.name 传入 */
  jobName: string;
  /**
   * Cloud Tasks 路径下：req.headers['x-cloudtasks-taskname'] 等元数据；
   * BullMQ 路径下：job.id / attemptsMade。两端 handler 可选用作日志/幂等键。
   */
  meta?: {
    taskName?: string;
    attempt?: number;
    jobId?: string;
  };
}

export type TaskHandler = (data: unknown, ctx: TaskHandlerContext) => Promise<unknown>;

@Injectable()
export class TaskHandlerRegistry {
  private readonly logger = new Logger(TaskHandlerRegistry.name);
  /** key = `${queueName}:${jobName}` */
  private readonly handlers = new Map<string, TaskHandler>();

  register(queueName: string, jobName: string, handler: TaskHandler): void {
    const key = this.key(queueName, jobName);
    if (this.handlers.has(key)) {
      // 严格抛错：重复注册 99% 是 bug（两个 service 都注册到同一个 jobName，
      // 或者 onModuleInit 被调用两次）。生产 silent 覆盖会导致难以定位的灵异问题。
      throw new Error(`TaskHandler already registered: ${key}`);
    }
    this.handlers.set(key, handler);
    this.logger.log(`Registered task handler: ${key}`);
  }

  resolve(queueName: string, jobName: string): TaskHandler | null {
    return (
      this.handlers.get(this.key(queueName, jobName)) ??
      // 通配 fallback：很多 BullMQ Processor 内部用 switch(job.name) 自分发，
      // 注册时用 '*' 表示"该队列所有 jobName 都路由到这个 handler"。
      this.handlers.get(this.key(queueName, '*')) ??
      null
    );
  }

  /** 仅供调试 / metrics 使用 */
  list(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }

  private key(queueName: string, jobName: string): string {
    return `${queueName}:${jobName}`;
  }
}

/**
 * 把 BullMQ 风格的 process(job) 适配成 TaskHandler。
 *
 * 当 Cloud Tasks 路径触发时，我们没有真正的 BullMQ Job 实例；而 Processor 的
 * process() 通常只用 job.data / job.name / job.id / job.attemptsMade 这几个字段。
 * 因此构造一个最小 mock job 就够了。如果某个 processor 用了更多字段（如 job.token、
 * job.updateProgress），需要单独抽 service method，不要走这个适配器。
 *
 * 用法（在 Processor 类的 onModuleInit 中）：
 *   this.registry.register(QUEUE_NAMES.X, '*', processorAsHandler(this));
 *
 * '*' 表示该队列的所有 jobName 都路由到这个 processor，原 process() 内的
 * switch(job.name) 仍然有效。
 */
export function processorAsHandler(processor: {
  process: (job: any) => Promise<unknown>;
}): TaskHandler {
  return async (data, ctx) => {
    const mockJob = {
      data,
      name: ctx.jobName,
      id: ctx.meta?.jobId ?? `tasks-${Date.now()}`,
      queueName: ctx.queueName,
      attemptsMade: ctx.meta?.attempt ?? 0,
      // 一些 processor 会读 job.opts.attempts 推断 maxRetries；给个保守默认
      opts: { attempts: 1 },
    };
    return processor.process(mockJob);
  };
}
