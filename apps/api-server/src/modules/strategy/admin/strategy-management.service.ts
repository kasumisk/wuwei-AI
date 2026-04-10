import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Strategy } from '../entities/strategy.entity';
import { StrategyAssignment } from '../entities/strategy-assignment.entity';
import { StrategyService } from '../app/strategy.service';
import {
  GetStrategiesQueryDto,
  CreateStrategyDto,
  UpdateStrategyDto,
  AssignStrategyDto,
  GetAssignmentsQueryDto,
  RemoveAssignmentDto,
} from './dto/strategy-management.dto';
import { StrategyStatus } from '../strategy.types';

@Injectable()
export class StrategyManagementService {
  private readonly logger = new Logger(StrategyManagementService.name);

  constructor(
    @InjectRepository(Strategy)
    private readonly strategyRepo: Repository<Strategy>,
    @InjectRepository(StrategyAssignment)
    private readonly assignmentRepo: Repository<StrategyAssignment>,
    private readonly strategyService: StrategyService,
  ) {}

  // ==================== 策略列表 ====================

  async findStrategies(query: GetStrategiesQueryDto) {
    const { page = 1, pageSize = 20, keyword, scope, status } = query;

    const qb = this.strategyRepo.createQueryBuilder('s');

    if (keyword) {
      qb.andWhere('(s.name ILIKE :keyword OR s.description ILIKE :keyword)', {
        keyword: `%${keyword}%`,
      });
    }
    if (scope) {
      qb.andWhere('s.scope = :scope', { scope });
    }
    if (status) {
      qb.andWhere('s.status = :status', { status });
    }

    qb.orderBy('s.priority', 'DESC')
      .addOrderBy('s.updatedAt', 'DESC')
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

  // ==================== 策略详情 ====================

  async getStrategyDetail(id: string) {
    const strategy = await this.strategyRepo.findOneBy({ id });
    if (!strategy) {
      throw new NotFoundException(`策略 ${id} 不存在`);
    }

    // 同时查询该策略的活跃分配数
    const activeAssignmentCount = await this.assignmentRepo.count({
      where: { strategyId: id, isActive: true },
    });

    return {
      ...strategy,
      activeAssignmentCount,
    };
  }

  // ==================== 策略 CRUD ====================

  async createStrategy(dto: CreateStrategyDto) {
    return this.strategyService.create({
      name: dto.name,
      description: dto.description,
      scope: dto.scope,
      scopeTarget: dto.scopeTarget,
      config: dto.config,
      priority: dto.priority,
    });
  }

  async updateStrategy(id: string, dto: UpdateStrategyDto) {
    const updateData: Record<string, any> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.config !== undefined) updateData.config = dto.config;
    if (dto.priority !== undefined) updateData.priority = dto.priority;

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('没有需要更新的字段');
    }

    return this.strategyService.update(id, updateData);
  }

  // ==================== 策略状态管理 ====================

  async activateStrategy(id: string) {
    return this.strategyService.activate(id);
  }

  async archiveStrategy(id: string) {
    return this.strategyService.archive(id);
  }

  // ==================== 策略分配 ====================

  async assignStrategy(strategyId: string, dto: AssignStrategyDto) {
    // 验证策略存在且为 active
    const strategy = await this.strategyRepo.findOneBy({ id: strategyId });
    if (!strategy) {
      throw new NotFoundException(`策略 ${strategyId} 不存在`);
    }
    if (strategy.status !== StrategyStatus.ACTIVE) {
      throw new BadRequestException('只能分配激活状态的策略');
    }

    // 先取消该用户该策略的现有分配（避免重复）
    await this.assignmentRepo
      .createQueryBuilder()
      .update(StrategyAssignment)
      .set({ isActive: false })
      .where('strategy_id = :strategyId', { strategyId })
      .andWhere('user_id = :userId', { userId: dto.userId })
      .andWhere('is_active = true')
      .execute();

    return this.strategyService.assignToUser({
      userId: dto.userId,
      strategyId,
      assignmentType: dto.assignmentType,
      source: dto.source,
      activeFrom: dto.activeFrom ? new Date(dto.activeFrom) : undefined,
      activeUntil: dto.activeUntil ? new Date(dto.activeUntil) : undefined,
    });
  }

  async getAssignments(strategyId: string, query: GetAssignmentsQueryDto) {
    const { page = 1, pageSize = 20, isActive, assignmentType } = query;

    const qb = this.assignmentRepo
      .createQueryBuilder('a')
      .where('a.strategy_id = :strategyId', { strategyId });

    if (isActive !== undefined) {
      qb.andWhere('a.is_active = :isActive', { isActive });
    }
    if (assignmentType) {
      qb.andWhere('a.assignment_type = :assignmentType', { assignmentType });
    }

    qb.orderBy('a.createdAt', 'DESC')
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

  async removeAssignment(
    strategyId: string,
    assignmentId: string,
    dto: RemoveAssignmentDto,
  ) {
    const assignment = await this.assignmentRepo.findOneBy({
      id: assignmentId,
      strategyId,
    });
    if (!assignment) {
      throw new NotFoundException(`分配记录 ${assignmentId} 不存在`);
    }

    await this.strategyService.removeUserAssignment(dto.userId, assignmentId);

    return { message: '分配已取消' };
  }

  // ==================== 策略统计概览 ====================

  async getStrategyOverview() {
    const totalStrategies = await this.strategyRepo.count();
    const activeStrategies = await this.strategyRepo.count({
      where: { status: StrategyStatus.ACTIVE },
    });
    const draftStrategies = await this.strategyRepo.count({
      where: { status: StrategyStatus.DRAFT },
    });
    const archivedStrategies = await this.strategyRepo.count({
      where: { status: StrategyStatus.ARCHIVED },
    });
    const totalAssignments = await this.assignmentRepo.count({
      where: { isActive: true },
    });

    // 按 scope 分布
    const scopeDistribution = await this.strategyRepo
      .createQueryBuilder('s')
      .select('s.scope', 'scope')
      .addSelect('COUNT(*)', 'count')
      .groupBy('s.scope')
      .getRawMany();

    return {
      totalStrategies,
      activeStrategies,
      draftStrategies,
      archivedStrategies,
      totalActiveAssignments: totalAssignments,
      scopeDistribution,
    };
  }
}
