import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { PermissionStatus } from '../rbac.types';
import type {
  CreatePermissionTemplateDto,
  UpdatePermissionTemplateDto,
  PermissionTemplateQueryDto,
  PermissionTemplateInfoDto,
  TemplatePreviewDto,
} from '@ai-platform/shared';

@Injectable()
export class PermissionTemplateService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取权限模板列表
   */
  async findAll(query: PermissionTemplateQueryDto) {
    const { page = 1, pageSize = 20, code, name } = query;

    const where: any = {};

    if (code) {
      where.code = { contains: code };
    }

    if (name) {
      where.name = { contains: name };
    }

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.permission_templates.findMany({
        where,
        orderBy: [{ is_system: 'desc' }, { created_at: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.permission_templates.count({ where }),
    ]);

    // 转换数据格式
    const formattedList = list.map((t) => this.formatTemplateInfo(t));

    return {
      list: formattedList,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 获取模板详情
   */
  async findOne(id: string) {
    const template = await this.prisma.permission_templates.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(`权限模板 #${id} 不存在`);
    }

    return this.formatTemplateInfo(template);
  }

  /**
   * 根据编码获取模板
   */
  async findByCode(code: string) {
    const template = await this.prisma.permission_templates.findFirst({
      where: { code },
    });

    if (!template) {
      throw new NotFoundException(`权限模板 ${code} 不存在`);
    }

    return this.formatTemplateInfo(template);
  }

  /**
   * 创建权限模板
   */
  async create(createDto: CreatePermissionTemplateDto) {
    // 检查编码唯一性
    const existing = await this.prisma.permission_templates.findFirst({
      where: { code: createDto.code },
    });

    if (existing) {
      throw new ConflictException(`模板编码 ${createDto.code} 已存在`);
    }

    const savedTemplate = await this.prisma.permission_templates.create({
      data: {
        code: createDto.code,
        name: createDto.name,
        description: createDto.description,
        permission_patterns: createDto.permissionPatterns.join(','),
        is_system: false,
      },
    });

    return this.formatTemplateInfo(savedTemplate);
  }

  /**
   * 更新权限模板
   */
  async update(id: string, updateDto: UpdatePermissionTemplateDto) {
    const template = await this.prisma.permission_templates.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(`权限模板 #${id} 不存在`);
    }

    if (template.is_system) {
      throw new BadRequestException('系统模板不允许修改');
    }

    const data: any = { ...updateDto };
    if (data.permissionPatterns) {
      data.permission_patterns = Array.isArray(data.permissionPatterns)
        ? data.permissionPatterns.join(',')
        : data.permissionPatterns;
      delete data.permissionPatterns;
    }

    const updatedTemplate = await this.prisma.permission_templates.update({
      where: { id },
      data,
    });

    return this.formatTemplateInfo(updatedTemplate);
  }

  /**
   * 删除权限模板
   */
  async remove(id: string) {
    const template = await this.prisma.permission_templates.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(`权限模板 #${id} 不存在`);
    }

    if (template.is_system) {
      throw new BadRequestException('系统模板不允许删除');
    }

    await this.prisma.permission_templates.delete({ where: { id } });

    return { message: '权限模板删除成功' };
  }

  /**
   * 预览模板展开后的权限
   */
  async preview(previewDto: TemplatePreviewDto) {
    const expandedCodes = await this.expandPatterns(
      previewDto.permissionPatterns,
      previewDto.modules,
    );

    return {
      expandedPermissions: expandedCodes,
      matchCount: expandedCodes.length,
    };
  }

  /**
   * 应用模板到角色
   */
  async applyToRole(roleId: string, templateCode: string, modules?: string[]) {
    const template = await this.prisma.permission_templates.findFirst({
      where: { code: templateCode },
    });

    if (!template) {
      throw new NotFoundException(`权限模板 ${templateCode} 不存在`);
    }

    const permissionPatterns =
      typeof template.permission_patterns === 'string'
        ? template.permission_patterns.split(',').filter(Boolean)
        : template.permission_patterns;

    // 展开模板中的通配符
    const permissionCodes = await this.expandPatterns(
      permissionPatterns,
      modules,
    );

    // 获取权限实体
    const permissions = await this.prisma.permissions.findMany({
      where: {
        code: { in: permissionCodes },
        status: PermissionStatus.ACTIVE,
      },
    });

    if (permissions.length === 0) {
      return { message: '没有匹配的权限' };
    }

    // 获取角色现有权限
    const existingRolePermissions = await this.prisma.role_permissions.findMany(
      {
        where: { role_id: roleId },
      },
    );
    const existingPermissionIds = new Set(
      existingRolePermissions.map((rp) => rp.permission_id),
    );

    // 过滤出需要新增的权限
    const newPermissions = permissions.filter(
      (p) => !existingPermissionIds.has(p.id),
    );

    // 分配给角色
    if (newPermissions.length > 0) {
      await Promise.all(
        newPermissions.map((p) =>
          this.prisma.role_permissions.create({
            data: {
              role_id: roleId,
              permission_id: p.id,
            },
          }),
        ),
      );
    }

    return {
      message: '模板应用成功',
      addedCount: newPermissions.length,
    };
  }

  /**
   * 展开通配符模式
   */
  async expandPatterns(patterns: string[], modules?: string[]) {
    // 如果没有指定模块，获取所有模块
    if (!modules || modules.length === 0) {
      modules = await this.getAllModules();
    }

    const result: string[] = [];

    for (const pattern of patterns) {
      if (pattern.startsWith('*:')) {
        // 通配符: *:list -> user:list, role:list, ...
        const action = pattern.slice(2);
        modules.forEach((m) => result.push(`${m}:${action}`));
      } else if (pattern.endsWith(':*')) {
        // 模块通配符: user:* -> user:list, user:create, ...
        const module = pattern.slice(0, -2);
        const actions = await this.getModuleActions(module);
        actions.forEach((a) => result.push(`${module}:${a}`));
      } else {
        // 直接添加
        result.push(pattern);
      }
    }

    return [...new Set(result)]; // 去重
  }

  /**
   * 获取所有模块（顶级菜单权限的code）
   */
  private async getAllModules(): Promise<string[]> {
    const menuPermissions = await this.prisma.permissions.findMany({
      where: {
        type: 'menu' as any,
        status: PermissionStatus.ACTIVE,
      },
    });

    // 返回不含冒号的code（即顶级模块）
    return menuPermissions
      .filter((p) => !p.code.includes(':'))
      .map((p) => p.code);
  }

  /**
   * 获取模块的所有操作
   */
  private async getModuleActions(module: string): Promise<string[]> {
    const permissions = await this.prisma.permissions.findMany({
      where: {
        status: PermissionStatus.ACTIVE,
      },
    });

    // 过滤出该模块的操作权限
    return permissions
      .filter(
        (p) =>
          p.code.startsWith(`${module}:`) && p.code.split(':').length === 2,
      )
      .map((p) => p.code.split(':')[1]);
  }

  /**
   * 格式化模板信息
   */
  private formatTemplateInfo(template: any): PermissionTemplateInfoDto {
    return {
      id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      permissionPatterns:
        typeof template.permission_patterns === 'string'
          ? template.permission_patterns.split(',').filter(Boolean)
          : template.permission_patterns,
      isSystem: template.is_system,
      createdAt: template.created_at,
      updatedAt: template.updated_at,
    };
  }
}
