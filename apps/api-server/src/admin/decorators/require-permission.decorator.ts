import { SetMetadata, applyDecorators, UseGuards } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { RbacPermissionGuard } from '../guards/rbac-permission.guard';

export const PERMISSIONS_KEY = 'permissions';

/**
 * 权限装饰器 - 仅设置元数据，需配合 RbacPermissionGuard 使用
 * @param permissions 所需权限列表（满足任一即可）
 * @example
 * @RequirePermission('user:create')
 * @RequirePermission('user:create', 'user:update')
 */
export const RequirePermission = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * 权限装饰器（包含守卫）- 自动应用权限守卫
 * @param permissions 所需权限列表（满足任一即可）
 * @example
 * @RequirePermissions('user:create')
 * @RequirePermissions('user:create', 'user:update')
 */
export const RequirePermissions = (...permissions: string[]) =>
  applyDecorators(
    SetMetadata(PERMISSIONS_KEY, permissions),
    UseGuards(RbacPermissionGuard),
    ApiForbiddenResponse({ description: '没有访问权限' }),
  );
