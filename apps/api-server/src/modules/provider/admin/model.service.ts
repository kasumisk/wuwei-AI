import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { I18nService } from '../../../core/i18n/i18n.service';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreateModelDto,
  UpdateModelDto,
  GetModelsQueryDto,
  TestModelDto,
} from './dto/model-management.dto';
import { ModelStatus } from '@ai-platform/shared';

@Injectable()
export class ModelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 获取模型列表（分页）
   */
  async findAll(query: GetModelsQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 10;
    const { keyword, providerId, capabilityType, status } = query;

    const where: any = {};

    // 搜索条件
    if (keyword) {
      where.OR = [
        { modelName: { contains: keyword } },
        { displayName: { contains: keyword } },
      ];
    }

    // 筛选条件
    if (providerId) {
      where.providerId = providerId;
    }

    if (capabilityType) {
      where.capabilityType = capabilityType;
    }

    if (status) {
      where.status = status;
    }

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.modelConfigs.findMany({
        where,
        include: { providers: true },
        orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: pageSize,
      }),
      this.prisma.modelConfigs.count({ where }),
    ]);

    // 转换数据格式
    const formattedList = list.map((model) => ({
      id: model.id,
      providerId: model.providerId,
      providerName: model.providers?.name || 'Unknown',
      modelName: model.modelName,
      displayName: model.displayName,
      capabilityType: model.capabilityType,
      enabled: model.enabled,
      priority: model.priority,
      status: model.status,
      pricing: {
        inputCostPer1kTokens: Number(model.inputCostPer1kTokens),
        outputCostPer1kTokens: Number(model.outputCostPer1kTokens),
        currency: model.currency,
      },
      limits: {
        maxTokens: model.maxTokens,
        maxRequestsPerMinute: model.maxRequestsPerMinute,
        contextWindow: model.contextWindow,
      },
      features: {
        streaming: model.streaming,
        functionCalling: model.functionCalling,
        vision: model.vision,
      },
      configOverride:
        model.endpoint ||
        model.customApiKey ||
        model.customTimeout ||
        model.customRetries
          ? {
              endpoint: model.endpoint,
              customApiKey: model.customApiKey ? '********' : undefined,
              customTimeout: model.customTimeout,
              customRetries: model.customRetries,
              configMetadata: model.configMetadata,
            }
          : undefined,
      metadata: model.metadata,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    }));

    return {
      list: formattedList,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 获取模型详情
   */
  async findOne(id: string) {
    const model = await this.prisma.modelConfigs.findUnique({
      where: { id },
      include: { providers: true },
    });

    if (!model) {
      throw new NotFoundException(
        this.i18n.t('provider.model.notFound', { id }),
      );
    }

    return {
      id: model.id,
      providerId: model.providerId,
      providerName: model.providers?.name || 'Unknown',
      modelName: model.modelName,
      displayName: model.displayName,
      capabilityType: model.capabilityType,
      enabled: model.enabled,
      priority: model.priority,
      status: model.status,
      pricing: {
        inputCostPer1kTokens: Number(model.inputCostPer1kTokens),
        outputCostPer1kTokens: Number(model.outputCostPer1kTokens),
        currency: model.currency,
      },
      limits: {
        maxTokens: model.maxTokens,
        maxRequestsPerMinute: model.maxRequestsPerMinute,
        contextWindow: model.contextWindow,
      },
      features: {
        streaming: model.streaming,
        functionCalling: model.functionCalling,
        vision: model.vision,
      },
      configOverride:
        model.endpoint ||
        model.customApiKey ||
        model.customTimeout ||
        model.customRetries
          ? {
              endpoint: model.endpoint,
              customApiKey: model.customApiKey ? '********' : undefined,
              customTimeout: model.customTimeout,
              customRetries: model.customRetries,
              configMetadata: model.configMetadata,
            }
          : undefined,
      metadata: model.metadata,
      createdAt: model.createdAt,
      updatedAt: model.updatedAt,
    };
  }

  /**
   * 创建模型
   */
  async create(createModelDto: CreateModelDto) {
    // 检查提供商是否存在
    const provider = await this.prisma.providers.findUnique({
      where: { id: createModelDto.providerId },
    });

    if (!provider) {
      throw new NotFoundException(
        this.i18n.t('provider.model.providerNotFound', {
          providerId: createModelDto.providerId,
        }),
      );
    }

    // 检查是否已存在相同的模型配置
    const existing = await this.prisma.modelConfigs.findFirst({
      where: {
        providerId: createModelDto.providerId,
        modelName: createModelDto.modelName,
        capabilityType: createModelDto.capabilityType as any,
      },
    });

    if (existing) {
      throw new ConflictException(
        this.i18n.t('provider.model.alreadyExists', {
          modelId: createModelDto.modelName,
          providerId: createModelDto.providerId,
        }),
      );
    }

    // 创建模型实体
    const savedModel = await this.prisma.modelConfigs.create({
      data: {
        providerId: createModelDto.providerId,
        modelName: createModelDto.modelName,
        displayName: createModelDto.displayName,
        capabilityType: createModelDto.capabilityType as any,
        enabled: createModelDto.enabled ?? true,
        priority: createModelDto.priority ?? 0,
        status: ModelStatus.ACTIVE,
        // 定价
        inputCostPer1kTokens: createModelDto.pricing.inputCostPer1kTokens,
        outputCostPer1kTokens: createModelDto.pricing.outputCostPer1kTokens,
        currency: createModelDto.pricing.currency,
        // 限制
        maxTokens: createModelDto.limits.maxTokens,
        maxRequestsPerMinute: createModelDto.limits.maxRequestsPerMinute,
        contextWindow: createModelDto.limits.contextWindow,
        // 功能
        streaming: createModelDto.features.streaming,
        functionCalling: createModelDto.features.functionCalling,
        vision: createModelDto.features.vision,
        // 配置覆盖
        endpoint: createModelDto.configOverride?.endpoint,
        customApiKey: createModelDto.configOverride?.customApiKey,
        customTimeout: createModelDto.configOverride?.customTimeout,
        customRetries: createModelDto.configOverride?.customRetries,
        configMetadata: createModelDto.configOverride?.configMetadata,
        // 元数据
        metadata: createModelDto.metadata,
      },
    });

    return this.findOne(savedModel.id);
  }

  /**
   * 更新模型
   */
  async update(id: string, updateModelDto: UpdateModelDto) {
    const model = await this.prisma.modelConfigs.findUnique({
      where: { id },
    });

    if (!model) {
      throw new NotFoundException(
        this.i18n.t('provider.model.notFound', { id }),
      );
    }

    // 构建更新数据
    const data: any = {};

    // 更新基本字段
    if (updateModelDto.displayName !== undefined) {
      data.displayName = updateModelDto.displayName;
    }
    if (updateModelDto.enabled !== undefined) {
      data.enabled = updateModelDto.enabled;
    }
    if (updateModelDto.priority !== undefined) {
      data.priority = updateModelDto.priority;
    }

    // 更新定价
    if (updateModelDto.pricing) {
      if (updateModelDto.pricing.inputCostPer1kTokens !== undefined) {
        data.inputCostPer1kTokens = updateModelDto.pricing.inputCostPer1kTokens;
      }
      if (updateModelDto.pricing.outputCostPer1kTokens !== undefined) {
        data.outputCostPer1kTokens =
          updateModelDto.pricing.outputCostPer1kTokens;
      }
      if (updateModelDto.pricing.currency !== undefined) {
        data.currency = updateModelDto.pricing.currency;
      }
    }

    // 更新限制
    if (updateModelDto.limits) {
      if (updateModelDto.limits.maxTokens !== undefined) {
        data.maxTokens = updateModelDto.limits.maxTokens;
      }
      if (updateModelDto.limits.maxRequestsPerMinute !== undefined) {
        data.maxRequestsPerMinute = updateModelDto.limits.maxRequestsPerMinute;
      }
      if (updateModelDto.limits.contextWindow !== undefined) {
        data.contextWindow = updateModelDto.limits.contextWindow;
      }
    }

    // 更新功能
    if (updateModelDto.features) {
      if (updateModelDto.features.streaming !== undefined) {
        data.streaming = updateModelDto.features.streaming;
      }
      if (updateModelDto.features.functionCalling !== undefined) {
        data.functionCalling = updateModelDto.features.functionCalling;
      }
      if (updateModelDto.features.vision !== undefined) {
        data.vision = updateModelDto.features.vision;
      }
    }

    // 更新配置覆盖
    if (updateModelDto.configOverride) {
      if (updateModelDto.configOverride.endpoint !== undefined) {
        data.endpoint = updateModelDto.configOverride.endpoint;
      }
      if (updateModelDto.configOverride.customApiKey !== undefined) {
        data.customApiKey = updateModelDto.configOverride.customApiKey;
      }
      if (updateModelDto.configOverride.customTimeout !== undefined) {
        data.customTimeout = updateModelDto.configOverride.customTimeout;
      }
      if (updateModelDto.configOverride.customRetries !== undefined) {
        data.customRetries = updateModelDto.configOverride.customRetries;
      }
      if (updateModelDto.configOverride.configMetadata !== undefined) {
        data.configMetadata = {
          ...(model.configMetadata as any),
          ...updateModelDto.configOverride.configMetadata,
        };
      }
    }

    // 更新元数据
    if (updateModelDto.metadata) {
      data.metadata = {
        ...(model.metadata as any),
        ...updateModelDto.metadata,
      };
    }

    await this.prisma.modelConfigs.update({
      where: { id },
      data,
    });

    return this.findOne(id);
  }

  /**
   * 删除模型
   */
  async remove(id: string) {
    const model = await this.prisma.modelConfigs.findUnique({
      where: { id },
    });

    if (!model) {
      throw new NotFoundException(
        this.i18n.t('provider.model.notFound', { id }),
      );
    }

    // TODO: 检查是否有关联的使用记录或权限配置

    await this.prisma.modelConfigs.delete({ where: { id } });

    return { message: this.i18n.t('provider.model.deleteSuccess') };
  }

  /**
   * 测试模型
   */
  async test(testDto: TestModelDto) {
    const model = await this.prisma.modelConfigs.findUnique({
      where: { id: testDto.modelId },
      include: { providers: true },
    });

    if (!model) {
      throw new NotFoundException(
        this.i18n.t('provider.model.notFound', { id: testDto.modelId }),
      );
    }

    if (!model.enabled) {
      return {
        success: false,
        error: this.i18n.t('provider.model.notEnabled'),
      };
    }

    if (!model.providers || !model.providers.enabled) {
      return {
        success: false,
        error: this.i18n.t('provider.model.providerNotEnabledForModel'),
      };
    }

    try {
      const startTime = Date.now();

      // TODO: 实际调用模型 API 进行测试
      // 根据 capabilityType 调用不同的测试逻辑
      await new Promise((resolve) => setTimeout(resolve, 200)); // 模拟 API 调用

      const latency = Date.now() - startTime;

      // 模拟使用量
      const usage = {
        inputTokens: 10,
        outputTokens: 20,
        cost:
          (10 * Number(model.inputCostPer1kTokens)) / 1000 +
          (20 * Number(model.outputCostPer1kTokens)) / 1000,
      };

      return {
        success: true,
        output: {
          message: this.i18n.t('provider.model.testSuccess'),
          modelName: model.modelName,
          capabilityType: model.capabilityType,
        },
        latency,
        usage,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || this.i18n.t('provider.model.testFailed'),
      };
    }
  }

  /**
   * 按提供商获取模型
   */
  async findByProvider(providerId: string) {
    const models = await this.prisma.modelConfigs.findMany({
      where: { providerId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }],
    });

    return models;
  }

  /**
   * 按能力类型获取可用模型
   */
  async findByCapabilityType(capabilityType: string) {
    const models = await this.prisma.modelConfigs.findMany({
      where: {
        capabilityType: capabilityType as any,
        enabled: true,
      },
      include: { providers: true },
      orderBy: { priority: 'asc' },
    });

    // 过滤掉提供商未启用的模型
    return models.filter((model) => model.providers && model.providers.enabled);
  }
}
