/**
 * V6.9 Phase 3-A: SegmentDiscovery — 用户群体自动聚类发现
 *
 * 基于用户行为数据自动聚类发现新 segment，为新 segment 生成策略假设。
 *
 * 特征维度（6 维）:
 *   1. avgCaloriesPerDay / targetCalories（热量达成率）
 *   2. complianceRate（依从率）
 *   3. processingLevelAvg（加工食品比例）
 *   4. mealTimingVariance（用餐时间规律性）
 *   5. categoryDiversity（品类多样性）
 *   6. executionRate（执行率，V6.9 新增）
 *
 * 算法: 简化 K-Means（K-Means++ 初始化 + 最多 50 轮迭代）
 * 不引入外部 ML 库，全部 TypeScript 实现。
 *
 * 约束:
 *   - 最少 50 用户才启动聚类
 *   - 聚类太小（<10 人）的被过滤
 *   - K = min(10, ceil(N/20))
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { RedisCacheService } from '../../../core/redis/redis-cache.service';

// ==================== 类型 ====================

/** 用户特征向量 */
interface UserFeatureVector {
  userId: string;
  vector: number[];
}

/** 聚类结果 */
interface Cluster {
  centroid: number[];
  members: UserFeatureVector[];
  cohesion: number;
}

/** 发现的 segment */
export interface DiscoveredSegment {
  label: string;
  centroid: number[];
  memberCount: number;
  suggestedStrategy: string;
  confidence: number;
}

// ==================== 常量 ====================

