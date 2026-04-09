import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodRecord } from '../../entities/food-record.entity';
import { DailyPlan } from '../../entities/daily-plan.entity';
import { DailySummary } from '../../entities/daily-summary.entity';
import { CoachConversation } from '../../entities/coach-conversation.entity';
import { CoachMessage } from '../../entities/coach-message.entity';
import { RecommendationFeedback } from '../../entities/recommendation-feedback.entity';
import { AiDecisionLog } from '../../entities/ai-decision-log.entity';
import {
  GetFoodRecordsQueryDto,
  GetDailyPlansQueryDto,
  GetCoachConversationsQueryDto,
  GetRecommendationFeedbackQueryDto,
  GetAiDecisionLogsQueryDto,
} from '../dto/content-management.dto';

/**
 * Admin 侧访问 App 数据的统一数据查询服务。
 * 将原 ContentManagementService 中对 App 实体的直接 Repository 操作集中到此处，
 * 使 ContentManagementService 不再直接持有 App 实体的 Repository。
 */
@Injectable()
export class AppDataQueryService {
  private readonly logger = new Logger(AppDataQueryService.name);

  constructor(
    @InjectRepository(FoodRecord)
    private readonly foodRecordRepo: Repository<FoodRecord>,
    @InjectRepository(DailyPlan)
    private readonly dailyPlanRepo: Repository<DailyPlan>,
    @InjectRepository(DailySummary)
    private readonly dailySummaryRepo: Repository<DailySummary>,
    @InjectRepository(CoachConversation)
    private readonly conversationRepo: Repository<CoachConversation>,
    @InjectRepository(CoachMessage)
    private readonly messageRepo: Repository<CoachMessage>,
    @InjectRepository(RecommendationFeedback)
    private readonly feedbackRepo: Repository<RecommendationFeedback>,
    @InjectRepository(AiDecisionLog)
    private readonly aiLogRepo: Repository<AiDecisionLog>,
  ) {}

  // ==================== 饮食记录 ====================

  async findFoodRecords(query: GetFoodRecordsQueryDto) {
    const {
      page = 1,
      pageSize = 20,
      userId,
      mealType,
      startDate,
      endDate,
      keyword,
    } = query;
    const qb = this.foodRecordRepo
      .createQueryBuilder('r')
      .leftJoinAndSelect('r.user', 'user');

    if (userId) {
      qb.andWhere('r.user_id = :userId', { userId });
    }
    if (mealType) {
      qb.andWhere('r.meal_type = :mealType', { mealType });
    }
    if (startDate) {
      qb.andWhere('r.recorded_at >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('r.recorded_at <= :endDate', {
        endDate: `${endDate} 23:59:59`,
      });
    }
    if (keyword) {
      qb.andWhere('r.foods::text ILIKE :kw', { kw: `%${keyword}%` });
    }

    qb.orderBy('r.recordedAt', 'DESC');
    const total = await qb.getCount();
    const list = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getFoodRecordDetail(id: string) {
    const record = await this.foodRecordRepo.findOne({
      where: { id },
      relations: ['user'],
    });
    if (!record) throw new NotFoundException('饮食记录不存在');
    return record;
  }

  async deleteFoodRecord(id: string) {
    const record = await this.getFoodRecordDetail(id);
    await this.foodRecordRepo.remove(record);
    return { message: '饮食记录已删除' };
  }

  async getFoodRecordStatistics() {
    const total = await this.foodRecordRepo.count();
    const today = new Date().toISOString().split('T')[0];
    const todayCount = await this.foodRecordRepo
      .createQueryBuilder('r')
      .where('DATE(r.recorded_at) = :today', { today })
      .getCount();

    const byMealType = await this.foodRecordRepo
      .createQueryBuilder('r')
      .select('r.meal_type', 'mealType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.meal_type')
      .getRawMany();

    return { total, todayCount, byMealType };
  }

  // ==================== 每日计划 ====================

