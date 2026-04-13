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
      await this.prisma.clientCapabilityPermissions.findMany({
        where: { clientId: clientId },
        orderBy: { createdAt: 'desc' },
      });

    return permissions;
  }

  /**
   * 获取权限详情
   */
  async findOne(permissionId: string) {
    const permission =
      await this.prisma.clientCapabilityPermissions.findUnique({
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
    const existing = await this.prisma.clientCapabilityPermissions.findFirst({
      where: {
        clientId: createPermissionDto.clientId,
        capabilityType: createPermissionDto.capabilityType,
      },
    });

    if (existing) {
      throw new ConflictException(
        `客户端 ${createPermissionDto.clientId} 已有 ${createPermissionDto.capabilityType} 权限`,
      );
    }

    return await this.prisma.clientCapabilityPermissions.create({
      data: {
        clientId: createPermissionDto.clientId,
        capabilityType: createPermissionDto.capabilityType,
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
  }

  /**
   * 更新权限
   */
  async update(permissionId: string, updatePermissionDto: UpdatePermissionDto) {
    const permission =
      await this.prisma.clientCapabilityPermissions.findUnique({
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

    return await this.prisma.clientCapabilityPermissions.update({
      where: { id: permissionId },
      data: updateData,
    });
  }

  /**
   * 删除权限
   */
  async remove(permissionId: string) {
    const permission =
      await this.prisma.clientCapabilityPermissions.findUnique({
        where: { id: permissionId },
      });

    if (!permission) {
      throw new NotFoundException(`权限 #${permissionId} 不存在`);
    }

    await this.prisma.clientCapabilityPermissions.delete({
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
          await this.prisma.clientCapabilityPermissions.findFirst({
            where: {
              clientId: clientId,
              capabilityType: item.capabilityType,
            },
          });

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
            capabilityType: item.capabilityType,
            action: 'updated',
            success: true,
          });
        } else {
          // 创建新权限
          await this.prisma.clientCapabilityPermissions.create({
            data: {
              clientId: clientId,
              capabilityType: item.capabilityType,
              enabled: item.enabled,
              rateLimit: item.rateLimit || 60,
              quotaLimit: item.quotaLimit,
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
      await this.prisma.clientCapabilityPermissions.findFirst({
        where: {
          clientId: clientId,
          capabilityType: capabilityType,
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
      await this.prisma.clientCapabilityPermissions.findFirst({
        where: {
          clientId: clientId,
          capabilityType: capabilityType,
        },
      });

    return permission || null;
  }
}
