import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  GetConversionFunnelQueryDto,
  GetConversionTrendQueryDto,
} from './dto/conversion-funnel.dto';

/**
 * 转化漏斗分析服务
 *
 * 五步漏斗模型:
 *   1. 注册用户 — app_users.created_at 在时间范围内
 *   2. 使用功能 — food_analysis_records 有记录的去重用户数
 *   3. 触发付费墙 — subscription_trigger_logs 有记录的去重用户数
 *   4. 发起支付 — payment_records 有记录的去重用户数
 *   5. 支付成功 — payment_records status='success' 的去重用户数
 */
@Injectable()
export class ConversionFunnelService {
  private readonly logger = new Logger(ConversionFunnelService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取转化漏斗数据
   *
   * 返回五步漏斗的每步用户数、转化率、流失率
   */
  async getConversionFunnel(query: GetConversionFunnelQueryDto) {
    const { startDate, endDate, authType, triggerScene } = query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Step 1: 注册用户数
    let registeredResult: any[];
    if (authType) {
      registeredResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(*) AS "cnt"
        FROM app_users
        WHERE created_at BETWEEN ${start} AND ${end}
          AND auth_type = ${authType}
      `);
    } else {
      registeredResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(*) AS "cnt"
        FROM app_users
        WHERE created_at BETWEEN ${start} AND ${end}
      `);
    }
    const registeredCount = parseInt(registeredResult[0]?.cnt || '0', 10);

    // Step 2: 使用功能（食物分析）的去重用户数
    let usedFeatureResult: any[];
    if (authType) {
      usedFeatureResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(DISTINCT r.user_id) AS "cnt"
        FROM food_analysis_records r
        WHERE r.created_at BETWEEN ${start} AND ${end}
          AND r.user_id IN (
            SELECT u.id FROM app_users u
            WHERE u.created_at BETWEEN ${start} AND ${end}
              AND u.auth_type = ${authType}
          )
      `);
    } else {
      usedFeatureResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(DISTINCT r.user_id) AS "cnt"
        FROM food_analysis_records r
        WHERE r.created_at BETWEEN ${start} AND ${end}
          AND r.user_id IN (
            SELECT u.id FROM app_users u
            WHERE u.created_at BETWEEN ${start} AND ${end}
          )
      `);
    }
    const usedFeatureCount = parseInt(usedFeatureResult[0]?.cnt || '0', 10);

