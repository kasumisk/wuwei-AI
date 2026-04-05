import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
// 实体
import { AppUser } from '../entities/app-user.entity';
import { AppVersion } from '../entities/app-version.entity';
import { AppVersionPackage } from '../entities/app-version-package.entity';
// 服务
import { AppAuthService } from './services/app-auth.service';
import { AppUpdateService } from './services/app-update.service';
import { FirebaseAdminService } from './services/firebase-admin.service';
// 控制器
import { AppAuthController } from './app.controller';
import { AppFileController } from './controllers/file.controller';
import { AppUpdateController } from './controllers/update.controller';
// 守卫和策略
import { AppJwtStrategy } from './strategies/app-jwt.strategy';
import { AppJwtAuthGuard } from './guards/app-jwt-auth.guard';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([AppUser, AppVersion, AppVersionPackage]),
    PassportModule.register({ defaultStrategy: 'app-jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      signOptions: {
        expiresIn: '30d', // App 用户 token 有效期更长
      },
    }),
  ],
  providers: [
    // 服务
    AppAuthService,
    AppUpdateService,
    FirebaseAdminService,
    // 守卫和策略
    AppJwtStrategy,
    AppJwtAuthGuard,
  ],
  controllers: [
    AppAuthController,
    AppFileController,
    AppUpdateController,
  ],
  exports: [
    AppAuthService,
    AppUpdateService,
    AppJwtAuthGuard,
  ],
})
export class AppClientModule {}
