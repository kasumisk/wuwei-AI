/**
 * CronBackend — 全局 cron 后端开关。
 *
 *   - 'inproc'：进程内调度（@nestjs/schedule 的 @Cron 装饰器生效），适合 dev/staging/test
 *   - 'external'：禁用 @Cron 内部触发，由 Cloud Scheduler / Cloud Run Jobs 通过
 *     InternalCronController 或 cron-runner.ts 触发。生产环境使用。
 *
 * @Cron 方法体里需要写入 guard：
 *   if (!this.cronBackend.shouldRunInProc()) return;
 *
 * env 解析：
 *   CRON_BACKEND=inproc | external，未设置时默认 inproc（避免本地开发/CI 漏掉 cron）。
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type CronBackendMode = 'inproc' | 'external';

@Injectable()
export class CronBackend {
  private readonly logger = new Logger(CronBackend.name);
  private readonly mode: CronBackendMode;

  constructor(private readonly config: ConfigService) {
    const raw = (this.config.get<string>('CRON_BACKEND') ?? 'inproc').toLowerCase();
    this.mode = raw === 'external' ? 'external' : 'inproc';
    this.logger.log(`CRON_BACKEND=${this.mode}`);
  }

  /** @Cron 装饰器内部调用：决定是否真的执行 handler */
  shouldRunInProc(): boolean {
    return this.mode === 'inproc';
  }

  getMode(): CronBackendMode {
    return this.mode;
  }
}
