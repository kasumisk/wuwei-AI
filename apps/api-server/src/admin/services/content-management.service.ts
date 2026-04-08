import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodRecord } from '../../entities/food-record.entity';
import { DailyPlan } from '../../entities/daily-plan.entity';
import { DailySummary } from '../../entities/daily-summary.entity';
import { CoachConversation } from '../../entities/coach-conversation.entity';
import { CoachMessage } from '../../entities/coach-message.entity';
import { Achievement } from '../../entities/achievement.entity';
import { UserAchievement } from '../../entities/user-achievement.entity';
import { Challenge } from '../../entities/challenge.entity';
import { UserChallenge } from '../../entities/user-challenge.entity';
import { RecommendationFeedback } from '../../entities/recommendation-feedback.entity';
import { AiDecisionLog } from '../../entities/ai-decision-log.entity';
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

@Injectable()
export class ContentManagementService {
  private readonly logger = new Logger(ContentManagementService.name);

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
    @InjectRepository(Achievement)
    private readonly achievementRepo: Repository<Achievement>,
    @InjectRepository(UserAchievement)
    private readonly userAchievementRepo: Repository<UserAchievement>,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
    @InjectRepository(UserChallenge)
    private readonly userChallengeRepo: Repository<UserChallenge>,
    @InjectRepository(RecommendationFeedback)
    private readonly feedbackRepo: Repository<RecommendationFeedback>,
    @InjectRepository(AiDecisionLog)
    private readonly aiLogRepo: Repository<AiDecisionLog>,
  ) {}

  // ==================== 饮食记录管理 ====================

  async findFoodRecords(query: GetFoodRecordsQueryDto) {
    const { page = 1, pageSize = 20, userId, mealType, startDate, endDate, keyword } = query;
    const qb = this.foodRecordRepo.createQueryBuilder('r')
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
      qb.andWhere('r.recorded_at <= :endDate', { endDate: `${endDate} 23:59:59` });
    }
    if (keyword) {
      qb.andWhere("r.foods::text ILIKE :kw", { kw: `%${keyword}%` });
    }

    qb.orderBy('r.recordedAt', 'DESC');
    const total = await qb.getCount();
    const list = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();

    return { list, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getFoodRecordDetail(id: string) {
    const record = await this.foodRecordRepo.findOne({ where: { id }, relations: ['user'] });
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
    const todayCount = await this.foodRecordRepo.createQueryBuilder('r')
      .where('DATE(r.recorded_at) = :today', { today }).getCount();

    const byMealType = await this.foodRecordRepo.createQueryBuilder('r')
      .select('r.meal_type', 'mealType')
      .addSelect('COUNT(*)', 'count')
      .groupBy('r.meal_type')
      .getRawMany();

    return { total, todayCount, byMealType };
  }

  // ==================== 每日计划管理 ====================

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
    const list = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();

    return { list, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getDailyPlanDetail(id: string) {
    const plan = await this.dailyPlanRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('每日计划不存在');
    return plan;
  }

  // ==================== AI 对话管理 ====================

  async findConversations(query: GetCoachConversationsQueryDto) {
    const { page = 1, pageSize = 20, userId, keyword } = query;
    const qb = this.conversationRepo.createQueryBuilder('c')
      .leftJoinAndSelect('c.user', 'user');

    if (userId) {
      qb.andWhere('c.user_id = :userId', { userId });
    }
    if (keyword) {
      qb.andWhere('c.title ILIKE :kw', { kw: `%${keyword}%` });
    }

    qb.orderBy('c.updatedAt', 'DESC');
    const total = await qb.getCount();
    const list = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();

    return { list, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getConversationDetail(id: string) {
    const conversation = await this.conversationRepo.findOne({
      where: { id },
      relations: ['user', 'messages'],
    });
    if (!conversation) throw new NotFoundException('对话不存在');

    // 按时间排序消息
    conversation.messages?.sort((a, b) =>
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
    const totalTokens = await this.messageRepo.createQueryBuilder('m')
      .select('SUM(m.tokens_used)', 'total')
      .getRawOne();

    return {
      totalConversations: total,
      totalMessages,
      totalTokensUsed: parseInt(totalTokens?.total || '0'),
    };
  }

  // ==================== 成就管理 ====================

  async findAchievements(query: GetAchievementsQueryDto) {
    const { page = 1, pageSize = 20, keyword, category } = query;
    const qb = this.achievementRepo.createQueryBuilder('a');

    if (keyword) {
      qb.andWhere('(a.name ILIKE :kw OR a.code ILIKE :kw)', { kw: `%${keyword}%` });
    }
    if (category) {
      qb.andWhere('a.category = :category', { category });
    }

    const total = await qb.getCount();
    const list = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();

    // 获取每个成就的解锁人数
    const unlockCounts = await this.userAchievementRepo.createQueryBuilder('ua')
      .select('ua.achievement_id', 'achievementId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ua.achievement_id')
      .getRawMany();

    const countMap = new Map(unlockCounts.map(u => [u.achievementId, parseInt(u.count)]));
    const listWithCounts = list.map(a => ({
      ...a,
      unlockCount: countMap.get(a.id) || 0,
    }));

    return { list: listWithCounts, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async createAchievement(dto: CreateAchievementDto) {
    const achievement = this.achievementRepo.create(dto);
    return this.achievementRepo.save(achievement);
  }

  async updateAchievement(id: string, dto: UpdateAchievementDto) {
    const achievement = await this.achievementRepo.findOne({ where: { id } });
    if (!achievement) throw new NotFoundException('成就不存在');
    Object.assign(achievement, dto);
    return this.achievementRepo.save(achievement);
  }

  async deleteAchievement(id: string) {
    const achievement = await this.achievementRepo.findOne({ where: { id } });
    if (!achievement) throw new NotFoundException('成就不存在');
    await this.achievementRepo.remove(achievement);
    return { message: '成就已删除' };
  }

  // ==================== 挑战管理 ====================

  async findChallenges(query: GetChallengesQueryDto) {
    const { page = 1, pageSize = 20, keyword, type } = query;
    const qb = this.challengeRepo.createQueryBuilder('c');

    if (keyword) {
      qb.andWhere('c.title ILIKE :kw', { kw: `%${keyword}%` });
    }
    if (type) {
      qb.andWhere('c.type = :type', { type });
    }

    const total = await qb.getCount();
    const list = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();

    // 获取每个挑战的参与人数
    const joinCounts = await this.userChallengeRepo.createQueryBuilder('uc')
      .select('uc.challenge_id', 'challengeId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('uc.challenge_id')
      .getRawMany();

    const countMap = new Map(joinCounts.map(j => [j.challengeId, parseInt(j.count)]));
    const listWithCounts = list.map(c => ({
      ...c,
      participantCount: countMap.get(c.id) || 0,
    }));

    return { list: listWithCounts, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async createChallenge(dto: CreateChallengeDto) {
    const challenge = this.challengeRepo.create(dto);
    return this.challengeRepo.save(challenge);
  }

  async updateChallenge(id: string, dto: UpdateChallengeDto) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('挑战不存在');
    Object.assign(challenge, dto);
    return this.challengeRepo.save(challenge);
  }

  async deleteChallenge(id: string) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('挑战不存在');
    await this.challengeRepo.remove(challenge);
    return { message: '挑战已删除' };
  }

  async toggleChallengeActive(id: string) {
    const challenge = await this.challengeRepo.findOne({ where: { id } });
    if (!challenge) throw new NotFoundException('挑战不存在');
    challenge.isActive = !challenge.isActive;
    return this.challengeRepo.save(challenge);
  }

  // ==================== 推荐反馈查询 ====================

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
    const list = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();

    return { list, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getFeedbackStatistics() {
    const total = await this.feedbackRepo.count();
    const byAction = await this.feedbackRepo.createQueryBuilder('f')
      .select('f.action', 'action')
      .addSelect('COUNT(*)', 'count')
      .groupBy('f.action')
      .getRawMany();

    const acceptRate = byAction.find(a => a.action === 'accepted');
    return {
      total,
      byAction,
      acceptRate: total > 0 ? ((parseInt(acceptRate?.count || '0') / total) * 100).toFixed(1) : '0',
    };
  }

  // ==================== AI决策日志查询 ====================

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
    const list = await qb.skip((page - 1) * pageSize).take(pageSize).getMany();

    return { list, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async getAiLogStatistics() {
    const total = await this.aiLogRepo.count();
    const byDecision = await this.aiLogRepo.createQueryBuilder('l')
      .select('l.decision', 'decision')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.decision')
      .getRawMany();

    const byRisk = await this.aiLogRepo.createQueryBuilder('l')
      .select('l.risk_level', 'riskLevel')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.risk_level')
      .getRawMany();

    return { total, byDecision, byRisk };
  }
}
