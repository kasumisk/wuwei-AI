/**
 * V6.4 Phase 2 — HTTP 请求指标中间件
 *
 * 为每个 HTTP 请求自动记录 Prometheus 延迟直方图和请求计数。
 * 不依赖 NestJS Interceptor（因为 Interceptor 不能捕获被 Guard 拒绝的请求）。
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metrics: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // 跳过 /metrics 端点本身，避免自引用
    if (req.path === '/metrics') {
      next();
      return;
    }

    const startTime = process.hrtime.bigint();

    res.on('finish', () => {
      const durationNs = Number(process.hrtime.bigint() - startTime);
      const durationSeconds = durationNs / 1e9;

      // 规范化路由（移除动态参数，避免高基数 label）
      const route = this.normalizeRoute(req.route?.path || req.path);
      const method = req.method;
      const statusCode = res.statusCode.toString();

      this.metrics.httpRequestDuration
        .labels(method, route, statusCode)
        .observe(durationSeconds);

      this.metrics.httpRequestTotal.labels(method, route, statusCode).inc();
    });

    next();
  }

  /**
   * 规范化路由路径，将动态参数替换为 :param
   * 避免 Prometheus label 基数爆炸
   *
   * 例如: /api/users/abc-123/profile → /api/users/:id/profile
   */
  private normalizeRoute(path: string): string {
    return (
      path
        // UUID 模式
        .replace(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
          ':id',
        )
        // 纯数字 ID
        .replace(/\/\d+(?=\/|$)/g, '/:id')
        // 日期格式 YYYY-MM-DD
        .replace(/\d{4}-\d{2}-\d{2}/g, ':date')
    );
  }
}
