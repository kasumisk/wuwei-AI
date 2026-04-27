import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
// App 端
import { AppAuthController } from './app/app-auth.controller';
import { AppAuthService } from './app/app-auth.service';
import { SmsService } from './app/sms.service';
import { WechatAuthService } from './app/wechat-auth.service';
import { AppJwtStrategy } from './app/app-jwt.strategy';
import { AppJwtAuthGuard } from './app/app-jwt-auth.guard';
import { FirebaseAdminService } from './app/firebase-admin.service';
// Admin 端
import { AdminController } from './admin/admin-auth.controller';
import { AdminService } from './admin/admin-auth.service';
import { JwtStrategy } from './admin/jwt.strategy';
import { JwtAuthGuard } from './admin/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const secret = configService.get<string>('JWT_SECRET');
        const isProduction =
          configService.get<string>('NODE_ENV') === 'production';

        if (!secret && isProduction) {
          throw new Error('JWT_SECRET 未配置，生产环境禁止启动');
        }

        return {
          secret: secret || 'dev-only-secret-do-not-use-in-production',
          signOptions: { expiresIn: '7d' },
        };
      },
    }),
  ],
  controllers: [AppAuthController, AdminController],
  providers: [
    // App 端
    AppAuthService,
    SmsService,
    WechatAuthService,
    FirebaseAdminService,
    AppJwtStrategy,
    AppJwtAuthGuard,
    // Admin 端
    AdminService,
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [
    AppAuthService,
    AdminService,
    AppJwtAuthGuard,
    JwtAuthGuard,
    JwtModule,
  ],
})
export class AuthModule {}