  async findDailyPlans(query: GetDailyPlansQueryDto) {
    const { page = 1, pageSize = 20, userId, startDate, endDate } = query;
    const qb = this.dailyPlanRepo.createQueryBuilder('p');

    if (userId) {
      qb.andWhere('p.user_id = :userId', { userId });
    }
    if (startDate) {
      qb.andWhere('p.date >= :startDate', { startDate });
    }
    if (endDate) {
      qb.andWhere('p.date <= :endDate', { endDate });
    }

    qb.orderBy('p.date', 'DESC').addOrderBy('p.createdAt', 'DESC');
    const total = await qb.getCount();
    const list = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getDailyPlanDetail(id: string) {
    const plan = await this.dailyPlanRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('每日计划不存在');
    return plan;
  }

  // ==================== AI 对话 ====================

  async findConversations(query: GetCoachConversationsQueryDto) {
    const { page = 1, pageSize = 20, userId, keyword } = query;
    const qb = this.conversationRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.user', 'user');

    if (userId) {
      qb.andWhere('c.user_id = :userId', { userId });
    }
    if (keyword) {
      qb.andWhere('c.title ILIKE :kw', { kw: `%${keyword}%` });
    }

    qb.orderBy('c.updatedAt', 'DESC');
    const total = await qb.getCount();
    const list = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getConversationDetail(id: string) {
    const conversation = await this.conversationRepo.findOne({
      where: { id },
      relations: ['user', 'messages'],
    });
    if (!conversation) throw new NotFoundException('对话不存在');

    conversation.messages?.sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

    return conversation;
  }

  async deleteConversation(id: string) {
    const conversation = await this.conversationRepo.findOne({ where: { id } });
    if (!conversation) throw new NotFoundException('对话不存在');
    await this.conversationRepo.remove(conversation);
    return { message: '对话已删除' };
  }

  async getConversationStatistics() {
    const total = await this.conversationRepo.count();
    const totalMessages = await this.messageRepo.count();
    const totalTokens = await this.messageRepo
      .createQueryBuilder('m')
      .select('SUM(m.tokens_used)', 'total')
      .getRawOne();

    return {
      totalConversations: total,
      totalMessages,
      totalTokensUsed: parseInt(totalTokens?.total || '0'),
    };
  }

  // ==================== 推荐反馈 ====================

  async findRecommendationFeedback(query: GetRecommendationFeedbackQueryDto) {
    const { page = 1, pageSize = 20, userId, action, mealType } = query;
    const qb = this.feedbackRepo.createQueryBuilder('f');

    if (userId) {
      qb.andWhere('f.user_id = :userId', { userId });
    }
    if (action) {
      qb.andWhere('f.action = :action', { action });
    }
    if (mealType) {
      qb.andWhere('f.mealType = :mealType', { mealType });
    }

    qb.orderBy('f.createdAt', 'DESC');
    const total = await qb.getCount();
    const list = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getFeedbackStatistics() {
    const total = await this.feedbackRepo.count();
    const byAction = await this.feedbackRepo
      .createQueryBuilder('f')
      .select('f.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.action')
      .getRawMany();

    const acceptRate = byAction.find((a) => a.action === 'accepted');
    return {
      total,
      byAction,
      acceptRate:
        total > 0
          ? ((parseInt(acceptRate?.count || '0') / total) * 100).toFixed(1)
          : '0',
    };
  }

  // ==================== AI 决策日志 ====================

  async findAiDecisionLogs(query: GetAiDecisionLogsQueryDto) {
    const { page = 1, pageSize = 20, userId, decision, riskLevel } = query;
    const qb = this.aiLogRepo.createQueryBuilder('l');

    if (userId) {
      qb.andWhere('l.user_id = :userId', { userId });
    }
    if (decision) {
      qb.andWhere('l.decision = :decision', { decision });
    }
    if (riskLevel) {
      qb.andWhere('l.risk_level = :riskLevel', { riskLevel });
    }

    qb.orderBy('l.createdAt', 'DESC');
    const total = await qb.getCount();
    const list = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getAiLogStatistics() {
    const total = await this.aiLogRepo.count();
    const byDecision = await this.aiLogRepo
      .createQueryBuilder('l')
      .select('l.decision', 'decision')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.decision')
      .getRawMany();

    const byRisk = await this.aiLogRepo
      .createQueryBuilder('l')
      .select('l.risk_level', 'riskLevel')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.risk_level')
      .getRawMany();

    return { total, byDecision, byRisk };
  }
}
