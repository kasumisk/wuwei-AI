import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, any> {
  private readonly logger = new Logger(ResponseInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const ignore = this.reflector.getAllAndOverride<boolean>('ignoreResponseInterceptor', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (ignore) return next.handle();

    const request = context.switchToHttp().getRequest();
    const startTime = Date.now();

    return next.handle().pipe(
      map((data) => {
        const duration = Date.now() - startTime;
        this.logger.debug(`Response: ${request.method} ${request.url} - ${duration}ms`);

        if (data && typeof data === 'object' && 'code' in data && 'success' in data) {
          return data;
        }

        return { code: 200, data, message: '操作成功', success: true };
      }),
    );
  }
}
