import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { ab_experiments as ABExperiment } from '@prisma/client';
import { ExperimentGroup, ExperimentStatus } from '../../diet.types';
import { GoalType } from '../nutrition-score.service';
import { SCORE_WEIGHTS } from './recommendation.types';
import {
  StrategyConfig,
  RankPolicyConfig,
  StrategyScoreDimension,
  SCORE_DIMENSION_NAMES,
} from '../../../strategy/strategy.types';

/**
 * 用户的实验分组结果
 */
export interface UserExperimentAssignment {
  experimentId: string;
  experimentName: string;
  groupName: string;
  /** 评分权重覆盖（按目标类型），null 表示使用默认值 */
  scoreWeightOverrides: Record<string, number[]> | null;
  /** 餐次权重修正覆盖，null 表示使用默认值 */
  mealWeightOverrides: Record<string, Record<string, number>> | null;
}

/**
 * V5 3.7: 实验指标聚合结果
 */
export interface ExperimentMetrics {
  experimentId: string;
  groupId: string;
  /** 该组总推荐反馈数 */
  totalRecommendations: number;
  /** 接受数量 */
  acceptedCount: number;
  /** 替换数量 */
  replacedCount: number;
  /** 跳过数量 */
  skippedCount: number;
  /** 接受率 (0-1) */
  acceptanceRate: number;
  /** 该组平均推荐评分 */
  avgNutritionScore: number;
  /** 不同用户数 */
  sampleSize: number;
}

/**
 * V5 3.8: 统计显著性检验结果
 */
export interface SignificanceResult {
  /** 是否显著 */
  significant: boolean;
  /** 近似 p 值 */
  pValue: number;
  /** 卡方统计量 */
  chiSquared: number;
  /** 自由度 */
  df: number;
}

/**
 * V5 3.8: 实验分析报告
 */
export interface ExperimentAnalysis {
  experimentId: string;
  experimentName: string;
  /** 各组指标 */
  metrics: ExperimentMetrics[];
  /** 两两比较的显著性结果（control vs 每个 variant） */
  comparisons: Array<{
    controlGroup: string;
    treatmentGroup: string;
    significance: SignificanceResult;
    /** 接受率提升百分比 (treatment - control) / control × 100 */
    acceptanceRateLift: number;
  }>;
  /** 推荐的获胜组（如果有显著差异） */
  winner: string | null;
  /** 是否可以结束实验 */
  canConclude: boolean;
  /** 结论说明 */
  conclusion: string;
}

/**
 * A/B 测试服务
 *
 * 职责：
 * 1. 缓存 running 状态的实验配置（避免每次评分查 DB）
 * 2. 按 userId 哈希确定性分组
 * 3. 返回权重覆盖供 computeWeights() 使用
 *
 * 设计约束：
 * - 同一时间同一 goalType 最多一个 running 实验
 * - 缓存 TTL 60s，管理端修改实验后 ≤60s 生效
 */
@Injectable()
export class ABTestingService {
  private readonly logger = new Logger(ABTestingService.name);

  /** 缓存：goalType → ABExperiment */
  private experimentCache: Map<string, ABExperiment> = new Map();
  private cacheExpiry = 0;
  private readonly CACHE_TTL_MS = 60_000; // 60 seconds

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取用户在指定目标类型下的实验分组
   * 如果没有 running 的实验，返回 null（使用默认权重）
   */
  async getUserAssignment(
    userId: string,
    goalType: string,
  ): Promise<UserExperimentAssignment | null> {
    const experiment = await this.getActiveExperiment(goalType);
    if (!experiment) return null;

    const group = this.assignUserToGroup(userId, experiment);
    if (!group) return null;

    return {
      experimentId: experiment.id,
      experimentName: experiment.name,
      groupName: group.name,
      scoreWeightOverrides: group.scoreWeightOverrides ?? null,
      mealWeightOverrides: group.mealWeightOverrides ?? null,
    };
  }

