import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ClientCapabilityPermission } from '../../entities/client-capability-permission.entity';
import { Client } from '../../entities/client.entity';
import {
  CreatePermissionDto,
  UpdatePermissionDto,
  BatchUpdatePermissionsDto,
  CapabilityType,
} from '@ai-platform/shared';

@Injectable()
export class PermissionService {
  constructor(
    @InjectRepository(ClientCapabilityPermission)
    private readonly permissionRepository: Repository<ClientCapabilityPermission>,
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
  ) {}

  /**
   * 获取客户端的所有权限
   */
  async findByClient(clientId: string) {
    // 检查客户端是否存在
    const client = await this.clientRepository.findOne({
      where: { id: clientId },
    });

    if (!client) {
      throw new NotFoundException(`客户端 #${clientId} 不存在`);
    }

    const permissions = await this.permissionRepository.find({
      where: { clientId },
      order: { createdAt: 'DESC' },
    });

    return permissions;
  }

  /**
   * 获取权限详情
   */
  async findOne(permissionId: string) {
    const permission = await this.permissionRepository.findOne({
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
    const client = await this.clientRepository.findOne({
      where: { id: createPermissionDto.clientId },
    });

    if (!client) {
      throw new NotFoundException(
        `客户端 #${createPermissionDto.clientId} 不存在`,
      );
    }

    // 检查是否已存在相同的权限
    const existing = await this.permissionRepository.findOne({
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

    const permission = this.permissionRepository.create(createPermissionDto);
    return await this.permissionRepository.save(permission);
  }

  /**
   * 更新权限
   */
  async update(permissionId: string, updatePermissionDto: UpdatePermissionDto) {
    const permission = await this.permissionRepository.findOne({
      where: { id: permissionId },
    });

    if (!permission) {
      throw new NotFoundException(`权限 #${permissionId} 不存在`);
    }

    // 如果更新配置，合并配置对象
    if (updatePermissionDto.config) {
      permission.config = {
        ...permission.config,
        ...updatePermissionDto.config,
      };
    }

    // 更新其他字段
    if (updatePermissionDto.enabled !== undefined) {
      permission.enabled = updatePermissionDto.enabled;
    }
    if (updatePermissionDto.rateLimit !== undefined) {
      permission.rateLimit = updatePermissionDto.rateLimit;
    }
    if (updatePermissionDto.quotaLimit !== undefined) {
      permission.quotaLimit = updatePermissionDto.quotaLimit;
    }
    if (updatePermissionDto.preferredProvider !== undefined) {
      permission.preferredProvider = updatePermissionDto.preferredProvider;
    }
    if (updatePermissionDto.allowedProviders !== undefined) {
      permission.allowedProviders = updatePermissionDto.allowedProviders;
    }
    if (updatePermissionDto.allowedModels !== undefined) {
      permission.allowedModels = updatePermissionDto.allowedModels;
    }

    return await this.permissionRepository.save(permission);
  }

  /**
   * 删除权限
   */
  async remove(permissionId: string) {
    const permission = await this.permissionRepository.findOne({
      where: { id: permissionId },
    });

    if (!permission) {
      throw new NotFoundException(`权限 #${permissionId} 不存在`);
    }

    await this.permissionRepository.remove(permission);

    return { message: '权限删除成功' };
  }

  /**
   * 批量更新权限
   */
  async batchUpdate(clientId: string, batchDto: BatchUpdatePermissionsDto) {
    // 检查客户端是否存在
    const client = await this.clientRepository.findOne({
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
        let permission = await this.permissionRepository.findOne({
          where: {
            clientId,
            capabilityType: item.capabilityType,
          },
        });

        if (permission) {
          // 更新现有权限
          permission.enabled = item.enabled;
          if (item.rateLimit !== undefined) {
            permission.rateLimit = item.rateLimit;
          }
          if (item.quotaLimit !== undefined) {
            permission.quotaLimit = item.quotaLimit;
          }
          await this.permissionRepository.save(permission);
          results.push({
            capabilityType: item.capabilityType,
            action: 'updated',
            success: true,
          });
        } else {
          // 创建新权限
          permission = this.permissionRepository.create({
            clientId,
            capabilityType: item.capabilityType,
            enabled: item.enabled,
            rateLimit: item.rateLimit || 60,
            quotaLimit: item.quotaLimit,
          });
          await this.permissionRepository.save(permission);
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
    const permission = await this.permissionRepository.findOne({
      where: {
        clientId,
        capabilityType,
        enabled: true,
      },
    });

    return !!permission;
  }

  /**
   * 获取客户端的权限配置
   */
  async getPermissionConfig(clientId: string, capabilityType: string) {
    const permission = await this.permissionRepository.findOne({
      where: {
        clientId,
        capabilityType,
      },
    });

    return permission || null;
  }
}
