import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { LoggerModule } from './logger/logger.module';
import { StorageModule } from './storage/storage.module';
import { AiGatewayModule } from './ai-gateway/ai-gateway.module';
import { HealthModule } from './health/health.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    LoggerModule,
    StorageModule,
    AiGatewayModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
  exports: [
    ConfigModule,
    DatabaseModule,
    LoggerModule,
    StorageModule,
    AiGatewayModule,
  ],
})
export class InfrastructureModule {}
