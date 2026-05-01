/**
 * V6 Phase 1.12 — 分层限流 Guard
 *
 * 扩展 @nestjs/throttler 的 ThrottlerGuard，实现：
 *
 * 1. **用户级限流**: 认证用户按 userId 限流（而非默认的 IP），
 *    解决同一公司出口 IP 共享限流的问题
 * 2. **未认证请求**: 回退到 IP 限流（保护登录等公开接口）
 * 3. **多层限流**: 通过 ThrottlerModule 的 named throttlers 实现
 *    - 'default':  IP 级宽松兜底
 *    - 'user-api': 用户级常规
 *    - 'ai-heavy': 用户级 AI 重计算
 *    - 'strict':   用户级低频高消耗（登录/注册/导出）
 * 4. **Admin 限流**: /admin/* 路由仍然走限流（防暴力破解 admin 登录），
 *    但因 admin 操作幅度大，建议在 admin controller 上显式放宽，
 *    例如 @UserApiThrottle(300, 60)。健康检查 / metrics 端点仍跳过。
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
   * 覆盖 canActivate：仅对探针端点跳过限流。
   *
   * 之前版本会对 /admin/* 整体跳过，导致 admin 登录接口零防护，
   * 任何攻击者扫到路径后可无限暴力破解。现在已收紧。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const path = req.path ?? '';

    // 仅放行 K8s/Cloud Run 探针与 Prometheus 抓取端点
    if (
      path === '/health' ||
      path.endsWith('/health') ||
      path === '/metrics' ||
      path.endsWith('/metrics')
    ) {
      return true;
    }

    return super.canActivate(context);
  }

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
    // 未认证: 回退到 IP（含 X-Forwarded-For，兼容 Cloud Run 反代）
    const request = req as Request;
    const xff = request.headers['x-forwarded-for'];
    const xffIp = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim();
    return xffIp || request.ip || 'unknown';
  }
}
