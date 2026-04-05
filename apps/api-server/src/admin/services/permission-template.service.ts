import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { PermissionTemplate } from '../../entities/permission-template.entity';
import { Permission, PermissionStatus } from '../../entities/permission.entity';
import { RolePermission } from '../../entities/role-permission.entity';
import type {
  CreatePermissionTemplateDto,
  UpdatePermissionTemplateDto,
  PermissionTemplateQueryDto,
  PermissionTemplateInfoDto,
  TemplatePreviewDto,
} from '@ai-platform/shared';

@Injectable()
export class PermissionTemplateService {
  constructor(
    @InjectRepository(PermissionTemplate)
    private readonly templateRepository: Repository<PermissionTemplate>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
  ) {}

  /**
   * 获取权限模板列表
   */
  async findAll(query: PermissionTemplateQueryDto) {
    const { page = 1, pageSize = 20, code, name } = query;

    const queryBuilder = this.templateRepository.createQueryBuilder('template');

    if (code) {
      queryBuilder.andWhere('template.code LIKE :code', { code: `%${code}%` });
    }

    if (name) {
      queryBuilder.andWhere('template.name LIKE :name', { name: `%${name}%` });
    }

    queryBuilder
      .orderBy('template.isSystem', 'DESC')
      .addOrderBy('template.createdAt', 'DESC');

    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);

    const [list, total] = await queryBuilder.getManyAndCount();

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
    const template = await this.templateRepository.findOne({
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
    const template = await this.templateRepository.findOne({
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
    const existing = await this.templateRepository.findOne({
      where: { code: createDto.code },
    });

    if (existing) {
      throw new ConflictException(`模板编码 ${createDto.code} 已存在`);
    }

    const template = this.templateRepository.create({
      code: createDto.code,
      name: createDto.name,
      description: createDto.description,
      permissionPatterns: createDto.permissionPatterns,
      isSystem: false,
    });

    const savedTemplate = await this.templateRepository.save(template);
    return this.formatTemplateInfo(savedTemplate);
  }

  /**
   * 更新权限模板
   */
  async update(id: string, updateDto: UpdatePermissionTemplateDto) {
    const template = await this.templateRepository.findOne({ where: { id } });

    if (!template) {
      throw new NotFoundException(`权限模板 #${id} 不存在`);
    }

    if (template.isSystem) {
      throw new BadRequestException('系统模板不允许修改');
    }

    Object.assign(template, updateDto);
    const updatedTemplate = await this.templateRepository.save(template);
    return this.formatTemplateInfo(updatedTemplate);
  }

  /**
   * 删除权限模板
   */
  async remove(id: string) {
    const template = await this.templateRepository.findOne({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(`权限模板 #${id} 不存在`);
    }

    if (template.isSystem) {
      throw new BadRequestException('系统模板不允许删除');
    }

    await this.templateRepository.remove(template);

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
    const template = await this.templateRepository.findOne({
      where: { code: templateCode },
    });

    if (!template) {
      throw new NotFoundException(`权限模板 ${templateCode} 不存在`);
    }

    // 展开模板中的通配符
    const permissionCodes = await this.expandPatterns(
      template.permissionPatterns,
      modules,
    );

    // 获取权限实体
    const permissions = await this.permissionRepository.find({
      where: {
        code: In(permissionCodes),
        status: PermissionStatus.ACTIVE,
      },
    });

    if (permissions.length === 0) {
      return { message: '没有匹配的权限' };
    }

    // 获取角色现有权限
    const existingRolePermissions = await this.rolePermissionRepository.find({
      where: { roleId },
    });
    const existingPermissionIds = new Set(
      existingRolePermissions.map((rp) => rp.permissionId),
    );

    // 过滤出需要新增的权限
    const newPermissions = permissions.filter(
      (p) => !existingPermissionIds.has(p.id),
    );

    // 分配给角色
    if (newPermissions.length > 0) {
      const rolePermissions = newPermissions.map((p) =>
        this.rolePermissionRepository.create({
          roleId,
          permissionId: p.id,
        }),
      );
      await this.rolePermissionRepository.save(rolePermissions);
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
    const menuPermissions = await this.permissionRepository.find({
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
    const permissions = await this.permissionRepository.find({
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
  private formatTemplateInfo(
    template: PermissionTemplate,
  ): PermissionTemplateInfoDto {
    return {
      id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      permissionPatterns: template.permissionPatterns,
      isSystem: template.isSystem,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}
