/**
 * V6.5 Phase 1H — Circuit Breaker 模块
 *
 * 全局模块，提供 CircuitBreakerService 给所有需要外部服务调用保护的模块。
 * 依赖 MetricsModule（@Global），无需显式导入。
 */
import { Global, Module } from '@nestjs/common';
import { CircuitBreakerService } from './circuit-breaker.service';

@Global()
@Module({
  providers: [CircuitBreakerService],
  exports: [CircuitBreakerService],
})
export class CircuitBreakerModule {}
