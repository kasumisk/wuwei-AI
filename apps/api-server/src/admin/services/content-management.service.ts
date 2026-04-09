import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Achievement } from '../../entities/achievement.entity';
import { UserAchievement } from '../../entities/user-achievement.entity';
import { Challenge } from '../../entities/challenge.entity';
import { UserChallenge } from '../../entities/user-challenge.entity';
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
    @InjectRepository(Achievement)
    private readonly achievementRepo: Repository<Achievement>,
    @InjectRepository(UserAchievement)
    private readonly userAchievementRepo: Repository<UserAchievement>,
    @InjectRepository(Challenge)
    private readonly challengeRepo: Repository<Challenge>,
    @InjectRepository(UserChallenge)
    private readonly userChallengeRepo: Repository<UserChallenge>,
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
    const qb = this.achievementRepo.createQueryBuilder('a');

    if (keyword) {
      qb.andWhere('(a.name ILIKE :kw OR a.code ILIKE :kw)', {
        kw: `%${keyword}%`,
      });
    }
    if (category) {
      qb.andWhere('a.category = :category', { category });
    }

    const total = await qb.getCount();
    const list = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    // 获取每个成就的解锁人数
    const unlockCounts = await this.userAchievementRepo
      .createQueryBuilder('ua')
      .select('ua.achievement_id', 'achievementId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('ua.achievement_id')
      .getRawMany();

    const countMap = new Map(
      unlockCounts.map((u) => [u.achievementId, parseInt(u.count)]),
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
    const list = await qb
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getMany();

    // 获取每个挑战的参与人数
    const joinCounts = await this.userChallengeRepo
      .createQueryBuilder('uc')
      .select('uc.challenge_id', 'challengeId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('uc.challenge_id')
      .getRawMany();

    const countMap = new Map(
      joinCounts.map((j) => [j.challengeId, parseInt(j.count)]),
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