  /**
   * 获取用户的评分权重覆盖
   * 返回覆盖后的 base weights（已按目标类型索引），或 null（使用默认值）
   */
  async getWeightOverrides(
    userId: string,
    goalType: string,
  ): Promise<number[] | null> {
    const assignment = await this.getUserAssignment(userId, goalType);
    if (!assignment?.scoreWeightOverrides) return null;

    // 实验组可以覆盖特定目标类型的权重，也可以用 '*' 覆盖所有类型
    const overrides =
      assignment.scoreWeightOverrides[goalType] ??
      assignment.scoreWeightOverrides['*'] ??
      null;

    if (!overrides) return null;

    // 验证权重数组长度匹配（9 维）
    const defaultWeights = SCORE_WEIGHTS[goalType as GoalType];
    if (defaultWeights && overrides.length !== defaultWeights.length) {
      this.logger.warn(
        `Experiment ${assignment.experimentName}: weight override length mismatch ` +
          `(got ${overrides.length}, expected ${defaultWeights.length}). Using defaults.`,
      );
      return null;
    }

    return overrides;
  }

  /**
   * V5 4.8: 获取用户的餐次权重修正覆盖
   * 返回 A/B 实验组指定的 mealWeightOverrides，或 null（使用默认 MEAL_WEIGHT_MODIFIERS）
   *
   * 数据格式: { [mealType]: { [dimension]: number } }
   * 例: { breakfast: { glycemic: 1.5, satiety: 1.3 }, dinner: { calories: 1.4 } }
   */
  async getMealWeightOverrides(
    userId: string,
    goalType: string,
  ): Promise<Record<string, Record<string, number>> | null> {
    const assignment = await this.getUserAssignment(userId, goalType);
    if (!assignment?.mealWeightOverrides) return null;

    // mealWeightOverrides 不需要按 goalType 索引（它按 mealType 索引）
    // 直接返回即可；computeWeights() 会按 mealType 取对应的修正子集
    return assignment.mealWeightOverrides;
  }

  /**
   * 获取活跃实验（带缓存）
   */
  private async getActiveExperiment(
    goalType: string,
  ): Promise<ABExperiment | null> {
    await this.refreshCacheIfNeeded();

    // 优先匹配精确 goalType，然后匹配 '*'
    return (
      this.experimentCache.get(goalType) ??
      this.experimentCache.get('*') ??
      null
    );
  }

  /**
   * 确定性分组：使用 userId 的简单哈希
   * 同一 userId 始终分到同一组，不依赖外部状态
   */
  private assignUserToGroup(
    userId: string,
    experiment: ABExperiment,
  ): ExperimentGroup | null {
    const groups = experiment.groups as unknown as ExperimentGroup[];
    if (!groups || groups.length === 0) return null;

    // FNV-1a 哈希 → 0-1 之间的确定性值
    const hash = this.fnv1aHash(userId + ':' + experiment.id);
    const bucket = (hash >>> 0) / 0xffffffff; // 归一化到 [0, 1)

    // 按 trafficRatio 分配
    let cumulative = 0;
    for (const group of groups) {
      cumulative += group.trafficRatio;
      if (bucket < cumulative) {
        return group;
      }
    }

    // 浮点精度兜底：返回最后一组
    return groups[groups.length - 1];
  }

