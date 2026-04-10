/**
 * V6 Phase 1.13 — CLS 用户上下文拦截器
 *
 * 在 Guard 认证完成后，将 userId 写入 CLS 上下文。
 *
 * 执行顺序：Middleware（CLS 创建 + requestId）→ Guard（认证）→ 本拦截器（userId 写入 CLS）→ Controller
 *
 * 注册为全局 APP_INTERCEPTOR。
 */
import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { ClsService } from 'nestjs-cls';
import { CLS_KEYS } from './request-context.service';

@Injectable()
export class ClsUserInterceptor implements NestInterceptor {
  constructor(private readonly cls: ClsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    // 仅处理 HTTP 请求
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as { id?: string } | undefined;

    // Guard 认证完成后，user 已注入到 request 上
    if (user?.id && this.cls.isActive()) {
      this.cls.set(CLS_KEYS.USER_ID, user.id);
    }

    // 同步 requestId 到响应头（方便客户端调试）
    if (this.cls.isActive()) {
      const response = context.switchToHttp().getResponse();
      const requestId = this.cls.get(CLS_KEYS.REQUEST_ID);
      if (requestId) {
        response.setHeader('x-request-id', requestId);
      }
    }

    return next.handle();
  }
}
