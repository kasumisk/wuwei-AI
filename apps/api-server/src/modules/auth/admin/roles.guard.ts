import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

export const ROLES_KEY = 'roles';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user) {
      throw new ForbiddenException('未登录');
    }

    // 超级管理员拥有所有权限
    if (user.role === 'super_admin') {
      return true;
    }

    const hasRole = requiredRoles.some(
      (role) => user.role === role || user.roles?.includes(role),
    );

    if (!hasRole) {
      throw new ForbiddenException('权限不足');
    }

    return true;
  }
}
