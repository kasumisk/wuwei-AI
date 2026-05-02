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
import { OAuth2Client } from 'google-auth-library';
import { AppUserAuthType, AppUserStatus } from '../../user/user.types';
import { AppUsers as AppUser } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';
import { SmsService } from './sms.service';
import { WechatAuthService } from './wechat-auth.service';
import { FirebaseAdminService } from './firebase-admin.service';
import { I18nService } from '../../../core/i18n';
import type { AppLoginResponseDto, AppUserResponseDto } from './dto/auth.dto';

@Injectable()
export class AppAuthService {
  private readonly logger = new Logger(AppAuthService.name);
  /** Google ID token 本地验证客户端（签名校验，无需 HTTP round-trip） */
  private readonly googleOAuthClient: OAuth2Client;

  // 邮箱验证码 TTL（秒）
  private static readonly EMAIL_CODE_TTL_S = 5 * 60; // 5 分钟

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly smsService: SmsService,
    private readonly wechatAuthService: WechatAuthService,
    private readonly firebaseAdminService: FirebaseAdminService,
    private readonly i18n: I18nService,
    private readonly redisCache: RedisCacheService,
  ) {
    // clientId 可以为空（库仍可验证签名，但跳过 audience 校验）
    // 生产环境应设置 GOOGLE_CLIENT_ID 以验证 aud 字段
    this.googleOAuthClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  }

  // ==================== 匿名登录 ====================

  async anonymousLogin(deviceId: string): Promise<AppLoginResponseDto> {
    let user = await this.prisma.appUsers.findFirst({
      where: { deviceId: deviceId, authType: AppUserAuthType.ANONYMOUS },
    });

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.appUsers.create({
        data: {
          authType: AppUserAuthType.ANONYMOUS,
          deviceId: deviceId,
          nickname: `User${crypto.randomBytes(3).toString('hex')}`,
          status: AppUserStatus.ACTIVE,
        },
      });
      isNewUser = true;
      this.logger.log(`匿名用户创建成功: ${user.id}, deviceId: ${deviceId}`);
    }

    await this.prisma.appUsers.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = this.generateToken(user as any);
    return {
      token,
      user: this.toUserResponse(user as any),
      isNewUser,
    };
  }

  // ==================== Firebase 登录 ====================

  async firebaseLogin(firebaseToken: string): Promise<AppLoginResponseDto> {
    const decodedToken =
      await this.firebaseAdminService.verifyIdToken(firebaseToken);

    if (decodedToken) {
      return this.loginWithVerifiedIdentity({
        uid: decodedToken.uid,
        signInProvider:
          decodedToken.firebase?.sign_in_provider ??
          decodedToken.sign_in_provider,
        email: decodedToken.email?.toLowerCase(),
        emailVerified: decodedToken.email_verified,
        displayName: decodedToken.name,
        avatar: decodedToken.picture,
      });
    }

    this.logger.warn(
      `Firebase verifyIdToken 失败，尝试按 Google token 回退验证（projectId=${this.firebaseAdminService.getCurrentProjectId() ?? 'unknown'}）`,
    );

    try {
      const googleUserInfo = await this.verifyGoogleToken(firebaseToken);
      return this.loginWithVerifiedIdentity({
        uid: googleUserInfo.sub,
        signInProvider: 'google.com',
        email: googleUserInfo.email?.toLowerCase(),
        emailVerified: googleUserInfo.emailVerified,
        displayName: googleUserInfo.name,
        avatar: googleUserInfo.picture,
      });
    } catch (error) {
      this.logger.error(
        `Firebase/Google 双重验证均失败: ${error instanceof Error ? error.message : error}`,
      );
      throw new UnauthorizedException(this.i18n.t('auth.googleTokenInvalid'));
    }
  }

  private async loginWithVerifiedIdentity(params: {
    uid: string;
    signInProvider?: string;
    email?: string;
    emailVerified?: boolean;
    displayName?: string;
    avatar?: string;
  }): Promise<AppLoginResponseDto> {
    const { uid, signInProvider, email, emailVerified, displayName, avatar } =
      params;

    let user = await this.findUserByFirebaseIdentity({
      uid,
      signInProvider,
      email,
    });

    let isNewUser = false;

    if (!user) {
      user = await this.findUserByEmail(email);
      if (user) {
        user = await this.prisma.appUsers.update({
          where: { id: user.id },
          data: this.buildFirebaseIdentityUpdate({
            currentUser: user,
            uid,
            signInProvider,
            emailVerified,
            displayName,
            avatar,
          }),
        });
        this.logger.log(`Firebase 账号绑定到已有邮箱用户: ${user.id}`);
      }
    }

    if (!user) {
      user = await this.prisma.appUsers.create({
        data: {
          authType: this.resolveFirebaseAuthType(signInProvider),
          email,
          nickname:
            displayName || `User${crypto.randomBytes(3).toString('hex')}`,
          avatar,
          emailVerified: !!emailVerified,
          googleId: this.isGoogleProvider(signInProvider) ? uid : undefined,
          appleId: this.isAppleProvider(signInProvider) ? uid : undefined,
          status: AppUserStatus.ACTIVE,
          lastLoginAt: new Date(),
          metadata: {
            firebase: {
              uid,
              provider: signInProvider,
            },
          },
        },
      });
      isNewUser = true;
      this.logger.log(
        `Firebase 用户创建成功: ${user.id}, provider: ${signInProvider}`,
      );
    } else {
      user = await this.prisma.appUsers.update({
        where: { id: user.id },
        data: {
          ...this.buildFirebaseIdentityUpdate({
            currentUser: user,
            uid,
            signInProvider,
            emailVerified,
            displayName,
            avatar,
          }),
          lastLoginAt: new Date(),
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

  // ==================== 手机号登录 ====================

  async sendPhoneCode(phone: string): Promise<{ message: string }> {
    return this.smsService.sendCode(phone);
  }

  async phoneLogin(phone: string, code: string): Promise<AppLoginResponseDto> {
    // V6.4: verifyCode 已改为异步（Redis 存储）
    const valid = await this.smsService.verifyCode(phone, code);
    if (!valid) {
      throw new UnauthorizedException(this.i18n.t('auth.codeInvalidOrExpired'));
    }

    let user = await this.prisma.appUsers.findFirst({
      where: { phone },
    });

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.appUsers.create({
        data: {
          authType: AppUserAuthType.PHONE,
          phone,
          phoneVerified: true,
          nickname: `User${phone.slice(-4)}`,
          status: AppUserStatus.ACTIVE,
          lastLoginAt: new Date(),
        },
      });
      isNewUser = true;
      this.logger.log(`手机号用户创建成功: ${user.id}, phone: ${phone}`);
    } else {
      user = await this.prisma.appUsers.update({
        where: { id: user.id },
        data: {
          phoneVerified: user.phoneVerified ? undefined : true,
          lastLoginAt: new Date(),
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
    let user = await this.prisma.appUsers.findFirst({
      where: { wechatOpenId: wechatUser.openid },
    });

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.appUsers.create({
        data: {
          authType: AppUserAuthType.WECHAT,
          wechatOpenId: wechatUser.openid,
          wechatUnionId: wechatUser.unionid || undefined,
          nickname: wechatUser.nickname || `WeChatUser`,
          avatar: wechatUser.headimgurl || undefined,
          status: AppUserStatus.ACTIVE,
          lastLoginAt: new Date(),
        },
      });
      isNewUser = true;
      this.logger.log(
        `微信用户创建成功: ${user.id}, openid: ${wechatUser.openid}`,
      );
    } else {
      // 更新用户信息（微信头像/昵称可能变更）
      const updateData: Record<string, any> = { lastLoginAt: new Date() };
      if (wechatUser.nickname && wechatUser.nickname !== user.nickname) {
        updateData.nickname = wechatUser.nickname;
      }
      if (wechatUser.headimgurl && wechatUser.headimgurl !== user.avatar) {
        updateData.avatar = wechatUser.headimgurl;
      }
      if (wechatUser.unionid && !user.wechatUnionId) {
        updateData.wechatUnionId = wechatUser.unionid;
      }
      user = await this.prisma.appUsers.update({
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
    let user = await this.prisma.appUsers.findFirst({
      where: { wechatMiniOpenId: session.openid },
    });

    // 2. 如果有 unionid，尝试通过 unionid 查找已有用户（跨端关联）
    if (!user && session.unionid) {
      user = await this.prisma.appUsers.findFirst({
        where: { wechatUnionId: session.unionid },
      });
      if (user) {
        // 关联小程序 openid 到已有用户
        user = await this.prisma.appUsers.update({
          where: { id: user.id },
          data: { wechatMiniOpenId: session.openid },
        });
      }
    }

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.appUsers.create({
        data: {
          authType: AppUserAuthType.WECHAT_MINI,
          wechatMiniOpenId: session.openid,
          wechatUnionId: session.unionid || undefined,
          nickname: `WeChatUser`,
          status: AppUserStatus.ACTIVE,
          lastLoginAt: new Date(),
        },
      });
      isNewUser = true;
      this.logger.log(
        `小程序用户创建成功: ${user.id}, openid: ${session.openid}`,
      );
    } else {
      const updateData: Record<string, any> = { lastLoginAt: new Date() };
      if (session.unionid && !user.wechatUnionId) {
        updateData.wechatUnionId = session.unionid;
      }
      user = await this.prisma.appUsers.update({
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

    let user = await this.prisma.appUsers.findFirst({
      where: { googleId: googleUserInfo.sub },
    });

    let isNewUser = false;

    if (!user) {
      if (googleUserInfo.email) {
        const existingEmailUser = await this.prisma.appUsers.findFirst({
          where: { email: googleUserInfo.email },
        });
        if (existingEmailUser) {
          const updateData: Record<string, any> = {
            googleId: googleUserInfo.sub,
            emailVerified: true,
          };
          if (!existingEmailUser.avatar && googleUserInfo.picture) {
            updateData.avatar = googleUserInfo.picture;
          }
          if (!existingEmailUser.nickname && googleUserInfo.name) {
            updateData.nickname = googleUserInfo.name;
          }
          user = await this.prisma.appUsers.update({
            where: { id: existingEmailUser.id },
            data: updateData,
          });
          this.logger.log(`Google 账号绑定到已有邮箱用户: ${user.id}`);
        }
      }

      if (!user) {
        user = await this.prisma.appUsers.create({
          data: {
            authType: AppUserAuthType.GOOGLE,
            googleId: googleUserInfo.sub,
            email: googleUserInfo.email,
            nickname: googleUserInfo.name || `GoogleUser`,
            avatar: googleUserInfo.picture,
            emailVerified: !!googleUserInfo.emailVerified,
            status: AppUserStatus.ACTIVE,
          },
        });
        isNewUser = true;
        this.logger.log(`Google 用户创建成功: ${user.id}`);
      }
    }

    await this.prisma.appUsers.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
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
    const existing = await this.prisma.appUsers.findFirst({
      where: { email },
    });

    if (existing) {
      throw new ConflictException(this.i18n.t('auth.emailRegistered'));
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const savedUser = await this.prisma.appUsers.create({
      data: {
        authType: AppUserAuthType.EMAIL,
        email,
        password: hashedPassword,
        nickname: nickname || `User${crypto.randomBytes(3).toString('hex')}`,
        emailVerified: false,
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
    const user = await this.prisma.appUsers.findFirst({
      where: { email },
    });

    if (!user) {
      throw new UnauthorizedException(
        this.i18n.t('auth.emailOrPasswordInvalid'),
      );
    }

    if (!user.password) {
      throw new UnauthorizedException(this.i18n.t('auth.emailHasNoPassword'));
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      throw new UnauthorizedException(
        this.i18n.t('auth.emailOrPasswordInvalid'),
      );
    }

    if (user.status !== AppUserStatus.ACTIVE) {
      throw new UnauthorizedException(this.i18n.t('auth.accountDisabled'));
    }

    await this.prisma.appUsers.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
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
    if (!(await this.verifyEmailCode(email, code))) {
      throw new UnauthorizedException(this.i18n.t('auth.codeInvalidOrExpired'));
    }

    let user = await this.prisma.appUsers.findFirst({
      where: { email },
    });

    let isNewUser = false;

    if (!user) {
      user = await this.prisma.appUsers.create({
        data: {
          authType: AppUserAuthType.EMAIL,
          email,
          nickname: `User${crypto.randomBytes(3).toString('hex')}`,
          emailVerified: true,
          status: AppUserStatus.ACTIVE,
        },
      });
      isNewUser = true;
    } else {
      if (!user.emailVerified) {
        await this.prisma.appUsers.update({
          where: { id: user.id },
          data: { emailVerified: true },
        });
      }
    }

    await this.prisma.appUsers.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
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

    // 存储到 Redis，TTL 5 分钟；key 不走 buildKey() 以免 CACHE_VERSION 升级导致失效
    const key = `email_code:${email}`;
    void this.redisCache.set(key, code, AppAuthService.EMAIL_CODE_TTL_S);

    this.logger.log(`[邮箱验证码] email: ${email}, type: ${type}`);

    return { message: this.i18n.t('auth.smsSent') };
  }

  // ==================== 密码重置 ====================

  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ message: string }> {
    if (!(await this.verifyEmailCode(email, code))) {
      throw new BadRequestException(this.i18n.t('auth.codeInvalidOrExpired'));
    }

    const user = await this.prisma.appUsers.findFirst({
      where: { email },
    });

    if (!user) {
      throw new BadRequestException(this.i18n.t('auth.userNotFound'));
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.prisma.appUsers.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    return { message: this.i18n.t('auth.passwordResetSuccess') };
  }

  // ==================== 用户信息管理 ====================

  async getUserInfo(userId: string): Promise<AppUserResponseDto> {
    const user = await this.prisma.appUsers.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException(this.i18n.t('auth.userNotFound'));
    }

    return this.toUserResponse(user as any);
  }

  async updateProfile(
    userId: string,
    data: { nickname?: string; avatar?: string },
  ): Promise<AppUserResponseDto> {
    const user = await this.prisma.appUsers.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException(this.i18n.t('auth.userNotFound'));
    }

    const updateData: Record<string, any> = {};
    if (data.nickname !== undefined) updateData.nickname = data.nickname;
    if (data.avatar !== undefined) updateData.avatar = data.avatar;

    const updated = await this.prisma.appUsers.update({
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
    const user = await this.prisma.appUsers.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException(this.i18n.t('auth.userNotFound'));
    }

    if (user.authType !== AppUserAuthType.ANONYMOUS) {
      throw new BadRequestException(
        this.i18n.t('auth.onlyAnonymousCanUpgrade'),
      );
    }

    const existing = await this.prisma.appUsers.findFirst({
      where: { email },
    });
    if (existing) {
      throw new ConflictException(this.i18n.t('auth.emailRegistered'));
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const updated = await this.prisma.appUsers.update({
      where: { id: userId },
      data: {
        authType: AppUserAuthType.EMAIL,
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

  async refreshToken(userId: string): Promise<AppLoginResponseDto> {
    const user = await this.prisma.appUsers.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new UnauthorizedException(this.i18n.t('auth.userNotFound'));
    }

    if (user.status !== AppUserStatus.ACTIVE) {
      throw new UnauthorizedException(this.i18n.t('auth.accountDisabled'));
    }

    await this.prisma.appUsers.update({
      where: { id: userId },
      data: { lastLoginAt: new Date() },
    });

    const token = this.generateToken(user as any);
    return {
      token,
      user: this.toUserResponse(user as any),
      isNewUser: false,
    };
  }

  async findById(id: string): Promise<AppUser | null> {
    const user = await this.prisma.appUsers.findUnique({ where: { id } });
    return user;
  }

  // ==================== 私有方法 ====================

  private generateToken(user: any): string {
    const payload = {
      sub: user.id,
      authType: user.authType ?? user.authType,
      type: 'app',
    };

    return this.jwtService.sign(payload);
  }

  private async findUserByFirebaseIdentity(params: {
    uid: string;
    signInProvider?: string;
    email?: string;
  }) {
    const { uid, signInProvider, email } = params;

    if (this.isGoogleProvider(signInProvider)) {
      const user = await this.prisma.appUsers.findFirst({
        where: { googleId: uid },
      });
      if (user) return user;
    }

    if (this.isAppleProvider(signInProvider)) {
      const user = await this.prisma.appUsers.findFirst({
        where: { appleId: uid },
      });
      if (user) return user;
    }

    return this.findUserByEmail(email);
  }

  private async findUserByEmail(email?: string) {
    if (!email) return null;
    return this.prisma.appUsers.findFirst({ where: { email } });
  }

  private buildFirebaseIdentityUpdate(params: {
    currentUser: any;
    uid: string;
    signInProvider?: string;
    emailVerified?: boolean;
    displayName?: string;
    avatar?: string;
  }) {
    const {
      currentUser,
      uid,
      signInProvider,
      emailVerified,
      displayName,
      avatar,
    } = params;

    return {
      authType: this.resolveFirebaseAuthType(signInProvider),
      googleId:
        this.isGoogleProvider(signInProvider) && currentUser.googleId !== uid
          ? uid
          : undefined,
      appleId:
        this.isAppleProvider(signInProvider) && currentUser.appleId !== uid
          ? uid
          : undefined,
      emailVerified: emailVerified ?? currentUser.emailVerified,
      nickname: currentUser.nickname || displayName || undefined,
      avatar: currentUser.avatar || avatar || undefined,
      metadata: {
        ...(currentUser.metadata && typeof currentUser.metadata === 'object'
          ? currentUser.metadata
          : {}),
        firebase: {
          uid,
          provider: signInProvider,
        },
      },
    };
  }

  private resolveFirebaseAuthType(signInProvider?: string): AppUserAuthType {
    if (this.isAppleProvider(signInProvider)) return AppUserAuthType.APPLE;
    if (this.isEmailProvider(signInProvider)) return AppUserAuthType.EMAIL;
    return AppUserAuthType.GOOGLE;
  }

  private isGoogleProvider(signInProvider?: string): boolean {
    return signInProvider == 'google.com';
  }

  private isAppleProvider(signInProvider?: string): boolean {
    return signInProvider == 'apple.com';
  }

  private isEmailProvider(signInProvider?: string): boolean {
    return signInProvider == 'password' || signInProvider == 'emailLink';
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
    emailVerified?: boolean;
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
        throw new UnauthorizedException(
          this.i18n.t('auth.googleVerificationFailed'),
        );
      }

      const payload = await response.json();

      if (!payload.sub) {
        throw new UnauthorizedException(this.i18n.t('auth.googleTokenInvalid'));
      }

      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.emailVerified,
        name: payload.name,
        picture: payload.picture,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error('Google Token 验证异常', error);
      throw new UnauthorizedException(this.i18n.t('auth.googleAuthFailed'));
    }
  }

  /**
   * 验证 Google ID Token（本地签名校验，使用 google-auth-library）
   *
   * 改进点（对比旧 tokeninfo HTTP 实现）：
   * - 本地验证：google-auth-library 自动获取 Google 公钥（JWK，24h 缓存），
   *   签名校验在进程内完成，无 tokeninfo RTT，延迟 < 1ms（命中缓存后）
   * - 安全：验证签名 + iss + aud + exp，防止重放和伪造
   * - 离线可用：公钥 24h 缓存，短暂网络抖动不影响已缓存的验证
   */
  private async verifyGoogleIdToken(idToken: string): Promise<{
    sub: string;
    email?: string;
    emailVerified?: boolean;
    name?: string;
    picture?: string;
  } | null> {
    try {
      const ticket = await this.googleOAuthClient.verifyIdToken({
        idToken,
        // 若 GOOGLE_CLIENT_ID 未配置，audience 校验将被跳过
        audience: process.env.GOOGLE_CLIENT_ID || undefined,
      });

      const payload = ticket.getPayload();
      if (!payload?.sub) return null;

      return {
        sub: payload.sub,
        email: payload.email,
        emailVerified: payload.email_verified,
        name: payload.name,
        picture: payload.picture,
      };
    } catch (err) {
      // verifyIdToken 对无效 token 抛异常（过期 / 签名错误 / aud 不匹配）
      this.logger.debug(
        `Google ID token 验证失败（将尝试 access_token fallback）: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async verifyEmailCode(email: string, code: string): Promise<boolean> {
    const key = `email_code:${email}`;
    const stored = await this.redisCache.get<string>(key);

    if (!stored) return false;
    if (stored !== code) return false;

    // 验证成功后立即删除（一次性使用）
    await this.redisCache.del(key);
    return true;
  }

  private toUserResponse(user: any): AppUserResponseDto {
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
