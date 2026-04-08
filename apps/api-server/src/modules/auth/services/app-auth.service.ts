import { Injectable, UnauthorizedException, ConflictException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { AppUser, AuthType } from '../entities/app-user.entity';
import {
  LoginAnonymousDto,
  LoginByPhoneDto,
  LoginByWechatMiniDto,
  LoginByEmailDto,
  RegisterByEmailDto,
  AuthResponseDto,
} from '../dto/app-auth.dto';

@Injectable()
export class AppAuthService {
  private readonly logger = new Logger(AppAuthService.name);

  constructor(
    @InjectRepository(AppUser)
    private appUserRepo: Repository<AppUser>,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async loginAnonymous(dto: LoginAnonymousDto): Promise<AuthResponseDto> {
    let user = await this.appUserRepo.findOne({
      where: { deviceId: dto.deviceId },
    });

    if (!user) {
      user = this.appUserRepo.create({
        deviceId: dto.deviceId,
        authType: AuthType.ANONYMOUS,
      });
      user = await this.appUserRepo.save(user);
      this.logger.log(`Anonymous user created: ${user.id}`);
    }

    return this.generateTokens(user);
  }

  async loginByPhone(dto: LoginByPhoneDto): Promise<AuthResponseDto> {
    // In production, verify SMS code via SmsService
    // For now, we'll do phone-based login/register
    let user = await this.appUserRepo.findOne({
      where: { phone: dto.phone },
    });

    if (!user) {
      user = this.appUserRepo.create({
        phone: dto.phone,
        authType: AuthType.PHONE,
      });
      user = await this.appUserRepo.save(user);
      this.logger.log(`Phone user created: ${user.id}`);
    }

    return this.generateTokens(user);
  }

  async loginByWechatMini(dto: LoginByWechatMiniDto): Promise<AuthResponseDto> {
    // In production, exchange code for openId via WechatAuthService
    // Placeholder: code is treated as openId for development
    const openId = dto.code;

    let user = await this.appUserRepo.findOne({
      where: { wechatMiniOpenId: openId },
    });

    if (!user) {
      user = this.appUserRepo.create({
        wechatMiniOpenId: openId,
        authType: AuthType.WECHAT_MINI,
        nickname: dto.nickname,
        avatar: dto.avatar,
      });
      user = await this.appUserRepo.save(user);
      this.logger.log(`WeChat Mini user created: ${user.id}`);
    }

    return this.generateTokens(user);
  }

  async loginByEmail(dto: LoginByEmailDto): Promise<AuthResponseDto> {
    const user = await this.appUserRepo.findOne({
      where: { email: dto.email },
      select: ['id', 'email', 'password', 'authType', 'nickname', 'avatar', 'status'],
    });

    if (!user || !user.password) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    const isValid = await bcrypt.compare(dto.password, user.password);
    if (!isValid) {
      throw new UnauthorizedException('邮箱或密码错误');
    }

    return this.generateTokens(user);
  }

  async registerByEmail(dto: RegisterByEmailDto): Promise<AuthResponseDto> {
    const existing = await this.appUserRepo.findOne({
      where: { email: dto.email },
    });

    if (existing) {
      throw new ConflictException('该邮箱已注册');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);

    const user = this.appUserRepo.create({
      email: dto.email,
      password: hashedPassword,
      authType: AuthType.EMAIL,
      nickname: dto.nickname,
    });
    const saved = await this.appUserRepo.save(user);
    this.logger.log(`Email user registered: ${saved.id}`);

    return this.generateTokens(saved);
  }

  async getProfile(userId: string): Promise<AppUser> {
    const user = await this.appUserRepo.findOne({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('用户不存在');
    return user;
  }

  private generateTokens(user: AppUser): AuthResponseDto {
    const payload = { sub: user.id, type: 'app' as const };
    const accessToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.appSecret'),
      expiresIn: (this.configService.get<string>('jwt.appExpiresIn') || '7d') as any,
    });
    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get<string>('jwt.appSecret'),
      expiresIn: '30d' as any,
    });

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        authType: user.authType,
        nickname: user.nickname,
        avatar: user.avatar,
      },
    };
  }
}
