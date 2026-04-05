import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ModelConfig } from '../../entities/model-config.entity';
import { Provider } from '../../entities/provider.entity';
import {
  CreateModelDto,
  UpdateModelDto,
  GetModelsQueryDto,
  TestModelDto,
} from '../dto/model-management.dto';
import { ModelStatus } from '@ai-platform/shared';

@Injectable()
export class ModelService {
  constructor(
    @InjectRepository(ModelConfig)
    private readonly modelRepository: Repository<ModelConfig>,
    @InjectRepository(Provider)
    private readonly providerRepository: Repository<Provider>,
  ) {}

  /**
   * 获取模型列表（分页）
   */
  async findAll(query: GetModelsQueryDto) {
    const {
      page = 1,
      pageSize = 10,
      keyword,
      providerId,
      capabilityType,
      status,
    } = query;

    const queryBuilder = this.modelRepository
      .createQueryBuilder('model')
      .leftJoinAndSelect('model.provider', 'provider');

    // 搜索条件
    if (keyword) {
      queryBuilder.andWhere(
        '(model.modelName LIKE :keyword OR model.displayName LIKE :keyword)',
        { keyword: `%${keyword}%` },
      );
    }

    // 筛选条件
    if (providerId) {
      queryBuilder.andWhere('model.providerId = :providerId', { providerId });
    }

    if (capabilityType) {
      queryBuilder.andWhere('model.capabilityType = :capabilityType', {
        capabilityType,
      });
    }

    if (status) {
      queryBuilder.andWhere('model.status = :status', { status });
    }

    // 排序：先按优先级升序，再按创建时间降序
    queryBuilder.orderBy('model.priority', 'ASC');
    queryBuilder.addOrderBy('model.createdAt', 'DESC');

    // 分页
    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);

    const [list, total] = await queryBuilder.getManyAndCount();

