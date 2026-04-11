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
  UpdateRealismConfigDto,
  ApplyRealismToSegmentDto,
} from './dto/strategy-management.dto';
import {
  StrategyStatus,
  RealismConfig,
  PRESET_REALISM,
  DEFAULT_REALISM,
} from '../strategy.types';

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

  // ==================== V6.5 Phase 3H: Realism 配置管理 ====================

  /**
   * 获取所有活跃策略的 realism 配置概览
   *
   * 返回每个活跃策略的 realism 配置，以及与默认值的差异，
   * 便于 Admin 一目了然地查看整个系统的现实性约束状况。
   */
  async getRealismOverview() {
    const activeStrategies = await this.prisma.strategy.findMany({
      where: { status: StrategyStatus.ACTIVE },
      orderBy: [{ scope: 'asc' }, { priority: 'desc' }],
      select: {
        id: true,
        name: true,
        scope: true,
        scope_target: true,
        config: true,
      },
    });

    return {
      defaultRealism: { ...DEFAULT_REALISM },
      presets: PRESET_REALISM,
      strategies: activeStrategies.map((s) => {
        const config = s.config as Record<string, any> | null;
        const realism = (config?.realism as RealismConfig | undefined) ?? null;
        return {
          strategyId: s.id,
          strategyName: s.name,
          scope: s.scope,
          scopeTarget: s.scope_target,
          realism,
          isCustom: realism !== null,
        };
      }),
    };
  }

  /**
   * 更新指定策略的 realism 配置
   *
   * 只修改 config.realism 子字段，不影响策略其他配置维度。
   * 支持部分更新（传入的字段覆盖，未传入的保留原值）。
   */
  async updateStrategyRealism(strategyId: string, dto: UpdateRealismConfigDto) {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) {
      throw new NotFoundException(`策略 ${strategyId} 不存在`);
    }

    const existingConfig = (strategy.config as Record<string, any>) ?? {};
    const existingRealism = (existingConfig.realism as RealismConfig) ?? {};

    // 部分合并：dto 中已定义的字段覆盖原值
    const mergedRealism: RealismConfig = {
      ...existingRealism,
      ...this.pickDefined(dto),
    };

    const newConfig = {
      ...existingConfig,
      realism: mergedRealism,
    };

    const updated = await this.strategyService.update(strategyId, {
      config: newConfig,
    });

    this.logger.log(
      `策略 ${strategyId} realism 配置已更新: ${JSON.stringify(mergedRealism)}`,
    );

    return {
      strategyId: updated.id,
      strategyName: updated.name,
      realism: mergedRealism,
    };
  }

  /**
   * 将预设 realism 配置应用到指定策略
   *
   * 可选预设: warm_start, re_engage, precision, discovery
   */
  async applyRealismPreset(strategyId: string, presetName: string) {
    const preset = PRESET_REALISM[presetName];
    if (!preset) {
      throw new BadRequestException(
        `未知预设名 "${presetName}"，可选: ${Object.keys(PRESET_REALISM).join(', ')}`,
      );
    }

    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) {
      throw new NotFoundException(`策略 ${strategyId} 不存在`);
    }

    const existingConfig = (strategy.config as Record<string, any>) ?? {};
    const newConfig = {
      ...existingConfig,
      realism: { ...preset },
    };

    const updated = await this.strategyService.update(strategyId, {
      config: newConfig,
    });

    this.logger.log(`策略 ${strategyId} 已应用预设 realism: ${presetName}`);

    return {
      strategyId: updated.id,
      strategyName: updated.name,
      appliedPreset: presetName,
      realism: preset,
    };
  }

  /**
   * 按分群批量应用 realism 配置
   *
   * 查找所有 scope=goal_type 且 scope_target 匹配分群名称的策略，
   * 批量更新 realism 配置。
   */
  async applyRealismToSegment(dto: ApplyRealismToSegmentDto) {
    // 找到匹配分群的所有策略
    const strategies = await this.prisma.strategy.findMany({
      where: {
        status: StrategyStatus.ACTIVE,
        OR: [
          { scope: 'goal_type', scope_target: dto.segment },
          { name: { contains: dto.segment, mode: 'insensitive' } },
        ],
      },
    });

    if (strategies.length === 0) {
      throw new NotFoundException(`未找到匹配分群 "${dto.segment}" 的活跃策略`);
    }

    const realismUpdate = this.pickDefined(dto.realism);
    const results: Array<{ strategyId: string; strategyName: string }> = [];

    for (const s of strategies) {
      const existingConfig = (s.config as Record<string, any>) ?? {};
      const existingRealism = (existingConfig.realism as RealismConfig) ?? {};
      const newConfig = {
        ...existingConfig,
        realism: { ...existingRealism, ...realismUpdate },
      };
      await this.strategyService.update(s.id, { config: newConfig });
      results.push({ strategyId: s.id, strategyName: s.name });
    }

    this.logger.log(
      `已将 realism 配置应用到分群 "${dto.segment}" 的 ${results.length} 个策略`,
    );

    return {
      segment: dto.segment,
      appliedRealism: realismUpdate,
      updatedStrategies: results,
    };
  }

  /**
   * 从对象中提取已定义（非 undefined）的字段
   */
  private pickDefined(obj: object): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }
}
