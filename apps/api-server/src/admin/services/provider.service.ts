import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Like } from 'typeorm';
import { Provider } from '../../entities/provider.entity';
import {
  CreateProviderDto,
  UpdateProviderDto,
  GetProvidersQueryDto,
  TestProviderDto,
} from '../dto/provider-management.dto';
import { ProviderStatus } from '@ai-platform/shared';

@Injectable()
export class ProviderService {
  constructor(
    @InjectRepository(Provider)
    private readonly providerRepository: Repository<Provider>,
  ) {}

  /**
   * 获取提供商列表（分页）
   */
  async findAll(query: GetProvidersQueryDto) {
    const { page = 1, pageSize = 10, keyword, type, status } = query;

    const queryBuilder = this.providerRepository.createQueryBuilder('provider');

    // 搜索条件
    if (keyword) {
      queryBuilder.andWhere('provider.name LIKE :keyword', {
        keyword: `%${keyword}%`,
      });
    }

    // 筛选条件
    if (type) {
      queryBuilder.andWhere('provider.type = :type', { type });
    }

    if (status) {
      queryBuilder.andWhere('provider.status = :status', { status });
    }

    // 排序：按创建时间降序
    queryBuilder.orderBy('provider.createdAt', 'DESC');

    // 分页
    const skip = (page - 1) * pageSize;
    queryBuilder.skip(skip).take(pageSize);

    const [list, total] = await queryBuilder.getManyAndCount();

    // 隐藏敏感信息（API Key）
    const sanitizedList = list.map((provider) => ({
      ...provider,
      apiKey: '********',
    }));

    return {
      list: sanitizedList,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 获取提供商详情
   */
  async findOne(id: string) {
    const provider = await this.providerRepository.findOne({
      where: { id },
    });

    if (!provider) {
      throw new NotFoundException(`提供商 #${id} 不存在`);
    }

    // 隐藏敏感信息
    return {
      ...provider,
      apiKey: '********',
    };
  }

  /**
   * 创建提供商
   */
  async create(createProviderDto: CreateProviderDto) {
    // 检查是否已存在相同名称的提供商
    const existing = await this.providerRepository.findOne({
      where: {
        name: createProviderDto.name,
        type: createProviderDto.type,
      },
    });

    if (existing) {
      throw new ConflictException(
        `提供商已存在: ${createProviderDto.name} (${createProviderDto.type})`,
      );
    }

    // 设置默认值
    const provider = this.providerRepository.create({
      ...createProviderDto,
      enabled: createProviderDto.enabled ?? true,
      timeout: createProviderDto.timeout ?? 30000,
      retryCount: createProviderDto.retryCount ?? 3,
      status: ProviderStatus.ACTIVE,
    });

    const savedProvider = await this.providerRepository.save(provider);

    // 返回时隐藏 API Key
    return {
      ...savedProvider,
      apiKey: '********',
    };
  }

  /**
   * 更新提供商
   */
  async update(id: string, updateProviderDto: UpdateProviderDto) {
    const provider = await this.providerRepository.findOne({
      where: { id },
    });

    if (!provider) {
      throw new NotFoundException(`提供商 #${id} 不存在`);
    }

    // 合并更新
    Object.assign(provider, updateProviderDto);

    const updatedProvider = await this.providerRepository.save(provider);

    // 返回时隐藏 API Key
    return {
      ...updatedProvider,
      apiKey: '********',
    };
  }

  /**
   * 删除提供商
   */
  async remove(id: string) {
    const provider = await this.providerRepository.findOne({
      where: { id },
      relations: ['models'],
    });

    if (!provider) {
      throw new NotFoundException(`提供商 #${id} 不存在`);
    }

    // 检查是否有关联的模型
    if (provider.models && provider.models.length > 0) {
      throw new BadRequestException(
        `无法删除提供商，存在 ${provider.models.length} 个关联的模型配置`,
      );
    }

    await this.providerRepository.remove(provider);

    return { message: '提供商删除成功' };
  }

  /**
   * 测试提供商连接
   */
  async test(testDto: TestProviderDto) {
    const provider = await this.providerRepository.findOne({
      where: { id: testDto.providerId },
    });

    if (!provider) {
      throw new NotFoundException(`提供商 #${testDto.providerId} 不存在`);
    }

    if (!provider.enabled) {
      return {
        success: false,
        message: '该提供商未启用',
      };
    }

    try {
      const startTime = Date.now();

      // TODO: 实际调用提供商 API 进行测试
      // 这里只是模拟测试逻辑
      // 可以使用 axios 调用 healthCheckUrl 或 baseUrl
      await new Promise((resolve) => setTimeout(resolve, 100)); // 模拟网络延迟

      const latency = Date.now() - startTime;

      // 更新健康检查时间和状态
      provider.lastHealthCheck = new Date();
      provider.status = ProviderStatus.ACTIVE;
      await this.providerRepository.save(provider);

      return {
        success: true,
        message: '连接测试成功',
        latency,
      };
    } catch (error) {
      // 更新状态为错误
      provider.status = ProviderStatus.ERROR;
      provider.lastHealthCheck = new Date();
      await this.providerRepository.save(provider);

      return {
        success: false,
        error: error.message || '连接测试失败',
      };
    }
  }

  /**
   * 获取提供商健康状态
   */
  async getHealth(id: string) {
    const provider = await this.providerRepository.findOne({
      where: { id },
    });

    if (!provider) {
      throw new NotFoundException(`提供商 #${id} 不存在`);
    }

    return {
      providerId: provider.id,
      status: provider.status,
      lastCheck: provider.lastHealthCheck || provider.createdAt,
    };
  }

  /**
   * 批量检查所有提供商的健康状态
   */
  async checkAllHealth() {
    const providers = await this.providerRepository.find({
      where: { enabled: true },
    });

    const results = await Promise.all(
      providers.map(async (provider) => {
        try {
          // TODO: 实际健康检查逻辑
          await new Promise((resolve) => setTimeout(resolve, 50));

          provider.status = ProviderStatus.ACTIVE;
          provider.lastHealthCheck = new Date();
          await this.providerRepository.save(provider);

          return {
            providerId: provider.id,
            status: ProviderStatus.ACTIVE,
            lastCheck: provider.lastHealthCheck,
          };
        } catch (error) {
          provider.status = ProviderStatus.ERROR;
          provider.lastHealthCheck = new Date();
          await this.providerRepository.save(provider);

          return {
            providerId: provider.id,
            status: ProviderStatus.ERROR,
            lastCheck: provider.lastHealthCheck,
            error: error.message,
          };
        }
      }),
    );

    return results;
  }
}
