import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from 'nestjs-throttler-storage-redis';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
// 基础设施
import { CoreModule } from './core/core.module';
import { StorageModule } from './storage/storage.module';
import { QueueModule } from './core/queue/queue.module';
// V6.4: Prometheus 可观测性
import { MetricsModule, MetricsMiddleware } from './core/metrics';
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
// V6.3 P2-6: 菜谱模块
import { RecipeModule } from './modules/recipe/recipe.module';
// 系统服务
import { HealthModule } from './health/health.module';
import { GatewayModule } from './gateway/gateway.module';
import { LlmModule } from './core/llm/llm.module';
import { CompressModule } from './compress/compress.module';
import { FoodPipelineModule } from './food-pipeline/food-pipeline.module';
// 全局
import { AllExceptionsFilter } from './core/filters/all-exceptions.filter';
import { LoggerMiddleware } from './core/middlewares/logger.middleware';
import { I18nMiddleware } from './core/i18n/i18n.middleware';
import { ResponseInterceptor } from './core/interceptors/response.interceptor';
// V6 Phase 1.12: 分层限流（default: 100/60s, user-api: 30/60s, ai-heavy: 5/60s）
import { UserThrottlerGuard, THROTTLE_CONFIG } from './core/throttle';
// V6.6 Phase 1-B: ThrottlerModule Redis 化需要 RedisCacheService
import { RedisCacheService } from './core/redis/redis-cache.service';
// V6 Phase 1.13: 请求上下文拦截器（Guard 后同步 userId 到 CLS）
import { ClsUserInterceptor } from './core/context';
// V6.5 Phase 1H: Circuit Breaker（全局熔断保护）
import { CircuitBreakerModule } from './core/circuit-breaker';
// V6.5 Phase 1I: EventEmitter2 全局错误处理
import { EventErrorHandler } from './core/events';
// V6.5 Phase 1J: ScheduleModule 全局注册（从 food-pipeline.module 迁移）
import { ScheduleModule } from '@nestjs/schedule';

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
    // V6.4: Prometheus 指标收集 + /metrics 端点
    MetricsModule,
    // V6.5 Phase 1H: Circuit Breaker 全局模块（保护外部服务调用）
    CircuitBreakerModule,
    // V6.5 Phase 1J: @nestjs/schedule 全局注册（Cron 任务调度，从 FoodPipelineModule 迁移）
    ScheduleModule.forRoot(),
    // V6 Phase 1.12 + V6.6 Phase 1-B: 分层限流，Redis 持久化存储（多实例安全）
    // Redis 不可用时 ThrottlerStorageRedisService 内部回退为内存存储
    // 注意：useFactory 在依赖注入阶段执行，早于 onModuleInit，因此使用
    // isConfigured（构造函数阶段即确定）而非 isConnected（onModuleInit 后才为 true）。
    // ioredis 客户端在 RedisCacheService 构造函数中创建，连接异步建立，命令自动排队。
    ThrottlerModule.forRootAsync({
      imports: [CoreModule],
      inject: [RedisCacheService],
      useFactory: (redisCache: RedisCacheService) => ({
        throttlers: THROTTLE_CONFIG,
        storage: redisCache.isConfigured
          ? new ThrottlerStorageRedisService(redisCache.getClient())
          : undefined, // undefined → 使用默认内存存储（Redis 未配置时降级）
      }),
    }),
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
    // V6.3 P2-6: 菜谱模块（CRUD + 评分）
    RecipeModule,
    // 系统服务
    HealthModule,
    GatewayModule,
    // V7 Checkpoint 2: 统一 LLM 调用层（直连模式 + 配额 + 熔断 + cost 入账）
    LlmModule,
    CompressModule,
    FoodPipelineModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    // V6.5 Phase 1I: 全局事件错误处理（OnModuleInit 自动注册 error handler）
    EventErrorHandler,
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
    // V6.4: HTTP 请求 Prometheus 指标采集
    consumer.apply(MetricsMiddleware).forRoutes('*');
    // V6.6 Phase 3-B: Accept-Language 检测，写入 CLS locale
    consumer.apply(I18nMiddleware).forRoutes('*');
  }
}
