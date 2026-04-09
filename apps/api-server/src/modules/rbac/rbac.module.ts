import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
// 实体
import { Role } from './entities/role.entity';
import { Permission } from './entities/permission.entity';
import { PermissionTemplate } from './entities/permission-template.entity';
import { UserRole } from './entities/user-role.entity';
import { RolePermission } from './entities/role-permission.entity';
// 控制器
import { RoleController } from './admin/role.controller';
import { RbacPermissionController } from './admin/rbac-permission.controller';
import { PermissionTemplateController } from './admin/permission-template.controller';
// 服务
import { RoleService } from './admin/role.service';
import { RbacPermissionService } from './admin/rbac-permission.service';
import { PermissionTemplateService } from './admin/permission-template.service';
// 守卫
import { RolesGuard } from './admin/roles.guard';
import { RbacPermissionGuard } from './admin/rbac-permission.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Role,
      Permission,
      PermissionTemplate,
      UserRole,
      RolePermission,
    ]),
  ],
  controllers: [
    RoleController,
    RbacPermissionController,
    PermissionTemplateController,
  ],
  providers: [
    RoleService,
    RbacPermissionService,
    PermissionTemplateService,
    RolesGuard,
    RbacPermissionGuard,
  ],
  exports: [
    RoleService,
    RbacPermissionService,
    PermissionTemplateService,
    RolesGuard,
    RbacPermissionGuard,
  ],
})
export class RbacModule {}
