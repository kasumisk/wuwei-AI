/**
 * CronModule — 进程内调度 + 外部触发（Cloud Scheduler/Run Jobs）双入口。
 *
 *   - CronBackend：解析 CRON_BACKEND env，决定 @Cron 装饰器是否真的执行。
 *   - CronHandlerRegistry：cronName → handler 注册中心。
 *   - InternalCronController：HTTP target，由 Scheduler 调用。
 *
 * 各 cron service 只需要：
 *   1) 注入 CronBackend + CronHandlerRegistry；
 *   2) 在 onModuleInit 注册：registry.register('cron-name', () => this.runActualWork());
 *   3) 在 @Cron 方法里加 guard：if (!this.cronBackend.shouldRunInProc()) return;
 *
 * @Global 因为 cron service 散落在各业务模块，全局可注入避免循环依赖。
 */
import { Global, Module } from '@nestjs/common';
import { InternalTaskGuard } from '../queue/internal-task.guard';
import { CronBackend } from './cron-backend.service';
import { CronHandlerRegistry } from './cron-handler.registry';
import { InternalCronController } from './internal-cron.controller';

@Global()
@Module({
  controllers: [InternalCronController],
  providers: [
    CronBackend,
    CronHandlerRegistry,
    // 复用 queue 的 guard（OIDC + X-Internal-Token + dev 跳过）
    InternalTaskGuard,
  ],
  exports: [CronBackend, CronHandlerRegistry],
})
export class CronModule {}
