import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  CreateProviderDto,
  UpdateProviderDto,
  GetProvidersQueryDto,
  TestProviderDto,
} from './dto/provider-management.dto';
import { ProviderStatus } from '@ai-platform/shared';

@Injectable()
export class ProviderService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取提供商列表（分页）
   */
  async findAll(query: GetProvidersQueryDto) {
    const { page = 1, pageSize = 10, keyword, type, status } = query;

    const where: any = {};

    // 搜索条件
    if (keyword) {
      where.name = { contains: keyword };
    }

    // 筛选条件
    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.providers.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.providers.count({ where }),
    ]);

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
    const provider = await this.prisma.providers.findUnique({
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
    const existing = await this.prisma.providers.findFirst({
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
    const savedProvider = await this.prisma.providers.create({
      data: {
        ...createProviderDto,
        enabled: createProviderDto.enabled ?? true,
        timeout: createProviderDto.timeout ?? 30000,
        retryCount: createProviderDto.retryCount ?? 3,
        status: ProviderStatus.ACTIVE,
      },
    });

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
    const provider = await this.prisma.providers.findUnique({
      where: { id },
    });

    if (!provider) {
      throw new NotFoundException(`提供商 #${id} 不存在`);
    }

    // 合并更新
    const updatedProvider = await this.prisma.providers.update({
      where: { id },
      data: updateProviderDto,
    });

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
    const provider = await this.prisma.providers.findUnique({
      where: { id },
      include: { model_configs: true },
    });

    if (!provider) {
      throw new NotFoundException(`提供商 #${id} 不存在`);
    }

    // 检查是否有关联的模型
    if (provider.model_configs && provider.model_configs.length > 0) {
      throw new BadRequestException(
        `无法删除提供商，存在 ${provider.model_configs.length} 个关联的模型配置`,
      );
    }

    await this.prisma.providers.delete({ where: { id } });

    return { message: '提供商删除成功' };
  }

  /**
   * 测试提供商连接
   */
  async test(testDto: TestProviderDto) {
    const provider = await this.prisma.providers.findUnique({
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
      await this.prisma.providers.update({
        where: { id: testDto.providerId },
        data: {
          lastHealthCheck: new Date(),
          status: ProviderStatus.ACTIVE,
        },
      });

      return {
        success: true,
        message: '连接测试成功',
        latency,
      };
    } catch (error) {
      // 更新状态为错误
      await this.prisma.providers.update({
        where: { id: testDto.providerId },
        data: {
          lastHealthCheck: new Date(),
          status: ProviderStatus.ERROR,
        },
      });

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
    const provider = await this.prisma.providers.findUnique({
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
    const providers = await this.prisma.providers.findMany({
      where: { enabled: true },
    });

    const results = await Promise.all(
      providers.map(async (provider) => {
        try {
          // TODO: 实际健康检查逻辑
          await new Promise((resolve) => setTimeout(resolve, 50));

          const now = new Date();
          await this.prisma.providers.update({
            where: { id: provider.id },
            data: {
              status: ProviderStatus.ACTIVE,
              lastHealthCheck: now,
            },
          });

          return {
            providerId: provider.id,
            status: ProviderStatus.ACTIVE,
            lastCheck: now,
          };
        } catch (error) {
          const now = new Date();
          await this.prisma.providers.update({
            where: { id: provider.id },
            data: {
              status: ProviderStatus.ERROR,
              lastHealthCheck: now,
            },
          });

          return {
            providerId: provider.id,
            status: ProviderStatus.ERROR,
            lastCheck: now,
            error: error.message,
          };
        }
      }),
    );

    return results;
  }
}