    // Step 3: 触发付费墙的去重用户数
    let triggeredResult: any[];
    if (authType && triggerScene) {
      triggeredResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(DISTINCT t.user_id) AS "cnt"
        FROM subscription_trigger_logs t
        WHERE t.created_at BETWEEN ${start} AND ${end}
          AND t.trigger_scene = ${triggerScene}
          AND t.user_id IN (
            SELECT u.id FROM app_users u
            WHERE u.created_at BETWEEN ${start} AND ${end}
              AND u.auth_type = ${authType}
          )
      `);
    } else if (authType) {
      triggeredResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(DISTINCT t.user_id) AS "cnt"
        FROM subscription_trigger_logs t
        WHERE t.created_at BETWEEN ${start} AND ${end}
          AND t.user_id IN (
            SELECT u.id FROM app_users u
            WHERE u.created_at BETWEEN ${start} AND ${end}
              AND u.auth_type = ${authType}
          )
      `);
    } else if (triggerScene) {
      triggeredResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(DISTINCT t.user_id) AS "cnt"
        FROM subscription_trigger_logs t
        WHERE t.created_at BETWEEN ${start} AND ${end}
          AND t.trigger_scene = ${triggerScene}
          AND t.user_id IN (
            SELECT u.id FROM app_users u
            WHERE u.created_at BETWEEN ${start} AND ${end}
          )
      `);
    } else {
      triggeredResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(DISTINCT t.user_id) AS "cnt"
        FROM subscription_trigger_logs t
        WHERE t.created_at BETWEEN ${start} AND ${end}
          AND t.user_id IN (
            SELECT u.id FROM app_users u
            WHERE u.created_at BETWEEN ${start} AND ${end}
          )
      `);
    }
    const triggeredCount = parseInt(triggeredResult[0]?.cnt || '0', 10);

    // Step 4: 发起支付的去重用户数
    let initiatedPaymentResult: any[];
    if (authType) {
      initiatedPaymentResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(DISTINCT p.user_id) AS "cnt"
        FROM payment_records p
        WHERE p.created_at BETWEEN ${start} AND ${end}
          AND p.user_id IN (
            SELECT u.id FROM app_users u
            WHERE u.created_at BETWEEN ${start} AND ${end}
              AND u.auth_type = ${authType}
          )
      `);
    } else {
      initiatedPaymentResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(DISTINCT p.user_id) AS "cnt"
        FROM payment_records p
        WHERE p.created_at BETWEEN ${start} AND ${end}
          AND p.user_id IN (
            SELECT u.id FROM app_users u
            WHERE u.created_at BETWEEN ${start} AND ${end}
          )
      `);
    }
    const initiatedPaymentCount = parseInt(
      initiatedPaymentResult[0]?.cnt || '0',
      10,
    );

    // Step 5: 支付成功的去重用户数
    let paidResult: any[];
    if (authType) {
      paidResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(DISTINCT p.user_id) AS "cnt"
        FROM payment_records p
        WHERE p.created_at BETWEEN ${start} AND ${end}
          AND p.status = 'success'
          AND p.user_id IN (
            SELECT u.id FROM app_users u
            WHERE u.created_at BETWEEN ${start} AND ${end}
              AND u.auth_type = ${authType}
          )
      `);
    } else {
      paidResult = await this.prisma.$queryRaw(Prisma.sql`
        SELECT COUNT(DISTINCT p.user_id) AS "cnt"
        FROM payment_records p
        WHERE p.created_at BETWEEN ${start} AND ${end}
          AND p.status = 'success'
          AND p.user_id IN (
            SELECT u.id FROM app_users u
            WHERE u.created_at BETWEEN ${start} AND ${end}
          )
      `);
    }
    const paidCount = parseInt(paidResult[0]?.cnt || '0', 10);

    // 构建漏斗步骤
    const steps = [
      { step: 1, name: '注册用户', count: registeredCount },
      { step: 2, name: '使用功能', count: usedFeatureCount },
      { step: 3, name: '触发付费墙', count: triggeredCount },
      { step: 4, name: '发起支付', count: initiatedPaymentCount },
      { step: 5, name: '支付成功', count: paidCount },
    ];

    // 计算每步转化率和流失率
    const funnelSteps = steps.map((s, i) => {
      const prevCount = i === 0 ? s.count : steps[i - 1].count;
      const conversionRate =
        prevCount > 0 ? Number(((s.count / prevCount) * 100).toFixed(2)) : 0;
      const dropoffRate = Number((100 - conversionRate).toFixed(2));
      const overallRate =
        registeredCount > 0
          ? Number(((s.count / registeredCount) * 100).toFixed(2))
          : 0;

      return {
        ...s,
        conversionRate, // 相对上一步的转化率
        dropoffRate, // 相对上一步的流失率
        overallRate, // 相对第一步的整体转化率
      };
    });

    return {
      period: { startDate, endDate },
      filters: {
        authType: authType || null,
        triggerScene: triggerScene || null,
      },
      funnelSteps,
      summary: {
        totalRegistered: registeredCount,
        totalPaid: paidCount,
        overallConversionRate:
          registeredCount > 0
            ? Number(((paidCount / registeredCount) * 100).toFixed(2))
            : 0,
      },
    };
  }

  /**
   * 获取转化趋势数据
   *
   * 按日/周/月粒度，返回每个时间段的注册数和支付成功数及转化率
   */
  async getConversionTrend(query: GetConversionTrendQueryDto) {
    const { startDate, endDate, granularity = 'day' } = query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    // PostgreSQL 日期截断表达式
    let dateTruncInterval: string;
    switch (granularity) {
      case 'week':
        dateTruncInterval = 'week';
        break;
      case 'month':
        dateTruncInterval = 'month';
        break;
      default:
        dateTruncInterval = 'day';
    }

    // 注册趋势
    const registrationTrend: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT date_trunc('${dateTruncInterval}', created_at) AS "period", COUNT(*) AS "count"
       FROM app_users
       WHERE created_at BETWEEN $1 AND $2
       GROUP BY date_trunc('${dateTruncInterval}', created_at)
       ORDER BY date_trunc('${dateTruncInterval}', created_at) ASC`,
      start,
      end,
    );

    // 付费墙触发趋势
    const triggerTrend: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT date_trunc('${dateTruncInterval}', created_at) AS "period", COUNT(DISTINCT user_id) AS "count"
       FROM subscription_trigger_logs
       WHERE created_at BETWEEN $1 AND $2
       GROUP BY date_trunc('${dateTruncInterval}', created_at)
       ORDER BY date_trunc('${dateTruncInterval}', created_at) ASC`,
      start,
      end,
    );

    // 支付成功趋势
    const paymentTrend: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT date_trunc('${dateTruncInterval}', created_at) AS "period", COUNT(DISTINCT user_id) AS "count"
       FROM payment_records
       WHERE created_at BETWEEN $1 AND $2
         AND status = 'success'
       GROUP BY date_trunc('${dateTruncInterval}', created_at)
       ORDER BY date_trunc('${dateTruncInterval}', created_at) ASC`,
      start,
      end,
    );

    // 合并为时间轴数据
    const periodMap = new Map<
      string,
      { registered: number; triggered: number; paid: number }
    >();

    for (const row of registrationTrend) {
      const key = new Date(row.period).toISOString().split('T')[0];
      periodMap.set(key, {
        registered: parseInt(row.count, 10),
        triggered: 0,
        paid: 0,
      });
    }

    for (const row of triggerTrend) {
      const key = new Date(row.period).toISOString().split('T')[0];
      const entry = periodMap.get(key) || {
        registered: 0,
        triggered: 0,
        paid: 0,
      };
      entry.triggered = parseInt(row.count, 10);
      periodMap.set(key, entry);
    }

    for (const row of paymentTrend) {
      const key = new Date(row.period).toISOString().split('T')[0];
      const entry = periodMap.get(key) || {
        registered: 0,
        triggered: 0,
        paid: 0,
      };
      entry.paid = parseInt(row.count, 10);
      periodMap.set(key, entry);
    }

    // 排序并计算转化率
    const trend = Array.from(periodMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, data]) => ({
        date,
        registered: data.registered,
        triggered: data.triggered,
        paid: data.paid,
        triggerRate:
          data.registered > 0
            ? Number(((data.triggered / data.registered) * 100).toFixed(2))
            : 0,
        conversionRate:
          data.registered > 0
            ? Number(((data.paid / data.registered) * 100).toFixed(2))
            : 0,
      }));

    return {
      period: { startDate, endDate },
      granularity,
      trend,
    };
  }
}
