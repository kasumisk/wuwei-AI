import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';
import {
  AppUser,
  AppUserAuthType,
  AppUserStatus,
} from '../../entities/app-user.entity';
import { SmsService } from './sms.service';
import { WechatAuthService } from './wechat-auth.service';
import type { AppLoginResponseDto, AppUserResponseDto } from '../dto/auth.dto';

@Injectable()
export class AppAuthService {
  private readonly logger = new Logger(AppAuthService.name);

  // 邮箱验证码存储（生产环境应使用 Redis）
  private emailCodes: Map<string, { code: string; expireAt: number }> =
    new Map();

  constructor(
    @InjectRepository(AppUser)
    private readonly appUserRepository: Repository<AppUser>,
    private readonly jwtService: JwtService,
    private readonly smsService: SmsService,
    private readonly wechatAuthService: WechatAuthService,
  ) {}

  // ==================== 匿名登录 ====================

  async anonymousLogin(deviceId: string): Promise<AppLoginResponseDto> {
    let user = await this.appUserRepository.findOne({
      where: { deviceId, authType: AppUserAuthType.ANONYMOUS },
    });

    let isNewUser = false;

    if (!user) {
      user = this.appUserRepository.create({
        authType: AppUserAuthType.ANONYMOUS,
        deviceId,
        nickname: `用户${crypto.randomBytes(3).toString('hex')}`,
        status: AppUserStatus.ACTIVE,
      });
      user = await this.appUserRepository.save(user);
      isNewUser = true;
      this.logger.log(`匿名用户创建成功: ${user.id}, deviceId: ${deviceId}`);
    }

    await this.appUserRepository.update(user.id, {
      lastLoginAt: new Date(),
    });

    const token = this.generateToken(user);
    return {
      token,
      user: this.toUserResponse(user),
      isNewUser,
    };
  }

  // ==================== 手机号登录 ====================

  async sendPhoneCode(phone: string): Promise<{ message: string }> {
    return this.smsService.sendCode(phone);
  }

  async phoneLogin(
    phone: string,
    code: string,
  ): Promise<AppLoginResponseDto> {
    const valid = this.smsService.verifyCode(phone, code);
    if (!valid) {
      throw new UnauthorizedException('验证码错误或已过期');
    }

    let user = await this.appUserRepository.findOne({
      where: { phone },
    });

    let isNewUser = false;

    if (!user) {
      user = this.appUserRepository.create({
        authType: AppUserAuthType.PHONE,
        phone,
        phoneVerified: true,
        nickname: `用户${phone.slice(-4)}`,
        status: AppUserStatus.ACTIVE,
        lastLoginAt: new Date(),
      });
      user = await this.appUserRepository.save(user);
      isNewUser = true;
      this.logger.log(`手机号用户创建成功: ${user.id}, phone: ${phone}`);
    } else {
      if (!user.phoneVerified) {
        user.phoneVerified = true;
      }
      user.lastLoginAt = new Date();
      user = await this.appUserRepository.save(user);
    }

    const token = this.generateToken(user);
    return {
      token,
      user: this.toUserResponse(user),
      isNewUser,
    };
  }

  // ==================== 微信扫码登录 ====================

  getWechatAuthUrl(redirectUri: string, state?: string): string {
    return this.wechatAuthService.getAuthUrl(redirectUri, state);
  }

  async wechatLogin(code: string): Promise<AppLoginResponseDto> {
    const wechatUser = await this.wechatAuthService.loginWithCode(code);

    // 先通过 openid 查找用户
    let user = await this.appUserRepository.findOne({
      where: { wechatOpenId: wechatUser.openid },
    });

    let isNewUser = false;

    if (!user) {
      user = this.appUserRepository.create({
        authType: AppUserAuthType.WECHAT,
        wechatOpenId: wechatUser.openid,
        wechatUnionId: wechatUser.unionid || undefined,
        nickname: wechatUser.nickname || `微信用户`,
        avatar: wechatUser.headimgurl || undefined,
        status: AppUserStatus.ACTIVE,
        lastLoginAt: new Date(),
      });
      user = await this.appUserRepository.save(user);
      isNewUser = true;
      this.logger.log(
        `微信用户创建成功: ${user.id}, openid: ${wechatUser.openid}`,
      );
    } else {
      // 更新用户信息（微信头像/昵称可能变更）
      if (wechatUser.nickname && wechatUser.nickname !== user.nickname) {
        user.nickname = wechatUser.nickname;
      }
      if (wechatUser.headimgurl && wechatUser.headimgurl !== user.avatar) {
        user.avatar = wechatUser.headimgurl;
      }
      if (wechatUser.unionid && !user.wechatUnionId) {
        user.wechatUnionId = wechatUser.unionid;
      }
      user.lastLoginAt = new Date();
      user = await this.appUserRepository.save(user);
    }

    const token = this.generateToken(user);
    return {
      token,
      user: this.toUserResponse(user),
      isNewUser,
    };
  }

