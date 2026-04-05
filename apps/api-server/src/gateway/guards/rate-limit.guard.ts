import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

// 简单的内存计数器（生产环境应使用 Redis）
const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

@Injectable()
export class RateLimitGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const client = request.client;
    const permission = request.permission;

    if (!client || !permission) {
      return true; // 如果没有客户端信息，跳过速率限制检查
    }

    // 获取速率限制配置（从权限配置或客户端配置）
    const rateLimit =
      permission.rateLimit || client.quotaConfig?.rateLimit || 60;

    // 缓存键
    const key = `${client.id}:${permission.capabilityType}`;
    const now = Date.now();
    const windowMs = 60 * 1000; // 1分钟窗口

    // 获取当前计数
    let record = rateLimitStore.get(key);

    // 如果记录不存在或已过期，创建新记录
    if (!record || now > record.resetAt) {
      record = { count: 0, resetAt: now + windowMs };
      rateLimitStore.set(key, record);
    }

    // 检查是否超过限制
    if (record.count >= rateLimit) {
      throw new HttpException(
        {
          success: false,
          code: HttpStatus.TOO_MANY_REQUESTS,
          message: `速率限制超出。最大允许 ${rateLimit} 次/分钟`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // 增加计数
    record.count++;

    return true;
  }

  // 定期清理过期记录
  private cleanupExpired() {
    const now = Date.now();
    for (const [key, record] of rateLimitStore.entries()) {
      if (now > record.resetAt) {
        rateLimitStore.delete(key);
      }
    }
  }
}