    // 转换数据格式
    const formattedList = list.map((model) => ({
      id: model.id,
      providerId: model.providerId,
      providerName: model.provider?.name || 'Unknown',
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
    const model = await this.modelRepository.findOne({
      where: { id },
      relations: ['provider'],
    });

    if (!model) {
      throw new NotFoundException(`模型 #${id} 不存在`);
    }

    return {
      id: model.id,
      providerId: model.providerId,
      providerName: model.provider?.name || 'Unknown',
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
    const provider = await this.providerRepository.findOne({
      where: { id: createModelDto.providerId },
    });

    if (!provider) {
      throw new NotFoundException(
        `提供商 #${createModelDto.providerId} 不存在`,
      );
    }

    // 检查是否已存在相同的模型配置
    const existing = await this.modelRepository.findOne({
      where: {
        providerId: createModelDto.providerId,
        modelName: createModelDto.modelName,
        capabilityType: createModelDto.capabilityType,
      },
    });

    if (existing) {
      throw new ConflictException(
        `模型配置已存在: ${createModelDto.modelName} (${createModelDto.capabilityType})`,
      );
    }

    // 创建模型实体
    const model = this.modelRepository.create({
      providerId: createModelDto.providerId,
      modelName: createModelDto.modelName,
      displayName: createModelDto.displayName,
      capabilityType: createModelDto.capabilityType,
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
    });

    const savedModel = await this.modelRepository.save(model);

    return this.findOne(savedModel.id);
  }

  /**
   * 更新模型
   */
  async update(id: string, updateModelDto: UpdateModelDto) {
    const model = await this.modelRepository.findOne({
      where: { id },
    });

    if (!model) {
      throw new NotFoundException(`模型 #${id} 不存在`);
    }

    // 更新基本字段
    if (updateModelDto.displayName !== undefined) {
      model.displayName = updateModelDto.displayName;
    }
    if (updateModelDto.enabled !== undefined) {
      model.enabled = updateModelDto.enabled;
    }
    if (updateModelDto.priority !== undefined) {
      model.priority = updateModelDto.priority;
    }

    // 更新定价
    if (updateModelDto.pricing) {
      if (updateModelDto.pricing.inputCostPer1kTokens !== undefined) {
        model.inputCostPer1kTokens =
          updateModelDto.pricing.inputCostPer1kTokens;
      }
      if (updateModelDto.pricing.outputCostPer1kTokens !== undefined) {
        model.outputCostPer1kTokens =
          updateModelDto.pricing.outputCostPer1kTokens;
      }
      if (updateModelDto.pricing.currency !== undefined) {
        model.currency = updateModelDto.pricing.currency;
      }
    }

    // 更新限制
    if (updateModelDto.limits) {
      if (updateModelDto.limits.maxTokens !== undefined) {
        model.maxTokens = updateModelDto.limits.maxTokens;
      }
      if (updateModelDto.limits.maxRequestsPerMinute !== undefined) {
        model.maxRequestsPerMinute = updateModelDto.limits.maxRequestsPerMinute;
      }
      if (updateModelDto.limits.contextWindow !== undefined) {
        model.contextWindow = updateModelDto.limits.contextWindow;
      }
    }

    // 更新功能
    if (updateModelDto.features) {
      if (updateModelDto.features.streaming !== undefined) {
        model.streaming = updateModelDto.features.streaming;
      }
      if (updateModelDto.features.functionCalling !== undefined) {
        model.functionCalling = updateModelDto.features.functionCalling;
      }
      if (updateModelDto.features.vision !== undefined) {
        model.vision = updateModelDto.features.vision;
      }
    }

    // 更新配置覆盖
    if (updateModelDto.configOverride) {
      if (updateModelDto.configOverride.endpoint !== undefined) {
        model.endpoint = updateModelDto.configOverride.endpoint;
      }
      if (updateModelDto.configOverride.customApiKey !== undefined) {
        model.customApiKey = updateModelDto.configOverride.customApiKey;
      }
      if (updateModelDto.configOverride.customTimeout !== undefined) {
        model.customTimeout = updateModelDto.configOverride.customTimeout;
      }
      if (updateModelDto.configOverride.customRetries !== undefined) {
        model.customRetries = updateModelDto.configOverride.customRetries;
      }
      if (updateModelDto.configOverride.configMetadata !== undefined) {
        model.configMetadata = {
          ...model.configMetadata,
          ...updateModelDto.configOverride.configMetadata,
        };
      }
    }

    // 更新元数据
    if (updateModelDto.metadata) {
      model.metadata = {
        ...model.metadata,
        ...updateModelDto.metadata,
      };
    }

    await this.modelRepository.save(model);

    return this.findOne(id);
  }

  /**
   * 删除模型
   */
  async remove(id: string) {
    const model = await this.modelRepository.findOne({
      where: { id },
    });

    if (!model) {
      throw new NotFoundException(`模型 #${id} 不存在`);
    }

    // TODO: 检查是否有关联的使用记录或权限配置

    await this.modelRepository.remove(model);

    return { message: '模型删除成功' };
  }

  /**
   * 测试模型
   */
  async test(testDto: TestModelDto) {
    const model = await this.modelRepository.findOne({
      where: { id: testDto.modelId },
      relations: ['provider'],
    });

    if (!model) {
      throw new NotFoundException(`模型 #${testDto.modelId} 不存在`);
    }

    if (!model.enabled) {
      return {
        success: false,
        error: '该模型未启用',
      };
    }

    if (!model.provider || !model.provider.enabled) {
      return {
        success: false,
        error: '该模型的提供商未启用',
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
          message: '测试成功（模拟）',
          modelName: model.modelName,
          capabilityType: model.capabilityType,
        },
        latency,
        usage,
      };
    } catch (error) {
      return {
        success: false,
        error: error.message || '测试失败',
      };
    }
  }

  /**
   * 按提供商获取模型
   */
  async findByProvider(providerId: string) {
    const models = await this.modelRepository.find({
      where: { providerId },
      order: { priority: 'ASC', createdAt: 'DESC' },
    });

    return models;
  }

  /**
   * 按能力类型获取可用模型
   */
  async findByCapabilityType(capabilityType: string) {
    const models = await this.modelRepository.find({
      where: {
        capabilityType: capabilityType as any,
        enabled: true,
      },
      relations: ['provider'],
      order: { priority: 'ASC' },
    });

    // 过滤掉提供商未启用的模型
    return models.filter((model) => model.provider && model.provider.enabled);
  }
}
