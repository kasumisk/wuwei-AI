import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class LoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('user-agent') || '';
    const startTime = Date.now();

    const requestId = req.headers['x-request-id'] || `req_${Date.now()}`;
    req.headers['x-request-id'] = requestId as string;

    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('content-length');
      const duration = Date.now() - startTime;
      const logMessage = `${method} ${originalUrl} ${statusCode} ${contentLength || 0}b - ${duration}ms - ${userAgent} ${ip}`;

      if (statusCode >= 500) this.logger.error(logMessage);
      else if (statusCode >= 400) this.logger.warn(logMessage);
      else this.logger.log(logMessage);
    });

    next();
  }
}
