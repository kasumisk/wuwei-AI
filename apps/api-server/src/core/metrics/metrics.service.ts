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
    labelNames: ['mealType'] as const,
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

  // ─── V8.0 P0-4: 推荐质量观测指标（审计 P0-4） ───
  //
  // 设计原则：
  //   - 这些指标用于回答"推荐系统当前是否在做正确的事"，而不是"是否快"。
  //   - 标签维度尽量低基数（避免 user/food id 直接打标签 → cardinality 爆炸）。
  //   - 优先 Counter（累加 + rate）而非 Gauge（瞬时值，难做 SLO）。

  /**
   * 区域加成是否实际激活的计数器。
   *
   * 标签：
   *   - active: 'yes' = ctx.regionCode 非空且命中区域配置
   *             'no'  = regionCode 为空 / 未命中配置（说明用户画像缺失）
   *
   * 用途：监控 regional_boost_active_ratio = yes / (yes + no)。
   *      预期 ≥ 0.85；若骤降说明用户区域信息采集链路异常。
   */
  readonly regionalBoostActive = new Counter({
    name: 'recommendation_regional_boost_active_total',
    help: '推荐时区域加成是否激活（按 active=yes/no 计数）',
    labelNames: ['active'] as const,
  });

  /**
   * 食物 RegionalInfo 数据覆盖率（按推荐召回的食物维度）。
   *
   * 标签：
   *   - status: 'present' = 食物在当前 regionCode 下有 RegionalInfo
   *             'missing' = 该 regionCode 下无 RegionalInfo（fallback 到默认）
   *             'no_region' = 请求未带 regionCode
   *
   * 用途：coverage = present / total，是衡量 ContentOps 数据完成度的关键指标。
   */
  readonly foodRegionalInfoCoverage = new Counter({
    name: 'recommendation_food_regional_info_coverage_total',
    help: '推荐召回食物的 RegionalInfo 命中情况',
    labelNames: ['status'] as const,
  });

  /**
   * Cuisine 偏好命中率（用户 cuisine 偏好 vs 推荐结果 cuisine）。
   *
   * 标签：
   *   - hit: 'yes' = 推荐结果 cuisine 在用户偏好集合中
   *          'no'  = 不在偏好集合中（探索/兜底）
   *          'no_preference' = 用户未设置 cuisine 偏好
   *
   * 用途：hit_ratio = yes / (yes + no)，过低说明 affinity 因子权重不足或
   *      preference cache key 漂移；过高说明探索不够（多样性塌缩）。
   */
  readonly cuisineAffinityHit = new Counter({
    name: 'recommendation_cuisine_affinity_hit_total',
    help: 'Cuisine 偏好命中情况',
    labelNames: ['hit'] as const,
  });

  /**
   * LearnedRanking 维度对齐失败计数（审计 P0-1 / P5）。
   *
   * 当读取到的 learned weights 长度 ≠ SCORE_DIMENSIONS.length 时计数 +1。
   * 触发场景：旧版本 12 维数据未被新版本 14 维 cron 覆盖；schema 升级期。
   *
   * 用途：>0 说明有维度污染降级，应触发 weight-learner 重训补救。
   */
  readonly seasonalityDimMismatch = new Counter({
    name: 'recommendation_learned_weights_dim_mismatch_total',
    help: 'LearnedRanking weights 维度与 SCORE_DIMENSIONS 不一致的次数（已降级到 baseline）',
  });

  /**
   * 推荐 channel 分布（审计 P0-3 后续观察）。
   *
   * 标签：
   *   - channel: 经过 normalizeChannel 后的白名单值（含 'unknown'）
   *
   * 用途：观察 unknown 占比；接入 client-context middleware 后预期降到 < 1%。
   */
  readonly recommendationChannel = new Counter({
    name: 'recommendation_channel_total',
    help: '推荐请求 channel 分布（已规范化）',
    labelNames: ['channel'] as const,
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
