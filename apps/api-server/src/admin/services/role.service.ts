import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { Role, RoleStatus } from '../../entities/role.entity';
import { Permission } from '../../entities/permission.entity';
import { RolePermission } from '../../entities/role-permission.entity';
import { UserRole } from '../../entities/user-role.entity';
import type {
  CreateRoleDto,
  UpdateRoleDto,
  RoleQueryDto,
  RoleInfoDto,
  AssignPermissionsDto,
} from '@ai-platform/shared';

@Injectable()
export class RoleService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
  ) {}

  /**
   * 获取角色列表（分页）
   */
  async findAll(query: RoleQueryDto) {
    const { page = 1, pageSize = 10, code, name, status } = query;

    const queryBuilder = this.roleRepository.createQueryBuilder('role');

    if (code) {
      queryBuilder.andWhere('role.code LIKE :code', { code: `%${code}%` });
    }

    if (name) {
      queryBuilder.andWhere('role.name LIKE :name', { name: `%${name}%` });
    }

    if (status) {
      queryBuilder.andWhere('role.status = :status', { status });
    }

    queryBuilder
      .orderBy('role.sort', 'ASC')
      .addOrderBy('role.createdAt', 'DESC');

    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);

    const [list, total] = await queryBuilder.getManyAndCount();

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
    const roles = await this.roleRepository.find({
      where: { parentId: IsNull() },
      relations: ['children'],
      order: { sort: 'ASC' },
    });

    return this.buildTree(roles);
  }

  /**
   * 获取角色详情
   */
  async findOne(id: string) {
    const role = await this.roleRepository.findOne({
      where: { id },
      relations: ['parent'],
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
    const existing = await this.roleRepository.findOne({
      where: { code: createRoleDto.code },
    });

    if (existing) {
      throw new ConflictException(`角色编码 ${createRoleDto.code} 已存在`);
    }

    // 如果指定了父角色，检查父角色是否存在
    if (createRoleDto.parentId) {
      const parent = await this.roleRepository.findOne({
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

    const role = this.roleRepository.create({
      code: createRoleDto.code,
      name: createRoleDto.name,
      parentId: createRoleDto.parentId || null,
      description: createRoleDto.description,
      status: createRoleDto.status || RoleStatus.ACTIVE,
      sort: createRoleDto.sort || 0,
      isSystem: false,
    });

    const savedRole = await this.roleRepository.save(role);
    return this.formatRoleInfo(savedRole);
  }

  /**
   * 更新角色
   */
  async update(id: string, updateRoleDto: UpdateRoleDto) {
    const role = await this.roleRepository.findOne({ where: { id } });

    if (!role) {
      throw new NotFoundException(`角色 #${id} 不存在`);
    }

    // 系统角色不允许修改关键字段
    if (role.isSystem && updateRoleDto.parentId !== undefined) {
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

    Object.assign(role, updateRoleDto);
    const updatedRole = await this.roleRepository.save(role);
    return this.formatRoleInfo(updatedRole);
  }

  /**
   * 删除角色
   */
  async remove(id: string) {
    const role = await this.roleRepository.findOne({
      where: { id },
      relations: ['children'],
    });

    if (!role) {
      throw new NotFoundException(`角色 #${id} 不存在`);
    }

    if (role.isSystem) {
      throw new BadRequestException('系统角色不允许删除');
    }

    // 检查是否有子角色
    if (role.children && role.children.length > 0) {
      throw new BadRequestException('请先删除子角色');
    }

    // 检查是否有用户使用该角色
    const userRoleCount = await this.userRoleRepository.count({
      where: { roleId: id },
    });

    if (userRoleCount > 0) {
      throw new BadRequestException(
        `该角色已被 ${userRoleCount} 个用户使用，无法删除`,
      );
    }

    // 删除角色权限关联
    await this.rolePermissionRepository.delete({ roleId: id });
    // 删除角色
    await this.roleRepository.remove(role);

    return { message: '角色删除成功' };
  }

  /**
   * 获取角色权限（包含继承的权限）
   */
  async getRolePermissions(id: string) {
    const role = await this.roleRepository.findOne({ where: { id } });

    if (!role) {
      throw new NotFoundException(`角色 #${id} 不存在`);
    }

    // 获取角色自身的权限
    const ownPermissions = await this.rolePermissionRepository.find({
      where: { roleId: id },
      relations: ['permission'],
    });
    const ownPermissionIds = ownPermissions.map((rp) => rp.permissionId);

    // 获取继承的权限
    const ancestors = await this.getRoleAncestors(id);
    const ancestorIds = ancestors.filter((r) => r.id !== id).map((r) => r.id);

    let inheritedPermissionIds: string[] = [];
    if (ancestorIds.length > 0) {
      const inheritedPermissions = await this.rolePermissionRepository.find({
        where: { roleId: In(ancestorIds) },
      });
      inheritedPermissionIds = [
        ...new Set(inheritedPermissions.map((rp) => rp.permissionId)),
      ];
    }

    // 获取所有权限Code
    const allPermissionIds = [
      ...new Set([...ownPermissionIds, ...inheritedPermissionIds]),
    ];
    let allPermissionCodes: string[] = [];
    if (allPermissionIds.length > 0) {
      const permissions = await this.permissionRepository.find({
        where: { id: In(allPermissionIds) },
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
    const role = await this.roleRepository.findOne({ where: { id } });

    if (!role) {
      throw new NotFoundException(`角色 #${id} 不存在`);
    }

    // 删除现有权限
    await this.rolePermissionRepository.delete({ roleId: id });

    // 分配新权限
    if (dto.permissionIds.length > 0) {
      const rolePermissions = dto.permissionIds.map((permissionId) =>
        this.rolePermissionRepository.create({
          roleId: id,
          permissionId,
        }),
      );
      await this.rolePermissionRepository.save(rolePermissions);
    }

    return { message: '权限分配成功' };
  }

  /**
   * 获取角色及其所有祖先角色
   */
  async getRoleAncestors(roleId: string): Promise<Role[]> {
    const roles: Role[] = [];
    let currentRole = await this.roleRepository.findOne({
      where: { id: roleId },
      relations: ['parent'],
    });

    while (currentRole) {
      roles.push(currentRole);
      currentRole = currentRole.parent || null;
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
  private buildTree(roles: Role[]): RoleInfoDto[] {
    return roles.map((role) => ({
      ...this.formatRoleInfo(role),
      children: role.children ? this.buildTree(role.children) : [],
    }));
  }

  /**
   * 格式化角色信息
   */
  private formatRoleInfo(role: Role): RoleInfoDto {
    return {
      id: role.id,
      code: role.code,
      name: role.name,
      parentId: role.parentId,
      parentCode: role.parent?.code || null,
      description: role.description,
      status: role.status,
      isSystem: role.isSystem,
      sort: role.sort,
      createdAt: role.createdAt,
      updatedAt: role.updatedAt,
    };
  }
}
