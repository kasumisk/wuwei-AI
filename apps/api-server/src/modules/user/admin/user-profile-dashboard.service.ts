import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppUser } from '../entities/app-user.entity';
import { UserProfile } from '../entities/user-profile.entity';
import { UserBehaviorProfile } from '../entities/user-behavior-profile.entity';
import { UserInferredProfile } from '../entities/user-inferred-profile.entity';
import {
  UserGrowthTrendQueryDto,
  ProfileDistributionQueryDto,
} from './dto/user-profile-dashboard.dto';

@Injectable()
export class UserProfileDashboardService {
  constructor(
    @InjectRepository(AppUser)
    private readonly appUserRepository: Repository<AppUser>,
    @InjectRepository(UserProfile)
    private readonly userProfileRepository: Repository<UserProfile>,
    @InjectRepository(UserBehaviorProfile)
    private readonly behaviorProfileRepository: Repository<UserBehaviorProfile>,
    @InjectRepository(UserInferredProfile)
    private readonly inferredProfileRepository: Repository<UserInferredProfile>,
  ) {}

  // ==================== 用户增长趋势 ====================

  async getGrowthTrend(query: UserGrowthTrendQueryDto) {
    const days = query.days || 30;
    const granularity = query.granularity || 'day';

    let dateTrunc: string;
    switch (granularity) {
      case 'week':
        dateTrunc = 'week';
        break;
      case 'month':
        dateTrunc = 'month';
        break;
      default:
        dateTrunc = 'day';
    }

    // 注册趋势（按时间粒度分组）
    const trend = await this.appUserRepository
      .createQueryBuilder('u')
      .select(`date_trunc('${dateTrunc}', u.created_at)::date`, 'date')
      .addSelect('COUNT(*)::int', 'count')
      .addSelect(
        `SUM(COUNT(*)) OVER (ORDER BY date_trunc('${dateTrunc}', u.created_at))::int`,
        'cumulative',
      )
      .where(`u.created_at >= NOW() - INTERVAL '${days} days'`)
      .groupBy(`date_trunc('${dateTrunc}', u.created_at)`)
      .orderBy(`date_trunc('${dateTrunc}', u.created_at)`, 'ASC')
      .getRawMany();

    // 按 authType 的注册趋势
    const byAuthType = await this.appUserRepository
      .createQueryBuilder('u')
      .select(`date_trunc('${dateTrunc}', u.created_at)::date`, 'date')
      .addSelect('u.auth_type', 'authType')
      .addSelect('COUNT(*)::int', 'count')
      .where(`u.created_at >= NOW() - INTERVAL '${days} days'`)
      .groupBy(`date_trunc('${dateTrunc}', u.created_at)`)
      .addGroupBy('u.auth_type')
      .orderBy(`date_trunc('${dateTrunc}', u.created_at)`, 'ASC')
      .getRawMany();

    // 转换 byAuthType 为 per-date 格式
    const authTypeMap: Record<string, Record<string, number>> = {};
    for (const row of byAuthType) {
      const dateStr =
        row.date instanceof Date
          ? row.date.toISOString().split('T')[0]
          : String(row.date);
      if (!authTypeMap[dateStr]) authTypeMap[dateStr] = {};
      authTypeMap[dateStr][row.authType] = row.count;
    }

    const trendWithAuthType = trend.map((row) => {
      const dateStr =
        row.date instanceof Date
          ? row.date.toISOString().split('T')[0]
          : String(row.date);
      return {
        date: dateStr,
        count: row.count,
        cumulative: row.cumulative,
        byAuthType: authTypeMap[dateStr] || {},
      };
    });

    // 总计
    const totalUsers = await this.appUserRepository.count();
    const periodNewUsers = trend.reduce(
      (sum: number, row: any) => sum + Number(row.count),
      0,
    );

    return {
      days,
      granularity,
      totalUsers,
      periodNewUsers,
      trend: trendWithAuthType,
    };
  }

  // ==================== 用户画像分布 ====================

