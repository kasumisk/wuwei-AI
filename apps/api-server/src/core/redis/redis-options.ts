/**
 * Redis 连接配置 helper —— 支持按用途切分 Redis 实例。
 *
 * 优先级：
 *   1. <PREFIX>_REDIS_URL                     // 例如 CACHE_REDIS_URL / QUEUE_REDIS_URL
 *   2. <PREFIX>_REDIS_HOST + <PREFIX>_REDIS_PORT
 *   3. REDIS_URL                              // legacy / dev 单实例
 *   4. REDIS_HOST + REDIS_PORT
 *
 * 使用场景：
 *   - 生产建议把 cache 和 queue 拆到不同 Redis 实例（cache 流失 ≠ queue 流失）。
 *   - 测试 / dev 用同一个 REDIS_URL，所有 prefix 共享。
 *
 * 返回结构：可直接用作 ioredis 构造参数，或 BullMQ 的 connection 字段。
 */
import { ConfigService } from '@nestjs/config';

export interface ResolvedRedisOptions {
  /** 解析得到的最终 URL（如果用户提供了 *_REDIS_URL / REDIS_URL） */
  url?: string;
  host: string;
  port: number;
  password?: string;
  username?: string;
  db: number;
  /** rediss:// 协议 */
  tls: boolean;
  /** 来源：用于日志诊断 */
  source: string;
}

export function resolveRedisOptions(
  config: ConfigService,
  prefix: 'CACHE' | 'QUEUE' | null = null,
): ResolvedRedisOptions | null {
  // 1. <PREFIX>_REDIS_URL
  if (prefix) {
    const prefixedUrl = config.get<string>(`${prefix}_REDIS_URL`);
    if (prefixedUrl) {
      return parseUrl(prefixedUrl, `${prefix}_REDIS_URL`);
    }
    const prefixedHost = config.get<string>(`${prefix}_REDIS_HOST`);
    if (prefixedHost) {
      return {
        host: prefixedHost,
        port: parseInt(
          config.get<string>(`${prefix}_REDIS_PORT`) || '6379',
          10,
        ),
        password:
          config.get<string>(`${prefix}_REDIS_PASSWORD`) ||
          config.get<string>('REDIS_PASSWORD') ||
          undefined,
        db: parseInt(config.get<string>(`${prefix}_REDIS_DB`) || '0', 10),
        tls: false,
        source: `${prefix}_REDIS_HOST`,
      };
    }
  }

  // 2. legacy REDIS_URL
  const legacyUrl = config.get<string>('REDIS_URL');
  if (legacyUrl) {
    return parseUrl(legacyUrl, 'REDIS_URL');
  }

  // 3. legacy REDIS_HOST
  const legacyHost = config.get<string>('REDIS_HOST');
  if (legacyHost) {
    return {
      host: legacyHost,
      port: parseInt(config.get<string>('REDIS_PORT') || '6379', 10),
      password: config.get<string>('REDIS_PASSWORD') || undefined,
      db: parseInt(config.get<string>('REDIS_DB') || '0', 10),
      tls: false,
      source: 'REDIS_HOST',
    };
  }

  return null;
}

function parseUrl(rawUrl: string, source: string): ResolvedRedisOptions {
  const url = new URL(rawUrl);
  const tls = url.protocol === 'rediss:';
  return {
    url: rawUrl,
    host: url.hostname,
    port: parseInt(url.port, 10) || 6379,
    username: url.username || undefined,
    password: url.password || undefined,
    db: parseInt(url.pathname?.slice(1) || '0', 10) || 0,
    tls,
    source,
  };
}
