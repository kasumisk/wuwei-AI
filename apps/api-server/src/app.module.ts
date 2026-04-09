import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
// 基础设施
import { CoreModule } from './core/core.module';
import { StorageModule } from './storage/storage.module';
// 业务模块
import { AuthModule } from './modules/auth/auth.module';
import { UserModule } from './modules/user/user.module';
import { FoodModule } from './modules/food/food.module';
import { DietModule } from './modules/diet/diet.module';
import { CoachModule } from './modules/coach/coach.module';
import { GamificationModule } from './modules/gamification/gamification.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { ClientModule } from './modules/client/client.module';
import { ProviderModule } from './modules/provider/provider.module';
import { AppVersionModule } from './modules/app-version/app-version.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { FileModule } from './modules/file/file.module';
// 系统服务
import { HealthModule } from './health/health.module';
import { GatewayModule } from './gateway/gateway.module';
import { LangChainModule } from './langchain/langchain.module';
import { CompressModule } from './compress/compress.module';
import { FoodPipelineModule } from './food-pipeline/food-pipeline.module';
// 全局
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter';
import { LoggerMiddleware } from './core/middlewares/logger.middleware';
import { ResponseInterceptor } from './core/interceptors/response.interceptor';

@Module({
  imports: [
    // 基础设施
    CoreModule,
    StorageModule,
    // 业务模块（12个）
    AuthModule,
    UserModule,
    FoodModule,
    DietModule,
    CoachModule,
    GamificationModule,
    RbacModule,
    ClientModule,
    ProviderModule,
    AppVersionModule,
    AnalyticsModule,
    FileModule,
    // 系统服务
    HealthModule,
    GatewayModule,
    LangChainModule,
    CompressModule,
    FoodPipelineModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
