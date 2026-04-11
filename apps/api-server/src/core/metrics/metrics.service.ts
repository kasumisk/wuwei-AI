/**
 * V6.4 Phase 2 — Prometheus 指标服务
 *
 * 职责：
 * - 定义和管理所有 Prometheus 指标
 * - 提供便捷方法记录 HTTP 延迟、推荐管道耗时、缓存命中率等
 * - 提供 /metrics 端点数据
 *
 * 设计：
 * - 使用 prom-client 原生库，避免过重的 NestJS wrapper
 * - 所有指标按命名空间分组（http_*, recommendation_*, cache_*, queue_*）
 * - Histogram 使用默认 bucket，可通过环境变量调整
 */
import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  collectDefaultMetrics,
  Histogram,
  Counter,
  Gauge,
  register,
} from 'prom-client';

@Injectable()
export class MetricsService implements OnModuleInit {
  // 使用默认全局 registry
  readonly registry: Registry = register;

  // ─── HTTP 指标 ───

  /** HTTP 请求延迟直方图（按 method、route、status） */
  readonly httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP 请求延迟（秒）',
    labelNames: ['method', 'route', 'status_code'] as const,
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  });

  /** HTTP 请求总数（按 method、route、status） */
  readonly httpRequestTotal = new Counter({
    name: 'http_requests_total',
    help: 'HTTP 请求总数',
    labelNames: ['method', 'route', 'status_code'] as const,
  });

  // ─── 推荐引擎指标 ───

  /** 推荐管道各阶段耗时 */
  readonly recommendationStageDuration = new Histogram({
    name: 'recommendation_stage_duration_seconds',
    help: '推荐管道各阶段耗时（秒）',
    labelNames: ['stage'] as const, // recall, rank, rerank, assemble, health_modifier
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  });

  /** 推荐请求总数（按 meal_type） */
  readonly recommendationTotal = new Counter({
    name: 'recommendation_requests_total',
    help: '推荐请求总数',
    labelNames: ['meal_type'] as const,
  });

  // ─── 缓存指标 ───

  /** 缓存操作计数（按 tier、operation、result） */
  readonly cacheOperations = new Counter({
    name: 'cache_operations_total',
    help: '缓存操作总数',
    labelNames: ['tier', 'operation', 'result'] as const, // tier: l1/l2, op: get/set, result: hit/miss/error
  });

  // ─── BullMQ 队列指标 ───

  /** 队列任务完成计数 */
  readonly queueJobsCompleted = new Counter({
    name: 'queue_jobs_completed_total',
    help: '队列任务完成总数',
    labelNames: ['queue'] as const,
  });

  /** 队列任务失败计数 */
  readonly queueJobsFailed = new Counter({
    name: 'queue_jobs_failed_total',
    help: '队列任务失败总数',
    labelNames: ['queue'] as const,
  });

  /** 队列任务处理耗时 */
  readonly queueJobDuration = new Histogram({
    name: 'queue_job_duration_seconds',
    help: '队列任务处理耗时（秒）',
    labelNames: ['queue'] as const,
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  });

  /** 队列等待任务数（Gauge） */
  readonly queueWaiting = new Gauge({
    name: 'queue_waiting_jobs',
    help: '队列等待中的任务数',
    labelNames: ['queue'] as const,
  });

  // ─── Cron 指标 ───

  /** Cron 任务执行耗时 */
  readonly cronDuration = new Histogram({
    name: 'cron_execution_duration_seconds',
    help: 'Cron 任务执行耗时（秒）',
    labelNames: ['job'] as const,
    buckets: [0.5, 1, 5, 10, 30, 60, 120, 300],
  });

  /** Cron 任务执行结果计数 */
  readonly cronExecutions = new Counter({
    name: 'cron_executions_total',
    help: 'Cron 任务执行总数',
    labelNames: ['job', 'result'] as const, // result: success/failure/skipped
  });

  // ─── 业务指标 ───

  /** 活跃用户数（Gauge，由 Cron 定期更新） */
  readonly activeUsers = new Gauge({
    name: 'active_users',
    help: '活跃用户数',
    labelNames: ['period'] as const, // daily, weekly, monthly
  });

  // ─── V6.5: Circuit Breaker 指标 ───

  /** Circuit Breaker 状态变化计数（按 service、event） */
  readonly circuitBreakerEvents = new Counter({
    name: 'circuit_breaker_events_total',
    help: 'Circuit Breaker 状态变化事件总数',
    labelNames: ['service', 'event'] as const, // event: open/close/half_open/fallback/timeout/reject
  });

  // ─── V6.5: 域事件错误指标 ───

  /** 域事件 listener 异常计数 */
  readonly eventErrors = new Counter({
    name: 'domain_event_listener_errors_total',
    help: '域事件 listener 异常总数',
  });

  // ─── V6.5 Phase 2B: 队列降级指标 ───

  /** 队列降级（fallback 到同步处理）计数 */
  readonly queueFallback = new Counter({
    name: 'queue_fallback_sync_total',
    help: '队列降级为同步处理的总次数（Redis 不可用）',
    labelNames: ['queue'] as const,
  });

  onModuleInit(): void {
    // 收集 Node.js 默认指标（CPU、内存、事件循环延迟等）
    collectDefaultMetrics({ register: this.registry });
  }

  /** 获取所有指标的 Prometheus 格式文本 */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /** 获取 Content-Type header */
  getContentType(): string {
    return this.registry.contentType;
  }

  // ─── V6.5: Circuit Breaker 便捷方法 ───

  /**
   * 记录 Circuit Breaker 状态变化事件
   * @param serviceName 被保护的服务名称（如 'openrouter'）
   * @param event 事件类型：open | close | half_open | fallback | timeout | reject
   */
  incrementCircuitEvent(
    serviceName: string,
    event: 'open' | 'close' | 'half_open' | 'fallback' | 'timeout' | 'reject',
  ): void {
    this.circuitBreakerEvents.inc({ service: serviceName, event });
  }

  /**
   * 记录域事件 listener 异常
   */
  incrementEventError(): void {
    this.eventErrors.inc();
  }

  // ─── V6.5 Phase 2B: 队列降级便捷方法 ───

  /**
   * 记录队列降级为同步处理
   * @param queueName 队列名称
   */
  incrementQueueFallback(queueName: string): void {
    this.queueFallback.inc({ queue: queueName });
  }
}