  async getProfileDistribution(query: ProfileDistributionQueryDto) {
    const days = query.days || 90;

    // 1. authType 分布
    const authTypeDistribution = await this.appUserRepository
      .createQueryBuilder('u')
      .select('u.auth_type', 'authType')
      .addSelect('COUNT(*)::int', 'count')
      .where(`u.created_at >= NOW() - INTERVAL '${days} days'`)
      .groupBy('u.auth_type')
      .getRawMany();

    // 2. 目标类型分布（来自 user_profiles）
    const goalDistribution = await this.userProfileRepository
      .createQueryBuilder('p')
      .select('p.goal', 'goal')
      .addSelect('COUNT(*)::int', 'count')
      .where('p.goal IS NOT NULL')
      .groupBy('p.goal')
      .getRawMany();

    // 3. 活动等级分布
    const activityLevelDistribution = await this.userProfileRepository
      .createQueryBuilder('p')
      .select('p.activity_level', 'activityLevel')
      .addSelect('COUNT(*)::int', 'count')
      .where('p.activity_level IS NOT NULL')
      .groupBy('p.activity_level')
      .getRawMany();

    // 4. 性别分布
    const genderDistribution = await this.userProfileRepository
      .createQueryBuilder('p')
      .select('p.gender', 'gender')
      .addSelect('COUNT(*)::int', 'count')
      .where('p.gender IS NOT NULL')
      .groupBy('p.gender')
      .getRawMany();

    // 5. onboarding 完成率
    const totalProfiles = await this.userProfileRepository.count();
    const completedOnboarding = await this.userProfileRepository.count({
      where: { onboardingCompleted: true },
    });

    // 6. 行为画像统计（依从率分布、平均连续天数）
    const behaviorStats = await this.behaviorProfileRepository
      .createQueryBuilder('bp')
      .select('COUNT(*)::int', 'totalWithBehavior')
      .addSelect('AVG(bp.avg_compliance_rate)', 'avgComplianceRate')
      .addSelect('AVG(bp.streak_days)', 'avgStreakDays')
      .addSelect('MAX(bp.longest_streak)', 'maxLongestStreak')
      .addSelect('AVG(bp.total_records)', 'avgTotalRecords')
      .getRawOne();

    // 7. 推断画像统计（流失风险分布、BMR/TDEE 均值）
    const inferredStats = await this.inferredProfileRepository
      .createQueryBuilder('ip')
      .select('COUNT(*)::int', 'totalWithInferred')
      .addSelect('AVG(ip.estimated_bmr)', 'avgBMR')
      .addSelect('AVG(ip.estimated_tdee)', 'avgTDEE')
      .addSelect('AVG(ip.recommended_calories)', 'avgRecommendedCalories')
      .addSelect('AVG(ip.churn_risk)', 'avgChurnRisk')
      .getRawOne();

    // 8. 流失风险分段
    const churnRiskSegments = await this.inferredProfileRepository
      .createQueryBuilder('ip')
      .select(
        `CASE 
          WHEN ip.churn_risk < 0.3 THEN 'low'
          WHEN ip.churn_risk < 0.6 THEN 'medium'
          ELSE 'high'
        END`,
        'segment',
      )
      .addSelect('COUNT(*)::int', 'count')
      .where('ip.churn_risk IS NOT NULL')
      .groupBy(
        `CASE 
          WHEN ip.churn_risk < 0.3 THEN 'low'
          WHEN ip.churn_risk < 0.6 THEN 'medium'
          ELSE 'high'
        END`,
      )
      .getRawMany();

    // 9. 依从率分段
    const complianceSegments = await this.behaviorProfileRepository
      .createQueryBuilder('bp')
      .select(
        `CASE 
          WHEN bp.avg_compliance_rate >= 0.8 THEN 'excellent'
          WHEN bp.avg_compliance_rate >= 0.6 THEN 'good'
          WHEN bp.avg_compliance_rate >= 0.4 THEN 'fair'
          ELSE 'poor'
        END`,
        'segment',
      )
      .addSelect('COUNT(*)::int', 'count')
      .where('bp.avg_compliance_rate IS NOT NULL')
      .groupBy(
        `CASE 
          WHEN bp.avg_compliance_rate >= 0.8 THEN 'excellent'
          WHEN bp.avg_compliance_rate >= 0.6 THEN 'good'
          WHEN bp.avg_compliance_rate >= 0.4 THEN 'fair'
          ELSE 'poor'
        END`,
      )
      .getRawMany();

    return {
      days,
      distributions: {
        authType: authTypeDistribution,
        goal: goalDistribution,
        activityLevel: activityLevelDistribution,
        gender: genderDistribution,
        churnRisk: churnRiskSegments,
        compliance: complianceSegments,
      },
      onboarding: {
        totalProfiles,
        completedOnboarding,
        completionRate:
          totalProfiles > 0
            ? Number(((completedOnboarding / totalProfiles) * 100).toFixed(1))
            : 0,
      },
      behaviorStats: {
        totalWithBehavior: Number(behaviorStats?.totalWithBehavior || 0),
        avgComplianceRate: Number(
          Number(behaviorStats?.avgComplianceRate || 0).toFixed(3),
        ),
        avgStreakDays: Number(
          Number(behaviorStats?.avgStreakDays || 0).toFixed(1),
        ),
        maxLongestStreak: Number(behaviorStats?.maxLongestStreak || 0),
        avgTotalRecords: Number(
          Number(behaviorStats?.avgTotalRecords || 0).toFixed(1),
        ),
      },
      inferredStats: {
        totalWithInferred: Number(inferredStats?.totalWithInferred || 0),
        avgBMR: Number(Number(inferredStats?.avgBMR || 0).toFixed(0)),
        avgTDEE: Number(Number(inferredStats?.avgTDEE || 0).toFixed(0)),
        avgRecommendedCalories: Number(
          Number(inferredStats?.avgRecommendedCalories || 0).toFixed(0),
        ),
        avgChurnRisk: Number(
          Number(inferredStats?.avgChurnRisk || 0).toFixed(3),
        ),
      },
    };
  }

