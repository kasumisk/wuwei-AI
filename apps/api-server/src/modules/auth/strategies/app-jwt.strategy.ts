import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

export interface AppJwtPayload {
  sub: string;
  type: 'app';
}

@Injectable()
export class AppJwtStrategy extends PassportStrategy(Strategy, 'app-jwt') {
  constructor(configService: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('jwt.appSecret'),
    });
  }

  validate(payload: AppJwtPayload) {
    return { id: payload.sub, type: payload.type };
  }
}
