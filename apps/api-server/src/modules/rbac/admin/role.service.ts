import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
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
  constructor(private readonly prisma: PrismaService) {}

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
        orderBy: [{ sort: 'asc' }, { created_at: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.roles.count({ where }),
    ]);

    // 转换数据格式
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
      where: { parent_id: null },
      include: { other_roles: true },
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
      throw new NotFoundException(`角色 #${id} 不存在`);
    }

    return this.formatRoleInfo(role);
  }

  /**
   * 创建角色
   */
  async create(createRoleDto: CreateRoleDto) {
    // 检查编码唯一性
    const existing = await this.prisma.roles.findFirst({
      where: { code: createRoleDto.code },
    });

    if (existing) {
      throw new ConflictException(`角色编码 ${createRoleDto.code} 已存在`);
    }

    // 如果指定了父角色，检查父角色是否存在
    if (createRoleDto.parentId) {
      const parent = await this.prisma.roles.findUnique({
        where: { id: createRoleDto.parentId },
      });
      if (!parent) {
        throw new NotFoundException(`父角色 #${createRoleDto.parentId} 不存在`);
      }

      // 检查继承深度
      const depth = await this.getInheritanceDepth(createRoleDto.parentId);
      if (depth >= 3) {
        throw new BadRequestException('角色继承层级不能超过3层');
      }
    }

    const savedRole = await this.prisma.roles.create({
      data: {
        code: createRoleDto.code,
        name: createRoleDto.name,
        parent_id: createRoleDto.parentId || null,
        description: createRoleDto.description,
        status: createRoleDto.status || RoleStatus.ACTIVE,
        sort: createRoleDto.sort || 0,
        is_system: false,
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
      throw new NotFoundException(`角色 #${id} 不存在`);
    }

    // 系统角色不允许修改关键字段
    if (role.is_system && updateRoleDto.parentId !== undefined) {
      throw new BadRequestException('系统角色不允许修改继承关系');
    }

    // 如果修改父角色，检查循环继承
    if (
      updateRoleDto.parentId !== undefined &&
      updateRoleDto.parentId !== null
    ) {
      const isCircular = await this.checkCircularInheritance(
        id,
        updateRoleDto.parentId,
      );
      if (isCircular) {
        throw new BadRequestException('检测到循环继承');
      }

      // 检查继承深度
      const depth = await this.getInheritanceDepth(updateRoleDto.parentId);
      if (depth >= 3) {
        throw new BadRequestException('角色继承层级不能超过3层');
      }
    }

    const data: any = {};
    if (updateRoleDto.name !== undefined) data.name = updateRoleDto.name;
    if (updateRoleDto.parentId !== undefined)
      data.parent_id = updateRoleDto.parentId;
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
      include: { other_roles: true },
    });

    if (!role) {
      throw new NotFoundException(`角色 #${id} 不存在`);
    }

    if (role.is_system) {
      throw new BadRequestException('系统角色不允许删除');
    }

    // 检查是否有子角色
    if (role.other_roles && role.other_roles.length > 0) {
      throw new BadRequestException('请先删除子角色');
    }

    // 检查是否有用户使用该角色
    const userRoleCount = await this.prisma.user_roles.count({
      where: { role_id: id },
    });

    if (userRoleCount > 0) {
      throw new BadRequestException(
        `该角色已被 ${userRoleCount} 个用户使用，无法删除`,
      );
    }

    // 删除角色权限关联
    await this.prisma.role_permissions.deleteMany({ where: { role_id: id } });
    // 删除角色
    await this.prisma.roles.delete({ where: { id } });

    return { message: '角色删除成功' };
  }

  /**
   * 获取角色权限（包含继承的权限）
   */
  async getRolePermissions(id: string) {
    const role = await this.prisma.roles.findUnique({ where: { id } });

    if (!role) {
      throw new NotFoundException(`角色 #${id} 不存在`);
    }

    // 获取角色自身的权限
    const ownPermissions = await this.prisma.role_permissions.findMany({
      where: { role_id: id },
      include: { permissions: true },
    });
    const ownPermissionIds = ownPermissions.map((rp) => rp.permission_id);

    // 获取继承的权限
    const ancestors = await this.getRoleAncestors(id);
    const ancestorIds = ancestors.filter((r) => r.id !== id).map((r) => r.id);

    let inheritedPermissionIds: string[] = [];
    if (ancestorIds.length > 0) {
      const inheritedPermissions = await this.prisma.role_permissions.findMany({
        where: { role_id: { in: ancestorIds } },
      });
      inheritedPermissionIds = [
        ...new Set(inheritedPermissions.map((rp) => rp.permission_id)),
      ];
    }

    // 获取所有权限Code
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
      throw new NotFoundException(`角色 #${id} 不存在`);
    }

    // 删除现有权限
    await this.prisma.role_permissions.deleteMany({ where: { role_id: id } });

    // 分配新权限
    if (dto.permissionIds.length > 0) {
      await this.prisma.role_permissions.createMany({
        data: dto.permissionIds.map((permissionId) => ({
          role_id: id,
          permission_id: permissionId,
        })),
      });
    }

    return { message: '权限分配成功' };
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
      children: role.other_roles ? this.buildTree(role.other_roles) : [],
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
      parentId: role.parent_id,
      parentCode: role.roles?.code || null,
      description: role.description,
      status: role.status,
      isSystem: role.is_system,
      sort: role.sort,
      createdAt: role.created_at,
      updatedAt: role.updated_at,
    };
  }
}
