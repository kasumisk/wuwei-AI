/**
 * V6.5 Phase 3L: 用户流失预测模型
 *
 * 替换 ProfileCronService 中简单的 5 条规则 churnRisk 计算，
 * 引入多维特征加权模型，提供更精准的流失风险预测。
 *
 * 特征维度（共 8 维）：
 * 1. recency         — 距上次记录的天数（指数衰减）
 * 2. frequency       — 最近 14 天的记录频率
 * 3. complianceDecay — 合规率趋势（上升 vs 下降）
 * 4. streakHealth    — 连胜天数的健康度
 * 5. feedbackRatio   — 推荐反馈的正面比例
 * 6. varietyDrop     — 食物多样性是否下降
 * 7. mealSkipRate    — 近期跳餐比例
 * 8. engagementDrop  — 功能使用频率下降（分析/记录/反馈）
 *
 * 输出：0-1 的 churnRisk 值 + 置信度 + 风险因素排行
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../../core/redis/redis-cache.service';

/** 单个特征得分 */
export interface ChurnFeature {
  name: string;
  /** 原始值 */
  rawValue: number;
  /** 归一化后的风险贡献 (0-1, 1=最高风险) */
  riskScore: number;
  /** 该特征的权重 */
  weight: number;
  /** 加权后的风险贡献 */
  weightedScore: number;
}

/** 流失预测结果 */
export interface ChurnPrediction {
  userId: string;
  /** 综合流失风险 (0-1) */
  churnRisk: number;
  /** 预测置信度 (0-1)：数据越充分置信度越高 */
  confidence: number;
  /** 风险等级 */
  riskLevel: 'low' | 'medium' | 'high' | 'critical';
  /** 各维度特征明细（按 weightedScore 降序） */
  features: ChurnFeature[];
  /** 主要风险因素（最多 3 个） */
  topRiskFactors: string[];
  /** 计算时间戳 */
  computedAt: string;
}

/** Admin: 全局流失风险分布 */
export interface ChurnDistribution {
  /** 统计窗口天数 */
  windowDays: number;
  /** 分析的用户总数 */
  totalUsers: number;
  /** 风险分布 */
  distribution: {
    low: number; // churnRisk < 0.3
    medium: number; // 0.3 <= churnRisk < 0.6
    high: number; // 0.6 <= churnRisk < 0.8
    critical: number; // churnRisk >= 0.8
  };
  /** 平均风险值 */
  avgRisk: number;
  /** 高风险用户列表（top N） */
  highRiskUsers: {
    userId: string;
    churnRisk: number;
    topRiskFactors: string[];
  }[];
}

