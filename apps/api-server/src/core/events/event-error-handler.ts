/**
 * V6.5 Phase 1I — EventEmitter2 全局错误处理
 *
 * 问题背景：
 * EventEmitter2 默认行为下，如果某个 @OnEvent listener 抛出异常，
 * 异常会传播到 emitter，可能阻塞后续 listener 的执行。
 *
 * 解决方案：
 * 1. 注册全局 'error' 事件处理器，捕获所有 listener 异常并记录日志
 * 2. 防止一个 listener 的异常影响其他 listener
 * 3. 配合 MetricsService 记录事件错误指标
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MetricsService } from '../metrics/metrics.service';

@Injectable()
export class EventErrorHandler implements OnModuleInit {
  private readonly logger = new Logger(EventErrorHandler.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly metricsService: MetricsService,
  ) {}

  onModuleInit(): void {
    // 全局 listener 错误处理
    // 确保一个 listener 异常不会阻塞其他 listener
    this.eventEmitter.on('error', (error: Error) => {
      this.logger.error(
        `Domain event listener 异常: ${error.message}`,
        error.stack,
      );
      // 记录事件错误到 Prometheus
      this.metricsService.incrementEventError();
    });

    this.logger.log('全局事件错误处理器已注册');
  }
}
