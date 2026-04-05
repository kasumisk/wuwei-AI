import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { ApiResponse } from '@ai-platform/shared';
import { IGNORE_RESPONSE_INTERCEPTOR_KEY } from '../decorators/ignore-response-interceptor.decorator';

/**
 * 响应格式化拦截器
 * 将所有响应统一包装为标准格式
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  ApiResponse<T>
> {
  private readonly logger = new Logger(ResponseInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    const ignore = this.reflector.getAllAndOverride<boolean>(
      IGNORE_RESPONSE_INTERCEPTOR_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (ignore) {
      return next.handle();
    }

    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    const startTime = Date.now();

    return next.handle().pipe(
      map((data) => {
        const duration = Date.now() - startTime;
        this.logger.debug(
          `Response: ${request.method} ${request.url} - ${duration}ms`,
        );

        // 如果响应数据已经是标准格式，直接返回
        if (
          data &&
          typeof data === 'object' &&
          'code' in data &&
          'success' in data
        ) {
          return data as ApiResponse<T>;
        }

        // 否则包装为标准格式
        return {
          code: 200,
          data: data as T,
          message: '操作成功',
          success: true,
        };
      }),
    );
  }
}
