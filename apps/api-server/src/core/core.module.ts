import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { LoggerModule } from './logger/logger.module';
import { RedisModule } from './redis/redis.module';
import { CacheModule } from './cache/cache.module';
import { RequestContextModule } from './context/request-context.module';
import { AllExceptionsFilter } from './filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    LoggerModule,
    RedisModule,
    CacheModule,
    // V6 Phase 1.13: 请求上下文（AsyncLocalStorage 链路追踪）
    RequestContextModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
  exports: [
    ConfigModule,
    DatabaseModule,
    LoggerModule,
    RedisModule,
    CacheModule,
    RequestContextModule,
  ],
})
export class CoreModule {}
