/**
 * V6.4 Phase 2 — Prometheus 可观测性模块
 *
 * 提供：
 * - MetricsService：定义和管理所有 Prometheus 指标
 * - MetricsController：/metrics 端点
 * - MetricsMiddleware：自动记录 HTTP 请求延迟
 *
 * 全局模块，所有业务模块可注入 MetricsService 记录自定义指标。
 */
import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';

@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