/** 特征权重配置 */
const FEATURE_WEIGHTS = {
  recency: 0.25, // 最重要：距上次活跃的天数
  frequency: 0.2, // 最近的记录频率
  complianceDecay: 0.15, // 合规率趋势
  streakHealth: 0.1,
  feedbackRatio: 0.1,
  varietyDrop: 0.05,
  mealSkipRate: 0.1,
  engagementDrop: 0.05,
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 分钟
const CACHE_NAMESPACE = 'churn_pred';

@Injectable()
export class ChurnPredictionService {
  private readonly logger = new Logger(ChurnPredictionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
  ) {}

  /**
   * 预测单个用户的流失风险
   * 结果缓存 30 分钟
   */
  async predict(userId: string): Promise<ChurnPrediction> {
    const cacheKey = this.redis.buildKey(CACHE_NAMESPACE, userId);
    const cached = await this.redis.get<ChurnPrediction>(cacheKey);
    if (cached) return cached;

    const prediction = await this.computePrediction(userId);

    await this.redis.set(cacheKey, prediction, CACHE_TTL_MS).catch(() => {
      /* non-critical */
    });

    return prediction;
  }

  /**
   * 批量计算流失风险（供 ProfileCronService 调用）
   * 返回 churnRisk 值和置信度
   */
  async computeChurnRisk(
    userId: string,
    daysSinceLastRecord: number,
    complianceRate: number,
    streakDays: number,
    totalRecords: number,
  ): Promise<{ churnRisk: number; confidence: number }> {
    try {
      // 快速路径：数据太少时回退到简单规则
      if (totalRecords < 3) {
        return this.simpleHeuristic(daysSinceLastRecord, complianceRate);
      }

      const features = await this.extractFeatures(
        userId,
        daysSinceLastRecord,
        complianceRate,
        streakDays,
        totalRecords,
      );

      const churnRisk = this.aggregateRisk(features);
      const confidence = this.computeConfidence(totalRecords, features);

      return {
        churnRisk: round4(churnRisk),
        confidence: round4(confidence),
      };
    } catch (err) {
      this.logger.warn(
        `Churn prediction failed for ${userId}, falling back to heuristic: ${err}`,
      );
      return this.simpleHeuristic(daysSinceLastRecord, complianceRate);
    }
  }

  /**
   * Admin: 获取全局流失风险分布
   */
  async getDistribution(topN = 20): Promise<ChurnDistribution> {
    const profiles = await this.prisma.userInferredProfiles.findMany({
      where: {
        churnRisk: { not: null },
      },
      select: {
        userId: true,
        churnRisk: true,
      },
    });

    const distribution = { low: 0, medium: 0, high: 0, critical: 0 };
    let totalRisk = 0;

    for (const p of profiles) {
      const risk = Number(p.churnRisk ?? 0);
      totalRisk += risk;

      if (risk < 0.3) distribution.low++;
      else if (risk < 0.6) distribution.medium++;
      else if (risk < 0.8) distribution.high++;
      else distribution.critical++;
    }

    const avgRisk =
      profiles.length > 0 ? round4(totalRisk / profiles.length) : 0;

    // 高风险用户（按 churn_risk 降序）
    const highRiskProfiles = profiles
      .filter((p) => Number(p.churnRisk ?? 0) >= 0.6)
      .sort((a, b) => Number(b.churnRisk ?? 0) - Number(a.churnRisk ?? 0))
      .slice(0, topN);

    // 为高风险用户补充风险因素（从缓存或快速计算）
    const highRiskUsers = await Promise.all(
      highRiskProfiles.map(async (p) => {
        try {
          const prediction = await this.predict(p.userId);
          return {
            userId: p.userId,
            churnRisk: prediction.churnRisk,
            topRiskFactors: prediction.topRiskFactors,
          };
        } catch {
          return {
            userId: p.userId,
            churnRisk: Number(p.churnRisk ?? 0),
            topRiskFactors: [],
          };
        }
      }),
    );

    return {
      windowDays: 30,
      totalUsers: profiles.length,
      distribution,
      avgRisk,
      highRiskUsers,
    };
  }

  // ─── 内部特征提取 ───

  private async extractFeatures(
    userId: string,
    daysSinceLastRecord: number,
    complianceRate: number,
    streakDays: number,
    totalRecords: number,
  ): Promise<ChurnFeature[]> {
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // 并行查询所需数据
    const [recentRecordCount, weekAgoRecordCount, feedbackStats, recentFoods] =
      await Promise.all([
        // 最近 14 天记录数
        this.prisma.foodRecords.count({
          where: {
            userId: userId,
            createdAt: { gte: fourteenDaysAgo },
          },
        }),
        // 7-14 天前的记录数（用于趋势对比）
        this.prisma.foodRecords.count({
          where: {
            userId: userId,
            createdAt: { gte: fourteenDaysAgo, lt: sevenDaysAgo },
          },
        }),
        // 最近推荐反馈
        this.prisma.recommendationFeedbacks.findMany({
          where: {
            userId: userId,
            createdAt: { gte: fourteenDaysAgo },
          },
          select: { action: true },
        }),
        // 最近 14 天食物种类
        this.prisma.foodRecords.findMany({
          where: {
            userId: userId,
            createdAt: { gte: fourteenDaysAgo },
          },
          select: { foods: true, createdAt: true },
        }),
      ]);

    const thisWeekRecords = recentRecordCount - weekAgoRecordCount;

    const features: ChurnFeature[] = [];

    // 1. Recency — 指数衰减：daysSinceLastRecord 越大，风险越高
    const recencyRisk = 1 - Math.exp(-daysSinceLastRecord / 7);
    features.push(
      this.buildFeature('recency', daysSinceLastRecord, recencyRisk),
    );

    // 2. Frequency — 最近 14 天每天平均记录数
    const avgDailyRecords = recentRecordCount / 14;
    const frequencyRisk = Math.max(0, 1 - avgDailyRecords / 2);
    features.push(
      this.buildFeature('frequency', avgDailyRecords, frequencyRisk),
    );

    // 3. ComplianceDecay — 合规率下降
    const complianceDecayRisk = Math.max(0, 1 - complianceRate);
    features.push(
      this.buildFeature('complianceDecay', complianceRate, complianceDecayRisk),
    );

    // 4. StreakHealth — 连胜天数
    const streakRisk = Math.max(0, 1 - streakDays / 7);
    features.push(this.buildFeature('streakHealth', streakDays, streakRisk));

    // 5. FeedbackRatio — 推荐反馈正面比例
    const positiveActions = ['accepted', 'loved'];
    const positiveFeedback = feedbackStats.filter((f) =>
      positiveActions.includes(f.action),
    ).length;
    const feedbackTotal = feedbackStats.length;
    const feedbackRatio =
      feedbackTotal > 0 ? positiveFeedback / feedbackTotal : 0.5;
    const feedbackRisk = 1 - feedbackRatio;
    features.push(
      this.buildFeature('feedbackRatio', feedbackRatio, feedbackRisk),
    );

    // 6. VarietyDrop — 食物多样性下降（本周 vs 上周的独特食物数）
    const thisWeekFoods = new Set<string>();
    const lastWeekFoods = new Set<string>();
    for (const r of recentFoods) {
      const foods = r.foods as any[];
      if (!Array.isArray(foods)) continue;
      const isThisWeek = r.createdAt >= sevenDaysAgo;
      for (const f of foods) {
        const name = f?.name || f?.foodName;
        if (name) {
          (isThisWeek ? thisWeekFoods : lastWeekFoods).add(name);
        }
      }
    }
    const varietyDropRisk =
      lastWeekFoods.size > 0
        ? Math.max(0, 1 - thisWeekFoods.size / Math.max(1, lastWeekFoods.size))
        : 0;
    features.push(
      this.buildFeature('varietyDrop', thisWeekFoods.size, varietyDropRisk),
    );

    // 7. MealSkipRate — 本周跳餐比例（期望每天 3 餐）
    const expectedMeals = 7 * 3; // 一周 21 餐
    const mealSkipRate = Math.max(0, 1 - thisWeekRecords / expectedMeals);
    features.push(
      this.buildFeature('mealSkipRate', thisWeekRecords, mealSkipRate),
    );

    // 8. EngagementDrop — 总体活跃度下降（本周 vs 上周记录数）
    const engagementDropRisk =
      weekAgoRecordCount > 0
        ? Math.max(0, 1 - thisWeekRecords / Math.max(1, weekAgoRecordCount))
        : 0;
    features.push(
      this.buildFeature('engagementDrop', thisWeekRecords, engagementDropRisk),
    );

    return features;
  }

  private buildFeature(
    name: string,
    rawValue: number,
    riskScore: number,
  ): ChurnFeature {
    const weight = FEATURE_WEIGHTS[name as keyof typeof FEATURE_WEIGHTS] ?? 0;
    return {
      name,
      rawValue: round4(rawValue),
      riskScore: round4(Math.min(1, Math.max(0, riskScore))),
      weight,
      weightedScore: round4(weight * Math.min(1, Math.max(0, riskScore))),
    };
  }

  private aggregateRisk(features: ChurnFeature[]): number {
    const total = features.reduce((sum, f) => sum + f.weightedScore, 0);
    // 权重之和应为 1，但 clamp 以防
    return Math.min(1, Math.max(0, total));
  }

  private computeConfidence(
    totalRecords: number,
    features: ChurnFeature[],
  ): number {
    // 数据充分性：记录数越多置信度越高，30 条以上 = 满分
    const dataSufficiency = Math.min(1, totalRecords / 30);
    // 特征完整性：有效特征数 / 总特征数
    const featureCompleteness =
      features.filter((f) => f.rawValue !== 0).length / features.length;
    return round4(dataSufficiency * 0.6 + featureCompleteness * 0.4);
  }

  /** 数据不足时回退到简单启发式规则（兼容旧逻辑） */
  private simpleHeuristic(
    daysSinceLastRecord: number,
    complianceRate: number,
  ): { churnRisk: number; confidence: number } {
    let churnRisk = 0;
    if (daysSinceLastRecord >= 14) churnRisk = 0.9;
    else if (daysSinceLastRecord >= 7) churnRisk = 0.7;
    else if (daysSinceLastRecord >= 3) churnRisk = 0.4;
    else if (complianceRate < 0.3) churnRisk = 0.5;
    else churnRisk = 0.1;

    return { churnRisk, confidence: 0.3 }; // 低置信度标记
  }

  private classifyRiskLevel(
    risk: number,
  ): 'low' | 'medium' | 'high' | 'critical' {
    if (risk < 0.3) return 'low';
    if (risk < 0.6) return 'medium';
    if (risk < 0.8) return 'high';
    return 'critical';
  }

  // ─── 完整预测（含特征明细） ───

  private async computePrediction(userId: string): Promise<ChurnPrediction> {
    // 获取基础数据
    const [behavior, lastRecord] = await Promise.all([
      this.prisma.userBehaviorProfiles.findUnique({
        where: { userId: userId },
        select: {
          avgComplianceRate: true,
          streakDays: true,
          totalRecords: true,
        },
      }),
      this.prisma.foodRecords.findFirst({
        where: { userId: userId },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const complianceRate = Number(behavior?.avgComplianceRate ?? 0);
    const streakDays = behavior?.streakDays ?? 0;
    const totalRecords = behavior?.totalRecords ?? 0;
    const daysSinceLastRecord = lastRecord?.createdAt
      ? Math.floor(
          (Date.now() - lastRecord.createdAt.getTime()) / (1000 * 60 * 60 * 24),
        )
      : 999;

    if (totalRecords < 3) {
      const { churnRisk, confidence } = this.simpleHeuristic(
        daysSinceLastRecord,
        complianceRate,
      );
      return {
        userId,
        churnRisk,
        confidence,
        riskLevel: this.classifyRiskLevel(churnRisk),
        features: [],
        topRiskFactors: daysSinceLastRecord >= 7 ? ['长时间未活跃'] : [],
        computedAt: new Date().toISOString(),
      };
    }

    const features = await this.extractFeatures(
      userId,
      daysSinceLastRecord,
      complianceRate,
      streakDays,
      totalRecords,
    );

    const churnRisk = this.aggregateRisk(features);
    const confidence = this.computeConfidence(totalRecords, features);

    // 排序特征，取 top 3 作为风险因素
    const sorted = [...features].sort(
      (a, b) => b.weightedScore - a.weightedScore,
    );
    const topRiskFactors = sorted
      .filter((f) => f.riskScore > 0.3)
      .slice(0, 3)
      .map((f) => this.featureToLabel(f.name));

    return {
      userId,
      churnRisk: round4(churnRisk),
      confidence: round4(confidence),
      riskLevel: this.classifyRiskLevel(churnRisk),
      features: sorted,
      topRiskFactors,
      computedAt: new Date().toISOString(),
    };
  }

  private featureToLabel(name: string): string {
    const labels: Record<string, string> = {
      recency: '长时间未活跃',
      frequency: '记录频率低',
      complianceDecay: '合规率下降',
      streakHealth: '连胜中断',
      feedbackRatio: '推荐满意度低',
      varietyDrop: '食物多样性下降',
      mealSkipRate: '频繁跳餐',
      engagementDrop: '功能使用下降',
    };
    return labels[name] ?? name;
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
