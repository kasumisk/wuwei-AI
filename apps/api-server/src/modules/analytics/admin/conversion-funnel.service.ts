import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { AppUser } from '../../user/entities/app-user.entity';
import { FoodAnalysisRecord } from '../../food/entities/food-analysis-record.entity';
import { SubscriptionTriggerLog } from '../../subscription/entities/subscription-trigger-log.entity';
import { PaymentRecord } from '../../subscription/entities/payment-record.entity';
import { Subscription } from '../../subscription/entities/subscription.entity';
import {
  GetConversionFunnelQueryDto,
  GetConversionTrendQueryDto,
} from './dto/conversion-funnel.dto';

/**
 * 转化漏斗分析服务
 *
 * 五步漏斗模型:
 *   1. 注册用户 — app_user.created_at 在时间范围内
 *   2. 使用功能 — food_analysis_record 有记录的去重用户数
 *   3. 触发付费墙 — subscription_trigger_log 有记录的去重用户数
 *   4. 发起支付 — payment_record 有记录的去重用户数
 *   5. 支付成功 — payment_record status='success' 的去重用户数
 */
@Injectable()
export class ConversionFunnelService {
  private readonly logger = new Logger(ConversionFunnelService.name);

  constructor(
    @InjectRepository(AppUser)
    private readonly appUserRepo: Repository<AppUser>,
    @InjectRepository(FoodAnalysisRecord)
    private readonly analysisRecordRepo: Repository<FoodAnalysisRecord>,
    @InjectRepository(SubscriptionTriggerLog)
    private readonly triggerLogRepo: Repository<SubscriptionTriggerLog>,
    @InjectRepository(PaymentRecord)
    private readonly paymentRecordRepo: Repository<PaymentRecord>,
    @InjectRepository(Subscription)
    private readonly subscriptionRepo: Repository<Subscription>,
  ) {}

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
    const registeredQb = this.appUserRepo
      .createQueryBuilder('u')
      .where('u.created_at BETWEEN :start AND :end', { start, end });

    if (authType) {
      registeredQb.andWhere('u.auth_type = :authType', { authType });
    }

    const registeredCount = await registeredQb.getCount();

    // 获取这批用户的 ID 列表（子查询复用）
    const userSubQuery = registeredQb.select('u.id').getQuery();
    const userSubParams = { start, end, ...(authType ? { authType } : {}) };

    // Step 2: 使用功能（食物分析）的去重用户数
    const usedFeatureCount = await this.analysisRecordRepo
      .createQueryBuilder('r')
      .select('COUNT(DISTINCT r.user_id)', 'cnt')
      .where('r.created_at BETWEEN :start AND :end', { start, end })
      .andWhere(
        `r.user_id IN (${this.appUserRepo
          .createQueryBuilder('u')
          .select('u.id')
          .where('u.created_at BETWEEN :start AND :end')
          .andWhere(authType ? 'u.auth_type = :authType' : '1=1')
          .getQuery()})`,
      )
      .setParameters(userSubParams)
      .getRawOne()
      .then((r) => parseInt(r?.cnt || '0', 10));

    // Step 3: 触发付费墙的去重用户数
    const triggerQb = this.triggerLogRepo
      .createQueryBuilder('t')
      .select('COUNT(DISTINCT t.user_id)', 'cnt')
      .where('t.created_at BETWEEN :start AND :end', { start, end })
      .andWhere(
        `t.user_id IN (${this.appUserRepo
          .createQueryBuilder('u')
          .select('u.id')
          .where('u.created_at BETWEEN :start AND :end')
          .andWhere(authType ? 'u.auth_type = :authType' : '1=1')
          .getQuery()})`,
      )
      .setParameters(userSubParams);

    if (triggerScene) {
      triggerQb.andWhere('t.trigger_scene = :triggerScene', { triggerScene });
    }

    const triggeredCount = await triggerQb
      .getRawOne()
      .then((r) => parseInt(r?.cnt || '0', 10));

    // Step 4: 发起支付的去重用户数
    const initiatedPaymentCount = await this.paymentRecordRepo
      .createQueryBuilder('p')
      .select('COUNT(DISTINCT p.user_id)', 'cnt')
      .where('p.created_at BETWEEN :start AND :end', { start, end })
      .andWhere(
        `p.user_id IN (${this.appUserRepo
          .createQueryBuilder('u')
          .select('u.id')
          .where('u.created_at BETWEEN :start AND :end')
          .andWhere(authType ? 'u.auth_type = :authType' : '1=1')
          .getQuery()})`,
      )
      .setParameters(userSubParams)
      .getRawOne()
      .then((r) => parseInt(r?.cnt || '0', 10));

    // Step 5: 支付成功的去重用户数
    const paidCount = await this.paymentRecordRepo
      .createQueryBuilder('p')
      .select('COUNT(DISTINCT p.user_id)', 'cnt')
      .where('p.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('p.status = :payStatus', { payStatus: 'success' })
      .andWhere(
        `p.user_id IN (${this.appUserRepo
          .createQueryBuilder('u')
          .select('u.id')
          .where('u.created_at BETWEEN :start AND :end')
          .andWhere(authType ? 'u.auth_type = :authType' : '1=1')
          .getQuery()})`,
      )
      .setParameters(userSubParams)
      .getRawOne()
      .then((r) => parseInt(r?.cnt || '0', 10));

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
    const dateTrunc =
      granularity === 'week'
        ? "date_trunc('week', u.created_at)"
        : granularity === 'month'
          ? "date_trunc('month', u.created_at)"
          : "date_trunc('day', u.created_at)";

    // 注册趋势
    const registrationTrend = await this.appUserRepo
      .createQueryBuilder('u')
      .select(`${dateTrunc}`, 'period')
      .addSelect('COUNT(*)', 'count')
      .where('u.created_at BETWEEN :start AND :end', { start, end })
      .groupBy(dateTrunc)
      .orderBy(dateTrunc, 'ASC')
      .getRawMany();

    // 付费墙触发趋势
    const triggerDateTrunc = dateTrunc.replace(/u\./g, 't.');
    const triggerTrend = await this.triggerLogRepo
      .createQueryBuilder('t')
      .select(`${triggerDateTrunc}`, 'period')
      .addSelect('COUNT(DISTINCT t.user_id)', 'count')
      .where('t.created_at BETWEEN :start AND :end', { start, end })
      .groupBy(triggerDateTrunc)
      .orderBy(triggerDateTrunc, 'ASC')
      .getRawMany();

    // 支付成功趋势
    const payDateTrunc = dateTrunc.replace(/u\./g, 'p.');
    const paymentTrend = await this.paymentRecordRepo
      .createQueryBuilder('p')
      .select(`${payDateTrunc}`, 'period')
      .addSelect('COUNT(DISTINCT p.user_id)', 'count')
      .where('p.created_at BETWEEN :start AND :end', { start, end })
      .andWhere('p.status = :status', { status: 'success' })
      .groupBy(payDateTrunc)
      .orderBy(payDateTrunc, 'ASC')
      .getRawMany();

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
