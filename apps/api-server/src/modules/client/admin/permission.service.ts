import {
  Injectable,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import {
  CreatePermissionDto,
  UpdatePermissionDto,
  BatchUpdatePermissionsDto,
  capabilityLookupValues,
  CapabilityType,
  normalizeCapabilityType,
} from '@ai-platform/shared';

@Injectable()
export class PermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 获取客户端的所有权限
   */
  async findByClient(clientId: string) {
    // 检查客户端是否存在
    const client = await this.prisma.clients.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException(
        this.i18n.t('client.clientPermission.clientNotFound', { clientId }),
      );
    }

    const permissions = await this.prisma.clientCapabilityPermissions.findMany({
      where: { clientId: clientId },
      orderBy: { createdAt: 'desc' },
    });

    return permissions.map((permission) => this.toPermissionInfo(permission));
  }

  /**
   * 获取权限详情
   */
  async findOne(permissionId: string) {
    const permission = await this.prisma.clientCapabilityPermissions.findUnique(
      {
        where: { id: permissionId },
      },
    );

    if (!permission) {
      throw new NotFoundException(
        this.i18n.t('client.clientPermission.permissionNotFound', {
          permissionId,
        }),
      );
    }

    return this.toPermissionInfo(permission);
  }

  /**
   * 创建权限
   */
  async create(createPermissionDto: CreatePermissionDto) {
    // 检查客户端是否存在
    const client = await this.prisma.clients.findUnique({
      where: { id: createPermissionDto.clientId },
    });

    if (!client) {
      throw new NotFoundException(
        this.i18n.t('client.clientPermission.clientNotFound', {
          clientId: createPermissionDto.clientId,
        }),
      );
    }

    const capabilityType = this.normalizeCapabilityType(
      createPermissionDto.capabilityType,
    );

    // 检查是否已存在相同的权限
    const existing = await this.prisma.clientCapabilityPermissions.findFirst({
      where: {
        clientId: createPermissionDto.clientId,
        capabilityType: { in: this.capabilityLookupValues(capabilityType) },
      },
    });

    if (existing) {
      throw new ConflictException(
        this.i18n.t('client.clientPermission.alreadyExists', {
          clientId: createPermissionDto.clientId,
          capability: capabilityType,
        }),
      );
    }

    const permission = await this.prisma.clientCapabilityPermissions.create({
      data: {
        clientId: createPermissionDto.clientId,
        capabilityType,
        enabled: createPermissionDto.enabled,
        rateLimit: createPermissionDto.rateLimit,
        quotaLimit: createPermissionDto.quotaLimit,
        preferredProvider: createPermissionDto.preferredProvider,
        allowedProviders:
          createPermissionDto.allowedProviders?.join(',') ?? null,
        allowedModels: createPermissionDto.allowedModels?.join(',') ?? null,
        config: createPermissionDto.config,
      },
    });
    return this.toPermissionInfo(permission);
  }

  /**
   * 更新权限
   */
  async update(permissionId: string, updatePermissionDto: UpdatePermissionDto) {
    const permission = await this.prisma.clientCapabilityPermissions.findUnique(
      {
        where: { id: permissionId },
      },
    );

    if (!permission) {
      throw new NotFoundException(
        this.i18n.t('client.clientPermission.permissionNotFound', {
          permissionId,
        }),
      );
    }

    const updateData: any = {};

    // 如果更新配置，合并配置对象
    if (updatePermissionDto.config) {
      updateData.config = {
        ...(permission.config as object),
        ...updatePermissionDto.config,
      };
    }

    // 更新其他字段
    if (updatePermissionDto.enabled !== undefined) {
      updateData.enabled = updatePermissionDto.enabled;
    }
    if (updatePermissionDto.rateLimit !== undefined) {
      updateData.rateLimit = updatePermissionDto.rateLimit;
    }
    if (updatePermissionDto.quotaLimit !== undefined) {
      updateData.quotaLimit = updatePermissionDto.quotaLimit;
    }
    if (updatePermissionDto.preferredProvider !== undefined) {
      updateData.preferredProvider = updatePermissionDto.preferredProvider;
    }
    if (updatePermissionDto.allowedProviders !== undefined) {
      updateData.allowedProviders =
        updatePermissionDto.allowedProviders?.join(',') ?? null;
    }
    if (updatePermissionDto.allowedModels !== undefined) {
      updateData.allowedModels =
        updatePermissionDto.allowedModels?.join(',') ?? null;
    }

    const updated = await this.prisma.clientCapabilityPermissions.update({
      where: { id: permissionId },
      data: updateData,
    });
    return this.toPermissionInfo(updated);
  }

  /**
   * 删除权限
   */
  async remove(permissionId: string) {
    const permission = await this.prisma.clientCapabilityPermissions.findUnique(
      {
        where: { id: permissionId },
      },
    );

    if (!permission) {
      throw new NotFoundException(
        this.i18n.t('client.clientPermission.permissionNotFound', {
          permissionId,
        }),
      );
    }

    await this.prisma.clientCapabilityPermissions.delete({
      where: { id: permissionId },
    });

    return { message: this.i18n.t('client.clientPermission.revokeSuccess') };
  }

  /**
   * 批量更新权限
   */
  async batchUpdate(clientId: string, batchDto: BatchUpdatePermissionsDto) {
    // 检查客户端是否存在
    const client = await this.prisma.clients.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException(
        this.i18n.t('client.clientPermission.clientNotFound', { clientId }),
      );
    }

    const results: Array<{
      capabilityType: CapabilityType;
      action: string;
      success: boolean;
      error?: string;
    }> = [];

    // P3-N1: 批量预加载该客户端的所有权限，避免循环内逐条 findFirst
    const existingPermissions =
      await this.prisma.clientCapabilityPermissions.findMany({
        where: { clientId },
      });
    const permissionMap = new Map(
      existingPermissions.map((p) => [
        this.normalizeCapabilityType(p.capabilityType),
        p,
      ]),
    );

    for (const item of batchDto.permissions) {
      try {
        const capabilityType = this.normalizeCapabilityType(
          item.capabilityType,
        ) as CapabilityType;
        // 查找现有权限（内存查找，无 DB 查询）
        const permission = permissionMap.get(capabilityType);

        if (permission) {
          // 更新现有权限
          const updateData: any = { enabled: item.enabled };
          if (item.rateLimit !== undefined) {
            updateData.rateLimit = item.rateLimit;
          }
          if (item.quotaLimit !== undefined) {
            updateData.quotaLimit = item.quotaLimit;
          }
          await this.prisma.clientCapabilityPermissions.update({
            where: { id: permission.id },
            data: updateData,
          });
          results.push({
            capabilityType,
            action: 'updated',
            success: true,
          });
        } else {
          // 创建新权限
          await this.prisma.clientCapabilityPermissions.create({
            data: {
              clientId: clientId,
              capabilityType,
              enabled: item.enabled,
              rateLimit: item.rateLimit || 60,
              quotaLimit: item.quotaLimit,
            },
          });
          results.push({
            capabilityType,
            action: 'created',
            success: true,
          });
        }
      } catch (error) {
        results.push({
          capabilityType: this.normalizeCapabilityType(
            item.capabilityType,
          ) as CapabilityType,
          action: 'failed',
          success: false,
          error: error.message,
        });
      }
    }

    return {
      total: batchDto.permissions.length,
      success: results.filter((r) => r.success).length,
      failed: results.filter((r) => !r.success).length,
      details: results,
    };
  }

  /**
   * 检查客户端是否有某个能力的权限
   */
  async hasPermission(
    clientId: string,
    capabilityType: string,
  ): Promise<boolean> {
    const normalizedCapabilityType =
      this.normalizeCapabilityType(capabilityType);
    const permission = await this.prisma.clientCapabilityPermissions.findFirst({
      where: {
        clientId: clientId,
        capabilityType: {
          in: this.capabilityLookupValues(normalizedCapabilityType),
        },
        enabled: true,
      },
    });

    return !!permission;
  }

  /**
   * 获取客户端的权限配置
   */
  async getPermissionConfig(clientId: string, capabilityType: string) {
    const normalizedCapabilityType =
      this.normalizeCapabilityType(capabilityType);
    const permission = await this.prisma.clientCapabilityPermissions.findFirst({
      where: {
        clientId: clientId,
        capabilityType: {
          in: this.capabilityLookupValues(normalizedCapabilityType),
        },
      },
    });

    return permission ? this.toPermissionInfo(permission) : null;
  }

  private normalizeCapabilityType(value: string): string {
    return normalizeCapabilityType(value) || value;
  }

  private capabilityLookupValues(value: string): string[] {
    return capabilityLookupValues(value);
  }

  private parseCsvList(value?: string | null): string[] {
    if (!value) return [];
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private toPermissionInfo(permission: any) {
    return {
      ...permission,
      capabilityType: this.normalizeCapabilityType(permission.capabilityType),
      quotaLimit:
        typeof permission.quotaLimit === 'bigint'
          ? Number(permission.quotaLimit)
          : permission.quotaLimit,
      allowedProviders: this.parseCsvList(permission.allowedProviders),
      allowedModels: this.parseCsvList(permission.allowedModels),
    };
  }
}
