import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { RbacHttpMethod } from '@ai-platform/shared';
import { permissions_action_enum } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import type {
  CreateRbacPermissionDto,
  UpdateRbacPermissionDto,
  RbacPermissionQueryDto,
  RbacPermissionInfoDto,
  MenuItemDto,
} from '@ai-platform/shared';

enum PermissionType {
  MENU = 'menu',
  OPERATION = 'operation',
}

enum PermissionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Injectable()
export class RbacPermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async findAll(query: RbacPermissionQueryDto) {
    const { page = 1, pageSize = 10, code, name, type, status } = query;

    const where: any = {};
    if (code) where.code = { contains: code };
    if (name) where.name = { contains: name };
    if (type) where.type = type;
    if (status) where.status = status;

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.permissions.findMany({
        where,
        orderBy: [{ sort: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.permissions.count({ where }),
    ]);

    return {
      list: list.map((p) => this.formatPermissionInfo(p)),
      total,
      page,
      pageSize,
    };
  }

  async getTree() {
    const permissions = await this.prisma.permissions.findMany({
      where: { parentId: null, status: PermissionStatus.ACTIVE },
      include: { otherPermissions: true },
      orderBy: { sort: 'asc' },
    });
    return this.buildTree(permissions);
  }

  async findOne(id: string) {
    const permission = await this.prisma.permissions.findUnique({
      where: { id },
      include: { permissions: true },
    });

    if (!permission) {
      throw new NotFoundException(
        this.i18n.t('rbac.permission.notFound', { id }),
      );
    }

    return this.formatPermissionInfo(permission);
  }

  async create(createDto: CreateRbacPermissionDto) {
    const existing = await this.prisma.permissions.findFirst({
      where: { code: createDto.code },
    });

    if (existing) {
      throw new ConflictException(
        this.i18n.t('rbac.permission.codeExists', { code: createDto.code }),
      );
    }

    if (createDto.parentId) {
      const parent = await this.prisma.permissions.findUnique({
        where: { id: createDto.parentId },
      });
      if (!parent) {
        throw new NotFoundException(
          this.i18n.t('rbac.permission.parentNotFound', {
            id: createDto.parentId,
          }),
        );
      }
    }

    const savedPermission = await this.prisma.permissions.create({
      data: {
        code: createDto.code,
        name: createDto.name,
        type: createDto.type as PermissionType,
        action: createDto.action as unknown as permissions_action_enum,
        resource: createDto.resource,
        parentId: createDto.parentId || null,
        icon: createDto.icon,
        description: createDto.description,
        sort: createDto.sort || 0,
        status: PermissionStatus.ACTIVE,
        isSystem: false,
      },
    });

    return this.formatPermissionInfo(savedPermission);
  }

  async update(id: string, updateDto: UpdateRbacPermissionDto) {
    const permission = await this.prisma.permissions.findUnique({
      where: { id },
    });

    if (!permission) {
      throw new NotFoundException(
        this.i18n.t('rbac.permission.notFound', { id }),
      );
    }

    if (permission.isSystem && updateDto.type !== undefined) {
      throw new BadRequestException(
        this.i18n.t('rbac.permission.systemPermNoTypeChange'),
      );
    }

    if (updateDto.parentId !== undefined && updateDto.parentId !== null) {
      const isCircular = await this.checkCircularParent(id, updateDto.parentId);
      if (isCircular) {
        throw new BadRequestException(
          this.i18n.t('rbac.permission.circularParent'),
        );
      }
    }

    const data: any = { ...updateDto };
    const updatedPermission = await this.prisma.permissions.update({
      where: { id },
      data,
    });

    return this.formatPermissionInfo(updatedPermission);
  }

  async remove(id: string) {
    const permission = await this.prisma.permissions.findUnique({
      where: { id },
      include: { otherPermissions: true },
    });

    if (!permission) {
      throw new NotFoundException(
        this.i18n.t('rbac.permission.notFound', { id }),
      );
    }

    if (permission.isSystem) {
      throw new BadRequestException(
        this.i18n.t('rbac.permission.systemPermNoDelete'),
      );
    }

    if (permission.otherPermissions && permission.otherPermissions.length > 0) {
      throw new BadRequestException(
        this.i18n.t('rbac.permission.deleteChildFirst'),
      );
    }

    await this.prisma.rolePermissions.deleteMany({
      where: { permissionId: id },
    });
    await this.prisma.permissions.delete({ where: { id } });

    return { message: this.i18n.t('rbac.permission.deleteSuccess') };
  }

  async getUserPermissions(userId: string) {
    const userRoles = await this.prisma.userRoles.findMany({
      where: { userId },
      include: { roles: true },
    });

    const roles = userRoles.map((ur) => ur.roles).filter((r) => r !== null);
    const isSuperAdmin = roles.some((r) => r.code === 'SUPER_ADMIN');

    const allRoleIds = new Set<string>();
    for (const role of roles) {
      const ancestors = await this.getRoleAncestors(role.id);
      ancestors.forEach((r) => allRoleIds.add(r.id));
    }

    let permissionCodes: string[] = [];
    let menus: MenuItemDto[] = [];

    if (isSuperAdmin) {
      const allPermissions = await this.prisma.permissions.findMany({
        where: { status: PermissionStatus.ACTIVE },
      });
      permissionCodes = allPermissions.map((p) => p.code);
      menus = await this.buildMenuTree();
    } else if (allRoleIds.size > 0) {
      const rolePermissions = await this.prisma.rolePermissions.findMany({
        where: { roleId: { in: [...allRoleIds] } },
        include: { permissions: true },
      });

      const permissions = rolePermissions
        .map((rp) => rp.permissions)
        .filter((p) => p && p.status === PermissionStatus.ACTIVE);

      permissionCodes = [...new Set(permissions.map((p) => p.code))];
      menus = await this.buildMenuTreeFromPermissions(permissions);
    }

    return {
      user: { id: userId, username: '', nickname: '' },
      roles: roles.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        parentCode: (r as any).parent?.code || null,
      })),
      permissions: permissionCodes,
      menus,
      isSuperAdmin,
    };
  }

  async hasPermission(
    userId: string,
    requiredPermission: string,
  ): Promise<boolean> {
    const { permissions, isSuperAdmin } = await this.getUserPermissions(userId);
    if (isSuperAdmin) return true;
    return permissions.some((p) => this.matchPermission(requiredPermission, p));
  }

  async isSuperAdmin(userId: string): Promise<boolean> {
    const userRoles = await this.prisma.userRoles.findMany({
      where: { userId },
      include: { roles: true },
    });
    return userRoles.some((ur) => ur.roles?.code === 'SUPER_ADMIN');
  }

  async getAllModules(): Promise<string[]> {
    const menuPermissions = await this.prisma.permissions.findMany({
      where: { type: PermissionType.MENU, status: PermissionStatus.ACTIVE },
    });
    return menuPermissions.map((p) => p.code);
  }

  private matchPermission(required: string, userPermission: string): boolean {
    if (userPermission === '*') return true;
    if (userPermission === required) return true;
    if (userPermission.endsWith(':*')) {
      const prefix = userPermission.slice(0, -1);
      return required.startsWith(prefix);
    }
    return false;
  }

  private async getRoleAncestors(roleId: string): Promise<any[]> {
    const roles: any[] = [];
    let currentRole = await this.prisma.roles.findUnique({
      where: { id: roleId },
      include: { roles: true },
    });

    while (currentRole) {
      roles.push(currentRole);
      currentRole = (currentRole as any).roles || null;
    }

    return roles;
  }

  private async checkCircularParent(
    id: string,
    parentId: string,
  ): Promise<boolean> {
    if (id === parentId) return true;

    let currentId: string | null = parentId;
    while (currentId) {
      const permission = await this.prisma.permissions.findUnique({
        where: { id: currentId },
      });
      if (!permission || !permission.parentId) break;
      if (permission.parentId === id) return true;
      currentId = permission.parentId;
    }

    return false;
  }

  private async buildMenuTree(): Promise<MenuItemDto[]> {
    const menuPermissions = await this.prisma.permissions.findMany({
      where: {
        type: PermissionType.MENU,
        status: PermissionStatus.ACTIVE,
        parentId: null,
      },
      include: { otherPermissions: true },
      orderBy: { sort: 'asc' },
    });
    return this.buildMenuItems(menuPermissions);
  }

  private async buildMenuTreeFromPermissions(
    permissions: any[],
  ): Promise<MenuItemDto[]> {
    const menuPermissions = permissions.filter(
      (p) => p.type === PermissionType.MENU,
    );
    const menuCodes = new Set(menuPermissions.map((p) => p.code));

    const topLevelMenus = await this.prisma.permissions.findMany({
      where: {
        type: PermissionType.MENU,
        status: PermissionStatus.ACTIVE,
        parentId: null,
        code: { in: [...menuCodes] },
      },
      include: { otherPermissions: true },
      orderBy: { sort: 'asc' },
    });

    return this.buildMenuItems(topLevelMenus, menuCodes);
  }

  private buildMenuItems(
    permissions: any[],
    allowedCodes?: Set<string>,
  ): MenuItemDto[] {
    return permissions
      .filter((p) => !allowedCodes || allowedCodes.has(p.code))
      .map((p) => ({
        path: `/${p.code.replace(/:/g, '/')}`,
        name: p.name,
        icon: p.icon || undefined,
        permissionCode: p.code,
        children: p.otherPermissions
          ? this.buildMenuItems(
              p.otherPermissions.filter(
                (c: any) => c.type === PermissionType.MENU,
              ),
              allowedCodes,
            )
          : [],
      }));
  }

  private buildTree(permissions: any[]): RbacPermissionInfoDto[] {
    return permissions.map((p) => ({
      ...this.formatPermissionInfo(p),
      children: p.otherPermissions ? this.buildTree(p.otherPermissions) : [],
    }));
  }

  private formatPermissionInfo(permission: any): RbacPermissionInfoDto {
    return {
      id: permission.id,
      code: permission.code,
      name: permission.name,
      type: permission.type,
      action: permission.action as unknown as RbacHttpMethod | null,
      resource: permission.resource,
      parentId: permission.parentId,
      icon: permission.icon,
      description: permission.description,
      status: permission.status,
      isSystem: permission.isSystem,
      sort: permission.sort,
      createdAt: permission.createdAt,
      updatedAt: permission.updatedAt,
    };
  }
}
