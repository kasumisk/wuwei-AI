import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { HttpsProxyAgent } from 'https-proxy-agent';
import nodeFetch from 'node-fetch';
import { AppUserAuthType, AppUserStatus } from '../../user/user.types';
import { app_users as AppUser } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { SmsService } from './sms.service';
import { WechatAuthService } from './wechat-auth.service';
import type { AppLoginResponseDto, AppUserResponseDto } from './dto/auth.dto';

@Injectable()
export class AppAuthService {
  private readonly logger = new Logger(AppAuthService.name);

  // 邮箱验证码存储（生产环境应使用 Redis）
  private emailCodes: Map<string, { code: string; expireAt: number }> =
    new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly smsService: SmsService,
    private readonly wechatAuthService: WechatAuthService,
  ) {}

  // ==================== 匿名登录 ====================

  async anonymousLogin(deviceId: string): Promise<AppLoginResponseDto> {
    let user = await this.prisma.app_users.findFirst({
      where: { device_id: deviceId, auth_type: AppUserAuthType.ANONYMOUS },
    });

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.app_users.create({
        data: {
          auth_type: AppUserAuthType.ANONYMOUS,
          device_id: deviceId,
          nickname: `用户${crypto.randomBytes(3).toString('hex')}`,
          status: AppUserStatus.ACTIVE,
        },
      });
      isNewUser = true;
      this.logger.log(`匿名用户创建成功: ${user.id}, deviceId: ${deviceId}`);
    }

    await this.prisma.app_users.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    const token = this.generateToken(user as any);
    return {
      token,
      user: this.toUserResponse(user as any),
      isNewUser,
    };
  }

  // ==================== 手机号登录 ====================

  async sendPhoneCode(phone: string): Promise<{ message: string }> {
    return this.smsService.sendCode(phone);
  }

  async phoneLogin(phone: string, code: string): Promise<AppLoginResponseDto> {
    // V6.4: verifyCode 已改为异步（Redis 存储）
    const valid = await this.smsService.verifyCode(phone, code);
    if (!valid) {
      throw new UnauthorizedException('验证码错误或已过期');
    }

    let user = await this.prisma.app_users.findFirst({
      where: { phone },
    });

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.app_users.create({
        data: {
          auth_type: AppUserAuthType.PHONE,
          phone,
          phone_verified: true,
          nickname: `用户${phone.slice(-4)}`,
          status: AppUserStatus.ACTIVE,
          last_login_at: new Date(),
        },
      });
      isNewUser = true;
      this.logger.log(`手机号用户创建成功: ${user.id}, phone: ${phone}`);
    } else {
      user = await this.prisma.app_users.update({
        where: { id: user.id },
        data: {
          phone_verified: user.phone_verified ? undefined : true,
          last_login_at: new Date(),
        },
      });
    }

    const token = this.generateToken(user as any);
    return {
      token,
      user: this.toUserResponse(user as any),
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
    let user = await this.prisma.app_users.findFirst({
      where: { wechat_open_id: wechatUser.openid },
    });

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.app_users.create({
        data: {
          auth_type: AppUserAuthType.WECHAT,
          wechat_open_id: wechatUser.openid,
          wechat_union_id: wechatUser.unionid || undefined,
          nickname: wechatUser.nickname || `微信用户`,
          avatar: wechatUser.headimgurl || undefined,
          status: AppUserStatus.ACTIVE,
          last_login_at: new Date(),
        },
      });
      isNewUser = true;
      this.logger.log(
        `微信用户创建成功: ${user.id}, openid: ${wechatUser.openid}`,
      );
    } else {
      // 更新用户信息（微信头像/昵称可能变更）
      const updateData: Record<string, any> = { last_login_at: new Date() };
      if (wechatUser.nickname && wechatUser.nickname !== user.nickname) {
        updateData.nickname = wechatUser.nickname;
      }
      if (wechatUser.headimgurl && wechatUser.headimgurl !== user.avatar) {
        updateData.avatar = wechatUser.headimgurl;
      }
      if (wechatUser.unionid && !user.wechat_union_id) {
        updateData.wechat_union_id = wechatUser.unionid;
      }
      user = await this.prisma.app_users.update({
        where: { id: user.id },
        data: updateData,
      });
    }

    const token = this.generateToken(user as any);
    return {
      token,
      user: this.toUserResponse(user as any),
      isNewUser,
    };
  }

  // ==================== 微信小程序登录 ====================

  async wechatMiniLogin(code: string): Promise<AppLoginResponseDto> {
    const session = await this.wechatAuthService.miniProgramLogin(code);

    // 1. 先通过小程序 openid 查找
    let user = await this.prisma.app_users.findFirst({
      where: { wechat_mini_open_id: session.openid },
    });

    // 2. 如果有 unionid，尝试通过 unionid 查找已有用户（跨端关联）
    if (!user && session.unionid) {
      user = await this.prisma.app_users.findFirst({
        where: { wechat_union_id: session.unionid },
      });
      if (user) {
        // 关联小程序 openid 到已有用户
        user = await this.prisma.app_users.update({
          where: { id: user.id },
          data: { wechat_mini_open_id: session.openid },
        });
      }
    }

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.app_users.create({
        data: {
          auth_type: AppUserAuthType.WECHAT_MINI,
          wechat_mini_open_id: session.openid,
          wechat_union_id: session.unionid || undefined,
          nickname: `微信用户`,
          status: AppUserStatus.ACTIVE,
          last_login_at: new Date(),
        },
      });
      isNewUser = true;
      this.logger.log(
        `小程序用户创建成功: ${user.id}, openid: ${session.openid}`,
      );
    } else {
      const updateData: Record<string, any> = { last_login_at: new Date() };
      if (session.unionid && !user.wechat_union_id) {
        updateData.wechat_union_id = session.unionid;
      }
      user = await this.prisma.app_users.update({
        where: { id: user.id },
        data: updateData,
      });
    }

    const token = this.generateToken(user as any);
    return {
      token,
      user: this.toUserResponse(user as any),
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

    let user = await this.prisma.app_users.findFirst({
      where: { google_id: googleUserInfo.sub },
    });

    let isNewUser = false;

    if (!user) {
      if (googleUserInfo.email) {
        const existingEmailUser = await this.prisma.app_users.findFirst({
          where: { email: googleUserInfo.email },
        });
        if (existingEmailUser) {
          const updateData: Record<string, any> = {
            google_id: googleUserInfo.sub,
            email_verified: true,
          };
          if (!existingEmailUser.avatar && googleUserInfo.picture) {
            updateData.avatar = googleUserInfo.picture;
          }
          if (!existingEmailUser.nickname && googleUserInfo.name) {
            updateData.nickname = googleUserInfo.name;
          }
          user = await this.prisma.app_users.update({
            where: { id: existingEmailUser.id },
            data: updateData,
          });
          this.logger.log(`Google 账号绑定到已有邮箱用户: ${user.id}`);
        }
      }

      if (!user) {
        user = await this.prisma.app_users.create({
          data: {
            auth_type: AppUserAuthType.GOOGLE,
            google_id: googleUserInfo.sub,
            email: googleUserInfo.email,
            nickname: googleUserInfo.name || `Google用户`,
            avatar: googleUserInfo.picture,
            email_verified: !!googleUserInfo.email_verified,
            status: AppUserStatus.ACTIVE,
          },
        });
        isNewUser = true;
        this.logger.log(`Google 用户创建成功: ${user.id}`);
      }
    }

    await this.prisma.app_users.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    const token = this.generateToken(user as any);
    return {
      token,
      user: this.toUserResponse(user as any),
      isNewUser,
    };
  }

  // ==================== 邮箱登录/注册 ====================

  async emailRegister(
    email: string,
    password: string,
    nickname?: string,
  ): Promise<AppLoginResponseDto> {
    const existing = await this.prisma.app_users.findFirst({
      where: { email },
    });

    if (existing) {
      throw new ConflictException('该邮箱已被注册');
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const savedUser = await this.prisma.app_users.create({
      data: {
        auth_type: AppUserAuthType.EMAIL,
        email,
        password: hashedPassword,
        nickname: nickname || `用户${crypto.randomBytes(3).toString('hex')}`,
        email_verified: false,
        status: AppUserStatus.ACTIVE,
      },
    });
    this.logger.log(`邮箱用户注册成功: ${savedUser.id}, email: ${email}`);

    const token = this.generateToken(savedUser as any);
    return {
      token,
      user: this.toUserResponse(savedUser as any),
      isNewUser: true,
    };
  }

  async emailLogin(
    email: string,
    password: string,
  ): Promise<AppLoginResponseDto> {
    const user = await this.prisma.app_users.findFirst({
      where: { email },
    });

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

    await this.prisma.app_users.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    const token = this.generateToken(user as any);
    return {
      token,
      user: this.toUserResponse(user as any),
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

    let user = await this.prisma.app_users.findFirst({
      where: { email },
    });

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.app_users.create({
        data: {
          auth_type: AppUserAuthType.EMAIL,
          email,
          nickname: `用户${crypto.randomBytes(3).toString('hex')}`,
          email_verified: true,
          status: AppUserStatus.ACTIVE,
        },
      });
      isNewUser = true;
    } else {
      if (!user.email_verified) {
        await this.prisma.app_users.update({
          where: { id: user.id },
          data: { email_verified: true },
        });
      }
    }

    await this.prisma.app_users.update({
      where: { id: user.id },
      data: { last_login_at: new Date() },
    });

    const token = this.generateToken(user as any);
    return {
      token,
      user: this.toUserResponse(user as any),
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

    const user = await this.prisma.app_users.findFirst({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.app_users.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return { message: '密码重置成功' };
  }

  // ==================== 用户信息管理 ====================

  async getUserInfo(userId: string): Promise<AppUserResponseDto> {
    const user = await this.prisma.app_users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return this.toUserResponse(user as any);
  }

  async updateProfile(
    userId: string,
    data: { nickname?: string; avatar?: string },
  ): Promise<AppUserResponseDto> {
    const user = await this.prisma.app_users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    const updateData: Record<string, any> = {};
    if (data.nickname !== undefined) updateData.nickname = data.nickname;
    if (data.avatar !== undefined) updateData.avatar = data.avatar;

    const updated = await this.prisma.app_users.update({
      where: { id: userId },
      data: updateData,
    });
    return this.toUserResponse(updated as any);
  }

  async upgradeAnonymous(
    userId: string,
    email: string,
    password: string,
  ): Promise<AppLoginResponseDto> {
    const user = await this.prisma.app_users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('用户不存在');
    }

    if (user.auth_type !== AppUserAuthType.ANONYMOUS) {
      throw new BadRequestException('仅匿名用户可升级');
    }

    const existing = await this.prisma.app_users.findFirst({
      where: { email },
    });
    if (existing) {
      throw new ConflictException('该邮箱已被注册');
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const updated = await this.prisma.app_users.update({
      where: { id: userId },
      data: {
        auth_type: AppUserAuthType.EMAIL,
        email,
        password: hashedPassword,
      },
    });

    const token = this.generateToken(updated as any);
    return {
      token,
      user: this.toUserResponse(updated as any),
      isNewUser: false,
    };
  }

  async refreshToken(userId: string): Promise<{ token: string }> {
    const user = await this.prisma.app_users.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    if (user.status !== AppUserStatus.ACTIVE) {
      throw new UnauthorizedException('账号已被禁用');
    }

    const token = this.generateToken(user as any);
    return { token };
  }

  async findById(id: string): Promise<AppUser | null> {
    const user = await this.prisma.app_users.findUnique({ where: { id } });
    return user as AppUser | null;
  }

  // ==================== 私有方法 ====================

  private generateToken(user: any): string {
    const payload = {
      sub: user.id,
      authType: user.authType ?? user.auth_type,
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

  private toUserResponse(user: any): AppUserResponseDto {
    return {
      id: user.id,
      authType: user.authType ?? user.auth_type,
      email: user.email,
      phone: user.phone,
      nickname: user.nickname,
      avatar: user.avatar,
      status: user.status,
      emailVerified: user.emailVerified ?? user.email_verified,
      phoneVerified: user.phoneVerified ?? user.phone_verified,
      lastLoginAt: user.lastLoginAt ?? user.last_login_at,
      createdAt: user.createdAt ?? user.created_at,
      updatedAt: user.updatedAt ?? user.updated_at,
    };
  }
}
