import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ClsService } from 'nestjs-cls';
import { CLS_KEYS } from '../context/request-context.service';

/**
 * HTTP 请求日志中间件
 *
 * V6 1.13: 集成 CLS，日志自动附带 requestId 和 userId 用于链路追踪。
 * requestId 由 ClsModule middleware.setup 生成（UUID v4），本中间件仅读取。
 */
@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  constructor(private readonly cls: ClsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';
    const startTime = Date.now();

    // 从 CLS 读取 requestId（由 RequestContextModule 的 ClsModule.setup 写入）
    const requestId = this.cls.isActive()
      ? this.cls.get(CLS_KEYS.REQUEST_ID) || 'no-cls'
      : 'no-cls';

    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('content-length');
      const duration = Date.now() - startTime;

      // 在响应完成时尝试读取 userId（Guard 可能已写入 CLS）
      const userId = this.cls.isActive()
        ? this.cls.get(CLS_KEYS.USER_ID)
        : undefined;
      const userTag = userId ? ` uid=${userId}` : '';

      const logMessage = `[${requestId}]${userTag} ${method} ${originalUrl} ${statusCode} ${contentLength || 0}b - ${duration}ms - ${userAgent} ${ip}`;

      if (statusCode >= 500) {
        this.logger.error(logMessage);
      } else if (statusCode >= 400) {
        this.logger.warn(logMessage);
      } else {
        this.logger.log(logMessage);
      }
    });

    next();
  }
}
