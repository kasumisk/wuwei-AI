import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodAnalysisRecord } from '../entities/food-analysis-record.entity';
import { AppUser } from '../../user/entities/app-user.entity';
import {
  GetAnalysisRecordsQueryDto,
  ReviewAnalysisRecordDto,
} from './dto/analysis-record-management.dto';

@Injectable()
export class AnalysisRecordManagementService {
  private readonly logger = new Logger(AnalysisRecordManagementService.name);

  constructor(
    @InjectRepository(FoodAnalysisRecord)
    private readonly analysisRepo: Repository<FoodAnalysisRecord>,
    @InjectRepository(AppUser)
    private readonly appUserRepo: Repository<AppUser>,
  ) {}

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

    const qb = this.analysisRepo
      .createQueryBuilder('ar')
      .orderBy('ar.created_at', 'DESC');

    if (userId) {
      qb.andWhere('ar.user_id = :userId', { userId });
    }
    if (inputType) {
      qb.andWhere('ar.input_type = :inputType', { inputType });
    }
    if (status) {
      qb.andWhere('ar.status = :status', { status });
    }
    if (reviewStatus) {
      qb.andWhere('ar.review_status = :reviewStatus', { reviewStatus });
    }
    if (minConfidence !== undefined) {
      qb.andWhere('ar.confidence_score >= :minConfidence', { minConfidence });
    }
    if (maxConfidence !== undefined) {
      qb.andWhere('ar.confidence_score <= :maxConfidence', { maxConfidence });
    }
    if (startDate) {
      qb.andWhere('ar.created_at >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('ar.created_at <= :endDate', {
        endDate: `${endDate} 23:59:59`,
      });
    }
    if (keyword) {
      qb.andWhere('ar.raw_text ILIKE :keyword', { keyword: `%${keyword}%` });
    }

    const total = await qb.getCount();
    const list = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    // 批量获取用户信息
    const userIds = [...new Set(list.map((r) => r.userId))];
    const users =
      userIds.length > 0
        ? await this.appUserRepo
            .createQueryBuilder('u')
            .select(['u.id', 'u.nickname', 'u.avatar', 'u.email'])
            .whereInIds(userIds)
            .getMany()
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
    const record = await this.analysisRepo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('分析记录不存在');

    // 获取用户信息
    const user = await this.appUserRepo.findOne({
      where: { id: record.userId },
      select: ['id', 'nickname', 'avatar', 'email', 'phone'],
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
    const record = await this.analysisRepo.findOne({ where: { id } });
    if (!record) throw new NotFoundException('分析记录不存在');

    record.reviewStatus = dto.reviewStatus;
    record.reviewedBy = adminUserId;
    record.reviewedAt = new Date();
    record.reviewNote = dto.reviewNote || null;

    await this.analysisRepo.save(record);
    return record;
  }

  /**
   * 分析记录统计
   */
  async getAnalysisStatistics() {
    // 总量统计
    const totalCount = await this.analysisRepo.count();
    const textCount = await this.analysisRepo.count({
      where: { inputType: 'text' },
    });
    const imageCount = await this.analysisRepo.count({
      where: { inputType: 'image' },
    });

    // 今日统计
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayCount = await this.analysisRepo
      .createQueryBuilder('ar')
      .where('ar.created_at >= :today', { today })
      .getCount();

    // 状态分布
    const statusDist = await this.analysisRepo
      .createQueryBuilder('ar')
      .select('ar.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ar.status')
      .getRawMany();

    // 审核状态分布
    const reviewDist = await this.analysisRepo
      .createQueryBuilder('ar')
      .select('ar.review_status', 'reviewStatus')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ar.review_status')
      .getRawMany();

    // 置信度分布 (0-20, 20-40, 40-60, 60-80, 80-100)
    const confidenceDist = await this.analysisRepo
      .createQueryBuilder('ar')
      .select(
        `CASE 
          WHEN confidence_score < 20 THEN '0-20'
          WHEN confidence_score < 40 THEN '20-40'
          WHEN confidence_score < 60 THEN '40-60'
          WHEN confidence_score < 80 THEN '60-80'
          ELSE '80-100'
        END`,
        'range',
      )
      .addSelect('COUNT(*)', 'count')
      .where('ar.confidence_score IS NOT NULL')
      .groupBy('range')
      .getRawMany();

    // 准确率（已审核的记录中准确的占比）
    const reviewedCount = await this.analysisRepo
      .createQueryBuilder('ar')
      .where('ar.review_status != :pending', { pending: 'pending' })
      .getCount();
    const accurateCount = await this.analysisRepo
      .createQueryBuilder('ar')
      .where('ar.review_status = :accurate', { accurate: 'accurate' })
      .getCount();
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
    // 从 recognized_payload 中提取食物名称并聚合
    const results = await this.analysisRepo
      .createQueryBuilder('ar')
      .select('ar.raw_text', 'rawText')
      .addSelect('COUNT(*)', 'count')
      .where('ar.input_type = :type', { type: 'text' })
      .andWhere('ar.status = :status', { status: 'completed' })
      .andWhere('ar.raw_text IS NOT NULL')
      .groupBy('ar.raw_text')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany();

    return results;
  }
}
