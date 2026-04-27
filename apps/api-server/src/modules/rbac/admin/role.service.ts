import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import type {
  CreateRoleDto,
  UpdateRoleDto,
  RoleQueryDto,
  RoleInfoDto,
  AssignPermissionsDto,
} from '@ai-platform/shared';
import { RoleStatus } from '@ai-platform/shared';

@Injectable()
export class RoleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 获取角色列表（分页）
   */
  async findAll(query: RoleQueryDto) {
    const { page = 1, pageSize = 10, code, name, status } = query;

    const where: any = {};

    if (code) {
      where.code = { contains: code };
    }

    if (name) {
      where.name = { contains: name };
    }

    if (status) {
      where.status = status;
    }

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.roles.findMany({
        where,
        orderBy: [{ sort: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.roles.count({ where }),
    ]);

    const formattedList = list.map((role) => this.formatRoleInfo(role));

    return {
      list: formattedList,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 获取角色树（含继承关系）
   */
  async getTree() {
    const roles = await this.prisma.roles.findMany({
      where: { parentId: null },
      include: { otherRoles: true },
      orderBy: { sort: 'asc' },
    });

    return this.buildTree(roles);
  }

  /**
   * 获取角色详情
   */
  async findOne(id: string) {
    const role = await this.prisma.roles.findUnique({
      where: { id },
      include: { roles: true },
    });

    if (!role) {
      throw new NotFoundException(this.i18n.t('rbac.role.notFound', { id }));
    }

    return this.formatRoleInfo(role);
  }

  /**
   * 创建角色
   */
  async create(createRoleDto: CreateRoleDto) {
    const existing = await this.prisma.roles.findFirst({
      where: { code: createRoleDto.code },
    });

    if (existing) {
      throw new ConflictException(
        this.i18n.t('rbac.role.codeExists', { code: createRoleDto.code }),
      );
    }

    if (createRoleDto.parentId) {
      const parent = await this.prisma.roles.findUnique({
        where: { id: createRoleDto.parentId },
      });
      if (!parent) {
        throw new NotFoundException(
          this.i18n.t('rbac.role.parentNotFound', {
            id: createRoleDto.parentId,
          }),
        );
      }

      const depth = await this.getInheritanceDepth(createRoleDto.parentId);
      if (depth >= 3) {
        throw new BadRequestException(
          this.i18n.t('rbac.role.maxDepthExceeded'),
        );
      }
    }

    const savedRole = await this.prisma.roles.create({
      data: {
        code: createRoleDto.code,
        name: createRoleDto.name,
        parentId: createRoleDto.parentId || null,
        description: createRoleDto.description,
        status: createRoleDto.status || RoleStatus.ACTIVE,
        sort: createRoleDto.sort || 0,
        isSystem: false,
      },
    });

    return this.formatRoleInfo(savedRole);
  }

  /**
   * 更新角色
   */
  async update(id: string, updateRoleDto: UpdateRoleDto) {
    const role = await this.prisma.roles.findUnique({ where: { id } });

    if (!role) {
      throw new NotFoundException(this.i18n.t('rbac.role.notFound', { id }));
    }

    if (role.isSystem && updateRoleDto.parentId !== undefined) {
      throw new BadRequestException(
        this.i18n.t('rbac.role.systemRoleNoInheritance'),
      );
    }

    if (
      updateRoleDto.parentId !== undefined &&
      updateRoleDto.parentId !== null
    ) {
      const isCircular = await this.checkCircularInheritance(
        id,
        updateRoleDto.parentId,
      );
      if (isCircular) {
        throw new BadRequestException(
          this.i18n.t('rbac.role.circularInheritance'),
        );
      }

      const depth = await this.getInheritanceDepth(updateRoleDto.parentId);
      if (depth >= 3) {
        throw new BadRequestException(
          this.i18n.t('rbac.role.maxDepthExceeded'),
        );
      }
    }

    const data: any = {};
    if (updateRoleDto.name !== undefined) data.name = updateRoleDto.name;
    if (updateRoleDto.parentId !== undefined)
      data.parentId = updateRoleDto.parentId;
    if (updateRoleDto.description !== undefined)
      data.description = updateRoleDto.description;
    if (updateRoleDto.status !== undefined) data.status = updateRoleDto.status;
    if (updateRoleDto.sort !== undefined) data.sort = updateRoleDto.sort;

    const updatedRole = await this.prisma.roles.update({
      where: { id },
      data,
    });
    return this.formatRoleInfo(updatedRole);
  }

  /**
   * 删除角色
   */
  async remove(id: string) {
    const role = await this.prisma.roles.findUnique({
      where: { id },
      include: { otherRoles: true },
    });

    if (!role) {
      throw new NotFoundException(this.i18n.t('rbac.role.notFound', { id }));
    }

    if (role.isSystem) {
      throw new BadRequestException(
        this.i18n.t('rbac.role.systemRoleNoDelete'),
      );
    }

    if (role.otherRoles && role.otherRoles.length > 0) {
      throw new BadRequestException(this.i18n.t('rbac.role.deleteChildFirst'));
    }

    const userRoleCount = await this.prisma.userRoles.count({
      where: { roleId: id },
    });

    if (userRoleCount > 0) {
      throw new BadRequestException(
        this.i18n.t('rbac.role.inUseByUsers', { count: userRoleCount }),
      );
    }

    await this.prisma.rolePermissions.deleteMany({ where: { roleId: id } });
    await this.prisma.roles.delete({ where: { id } });

    return { message: this.i18n.t('rbac.role.deleteSuccess') };
  }

  /**
   * 获取角色权限（包含继承的权限）
   */
  async getRolePermissions(id: string) {
    const role = await this.prisma.roles.findUnique({ where: { id } });

    if (!role) {
      throw new NotFoundException(this.i18n.t('rbac.role.notFound', { id }));
    }

    const ownPermissions = await this.prisma.rolePermissions.findMany({
      where: { roleId: id },
      include: { permissions: true },
    });
    const ownPermissionIds = ownPermissions.map((rp) => rp.permissionId);

    const ancestors = await this.getRoleAncestors(id);
    const ancestorIds = ancestors.filter((r) => r.id !== id).map((r) => r.id);

    let inheritedPermissionIds: string[] = [];
    if (ancestorIds.length > 0) {
      const inheritedPermissions = await this.prisma.rolePermissions.findMany({
        where: { roleId: { in: ancestorIds } },
      });
      inheritedPermissionIds = [
        ...new Set(inheritedPermissions.map((rp) => rp.permissionId)),
      ];
    }

    const allPermissionIds = [
      ...new Set([...ownPermissionIds, ...inheritedPermissionIds]),
    ];
    let allPermissionCodes: string[] = [];
    if (allPermissionIds.length > 0) {
      const permissions = await this.prisma.permissions.findMany({
        where: { id: { in: allPermissionIds } },
      });
      allPermissionCodes = permissions.map((p) => p.code);
    }

    return {
      roleId: id,
      ownPermissionIds,
      inheritedPermissionIds: inheritedPermissionIds.filter(
        (pid) => !ownPermissionIds.includes(pid),
      ),
      allPermissionCodes,
    };
  }

  /**
   * 为角色分配权限
   */
  async assignPermissions(id: string, dto: AssignPermissionsDto) {
    const role = await this.prisma.roles.findUnique({ where: { id } });

    if (!role) {
      throw new NotFoundException(this.i18n.t('rbac.role.notFound', { id }));
    }

    await this.prisma.rolePermissions.deleteMany({ where: { roleId: id } });

    if (dto.permissionIds.length > 0) {
      await this.prisma.rolePermissions.createMany({
        data: dto.permissionIds.map((permissionId) => ({
          roleId: id,
          permissionId: permissionId,
        })),
      });
    }

    return { message: this.i18n.t('rbac.role.assignSuccess') };
  }

  /**
   * 获取角色及其所有祖先角色
   */
  async getRoleAncestors(roleId: string): Promise<any[]> {
    const roles: any[] = [];
    let currentRole = await this.prisma.roles.findUnique({
      where: { id: roleId },
      include: { roles: true },
    });

    while (currentRole) {
      roles.push(currentRole);
      if (currentRole.roles) {
        currentRole = await this.prisma.roles.findUnique({
          where: { id: currentRole.roles.id },
          include: { roles: true },
        });
      } else {
        currentRole = null;
      }
    }

    return roles;
  }

  /**
   * 检查循环继承
   */
  async checkCircularInheritance(
    roleId: string,
    parentId: string,
  ): Promise<boolean> {
    if (roleId === parentId) return true;

    const ancestors = await this.getRoleAncestors(parentId);
    return ancestors.some((r) => r.id === roleId);
  }

  /**
   * 获取继承深度
   */
  private async getInheritanceDepth(roleId: string): Promise<number> {
    const ancestors = await this.getRoleAncestors(roleId);
    return ancestors.length;
  }

  /**
   * 递归构建角色树
   */
  private buildTree(roles: any[]): RoleInfoDto[] {
    return roles.map((role) => ({
      ...this.formatRoleInfo(role),
      children: role.otherRoles ? this.buildTree(role.otherRoles) : [],
    }));
  }

  /**
   * 格式化角色信息
   */
  private formatRoleInfo(role: any): RoleInfoDto {
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      parentId: role.parentId,
      parentCode: role.roles?.code || null,
      description: role.description,
      status: role.status,
      isSystem: role.isSystem,
      sort: role.sort,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
