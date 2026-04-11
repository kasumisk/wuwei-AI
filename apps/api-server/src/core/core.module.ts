import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { LoggerModule } from './logger/logger.module';
import { RedisModule } from './redis/redis.module';
import { CacheModule } from './cache/cache.module';
import { RequestContextModule } from './context/request-context.module';

/**
 * V6.4: 移除 AllExceptionsFilter 注册
 * 原因：AllExceptionsFilter 在 AppModule 中已注册为 APP_FILTER，
 * 此处重复注册导致每个异常被处理两次、日志重复。
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    LoggerModule,
    RedisModule,
    CacheModule,
    // V6 Phase 1.13: 请求上下文（AsyncLocalStorage 链路追踪）
    RequestContextModule,
  ],
  exports: [
    ConfigModule,
    LoggerModule,
    RedisModule,
    CacheModule,
    RequestContextModule,
  ],
})
export class CoreModule {}
