import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModelConfig } from '../../entities/model-config.entity';
import { Provider } from '../../entities/provider.entity';
import { ClientCapabilityPermission } from '../../entities/client-capability-permission.entity';

export interface RouteResult {
  modelConfig: ModelConfig;
  provider: Provider;
  model: string;
  endpoint: string;
  apiKey: string;
  config: any;
}

@Injectable()
export class CapabilityRouter {
  constructor(
    @InjectRepository(ModelConfig)
    private readonly modelRepository: Repository<ModelConfig>,
    @InjectRepository(Provider)
    private readonly providerRepository: Repository<Provider>,
    @InjectRepository(ClientCapabilityPermission)
    private readonly permissionRepository: Repository<ClientCapabilityPermission>,
  ) {}

  /**
   * 根据能力类型和客户端权限路由到最佳模型
   * @param clientId 客户端ID
   * @param capabilityType 能力类型
   * @param requestedModel 请求指定的模型（可选）
   */
  async route(
    clientId: string,
    capabilityType: string,
    requestedModel?: string,
  ): Promise<RouteResult> {
    // 获取客户端权限配置
    const permission = await this.permissionRepository.findOne({
      where: {
        clientId,
        capabilityType,
        enabled: true,
      },
    });

    let queryBuilder = this.modelRepository
      .createQueryBuilder('model')
      .leftJoinAndSelect('model.provider', 'provider')
      .where('model.capabilityType = :capabilityType', { capabilityType })
      .andWhere('model.enabled = :enabled', { enabled: true })
      .andWhere('provider.enabled = :providerEnabled', {
        providerEnabled: true,
      });

    // ✅ 新增：检查允许的提供商列表
    if (
      permission?.allowedProviders &&
      permission.allowedProviders.length > 0
    ) {
      const lowerProviders = permission.allowedProviders.map((p) =>
        p.toLowerCase(),
      );
      queryBuilder = queryBuilder.andWhere(
        'LOWER(provider.name) IN (:...providers)',
        {
          providers: lowerProviders,
        },
      );
    }

    // ✅ 新增：检查允许的模型列表
    if (permission?.allowedModels && permission.allowedModels.length > 0) {
      queryBuilder = queryBuilder.andWhere('model.modelName IN (:...models)', {
        models: permission.allowedModels,
      });
    }

    // ✅ 增强：如果请求指定了模型，验证是否在允许列表中
    if (requestedModel) {
      if (
        permission?.allowedModels &&
        permission.allowedModels.length > 0 &&
        !permission.allowedModels.includes(requestedModel)
      ) {
        throw new NotFoundException(`模型 ${requestedModel} 不在允许列表中`);
      }
      queryBuilder = queryBuilder.andWhere('model.modelName = :model', {
        model: requestedModel,
      });
    }

    // 如果客户端指定了首选提供商，提升其优先级
    if (permission?.preferredProvider) {
      queryBuilder = queryBuilder
        .addSelect(
          `CASE WHEN LOWER(provider.name) = :preferred THEN 0 ELSE 1 END`,
          'provider_priority',
        )
        .setParameter('preferred', permission.preferredProvider.toLowerCase())
        .orderBy('provider_priority', 'ASC');
    }

    // 按模型优先级排序（越小越优先）
    queryBuilder = queryBuilder.addOrderBy('model.priority', 'ASC');

    const models = await queryBuilder.getMany();

    if (!models || models.length === 0) {
      const hint = requestedModel
        ? `（请求的模型: ${requestedModel}）`
        : permission?.allowedModels?.length
          ? `（允许的模型: ${JSON.stringify(permission.allowedModels)}）`
          : '';
      throw new NotFoundException(
        `未找到可用的 ${capabilityType} 模型配置${hint}`,
      );
    }

    // 选择第一个（优先级最高的）
    const selected = models[0];
    const provider = selected.provider;

    // 使用模型的自定义配置，否则回退到 Provider 配置
    const endpoint = selected.endpoint || provider.baseUrl;
    const apiKey = selected.customApiKey || provider.apiKey;

    return {
      modelConfig: selected,
      provider: provider,
      model: selected.modelName,
      endpoint: endpoint,
      apiKey: apiKey,
      config: {
        timeout: selected.customTimeout || provider.timeout,
        retries: selected.customRetries || provider.retryCount,
        fallbackEnabled: permission?.config?.fallbackEnabled ?? true,
        ...selected.configMetadata,
      },
    };
  }

  /**
   * 故障切换 - 选择下一个可用的模型
   */
  async fallback(
    clientId: string,
    capabilityType: string,
    excludeProviderIds: string[],
  ): Promise<RouteResult | null> {
    const queryBuilder = this.modelRepository
      .createQueryBuilder('model')
      .leftJoinAndSelect('model.provider', 'provider')
      .where('model.capabilityType = :capabilityType', { capabilityType })
      .andWhere('model.enabled = :enabled', { enabled: true })
      .andWhere('provider.enabled = :providerEnabled', {
        providerEnabled: true,
      });

    // 排除已失败的提供商
    if (excludeProviderIds.length > 0) {
      queryBuilder.andWhere(
        'model.providerId NOT IN (:...excludeProviderIds)',
        {
          excludeProviderIds,
        },
      );
    }

    queryBuilder.orderBy('model.priority', 'ASC');

    const models = await queryBuilder.getMany();

    if (!models || models.length === 0) {
      return null;
    }

    const selected = models[0];
    const provider = selected.provider;

    const endpoint = selected.endpoint || provider.baseUrl;
    const apiKey = selected.customApiKey || provider.apiKey;

    return {
      modelConfig: selected,
      provider: provider,
      model: selected.modelName,
      endpoint: endpoint,
      apiKey: apiKey,
      config: {
        timeout: selected.customTimeout || provider.timeout,
        retries: selected.customRetries || provider.retryCount,
        ...selected.configMetadata,
      },
    };
  }
}
