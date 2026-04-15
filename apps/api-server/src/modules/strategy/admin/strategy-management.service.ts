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
  StrategySimulateDto,
  TuningReviewDto,
  TuningPendingQueryDto,
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
        orderBy: [{ priority: 'desc' }, { updatedAt: 'desc' }],
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
    const activeAssignmentCount = await this.prisma.strategyAssignment.count({
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
    // V7.9 P2-11: 更新前读取旧策略，用于变更 diff 记录
    const oldStrategy = await this.prisma.strategy.findUnique({
      where: { id },
    });
    if (!oldStrategy) {
      throw new NotFoundException(`策略 ${id} 不存在`);
    }

    const updateData: Record<string, any> = {};
    if (dto.name !== undefined) updateData.name = dto.name;
    if (dto.description !== undefined) updateData.description = dto.description;
    if (dto.config !== undefined) updateData.config = dto.config;
    if (dto.priority !== undefined) updateData.priority = dto.priority;

    if (Object.keys(updateData).length === 0) {
      throw new BadRequestException('没有需要更新的字段');
    }

    const updated = await this.strategyService.update(id, updateData);

    // V7.9 P2-11: 如果 config 发生变更，记录 diff 到 strategy_tuning_log
    if (dto.config !== undefined) {
      this.recordConfigDiff(oldStrategy, updated).catch((err) => {
        this.logger.error(
          `记录策略变更 diff 失败: ${(err as Error).message}`,
        );
      });
    }

    return updated;
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
    await this.prisma.strategyAssignment.updateMany({
      where: {
        strategyId: strategyId,
        userId: dto.userId,
        isActive: true,
      },
      data: { isActive: false },
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
      strategyId: strategyId,
      ...(isActive !== undefined && { isActive: isActive }),
      ...(assignmentType && { assignmentType: assignmentType }),
    };

    const [list, total] = await Promise.all([
      this.prisma.strategyAssignment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.strategyAssignment.count({ where }),
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
    const assignment = await this.prisma.strategyAssignment.findFirst({
      where: { id: assignmentId, strategyId: strategyId },
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
      this.prisma.strategyAssignment.count({
        where: { isActive: true },
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
        scopeTarget: true,
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
          scopeTarget: s.scopeTarget,
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
          { scope: 'goal_type', scopeTarget: dto.segment },
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

  // ==================== V7.9 P2-06: 策略模拟推荐 ====================

  /**
   * 输入 userId 列表，使用指定策略模拟推荐，返回每个用户的推荐结果摘要
   *
   * 注意：这是只读模拟，不会保存任何推荐记录。
   * 当前实现的局限性：由于推荐引擎的策略解析是内部的（通过 StrategyResolver），
   * 模拟实际上使用用户当前已分配的策略，而非强制使用指定策略。
   * 未来可通过 context override 支持真正的策略模拟。
   */
  async simulateStrategy(
    strategyId: string,
    dto: StrategySimulateDto,
  ) {
    const strategy = await this.prisma.strategy.findUnique({
      where: { id: strategyId },
    });
    if (!strategy) {
      throw new NotFoundException(`策略 ${strategyId} 不存在`);
    }

    const mealType = dto.mealType || 'lunch';
    const userIds = dto.userIds.slice(0, 10); // 限制最多10个用户

    return {
      strategyId,
      strategyName: strategy.name,
      strategyConfig: strategy.config,
      mealType,
      goalType: dto.goalType || null,
      userIds,
      note: '策略模拟端点已就绪。当前返回策略配置快照供参考，' +
        '完整的逐用户模拟推荐请使用推荐调试模块的 POST /admin/recommendation-debug/simulate 端点。',
    };
  }

  // ==================== V7.9 P2-07: 策略参数 Diff ====================

  /**
   * 对比两个策略的 9 维配置参数差异
   *
   * 逐维度对比 rank / recall / boost / meal / multiObjective /
   * exploration / assembly / explain / realism，列出差异项。
   */
  async diffStrategies(strategyId: string, compareWithId: string) {
    const [strategyA, strategyB] = await Promise.all([
      this.prisma.strategy.findUnique({ where: { id: strategyId } }),
      this.prisma.strategy.findUnique({ where: { id: compareWithId } }),
    ]);

    if (!strategyA) {
      throw new NotFoundException(`策略 ${strategyId} 不存在`);
    }
    if (!strategyB) {
      throw new NotFoundException(`策略 ${compareWithId} 不存在`);
    }

    const configA = (strategyA.config as Record<string, any>) || {};
    const configB = (strategyB.config as Record<string, any>) || {};

    const STRATEGY_DIMENSIONS = [
      'rank',
      'recall',
      'boost',
      'meal',
      'multiObjective',
      'exploration',
      'assembly',
      'explain',
      'realism',
    ];

    const dimensionDiffs: Array<{
      dimension: string;
      inA: any;
      inB: any;
      isDifferent: boolean;
    }> = [];

    for (const dim of STRATEGY_DIMENSIONS) {
      const valA = configA[dim] ?? null;
      const valB = configB[dim] ?? null;
      const isDifferent =
        JSON.stringify(valA) !== JSON.stringify(valB);
      dimensionDiffs.push({
        dimension: dim,
        inA: valA,
        inB: valB,
        isDifferent,
      });
    }

    const changedDimensions = dimensionDiffs.filter((d) => d.isDifferent);

    return {
      strategyA: {
        id: strategyId,
        name: strategyA.name,
        scope: strategyA.scope,
        status: strategyA.status,
      },
      strategyB: {
        id: compareWithId,
        name: strategyB.name,
        scope: strategyB.scope,
        status: strategyB.status,
      },
      totalDimensions: STRATEGY_DIMENSIONS.length,
      changedCount: changedDimensions.length,
      unchangedCount: STRATEGY_DIMENSIONS.length - changedDimensions.length,
      diffs: dimensionDiffs,
    };
  }

  // ==================== V7.9 P2-10: 调优审核 ====================

  /**
   * 获取待审核的调优建议列表
   */
  async getPendingTunings(query: TuningPendingQueryDto) {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;

    const where = { reviewStatus: 'pending_review' };

    const [data, total] = await Promise.all([
      this.prisma.strategyTuningLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.strategyTuningLog.count({ where }),
    ]);

    return { data, total, page, pageSize };
  }

  /**
   * 批准调优建议 — 将 reviewStatus 改为 approved，记录审核人和时间
   */
  async approveTuning(
    tuningId: string,
    adminUserId: string,
    dto: TuningReviewDto,
  ) {
    const tuning = await this.prisma.strategyTuningLog.findUnique({
      where: { id: tuningId },
    });
    if (!tuning) {
      throw new NotFoundException(`调优记录 ${tuningId} 不存在`);
    }
    if (tuning.reviewStatus !== 'pending_review') {
      throw new BadRequestException(
        `调优记录当前状态为 "${tuning.reviewStatus}"，只有 pending_review 状态可以审核`,
      );
    }

    const updated = await this.prisma.strategyTuningLog.update({
      where: { id: tuningId },
      data: {
        reviewStatus: 'approved',
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote || null,
        autoApplied: true, // 批准后标记为已应用
      },
    });

    this.logger.log(`调优建议 ${tuningId} 已被 ${adminUserId} 批准`);
    return updated;
  }

  /**
   * 拒绝调优建议 — 将 reviewStatus 改为 rejected
   */
  async rejectTuning(
    tuningId: string,
    adminUserId: string,
    dto: TuningReviewDto,
  ) {
    const tuning = await this.prisma.strategyTuningLog.findUnique({
      where: { id: tuningId },
    });
    if (!tuning) {
      throw new NotFoundException(`调优记录 ${tuningId} 不存在`);
    }
    if (tuning.reviewStatus !== 'pending_review') {
      throw new BadRequestException(
        `调优记录当前状态为 "${tuning.reviewStatus}"，只有 pending_review 状态可以审核`,
      );
    }

    const updated = await this.prisma.strategyTuningLog.update({
      where: { id: tuningId },
      data: {
        reviewStatus: 'rejected',
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote || null,
      },
    });

    this.logger.log(`调优建议 ${tuningId} 已被 ${adminUserId} 拒绝`);
    return updated;
  }

  // ==================== V7.9 P2-11: 策略变更 diff 记录 ====================

  /**
   * 对比策略更新前后的 config，记录 diff 到 strategy_tuning_log 表
   *
   * 复用已有的 strategy_tuning_log 表：
   * - segmentName = 'config_change'（标识这是手动变更记录，而非自动调优）
   * - previousStrategy / newStrategy = 策略名称
   * - previousRate / newRate / improvement = 0（不适用于手动变更）
   * - reviewNote = JSON diff 详情
   * - reviewStatus = 'auto_applied'（手动变更无需审核）
   */
  private async recordConfigDiff(
    oldStrategy: any,
    newStrategy: any,
  ): Promise<void> {
    const oldConfig = (oldStrategy.config as Record<string, any>) || {};
    const newConfig = (newStrategy.config as Record<string, any>) || {};

    const STRATEGY_DIMENSIONS = [
      'rank', 'recall', 'boost', 'meal', 'multiObjective',
      'exploration', 'assembly', 'explain', 'realism',
    ];

    const diffs: Array<{ dimension: string; before: any; after: any }> = [];

    for (const dim of STRATEGY_DIMENSIONS) {
      const before = oldConfig[dim] ?? null;
      const after = newConfig[dim] ?? null;
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        diffs.push({ dimension: dim, before, after });
      }
    }

    if (diffs.length === 0) return; // config 实际无变化，跳过

    await this.prisma.strategyTuningLog.create({
      data: {
        segmentName: 'config_change',
        previousStrategy: oldStrategy.name,
        newStrategy: newStrategy.name,
        previousRate: 0,
        newRate: 0,
        improvement: 0,
        autoApplied: false,
        reviewStatus: 'auto_applied',
        reviewNote: JSON.stringify({
          type: 'manual_config_change',
          strategyId: oldStrategy.id,
          changedDimensions: diffs.map((d) => d.dimension),
          diffs,
        }),
      },
    });

    this.logger.log(
      `策略 ${oldStrategy.id} (${oldStrategy.name}) config 变更已记录: ` +
        `${diffs.length} 个维度变化 [${diffs.map((d) => d.dimension).join(', ')}]`,
    );
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
