import { Module } from '@nestjs/common';
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