/** 特征维度数 */
const FEATURE_DIM = 6;
/** 最小用户数量（低于此值不启动聚类） */
const MIN_USERS = 50;
/** 最小聚类大小（小于此值的聚类被丢弃） */
const MIN_CLUSTER_SIZE = 10;
/** K-Means 最大迭代次数 */
const MAX_ITERATIONS = 50;
/** 收敛阈值（中心点移动距离低于此值视为收敛） */
const CONVERGENCE_THRESHOLD = 0.001;
/** Redis 缓存 key */
const DISCOVERED_SEGMENTS_KEY = 'segment:discovered';
/** Redis 缓存 TTL: 7 天 */
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class SegmentDiscoveryService {
  private readonly logger = new Logger(SegmentDiscoveryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisCacheService,
  ) {}

  // ==================== 公开方法 ====================

  /**
   * 基于用户特征向量进行 K-Means 聚类，发现新 segment
   *
   * @returns 发现的 segment 列表（含标签、策略建议、置信度）
   */
  async discoverSegments(): Promise<DiscoveredSegment[]> {
    // 1. 提取用户特征
    const features = await this.extractUserFeatures();
    if (features.length < MIN_USERS) {
      this.logger.warn(
        `Not enough users for segment discovery: ${features.length} < ${MIN_USERS}`,
      );
      return [];
    }

    this.logger.log(`Starting segment discovery with ${features.length} users`);

    // 2. K-Means 聚类
    const k = Math.min(10, Math.ceil(features.length / 20));
    const clusters = this.kMeansClustering(features, k);

    // 3. 为每个聚类生成 segment 标签和策略建议
    const discovered: DiscoveredSegment[] = [];
    for (const cluster of clusters) {
      if (cluster.members.length < MIN_CLUSTER_SIZE) continue;

      const label = this.generateSegmentLabel(cluster.centroid);
      const strategy = this.suggestStrategy(cluster.centroid);

      discovered.push({
        label,
        centroid: cluster.centroid,
        memberCount: cluster.members.length,
        suggestedStrategy: strategy,
        confidence: cluster.cohesion,
      });
    }

    // 4. 缓存发现结果到 Redis
    if (discovered.length > 0) {
      try {
        await this.redis.set(DISCOVERED_SEGMENTS_KEY, discovered, CACHE_TTL_MS);
      } catch (err) {
        this.logger.warn(
          `Failed to cache discovered segments: ${(err as Error).message}`,
        );
      }
    }

    this.logger.log(
      `Segment discovery completed: ${discovered.length} segments found from ${clusters.length} clusters`,
    );

    return discovered;
  }

  /**
   * 获取最近一次发现的 segment 结果（从 Redis 缓存读取）
   */
  async getLastDiscoveredSegments(): Promise<DiscoveredSegment[]> {
    try {
      const cached = await this.redis.get<DiscoveredSegment[]>(
        DISCOVERED_SEGMENTS_KEY,
      );
      return cached ?? [];
    } catch {
      return [];
    }
  }

  // ==================== K-Means 聚类实现 ====================

  /**
   * 简化 K-Means（不引入外部 ML 库）
   * 使用 K-Means++ 初始化 + 最多 50 轮迭代
   */
  private kMeansClustering(
    features: UserFeatureVector[],
    k: number,
  ): Cluster[] {
    // K-Means++ 初始化
    const centroids = this.initCentroids(features, k);
    let clusters: Cluster[] = [];

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      // 分配: 每个用户分配到最近的中心
      const assignments = new Map<number, UserFeatureVector[]>();
      for (let i = 0; i < k; i++) assignments.set(i, []);

      for (const f of features) {
        let minDist = Infinity;
        let minIdx = 0;
        for (let i = 0; i < centroids.length; i++) {
          const dist = this.euclideanDist(f.vector, centroids[i]);
          if (dist < minDist) {
            minDist = dist;
            minIdx = i;
          }
        }
        assignments.get(minIdx)!.push(f);
      }

      // 更新中心
      let converged = true;
      for (let i = 0; i < k; i++) {
        const members = assignments.get(i)!;
        if (members.length === 0) continue;
        const newCentroid = this.calcCentroid(members);
        if (
          this.euclideanDist(centroids[i], newCentroid) > CONVERGENCE_THRESHOLD
        ) {
          converged = false;
        }
        centroids[i] = newCentroid;
      }

      clusters = Array.from(assignments.entries()).map(([idx, members]) => ({
        centroid: centroids[idx],
        members,
        cohesion: this.calcCohesion(members, centroids[idx]),
      }));

      if (converged) {
        this.logger.debug(`K-Means converged at iteration ${iter + 1}`);
        break;
      }
    }

    return clusters;
  }

  /**
   * K-Means++ 初始化: 选择 k 个初始中心点
   *
   * 第一个中心随机选取，后续中心按距离概率加权选取，
   * 确保初始中心点分散分布。
   */
  private initCentroids(features: UserFeatureVector[], k: number): number[][] {
    const centroids: number[][] = [];

    // 随机选第一个
    const firstIdx = Math.floor(Math.random() * features.length);
    centroids.push([...features[firstIdx].vector]);

    for (let c = 1; c < k; c++) {
      // 计算每个点到最近中心的距离
      const distances: number[] = features.map((f) => {
        let minDist = Infinity;
        for (const centroid of centroids) {
          const dist = this.euclideanDist(f.vector, centroid);
          if (dist < minDist) minDist = dist;
        }
        return minDist;
      });

      // 距离加权概率选择
      const totalDist = distances.reduce((sum, d) => sum + d * d, 0);
      if (totalDist === 0) {
        // 所有点重合，随机选
        const idx = Math.floor(Math.random() * features.length);
        centroids.push([...features[idx].vector]);
        continue;
      }

      let threshold = Math.random() * totalDist;
      let selectedIdx = 0;
      for (let i = 0; i < distances.length; i++) {
        threshold -= distances[i] * distances[i];
        if (threshold <= 0) {
          selectedIdx = i;
          break;
        }
      }
      centroids.push([...features[selectedIdx].vector]);
    }

    return centroids;
  }

  /**
   * 欧几里得距离
   */
  private euclideanDist(a: number[], b: number[]): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0);
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * 计算成员的中心点（各维度均值）
   */
  private calcCentroid(members: UserFeatureVector[]): number[] {
    const dim = members[0]?.vector.length ?? FEATURE_DIM;
    const sum = new Array(dim).fill(0);
    for (const m of members) {
      for (let i = 0; i < dim; i++) {
        sum[i] += m.vector[i] ?? 0;
      }
    }
    return sum.map((s) => s / members.length);
  }

  /**
   * 计算聚类内聚度 (0-1)
   * 使用 1 / (1 + avgDist) 归一化，值越大表示越紧密
   */
  private calcCohesion(
    members: UserFeatureVector[],
    centroid: number[],
  ): number {
    if (members.length === 0) return 0;
    const totalDist = members.reduce(
      (sum, m) => sum + this.euclideanDist(m.vector, centroid),
      0,
    );
    const avgDist = totalDist / members.length;
    return 1 / (1 + avgDist);
  }

  // ==================== 特征提取 ====================

  /**
   * 从数据库提取用户特征向量（6 维）
   *
   * 特征归一化到 [0, 1] 范围:
   *   1. calorieRatio   = avg(daily_calories) / target_calories（截断到 [0, 2] 再 / 2）
   *   2. complianceRate = compliant_days / total_days
   *   3. processingAvg  = avg(processing_level) / 5（0=全天然, 1=全加工）
   *   4. timingVariance = 1 - min(1, stdev(meal_hour) / 4)（越规律越接近 1）
   *   5. categoryDiv    = unique_categories / 20（截断到 [0, 1]）
   *   6. executionRate  = executed_recommendations / total_recommendations
   */
  private async extractUserFeatures(): Promise<UserFeatureVector[]> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);

    try {
      // 使用原始 SQL 一次性提取所有用户的聚合特征
      const rows = await this.prisma.$queryRaw<
        Array<{
          user_id: string;
          avg_calories: number | null;
          target_calories: number | null;
          compliant_days: bigint | null;
          total_days: bigint | null;
          avg_processing: number | null;
          timing_stdev: number | null;
          unique_categories: bigint | null;
          executed_count: bigint | null;
          recommended_count: bigint | null;
        }>
      >`
        WITH user_daily AS (
          SELECT
            fr.user_id,
            DATE(fr.recorded_at) AS day,
            SUM(fr.calories) AS daily_calories,
            AVG(COALESCE(fr.processing_level, 2)) AS daily_processing,
            EXTRACT(HOUR FROM fr.recorded_at) AS meal_hour
          FROM food_records fr
          WHERE fr.recorded_at >= ${thirtyDaysAgo}
          GROUP BY fr.user_id, DATE(fr.recorded_at), EXTRACT(HOUR FROM fr.recorded_at)
        ),
        user_agg AS (
          SELECT
            ud.user_id,
            AVG(ud.daily_calories) AS avg_calories,
            AVG(ud.daily_processing) AS avg_processing,
            STDDEV(ud.meal_hour) AS timing_stdev,
            COUNT(DISTINCT DATE(ud.day)) AS total_days
          FROM user_daily ud
          GROUP BY ud.user_id
          HAVING COUNT(DISTINCT DATE(ud.day)) >= 7
        ),
        user_targets AS (
          SELECT
            up.user_id,
            up.target_calories
          FROM user_profiles up
          WHERE up.target_calories > 0
        ),
        user_categories AS (
          SELECT
            fr.user_id,
            COUNT(DISTINCT fr.food_category) AS unique_categories
          FROM food_records fr
          WHERE fr.recorded_at >= ${thirtyDaysAgo}
            AND fr.food_category IS NOT NULL
          GROUP BY fr.user_id
        ),
        user_compliance AS (
          SELECT
            ds.user_id,
            COUNT(CASE WHEN ds.compliance_score >= 70 THEN 1 END) AS compliant_days,
            COUNT(*) AS total_days
          FROM daily_summaries ds
          WHERE ds.date >= ${thirtyDaysAgo}
          GROUP BY ds.user_id
        ),
        user_execution AS (
          SELECT
            re.user_id,
            COUNT(CASE WHEN re.executed = true THEN 1 END) AS executed_count,
            COUNT(*) AS recommended_count
          FROM recommendation_executions re
          WHERE re.recommended_at >= ${thirtyDaysAgo}
          GROUP BY re.user_id
        )
        SELECT
          ua.user_id,
          ua.avg_calories,
          ut.target_calories,
          uc.compliant_days,
          uc.total_days,
          ua.avg_processing,
          ua.timing_stdev,
          ucat.unique_categories,
          ue.executed_count,
          ue.recommended_count
        FROM user_agg ua
        LEFT JOIN user_targets ut ON ut.user_id = ua.user_id
        LEFT JOIN user_compliance uc ON uc.user_id = ua.user_id
        LEFT JOIN user_categories ucat ON ucat.user_id = ua.user_id
        LEFT JOIN user_execution ue ON ue.user_id = ua.user_id
      `;

      return rows.map((r) => {
        const targetCal = Number(r.target_calories) || 2000;
        const avgCal = Number(r.avg_calories) || 0;

        // 1. 热量达成率 [0, 1]
        const calorieRatio = Math.min(2, avgCal / targetCal) / 2;

        // 2. 依从率 [0, 1]
        const compliantDays = Number(r.compliant_days) || 0;
        const totalDays = Number(r.total_days) || 1;
        const complianceRate = totalDays > 0 ? compliantDays / totalDays : 0;

        // 3. 加工食品比例 [0, 1]
        const processingAvg = Math.min(1, (Number(r.avg_processing) || 2) / 5);

        // 4. 用餐时间规律性 [0, 1]（stdev 越小越规律）
        const timingStdev = Number(r.timing_stdev) || 2;
        const timingVariance = 1 - Math.min(1, timingStdev / 4);

        // 5. 品类多样性 [0, 1]
        const uniqueCategories = Number(r.unique_categories) || 0;
        const categoryDiv = Math.min(1, uniqueCategories / 20);

        // 6. 执行率 [0, 1]
        const executedCount = Number(r.executed_count) || 0;
        const recommendedCount = Number(r.recommended_count) || 1;
        const executionRate =
          recommendedCount > 0 ? executedCount / recommendedCount : 0.5;

        return {
          userId: r.user_id,
          vector: [
            calorieRatio,
            complianceRate,
            processingAvg,
            timingVariance,
            categoryDiv,
            executionRate,
          ],
        };
      });
    } catch (err) {
      this.logger.error(
        `Failed to extract user features: ${(err as Error).message}`,
      );
      return [];
    }
  }

  // ==================== 标签与策略生成 ====================

  /**
   * 根据聚类中心点生成 segment 标签
   *
   * 标签由多个特征标记组合:
   * - processing: high_processed / whole_food
   * - compliance: high_compliance / low_compliance
   * - execution: low_execution
   * - diversity: diverse / repetitive
   */
  private generateSegmentLabel(centroid: number[]): string {
    const [, compliance, processing, , diversity, execution] = centroid;
    const parts: string[] = [];

    if (processing > 0.6) parts.push('high_processed');
    else if (processing < 0.3) parts.push('whole_food');

    if (compliance > 0.7) parts.push('high_compliance');
    else if (compliance < 0.3) parts.push('low_compliance');

    if (execution !== undefined && execution < 0.4) parts.push('low_execution');

    if (diversity > 0.7) parts.push('diverse');
    else if (diversity < 0.3) parts.push('repetitive');

    return parts.join('_') || 'general';
  }

  /**
   * 根据聚类中心点建议策略
   *
   * 策略建议规则:
   * - 低依从率 + 高加工 → gentle_guidance（温和引导）
   * - 高依从率 → optimization（精细优化）
   * - 高加工食品比例 → quality_upgrade（品质升级）
   * - 其他 → balanced（平衡）
   */
  private suggestStrategy(centroid: number[]): string {
    const [, compliance, processing] = centroid;

    if (compliance < 0.3 && processing > 0.5) return 'gentle_guidance';
    if (compliance > 0.7) return 'optimization';
    if (processing > 0.6) return 'quality_upgrade';
    return 'balanced';
  }
}
