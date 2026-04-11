/**
 * V6 Phase 1.12 — 分层限流常量 + 装饰器
 *
 * 定义多层限流配置和便捷装饰器。
 *
 * 限流层级:
 * - default:   全局基础限制 100 req/60s（IP 级）
 * - user-api:  用户级 API 限制 30 req/60s（per userId）
 * - ai-heavy:  AI 重计算限制 5 req/60s（per userId）
 *
 * 使用示例:
 * ```
 * @AiHeavyThrottle()         // 5 req/60s
 * @UserApiThrottle(10, 60)   // 自定义 10 req/60s
 * ```
 */
import { applyDecorators } from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';

// ─── 限流层级名称 ───

export const THROTTLE_TIERS = {
  /** 全局默认（IP 级，宽松） */
  DEFAULT: 'default',
  /** 用户级 API（userId 级，中等） */
  USER_API: 'user-api',
  /** AI 重计算（userId 级，严格） */
  AI_HEAVY: 'ai-heavy',
  /** V6.4: 严格限流（低频高消耗接口，独立计数器） */
  STRICT: 'strict',
} as const;

// ─── 默认限流参数（用于 ThrottlerModule.forRoot） ───

export const THROTTLE_CONFIG = [
  {
    name: THROTTLE_TIERS.DEFAULT,
    ttl: 60000, // 60 秒
    limit: 100, // 100 次
  },
  {
    name: THROTTLE_TIERS.USER_API,
    ttl: 60000,
    limit: 30,
  },
  {
    name: THROTTLE_TIERS.AI_HEAVY,
    ttl: 60000,
    limit: 5,
  },
  {
    // V6.4: 新增独立 tier，避免与 AI_HEAVY 共享计数器
    name: THROTTLE_TIERS.STRICT,
    ttl: 60000,
    limit: 3,
  },
];

// ─── 便捷装饰器 ───

/**
 * AI 重计算接口限流（默认 5 req/60s per user）
 *
 * 适用: 图片分析、推荐生成、教练对话等 AI 接口
 */
export function AiHeavyThrottle(limit = 5, ttlSeconds = 60) {
  return applyDecorators(
    Throttle({
      [THROTTLE_TIERS.AI_HEAVY]: { limit, ttl: ttlSeconds * 1000 },
    }),
  );
}

/**
 * 用户级 API 限流（默认 30 req/60s per user）
 *
 * 适用: 普通业务接口
 */
export function UserApiThrottle(limit = 30, ttlSeconds = 60) {
  return applyDecorators(
    Throttle({
      [THROTTLE_TIERS.USER_API]: { limit, ttl: ttlSeconds * 1000 },
    }),
  );
}

/**
 * 严格限流（默认 3 req/60s）
 *
 * 适用: 导出、批量操作等低频高消耗接口
 * V6.4: 使用独立 STRICT tier，不再与 AI_HEAVY 共享计数器
 */
export function StrictThrottle(limit = 3, ttlSeconds = 60) {
  return applyDecorators(
    Throttle({
      [THROTTLE_TIERS.STRICT]: { limit, ttl: ttlSeconds * 1000 },
    }),
  );
}

/** 跳过限流（重新导出，方便导入） */
export { SkipThrottle };
