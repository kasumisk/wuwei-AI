import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { I18nService } from '../../../../core/i18n';
import { ExperimentStatus } from '../../diet.types';
import { ABTestingService } from '../../app/recommendation/experiment/ab-testing.service';
import {
  GetExperimentsQueryDto,
  CreateExperimentDto,
  UpdateExperimentDto,
  UpdateExperimentStatusDto,
} from '../dto/ab-experiment-management.dto';
import { Prisma } from '@prisma/client';

@Injectable()
export class ABExperimentManagementService {
  private readonly logger = new Logger(ABExperimentManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly abTestingService: ABTestingService,
    private readonly i18n: I18nService,
  ) {}

  // ==================== 列表（分页 + 筛选） ====================

  async findExperiments(query: GetExperimentsQueryDto) {
    const { page = 1, pageSize = 20, keyword, status, goalType } = query;

    const where: Prisma.AbExperimentsWhereInput = {};

    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { description: { contains: keyword, mode: 'insensitive' } },
      ];
    }
    if (status) {
      where.status = status;
    }
    if (goalType) {
      where.goalType = goalType;
    }

    const [list, total] = await Promise.all([
      this.prisma.abExperiments.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.abExperiments.count({ where }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  // ==================== 统计概览 ====================

  async getOverview() {
    const statusCounts = await this.prisma.$queryRaw<
      Array<{ status: string; count: number }>
    >`SELECT status, COUNT(*)::int as count FROM ab_experiments GROUP BY status`;

    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) {
      statusMap[row.status] = Number(row.count);
    }

    const total = await this.prisma.abExperiments.count();

    return {
      total,
      draft: statusMap[ExperimentStatus.DRAFT] || 0,
      running: statusMap[ExperimentStatus.RUNNING] || 0,
      paused: statusMap[ExperimentStatus.PAUSED] || 0,
      completed: statusMap[ExperimentStatus.COMPLETED] || 0,
    };
  }

  // ==================== 详情 ====================

  async getExperimentDetail(id: string) {
    const experiment = await this.prisma.abExperiments.findFirst({
      where: { id },
    });
    if (!experiment) {
      throw new NotFoundException(this.i18n.t('diet.experimentNotFound'));
    }

    // 计算分组流量汇总
    const groups = experiment.groups as any[];
    const totalTraffic =
      groups?.reduce((sum: number, g: any) => sum + g.trafficRatio, 0) || 0;

    return {
      ...experiment,
      groupCount: groups?.length || 0,
      totalTraffic: Math.round(totalTraffic * 100) / 100,
    };
  }

  // ==================== 创建 ====================

  async createExperiment(dto: CreateExperimentDto) {
    // 验证分组 trafficRatio 之和 = 1.0（委托给 ABTestingService 也会验证，这里提前校验给出更好的错误信息）
    if (dto.groups?.length) {
      const totalRatio = dto.groups.reduce((s, g) => s + g.trafficRatio, 0);
      if (Math.abs(totalRatio - 1.0) > 0.01) {
        throw new BadRequestException(
          this.i18n.t('diet.trafficSumInvalid', {
            total: totalRatio.toFixed(4),
          }),
        );
      }

      // 验证分组名称不重复
      const names = dto.groups.map((g) => g.name);
      if (new Set(names).size !== names.length) {
        throw new BadRequestException(this.i18n.t('diet.groupNameDuplicate'));
      }
    }

    const experiment = await this.abTestingService.createExperiment({
      name: dto.name,
      description: dto.description,
      goalType: dto.goalType || '*',
      groups: dto.groups as any,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
    });

    this.logger.log(`A/B 实验已创建: ${experiment.id} - ${experiment.name}`);
    return experiment;
  }

  // ==================== 更新 ====================

  async updateExperiment(id: string, dto: UpdateExperimentDto) {
    const experiment = await this.prisma.abExperiments.findFirst({
      where: { id },
    });
    if (!experiment) {
      throw new NotFoundException(this.i18n.t('diet.experimentNotFound'));
    }

    // 仅 draft 和 paused 状态可以编辑
    if (
      experiment.status !== ExperimentStatus.DRAFT &&
      experiment.status !== ExperimentStatus.PAUSED
    ) {
      throw new BadRequestException(
        this.i18n.t('diet.experimentNotEditable', {
          status: experiment.status,
        }),
      );
    }

    // 如果更新了分组，验证 trafficRatio
    if (dto.groups?.length) {
      const totalRatio = dto.groups.reduce((s, g) => s + g.trafficRatio, 0);
      if (Math.abs(totalRatio - 1.0) > 0.01) {
        throw new BadRequestException(
          this.i18n.t('diet.trafficSumInvalid', {
            total: totalRatio.toFixed(4),
          }),
        );
      }

      const names = dto.groups.map((g) => g.name);
      if (new Set(names).size !== names.length) {
        throw new BadRequestException(this.i18n.t('diet.groupNameDuplicate'));
      }
    }

    // 更新字段
    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.goalType !== undefined) data.goalType = dto.goalType;
    if (dto.groups !== undefined) data.groups = dto.groups;
    if (dto.startDate !== undefined) data.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) data.endDate = new Date(dto.endDate);

    const saved = await this.prisma.abExperiments.update({
      where: { id },
      data,
    });
    this.logger.log(`A/B 实验已更新: ${id}`);
    return saved;
  }

  // ==================== 更新状态 ====================

  async updateExperimentStatus(id: string, dto: UpdateExperimentStatusDto) {
    try {
      const experiment = await this.abTestingService.updateStatus(
        id,
        dto.status,
      );
      this.logger.log(`A/B 实验状态已更新: ${id} → ${dto.status}`);
      return experiment;
    } catch (err) {
      // ABTestingService 抛 Error，转为 NestJS 异常
      if (err instanceof Error) {
        if (err.message.includes('Could not find')) {
          throw new NotFoundException(this.i18n.t('diet.experimentNotFound'));
        }
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  // ==================== 指标收集 ====================

  async getExperimentMetrics(id: string) {
    // 先验证实验存在
    const experiment = await this.prisma.abExperiments.findFirst({
      where: { id },
    });
    if (!experiment) {
      throw new NotFoundException(this.i18n.t('diet.experimentNotFound'));
    }

    const metrics = await this.abTestingService.collectMetrics(id);

    return {
      experimentId: id,
      experimentName: experiment.name,
      status: experiment.status,
      groups: experiment.groups,
      metrics,
    };
  }

  // ==================== 分析报告 ====================

  async getExperimentAnalysis(id: string) {
    // 先验证实验存在
    const experiment = await this.prisma.abExperiments.findFirst({
      where: { id },
    });
    if (!experiment) {
      throw new NotFoundException(this.i18n.t('diet.experimentNotFound'));
    }

    const analysis = await this.abTestingService.analyzeExperiment(id);
    return analysis;
  }
}
