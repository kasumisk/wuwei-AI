import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AppUser } from './entities/app-user.entity';
import { AdminUser } from './entities/admin-user.entity';
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { RolePermission } from './entities/role-permission.entity';
import { UserRole } from './entities/user-role.entity';
import { PermissionTemplate } from './entities/permission-template.entity';
import { AppJwtStrategy } from './strategies/app-jwt.strategy';
import { AdminJwtStrategy } from './strategies/admin-jwt.strategy';
import { AppAuthService } from './services/app-auth.service';
import { AdminAuthService } from './services/admin-auth.service';
import { AppAuthController } from './controllers/app-auth.controller';
import { AdminAuthController } from './controllers/admin-auth.controller';
import { RbacPermissionGuard } from './guards/rbac-permission.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AppUser,
      AdminUser,
      Role,
      Permission,
      RolePermission,
      UserRole,
      PermissionTemplate,
    ]),
    PassportModule.register({ defaultStrategy: 'app-jwt' }),
    JwtModule.register({}),
  ],
  controllers: [AppAuthController, AdminAuthController],
  providers: [
    AppJwtStrategy,
    AdminJwtStrategy,
    AppAuthService,
    AdminAuthService,
    RbacPermissionGuard,
  ],
  exports: [AppAuthService, AdminAuthService, TypeOrmModule],
})
export class AuthModule {}
