import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AdminRole, AdminUserStatus } from '../user.types';
import {
  CreateUserDto,
  UpdateUserDto,
  GetUsersQueryDto,
  AdminResetPasswordDto,
} from './dto/user-management.dto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { I18nService } from '../../../core/i18n';

@Injectable()
export class AdminUserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 获取管理员用户列表（分页）
   */
  async findAll(query: GetUsersQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const { keyword, role, status } = query;

    // Build where conditions
    const where: any = {};

    if (keyword) {
      where.OR = [
        { username: { contains: keyword, mode: 'insensitive' } },
        { email: { contains: keyword, mode: 'insensitive' } },
        { nickname: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    if (role) {
      where.role = role;
    }

    if (status) {
      where.status = status;
    }

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.adminUsers.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.adminUsers.count({ where }),
    ]);

    // 获取所有用户的 RBAC 角色
    const userIds = list.map((u) => u.id);

    const userRoles =
      userIds.length > 0
        ? await this.prisma.userRoles.findMany({
            where: { userId: { in: userIds } },
            include: { roles: true },
          })
        : [];

    // 构建用户ID到角色的映射
    const userRolesMap = new Map<string, any[]>();
    userRoles.forEach((ur) => {
      if (ur.roles) {
        const existing = userRolesMap.get(ur.userId) || [];
        existing.push({
          id: ur.roles.id,
          code: ur.roles.code,
          name: ur.roles.name,
        });
        userRolesMap.set(ur.userId, existing);
      }
    });

    // 移除密码字段并添加角色信息
    const sanitizedList = list.map((user) => {
      const { password, ...rest } = user;
      const rbacRoles = userRolesMap.get(user.id) || [];
      return {
        ...rest,
        rbacRoles,
      };
    });

    return {
      list: sanitizedList,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取管理员用户详情
   */
  async findOne(id: string) {
    const user = await this.prisma.adminUsers.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(this.i18n.t('user.userNotFound', { id }));
    }

    // Exclude password from response
    const { password, ...rest } = user;
    return rest;
  }

  /**
   * 创建管理员用户
   */
  async create(createUserDto: CreateUserDto) {
    const email = createUserDto.email.trim().toLowerCase();
    const username = await this.buildUniqueUsername(
      createUserDto.username?.trim() || this.deriveUsernameFromEmail(email),
    );

    // 检查用户名是否已存在
    const existingByUsername = await this.prisma.adminUsers.findUnique({
      where: { username },
    });
    if (existingByUsername) {
      throw new ConflictException(this.i18n.t('user.usernameTaken'));
    }

    const existingByEmail = await this.prisma.adminUsers.findFirst({
      where: {
        email: {
          equals: email,
          mode: 'insensitive',
        },
      },
    });
    if (existingByEmail) {
      throw new ConflictException(this.i18n.t('user.emailTaken'));
    }

    // Firebase Google 登录为主，本地密码只作兼容保留。
    const rawPassword =
      createUserDto.password || crypto.randomBytes(24).toString('hex');
    const hashedPassword = await bcrypt.hash(rawPassword, 10);

    const savedUser = await this.prisma.adminUsers.create({
      data: {
        username,
        email,
        password: hashedPassword,
        role:
          createUserDto.role === AdminRole.SUPER_ADMIN
            ? AdminRole.SUPER_ADMIN
            : AdminRole.ADMIN,
        status: createUserDto.status || AdminUserStatus.ACTIVE,
        nickname: createUserDto.nickname,
        phone: createUserDto.phone,
      },
    });

    const { password, ...rest } = savedUser;
    return rest;
  }

  /**
   * 更新管理员用户
   */
  async update(id: string, updateUserDto: UpdateUserDto) {
    const user = await this.prisma.adminUsers.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(this.i18n.t('user.userNotFound', { id }));
    }

    // 检查邮箱是否被其他用户使用
    const normalizedEmail = updateUserDto.email?.trim().toLowerCase();
    if (normalizedEmail && normalizedEmail !== user.email?.toLowerCase()) {
      const existingUser = await this.prisma.adminUsers.findFirst({
        where: {
          email: {
            equals: normalizedEmail,
            mode: 'insensitive',
          },
        },
      });
      if (existingUser) {
        throw new ConflictException(this.i18n.t('user.emailInUse'));
      }
    }

    const updatedUser = await this.prisma.adminUsers.update({
      where: { id },
      data: {
        ...updateUserDto,
        email: normalizedEmail ?? updateUserDto.email,
      } as any,
    });

    const { password, ...rest } = updatedUser;
    return rest;
  }

  /**
   * 删除管理员用户
   */
  async remove(id: string) {
    const user = await this.prisma.adminUsers.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(this.i18n.t('user.userNotFound', { id }));
    }

    // 不允许删除超级管理员
    if (user.username === 'admin') {
      throw new BadRequestException(this.i18n.t('user.cannotDeleteSuperAdmin'));
    }

    await this.prisma.adminUsers.delete({ where: { id } });

    return { message: this.i18n.t('user.userDeleted') };
  }

  /**
   * 重置密码
   */
  async resetPassword(id: string, resetPasswordDto: AdminResetPasswordDto) {
    // Prisma always returns all fields (no select:false concept like TypeORM),
    // so we can just findUnique — password is included by default in Prisma
    const user = await this.prisma.adminUsers.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(this.i18n.t('user.userNotFound', { id }));
    }

    // 加密新密码
    const hashedPassword = await bcrypt.hash(resetPasswordDto.newPassword, 10);

    await this.prisma.adminUsers.update({
      where: { id },
      data: { password: hashedPassword },
    });

    return { message: this.i18n.t('user.passwordReset') };
  }

  /**
   * 获取管理员用户的角色列表
   */
  async getUserRoles(userId: string) {
    const user = await this.prisma.adminUsers.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(
        this.i18n.t('user.userNotFound', { id: userId }),
      );
    }

    const userRoles = await this.prisma.userRoles.findMany({
      where: { userId: userId },
      include: { roles: true },
    });

    return {
      userId,
      roles: userRoles
        .filter((ur) => ur.roles)
        .map((ur) => ({
          id: ur.roles.id,
          code: ur.roles.code,
          name: ur.roles.name,
        })),
    };
  }

  /**
   * 为管理员用户分配角色
   */
  async assignRoles(userId: string, roleIds: string[]) {
    const user = await this.prisma.adminUsers.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new NotFoundException(
        this.i18n.t('user.userNotFound', { id: userId }),
      );
    }

    // 验证角色是否存在
    if (roleIds.length > 0) {
      const roles = await this.prisma.roles.findMany({
        where: { id: { in: roleIds } },
      });
      if (roles.length !== roleIds.length) {
        throw new BadRequestException(this.i18n.t('user.roleNotFoundPartial'));
      }
    }

    // 删除现有的用户角色关联
    await this.prisma.userRoles.deleteMany({ where: { userId: userId } });

    // 创建新的用户角色关联
    if (roleIds.length > 0) {
      await this.prisma.userRoles.createMany({
        data: roleIds.map((roleId) => ({
          userId: userId,
          roleId: roleId,
        })),
      });
    }

    return { message: this.i18n.t('user.rolesAssigned') };
  }

  private deriveUsernameFromEmail(email: string): string {
    const [localPart] = email.split('@');
    return localPart.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40) || 'admin';
  }

  private async buildUniqueUsername(base: string): Promise<string> {
    let candidate = base;
    let counter = 0;

    while (true) {
      const exists = await this.prisma.adminUsers.findUnique({
        where: { username: candidate },
      });
      if (!exists) return candidate;

      counter += 1;
      candidate = `${base.slice(0, 32)}_${counter}`;
    }
  }
}
