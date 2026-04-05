import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminUser } from '../entities/admin-user.entity';
import { AppUser } from '../entities/app-user.entity';
import { Client } from '../entities/client.entity';
import { ClientCapabilityPermission } from '../entities/client-capability-permission.entity';
import { Provider } from '../entities/provider.entity';
import { ModelConfig } from '../entities/model-config.entity';
import { UsageRecord } from '../entities/usage-record.entity';
// RBAC 实体
import { Role } from '../entities/role.entity';
import { Permission } from '../entities/permission.entity';
import { PermissionTemplate } from '../entities/permission-template.entity';
import { UserRole } from '../entities/user-role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { AppVersion } from '../entities/app-version.entity';
import { AppVersionPackage } from '../entities/app-version-package.entity';
// 服务
import { AdminService } from './admin.service';
import { AdminUserService } from './services/admin-user.service';
import { ClientService } from './services/client.service';
import { PermissionService } from './services/permission.service';
import { ProviderService } from './services/provider.service';
import { ModelService } from './services/model.service';
import { AnalyticsService } from './services/analytics.service';
// RBAC 服务
import { RoleService } from './services/role.service';
import { RbacPermissionService } from './services/rbac-permission.service';
import { PermissionTemplateService } from './services/permission-template.service';
import { AppVersionService } from './services/app-version.service';
import { AppVersionPackageService } from './services/app-version-package.service';
// App 用户管理服务
import { AppUserManagementService } from './services/app-user-management.service';
// 控制器
import { AdminController } from './admin.controller';
import { AdminUserController } from './controllers/admin-user.controller';
import { ClientController } from './controllers/client.controller';
import { PermissionController } from './controllers/permission.controller';
import { ProviderController } from './controllers/provider.controller';
import { ModelController } from './controllers/model.controller';
import { AnalyticsController } from './controllers/analytics.controller';
// RBAC 控制器
import { RoleController } from './controllers/role.controller';
import { RbacPermissionController } from './controllers/rbac-permission.controller';
import { PermissionTemplateController } from './controllers/permission-template.controller';
import { AppVersionController } from './controllers/app-version.controller';
import { AppVersionPackageController } from './controllers/app-version-package.controller';
// App 用户管理控制器
import { AppUserManagementController } from './controllers/app-user-management.controller';
import { FileController } from './controllers/file.controller';
// 守卫和策略
import { JwtStrategy } from './strategies/jwt.strategy';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { RbacPermissionGuard } from './guards/rbac-permission.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AdminUser,
      AppUser,
      Client,
      ClientCapabilityPermission,
      Provider,
      ModelConfig,
      UsageRecord,
      // RBAC 实体
      Role,
      Permission,
      PermissionTemplate,
      UserRole,
      RolePermission,
      AppVersion,
      AppVersionPackage,
    ]),
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      signOptions: {
        expiresIn: '7d',
      },
    }),
  ],
  providers: [
    AdminService,
    AdminUserService,
    ClientService,
    PermissionService,
    ProviderService,
    ModelService,
    AnalyticsService,
    // RBAC 服务
    RoleService,
    RbacPermissionService,
    PermissionTemplateService,
    AppVersionService,
    AppVersionPackageService,
    // App 用户管理
    AppUserManagementService,
    // 守卫和策略
    JwtStrategy,
    JwtAuthGuard,
    RolesGuard,
    RbacPermissionGuard,
  ],
  controllers: [
    AdminController,
    AdminUserController,
    ClientController,
    PermissionController,
    ProviderController,
    ModelController,
    AnalyticsController,
    // RBAC 控制器
    RoleController,
    RbacPermissionController,
    PermissionTemplateController,
    AppVersionController,
    AppVersionPackageController,
    // App 用户管理控制器
    AppUserManagementController,
    // 文件管理控制器
    FileController,
  ],
  exports: [
    AdminService,
    ClientService,
    PermissionService,
    ProviderService,
    ModelService,
    AnalyticsService,
    // RBAC 服务
    RoleService,
    RbacPermissionService,
    PermissionTemplateService,
    AppVersionService,
    AppVersionPackageService,
    // App 用户管理
    AppUserManagementService,
    // 守卫
    JwtAuthGuard,
    RolesGuard,
    RbacPermissionGuard,
  ],
})
export class AdminModule {}
