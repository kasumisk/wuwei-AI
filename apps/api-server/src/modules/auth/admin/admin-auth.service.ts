import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AdminRole, AdminUserStatus } from '../../user/user.types';
import { AdminUsers as AdminUser } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { I18nService } from '../../../core/i18n';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';
import { FirebaseAdminService } from '../app/firebase-admin.service';
import {
  LoginDto,
  LoginByPhoneDto,
  RegisterDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import type {
  LoginResponseDto,
  UserDto,
  SendCodeResponseDto,
} from '@ai-platform/shared';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  /** V6.7 P0: OTP 验证码 Redis TTL（5 分钟） */
  private static readonly OTP_TTL_MS = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly i18n: I18nService,
    private readonly redis: RedisCacheService,
    private readonly firebaseAdminService: FirebaseAdminService,
  ) {}

  /**
   * 用户名密码登录
   */
  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    const { username, password } = loginDto;

    // 查找管理员用户 (支持用户名、邮箱登录)
    const user = await this.prisma.adminUsers.findFirst({
      where: {
        OR: [{ username }, { email: username }],
      },
    });

    if (!user) {
      throw new UnauthorizedException(
        this.i18n.t('auth.usernameOrPasswordInvalid'),
      );
    }

    // 验证密码
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException(
        this.i18n.t('auth.usernameOrPasswordInvalid'),
      );
    }

    // 检查用户状态
    if (user.status !== AdminUserStatus.ACTIVE) {
      throw new UnauthorizedException(this.i18n.t('auth.accountDisabled'));
    }

    // 更新最后登录时间
    await this.prisma.adminUsers.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 生成 JWT
    const token = this.generateToken(user as any);

    return { token, user: this.sanitizeUser(user) as any };
  }

  /**
   * 手机验证码登录
   */
  async loginByPhone(
    loginByPhoneDto: LoginByPhoneDto,
  ): Promise<LoginResponseDto> {
    const { phone, code } = loginByPhoneDto;

    // 验证验证码
    if (!(await this.verifyCode(phone, code))) {
      throw new UnauthorizedException(this.i18n.t('auth.codeInvalidOrExpired'));
    }

    // 查找管理员用户
    const user = await this.prisma.adminUsers.findFirst({ where: { phone } });

    if (!user) {
      throw new UnauthorizedException(
        this.i18n.t('auth.phoneNotRegisteredAdmin'),
      );
    }

    // 更新最后登录时间
    await this.prisma.adminUsers.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 生成 JWT
    const token = this.generateToken(user as any);

    return { token, user: this.sanitizeUser(user) as any };
  }

  /**
   * Token 登录
   */
  async loginByToken(token: string): Promise<LoginResponseDto> {
    try {
      const payload = this.jwtService.verify(token);
      const user = await this.findById(payload.sub);

      if (!user) {
        throw new UnauthorizedException(this.i18n.t('auth.userNotFound'));
      }

      if (user.status !== AdminUserStatus.ACTIVE) {
        throw new UnauthorizedException(this.i18n.t('auth.accountDisabled'));
      }

      // 生成新的 token
      const newToken = this.generateToken(user);

      return { token: newToken, user: this.sanitizeUser(user) as any };
    } catch {
      throw new UnauthorizedException(
        this.i18n.t('auth.tokenInvalidOrExpired'),
      );
    }
  }

  /**
   * Firebase Google 登录
   * - 仅允许在 admin_users 中已授权（白名单）的邮箱登录
   * - 仅接受 Google provider
   */
  async loginWithFirebaseGoogle(idToken: string): Promise<LoginResponseDto> {
    const decodedToken = await this.firebaseAdminService.verifyIdToken(idToken);
    if (!decodedToken) {
      throw new UnauthorizedException(this.i18n.t('auth.tokenInvalidOrExpired'));
    }

    const provider =
      decodedToken.firebase?.sign_in_provider ?? decodedToken.sign_in_provider;
    if (!provider || !['google.com', 'google'].includes(provider)) {
      throw new UnauthorizedException('仅支持 Firebase Google 登录后台');
    }

    const email = decodedToken.email?.trim().toLowerCase();
    if (!email) {
      throw new UnauthorizedException('Google 账号缺少邮箱信息');
    }

    if (!decodedToken.email_verified) {
      throw new UnauthorizedException('请使用已验证邮箱的 Google 账号登录');
    }

    const user = await this.prisma.adminUsers.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('该邮箱未加入后台白名单');
    }

    if (user.status !== AdminUserStatus.ACTIVE) {
      throw new UnauthorizedException(this.i18n.t('auth.accountDisabled'));
    }

    const updatedUser = await this.prisma.adminUsers.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        avatar: user.avatar || decodedToken.picture || undefined,
        nickname: user.nickname || decodedToken.name || undefined,
      },
    });

    const token = this.generateToken(updatedUser);
    return { token, user: this.sanitizeUser(updatedUser) as any };
  }

  /**
   * 管理员注册
   */
  async register(registerDto: RegisterDto): Promise<LoginResponseDto> {
    const { username, email, phone, password } = registerDto;

    // 检查用户名是否已存在
    const existingUser = await this.prisma.adminUsers.findFirst({
      where: {
        OR: [{ username }, ...(email ? [{ email }] : [])],
      },
    });

    if (existingUser) {
      if (existingUser.username === username) {
        throw new ConflictException(this.i18n.t('auth.usernameTaken'));
      }
      if (email && existingUser.email === email) {
        throw new ConflictException(this.i18n.t('auth.emailRegistered'));
      }
    }

    // 加密密码
    const hashedPassword = await bcrypt.hash(password, 10);

    // 创建管理员用户
    const user = await this.prisma.adminUsers.create({
      data: {
        username,
        email,
        phone,
        password: hashedPassword,
        role: AdminRole.ADMIN,
        status: AdminUserStatus.ACTIVE,
      },
    });

    // 生成 JWT
    const token = this.generateToken(user as any);
    return { token, user: this.sanitizeUser(user) as any };
  }

  /**
   * V6.7 P0: 发送验证码
   * - 使用 crypto.randomInt 生成加密安全的 6 位码
   * - Redis 存储（多实例共享，TTL 自动过期）
   * - 不在日志中输出验证码（防止 Cloud Logging 泄漏）
   */
  async sendCode(phone: string, type: string): Promise<SendCodeResponseDto> {
    // crypto.randomInt 生成 100000~999999 的加密安全随机数
    const code = crypto.randomInt(100000, 1000000).toString();

    const key = `admin:otp:${phone}`;
    await this.redis.set(key, code, AdminService.OTP_TTL_MS);
    // 重置失败计数
    await this.redis.del(`admin:otp:fail:${phone}`);

    // TODO: 实际环境中应该调用短信服务（不要在日志中打印验证码）
    if (process.env.NODE_ENV !== 'production') {
      this.logger.debug(`[OTP-DEV] phone=${phone} type=${type} code=${code}`);
    } else {
      this.logger.log(`OTP sent to phone (masked) type=${type}`);
    }

    return { message: this.i18n.t('auth.smsSent') };
  }

  /**
   * 获取用户信息
   */
  async getUserInfo(userId: string): Promise<UserDto> {
    const user = await this.prisma.adminUsers.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException(this.i18n.t('auth.userNotFound'));
    }

    return this.sanitizeUser(user) as any;
  }

  /**
   * 更新用户资料
   */
  async updateProfile(
    userId: string,
    updateProfileDto: UpdateProfileDto,
  ): Promise<UserDto> {
    const user = await this.findById(userId);

    if (!user) {
      throw new BadRequestException(this.i18n.t('auth.userNotFound'));
    }

    await this.prisma.adminUsers.update({
      where: { id: userId },
      data: updateProfileDto as any,
    });

    const updatedUser = await this.findById(userId);
    if (!updatedUser) {
      throw new BadRequestException(this.i18n.t('auth.updateFailed'));
    }
    return this.sanitizeUser(updatedUser) as any;
  }

  /**
   * 根据ID查找管理员用户
   */
  async findById(id: string): Promise<AdminUser | null> {
    const user = await this.prisma.adminUsers.findUnique({ where: { id } });
    return user;
  }

  /**
   * 生成 JWT Token
   */
  private generateToken(user: any): string {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      type: 'admin',
    };

    return this.jwtService.sign(payload);
  }

  private sanitizeUser(user: AdminUser | null): Omit<AdminUser, 'password'> | null {
    if (!user) return null;
    const { password: _password, ...rest } = user;
    return rest;
  }

  /**
   * V6.7 P0: 验证验证码
   * - Redis 存储（跨实例一致）
   * - 失败计数：5 次内连续失败锁定 15 分钟
   * - timing-safe 比较防止时序侧信道
   */
  private async verifyCode(phone: string, code: string): Promise<boolean> {
    const failKey = `admin:otp:fail:${phone}`;
    const codeKey = `admin:otp:${phone}`;

    // 检查锁定
    const failCountStr = await this.redis.get<string>(failKey);
    const failCount = failCountStr ? parseInt(failCountStr, 10) : 0;
    if (failCount >= 5) {
      this.logger.warn(`OTP locked for phone (too many failed attempts)`);
      return false;
    }

    const storedCode = await this.redis.get<string>(codeKey);
    if (!storedCode) {
      return false;
    }

    // timing-safe 比较
    const a = Buffer.from(storedCode);
    const b = Buffer.from(code);
    const ok =
      a.length === b.length && crypto.timingSafeEqual(a as any, b as any);

    if (!ok) {
      // 失败计数 +1，TTL 15 分钟
      await this.redis.set(failKey, String(failCount + 1), 15 * 60 * 1000);
      return false;
    }

    // 验证成功后删除验证码与失败计数
    await this.redis.del(codeKey);
    await this.redis.del(failKey);
    return true;
  }
}
