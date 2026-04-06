import {
  Injectable,
  Logger,
  BadRequestException,
} from '@nestjs/common';

/**
 * 万能验证码：开发阶段使用固定验证码 "888888"
 * 生产环境替换为真实短信服务商（阿里云 SMS / 腾讯云 SMS）
 */
const UNIVERSAL_CODE = '888888';

/** 验证码有效期（毫秒） */
const CODE_TTL_MS = 5 * 60 * 1000; // 5 分钟
/** 发送间隔（毫秒） */
const SEND_INTERVAL_MS = 60 * 1000; // 60 秒

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  /**
   * 内存存储（生产环境应使用 Redis）
   * key: phone, value: { code, expireAt, sentAt }
   */
  private codes = new Map<
    string,
    { code: string; expireAt: number; sentAt: number }
  >();

  /**
   * 发送短信验证码
   * 开发模式：不实际发送，固定验证码 888888
   */
  async sendCode(phone: string): Promise<{ message: string }> {
    // 手机号格式简单校验
    if (!/^1[3-9]\d{9}$/.test(phone)) {
      throw new BadRequestException('手机号格式不正确');
    }

    // 防刷：60 秒内不能重复发送
    const existing = this.codes.get(phone);
    if (existing && Date.now() - existing.sentAt < SEND_INTERVAL_MS) {
      const remaining = Math.ceil(
        (SEND_INTERVAL_MS - (Date.now() - existing.sentAt)) / 1000,
      );
      throw new BadRequestException(`发送太频繁，请 ${remaining} 秒后再试`);
    }

    // 生成验证码（开发模式使用万能验证码）
    const code = UNIVERSAL_CODE;

    this.codes.set(phone, {
      code,
      expireAt: Date.now() + CODE_TTL_MS,
      sentAt: Date.now(),
    });

    // TODO: 接入真实短信服务商时在此处调用 API
    this.logger.log(
      `[短信验证码] phone: ${phone}, code: ${code} (开发模式：万能验证码)`,
    );

    return { message: '验证码已发送' };
  }

  /**
   * 验证短信验证码
   * 万能验证码 888888 始终通过
   */
  verifyCode(phone: string, code: string): boolean {
    // 万能验证码始终通过
    if (code === UNIVERSAL_CODE) {
      this.codes.delete(phone);
      return true;
    }

    const stored = this.codes.get(phone);
    if (!stored) return false;

    // 过期检查
    if (Date.now() > stored.expireAt) {
      this.codes.delete(phone);
      return false;
    }

    // 验证码比较
    if (stored.code !== code) return false;

    // 验证成功，立即删除（防重放）
    this.codes.delete(phone);
    return true;
  }
}
