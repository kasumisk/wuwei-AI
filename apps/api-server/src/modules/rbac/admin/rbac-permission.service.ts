import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { RbacHttpMethod } from '@ai-platform/shared';
import { permissions_action_enum } from '@prisma/client';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type {
  CreateRbacPermissionDto,
  UpdateRbacPermissionDto,
  RbacPermissionQueryDto,
  RbacPermissionInfoDto,
  MenuItemDto,
} from '@ai-platform/shared';

/**
 * 权限类型枚举
 */
enum PermissionType {
  MENU = 'menu',
  OPERATION = 'operation',
}

/**
 * 权限状态枚举
 */
enum PermissionStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

@Injectable()
export class RbacPermissionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取权限列表（分页）
   */
  async findAll(query: RbacPermissionQueryDto) {
    const { page = 1, pageSize = 10, code, name, type, status } = query;

    const where: any = {};

    if (code) {
      where.code = { contains: code };
    }

    if (name) {
      where.name = { contains: name };
    }

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

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

    // 转换数据格式
    const formattedList = list.map((p) => this.formatPermissionInfo(p));

    return {
      list: formattedList,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 获取权限树
   */
  async getTree() {
    const permissions = await this.prisma.permissions.findMany({
      where: { parentId: null, status: PermissionStatus.ACTIVE },
      include: { otherPermissions: true },
      orderBy: { sort: 'asc' },
    });

    return this.buildTree(permissions);
  }

  /**
   * 获取权限详情
   */
  async findOne(id: string) {
    const permission = await this.prisma.permissions.findUnique({
      where: { id },
      include: { permissions: true },
    });

    if (!permission) {
      throw new NotFoundException(`权限 #${id} 不存在`);
    }

    return this.formatPermissionInfo(permission);
  }

  /**
   * 创建权限
   */
  async create(createDto: CreateRbacPermissionDto) {
    // 检查编码唯一性
    const existing = await this.prisma.permissions.findFirst({
      where: { code: createDto.code },
    });

    if (existing) {
      throw new ConflictException(`权限编码 ${createDto.code} 已存在`);
    }

    // 如果指定了父权限，检查父权限是否存在
    if (createDto.parentId) {
      const parent = await this.prisma.permissions.findUnique({
        where: { id: createDto.parentId },
      });
      if (!parent) {
        throw new NotFoundException(`父权限 #${createDto.parentId} 不存在`);
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

  /**
   * 更新权限
   */
  async update(id: string, updateDto: UpdateRbacPermissionDto) {
    const permission = await this.prisma.permissions.findUnique({
      where: { id },
    });

    if (!permission) {
      throw new NotFoundException(`权限 #${id} 不存在`);
    }

    // 系统权限不允许修改编码和类型
    if (permission.isSystem) {
      if (updateDto.type !== undefined) {
        throw new BadRequestException('系统权限不允许修改类型');
      }
    }

    // 如果修改父权限，检查循环
    if (updateDto.parentId !== undefined && updateDto.parentId !== null) {
      const isCircular = await this.checkCircularParent(id, updateDto.parentId);
      if (isCircular) {
        throw new BadRequestException('检测到循环父级关系');
      }
    }

    const data: any = { ...updateDto };

    const updatedPermission = await this.prisma.permissions.update({
      where: { id },
      data,
    });

    return this.formatPermissionInfo(updatedPermission);
  }

  /**
   * 删除权限
   */
  async remove(id: string) {
    const permission = await this.prisma.permissions.findUnique({
      where: { id },
      include: { otherPermissions: true },
    });

    if (!permission) {
      throw new NotFoundException(`权限 #${id} 不存在`);
    }

    if (permission.isSystem) {
      throw new BadRequestException('系统权限不允许删除');
    }

    // 检查是否有子权限
    if (
      permission.otherPermissions &&
      permission.otherPermissions.length > 0
    ) {
      throw new BadRequestException('请先删除子权限');
    }

    // 删除角色权限关联
    await this.prisma.rolePermissions.deleteMany({
      where: { permissionId: id },
    });
    // 删除权限
    await this.prisma.permissions.delete({ where: { id } });

    return { message: '权限删除成功' };
  }

  /**
   * 获取用户的所有权限（包含角色继承）
   */
  async getUserPermissions(userId: string) {
    // 获取用户的角色
    const userRoles = await this.prisma.userRoles.findMany({
      where: { userId: userId },
      include: { roles: true },
    });

    const roles = userRoles.map((ur) => ur.roles).filter((r) => r !== null);

    // 检查是否是超级管理员
    const isSuperAdmin = roles.some((r) => r.code === 'SUPER_ADMIN');

    // 获取所有角色ID（包含继承的父角色）
    const allRoleIds = new Set<string>();
    for (const role of roles) {
      const ancestors = await this.getRoleAncestors(role.id);
      ancestors.forEach((r) => allRoleIds.add(r.id));
    }

    // 获取所有权限
    let permissionCodes: string[] = [];
    let menus: MenuItemDto[] = [];

    if (isSuperAdmin) {
      // 超级管理员获取所有权限
      const allPermissions = await this.prisma.permissions.findMany({
        where: { status: PermissionStatus.ACTIVE },
      });
      permissionCodes = allPermissions.map((p) => p.code);
      menus = await this.buildMenuTree();
    } else if (allRoleIds.size > 0) {
      // 获取角色的权限
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
      user: {
        id: userId,
        username: '',
        nickname: '',
      },
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

  /**
   * 检查用户是否有指定权限（支持通配符）
   */
  async hasPermission(
    userId: string,
    requiredPermission: string,
  ): Promise<boolean> {
    const { permissions, isSuperAdmin } = await this.getUserPermissions(userId);

    if (isSuperAdmin) {
      return true;
    }

    return permissions.some((p) => this.matchPermission(requiredPermission, p));
  }

  /**
   * 检查用户是否是超级管理员
   */
  async isSuperAdmin(userId: string): Promise<boolean> {
    const userRoles = await this.prisma.userRoles.findMany({
      where: { userId: userId },
      include: { roles: true },
    });

    return userRoles.some((ur) => ur.roles?.code === 'SUPER_ADMIN');
  }

  /**
   * 获取所有模块（用于展开通配符）
   */
  async getAllModules(): Promise<string[]> {
    const menuPermissions = await this.prisma.permissions.findMany({
      where: { type: PermissionType.MENU, status: PermissionStatus.ACTIVE },
    });

    return menuPermissions.map((p) => p.code);
  }

  /**
   * 权限匹配（支持通配符）
   */
  private matchPermission(required: string, userPermission: string): boolean {
    if (userPermission === '*') return true;
    if (userPermission === required) return true;

    // 通配符匹配: user:* 匹配 user:create
    if (userPermission.endsWith(':*')) {
      const prefix = userPermission.slice(0, -1);
      return required.startsWith(prefix);
    }

    return false;
  }

  /**
   * 获取角色及其所有祖先角色
   */
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

  /**
   * 检查循环父级
   */
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

  /**
   * 构建完整菜单树
   */
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

  /**
   * 根据权限构建菜单树
   */
  private async buildMenuTreeFromPermissions(
    permissions: any[],
  ): Promise<MenuItemDto[]> {
    const menuPermissions = permissions.filter(
      (p) => p.type === PermissionType.MENU,
    );
    const menuCodes = new Set(menuPermissions.map((p) => p.code));

    // 获取有权限的顶级菜单
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

  /**
   * 构建菜单项
   */
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

  /**
   * 递归构建权限树
   */
  private buildTree(permissions: any[]): RbacPermissionInfoDto[] {
    return permissions.map((p) => ({
      ...this.formatPermissionInfo(p),
      children: p.otherPermissions ? this.buildTree(p.otherPermissions) : [],
    }));
  }

  /**
   * 格式化权限信息
   */
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
