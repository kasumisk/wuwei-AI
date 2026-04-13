import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  GetFoodRecordsQueryDto,
  GetDailyPlansQueryDto,
  GetCoachConversationsQueryDto,
  GetAchievementsQueryDto,
  CreateAchievementDto,
  UpdateAchievementDto,
  GetChallengesQueryDto,
  CreateChallengeDto,
  UpdateChallengeDto,
  GetRecommendationFeedbackQueryDto,
  GetAiDecisionLogsQueryDto,
} from '../dto/content-management.dto';
import { AppDataQueryService } from './app-data-query.service';

@Injectable()
export class ContentManagementService {
  private readonly logger = new Logger(ContentManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly appDataQuery: AppDataQueryService,
  ) {}

  // ==================== 饮食记录管理（委托） ====================

  async findFoodRecords(query: GetFoodRecordsQueryDto) {
    return this.appDataQuery.findFoodRecords(query);
  }

  async getFoodRecordDetail(id: string) {
    return this.appDataQuery.getFoodRecordDetail(id);
  }

  async deleteFoodRecord(id: string) {
    return this.appDataQuery.deleteFoodRecord(id);
  }

  async getFoodRecordStatistics() {
    return this.appDataQuery.getFoodRecordStatistics();
  }

  // ==================== 每日计划管理（委托） ====================

  async findDailyPlans(query: GetDailyPlansQueryDto) {
    return this.appDataQuery.findDailyPlans(query);
  }

  async getDailyPlanDetail(id: string) {
    return this.appDataQuery.getDailyPlanDetail(id);
  }

  // ==================== AI 对话管理（委托） ====================

  async findConversations(query: GetCoachConversationsQueryDto) {
    return this.appDataQuery.findConversations(query);
  }

  async getConversationDetail(id: string) {
    return this.appDataQuery.getConversationDetail(id);
  }

  async deleteConversation(id: string) {
    return this.appDataQuery.deleteConversation(id);
  }

  async getConversationStatistics() {
    return this.appDataQuery.getConversationStatistics();
  }

  // ==================== 成就管理 ====================

  async findAchievements(query: GetAchievementsQueryDto) {
    const { page = 1, pageSize = 20, keyword, category } = query;

    const where: any = {};

    if (keyword) {
      where.OR = [
        { name: { contains: keyword, mode: 'insensitive' } },
        { code: { contains: keyword, mode: 'insensitive' } },
      ];
    }
    if (category) {
      where.category = category;
    }

    const [total, list] = await Promise.all([
      this.prisma.achievements.count({ where }),
      this.prisma.achievements.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // 获取每个成就的解锁人数
    const unlockCounts = await this.prisma.$queryRaw<
      Array<{ achievementId: string; count: bigint }>
    >`SELECT achievement_id as "achievementId", COUNT(*) as count FROM user_achievements GROUP BY achievement_id`;

    const countMap = new Map(
      unlockCounts.map((u) => [u.achievementId, Number(u.count)]),
    );
    const listWithCounts = list.map((a) => ({
      ...a,
      unlockCount: countMap.get(a.id) || 0,
    }));

    return {
      list: listWithCounts,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async createAchievement(dto: CreateAchievementDto) {
    return this.prisma.achievements.create({ data: dto as any });
  }

  async updateAchievement(id: string, dto: UpdateAchievementDto) {
    const achievement = await this.prisma.achievements.findFirst({
      where: { id },
    });
    if (!achievement) throw new NotFoundException('成就不存在');
    return this.prisma.achievements.update({
      where: { id },
      data: dto as any,
    });
  }

  async deleteAchievement(id: string) {
    const achievement = await this.prisma.achievements.findFirst({
      where: { id },
    });
    if (!achievement) throw new NotFoundException('成就不存在');
    await this.prisma.achievements.delete({ where: { id } });
    return { message: '成就已删除' };
  }

  // ==================== 挑战管理 ====================

  async findChallenges(query: GetChallengesQueryDto) {
    const { page = 1, pageSize = 20, keyword, type } = query;

    const where: any = {};

    if (keyword) {
      where.title = { contains: keyword, mode: 'insensitive' };
    }
    if (type) {
      where.type = type;
    }

    const [total, list] = await Promise.all([
      this.prisma.challenges.count({ where }),
      this.prisma.challenges.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    // 获取每个挑战的参与人数
    const joinCounts = await this.prisma.$queryRaw<
      Array<{ challengeId: string; count: bigint }>
    >`SELECT challenge_id as "challengeId", COUNT(*) as count FROM user_challenges GROUP BY challenge_id`;

    const countMap = new Map(
      joinCounts.map((j) => [j.challengeId, Number(j.count)]),
    );
    const listWithCounts = list.map((c) => ({
      ...c,
      participantCount: countMap.get(c.id) || 0,
    }));

    return {
      list: listWithCounts,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async createChallenge(dto: CreateChallengeDto) {
    return this.prisma.challenges.create({ data: dto as any });
  }

  async updateChallenge(id: string, dto: UpdateChallengeDto) {
    const challenge = await this.prisma.challenges.findFirst({
      where: { id },
    });
    if (!challenge) throw new NotFoundException('挑战不存在');
    return this.prisma.challenges.update({
      where: { id },
      data: dto as any,
    });
  }

  async deleteChallenge(id: string) {
    const challenge = await this.prisma.challenges.findFirst({
      where: { id },
    });
    if (!challenge) throw new NotFoundException('挑战不存在');
    await this.prisma.challenges.delete({ where: { id } });
    return { message: '挑战已删除' };
  }

  async toggleChallengeActive(id: string) {
    const challenge = await this.prisma.challenges.findFirst({
      where: { id },
    });
    if (!challenge) throw new NotFoundException('挑战不存在');
    return this.prisma.challenges.update({
      where: { id },
      data: { isActive: !challenge.isActive },
    });
  }

  // ==================== 推荐反馈查询（委托） ====================

  async findRecommendationFeedback(query: GetRecommendationFeedbackQueryDto) {
    return this.appDataQuery.findRecommendationFeedback(query);
  }

  async getFeedbackStatistics() {
    return this.appDataQuery.getFeedbackStatistics();
  }

  // ==================== AI决策日志查询（委托） ====================

  async findAiDecisionLogs(query: GetAiDecisionLogsQueryDto) {
    return this.appDataQuery.findAiDecisionLogs(query);
  }

  async getAiLogStatistics() {
    return this.appDataQuery.getAiLogStatistics();
  }
}
