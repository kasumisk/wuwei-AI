import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { AppUsers as AppUser } from '@prisma/client';

export interface AppJwtPayload {
  sub: string;
  authType: string;
  type: string;
  iat?: number;
  exp?: number;
}

/**
 * V6.4 P0: 获取 JWT 密钥（统一逻辑，生产环境禁止使用默认值）
 * 注意：main.ts 启动时已对生产环境做了强制校验，此处为双重保护
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    // 此分支理论上不会执行到（main.ts 已拦截），作为防御性编程
    throw new Error('JWT_SECRET 未配置，生产环境禁止启动');
  }

  Logger.warn(
    'JWT_SECRET 未设置，使用开发默认值。切勿在生产环境使用！',
    'AppJwtStrategy',
  );
  return 'dev-only-secret-do-not-use-in-production';
}

@Injectable()
export class AppJwtStrategy extends PassportStrategy(Strategy, 'app-jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: AppJwtPayload) {
    // 仅验证 App 用户 token
    if (payload.type !== 'app') {
      throw new UnauthorizedException('非 App 用户令牌');
    }

    const user = await this.prisma.appUsers.findUnique({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException('用户已被禁用');
    }

    return {
      id: user.id,
      authType: user.authType,
      email: user.email,
      nickname: user.nickname,
      type: 'app',
    };
  }
}
