/**
 * V6.4 Phase 2 — Prometheus 指标端点
 *
 * 暴露 /metrics 供 Prometheus Server / Grafana Agent 采集。
 * 无认证保护（Prometheus 采集器通常不带 token）。
 */
import { Controller, Get, Header, Res } from '@nestjs/common';
import { Response } from 'express';
import { Public } from '../decorators/public.decorator';
import { SkipThrottle } from '../throttle';
import { MetricsService } from './metrics.service';
import { IgnoreResponseInterceptor } from '../decorators/ignore-response-interceptor.decorator';

@Controller()
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Public()
  @SkipThrottle()
  @IgnoreResponseInterceptor()
  @Get('metrics')
  async getMetrics(@Res() res: Response): Promise<void> {
    const metricsText = await this.metrics.getMetrics();
    res.set('Content-Type', this.metrics.getContentType());
    res.end(metricsText);
  }
}
