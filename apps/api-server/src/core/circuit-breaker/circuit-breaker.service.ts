/**
 * V6.5 Phase 1H — Circuit Breaker Service
 *
 * 基于 opossum 库实现熔断器模式，保护外部服务调用（如 AI Provider、外部 API）。
 *
 * 功能：
 * - 按服务名管理独立的 Circuit Breaker 实例
 * - 可自定义超时、错误阈值、恢复时间等参数
 * - 状态变化时自动记录 Prometheus 指标
 * - 支持 fallback 和优雅降级
 *
 * 状态流转：CLOSED → OPEN → HALF-OPEN → CLOSED
 * - CLOSED：正常放行请求
 * - OPEN：错误率超阈值，拒绝所有请求，返回快速失败
 * - HALF-OPEN：恢复超时后放行少量请求，成功则 CLOSE，失败则重新 OPEN
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import CircuitBreaker from 'opossum';
import { MetricsService } from '../metrics/metrics.service';

/** Circuit Breaker 配置选项（透传 opossum Options 的子集） */
export interface CircuitBreakerOptions {
  /** 单次调用超时（ms），默认 30000 */
  timeout?: number;
  /** 错误率阈值（百分比），默认 50 */
  errorThresholdPercentage?: number;
  /** 熔断后恢复尝试的等待时间（ms），默认 30000 */
  resetTimeout?: number;
  /** 滚动统计窗口长度（ms），默认 60000 */
  rollingCountTimeout?: number;
  /** 滚动窗口桶数，默认 6 */
  rollingCountBuckets?: number;
  /** 允许 HALF-OPEN 状态下通过的并发请求数，默认 1 */
  allowWarmUp?: boolean;
  /** 容量桶大小，默认 10（至少需要这么多请求才会计算错误率） */
  volumeThreshold?: number;
}

@Injectable()
export class CircuitBreakerService implements OnModuleDestroy {
  private readonly logger = new Logger(CircuitBreakerService.name);
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(private readonly metricsService: MetricsService) {}

  /**
   * 获取或创建指定服务的 Circuit Breaker
   *
   * @param serviceName 服务标识（如 'openrouter', 'food-api'）
   * @param options 可选配置，首次创建时生效
   * @returns CircuitBreaker 实例，可通过 .fire(fn) 执行受保护的调用
   *
   * @example
   * ```ts
   * const breaker = this.circuitBreakerService.getBreaker('openrouter', {
   *   timeout: 15000,
   *   errorThresholdPercentage: 60,
   * });
   * const result = await breaker.fire(async () => {
   *   return await fetch('https://api.openrouter.ai/...');
   * });
   * ```
   */
  getBreaker(
    serviceName: string,
    options?: CircuitBreakerOptions,
  ): CircuitBreaker {
    if (!this.breakers.has(serviceName)) {
      const defaultOptions: CircuitBreaker.Options = {
        timeout: 30_000,
        errorThresholdPercentage: 50,
        resetTimeout: 30_000,
        rollingCountTimeout: 60_000,
        rollingCountBuckets: 6,
        volumeThreshold: 10,
        ...options,
      };

      // opossum 接受一个函数作为被保护的动作
      // 我们用一个通用的 pass-through：传入的 fn 直接执行
      const breaker = new CircuitBreaker(
        async (fn: () => Promise<any>) => fn(),
        defaultOptions,
      );

      // 状态变化事件 → 日志 + Prometheus 指标
      breaker.on('open', () => {
        this.logger.warn(`Circuit OPEN: ${serviceName}`);
        this.metricsService.incrementCircuitEvent(serviceName, 'open');
      });

      breaker.on('halfOpen', () => {
        this.logger.log(`Circuit HALF-OPEN: ${serviceName}`);
        this.metricsService.incrementCircuitEvent(serviceName, 'half_open');
      });

      breaker.on('close', () => {
        this.logger.log(`Circuit CLOSED: ${serviceName}`);
        this.metricsService.incrementCircuitEvent(serviceName, 'close');
      });

      breaker.on('fallback', () => {
        this.metricsService.incrementCircuitEvent(serviceName, 'fallback');
      });

      breaker.on('timeout', () => {
        this.logger.warn(`Circuit TIMEOUT: ${serviceName}`);
        this.metricsService.incrementCircuitEvent(serviceName, 'timeout');
      });

      breaker.on('reject', () => {
        this.metricsService.incrementCircuitEvent(serviceName, 'reject');
      });

      this.breakers.set(serviceName, breaker);
    }

    return this.breakers.get(serviceName)!;
  }

  /**
   * 获取指定熔断器当前状态
   * @returns 'closed' | 'open' | 'halfOpen' | undefined（不存在）
   */
  getState(serviceName: string): 'closed' | 'open' | 'halfOpen' | undefined {
    const breaker = this.breakers.get(serviceName);
    if (!breaker) return undefined;

    if (breaker.opened) return 'open';
    if (breaker.halfOpen) return 'halfOpen';
    return 'closed';
  }

  /**
   * 获取所有已注册熔断器的状态摘要
   */
  getAllStates(): Record<string, string> {
    const states: Record<string, string> = {};
    for (const [name] of this.breakers) {
      states[name] = this.getState(name) ?? 'unknown';
    }
    return states;
  }

  /**
   * 模块销毁时关闭所有 Circuit Breaker，释放内部定时器
   */
  onModuleDestroy(): void {
    for (const [name, breaker] of this.breakers) {
      this.logger.log(`Shutting down circuit breaker: ${name}`);
      breaker.shutdown();
    }
    this.breakers.clear();
  }
}
