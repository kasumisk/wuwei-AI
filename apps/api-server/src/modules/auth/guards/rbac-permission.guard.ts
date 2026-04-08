import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { UserRole } from '../entities/user-role.entity';
import { RolePermission } from '../entities/role-permission.entity';
import { Permission } from '../entities/permission.entity';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class RbacPermissionGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectRepository(UserRole)
    private userRoleRepo: Repository<UserRole>,
    @InjectRepository(RolePermission)
    private rolePermRepo: Repository<RolePermission>,
    @InjectRepository(Permission)
    private permissionRepo: Repository<Permission>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();
    if (!user || user.type !== 'admin') return false;

    // Get user's roles
    const userRoles = await this.userRoleRepo.find({
      where: { userId: user.id },
    });
    if (userRoles.length === 0) return false;

    const roleIds = userRoles.map((ur) => ur.roleId);

    // Get role permissions
    const rolePerms = await this.rolePermRepo.find({
      where: { roleId: In(roleIds) },
    });
    if (rolePerms.length === 0) return false;

    const permissionIds = rolePerms.map((rp) => rp.permissionId);

    // Get permission codes
    const permissions = await this.permissionRepo.find({
      where: { id: In(permissionIds) },
    });
    const userPermCodes = permissions.map((p) => p.code);

    // Check all required permissions are present
    return requiredPermissions.every((rp) => userPermCodes.includes(rp));
  }
}
