import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  GetAnalysisRecordsQueryDto,
  ReviewAnalysisRecordDto,
} from './dto/analysis-record-management.dto';

@Injectable()
export class AnalysisRecordManagementService {
  private readonly logger = new Logger(AnalysisRecordManagementService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取分析记录列表（分页 + 筛选）
   */
  async findAnalysisRecords(query: GetAnalysisRecordsQueryDto) {
    const {
      page = 1,
      pageSize = 20,
      userId,
      inputType,
      status,
      reviewStatus,
      minConfidence,
      maxConfidence,
      startDate,
      endDate,
      keyword,
    } = query;

    // Build dynamic WHERE clauses
    const conditions: string[] = ['1=1'];
    const params: any[] = [];
    let paramIdx = 1;

    if (userId) {
      conditions.push(`ar.user_id = $${paramIdx++}`);
      params.push(userId);
    }
    if (inputType) {
      conditions.push(`ar.input_type = $${paramIdx++}`);
      params.push(inputType);
    }
    if (status) {
      conditions.push(`ar.status = $${paramIdx++}`);
      params.push(status);
    }
    if (reviewStatus) {
      conditions.push(`ar.review_status = $${paramIdx++}`);
      params.push(reviewStatus);
    }
    if (minConfidence !== undefined) {
      conditions.push(`ar.confidence_score >= $${paramIdx++}`);
      params.push(minConfidence);
    }
    if (maxConfidence !== undefined) {
      conditions.push(`ar.confidence_score <= $${paramIdx++}`);
      params.push(maxConfidence);
    }
    if (startDate) {
      conditions.push(`ar.created_at >= $${paramIdx++}`);
      params.push(startDate);
    }
    if (endDate) {
      conditions.push(`ar.created_at <= $${paramIdx++}`);
      params.push(`${endDate} 23:59:59`);
    }
    if (keyword) {
      conditions.push(`ar.raw_text ILIKE $${paramIdx++}`);
      params.push(`%${keyword}%`);
    }

    const whereClause = conditions.join(' AND ');

    const totalResult = await this.prisma.$queryRawUnsafe<[{ count: string }]>(
      `SELECT COUNT(*)::text AS count FROM food_analysis_records ar WHERE ${whereClause}`,
      ...params,
    );
    const total = parseInt(totalResult[0]?.count ?? '0', 10);

    const offset = (page - 1) * pageSize;
    const list = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM food_analysis_records ar
       WHERE ${whereClause}
       ORDER BY ar.created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      ...params,
      pageSize,
      offset,
    );

    // 批量获取用户信息
    const userIds = [...new Set(list.map((r) => r.userId))];
    const users =
      userIds.length > 0
        ? await this.prisma.appUsers.findMany({
            where: { id: { in: userIds } },
            select: { id: true, nickname: true, avatar: true, email: true },
          })
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const listWithUser = list.map((r) => ({
      ...r,
      user: userMap.get(r.userId) || null,
    }));

    return {
      list: listWithUser,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取分析记录详情
   */
  async getAnalysisRecordDetail(id: string) {
    const record = await this.prisma.foodAnalysisRecords.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException('分析记录不存在');

    // 获取用户信息
    const user = await this.prisma.appUsers.findUnique({
      where: { id: record.userId },
      select: {
        id: true,
        nickname: true,
        avatar: true,
        email: true,
        phone: true,
      },
    });

    return { ...record, user };
  }

  /**
   * 人工审核分析记录
   */
  async reviewAnalysisRecord(
    id: string,
    dto: ReviewAnalysisRecordDto,
    adminUserId: string,
  ) {
    const record = await this.prisma.foodAnalysisRecords.findUnique({
      where: { id },
    });
    if (!record) throw new NotFoundException('分析记录不存在');

    const updated = await this.prisma.foodAnalysisRecords.update({
      where: { id },
      data: {
        reviewStatus: dto.reviewStatus,
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote || null,
      } as any,
    });
    return updated;
  }

  /**
   * 分析记录统计
   */
  async getAnalysisStatistics() {
    // 总量统计
    const [totalCount, textCount, imageCount] = await Promise.all([
      this.prisma.foodAnalysisRecords.count(),
      this.prisma.foodAnalysisRecords.count({
        where: { inputType: 'text' },
      }),
      this.prisma.foodAnalysisRecords.count({
        where: { inputType: 'image' },
      }),
    ]);

    // 今日统计
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await this.prisma.foodAnalysisRecords.count({
      where: { createdAt: { gte: today } },
    });

    // 状态分布
    const statusDist = await this.prisma.$queryRawUnsafe<
      { status: string; count: string }[]
    >(
      `SELECT status, COUNT(*)::text AS count FROM food_analysis_records GROUP BY status`,
    );

    // 审核状态分布
    const reviewDist = await this.prisma.$queryRawUnsafe<
      { reviewStatus: string; count: string }[]
    >(
      `SELECT review_status AS "reviewStatus", COUNT(*)::text AS count FROM food_analysis_records GROUP BY review_status`,
    );

    // 置信度分布 (0-20, 20-40, 40-60, 60-80, 80-100)
    const confidenceDist = await this.prisma.$queryRawUnsafe<
      { range: string; count: string }[]
    >(
      `SELECT
        CASE
          WHEN confidence_score < 20 THEN '0-20'
          WHEN confidence_score < 40 THEN '20-40'
          WHEN confidence_score < 60 THEN '40-60'
          WHEN confidence_score < 80 THEN '60-80'
          ELSE '80-100'
        END AS range,
        COUNT(*)::text AS count
       FROM food_analysis_records
       WHERE confidence_score IS NOT NULL
       GROUP BY range`,
    );

    // 准确率（已审核的记录中准确的占比）
    const [reviewedCount, accurateCount] = await Promise.all([
      this.prisma.foodAnalysisRecords.count({
        where: { reviewStatus: { not: 'pending' } } as any,
      }),
      this.prisma.foodAnalysisRecords.count({
        where: { reviewStatus: 'accurate' } as any,
      }),
    ]);
    const accuracyRate =
      reviewedCount > 0 ? (accurateCount / reviewedCount) * 100 : 0;

    return {
      total: totalCount,
      todayCount,
      textCount,
      imageCount,
      textRatio:
        totalCount > 0 ? ((textCount / totalCount) * 100).toFixed(1) : '0',
      imageRatio:
        totalCount > 0 ? ((imageCount / totalCount) * 100).toFixed(1) : '0',
      statusDistribution: statusDist,
      reviewDistribution: reviewDist,
      confidenceDistribution: confidenceDist,
      accuracyRate: accuracyRate.toFixed(1),
      reviewedCount,
    };
  }

  /**
   * 热门分析食物排名
   */
  async getPopularAnalyzedFoods(limit: number = 20) {
    // 从 raw_text 中提取食物名称并聚合
    const results = await this.prisma.$queryRawUnsafe<
      { rawText: string; count: string }[]
    >(
      `SELECT raw_text AS "rawText", COUNT(*)::text AS count
       FROM food_analysis_records
       WHERE input_type = 'text'
         AND status = 'completed'
         AND raw_text IS NOT NULL
       GROUP BY raw_text
       ORDER BY COUNT(*) DESC
       LIMIT $1`,
      limit,
    );

    return results;
  }
}
