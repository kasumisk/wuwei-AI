/**
 * V6.1 Phase 3.3 — CandidateAggregationService
 *
 * 候选食物聚合服务 — 负责候选食物之间的去重、合并、高频标记。
 *
 * 职责:
 * 1. 名称层去重: 精确名/别名/规范名匹配，找到可合并的候选
 * 2. 营养接近度检查: 分类一致 + 热量差异 < 15% + 宏量营养差异 < 20%
 * 3. 合并操作: 将低命中候选合并到高命中候选（累加 sourceCount、更新置信度和别名）
 * 4. 高频候选审核触发: 同一候选 7 天内命中 >= 10 次 + 平均置信度 >= 80 → 推入审核队列
 *
 * 设计文档参考:
 * - Section 10.3: 去重策略
 * - Section 10.5: 审核触发条件
 *
 * 调用时机:
 * - AnalysisIngestionService 创建候选后调用 checkAndMerge()
 * - 定时任务（Cron）批量扫描并合并重复候选
 */
import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../../../core/prisma/prisma.service';

// ==================== 去重匹配结果 ====================

/**
 * 候选匹配结果
 */
export interface CandidateMergeResult {
  /** 是否找到了可合并的候选 */
  merged: boolean;
  /** 合并目标候选 ID（如果合并了） */
  targetCandidateId?: string;
  /** 被淘汰的候选 ID（如果合并了） */
  removedCandidateId?: string;
  /** 合并原因 */
  reason?: string;
}

/**
 * 审核检查结果
 */
export interface ReviewCheckResult {
  /** 是否达到审核条件 */
  shouldReview: boolean;
  /** 候选食物 ID */
  candidateId: string;
  /** 原因 */
  reason?: string;
}

// ==================== 常量 ====================

/** 名称相似度阈值（用于简单字符串相似度） */
const NAME_SIMILARITY_THRESHOLD = 0.92;

/** 热量差异阈值 */
const CALORIE_DIFF_THRESHOLD = 0.15;

/** 宏量营养差异阈值 */
const MACRO_DIFF_THRESHOLD = 0.2;

/** 审核触发: 最低命中次数 */
const REVIEW_MIN_HIT_COUNT = 10;

/** 审核触发: 最低平均置信度（0-100 范围） */
const REVIEW_MIN_AVG_CONFIDENCE = 80;

/** 审核触发: 统计窗口天数 */
const REVIEW_WINDOW_DAYS = 7;

@Injectable()
export class CandidateAggregationService {
  private readonly logger = new Logger(CandidateAggregationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // ==================== 公共 API ====================

  /**
   * 检查新创建/更新的候选是否有可合并的重复项
   *
   * 调用时机: AnalysisIngestionService 创建或命中候选后
   *
   * @param candidateId 刚创建/更新的候选 ID
   * @returns 合并结果
   */
  async checkAndMerge(candidateId: string): Promise<CandidateMergeResult> {
    const candidate = await this.prisma.foodCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) {
      return { merged: false, reason: '候选不存在' };
    }

    // 查找可能的重复候选（排除自身）
    const duplicates = await this.findDuplicates(candidate);

    if (duplicates.length === 0) {
      return { merged: false };
    }

    // 选择最佳合并目标: 命中次数最多的那个
    const bestTarget = duplicates.sort(
      (a: any, b: any) => b.sourceCount - a.sourceCount,
    )[0];

    // 如果目标比当前候选命中次数多，把当前合并到目标
    // 否则把目标合并到当前
    const [winner, loser] =
      (bestTarget.sourceCount ?? 0) >= (candidate.sourceCount ?? 0)
        ? [bestTarget, candidate]
        : [candidate, bestTarget];

    await this.mergeCandidates(winner, loser);

    this.logger.log(
      `候选合并: winner=${winner.canonicalName}(${winner.id}), ` +
        `loser=${loser.canonicalName}(${loser.id}), ` +
        `newCount=${winner.sourceCount}`,
    );

    return {
      merged: true,
      targetCandidateId: winner.id,
      removedCandidateId: loser.id,
      reason: `名称相似且营养接近: ${loser.canonicalName} → ${winner.canonicalName}`,
    };
  }

  /**
   * 检查候选是否达到审核条件
   *
   * 审核触发条件（设计文档 Section 10.5）:
   * - 同一候选 7 天内被命中 >= 10 次
   * - 平均置信度 >= 80
   *
   * 注意: "覆盖用户数 >= 5" 需要关联 analysis_food_link → analysis_record → userId，
   * 简化为 sourceCount >= 10（高命中通常意味着多用户）
   *
   * @param candidateId 候选食物 ID
   * @returns 审核检查结果
   */
  async checkReviewEligibility(
    candidateId: string,
  ): Promise<ReviewCheckResult> {
    const candidate = await this.prisma.foodCandidate.findUnique({
      where: { id: candidateId },
    });
    if (!candidate) {
      return { shouldReview: false, candidateId, reason: '候选不存在' };
    }

    // 已在审核流程中的跳过
    if (candidate.reviewStatus !== 'pending') {
      return {
        shouldReview: false,
        candidateId,
        reason: `已在审核流程: ${candidate.reviewStatus}`,
      };
    }

    // 检查窗口期内的命中次数
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - REVIEW_WINDOW_DAYS);

