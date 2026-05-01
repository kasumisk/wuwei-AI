import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { I18nService } from '../../../core/i18n/i18n.service';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  async findAll(query: PermissionTemplateQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    const { code, name } = query;

    const where: any = {};
    if (code) where.code = { contains: code };
    if (name) where.name = { contains: name };

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.permissionTemplates.findMany({
        where,
        orderBy: [{ isSystem: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.permissionTemplates.count({ where }),
    ]);

    return {
      list: list.map((t) => this.formatTemplateInfo(t)),
      total,
      page,
      pageSize,
    };
  }

  async findOne(id: string) {
    const template = await this.prisma.permissionTemplates.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(
        this.i18n.t('rbac.template.notFound', { id }),
      );
    }

    return this.formatTemplateInfo(template);
  }

  async findByCode(code: string) {
    const template = await this.prisma.permissionTemplates.findFirst({
      where: { code },
    });

    if (!template) {
      throw new NotFoundException(
        this.i18n.t('rbac.template.codeNotFound', { code }),
      );
    }

    return this.formatTemplateInfo(template);
  }

  async create(createDto: CreatePermissionTemplateDto) {
    const existing = await this.prisma.permissionTemplates.findFirst({
      where: { code: createDto.code },
    });

    if (existing) {
      throw new ConflictException(
        this.i18n.t('rbac.template.codeExists', { code: createDto.code }),
      );
    }

    const savedTemplate = await this.prisma.permissionTemplates.create({
      data: {
        code: createDto.code,
        name: createDto.name,
        description: createDto.description,
        permissionPatterns: createDto.permissionPatterns.join(','),
        isSystem: false,
      },
    });

    return this.formatTemplateInfo(savedTemplate);
  }

  async update(id: string, updateDto: UpdatePermissionTemplateDto) {
    const template = await this.prisma.permissionTemplates.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(
        this.i18n.t('rbac.template.notFound', { id }),
      );
    }

    if (template.isSystem) {
      throw new BadRequestException(
        this.i18n.t('rbac.template.systemTemplateNoModify'),
      );
    }

    const data: any = { ...updateDto };
    if (data.permissionPatterns) {
      data.permissionPatterns = Array.isArray(data.permissionPatterns)
        ? data.permissionPatterns.join(',')
        : data.permissionPatterns;
      delete data.permissionPatterns;
    }

    const updatedTemplate = await this.prisma.permissionTemplates.update({
      where: { id },
      data,
    });

    return this.formatTemplateInfo(updatedTemplate);
  }

  async remove(id: string) {
    const template = await this.prisma.permissionTemplates.findUnique({
      where: { id },
    });

    if (!template) {
      throw new NotFoundException(
        this.i18n.t('rbac.template.notFound', { id }),
      );
    }

    if (template.isSystem) {
      throw new BadRequestException(
        this.i18n.t('rbac.template.systemTemplateNoDelete'),
      );
    }

    await this.prisma.permissionTemplates.delete({ where: { id } });

    return { message: this.i18n.t('rbac.template.deleteSuccess') };
  }

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

  async applyToRole(roleId: string, templateCode: string, modules?: string[]) {
    const template = await this.prisma.permissionTemplates.findFirst({
      where: { code: templateCode },
    });

    if (!template) {
      throw new NotFoundException(
        this.i18n.t('rbac.template.codeNotFound', { code: templateCode }),
      );
    }

    const permissionPatterns =
      typeof template.permissionPatterns === 'string'
        ? template.permissionPatterns.split(',').filter(Boolean)
        : template.permissionPatterns;

    const permissionCodes = await this.expandPatterns(
      permissionPatterns,
      modules,
    );

    const permissions = await this.prisma.permissions.findMany({
      where: {
        code: { in: permissionCodes },
        status: PermissionStatus.ACTIVE,
      },
    });

    if (permissions.length === 0) {
      return { message: this.i18n.t('rbac.template.noMatchingPermission') };
    }

    const existingRolePermissions = await this.prisma.rolePermissions.findMany({
      where: { roleId },
    });
    const existingPermissionIds = new Set(
      existingRolePermissions.map((rp) => rp.permissionId),
    );

    const newPermissions = permissions.filter(
      (p) => !existingPermissionIds.has(p.id),
    );

    if (newPermissions.length > 0) {
      await Promise.all(
        newPermissions.map((p) =>
          this.prisma.rolePermissions.create({
            data: { roleId, permissionId: p.id },
          }),
        ),
      );
    }

    return {
      message: this.i18n.t('rbac.template.applySuccess'),
      addedCount: newPermissions.length,
    };
  }

  async expandPatterns(patterns: string[], modules?: string[]) {
    if (!modules || modules.length === 0) {
      modules = await this.getAllModules();
    }

    const result: string[] = [];

    for (const pattern of patterns) {
      if (pattern.startsWith('*:')) {
        const action = pattern.slice(2);
        modules.forEach((m) => result.push(`${m}:${action}`));
      } else if (pattern.endsWith(':*')) {
        const module = pattern.slice(0, -2);
        const actions = await this.getModuleActions(module);
        actions.forEach((a) => result.push(`${module}:${a}`));
      } else {
        result.push(pattern);
      }
    }

    return [...new Set(result)];
  }

  private async getAllModules(): Promise<string[]> {
    const menuPermissions = await this.prisma.permissions.findMany({
      where: { type: 'menu' as any, status: PermissionStatus.ACTIVE },
    });
    return menuPermissions
      .filter((p) => !p.code.includes(':'))
      .map((p) => p.code);
  }

  private async getModuleActions(module: string): Promise<string[]> {
    const permissions = await this.prisma.permissions.findMany({
      where: { status: PermissionStatus.ACTIVE },
    });
    return permissions
      .filter(
        (p) =>
          p.code.startsWith(`${module}:`) && p.code.split(':').length === 2,
      )
      .map((p) => p.code.split(':')[1]);
  }

  private formatTemplateInfo(template: any): PermissionTemplateInfoDto {
    return {
      id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      permissionPatterns:
        typeof template.permissionPatterns === 'string'
          ? template.permissionPatterns.split(',').filter(Boolean)
          : template.permissionPatterns,
      isSystem: template.isSystem,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }
}
