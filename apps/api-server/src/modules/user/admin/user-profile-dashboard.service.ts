import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  UserGrowthTrendQueryDto,
  ProfileDistributionQueryDto,
} from './dto/user-profile-dashboard.dto';
import { PrismaService } from '../../../core/prisma/prisma.service';

@Injectable()
export class UserProfileDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== 用户增长趋势 ====================

  async getGrowthTrend(query: UserGrowthTrendQueryDto) {
    const days = query.days || 30;
    const granularity = query.granularity || 'day';

    // 白名单校验，防止 SQL 注入（dateTrunc 只能是这三个值之一）
    const allowedGranularity = ['day', 'week', 'month'];
    const dateTrunc = allowedGranularity.includes(granularity)
      ? granularity
      : 'day';

    // 注册趋势（按时间粒度分组）
    // 注意：date_trunc 的第一个参数（时间粒度）不能用 Prisma 参数占位符传入，
    // 否则 PostgreSQL 会将其视为字符串值而非函数关键字，导致 GROUP BY 报错。
    // 已通过白名单校验确保 dateTrunc 安全，直接使用模板字面量拼接。
    const trend = await this.prisma.$queryRawUnsafe<
      Array<{ date: Date; count: number; cumulative: number }>
    >(
      `
        SELECT
          date_trunc('${dateTrunc}', created_at)::date AS date,
          COUNT(*)::int AS count,
          SUM(COUNT(*)) OVER (ORDER BY date_trunc('${dateTrunc}', created_at))::int AS cumulative
        FROM app_users
        WHERE created_at >= NOW() - CAST($1 AS INTERVAL)
        GROUP BY date_trunc('${dateTrunc}', created_at)
        ORDER BY date_trunc('${dateTrunc}', created_at) ASC
      `,
      `${days} days`,
    );

    // 按 authType 的注册趋势
    const byAuthType = await this.prisma.$queryRawUnsafe<
      Array<{ date: Date; authType: string; count: number }>
    >(
      `
        SELECT
          date_trunc('${dateTrunc}', created_at)::date AS date,
          auth_type AS "authType",
          COUNT(*)::int AS count
        FROM app_users
        WHERE created_at >= NOW() - CAST($1 AS INTERVAL)
        GROUP BY date_trunc('${dateTrunc}', created_at), auth_type
        ORDER BY date_trunc('${dateTrunc}', created_at) ASC
      `,
      `${days} days`,
    );

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
    const totalUsers = await this.prisma.app_users.count();
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
    const authTypeDistribution = await this.prisma.$queryRaw<
      Array<{ authType: string; count: number }>
    >(
      Prisma.sql`
        SELECT auth_type AS "authType", COUNT(*)::int AS count
        FROM app_users
        WHERE created_at >= NOW() - CAST(${days + ' days'} AS INTERVAL)
        GROUP BY auth_type
      `,
    );

    // 2. 目标类型分布（来自 user_profiles）
    const goalDistribution = await this.prisma.$queryRaw<
      Array<{ goal: string; count: number }>
    >(
      Prisma.sql`
        SELECT goal, COUNT(*)::int AS count
        FROM user_profiles
        WHERE goal IS NOT NULL
        GROUP BY goal
      `,
    );

    // 3. 活动等级分布
    const activityLevelDistribution = await this.prisma.$queryRaw<
      Array<{ activityLevel: string; count: number }>
    >(
      Prisma.sql`
        SELECT activity_level AS "activityLevel", COUNT(*)::int AS count
        FROM user_profiles
        WHERE activity_level IS NOT NULL
        GROUP BY activity_level
      `,
    );

    // 4. 性别分布
    const genderDistribution = await this.prisma.$queryRaw<
      Array<{ gender: string; count: number }>
    >(
      Prisma.sql`
        SELECT gender, COUNT(*)::int AS count
        FROM user_profiles
        WHERE gender IS NOT NULL
        GROUP BY gender
      `,
    );

    // 5. onboarding 完成率
    const totalProfiles = await this.prisma.user_profiles.count();
    const completedOnboarding = await this.prisma.user_profiles.count({
      where: { onboarding_completed: true },
    });

    // 6. 行为画像统计（依从率分布、平均连续天数）
    const behaviorStats = await this.prisma.$queryRaw<
      Array<{
        totalWithBehavior: number;
        avgComplianceRate: number;
        avgStreakDays: number;
        maxLongestStreak: number;
        avgTotalRecords: number;
      }>
    >(
      Prisma.sql`
        SELECT
          COUNT(*)::int AS "totalWithBehavior",
          AVG(avg_compliance_rate) AS "avgComplianceRate",
          AVG(streak_days) AS "avgStreakDays",
          MAX(longest_streak) AS "maxLongestStreak",
          AVG(total_records) AS "avgTotalRecords"
        FROM user_behavior_profiles
      `,
    );
    const behaviorStatsRow = behaviorStats?.[0] || null;

    // 7. 推断画像统计（流失风险分布、BMR/TDEE 均值）
    const inferredStats = await this.prisma.$queryRaw<
      Array<{
        totalWithInferred: number;
        avgBMR: number;
        avgTDEE: number;
        avgRecommendedCalories: number;
        avgChurnRisk: number;
      }>
    >(
      Prisma.sql`
        SELECT
          COUNT(*)::int AS "totalWithInferred",
          AVG(estimated_bmr) AS "avgBMR",
          AVG(estimated_tdee) AS "avgTDEE",
          AVG(recommended_calories) AS "avgRecommendedCalories",
          AVG(churn_risk) AS "avgChurnRisk"
        FROM user_inferred_profiles
      `,
    );
    const inferredStatsRow = inferredStats?.[0] || null;

    // 8. 流失风险分段
    const churnRiskSegments = await this.prisma.$queryRaw<
      Array<{ segment: string; count: number }>
    >(
      Prisma.sql`
        SELECT
          CASE
            WHEN churn_risk < 0.3 THEN 'low'
            WHEN churn_risk < 0.6 THEN 'medium'
            ELSE 'high'
          END AS segment,
          COUNT(*)::int AS count
        FROM user_inferred_profiles
        WHERE churn_risk IS NOT NULL
        GROUP BY
          CASE
            WHEN churn_risk < 0.3 THEN 'low'
            WHEN churn_risk < 0.6 THEN 'medium'
            ELSE 'high'
          END
      `,
    );

    // 9. 依从率分段
    const complianceSegments = await this.prisma.$queryRaw<
      Array<{ segment: string; count: number }>
    >(
      Prisma.sql`
        SELECT
          CASE
            WHEN avg_compliance_rate >= 0.8 THEN 'excellent'
            WHEN avg_compliance_rate >= 0.6 THEN 'good'
            WHEN avg_compliance_rate >= 0.4 THEN 'fair'
            ELSE 'poor'
          END AS segment,
          COUNT(*)::int AS count
        FROM user_behavior_profiles
        WHERE avg_compliance_rate IS NOT NULL
        GROUP BY
          CASE
            WHEN avg_compliance_rate >= 0.8 THEN 'excellent'
            WHEN avg_compliance_rate >= 0.6 THEN 'good'
            WHEN avg_compliance_rate >= 0.4 THEN 'fair'
            ELSE 'poor'
          END
      `,
    );

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
        totalWithBehavior: Number(behaviorStatsRow?.totalWithBehavior || 0),
        avgComplianceRate: Number(
          Number(behaviorStatsRow?.avgComplianceRate || 0).toFixed(3),
        ),
        avgStreakDays: Number(
          Number(behaviorStatsRow?.avgStreakDays || 0).toFixed(1),
        ),
        maxLongestStreak: Number(behaviorStatsRow?.maxLongestStreak || 0),
        avgTotalRecords: Number(
          Number(behaviorStatsRow?.avgTotalRecords || 0).toFixed(1),
        ),
      },
      inferredStats: {
        totalWithInferred: Number(inferredStatsRow?.totalWithInferred || 0),
        avgBMR: Number(Number(inferredStatsRow?.avgBMR || 0).toFixed(0)),
        avgTDEE: Number(Number(inferredStatsRow?.avgTDEE || 0).toFixed(0)),
        avgRecommendedCalories: Number(
          Number(inferredStatsRow?.avgRecommendedCalories || 0).toFixed(0),
        ),
        avgChurnRisk: Number(
          Number(inferredStatsRow?.avgChurnRisk || 0).toFixed(3),
        ),
      },
    };
  }

  // ==================== 活跃用户统计 ====================

  async getActiveStats(days: number = 30) {
    // DAU（今日登录）— use raw SQL for CURRENT_DATE
    const dauResult = await this.prisma.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS count FROM app_users WHERE last_login_at >= CURRENT_DATE`,
    );
    const dau = dauResult[0]?.count || 0;

    // WAU（7 日内登录）
    const wauResult = await this.prisma.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS count FROM app_users WHERE last_login_at >= NOW() - INTERVAL '7 days'`,
    );
    const wau = wauResult[0]?.count || 0;

    // MAU（30 日内登录）
    const mauResult = await this.prisma.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`SELECT COUNT(*)::int AS count FROM app_users WHERE last_login_at >= NOW() - INTERVAL '30 days'`,
    );
    const mau = mauResult[0]?.count || 0;

    // 总用户 & 状态分布
    const [totalUsers, activeUsers, bannedUsers] = await Promise.all([
      this.prisma.app_users.count(),
      this.prisma.app_users.count({ where: { status: 'active' as any } }),
      this.prisma.app_users.count({ where: { status: 'banned' as any } }),
    ]);

    // 日活趋势（过去 N 天，每天有多少用户登录）
    const dailyActive = await this.prisma.$queryRaw<
      Array<{ date: Date; count: number }>
    >(
      Prisma.sql`
        SELECT
          date_trunc('day', last_login_at)::date AS date,
          COUNT(*)::int AS count
        FROM app_users
        WHERE last_login_at >= NOW() - CAST(${days + ' days'} AS INTERVAL)
          AND last_login_at IS NOT NULL
        GROUP BY date_trunc('day', last_login_at)
        ORDER BY date_trunc('day', last_login_at) ASC
      `,
    );

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
