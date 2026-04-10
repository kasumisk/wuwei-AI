import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
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
    private readonly prisma: PrismaService,
    private readonly strategyService: StrategyService,
  ) {}

  // ==================== 策略列表 ====================

  async findStrategies(query: GetStrategiesQueryDto) {
    const { page = 1, pageSize = 20, keyword, scope, status } = query;

    const where = {
      ...(keyword && {
        OR: [
          { name: { contains: keyword, mode: 'insensitive' as const } },
          { description: { contains: keyword, mode: 'insensitive' as const } },
        ],
      }),
      ...(scope && { scope }),
      ...(status && { status }),
    };

    const [list, total] = await Promise.all([
      this.prisma.strategy.findMany({
        where,
        orderBy: [{ priority: 'desc' }, { updated_at: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.strategy.count({ where }),
    ]);

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
    const strategy = await this.prisma.strategy.findUnique({ where: { id } });
    if (!strategy) {
      throw new NotFoundException(`策略 ${id} 不存在`);
    }

    // 同时查询该策略的活跃分配数
    const activeAssignmentCount = await this.prisma.strategy_assignment.count({
      where: { strategy_id: id, is_active: true },
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
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) {
      throw new NotFoundException(`策略 ${strategyId} 不存在`);
    }
    if (strategy.status !== StrategyStatus.ACTIVE) {
      throw new BadRequestException('只能分配激活状态的策略');
    }

    // 先取消该用户该策略的现有分配（避免重复）
    await this.prisma.strategy_assignment.updateMany({
      where: {
        strategy_id: strategyId,
        user_id: dto.userId,
        is_active: true,
      },
      data: { is_active: false },
    });

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

    const where = {
      strategy_id: strategyId,
      ...(isActive !== undefined && { is_active: isActive }),
      ...(assignmentType && { assignment_type: assignmentType }),
    };

    const [list, total] = await Promise.all([
      this.prisma.strategy_assignment.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.strategy_assignment.count({ where }),
    ]);

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
    const assignment = await this.prisma.strategy_assignment.findFirst({
      where: { id: assignmentId, strategy_id: strategyId },
    });
    if (!assignment) {
      throw new NotFoundException(`分配记录 ${assignmentId} 不存在`);
    }

    await this.strategyService.removeUserAssignment(dto.userId, assignmentId);

    return { message: '分配已取消' };
  }

  // ==================== 策略统计概览 ====================

  async getStrategyOverview() {
    const [
      totalStrategies,
      activeStrategies,
      draftStrategies,
      archivedStrategies,
      totalAssignments,
      scopeGroups,
    ] = await Promise.all([
      this.prisma.strategy.count(),
      this.prisma.strategy.count({
        where: { status: StrategyStatus.ACTIVE },
      }),
      this.prisma.strategy.count({
        where: { status: StrategyStatus.DRAFT },
      }),
      this.prisma.strategy.count({
        where: { status: StrategyStatus.ARCHIVED },
      }),
      this.prisma.strategy_assignment.count({
        where: { is_active: true },
      }),
      this.prisma.strategy.groupBy({
        by: ['scope'],
        _count: { _all: true },
      }),
    ]);

    // 按 scope 分布
    const scopeDistribution = scopeGroups.map((g) => ({
      scope: g.scope,
      count: g._count._all,
    }));

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
