import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { I18nService } from '../../../../core/i18n';
import { Prisma } from '@prisma/client';
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
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  // ==================== 饮食记录 ====================

  async findFoodRecords(query: GetFoodRecordsQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    const { userId, mealType, startDate, endDate, keyword } = query;

    const where: any = {};

    if (userId) {
      where.userId = userId;
    }
    if (mealType) {
      where.mealType = mealType;
    }
    if (startDate || endDate) {
      where.recordedAt = {};
      if (startDate) {
        where.recordedAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.recordedAt.lte = new Date(`${endDate} 23:59:59`);
      }
    }

    // For keyword search on JSONB 'foods' column, use raw SQL filter
    // Prisma doesn't natively support ILIKE on cast jsonb::text
    if (keyword) {
      where.AND = [
        {
          foods: {
            string_contains: keyword,
          },
        },
      ];
    }

    const [total, list] = await Promise.all([
      keyword
        ? this.prisma.$queryRaw<[{ count: bigint }]>`
            SELECT COUNT(*) as count FROM food_records
            WHERE foods::text ILIKE ${'%' + keyword + '%'}
            ${userId ? Prisma.sql`AND user_id = ${userId}::uuid` : Prisma.empty}
            ${mealType ? Prisma.sql`AND meal_type = ${mealType}` : Prisma.empty}
            ${startDate ? Prisma.sql`AND recorded_at >= ${new Date(startDate)}` : Prisma.empty}
            ${endDate ? Prisma.sql`AND recorded_at <= ${new Date(`${endDate} 23:59:59`)}` : Prisma.empty}
          `.then((rows) => Number(rows[0]?.count ?? 0))
        : this.prisma.foodRecords.count({
            where: (() => {
              const w = { ...where };
              delete w.AND;
              return w;
            })(),
          }),
      keyword
        ? this.prisma.$queryRaw<any[]>`
            SELECT r.*, row_to_json(u.*) as user FROM food_records r
            LEFT JOIN users u ON r.user_id = u.id
            WHERE r.foods::text ILIKE ${'%' + keyword + '%'}
            ${userId ? Prisma.sql`AND r.user_id = ${userId}::uuid` : Prisma.empty}
            ${mealType ? Prisma.sql`AND r.meal_type = ${mealType}` : Prisma.empty}
            ${startDate ? Prisma.sql`AND r.recorded_at >= ${new Date(startDate)}` : Prisma.empty}
            ${endDate ? Prisma.sql`AND r.recorded_at <= ${new Date(`${endDate} 23:59:59`)}` : Prisma.empty}
            ORDER BY r.recorded_at DESC
            OFFSET ${(page - 1) * pageSize}
            LIMIT ${pageSize}
          `
        : this.prisma.foodRecords.findMany({
            where: (() => {
              const w = { ...where };
              delete w.AND;
              return w;
            })(),
            include: { appUsers: true },
            orderBy: { recordedAt: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getFoodRecordDetail(id: string) {
    const record = await this.prisma.foodRecords.findFirst({
      where: { id },
      include: { appUsers: true },
    });
    if (!record)
      throw new NotFoundException(this.i18n.t('diet.dietRecordNotFound'));
    return record;
  }

  async deleteFoodRecord(id: string) {
    await this.getFoodRecordDetail(id);
    await this.prisma.foodRecords.delete({ where: { id } });
    return { message: this.i18n.t('diet.dietRecordDeleted') };
  }

  async getFoodRecordStatistics() {
    const total = await this.prisma.foodRecords.count();

    const todayCountResult = await this.prisma.$queryRaw<
      [{ count: bigint }]
    >`SELECT COUNT(*) as count FROM food_records WHERE DATE(recorded_at) = CURRENT_DATE`;
    const todayCount = Number(todayCountResult[0]?.count ?? 0);

    const byMealType = await this.prisma.$queryRaw<
      Array<{ mealType: string; count: bigint }>
    >`SELECT meal_type as "mealType", COUNT(*) as count FROM food_records GROUP BY meal_type`;

    return {
      total,
      todayCount,
      byMealType: byMealType.map((r) => ({
        mealType: r.mealType,
        count: Number(r.count),
      })),
    };
  }

  // ==================== 每日计划 ====================

  async findDailyPlans(query: GetDailyPlansQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    const { userId, startDate, endDate } = query;

    const where: any = {};

    if (userId) {
      where.userId = userId;
    }
    if (startDate || endDate) {
      where.date = {};
      if (startDate) {
        where.date.gte = startDate;
      }
      if (endDate) {
        where.date.lte = endDate;
      }
    }

    const [total, list] = await Promise.all([
      this.prisma.dailyPlans.count({ where }),
      this.prisma.dailyPlans.findMany({
        where,
        orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getDailyPlanDetail(id: string) {
    const plan = await this.prisma.dailyPlans.findFirst({ where: { id } });
    if (!plan)
      throw new NotFoundException(this.i18n.t('diet.dailyPlanNotFound'));
    return plan;
  }

  // ==================== AI 对话 ====================

  async findConversations(query: GetCoachConversationsQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    const { userId, keyword } = query;

    const where: any = {};

    if (userId) {
      where.userId = userId;
    }
    if (keyword) {
      where.title = { contains: keyword, mode: 'insensitive' };
    }

    const [total, list] = await Promise.all([
      this.prisma.coachConversations.count({ where }),
      this.prisma.coachConversations.findMany({
        where,
        include: { appUsers: true },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getConversationDetail(id: string) {
    const conversation = await this.prisma.coachConversations.findFirst({
      where: { id },
      include: {
        appUsers: true,
        coachMessages: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!conversation)
      throw new NotFoundException(this.i18n.t('diet.conversationNotFound'));

    return conversation;
  }

  async deleteConversation(id: string) {
    const conversation = await this.prisma.coachConversations.findFirst({
      where: { id },
    });
    if (!conversation)
      throw new NotFoundException(this.i18n.t('diet.conversationNotFound'));
    await this.prisma.coachConversations.delete({ where: { id } });
    return { message: this.i18n.t('diet.conversationDeleted') };
  }

  async getConversationStatistics() {
    const total = await this.prisma.coachConversations.count();
    const totalMessages = await this.prisma.coachMessages.count();

    const totalTokens = await this.prisma.$queryRaw<
      [{ total: bigint | null }]
    >`SELECT SUM(tokens_used) as total FROM coach_messages`;

    return {
      totalConversations: total,
      totalMessages,
      totalTokensUsed: Number(totalTokens[0]?.total ?? 0),
    };
  }

  // ==================== 推荐反馈 ====================

  async findRecommendationFeedback(query: GetRecommendationFeedbackQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    const { userId, action, mealType } = query;

    const where: any = {};

    if (userId) {
      where.userId = userId;
    }
    if (action) {
      where.action = action;
    }
    if (mealType) {
      where.mealType = mealType;
    }

    const [total, list] = await Promise.all([
      this.prisma.recommendationFeedbacks.count({ where }),
      this.prisma.recommendationFeedbacks.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getFeedbackStatistics() {
    const total = await this.prisma.recommendationFeedbacks.count();

    const byAction = await this.prisma.$queryRaw<
      Array<{ action: string; count: bigint }>
    >`SELECT action, COUNT(*) as count FROM recommendation_feedbacks GROUP BY action`;

    const byActionMapped = byAction.map((a) => ({
      action: a.action,
      count: Number(a.count),
    }));

    const acceptRate = byActionMapped.find((a) => a.action === 'accepted');
    return {
      total,
      byAction: byActionMapped,
      acceptRate:
        total > 0 ? (((acceptRate?.count || 0) / total) * 100).toFixed(1) : '0',
    };
  }

  // ==================== AI 决策日志 ====================

  async findAiDecisionLogs(query: GetAiDecisionLogsQueryDto) {
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;
    const { userId, decision, riskLevel } = query;

    const where: any = {};

    if (userId) {
      where.userId = userId;
    }
    if (decision) {
      where.decision = decision;
    }
    if (riskLevel) {
      where.riskLevel = riskLevel;
    }

    const [total, list] = await Promise.all([
      this.prisma.aiDecisionLogs.count({ where }),
      this.prisma.aiDecisionLogs.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async getAiLogStatistics() {
    const total = await this.prisma.aiDecisionLogs.count();

    const byDecision = await this.prisma.$queryRaw<
      Array<{ decision: string; count: bigint }>
    >`SELECT decision, COUNT(*) as count FROM ai_decision_logs GROUP BY decision`;

    const byRisk = await this.prisma.$queryRaw<
      Array<{ riskLevel: string; count: bigint }>
    >`SELECT risk_level as "riskLevel", COUNT(*) as count FROM ai_decision_logs GROUP BY risk_level`;

    return {
      total,
      byDecision: byDecision.map((d) => ({
        decision: d.decision,
        count: Number(d.count),
      })),
      byRisk: byRisk.map((r) => ({
        riskLevel: r.riskLevel,
        count: Number(r.count),
      })),
    };
  }
}
