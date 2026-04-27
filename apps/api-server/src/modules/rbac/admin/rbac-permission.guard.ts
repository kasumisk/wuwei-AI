import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacPermissionService } from './rbac-permission.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import { PERMISSIONS_KEY } from './require-permission.decorator';

@Injectable()
export class RbacPermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private permissionService: RbacPermissionService,
    private i18n: I18nService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user || !user.id) {
      throw new ForbiddenException(this.i18n.t('rbac.guard.loginRequired'));
    }

    const isSuperAdmin = await this.permissionService.isSuperAdmin(user.id);
    if (isSuperAdmin) {
      return true;
    }

    const { permissions: userPermissions } =
      await this.permissionService.getUserPermissions(user.id);

    const hasPermission = requiredPermissions.some((required) =>
      this.matchPermission(required, userPermissions),
    );

    if (!hasPermission) {
      throw new ForbiddenException(this.i18n.t('rbac.guard.noAccess'));
    }

    return true;
  }

  private matchPermission(
    required: string,
    userPermissions: string[],
  ): boolean {
    return userPermissions.some((permission) => {
      if (permission === '*') return true;
      if (permission === required) return true;
      if (permission.endsWith(':*')) {
        const prefix = permission.slice(0, -1);
        return required.startsWith(prefix);
      }
      return false;
    });
  }
}