  // ==================== 微信小程序登录 ====================

  async wechatMiniLogin(code: string): Promise<AppLoginResponseDto> {
    const session = await this.wechatAuthService.miniProgramLogin(code);

    // 1. 先通过小程序 openid 查找
    let user = await this.appUserRepository.findOne({
      where: { wechatMiniOpenId: session.openid },
    });

    // 2. 如果有 unionid，尝试通过 unionid 查找已有用户（跨端关联）
    if (!user && session.unionid) {
      user = await this.appUserRepository.findOne({
        where: { wechatUnionId: session.unionid },
      });
      if (user) {
        // 关联小程序 openid 到已有用户
        user.wechatMiniOpenId = session.openid;
      }
    }

    let isNewUser = false;

    if (!user) {
      user = this.appUserRepository.create({
        authType: AppUserAuthType.WECHAT_MINI,
        wechatMiniOpenId: session.openid,
        wechatUnionId: session.unionid || undefined,
        nickname: `微信用户`,
        status: AppUserStatus.ACTIVE,
        lastLoginAt: new Date(),
      });
      user = await this.appUserRepository.save(user);
      isNewUser = true;
      this.logger.log(
        `小程序用户创建成功: ${user.id}, openid: ${session.openid}`,
      );
    } else {
      if (session.unionid && !user.wechatUnionId) {
        user.wechatUnionId = session.unionid;
      }
      user.lastLoginAt = new Date();
      user = await this.appUserRepository.save(user);
    }

    const token = this.generateToken(user);
    return {
      token,
      user: this.toUserResponse(user),
      isNewUser,
    };
  }

  /**
   * 微信消息验签（微信测试号配置 URL 验证用）
   */
  verifyWechatSignature(
    signature: string,
    timestamp: string,
    nonce: string,
  ): boolean {
    return this.wechatAuthService.verifySignature(signature, timestamp, nonce);
  }

  // ==================== Google 登录 ====================

  async googleLogin(idToken: string): Promise<AppLoginResponseDto> {
    const googleUserInfo = await this.verifyGoogleToken(idToken);

    let user = await this.appUserRepository.findOne({
      where: { googleId: googleUserInfo.sub },
    });

    let isNewUser = false;

    if (!user) {
      if (googleUserInfo.email) {
        const existingEmailUser = await this.appUserRepository.findOne({
          where: { email: googleUserInfo.email },
        });
        if (existingEmailUser) {
          existingEmailUser.googleId = googleUserInfo.sub;
          existingEmailUser.emailVerified = true;
          if (!existingEmailUser.avatar && googleUserInfo.picture) {
            existingEmailUser.avatar = googleUserInfo.picture;
          }
          if (!existingEmailUser.nickname && googleUserInfo.name) {
            existingEmailUser.nickname = googleUserInfo.name;
          }
          user = await this.appUserRepository.save(existingEmailUser);
          this.logger.log(`Google 账号绑定到已有邮箱用户: ${user.id}`);
        }
      }

      if (!user) {
        user = this.appUserRepository.create({
          authType: AppUserAuthType.GOOGLE,
          googleId: googleUserInfo.sub,
          email: googleUserInfo.email,
          nickname: googleUserInfo.name || `Google用户`,
          avatar: googleUserInfo.picture,
          emailVerified: !!googleUserInfo.email_verified,
          status: AppUserStatus.ACTIVE,
        });
        user = await this.appUserRepository.save(user);
        isNewUser = true;
        this.logger.log(`Google 用户创建成功: ${user.id}`);
      }
    }

    await this.appUserRepository.update(user.id, {
      lastLoginAt: new Date(),
    });

    const token = this.generateToken(user);
    return {
      token,
      user: this.toUserResponse(user),
      isNewUser,
    };
  }

