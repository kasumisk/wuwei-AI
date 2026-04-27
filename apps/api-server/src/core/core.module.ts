import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { LoggerModule } from './logger/logger.module';
import { RedisModule } from './redis/redis.module';
import { CacheModule } from './cache/cache.module';
import { RequestContextModule } from './context/request-context.module';
import { I18nModule } from './i18n';

/**
 * V6.4: 移除 AllExceptionsFilter 注册
 * 原因：AllExceptionsFilter 在 AppModule 中已注册为 APP_FILTER，
 * 此处重复注册导致每个异常被处理两次、日志重复。
 *
 * I18n V7: 注册全局 I18nModule，业务模块可直接注入 I18nService
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
    // I18n V7: 模块级 i18n（全局，所有模块可注入 I18nService）
    I18nModule,
  ],
  exports: [
    ConfigModule,
    LoggerModule,
    RedisModule,
    CacheModule,
    RequestContextModule,
    I18nModule,
  ],
})
export class CoreModule {}
