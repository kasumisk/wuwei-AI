/**
 * CronHandlerRegistry — cronName → async handler 注册中心。
 *
 * 设计动机：
 *   测试/开发环境用 @nestjs/schedule 的 @Cron 装饰器在进程内调度；
 *   生产环境关闭 in-process 调度，由 Cloud Scheduler 通过 HTTP 调用
 *   InternalCronController（→ resolve(cronName) → handler）触发。
 *
 *   一份业务逻辑，两个触发入口；切换由 CRON_BACKEND env 控制。
 *
 * 注册时机：
 *   各 cron service 在 onModuleInit 中调用 register()。
 *
 * 幂等：
 *   registry 不负责幂等；handler 自身按需用 IdempotencyService 包裹。
 *   注意 Cloud Scheduler 会在 push 失败/超时时重试，handler 必须可重入。
 */
import { Injectable, Logger } from '@nestjs/common';

export interface CronHandlerContext {
  /** 触发源：'inproc' = @Cron 装饰器调用；'scheduler' = Cloud Scheduler HTTP 调用；'manual' = 手动触发 */
  trigger: 'inproc' | 'scheduler' | 'manual';
  /** 触发时刻（UTC ISO） */
  triggeredAt: string;
}

export type CronHandler = (ctx: CronHandlerContext) => Promise<unknown>;

@Injectable()
export class CronHandlerRegistry {
  private readonly logger = new Logger(CronHandlerRegistry.name);
  private readonly handlers = new Map<string, CronHandler>();

  register(cronName: string, handler: CronHandler): void {
    if (this.handlers.has(cronName)) {
      throw new Error(`CronHandler already registered: ${cronName}`);
    }
    this.handlers.set(cronName, handler);
    this.logger.log(`Registered cron handler: ${cronName}`);
  }

  resolve(cronName: string): CronHandler | null {
    return this.handlers.get(cronName) ?? null;
  }

  list(): string[] {
    return Array.from(this.handlers.keys()).sort();
  }
}
