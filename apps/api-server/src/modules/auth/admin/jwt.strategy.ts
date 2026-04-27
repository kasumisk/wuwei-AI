import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AdminService } from './admin-auth.service';
import { I18nService } from '../../../core/i18n';

export interface JwtPayload {
  sub: string;
  username: string;
  role: string;
  type: string;
  iat?: number;
  exp?: number;
}

/**
 * V6.4 P0: 获取 JWT 密钥（统一逻辑，生产环境禁止使用默认值）
 */
function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;

  const isProduction = process.env.NODE_ENV === 'production';
  if (isProduction) {
    throw new Error('JWT_SECRET 未配置，生产环境禁止启动');
  }

  Logger.warn(
    'JWT_SECRET 未设置，使用开发默认值。切勿在生产环境使用！',
    'JwtStrategy',
  );
  return 'dev-only-secret-do-not-use-in-production';
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly adminService: AdminService,
    private readonly i18n: I18nService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: JwtPayload) {
    // 仅验证管理员 token
    if (payload.type && payload.type !== 'admin') {
      throw new UnauthorizedException(this.i18n.t('auth.notAdminToken'));
    }

    const user = await this.adminService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException(this.i18n.t('auth.userNotFound'));
    }

    if (user.status !== 'active') {
      throw new UnauthorizedException(this.i18n.t('auth.userDisabled'));
    }

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      type: 'admin',
    };
  }
}
