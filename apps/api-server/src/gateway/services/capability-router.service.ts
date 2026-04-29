import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface RouteResult {
  modelConfig: any;
  provider: any;
  model: string;
  endpoint: string;
  apiKey: string;
  config: any;
}

@Injectable()
export class CapabilityRouter {
  constructor(private readonly prisma: PrismaService) {}

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
    const permission = await this.prisma.clientCapabilityPermissions.findFirst({
      where: {
        clientId: clientId,
        capabilityType: capabilityType,
        enabled: true,
      },
    });

    // ✅ 增强：如果请求指定了模型，验证是否在允许列表中
    if (requestedModel) {
      const allowedModelsList = permission?.allowedModels
        ? permission.allowedModels.split(',')
        : [];
      if (
        allowedModelsList.length > 0 &&
        !allowedModelsList.includes(requestedModel)
      ) {
        throw new NotFoundException(`模型 ${requestedModel} 不在允许列表中`);
      }
    }

    // Build where clause for model query
    const modelWhere: any = {
      capabilityType: capabilityType as any,
      enabled: true,
      providers: { enabled: true },
    };

    // ✅ 新增：检查允许的模型列表
    const allowedModels = permission?.allowedModels
      ? permission.allowedModels.split(',')
      : [];
    if (allowedModels.length > 0) {
      modelWhere.modelName = { in: allowedModels };
    }

    // 如果请求指定了模型
    if (requestedModel) {
      modelWhere.modelName = requestedModel;
    }

    let models = await this.prisma.modelConfigs.findMany({
      where: modelWhere,
      include: { providers: true },
      orderBy: { priority: 'asc' },
    });

    // ✅ 新增：检查允许的提供商列表（case-insensitive filtering in JS）
    const allowedProviders = permission?.allowedProviders
      ? permission.allowedProviders.split(',')
      : [];
    if (allowedProviders.length > 0) {
      const lowerProviders = allowedProviders.map((p) => p.toLowerCase());
      models = models.filter(
        (m) =>
          m.providers &&
          lowerProviders.includes(m.providers.name.toLowerCase()),
      );
    }

    // 如果客户端指定了首选提供商，提升其优先级（排序）
    if (permission?.preferredProvider) {
      const preferred = permission.preferredProvider.toLowerCase();
      models.sort((a, b) => {
        const aPriority =
          a.providers && a.providers.name.toLowerCase() === preferred ? 0 : 1;
        const bPriority =
          b.providers && b.providers.name.toLowerCase() === preferred ? 0 : 1;
        if (aPriority !== bPriority) return aPriority - bPriority;
        return a.priority - b.priority;
      });
    }

    if (!models || models.length === 0) {
      const hint = requestedModel
        ? `（请求的模型: ${requestedModel}）`
        : permission?.allowedModels &&
            permission.allowedModels.split(',').length
          ? `（允许的模型: ${JSON.stringify(permission.allowedModels.split(','))}）`
          : '';
      throw new NotFoundException(
        `未找到可用的 ${capabilityType} 模型配置${hint}`,
      );
    }

    // 选择第一个（优先级最高的）
    const selected = models[0];
    const provider = selected.providers;

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
        fallbackEnabled: (permission?.config as any)?.fallbackEnabled ?? true,
        ...((selected.configMetadata as object) || {}),
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
    const modelWhere: any = {
      capabilityType: capabilityType as any,
      enabled: true,
      providers: { enabled: true },
    };

    // 排除已失败的提供商
    if (excludeProviderIds.length > 0) {
      modelWhere.providerId = { notIn: excludeProviderIds };
    }

    const models = await this.prisma.modelConfigs.findMany({
      where: modelWhere,
      include: { providers: true },
      orderBy: { priority: 'asc' },
    });

    if (!models || models.length === 0) {
      return null;
    }

    const selected = models[0];
    const provider = selected.providers;

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
        ...((selected.configMetadata as object) || {}),
      },
    };
  }
}
