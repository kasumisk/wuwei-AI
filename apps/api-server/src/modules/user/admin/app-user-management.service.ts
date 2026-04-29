import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { AppUserStatus } from '../user.types';
import {
  GetAppUsersQueryDto,
  UpdateAppUserByAdminDto,
} from './dto/app-user-management.dto';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { I18nService } from '../../../core/i18n';
import { getBehavior, getInferred } from '../user-profile-merge.helper';

@Injectable()
export class AppUserManagementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 获取 App 用户列表（分页）
   */
  async findAll(query: GetAppUsersQueryDto) {
    const { page = 1, pageSize = 10, keyword, authType, status } = query;

    const where: any = {};

    if (keyword) {
      where.OR = [
        { nickname: { contains: keyword, mode: 'insensitive' } },
        { email: { contains: keyword, mode: 'insensitive' } },
      ];
    }

    if (authType) {
      where.authType = authType;
    }

    if (status) {
      where.status = status;
    }

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.appUsers.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.appUsers.count({ where }),
    ]);

    return {
      list,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取 App 用户详情
   */
  async findOne(id: string) {
    const user = await this.prisma.appUsers.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(this.i18n.t('user.userNotFound', { id }));
    }

    return user;
  }

  /**
   * 更新 App 用户信息（管理员操作）
   */
  async update(id: string, dto: UpdateAppUserByAdminDto) {
    const user = await this.prisma.appUsers.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(this.i18n.t('user.userNotFound', { id }));
    }

    const data: any = {};
    if (dto.status) data.status = dto.status;
    if (dto.nickname !== undefined) data.nickname = dto.nickname;
    if (dto.avatar !== undefined) data.avatar = dto.avatar;
    if (dto.email !== undefined) data.email = dto.email;

    const updated = await this.prisma.appUsers.update({
      where: { id },
      data,
    });
    return updated;
  }

  /**
   * 封禁 App 用户
   */
  async ban(id: string) {
    const user = await this.prisma.appUsers.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(this.i18n.t('user.userNotFound', { id }));
    }

    await this.prisma.appUsers.update({
      where: { id },
      data: { status: AppUserStatus.BANNED as any },
    });

    return { message: this.i18n.t('user.userBanned') };
  }

  /**
   * 解封 App 用户
   */
  async unban(id: string) {
    const user = await this.prisma.appUsers.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(this.i18n.t('user.userNotFound', { id }));
    }

    if (user.status !== (AppUserStatus.BANNED as any)) {
      throw new BadRequestException(this.i18n.t('user.userNotBanned'));
    }

    await this.prisma.appUsers.update({
      where: { id },
      data: { status: AppUserStatus.ACTIVE as any },
    });

    return { message: this.i18n.t('user.userUnbanned') };
  }

  /**
   * 删除 App 用户
   */
  async remove(id: string) {
    const user = await this.prisma.appUsers.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(this.i18n.t('user.userNotFound', { id }));
    }

    await this.prisma.appUsers.delete({ where: { id } });

    return { message: this.i18n.t('user.userDeleted') };
  }

  /**
   * 获取 App 用户统计
   */
  async getStatistics() {
    const [total, anonymous, google, email, active, banned] = await Promise.all(
      [
        this.prisma.appUsers.count(),
        this.prisma.appUsers.count({
          where: { authType: 'anonymous' as any },
        }),
        this.prisma.appUsers.count({ where: { authType: 'google' as any } }),
        this.prisma.appUsers.count({ where: { authType: 'email' as any } }),
        this.prisma.appUsers.count({ where: { status: 'active' as any } }),
        this.prisma.appUsers.count({ where: { status: 'banned' as any } }),
      ],
    );

    return {
      total,
      byAuthType: { anonymous, google, email },
      byStatus: { active, banned },
    };
  }

  /**
   * 获取用户行为画像
   * 包含：行为画像 + 声明档案 + 近期画像变更日志
   */
  async getBehaviorProfile(userId: string) {
    // 验证用户存在
    const user = await this.prisma.appUsers.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException(
        this.i18n.t('user.userNotFound', { id: userId }),
      );
    }

    // 并行查询行为画像、声明档案、近期变更日志
    const [userProfileRow, recentChangeLogs] = await Promise.all([
      this.prisma.userProfiles.findUnique({
        where: { userId: userId },
      }),
      this.prisma.profileChangeLog.findMany({
        where: { userId: userId, changeType: 'behavior' as any },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const behaviorProfile = userProfileRow ? getBehavior(userProfileRow) : null;
    const declaredProfile = userProfileRow;

    return {
      user: {
        id: user.id,
        nickname: user.nickname,
        authType: user.authType,
        status: user.status,
        createdAt: user.createdAt,
      },
      behaviorProfile: behaviorProfile || null,
      declaredProfile: declaredProfile
        ? {
            goal: declaredProfile.goal,
            goalSpeed: declaredProfile.goalSpeed,
            gender: declaredProfile.gender,
            birthYear: declaredProfile.birthYear,
            heightCm: declaredProfile.heightCm,
            weightKg: declaredProfile.weightKg,
            targetWeightKg: declaredProfile.targetWeightKg,
            activityLevel: declaredProfile.activityLevel,
            dailyCalorieGoal: declaredProfile.dailyCalorieGoal,
            discipline: declaredProfile.discipline,
            mealsPerDay: declaredProfile.mealsPerDay,
            takeoutFrequency: declaredProfile.takeoutFrequency,
            canCook: declaredProfile.canCook,
            foodPreferences: declaredProfile.foodPreferences,
            dietaryRestrictions: declaredProfile.dietaryRestrictions,
            allergens: declaredProfile.allergens,
            healthConditions: declaredProfile.healthConditions,
            cuisinePreferences: declaredProfile.cuisinePreferences,
            weakTimeSlots: declaredProfile.weakTimeSlots,
            bingeTriggers: declaredProfile.bingeTriggers,
            dataCompleteness: declaredProfile.dataCompleteness,
            onboardingCompleted: declaredProfile.onboardingCompleted,
          }
        : null,
      recentChangeLogs,
    };
  }

  /**
   * 获取用户推断画像
   * 包含：推断画像 + 目标进度 + 近期推断变更日志
   */
  async getInferredProfile(userId: string) {
    // 验证用户存在
    const user = await this.prisma.appUsers.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException(
        this.i18n.t('user.userNotFound', { id: userId }),
      );
    }

    // 并行查询推断画像、近期变更日志
    const [inferredProfileRow, recentChangeLogs] = await Promise.all([
      this.prisma.userProfiles.findUnique({
        where: { userId: userId },
      }),
      this.prisma.profileChangeLog.findMany({
        where: { userId: userId, changeType: 'inferred' as any },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    ]);

    const inferredProfile = inferredProfileRow
      ? getInferred(inferredProfileRow)
      : null;

    return {
      user: {
        id: user.id,
        nickname: user.nickname,
        authType: user.authType,
        status: user.status,
        createdAt: user.createdAt,
      },
      inferredProfile: inferredProfile || null,
      recentChangeLogs,
    };
  }
}
