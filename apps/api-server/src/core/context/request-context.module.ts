/**
 * V6 Phase 1.13 — 请求上下文模块
 *
 * 基于 nestjs-cls 提供 AsyncLocalStorage 请求级上下文。
 *
 * 注册方式: ClsModule.forRoot() 自动注册中间件，
 * 在 HTTP 请求进入时创建 CLS 上下文。
 *
 * 模块标记为 @Global，确保 RequestContextService 全局可注入。
 */
import { Global, Module } from '@nestjs/common';
import { ClsModule } from 'nestjs-cls';
import { v4 as uuidv4 } from 'uuid';
import { RequestContextService, CLS_KEYS } from './request-context.service';

@Global()
@Module({
  imports: [
    ClsModule.forRoot({
      // 自动为每个 HTTP 请求创建 CLS 上下文
      middleware: {
        mount: true,
        // 在 CLS 上下文创建后初始化基础字段
        setup: (cls, req) => {
          // 优先使用客户端传入的 x-request-id，否则生成 UUID
          const requestId = (req.headers['x-request-id'] as string) || uuidv4();
          cls.set(CLS_KEYS.REQUEST_ID, requestId);
          cls.set(CLS_KEYS.START_TIME, Date.now());

          // 如果请求已经通过认证（Passport 注入了 user），写入 userId
          // 注意: 在中间件阶段 Guard 尚未执行，userId 通常由后续的 Interceptor 补充
          const user = req.user as { id?: string } | undefined;
          if (user?.id) {
            cls.set(CLS_KEYS.USER_ID, user.id);
          }
        },
      },
    }),
  ],
  providers: [RequestContextService],
  exports: [RequestContextService, ClsModule],
})
export class RequestContextModule {}
