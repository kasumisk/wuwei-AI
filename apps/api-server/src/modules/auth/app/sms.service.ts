import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';

/**
 * V6.4 P0: SMS 验证码服务
 *
 * 改进：
 * 1. 万能验证码 888888 在所有环境均可用（绕过真实短信校验）
 * 2. 验证码存储从进程内存迁移到 Redis（支持多实例 + 自动过期）
 * 3. Redis 不可用时降级到内存存储（单实例场景）
 */

/** 万能验证码：所有环境均可用 */
const DEV_UNIVERSAL_CODE = '888888';

/** 验证码有效期（秒） */
const CODE_TTL_SECONDS = 300; // 5 分钟
/** 发送间隔（秒） */
const SEND_INTERVAL_SECONDS = 60; // 60 秒
/** Redis key 前缀 */
const SMS_KEY_PREFIX = 'sms:code';
const SMS_THROTTLE_PREFIX = 'sms:throttle';

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly isProduction = process.env.NODE_ENV === 'production';

  /**
   * 内存降级存储（仅 Redis 不可用时使用）
   * key: phone, value: { code, expireAt, sentAt }
   */
  private fallbackCodes = new Map<
    string,
    { code: string; expireAt: number; sentAt: number }
  >();

  constructor(private readonly redis: RedisCacheService) {}

  /**
   * 发送短信验证码
   *
   * - 输入 888888 时直接存储该验证码（无需真实发送）
   * - 生产环境其他验证码：调用真实短信服务商
   * - 开发环境：使用万能验证码 888888（不实际发送）
   */
  async sendCode(phone: string): Promise<{ message: string }> {
    // 手机号格式简单校验
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      throw new BadRequestException('手机号格式不正确');
    }

    // 防刷：检查发送间隔
    await this.checkThrottle(phone);

    // 生成验证码（生产环境生成随机码，其余情况用万能码）
    const code = this.isProduction
      ? this.generateRandomCode()
      : DEV_UNIVERSAL_CODE;

    // 存储验证码
    await this.storeCode(phone, code);

    // 记录发送节流
    await this.setThrottle(phone);

    if (this.isProduction) {
      // TODO: 接入真实短信服务商（阿里云 SMS / 腾讯云 SMS）
      this.logger.log(
        `[短信验证码] phone: ${phone.slice(0, 3)}****${phone.slice(-4)}, 已发送`,
      );
    } else {
      this.logger.log(`[短信验证码] phone: ${phone}, code: ${code} (开发模式)`);
    }

    return { message: '验证码已发送' };
  }

  /**
   * 验证短信验证码
   *
   * 万能验证码 888888 在所有环境均有效（直接放行）
   */
  async verifyCode(phone: string, code: string): Promise<boolean> {
    // 万能验证码：所有环境均放行
    if (code === DEV_UNIVERSAL_CODE) {
      await this.deleteCode(phone);
      return true;
    }

    // 从存储中获取验证码
    const stored = await this.getStoredCode(phone);
    if (!stored) return false;

    // 过期检查
    if (Date.now() > stored.expireAt) {
      await this.deleteCode(phone);
      return false;
    }

    // 验证码比较
    if (stored.code !== code) return false;

    // 验证成功，立即删除（防重放）
    await this.deleteCode(phone);
    return true;
  }

  // ─── 私有方法 ───

  /** 生成 6 位随机数字验证码 */
  private generateRandomCode(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
  }

  /** 检查发送频率限制 */
  private async checkThrottle(phone: string): Promise<void> {
    if (this.redis.isConnected) {
      const throttleKey = `${SMS_THROTTLE_PREFIX}:${phone}`;
      const existing = await this.redis.get<number>(throttleKey);
      if (existing) {
        throw new BadRequestException('发送太频繁，请稍后再试');
      }
    } else {
      // 降级：内存检查
      const existing = this.fallbackCodes.get(phone);
      if (
        existing &&
        Date.now() - existing.sentAt < SEND_INTERVAL_SECONDS * 1000
      ) {
        const remaining = Math.ceil(
          (SEND_INTERVAL_SECONDS * 1000 - (Date.now() - existing.sentAt)) /
            1000,
        );
        throw new BadRequestException(`发送太频繁，请 ${remaining} 秒后再试`);
      }
    }
  }

  /** 设置发送频率限制 */
  private async setThrottle(phone: string): Promise<void> {
    if (this.redis.isConnected) {
      const throttleKey = `${SMS_THROTTLE_PREFIX}:${phone}`;
      await this.redis.set(
        throttleKey,
        Date.now(),
        SEND_INTERVAL_SECONDS * 1000,
      );
    }
  }

  /** 存储验证码 */
  private async storeCode(phone: string, code: string): Promise<void> {
    const data = {
      code,
      expireAt: Date.now() + CODE_TTL_SECONDS * 1000,
      sentAt: Date.now(),
    };

    if (this.redis.isConnected) {
      const codeKey = `${SMS_KEY_PREFIX}:${phone}`;
      await this.redis.set(codeKey, data, CODE_TTL_SECONDS * 1000);
    } else {
      // 降级：内存存储
      this.fallbackCodes.set(phone, data);
    }
  }

  /** 获取已存储的验证码 */
  private async getStoredCode(
    phone: string,
  ): Promise<{ code: string; expireAt: number; sentAt: number } | null> {
    if (this.redis.isConnected) {
      const codeKey = `${SMS_KEY_PREFIX}:${phone}`;
      return this.redis.get(codeKey);
    } else {
      return this.fallbackCodes.get(phone) || null;
    }
  }

  /** 删除验证码 */
  private async deleteCode(phone: string): Promise<void> {
    if (this.redis.isConnected) {
      const codeKey = `${SMS_KEY_PREFIX}:${phone}`;
      await this.redis.del(codeKey);
    } else {
      this.fallbackCodes.delete(phone);
    }
  }
}
