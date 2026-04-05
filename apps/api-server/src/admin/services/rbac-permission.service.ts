import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import {
  Permission,
  PermissionType,
  PermissionStatus,
  HttpMethod,
} from '../../entities/permission.entity';
import { RbacHttpMethod } from '@ai-platform/shared';
import { RolePermission } from '../../entities/role-permission.entity';
import { UserRole } from '../../entities/user-role.entity';
import { Role } from '../../entities/role.entity';
import type {
  CreateRbacPermissionDto,
  UpdateRbacPermissionDto,
  RbacPermissionQueryDto,
  RbacPermissionInfoDto,
  MenuItemDto,
} from '@ai-platform/shared';

@Injectable()
export class RbacPermissionService {
  constructor(
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(UserRole)
    private readonly userRoleRepository: Repository<UserRole>,
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
  ) {}

  /**
   * 获取权限列表（分页）
   */
  async findAll(query: RbacPermissionQueryDto) {
    const { page = 1, pageSize = 10, code, name, type, status } = query;

    const queryBuilder =
      this.permissionRepository.createQueryBuilder('permission');

    if (code) {
      queryBuilder.andWhere('permission.code LIKE :code', {
        code: `%${code}%`,
      });
    }

    if (name) {
      queryBuilder.andWhere('permission.name LIKE :name', {
        name: `%${name}%`,
      });
    }

    if (type) {
      queryBuilder.andWhere('permission.type = :type', { type });
    }

    if (status) {
      queryBuilder.andWhere('permission.status = :status', { status });
    }

    queryBuilder
      .orderBy('permission.sort', 'ASC')
      .addOrderBy('permission.createdAt', 'DESC');

    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);

    const [list, total] = await queryBuilder.getManyAndCount();

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
    const permissions = await this.permissionRepository.find({
      where: { parentId: IsNull(), status: PermissionStatus.ACTIVE },
      relations: ['children'],
      order: { sort: 'ASC' },
    });

