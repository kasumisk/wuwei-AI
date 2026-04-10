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

@Injectable()
export class AppUserManagementService {
  constructor(private readonly prisma: PrismaService) {}

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
      where.auth_type = authType;
    }

    if (status) {
      where.status = status;
    }

    const skip = (page - 1) * pageSize;

    const [list, total] = await Promise.all([
      this.prisma.app_users.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.app_users.count({ where }),
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
    const user = await this.prisma.app_users.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`App 用户 #${id} 不存在`);
    }

    return user;
  }

  /**
   * 更新 App 用户信息（管理员操作）
   */
  async update(id: string, dto: UpdateAppUserByAdminDto) {
    const user = await this.prisma.app_users.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`App 用户 #${id} 不存在`);
    }

    const data: any = {};
    if (dto.status) data.status = dto.status;
    if (dto.nickname !== undefined) data.nickname = dto.nickname;
    if (dto.avatar !== undefined) data.avatar = dto.avatar;
    if (dto.email !== undefined) data.email = dto.email;

    const updated = await this.prisma.app_users.update({
      where: { id },
      data,
    });
    return updated;
  }

  /**
   * 封禁 App 用户
   */
  async ban(id: string) {
    const user = await this.prisma.app_users.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`App 用户 #${id} 不存在`);
    }

    await this.prisma.app_users.update({
      where: { id },
      data: { status: AppUserStatus.BANNED as any },
    });

    return { message: '用户已封禁' };
  }

  /**
   * 解封 App 用户
   */
  async unban(id: string) {
    const user = await this.prisma.app_users.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`App 用户 #${id} 不存在`);
    }

    if (user.status !== (AppUserStatus.BANNED as any)) {
      throw new BadRequestException('用户未被封禁');
    }

    await this.prisma.app_users.update({
      where: { id },
      data: { status: AppUserStatus.ACTIVE as any },
    });

    return { message: '用户已解封' };
  }

  /**
   * 删除 App 用户
   */
  async remove(id: string) {
    const user = await this.prisma.app_users.findUnique({ where: { id } });

    if (!user) {
      throw new NotFoundException(`App 用户 #${id} 不存在`);
    }

    await this.prisma.app_users.delete({ where: { id } });

    return { message: '用户已删除' };
  }

  /**
   * 获取 App 用户统计
   */
  async getStatistics() {
    const [total, anonymous, google, email, active, banned] = await Promise.all(
      [
        this.prisma.app_users.count(),
        this.prisma.app_users.count({
          where: { auth_type: 'anonymous' as any },
        }),
        this.prisma.app_users.count({ where: { auth_type: 'google' as any } }),
        this.prisma.app_users.count({ where: { auth_type: 'email' as any } }),
        this.prisma.app_users.count({ where: { status: 'active' as any } }),
        this.prisma.app_users.count({ where: { status: 'banned' as any } }),
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
    const user = await this.prisma.app_users.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException(`App 用户 #${userId} 不存在`);
    }

    // 并行查询行为画像、声明档案、近期变更日志
    const [behaviorProfile, declaredProfile, recentChangeLogs] =
      await Promise.all([
        this.prisma.user_behavior_profiles.findUnique({
          where: { user_id: userId },
        }),
        this.prisma.user_profiles.findUnique({ where: { user_id: userId } }),
        this.prisma.profile_change_log.findMany({
          where: { user_id: userId, change_type: 'behavior' as any },
          orderBy: { created_at: 'desc' },
          take: 20,
        }),
      ]);

    return {
      user: {
        id: user.id,
        nickname: user.nickname,
        authType: user.auth_type,
        status: user.status,
        createdAt: user.created_at,
      },
      behaviorProfile: behaviorProfile || null,
      declaredProfile: declaredProfile
        ? {
            goal: declaredProfile.goal,
            goalSpeed: declaredProfile.goal_speed,
            gender: declaredProfile.gender,
            birthYear: declaredProfile.birth_year,
            heightCm: declaredProfile.height_cm,
            weightKg: declaredProfile.weight_kg,
            targetWeightKg: declaredProfile.target_weight_kg,
            activityLevel: declaredProfile.activity_level,
            dailyCalorieGoal: declaredProfile.daily_calorie_goal,
            discipline: declaredProfile.discipline,
            mealsPerDay: declaredProfile.meals_per_day,
            takeoutFrequency: declaredProfile.takeout_frequency,
            canCook: declaredProfile.can_cook,
            foodPreferences: declaredProfile.food_preferences,
            dietaryRestrictions: declaredProfile.dietary_restrictions,
            allergens: declaredProfile.allergens,
            healthConditions: declaredProfile.health_conditions,
            cuisinePreferences: declaredProfile.cuisine_preferences,
            weakTimeSlots: declaredProfile.weak_time_slots,
            bingeTriggers: declaredProfile.binge_triggers,
            dataCompleteness: declaredProfile.data_completeness,
            onboardingCompleted: declaredProfile.onboarding_completed,
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
    const user = await this.prisma.app_users.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new NotFoundException(`App 用户 #${userId} 不存在`);
    }

    // 并行查询推断画像、近期变更日志
    const [inferredProfile, recentChangeLogs] = await Promise.all([
      this.prisma.user_inferred_profiles.findUnique({
        where: { user_id: userId },
      }),
      this.prisma.profile_change_log.findMany({
        where: { user_id: userId, change_type: 'inferred' as any },
        orderBy: { created_at: 'desc' },
        take: 20,
      }),
    ]);

    return {
      user: {
        id: user.id,
        nickname: user.nickname,
        authType: user.auth_type,
        status: user.status,
        createdAt: user.created_at,
      },
      inferredProfile: inferredProfile || null,
      recentChangeLogs,
    };
  }
}
