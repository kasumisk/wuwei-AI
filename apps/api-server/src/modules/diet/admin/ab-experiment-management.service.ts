import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ABExperiment,
  ExperimentStatus,
} from '../entities/ab-experiment.entity';
import { ABTestingService } from '../app/recommendation/ab-testing.service';
import {
  GetExperimentsQueryDto,
  CreateExperimentDto,
  UpdateExperimentDto,
  UpdateExperimentStatusDto,
} from './dto/ab-experiment-management.dto';

@Injectable()
export class ABExperimentManagementService {
  private readonly logger = new Logger(ABExperimentManagementService.name);

  constructor(
    @InjectRepository(ABExperiment)
    private readonly experimentRepo: Repository<ABExperiment>,
    private readonly abTestingService: ABTestingService,
  ) {}

  // ==================== 列表（分页 + 筛选） ====================

  async findExperiments(query: GetExperimentsQueryDto) {
    const { page = 1, pageSize = 20, keyword, status, goalType } = query;

    const qb = this.experimentRepo.createQueryBuilder('e');

    if (keyword) {
      qb.andWhere('(e.name ILIKE :keyword OR e.description ILIKE :keyword)', {
        keyword: `%${keyword}%`,
      });
    }
    if (status) {
      qb.andWhere('e.status = :status', { status });
    }
    if (goalType) {
      qb.andWhere('e.goalType = :goalType', { goalType });
    }

    qb.orderBy('e.createdAt', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    const [list, total] = await qb.getManyAndCount();

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
    const statusCounts = await this.experimentRepo
      .createQueryBuilder('e')
      .select('e.status', 'status')
      .addSelect('COUNT(*)::int', 'count')
      .groupBy('e.status')
      .getRawMany();

    const statusMap: Record<string, number> = {};
    for (const row of statusCounts) {
      statusMap[row.status] = Number(row.count);
    }

    const total = await this.experimentRepo.count();

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
    const experiment = await this.experimentRepo.findOne({ where: { id } });
    if (!experiment) {
      throw new NotFoundException(`实验 ${id} 不存在`);
    }

    // 计算分组流量汇总
    const totalTraffic =
      experiment.groups?.reduce((sum, g) => sum + g.trafficRatio, 0) || 0;

    return {
      ...experiment,
      groupCount: experiment.groups?.length || 0,
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
          `分组流量占比之和必须为 1.0，当前为 ${totalRatio.toFixed(4)}`,
        );
      }

      // 验证分组名称不重复
      const names = dto.groups.map((g) => g.name);
      if (new Set(names).size !== names.length) {
        throw new BadRequestException('分组名称不能重复');
      }
    }

    const experiment = await this.abTestingService.createExperiment({
      name: dto.name,
      description: dto.description,
      goalType: dto.goalType || '*',
      groups: dto.groups,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      endDate: dto.endDate ? new Date(dto.endDate) : undefined,
    });

    this.logger.log(`A/B 实验已创建: ${experiment.id} - ${experiment.name}`);
    return experiment;
  }

  // ==================== 更新 ====================

  async updateExperiment(id: string, dto: UpdateExperimentDto) {
    const experiment = await this.experimentRepo.findOne({ where: { id } });
    if (!experiment) {
      throw new NotFoundException(`实验 ${id} 不存在`);
    }

    // 仅 draft 和 paused 状态可以编辑
    if (
      experiment.status !== ExperimentStatus.DRAFT &&
      experiment.status !== ExperimentStatus.PAUSED
    ) {
      throw new BadRequestException(
        `实验处于 ${experiment.status} 状态，不允许编辑（仅 draft/paused 可编辑）`,
      );
    }

    // 如果更新了分组，验证 trafficRatio
    if (dto.groups?.length) {
      const totalRatio = dto.groups.reduce((s, g) => s + g.trafficRatio, 0);
      if (Math.abs(totalRatio - 1.0) > 0.01) {
        throw new BadRequestException(
          `分组流量占比之和必须为 1.0，当前为 ${totalRatio.toFixed(4)}`,
        );
      }

      const names = dto.groups.map((g) => g.name);
      if (new Set(names).size !== names.length) {
        throw new BadRequestException('分组名称不能重复');
      }
    }

    // 更新字段
    if (dto.name !== undefined) experiment.name = dto.name;
    if (dto.description !== undefined) experiment.description = dto.description;
    if (dto.goalType !== undefined) experiment.goalType = dto.goalType;
    if (dto.groups !== undefined) experiment.groups = dto.groups;
    if (dto.startDate !== undefined)
      experiment.startDate = new Date(dto.startDate);
    if (dto.endDate !== undefined) experiment.endDate = new Date(dto.endDate);

    const saved = await this.experimentRepo.save(experiment);
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
          throw new NotFoundException(`实验 ${id} 不存在`);
        }
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }

  // ==================== 指标收集 ====================

  async getExperimentMetrics(id: string) {
    // 先验证实验存在
    const experiment = await this.experimentRepo.findOne({ where: { id } });
    if (!experiment) {
      throw new NotFoundException(`实验 ${id} 不存在`);
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
    const experiment = await this.experimentRepo.findOne({ where: { id } });
    if (!experiment) {
      throw new NotFoundException(`实验 ${id} 不存在`);
    }

    const analysis = await this.abTestingService.analyzeExperiment(id);
    return analysis;
  }
}
