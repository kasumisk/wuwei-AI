import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
// 基础设施
import { CoreModule } from './core/core.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './core/queue/queue.module';
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
// V6 Phase 1.5: 功能开关
import { FeatureFlagModule } from './modules/feature-flag/feature-flag.module';
// V6 Phase 1.11: 通知推送
import { NotificationModule } from './modules/notification/notification.module';
// V6 Phase 2.1: 策略引擎
import { StrategyModule } from './modules/strategy/strategy.module';
// V6 Phase 2.12: 订阅模块（计划管理 + 用户订阅 + 支付 + 用量配额）
import { SubscriptionModule } from './modules/subscription/subscription.module';
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
// V6 Phase 1.12: 分层限流
import { UserThrottlerGuard, THROTTLE_CONFIG } from './core/throttle';
// V6 Phase 1.13: 请求上下文拦截器（Guard 后同步 userId 到 CLS）
import { ClsUserInterceptor } from './core/context';

@Module({
  imports: [
    // 基础设施
    CoreModule,
    StorageModule,
    // V6 Phase 1.1: 域事件总线 — 进程内事件驱动，解耦模块间通信
    EventEmitterModule.forRoot({
      // 允许通配符监听（如 'user.*'）
      wildcard: true,
      // 事件分隔符
      delimiter: '.',
      // 最大监听者数量（避免内存泄漏警告）
      maxListeners: 20,
    }),
    // V6 Phase 1.3: BullMQ 异步任务队列 — 复用现有 Redis 实例
    QueueModule,
    // V6 Phase 1.12: 分层限流（default: 100/60s, user-api: 30/60s, ai-heavy: 5/60s）
    ThrottlerModule.forRoot(THROTTLE_CONFIG),
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
    // V6 Phase 1.5: 功能开关（@Global，全局可用）
    FeatureFlagModule,
    // V6 Phase 1.11: 通知推送（@Global，全局可用）
    NotificationModule,
    // V6 Phase 2.1: 策略引擎（@Global，全局可用）
    StrategyModule,
    // V6 Phase 2.12: 订阅模块（@Global，全局可用 — 计划/订阅/支付/配额）
    SubscriptionModule,
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
    // V6 Phase 1.13: Guard 认证后同步 userId 到 CLS 上下文
    { provide: APP_INTERCEPTOR, useClass: ClsUserInterceptor },
    { provide: APP_GUARD, useClass: UserThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(LoggerMiddleware).forRoutes('*');
  }
}