    // 通过 link 表统计窗口期内的命中次数
    const recentHitCount = await this.prisma.analysisFoodLink.count({
      where: {
        foodCandidateId: candidateId,
        createdAt: { gte: windowStart },
      },
    });

    const avgConfidence = Number(candidate.avgConfidence);

    const meetsHitCount = recentHitCount >= REVIEW_MIN_HIT_COUNT;
    const meetsConfidence = avgConfidence >= REVIEW_MIN_AVG_CONFIDENCE;

    if (meetsHitCount && meetsConfidence) {
      this.logger.log(
        `候选达到审核条件: ${candidate.canonicalName}(${candidateId}), ` +
          `recentHits=${recentHitCount}, avgConf=${avgConfidence}`,
      );

      return {
        shouldReview: true,
        candidateId,
        reason: `7天命中${recentHitCount}次, 置信度${avgConfidence}`,
      };
    }

    return {
      shouldReview: false,
      candidateId,
      reason: `未达标: hits=${recentHitCount}/${REVIEW_MIN_HIT_COUNT}, conf=${avgConfidence}/${REVIEW_MIN_AVG_CONFIDENCE}`,
    };
  }

  /**
   * 批量扫描所有 pending 候选，检查审核资格
   *
   * 供 Cron 定时任务调用（Phase 3 后可接入）
   *
   * @returns 达到审核条件的候选 ID 列表
   */
  async batchCheckReviewEligibility(): Promise<string[]> {
    // 只扫描最近活跃的候选（lastSeenAt 在 7 天内）
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - REVIEW_WINDOW_DAYS);

    const activeCandidates = await this.prisma.foodCandidate.findMany({
      where: {
        reviewStatus: 'pending',
        lastSeenAt: { gte: windowStart },
      },
      select: { id: true },
    });

    const eligibleIds: string[] = [];

    for (const candidate of activeCandidates) {
      const result = await this.checkReviewEligibility(candidate.id);
      if (result.shouldReview) {
        eligibleIds.push(candidate.id);
      }
    }

    if (eligibleIds.length > 0) {
      this.logger.log(
        `批量审核检查完成: ${activeCandidates.length} 个候选, ${eligibleIds.length} 个达标`,
      );
    }

    return eligibleIds;
  }

  // ==================== 去重匹配逻辑 ====================

  /**
   * 查找与给定候选可能重复的其他候选
   *
   * 去重策略（设计文档 Section 10.3）:
   * 1. 名称层: 精确名/别名/规范名
   * 2. 营养层: 分类一致 + 热量差异 < 15% + 宏量差异 < 20%
   */
  private async findDuplicates(candidate: any): Promise<any[]> {
    // Step 1: 名称层候选搜索（精确名 + 别名 ILIKE）
    const nameMatches: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM food_candidate
       WHERE id != $1::uuid
         AND review_status = $2
         AND (LOWER(canonical_name) = $3 OR aliases @> $4::jsonb)`,
      candidate.id,
      'pending',
      candidate.canonicalName.toLowerCase(),
      JSON.stringify([candidate.canonicalName]),
    );

    if (nameMatches.length > 0) {
      return nameMatches;
    }

    // Step 2: 模糊名称匹配（trigram 相似度如果数据库支持，这里用应用层简单实现）
    // 只对同分类的候选做模糊名称比较
    if (!candidate.category) return [];

    const sameCategoryCandidates = await this.prisma.foodCandidate.findMany({
      where: {
        category: candidate.category,
        reviewStatus: 'pending',
      },
    });

    const duplicates: any[] = [];

    for (const other of sameCategoryCandidates) {
      if (other.id === candidate.id) continue;

      // 名称相似度检查
      const similarity = this.calculateNameSimilarity(
        candidate.canonicalName,
        other.canonicalName,
      );
      if (similarity < NAME_SIMILARITY_THRESHOLD) continue;

      // 营养接近度检查
      if (this.isNutritionClose(candidate, other)) {
        duplicates.push(other);
      }
    }

    return duplicates;
  }

  /**
   * 合并两个候选: loser → winner
   *
   * 合并操作:
   * 1. 累加 sourceCount
   * 2. 更新平均置信度
   * 3. 合并别名列表
   * 4. 更新 loser 的 link 记录指向 winner
   * 5. 标记 loser 为 REJECTED（避免再次扫描）
   */
  private async mergeCandidates(winner: any, loser: any): Promise<void> {
    // 1. 累加命中次数
    const totalCount = winner.sourceCount + loser.sourceCount;

    // 2. 加权平均置信度
    const winnerAvg = Number(winner.avgConfidence);
    const loserAvg = Number(loser.avgConfidence);
    const newAvg =
      (winnerAvg * winner.sourceCount + loserAvg * loser.sourceCount) /
      totalCount;

    // 3. 合并别名（去重）
    const allAliases = new Set<string>([
      ...(winner.aliases || []),
      ...(loser.aliases || []),
      loser.canonicalName, // loser 的规范名作为 winner 的别名
    ]);
    // 移除与 winner 规范名重复的
    allAliases.delete(winner.canonicalName);

    // 4. 取更高质量分
    const qualityScore =
      Number(loser.qualityScore) > Number(winner.qualityScore)
        ? loser.qualityScore
        : winner.qualityScore;

    // 5. 更新 lastSeenAt
    const lastSeenAt =
      loser.lastSeenAt > winner.lastSeenAt
        ? loser.lastSeenAt
        : winner.lastSeenAt;

    await this.prisma.foodCandidate.update({
      where: { id: winner.id },
      data: {
        sourceCount: totalCount,
        avgConfidence: Math.round(newAvg * 100) / 100,
        aliases: Array.from(allAliases),
        qualityScore: qualityScore,
        lastSeenAt: lastSeenAt,
      },
    });

    // 6. 将 loser 的 link 记录重定向到 winner
    await this.prisma.analysisFoodLink.updateMany({
      where: { foodCandidateId: loser.id },
      data: { foodCandidateId: winner.id },
    });

    // 7. 标记 loser 为 REJECTED（已被合并）
    await this.prisma.foodCandidate.update({
      where: { id: loser.id },
      data: { reviewStatus: 'rejected' },
    });
  }

  // ==================== 相似度计算 ====================

  /**
   * 简单字符串相似度（基于编辑距离的归一化相似度）
   *
   * 范围 0-1，1 = 完全相同
   *
   * 注: 这里用简化的 2-gram 相似度代替完整 Levenshtein（更高效）
   */
  private calculateNameSimilarity(a: string, b: string): number {
    const strA = a.toLowerCase().trim();
    const strB = b.toLowerCase().trim();

    if (strA === strB) return 1.0;
    if (strA.length < 2 || strB.length < 2) return 0;

    // 2-gram（bigram）相似度
    const bigramsA = this.getBigrams(strA);
    const bigramsB = this.getBigrams(strB);

    let intersection = 0;
    const bigramsBCopy = [...bigramsB];

    for (const bigram of bigramsA) {
      const idx = bigramsBCopy.indexOf(bigram);
      if (idx >= 0) {
        intersection++;
        bigramsBCopy.splice(idx, 1);
      }
    }

    return (2 * intersection) / (bigramsA.length + bigramsB.length);
  }

  /**
   * 获取字符串的 bigram 列表
   */
  private getBigrams(str: string): string[] {
    const bigrams: string[] = [];
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.push(str.substring(i, i + 2));
    }
    return bigrams;
  }

  /**
   * 检查两个候选的营养数据是否接近
   *
   * 合并条件（设计文档 Section 10.3）:
   * - 分类一致
   * - 热量差异 < 15%
   * - 宏量营养差异 < 20%
   */
  private isNutritionClose(a: any, b: any): boolean {
    // 分类必须一致
    if (a.category !== b.category) return false;

    const nutA = a.estimatedNutrition;
    const nutB = b.estimatedNutrition;

    // 如果任一没有营养数据，只要分类一致+名称相似就算接近
    if (!nutA || !nutB) return true;

    // 热量差异检查
    if (
      nutA.caloriesPer100g != null &&
      nutB.caloriesPer100g != null &&
      nutA.caloriesPer100g > 0
    ) {
      const calDiff =
        Math.abs(nutA.caloriesPer100g - nutB.caloriesPer100g) /
        nutA.caloriesPer100g;
      if (calDiff > CALORIE_DIFF_THRESHOLD) return false;
    }

    // 宏量营养差异检查（蛋白质/脂肪/碳水任一超过阈值即不通过）
    const macroChecks: [number | undefined, number | undefined][] = [
      [nutA.proteinPer100g, nutB.proteinPer100g],
      [nutA.fatPer100g, nutB.fatPer100g],
      [nutA.carbsPer100g, nutB.carbsPer100g],
    ];

    for (const [valA, valB] of macroChecks) {
      if (valA != null && valB != null && valA > 0) {
        const diff = Math.abs(valA - valB) / valA;
        if (diff > MACRO_DIFF_THRESHOLD) return false;
      }
    }

    return true;
  }
}
