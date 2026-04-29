import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AdminRole, AdminUserStatus } from '../../user/user.types';
import { AdminUsers as AdminUser } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { I18nService } from '../../../core/i18n';
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
  // 模拟验证码存储 (生产环境应使用 Redis)
  private verificationCodes: Map<string, { code: string; expireAt: number }> =
    new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly i18n: I18nService,
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

    // 移除密码字段
    const { password: _loginPwd, ...userWithoutPassword } = user;

    return { token, user: userWithoutPassword as any };
  }

  /**
   * 手机验证码登录
   */
  async loginByPhone(
    loginByPhoneDto: LoginByPhoneDto,
  ): Promise<LoginResponseDto> {
    const { phone, code } = loginByPhoneDto;

    // 验证验证码
    if (!this.verifyCode(phone, code)) {
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

    return { token, user: user as any };
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

      return { token: newToken, user: user as any };
    } catch {
      throw new UnauthorizedException(
        this.i18n.t('auth.tokenInvalidOrExpired'),
      );
    }
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

    // 移除密码字段
    const { password: _pwd, ...userWithoutPassword } = user;

    return { token, user: userWithoutPassword as any };
  }

  /**
   * 发送验证码
   */
  sendCode(phone: string, type: string): SendCodeResponseDto {
    // 生成 6 位验证码
    const code = Math.floor(100000 + Math.random() * 900000).toString();

    // 存储验证码 (5分钟过期)
    this.verificationCodes.set(phone, {
      code,
      expireAt: Date.now() + 5 * 60 * 1000,
    });

    // TODO: 实际环境中应该调用短信服务
    console.log(`[验证码] 手机号: ${phone}, 验证码: ${code}, 类型: ${type}`);

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

    return user as any;
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
    return updatedUser as any;
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

  /**
   * 验证验证码
   */
  private verifyCode(phone: string, code: string): boolean {
    const storedCode = this.verificationCodes.get(phone);

    if (!storedCode) {
      return false;
    }

    if (Date.now() > storedCode.expireAt) {
      this.verificationCodes.delete(phone);
      return false;
    }

    if (storedCode.code !== code) {
      return false;
    }

    // 验证成功后删除验证码
    this.verificationCodes.delete(phone);
    return true;
  }
}
