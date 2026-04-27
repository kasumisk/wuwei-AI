import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { I18nService } from '../../../core/i18n';
import {
  GetAnalysisRecordsQueryDto,
  ReviewAnalysisRecordDto,
} from './dto/analysis-record-management.dto';

@Injectable()
export class AnalysisRecordManagementService {
  private readonly logger = new Logger(AnalysisRecordManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  private mapStoredReviewStatusToApi(
    reviewStatus?: string | null,
  ): 'pending' | 'approved' | 'rejected' {
    switch (reviewStatus) {
      case 'accurate':
      case 'approved':
        return 'approved';
      case 'inaccurate':
      case 'rejected':
        return 'rejected';
      default:
        return 'pending';
    }
  }

  private mapApiReviewStatusToStored(
    reviewStatus: 'pending' | 'approved' | 'rejected',
  ): 'pending' | 'accurate' | 'inaccurate' {
    switch (reviewStatus) {
      case 'approved':
        return 'accurate';
      case 'rejected':
        return 'inaccurate';
      default:
        return 'pending';
    }
  }

  private normalizeConfidence(value: unknown): number {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric) || numeric <= 0) {
      return 0;
    }
    return numeric > 1 ? numeric / 100 : numeric;
  }

  private serializeAnalysisRecord(record: any, user?: any) {
    const resolvedUser = user ?? record.user ?? null;

    return {
      id: record.id,
      userId: record.userId ?? record.user_id,
      user: resolvedUser,
      inputType: record.inputType ?? record.input_type,
      rawInput: record.rawInput ?? record.rawText ?? record.raw_text ?? null,
      imageUrl: record.imageUrl ?? record.image_url ?? null,
      mealType: record.mealType ?? record.meal_type ?? null,
      status: record.status,
      recognizedPayload:
        record.recognizedPayload ?? record.recognized_payload ?? null,
      normalizedPayload:
        record.normalizedPayload ?? record.normalized_payload ?? null,
      nutritionPayload:
        record.nutritionPayload ?? record.nutrition_payload ?? null,
      decisionPayload:
        record.decisionPayload ?? record.decision_payload ?? null,
      confidenceScore: this.normalizeConfidence(
        record.confidenceScore ?? record.confidence_score,
      ),
      qualityScore: this.normalizeConfidence(
        record.qualityScore ?? record.quality_score,
      ),
      matchedFoodCount:
        Number(record.matchedFoodCount ?? record.matched_food_count ?? 0) || 0,
      candidateFoodCount:
        Number(record.candidateFoodCount ?? record.candidate_food_count ?? 0) ||
        0,
      persistStatus: record.persistStatus ?? record.persist_status ?? null,
      sourceRequestId:
        record.sourceRequestId ?? record.source_request_id ?? null,
      reviewStatus: this.mapStoredReviewStatusToApi(
        record.reviewStatus ?? record.review_status,
      ),
      reviewedBy: record.reviewedBy ?? record.reviewed_by ?? null,
      reviewedAt: record.reviewedAt ?? record.reviewed_at ?? null,
      reviewNote: record.reviewNote ?? record.review_note ?? null,
      createdAt: record.createdAt ?? record.created_at,
      updatedAt: record.updatedAt ?? record.created_at ?? null,
    };
  }

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
      if (reviewStatus === 'pending') {
        conditions.push(
          `COALESCE(ar.review_status, 'pending') = $${paramIdx++}`,
        );
        params.push('pending');
      } else {
        conditions.push(`ar.review_status = $${paramIdx++}`);
        params.push(this.mapApiReviewStatusToStored(reviewStatus as any));
      }
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
    // R2 修复：LIMIT/OFFSET 占位符必须在模板字符串外分两步生成，
    // 避免同一表达式内 paramIdx++ 被求值两次产生相同索引
    const limitIdx = paramIdx++;
    const offsetIdx = paramIdx++;
    const list = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM food_analysis_records ar
       WHERE ${whereClause}
       ORDER BY ar.created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      ...params,
      pageSize,
      offset,
    );

    // R3 修复：$queryRawUnsafe 返回 snake_case 列名，用 r.user_id 访问
    const userIds = [...new Set(list.map((r) => r.user_id).filter(Boolean))];
    // 批量获取用户信息
    const users =
      userIds.length > 0
        ? await this.prisma.appUsers.findMany({
            where: { id: { in: userIds } },
            select: { id: true, nickname: true, avatar: true, email: true },
          })
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const listWithUser = list.map((r) =>
      this.serializeAnalysisRecord(r, userMap.get(r.user_id) || null),
    );

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
    if (!record)
      throw new NotFoundException(this.i18n.t('food.analysisRecordNotFound'));

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

    return this.serializeAnalysisRecord(record, user);
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
    if (!record)
      throw new NotFoundException(this.i18n.t('food.analysisRecordNotFound'));

    const updated = await this.prisma.foodAnalysisRecords.update({
      where: { id },
      data: {
        reviewStatus: this.mapApiReviewStatusToStored(dto.reviewStatus),
        reviewedBy: adminUserId,
        reviewedAt: new Date(),
        reviewNote: dto.reviewNote || null,
      } as any,
    });
    return this.serializeAnalysisRecord(updated);
  }

  /**
   * 分析记录统计
   */
  async getAnalysisStatistics() {
    // 总量统计
    const [totalCount, textCount, imageCount, avgConfidenceRow] =
      await Promise.all([
        this.prisma.foodAnalysisRecords.count(),
        this.prisma.foodAnalysisRecords.count({
          where: { inputType: 'text' },
        }),
        this.prisma.foodAnalysisRecords.count({
          where: { inputType: 'image' },
        }),
        this.prisma.$queryRawUnsafe<[{ avg: string | null }]>(
          `SELECT AVG(confidence_score)::text AS avg FROM food_analysis_records WHERE confidence_score IS NOT NULL`,
        ),
      ]);

    // 今日统计
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await this.prisma.foodAnalysisRecords.count({
      where: { createdAt: { gte: today } },
    });

    // 状态分布
    const reviewDist = await this.prisma.$queryRawUnsafe<
      { reviewStatus: string; count: string }[]
    >(
      `SELECT review_status AS "reviewStatus", COUNT(*)::text AS count FROM food_analysis_records GROUP BY review_status`,
    );

    const reviewMap = reviewDist.reduce<Record<string, number>>((acc, item) => {
      const key = this.mapStoredReviewStatusToApi(item.reviewStatus);
      acc[key] = (acc[key] ?? 0) + Number(item.count || 0);
      return acc;
    }, {});

    return {
      total: totalCount,
      todayCount,
      avgConfidence: this.normalizeConfidence(avgConfidenceRow[0]?.avg),
      byInputType: {
        text: textCount,
        image: imageCount,
      },
      byReviewStatus: {
        pending: reviewMap.pending ?? 0,
        approved: reviewMap.approved ?? 0,
        rejected: reviewMap.rejected ?? 0,
      },
    };
  }

  /**
   * 热门分析食物排名
   */
  async getPopularAnalyzedFoods(limit: number = 20, days: number = 7) {
    // 从 raw_text 中提取食物名称并聚合
    const results = await this.prisma.$queryRawUnsafe<
      { foodName: string; count: string; avgConfidence: string | null }[]
    >(
      `SELECT raw_text AS "foodName", COUNT(*)::text AS count, AVG(confidence_score)::text AS "avgConfidence"
       FROM food_analysis_records
       WHERE input_type = 'text'
         AND status = 'completed'
         AND raw_text IS NOT NULL
         AND created_at >= NOW() - ($2::int * INTERVAL '1 day')
       GROUP BY raw_text
       ORDER BY COUNT(*) DESC
       LIMIT $1`,
      limit,
      Math.max(days, 1),
    );

    return results.map((item) => ({
      foodName: item.foodName,
      count: Number(item.count || 0),
      avgConfidence: this.normalizeConfidence(item.avgConfidence),
    }));
  }
}