  // ==================== 邮箱登录/注册 ====================

  async emailRegister(
    email: string,
    password: string,
    nickname?: string,
  ): Promise<AppLoginResponseDto> {
    const existing = await this.appUserRepository.findOne({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('该邮箱已被注册');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = this.appUserRepository.create({
      authType: AppUserAuthType.EMAIL,
      email,
      password: hashedPassword,
      nickname: nickname || `用户${crypto.randomBytes(3).toString('hex')}`,
      emailVerified: false,
      status: AppUserStatus.ACTIVE,
    });

    const savedUser = await this.appUserRepository.save(user);
    this.logger.log(`邮箱用户注册成功: ${savedUser.id}, email: ${email}`);

    const token = this.generateToken(savedUser);
    return {
      token,
      user: this.toUserResponse(savedUser),
      isNewUser: true,
    };
  }

  async emailLogin(
    email: string,
    password: string,
  ): Promise<AppLoginResponseDto> {
    const user = await this.appUserRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    if (!user.password) {
      throw new UnauthorizedException('该邮箱未设置密码，请使用其他方式登录');
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    if (user.status !== AppUserStatus.ACTIVE) {
      throw new UnauthorizedException('账号已被禁用');
    }

    await this.appUserRepository.update(user.id, {
      lastLoginAt: new Date(),
    });

    const token = this.generateToken(user);
    return {
      token,
      user: this.toUserResponse(user),
      isNewUser: false,
    };
  }

  async emailCodeLogin(
    email: string,
    code: string,
  ): Promise<AppLoginResponseDto> {
    if (!this.verifyEmailCode(email, code)) {
      throw new UnauthorizedException('验证码错误或已过期');
    }

    let user = await this.appUserRepository.findOne({
      where: { email },
    });

    let isNewUser = false;

    if (!user) {
      user = this.appUserRepository.create({
        authType: AppUserAuthType.EMAIL,
        email,
        nickname: `用户${crypto.randomBytes(3).toString('hex')}`,
        emailVerified: true,
        status: AppUserStatus.ACTIVE,
      });
      user = await this.appUserRepository.save(user);
      isNewUser = true;
    } else {
      if (!user.emailVerified) {
        user.emailVerified = true;
        await this.appUserRepository.save(user);
      }
    }

    await this.appUserRepository.update(user.id, {
      lastLoginAt: new Date(),
    });

    const token = this.generateToken(user);
    return {
      token,
      user: this.toUserResponse(user),
      isNewUser,
    };
  }

  // ==================== 验证码管理 ====================

  generateEmailCode(email: string, type: string): { message: string } {
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    this.emailCodes.set(email, {
      code,
      expireAt: Date.now() + 5 * 60 * 1000,
    });

    // TODO: 调用邮件服务发送验证码
    this.logger.log(
      `[邮箱验证码] email: ${email}, code: ${code}, type: ${type}`,
    );

    return { message: '验证码已发送' };
  }

  // ==================== 密码重置 ====================

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    if (!this.verifyEmailCode(email, code)) {
      throw new BadRequestException('验证码错误或已过期');
    }

    const user = await this.appUserRepository
      .createQueryBuilder('user')
      .addSelect('user.password')
      .where('user.email = :email', { email })
      .getOne();

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await this.appUserRepository.save(user);

    return { message: '密码重置成功' };
  }

  // ==================== 用户信息管理 ====================

  async getUserInfo(userId: string): Promise<AppUserResponseDto> {
    const user = await this.appUserRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return this.toUserResponse(user);
  }

  async updateProfile(
    userId: string,
    data: { nickname?: string; avatar?: string },
  ): Promise<AppUserResponseDto> {
    const user = await this.appUserRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    if (data.nickname !== undefined) user.nickname = data.nickname;
    if (data.avatar !== undefined) user.avatar = data.avatar;

    const updated = await this.appUserRepository.save(user);
    return this.toUserResponse(updated);
  }

  async upgradeAnonymous(
    userId: string,
    email: string,
    password: string,
  ): Promise<AppLoginResponseDto> {
    const user = await this.appUserRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    if (user.authType !== AppUserAuthType.ANONYMOUS) {
      throw new BadRequestException('仅匿名用户可升级');
    }

    const existing = await this.appUserRepository.findOne({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('该邮箱已被注册');
    }

    user.authType = AppUserAuthType.EMAIL;
    user.email = email;
    user.password = await bcrypt.hash(password, 10);

    const updated = await this.appUserRepository.save(user);

    const token = this.generateToken(updated);
    return {
      token,
      user: this.toUserResponse(updated),
      isNewUser: false,
    };
  }

  async refreshToken(userId: string): Promise<{ token: string }> {
    const user = await this.appUserRepository.findOne({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    if (user.status !== AppUserStatus.ACTIVE) {
      throw new UnauthorizedException('账号已被禁用');
    }

    const token = this.generateToken(user);
    return { token };
  }

  async findById(id: string): Promise<AppUser | null> {
    return this.appUserRepository.findOne({ where: { id } });
  }

  // ==================== 私有方法 ====================

  private generateToken(user: AppUser): string {
    const payload = {
      sub: user.id,
      authType: user.authType,
      type: 'app',
    };

    return this.jwtService.sign(payload);
  }

  private getProxyAgent(): HttpsProxyAgent<string> | undefined {
    const host = process.env.PROXY_HOST;
    const port = process.env.PROXY_PORT;
    if (!host || !port) return undefined;
    const auth =
      process.env.PROXY_USERNAME && process.env.PROXY_PASSWORD
        ? `${process.env.PROXY_USERNAME}:${process.env.PROXY_PASSWORD}@`
        : '';
    return new HttpsProxyAgent(`http://${auth}${host}:${port}`);
  }

  private async verifyGoogleToken(token: string): Promise<{
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  }> {
    try {
      const idTokenResult = await this.verifyGoogleIdToken(token);
      if (idTokenResult) return idTokenResult;
    } catch {
      // id_token 验证失败，尝试 access_token
    }

    try {
      const agent = this.getProxyAgent();
      const response = await nodeFetch(
        'https://www.googleapis.com/oauth2/v3/userinfo',
        {
          headers: { Authorization: `Bearer ${token}` },
          ...(agent ? { agent } : {}),
        },
      );

      if (!response.ok) {
        throw new UnauthorizedException('Google Token 验证失败');
      }

      const payload = await response.json();

      if (!payload.sub) {
        throw new UnauthorizedException('Google Token 无效');
      }

      return {
        sub: payload.sub,
        email: payload.email,
        email_verified: payload.email_verified,
        name: payload.name,
        picture: payload.picture,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('Google Token 验证异常', error);
      throw new UnauthorizedException('Google 授权验证失败');
    }
  }

  private async verifyGoogleIdToken(idToken: string): Promise<{
    sub: string;
    email?: string;
    email_verified?: boolean;
    name?: string;
    picture?: string;
  } | null> {
    const agent = this.getProxyAgent();
    const response = await nodeFetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
      ...(agent ? [{ agent }] : []),
    );

    if (!response.ok) return null;

    const payload = await response.json();

    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    if (googleClientId && payload.aud !== googleClientId) {
      throw new UnauthorizedException('Google Token audience 不匹配');
    }

    return {
      sub: payload.sub,
      email: payload.email,
      email_verified: payload.email_verified === 'true',
      name: payload.name,
      picture: payload.picture,
    };
  }

  private verifyEmailCode(email: string, code: string): boolean {
    const stored = this.emailCodes.get(email);

    if (!stored) return false;
    if (Date.now() > stored.expireAt) {
      this.emailCodes.delete(email);
      return false;
    }
    if (stored.code !== code) return false;

    this.emailCodes.delete(email);
    return true;
  }

  private toUserResponse(user: AppUser): AppUserResponseDto {
    return {
      id: user.id,
      authType: user.authType,
      email: user.email,
      phone: user.phone,
      nickname: user.nickname,
      avatar: user.avatar,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
