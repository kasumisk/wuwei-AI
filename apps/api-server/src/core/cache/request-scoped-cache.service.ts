/**
 * V7.3 P3-A: 请求级缓存服务
 *
 * @Injectable({ scope: Scope.REQUEST }) — 每个 HTTP 请求自动创建新实例，
 * 请求结束后 GC 回收，不会跨请求泄漏数据。
 *
 * 使用场景：
 * - UserProfileService.getProfile(userId) — 同一请求内被 Engine, Scorer, Explainer 各调用一次
 * - FoodPoolCache.getVerifiedFoods() — 同一请求内 recall + rank + rerank 都需要
 * - NutritionTargetService.computeTargets() — Scorer + Assembler 都需要
 *
 * 特点：
 * 1. 内存 Map 存储，零网络开销
 * 2. 支持同步和异步 factory
 * 3. 同 key 并发请求合并（singleflight）
 * 4. 请求结束自动清理（Scope.REQUEST 生命周期管理）
 */
import { Injectable, Logger, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.REQUEST })
export class RequestScopedCacheService {
  private readonly logger = new Logger(RequestScopedCacheService.name);

  /** 已缓存的结果 */
  private readonly cache = new Map<string, any>();

  /** 正在执行的 Promise（singleflight 防击穿） */
  private readonly inflight = new Map<string, Promise<any>>();

  /** 命中 / 未命中统计（调试用） */
  private hits = 0;
  private misses = 0;

  /**
   * 获取或设置缓存值
   *
   * 如果 key 已缓存，直接返回。否则执行 factory 计算并缓存结果。
   * factory 可以是同步或异步函数。
   *
   * @param key 缓存键（建议格式：`ServiceName:methodName:params`）
   * @param factory 值计算函数
   */
  async getOrSet<T>(key: string, factory: () => T | Promise<T>): Promise<T> {
    // 1. 缓存命中
    if (this.cache.has(key)) {
      this.hits++;
      return this.cache.get(key) as T;
    }

    // 2. Singleflight — 同 key 并发请求合并
    const existing = this.inflight.get(key);
    if (existing) {
      this.hits++;
      return existing as Promise<T>;
    }

    // 3. 执行 factory
    this.misses++;
    const promise = Promise.resolve(factory());
    this.inflight.set(key, promise);

    try {
      const result = await promise;
      this.cache.set(key, result);
      return result;
    } finally {
      this.inflight.delete(key);
    }
  }

  /**
   * 同步版本的 getOrSet（仅适用于同步 factory）
   *
   * 如果值不存在且 factory 是同步函数，直接计算并缓存。
   * 不支持 singleflight（同步不需要）。
   */
  getOrSetSync<T>(key: string, factory: () => T): T {
    if (this.cache.has(key)) {
      this.hits++;
      return this.cache.get(key) as T;
    }

    this.misses++;
    const result = factory();
    this.cache.set(key, result);
    return result;
  }

  /**
   * 检查 key 是否已缓存
   */
  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * 获取已缓存的值（不触发 factory）
   */
  get<T>(key: string): T | undefined {
    return this.cache.get(key) as T | undefined;
  }

  /**
   * 手动设置缓存值
   */
  set<T>(key: string, value: T): void {
    this.cache.set(key, value);
  }

  /**
   * 失效指定 key
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
    this.inflight.clear();
  }

  /**
   * 获取缓存统计（调试用）
   */
  getStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0,
    };
  }
}