  // ==================== 活跃用户统计 ====================

  async getActiveStats(days: number = 30) {
    // DAU（今日登录）
    const dau = await this.appUserRepository
      .createQueryBuilder('u')
      .where(`u.last_login_at >= CURRENT_DATE`)
      .getCount();

    // WAU（7 日内登录）
    const wau = await this.appUserRepository
      .createQueryBuilder('u')
      .where(`u.last_login_at >= NOW() - INTERVAL '7 days'`)
      .getCount();

    // MAU（30 日内登录）
    const mau = await this.appUserRepository
      .createQueryBuilder('u')
      .where(`u.last_login_at >= NOW() - INTERVAL '30 days'`)
      .getCount();

    // 总用户 & 状态分布
    const totalUsers = await this.appUserRepository.count();
    const activeUsers = await this.appUserRepository.count({
      where: { status: 'active' as any },
    });
    const bannedUsers = await this.appUserRepository.count({
      where: { status: 'banned' as any },
    });

    // 日活趋势（过去 N 天，每天有多少用户登录）
    const dailyActive = await this.appUserRepository
      .createQueryBuilder('u')
      .select(`date_trunc('day', u.last_login_at)::date`, 'date')
      .addSelect('COUNT(*)::int', 'count')
      .where(`u.last_login_at >= NOW() - INTERVAL '${days} days'`)
      .andWhere('u.last_login_at IS NOT NULL')
      .groupBy(`date_trunc('day', u.last_login_at)`)
      .orderBy(`date_trunc('day', u.last_login_at)`, 'ASC')
      .getRawMany();

    const dailyActiveTrend = dailyActive.map((row) => ({
      date:
        row.date instanceof Date
          ? row.date.toISOString().split('T')[0]
          : String(row.date),
      count: row.count,
    }));

    return {
      dau,
      wau,
      mau,
      totalUsers,
      activeUsers,
      bannedUsers,
      dauWauRatio: wau > 0 ? Number(((dau / wau) * 100).toFixed(1)) : 0,
      wauMauRatio: mau > 0 ? Number(((wau / mau) * 100).toFixed(1)) : 0,
      dailyActiveTrend,
    };
  }
}
