import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreatePermissionDto,
  UpdatePermissionDto,
  BatchUpdatePermissionsDto,
  CapabilityType,
} from '@ai-platform/shared';

@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取客户端的所有权限
   */
  async findByClient(clientId: string) {
    // 检查客户端是否存在
    const client = await this.prisma.clients.findUnique({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException(`客户端 #${clientId} 不存在`);
    }

    const permissions =
      await this.prisma.client_capability_permissions.findMany({
        where: { client_id: clientId },
        orderBy: { created_at: 'desc' },
      });

    return permissions;
  }

  /**
   * 获取权限详情
   */
  async findOne(permissionId: string) {
    const permission =
      await this.prisma.client_capability_permissions.findUnique({
        where: { id: permissionId },
      });

    if (!permission) {
      throw new NotFoundException(`权限 #${permissionId} 不存在`);
    }

    return permission;
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
        `客户端 #${createPermissionDto.clientId} 不存在`,
      );
    }

    // 检查是否已存在相同的权限
    const existing = await this.prisma.client_capability_permissions.findFirst({
      where: {
        client_id: createPermissionDto.clientId,
        capability_type: createPermissionDto.capabilityType,
      },
    });

    if (existing) {
      throw new ConflictException(
        `客户端 ${createPermissionDto.clientId} 已有 ${createPermissionDto.capabilityType} 权限`,
      );
    }

    return await this.prisma.client_capability_permissions.create({
      data: {
        client_id: createPermissionDto.clientId,
        capability_type: createPermissionDto.capabilityType,
        enabled: createPermissionDto.enabled,
        rate_limit: createPermissionDto.rateLimit,
        quota_limit: createPermissionDto.quotaLimit,
        preferred_provider: createPermissionDto.preferredProvider,
        allowed_providers:
          createPermissionDto.allowedProviders?.join(',') ?? null,
        allowed_models: createPermissionDto.allowedModels?.join(',') ?? null,
        config: createPermissionDto.config,
      },
    });
  }

  /**
   * 更新权限
   */
  async update(permissionId: string, updatePermissionDto: UpdatePermissionDto) {
    const permission =
      await this.prisma.client_capability_permissions.findUnique({
        where: { id: permissionId },
      });

    if (!permission) {
      throw new NotFoundException(`权限 #${permissionId} 不存在`);
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
      updateData.rate_limit = updatePermissionDto.rateLimit;
    }
    if (updatePermissionDto.quotaLimit !== undefined) {
      updateData.quota_limit = updatePermissionDto.quotaLimit;
    }
    if (updatePermissionDto.preferredProvider !== undefined) {
      updateData.preferred_provider = updatePermissionDto.preferredProvider;
    }
    if (updatePermissionDto.allowedProviders !== undefined) {
      updateData.allowed_providers =
        updatePermissionDto.allowedProviders?.join(',') ?? null;
    }
    if (updatePermissionDto.allowedModels !== undefined) {
      updateData.allowed_models =
        updatePermissionDto.allowedModels?.join(',') ?? null;
    }

    return await this.prisma.client_capability_permissions.update({
      where: { id: permissionId },
      data: updateData,
    });
  }

  /**
   * 删除权限
   */
  async remove(permissionId: string) {
    const permission =
      await this.prisma.client_capability_permissions.findUnique({
        where: { id: permissionId },
      });

    if (!permission) {
      throw new NotFoundException(`权限 #${permissionId} 不存在`);
    }

    await this.prisma.client_capability_permissions.delete({
      where: { id: permissionId },
    });

    return { message: '权限删除成功' };
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
      throw new NotFoundException(`客户端 #${clientId} 不存在`);
    }

    const results: Array<{
      capabilityType: CapabilityType;
      action: string;
      success: boolean;
      error?: string;
    }> = [];

    for (const item of batchDto.permissions) {
      try {
        // 查找现有权限
        const permission =
          await this.prisma.client_capability_permissions.findFirst({
            where: {
              client_id: clientId,
              capability_type: item.capabilityType,
            },
          });

        if (permission) {
          // 更新现有权限
          const updateData: any = { enabled: item.enabled };
          if (item.rateLimit !== undefined) {
            updateData.rate_limit = item.rateLimit;
          }
          if (item.quotaLimit !== undefined) {
            updateData.quota_limit = item.quotaLimit;
          }
          await this.prisma.client_capability_permissions.update({
            where: { id: permission.id },
            data: updateData,
          });
          results.push({
            capabilityType: item.capabilityType,
            action: 'updated',
            success: true,
          });
        } else {
          // 创建新权限
          await this.prisma.client_capability_permissions.create({
            data: {
              client_id: clientId,
              capability_type: item.capabilityType,
              enabled: item.enabled,
              rate_limit: item.rateLimit || 60,
              quota_limit: item.quotaLimit,
            },
          });
          results.push({
            capabilityType: item.capabilityType,
            action: 'created',
            success: true,
          });
        }
      } catch (error) {
        results.push({
          capabilityType: item.capabilityType,
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
    const permission =
      await this.prisma.client_capability_permissions.findFirst({
        where: {
          client_id: clientId,
          capability_type: capabilityType,
          enabled: true,
        },
      });

    return !!permission;
  }

  /**
   * 获取客户端的权限配置
   */
  async getPermissionConfig(clientId: string, capabilityType: string) {
    const permission =
      await this.prisma.client_capability_permissions.findFirst({
        where: {
          client_id: clientId,
          capability_type: capabilityType,
        },
      });

    return permission || null;
  }
}
