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
      useFactory: (configService: ConfigService) => ({
        secret:
          configService.get<string>('JWT_SECRET') ||
          'your-secret-key-change-in-production',
        signOptions: { expiresIn: '7d' },
      }),
    }),
  ],
  controllers: [AppAuthController, AdminController],
  providers: [
    // App 端
    AppAuthService,
    SmsService,
    WechatAuthService,
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
