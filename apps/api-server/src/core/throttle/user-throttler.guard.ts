/**
 * V6 Phase 1.12 — 分层限流 Guard
 *
 * 扩展 @nestjs/throttler 的 ThrottlerGuard，实现：
 *
 * 1. **用户级限流**: 认证用户按 userId 限流（而非默认的 IP），
 *    解决同一公司出口 IP 共享限流的问题
 * 2. **未认证请求**: 回退到 IP 限流（保护登录等公开接口）
 * 3. **多层限流**: 通过 ThrottlerModule 的 named throttlers 实现
 *    - 'default': 全局宽松限制（100 req/60s）
 *    - 'user-api': 用户级 API 限制（30 req/60s per user）
 *    - 'ai-heavy': AI 重计算接口限制（5 req/60s per user）
 *
 * 使用方式（Controller / Route 级别）：
 * ```
 * @Throttle({ 'ai-heavy': { limit: 3, ttl: 60000 } })
 * ```
 * 或使用预设装饰器：
 * ```
 * @AiHeavyThrottle()
 * ```
 */
import { Injectable, ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';

@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  /**
   * 重写 getTracker: 认证用户用 userId，未认证用 IP
   *
   * @nestjs/throttler v6 的 getTracker 签名:
   * getTracker(req: Record<string, any>): Promise<string>
   */
  protected async getTracker(req: Record<string, any>): Promise<string> {
    // 认证用户: req.user 由 Passport JwtStrategy 注入
    const user = req.user as { id?: string } | undefined;
    if (user?.id) {
      return `user:${user.id}`;
    }
    // 未认证: 回退到 IP
    const request = req as Request;
    return (
      request.ip || request.headers['x-forwarded-for']?.toString() || 'unknown'
    );
  }
}
