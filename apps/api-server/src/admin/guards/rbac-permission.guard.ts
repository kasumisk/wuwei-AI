import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacPermissionService } from '../services/rbac-permission.service';
import { PERMISSIONS_KEY } from '../decorators/require-permission.decorator';

@Injectable()
export class RbacPermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionService: RbacPermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // 如果没有设置权限要求，直接通过
    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // 用户未登录
    if (!user || !user.id) {
      throw new ForbiddenException('请先登录');
    }

    // 检查是否超级管理员
    const isSuperAdmin = await this.permissionService.isSuperAdmin(user.id);
    if (isSuperAdmin) {
      return true;
    }

    // 获取用户权限
    const { permissions: userPermissions } =
      await this.permissionService.getUserPermissions(user.id);

    // 检查是否有所需的任意一个权限（OR逻辑）
    const hasPermission = requiredPermissions.some((required) =>
      this.matchPermission(required, userPermissions),
    );

    if (!hasPermission) {
      throw new ForbiddenException('没有访问权限');
    }

    return true;
  }

  /**
   * 权限匹配（支持通配符）
   */
  private matchPermission(
    required: string,
    userPermissions: string[],
  ): boolean {
    return userPermissions.some((permission) => {
      // 超级权限
      if (permission === '*') return true;
      // 完全匹配
      if (permission === required) return true;
      // 通配符匹配: user:* 匹配 user:create
      if (permission.endsWith(':*')) {
        const prefix = permission.slice(0, -1);
        return required.startsWith(prefix);
      }
      return false;
    });
  }
}
