import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from '../../entities/app-user.entity';

export interface AppJwtPayload {
  sub: string;
  authType: string;
  type: string;
  iat?: number;
  exp?: number;
}

@Injectable()
export class AppJwtStrategy extends PassportStrategy(Strategy, 'app-jwt') {
  constructor(
    @InjectRepository(AppUser)
    private readonly appUserRepository: Repository<AppUser>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey:
        process.env.JWT_SECRET || 'your-secret-key-change-in-production',
    });
  }

  async validate(payload: AppJwtPayload) {
    // 仅验证 App 用户 token
    if (payload.type !== 'app') {
      throw new UnauthorizedException('非 App 用户令牌');
    }

    const user = await this.appUserRepository.findOne({
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