  /**
   * FNV-1a 哈希（32 位）
   * 简单、快速、分布均匀的字符串哈希
   */
  private fnv1aHash(str: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      hash ^= str.charCodeAt(i);
      hash = (hash * 0x01000193) | 0;
    }
    return hash;
  }

  /**
   * 刷新缓存（TTL 60s）
   */
  private async refreshCacheIfNeeded(): Promise<void> {
    if (Date.now() < this.cacheExpiry) return;

    try {
      const running = await this.prisma.ab_experiments.findMany({
        where: { status: ExperimentStatus.RUNNING },
      });

      const newCache = new Map<string, ABExperiment>();
      for (const exp of running) {
        // 检查时间窗口
        if (exp.start_date && new Date(exp.start_date) > new Date()) continue;
        if (exp.end_date && new Date(exp.end_date) < new Date()) continue;
        newCache.set(exp.goal_type, exp as unknown as ABExperiment);
      }

      this.experimentCache = newCache;
      this.cacheExpiry = Date.now() + this.CACHE_TTL_MS;
    } catch (err) {
      this.logger.warn(`Failed to refresh experiment cache: ${err}`);
      // 缓存加载失败不影响正常服务，继续使用旧缓存或空缓存
      this.cacheExpiry = Date.now() + 10_000; // 10s 后重试
    }
  }

  // ─── V5 3.7: 指标收集 ───

  /**
   * 收集指定实验的各组指标
   *
   * 从 recommendation_feedbacks 中按 experimentId + groupId 聚合统计：
   * - 总反馈数、接受/替换/跳过计数
   * - 接受率、平均推荐评分、独立用户数
   */
  async collectMetrics(experimentId: string): Promise<ExperimentMetrics[]> {
    const rows: Array<{
      groupId: string;
      total: string;
      accepted: string;
      replaced: string;
      skipped: string;
      avgScore: string;
      sampleSize: string;
    }> = await this.prisma.$queryRawUnsafe(
      `SELECT f.group_id AS "groupId",
              COUNT(*)::int AS "total",
              SUM(CASE WHEN f.action = 'accepted' THEN 1 ELSE 0 END)::int AS "accepted",
              SUM(CASE WHEN f.action = 'replaced' THEN 1 ELSE 0 END)::int AS "replaced",
              SUM(CASE WHEN f.action = 'skipped' THEN 1 ELSE 0 END)::int AS "skipped",
              AVG(f.recommendation_score) AS "avgScore",
              COUNT(DISTINCT f.user_id)::int AS "sampleSize"
       FROM recommendation_feedbacks f
       WHERE f.experiment_id = $1
         AND f.group_id IS NOT NULL
       GROUP BY f.group_id`,
      experimentId,
    );

    return rows.map((r) => {
      const total = Number(r.total);
      const accepted = Number(r.accepted);
      return {
        experimentId,
        groupId: r.groupId,
        totalRecommendations: total,
        acceptedCount: accepted,
        replacedCount: Number(r.replaced),
        skippedCount: Number(r.skipped),
        acceptanceRate: total > 0 ? accepted / total : 0,
        avgNutritionScore: Number(r.avgScore) || 0,
        sampleSize: Number(r.sampleSize),
      };
    });
  }

  // ─── V5 3.8: 统计显著性分析 ───

  /**
   * 分析实验结果：收集指标 + 统计显著性检验
   *
   * 流程：
   * 1. 加载实验信息
   * 2. 收集各组指标（通过 collectMetrics）
   * 3. 识别 control 组（组名包含 'control'）
   * 4. 对 control vs 每个 variant 做卡方检验
   * 5. 生成结论
   */
  async analyzeExperiment(experimentId: string): Promise<ExperimentAnalysis> {
    // 1. 加载实验
    const experiment = await this.prisma.ab_experiments.findUniqueOrThrow({
      where: { id: experimentId },
    });

    // 2. 收集各组指标
    const metrics = await this.collectMetrics(experimentId);

    if (metrics.length < 2) {
      return {
        experimentId,
        experimentName: experiment.name,
        metrics,
        comparisons: [],
        winner: null,
        canConclude: false,
        conclusion: '数据不足：需要至少 2 个分组的反馈数据才能进行分析',
      };
    }

    // 3. 识别 control 组（组名包含 'control'，不区分大小写）
    const controlMetrics = metrics.find((m) =>
      m.groupId.toLowerCase().includes('control'),
    );

    if (!controlMetrics) {
      return {
        experimentId,
        experimentName: experiment.name,
        metrics,
        comparisons: [],
        winner: null,
        canConclude: false,
        conclusion: '无法分析：未找到 control 组（组名需包含 "control"）',
      };
    }

    // 4. 对 control vs 每个 variant 做卡方检验
    const treatmentGroups = metrics.filter(
      (m) => m.groupId !== controlMetrics.groupId,
    );

    const comparisons = treatmentGroups.map((treatment) => {
      const significance = this.chiSquaredTest(
        controlMetrics.acceptedCount,
        controlMetrics.totalRecommendations,
        treatment.acceptedCount,
        treatment.totalRecommendations,
      );

      // 接受率提升百分比
      const acceptanceRateLift =
        controlMetrics.acceptanceRate > 0
          ? ((treatment.acceptanceRate - controlMetrics.acceptanceRate) /
              controlMetrics.acceptanceRate) *
            100
          : 0;

      return {
        controlGroup: controlMetrics.groupId,
        treatmentGroup: treatment.groupId,
        significance,
        acceptanceRateLift: Math.round(acceptanceRateLift * 100) / 100,
      };
    });

    // 5. 判断获胜组 + 生成结论
    const minSamplePerGroup = 30; // 每组最少样本量
    const allGroupsHaveEnoughData = metrics.every(
      (m) => m.sampleSize >= minSamplePerGroup,
    );

    const significantWinners = comparisons.filter(
      (c) => c.significance.significant && c.acceptanceRateLift > 0,
    );

    let winner: string | null = null;
    let canConclude = false;
    let conclusion: string;

    if (!allGroupsHaveEnoughData) {
      conclusion = `样本量不足：部分组用户数 < ${minSamplePerGroup}，建议继续收集数据`;
    } else if (significantWinners.length === 0) {
      // 检查是否所有比较都不显著
      const anySignificant = comparisons.some(
        (c) => c.significance.significant,
      );
      if (anySignificant) {
        // control 显著胜出
        winner = controlMetrics.groupId;
        canConclude = true;
        conclusion = `Control 组 "${controlMetrics.groupId}" 表现更优，建议保持现有策略`;
      } else {
        canConclude = true;
        conclusion =
          '各组之间无统计显著差异，建议保持 control 策略或调整实验参数';
      }
    } else if (significantWinners.length === 1) {
      winner = significantWinners[0].treatmentGroup;
      canConclude = true;
      const lift = significantWinners[0].acceptanceRateLift;
      conclusion = `实验组 "${winner}" 显著优于 control，接受率提升 ${lift}%，建议采用`;
    } else {
      // 多个 variant 都显著优于 control，选接受率最高的
      const best = significantWinners.reduce((a, b) =>
        a.acceptanceRateLift > b.acceptanceRateLift ? a : b,
      );
      winner = best.treatmentGroup;
      canConclude = true;
      conclusion = `多个实验组优于 control，"${winner}" 提升最大 (${best.acceptanceRateLift}%)，建议采用`;
    }

    return {
      experimentId,
      experimentName: experiment.name,
      metrics,
      comparisons,
      winner,
      canConclude,
      conclusion,
    };
  }

  /**
   * 2×2 列联表卡方检验（Pearson's chi-squared test）
   *
   * 用于比较两组的接受率是否有显著差异：
   * ┌──────────┬──────────┬──────────┐
   * │          │ Accepted │ Rejected │
   * ├──────────┼──────────┼──────────┤
   * │ Control  │   a      │   b      │
   * │ Treatment│   c      │   d      │
   * └──────────┴──────────┴──────────┘
   *
   * df = 1, α = 0.05 → critical value = 3.841
   *
   * @param controlAccepted  control 组接受数
   * @param controlTotal     control 组总数
   * @param treatmentAccepted treatment 组接受数
   * @param treatmentTotal    treatment 组总数
   */
  private chiSquaredTest(
    controlAccepted: number,
    controlTotal: number,
    treatmentAccepted: number,
    treatmentTotal: number,
  ): SignificanceResult {
    // 样本量过小时直接返回不显著
    if (controlTotal < 5 || treatmentTotal < 5) {
      return { significant: false, pValue: 1, chiSquared: 0, df: 1 };
    }

    // 2×2 列联表
    const a = controlAccepted;
    const b = controlTotal - controlAccepted;
    const c = treatmentAccepted;
    const d = treatmentTotal - treatmentAccepted;
    const n = a + b + c + d;

    // 期望频数 = 行边际 × 列边际 / 总数
    const rowSums = [a + b, c + d];
    const colSums = [a + c, b + d];

    // 检查期望频数是否有 0（避免除零）
    if (rowSums.some((r) => r === 0) || colSums.some((c) => c === 0)) {
      return { significant: false, pValue: 1, chiSquared: 0, df: 1 };
    }

    // 计算卡方统计量（Yates 连续性校正）
    // χ² = n × (|ad - bc| - n/2)² / (rowSum0 × rowSum1 × colSum0 × colSum1)
    const numerator = Math.max(0, Math.abs(a * d - b * c) - n / 2);
    const chiSquared =
      (n * numerator * numerator) /
      (rowSums[0] * rowSums[1] * colSums[0] * colSums[1]);

    // 近似 p 值：使用 χ²(df=1) 的生存函数近似
    const pValue = this.chiSquaredSurvival(chiSquared);

    const CRITICAL_VALUE_005 = 3.841; // α = 0.05, df = 1

    return {
      significant: chiSquared >= CRITICAL_VALUE_005,
      pValue: Math.round(pValue * 10000) / 10000, // 保留 4 位小数
      chiSquared: Math.round(chiSquared * 10000) / 10000,
      df: 1,
    };
  }

  /**
   * χ²(df=1) 分布的生存函数近似（1 - CDF）
   * 使用标准正态近似：p ≈ 2 × (1 - Φ(√χ²))
   * 其中 Φ 使用 Abramowitz & Stegun 近似公式
   */
  private chiSquaredSurvival(chiSq: number): number {
    if (chiSq <= 0) return 1;

    // χ²(df=1) → 标准正态 z = √χ²
    const z = Math.sqrt(chiSq);

    // 正态分布 CDF 近似 (Abramowitz & Stegun 26.2.17)
    const p = 0.2316419;
    const b1 = 0.31938153;
    const b2 = -0.356563782;
    const b3 = 1.781477937;
    const b4 = -1.821255978;
    const b5 = 1.330274429;

    const t = 1 / (1 + p * z);
    const phi = (1 / Math.sqrt(2 * Math.PI)) * Math.exp((-z * z) / 2);
    const cdf =
      1 -
      phi * (b1 * t + b2 * t ** 2 + b3 * t ** 3 + b4 * t ** 4 + b5 * t ** 5);

    // 双侧检验的 p 值 = 2 × (1 - CDF)
    return Math.max(0, 2 * (1 - cdf));
  }

  // ─── V6 2.4: 策略 ↔ A/B 实验打通 ───

  /**
   * 将当前用户的 A/B 实验分组转换为 StrategyConfig
   *
   * 转换规则:
   *   - scoreWeightOverrides → RankPolicyConfig.baseWeights（按 goalType 索引）
   *   - mealWeightOverrides → RankPolicyConfig.mealModifiers（按维度映射）
   *
   * @returns 策略配置 + 实验来源信息，或 null（无活跃实验）
   */
  async resolveExperimentStrategy(
    userId: string,
    goalType: string,
  ): Promise<{
    config: StrategyConfig;
    experimentId: string;
    groupName: string;
  } | null> {
    const assignment = await this.getUserAssignment(userId, goalType);
    if (!assignment) return null;

    const config: StrategyConfig = {};
    const rankConfig: RankPolicyConfig = {};
    let hasRankConfig = false;

    // 将 scoreWeightOverrides 转为 baseWeights
    if (assignment.scoreWeightOverrides) {
      const weights =
        assignment.scoreWeightOverrides[goalType] ??
        assignment.scoreWeightOverrides['*'] ??
        null;

      if (weights) {
        // 将 number[] 转为 Record<GoalType, number[]>（仅设置当前 goalType）
        rankConfig.baseWeights = {
          [goalType]: weights,
        } as RankPolicyConfig['baseWeights'];
        hasRankConfig = true;
      }
    }

    // 将 mealWeightOverrides 转为 mealModifiers
    // 原格式: { [mealType]: { [dimensionName]: number } } — 与 RankPolicyConfig.mealModifiers 兼容
    if (assignment.mealWeightOverrides) {
      const mealModifiers: Record<
        string,
        Partial<Record<StrategyScoreDimension, number>>
      > = {};

      for (const [mealType, dims] of Object.entries(
        assignment.mealWeightOverrides,
      )) {
        const mapped: Partial<Record<StrategyScoreDimension, number>> = {};
        for (const [dim, val] of Object.entries(dims)) {
          // 仅保留有效维度名
          if (SCORE_DIMENSION_NAMES.includes(dim as StrategyScoreDimension)) {
            mapped[dim as StrategyScoreDimension] = val;
          }
        }
        if (Object.keys(mapped).length > 0) {
          mealModifiers[mealType] = mapped;
        }
      }

      if (Object.keys(mealModifiers).length > 0) {
        rankConfig.mealModifiers = mealModifiers;
        hasRankConfig = true;
      }
    }

    if (hasRankConfig) {
      config.rank = rankConfig;
    }

    // 只有存在有效配置时才返回
    if (!hasRankConfig) {
      this.logger.debug(
        `实验 ${assignment.experimentName} 组 ${assignment.groupName} 无有效策略覆盖`,
      );
      return null;
    }

    return {
      config,
      experimentId: assignment.experimentId,
      groupName: assignment.groupName,
    };
  }

  // ─── Admin API 辅助方法 ───

  /**
   * 列出所有实验
   */
  async listExperiments(): Promise<ABExperiment[]> {
    const results = await this.prisma.ab_experiments.findMany({
      orderBy: { created_at: 'desc' },
    });
    return results as unknown as ABExperiment[];
  }

  /**
   * 创建实验
   */
  async createExperiment(data: Partial<ABExperiment>): Promise<ABExperiment> {
    // 验证分组 trafficRatio 之和 = 1.0
    const groups = data.groups as unknown as ExperimentGroup[] | undefined;
    if (groups?.length) {
      const totalRatio = groups.reduce((s, g) => s + g.trafficRatio, 0);
      if (Math.abs(totalRatio - 1.0) > 0.01) {
        throw new Error(
          `Group traffic ratios must sum to 1.0, got ${totalRatio}`,
        );
      }
    }

    const result = await this.prisma.ab_experiments.create({
      data: {
        name: data.name!,
        goal_type: data.goal_type ?? '*',
        status: data.status ?? ExperimentStatus.DRAFT,
        groups: (data.groups as any) ?? [],
        start_date: data.start_date ?? null,
        end_date: data.end_date ?? null,
      },
    });
    return result as unknown as ABExperiment;
  }

  /**
   * 更新实验状态
   */
  async updateStatus(
    id: string,
    status: ExperimentStatus,
  ): Promise<ABExperiment> {
    const experiment = await this.prisma.ab_experiments.findUniqueOrThrow({
      where: { id },
    });

    // 防止同一 goalType 多个 running 实验
    if (status === ExperimentStatus.RUNNING) {
      const existing = await this.prisma.ab_experiments.findFirst({
        where: {
          goal_type: experiment.goal_type,
          status: ExperimentStatus.RUNNING,
        },
      });
      if (existing && existing.id !== id) {
        throw new Error(
          `Another experiment (${existing.name}) is already running for goalType=${experiment.goal_type}`,
        );
      }
    }

    const updateData: Record<string, any> = { status };
    if (status === ExperimentStatus.RUNNING && !experiment.start_date) {
      updateData.start_date = new Date();
    }

    const saved = await this.prisma.ab_experiments.update({
      where: { id },
      data: updateData,
    });
    // 立即失效缓存
    this.cacheExpiry = 0;
    return saved as unknown as ABExperiment;
  }
}