    return this.buildTree(permissions);
  }

  /**
   * 获取权限详情
   */
  async findOne(id: string) {
    const permission = await this.permissionRepository.findOne({
      where: { id },
      relations: ['parent'],
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
    const existing = await this.permissionRepository.findOne({
      where: { code: createDto.code },
    });

    if (existing) {
      throw new ConflictException(`权限编码 ${createDto.code} 已存在`);
    }

    // 如果指定了父权限，检查父权限是否存在
    if (createDto.parentId) {
      const parent = await this.permissionRepository.findOne({
        where: { id: createDto.parentId },
      });
      if (!parent) {
        throw new NotFoundException(`父权限 #${createDto.parentId} 不存在`);
      }
    }

    const permission = this.permissionRepository.create({
      code: createDto.code,
      name: createDto.name,
      type: createDto.type as PermissionType,
      action: createDto.action as unknown as HttpMethod,
      resource: createDto.resource,
      parentId: createDto.parentId || null,
      icon: createDto.icon,
      description: createDto.description,
      sort: createDto.sort || 0,
      status: PermissionStatus.ACTIVE,
      isSystem: false,
    });

    const savedPermission = await this.permissionRepository.save(permission);
    return this.formatPermissionInfo(savedPermission);
  }

  /**
   * 更新权限
   */
  async update(id: string, updateDto: UpdateRbacPermissionDto) {
    const permission = await this.permissionRepository.findOne({
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

    Object.assign(permission, updateDto);
    const updatedPermission = await this.permissionRepository.save(permission);
    return this.formatPermissionInfo(updatedPermission);
  }

  /**
   * 删除权限
   */
  async remove(id: string) {
    const permission = await this.permissionRepository.findOne({
      where: { id },
      relations: ['children'],
    });

    if (!permission) {
      throw new NotFoundException(`权限 #${id} 不存在`);
    }

    if (permission.isSystem) {
      throw new BadRequestException('系统权限不允许删除');
    }

    // 检查是否有子权限
    if (permission.children && permission.children.length > 0) {
      throw new BadRequestException('请先删除子权限');
    }

    // 删除角色权限关联
    await this.rolePermissionRepository.delete({ permissionId: id });
    // 删除权限
    await this.permissionRepository.remove(permission);

    return { message: '权限删除成功' };
  }

  /**
   * 获取用户的所有权限（包含角色继承）
   */
  async getUserPermissions(userId: string) {
    // 获取用户的角色
    const userRoles = await this.userRoleRepository.find({
      where: { userId },
      relations: ['role'],
    });

    const roles = userRoles.map((ur) => ur.role).filter((r) => r !== null);

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
      const allPermissions = await this.permissionRepository.find({
        where: { status: PermissionStatus.ACTIVE },
      });
      permissionCodes = allPermissions.map((p) => p.code);
      menus = await this.buildMenuTree();
    } else if (allRoleIds.size > 0) {
      // 获取角色的权限
      const rolePermissions = await this.rolePermissionRepository.find({
        where: { roleId: In([...allRoleIds]) },
        relations: ['permission'],
      });

      const permissions = rolePermissions
        .map((rp) => rp.permission)
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
        parentCode: r.parent?.code || null,
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
    const userRoles = await this.userRoleRepository.find({
      where: { userId },
      relations: ['role'],
    });

    return userRoles.some((ur) => ur.role?.code === 'SUPER_ADMIN');
  }

  /**
   * 获取所有模块（用于展开通配符）
   */
  async getAllModules(): Promise<string[]> {
    const menuPermissions = await this.permissionRepository.find({
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
  private async getRoleAncestors(roleId: string): Promise<Role[]> {
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
   * 检查循环父级
   */
  private async checkCircularParent(
    id: string,
    parentId: string,
  ): Promise<boolean> {
    if (id === parentId) return true;

    let currentId: string | null = parentId;
    while (currentId) {
      const permission = await this.permissionRepository.findOne({
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
    const menuPermissions = await this.permissionRepository.find({
      where: {
        type: PermissionType.MENU,
        status: PermissionStatus.ACTIVE,
        parentId: IsNull(),
      },
      relations: ['children'],
      order: { sort: 'ASC' },
    });

    return this.buildMenuItems(menuPermissions);
  }

  /**
   * 根据权限构建菜单树
   */
  private async buildMenuTreeFromPermissions(
    permissions: Permission[],
  ): Promise<MenuItemDto[]> {
    const menuPermissions = permissions.filter(
      (p) => p.type === PermissionType.MENU,
    );
    const menuCodes = new Set(menuPermissions.map((p) => p.code));

    // 获取有权限的顶级菜单
    const topLevelMenus = await this.permissionRepository.find({
      where: {
        type: PermissionType.MENU,
        status: PermissionStatus.ACTIVE,
        parentId: IsNull(),
        code: In([...menuCodes]),
      },
      relations: ['children'],
      order: { sort: 'ASC' },
    });

    return this.buildMenuItems(topLevelMenus, menuCodes);
  }

  /**
   * 构建菜单项
   */
  private buildMenuItems(
    permissions: Permission[],
    allowedCodes?: Set<string>,
  ): MenuItemDto[] {
    return permissions
      .filter((p) => !allowedCodes || allowedCodes.has(p.code))
      .map((p) => ({
        path: `/${p.code.replace(/:/g, '/')}`,
        name: p.name,
        icon: p.icon || undefined,
        permissionCode: p.code,
        children: p.children
          ? this.buildMenuItems(
              p.children.filter((c) => c.type === PermissionType.MENU),
              allowedCodes,
            )
          : [],
      }));
  }

  /**
   * 递归构建权限树
   */
  private buildTree(permissions: Permission[]): RbacPermissionInfoDto[] {
    return permissions.map((p) => ({
      ...this.formatPermissionInfo(p),
      children: p.children ? this.buildTree(p.children) : [],
    }));
  }

  /**
   * 格式化权限信息
   */
  private formatPermissionInfo(permission: Permission): RbacPermissionInfoDto {
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
