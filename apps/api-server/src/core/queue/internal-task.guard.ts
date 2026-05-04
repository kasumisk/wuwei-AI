/**
 * InternalTaskGuard — 保护 /internal/tasks/* 与 /internal/cron/*。
 *
 * 双重鉴权（生产）：
 *   1) OIDC Bearer token：Cloud Tasks/Scheduler 调用时携带，由 Google 签发，
 *      audience 必须等于 CLOUD_TASKS_OIDC_AUDIENCE（默认为 handler URL）。
 *   2) X-Internal-Token：CLOUD_TASKS_INTERNAL_TOKEN 共享密钥；防止 OIDC
 *      audience 配错被外部 GCP 项目滥用。
 *
 * 测试/开发环境（NODE_ENV in {'test','development'} 或 QUEUE_BACKEND_DEFAULT=bullmq
 * 且未显式开启 ENFORCE_INTERNAL_AUTH）自动放行；本地用 curl 直接调 handler 调试。
 *
 * 失败行为：401 抛出，不记录 TaskExecutionLog；Cloud Tasks 按 queue retry config
 * 重试（这通常意味着配置错，应在监控告警里发现）。
 */
import { timingSafeEqual } from 'crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import type { Request } from 'express';

@Injectable()
export class InternalTaskGuard implements CanActivate {
  private readonly logger = new Logger(InternalTaskGuard.name);
  /** 复用 OAuth2Client 的 verifyIdToken；它内部缓存 Google 公钥（JWK）24h。 */
  private readonly oauth = new OAuth2Client();

  constructor(private readonly config: ConfigService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.shouldBypass()) return true;

    const req = ctx.switchToHttp().getRequest<Request>();

    // 1) X-Internal-Token：恒定时间比较，防 timing attack
    const expectedToken = this.config.get<string>('CLOUD_TASKS_INTERNAL_TOKEN');
    if (!expectedToken) {
      // 生产环境必须配置；防止误部署导致 endpoint 完全裸奔
      this.logger.error('CLOUD_TASKS_INTERNAL_TOKEN not set in production-like env');
      throw new UnauthorizedException('internal auth not configured');
    }
    const presentedToken = (req.headers['x-internal-token'] as string | undefined) ?? '';
    if (!safeEqual(presentedToken, expectedToken)) {
      throw new UnauthorizedException('invalid internal token');
    }

    // 2) OIDC Bearer：Cloud Tasks/Scheduler 注入
    const authz = (req.headers.authorization ?? '') as string;
    const m = /^Bearer\s+(.+)$/i.exec(authz);
    if (!m) throw new UnauthorizedException('missing oidc bearer');

    const audience = this.resolveAudience(req);
    try {
      const ticket = await this.oauth.verifyIdToken({ idToken: m[1], audience });
      const payload = ticket.getPayload();
      if (!payload?.email_verified) throw new Error('email not verified');
      const expectedSa = this.config.get<string>('CLOUD_TASKS_OIDC_SA_EMAIL');
      if (expectedSa && payload.email !== expectedSa) {
        throw new Error(`unexpected SA: ${payload.email}`);
      }
    } catch (err) {
      throw new UnauthorizedException(`oidc verify failed: ${(err as Error).message}`);
    }
    return true;
  }

  /**
   * 测试/开发环境放行规则：
   *   - NODE_ENV ∈ {test, development} → 放行
   *   - 否则按生产严格校验
   * 显式 ENFORCE_INTERNAL_AUTH=true 可强制开启鉴权（用于本地联调 OIDC）。
   */
  private shouldBypass(): boolean {
    if (this.config.get<string>('ENFORCE_INTERNAL_AUTH') === 'true') return false;
    const env = (this.config.get<string>('NODE_ENV') ?? 'development').toLowerCase();
    return env === 'test' || env === 'development';
  }

  /**
   * audience 解析：
   *   优先 CLOUD_TASKS_OIDC_AUDIENCE；否则用请求自身的 origin+path（推荐做法，
   *   Cloud Tasks 默认就是用 target URL 做 audience）。
   */
  private resolveAudience(req: Request): string {
    const explicit = this.config.get<string>('CLOUD_TASKS_OIDC_AUDIENCE');
    if (explicit) return explicit;
    const proto = (req.headers['x-forwarded-proto'] as string | undefined) ?? 'https';
    const host = req.headers.host;
    return `${proto}://${host}${req.path}`;
  }
}

/** 恒定时间字符串比较，避免 timing 攻击通过 token 长度/字符泄漏。
 *  用 crypto.timingSafeEqual：先 pad 到相同长度再比，长度差不提前短路。
 */
function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // 长度不等时补零到相同长度，避免 timingSafeEqual 抛 RangeError，
  // 同时用 |= 标记长度差，使结果仍正确为 false。
  const maxLen = Math.max(aBuf.length, bBuf.length);
  const aPad = Buffer.concat([aBuf, Buffer.alloc(maxLen - aBuf.length)]);
  const bPad = Buffer.concat([bBuf, Buffer.alloc(maxLen - bBuf.length)]);
  const equal = timingSafeEqual(aPad, bPad);
  return equal && aBuf.length === bBuf.length;
}
