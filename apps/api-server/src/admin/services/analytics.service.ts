import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between } from 'typeorm';
import { UsageRecord } from '../../entities/usage-record.entity';
import { Client } from '../../entities/client.entity';
import {
  GetOverviewQueryDto,
  GetTopClientsQueryDto,
  GetCapabilityUsageQueryDto,
  GetTimeSeriesQueryDto,
  GetCostAnalysisQueryDto,
  GetErrorAnalysisQueryDto,
} from '../dto/analytics.dto';
import { TimeInterval, GroupBy } from '@ai-platform/shared';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(UsageRecord)
    private readonly usageRecordRepository: Repository<UsageRecord>,
    @InjectRepository(Client)
    private readonly clientRepository: Repository<Client>,
  ) {}

  /**
   * 获取总览数据
   */
  async getOverview(query: GetOverviewQueryDto) {
    const { startDate, endDate } = query;

    // 总请求数
    const totalRequests = await this.usageRecordRepository.count({
      where: {
        timestamp: Between(new Date(startDate), new Date(endDate)),
      },
    });

    // 成功请求数
    const successRequests = await this.usageRecordRepository.count({
      where: {
        timestamp: Between(new Date(startDate), new Date(endDate)),
        status: 'success',
      },
    });

    // 成功率
    const successRate =
      totalRequests > 0 ? (successRequests / totalRequests) * 100 : 0;

    // 平均响应时间和总成本
    const stats = await this.usageRecordRepository
      .createQueryBuilder('record')
      .select('AVG(record.responseTime)', 'avgResponseTime')
      .addSelect('SUM(record.cost)', 'totalCost')
      .addSelect(
        "SUM((record.usage->>'inputTokens')::int + (record.usage->>'outputTokens')::int)",
        'totalTokens',
      )
      .where('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .getRawOne();

    // 独立客户端数
    const uniqueClients = await this.usageRecordRepository
      .createQueryBuilder('record')
      .select('COUNT(DISTINCT record.clientId)', 'count')
      .where('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .getRawOne();

    return {
      totalRequests,
      successRate: Math.round(successRate * 100) / 100,
      avgResponseTime: Math.round(parseFloat(stats.avgResponseTime) || 0),
      totalCost: parseFloat(stats.totalCost) || 0,
      totalTokens: parseInt(stats.totalTokens) || 0,
      uniqueClients: parseInt(uniqueClients.count) || 0,
    };
  }

  /**
   * 获取客户端排行
   */
  async getTopClients(query: GetTopClientsQueryDto) {
    const { startDate, endDate, limit = 10 } = query;

    const topClients = await this.usageRecordRepository
      .createQueryBuilder('record')
      .select('record.clientId', 'clientId')
      .addSelect('COUNT(*)', 'totalRequests')
      .addSelect(
        'CAST(SUM(CASE WHEN record.status = :status THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100',
        'successRate',
      )
      .addSelect('AVG(record.responseTime)', 'avgResponseTime')
      .addSelect('SUM(record.cost)', 'totalCost')
      .addSelect(
        "SUM((record.usage->>'inputTokens')::int + (record.usage->>'outputTokens')::int)",
        'totalTokens',
      )
      .where('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
        status: 'success',
      })
      .groupBy('record.clientId')
      .orderBy('totalRequests', 'DESC')
      .limit(limit)
      .getRawMany();

    // 获取客户端名称
    const clientIds = topClients.map((c) => c.clientId);
    const clients = await this.clientRepository.findByIds(clientIds);
    const clientMap = new Map(clients.map((c) => [c.id, c.name]));

    return topClients.map((client) => ({
      clientId: client.clientId,
      clientName: clientMap.get(client.clientId) || 'Unknown',
      totalRequests: parseInt(client.totalRequests),
      successRate: Math.round(parseFloat(client.successRate) * 100) / 100,
      avgResponseTime: Math.round(parseFloat(client.avgResponseTime) || 0),
      totalCost: parseFloat(client.totalCost),
      totalTokens: parseInt(client.totalTokens) || 0,
    }));
  }

  /**
   * 获取能力使用统计
   */
  async getCapabilityUsage(query: GetCapabilityUsageQueryDto) {
    const { startDate, endDate, capabilityType } = query;

    const queryBuilder = this.usageRecordRepository
      .createQueryBuilder('record')
      .select('record.capabilityType', 'capabilityType')
      .addSelect('COUNT(*)', 'totalRequests')
      .addSelect(
        'CAST(SUM(CASE WHEN record.status = :status THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100',
        'successRate',
      )
      .addSelect('AVG(record.responseTime)', 'avgResponseTime')
      .addSelect('SUM(record.cost)', 'totalCost')
      .addSelect(
        "SUM((record.usage->>'inputTokens')::int + (record.usage->>'outputTokens')::int)",
        'totalTokens',
      )
      .where('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
        status: 'success',
      })
      .groupBy('record.capabilityType')
      .orderBy('totalRequests', 'DESC');

    if (capabilityType) {
      queryBuilder.andWhere('record.capabilityType = :capabilityType', {
        capabilityType,
      });
    }

    const usage = await queryBuilder.getRawMany();

    return usage.map((u) => ({
      capabilityType: u.capabilityType,
      totalRequests: parseInt(u.totalRequests),
      successRate: Math.round(parseFloat(u.successRate) * 100) / 100,
      avgResponseTime: Math.round(parseFloat(u.avgResponseTime)),
      totalCost: parseFloat(u.totalCost),
      totalTokens: parseInt(u.totalTokens) || 0,
    }));
  }

  /**
   * 获取时间序列数据
   */
  async getTimeSeries(query: GetTimeSeriesQueryDto) {
    const { startDate, endDate, interval, metric = 'requests' } = query;

    let dateFormat: string;
    switch (interval) {
      case TimeInterval.HOUR:
        dateFormat = "TO_CHAR(timestamp, 'YYYY-MM-DD HH24:00:00')";
        break;
      case TimeInterval.DAY:
        dateFormat = "TO_CHAR(timestamp, 'YYYY-MM-DD')";
        break;
      case TimeInterval.WEEK:
        dateFormat = "TO_CHAR(DATE_TRUNC('week', timestamp), 'YYYY-MM-DD')";
        break;
      case TimeInterval.MONTH:
        dateFormat = "TO_CHAR(timestamp, 'YYYY-MM')";
        break;
      default:
        dateFormat = "TO_CHAR(timestamp, 'YYYY-MM-DD')";
    }

    let valueSelect: string;
    switch (metric) {
      case 'requests':
        valueSelect = 'COUNT(*)';
        break;
      case 'cost':
        valueSelect = 'SUM(cost)';
        break;
      case 'tokens':
        valueSelect =
          "SUM((usage->>'inputTokens')::int + (usage->>'outputTokens')::int)";
        break;
      case 'responseTime':
        valueSelect = 'AVG(record.responseTime)';
        break;
      default:
        valueSelect = 'COUNT(*)';
    }

    const data = await this.usageRecordRepository
      .createQueryBuilder('record')
      .select(dateFormat, 'timestamp')
      .addSelect(valueSelect, 'value')
      .where('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy('timestamp')
      .orderBy('timestamp', 'ASC')
      .getRawMany();

    return data.map((d) => ({
      timestamp: d.timestamp,
      value: parseFloat(d.value) || 0,
    }));
  }

  /**
   * 获取成本分析
   */
  async getCostAnalysis(query: GetCostAnalysisQueryDto) {
    const { startDate, endDate, groupBy } = query;

    let groupField: string;
    let nameField: string;

    switch (groupBy) {
      case GroupBy.CLIENT:
        groupField = 'record.clientId';
        nameField = 'clientId';
        break;
      case GroupBy.CAPABILITY:
        groupField = 'record.capabilityType';
        nameField = 'capabilityType';
        break;
      case GroupBy.PROVIDER:
        groupField = 'record.provider';
        nameField = 'provider';
        break;
      case GroupBy.MODEL:
        groupField = 'record.model';
        nameField = 'model';
        break;
      default:
        groupField = 'record.clientId';
        nameField = 'clientId';
    }

    const items = await this.usageRecordRepository
      .createQueryBuilder('record')
      .select(groupField, 'id')
      .addSelect('SUM(record.cost)', 'cost')
      .addSelect('COUNT(*)', 'requests')
      .addSelect(
        "SUM((record.usage->>'inputTokens')::int + (record.usage->>'outputTokens')::int)",
        'tokens',
      )
      .where('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .groupBy(groupField)
      .orderBy('cost', 'DESC')
      .getRawMany();

    // 计算总成本
    const totalCost = items.reduce(
      (sum, item) => sum + parseFloat(item.cost),
      0,
    );

    // 如果按客户端分组，获取客户端名称
    let nameMap = new Map<string, string>();
    if (groupBy === GroupBy.CLIENT) {
      const clientIds = items.map((i) => i.id);
      const clients = await this.clientRepository.findByIds(clientIds);
      nameMap = new Map(clients.map((c) => [c.id, c.name]));
    }

    return items.map((item) => ({
      groupKey:
        groupBy === GroupBy.CLIENT
          ? nameMap.get(item.id) || 'Unknown'
          : item.id,
      totalCost: parseFloat(item.cost),
      totalRequests: parseInt(item.requests),
      totalTokens: parseInt(item.tokens) || 0,
      percentage:
        totalCost > 0
          ? Math.round((parseFloat(item.cost) / totalCost) * 10000) / 100
          : 0,
    }));
  }

  /**
   * 获取错误分析
   */
  async getErrorAnalysis(query: GetErrorAnalysisQueryDto) {
    const { startDate, endDate, limit = 10 } = query;

    const errors = await this.usageRecordRepository
      .createQueryBuilder('record')
      .select("record.metadata->>'errorCode'", 'errorType')
      .addSelect("record.metadata->>'errorMessage'", 'errorMessage')
      .addSelect('COUNT(*)', 'count')
      .addSelect('MAX(record.timestamp)', 'lastOccurrence')
      .where('record.timestamp BETWEEN :startDate AND :endDate', {
        startDate,
        endDate,
      })
      .andWhere('record.status != :status', { status: 'success' })
      .groupBy("record.metadata->>'errorCode'")
      .addGroupBy("record.metadata->>'errorMessage'")
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany();

    // 总错误数
    const totalErrors = await this.usageRecordRepository.count({
      where: {
        timestamp: Between(new Date(startDate), new Date(endDate)),
        status: 'failed',
      },
    });

    return errors.map((error) => ({
      errorCode: error.errorType || 'Unknown',
      errorMessage: error.errorMessage || 'No message',
      count: parseInt(error.count),
      percentage:
        totalErrors > 0
          ? Math.round((parseInt(error.count) / totalErrors) * 10000) / 100
          : 0,
    }));
  }

  /**
   * 获取仪表盘聚合数据
   */
  async getDashboard(query: GetOverviewQueryDto) {
    const [overview, topClients, capabilityUsage, recentErrors] =
      await Promise.all([
        this.getOverview(query),
        this.getTopClients({ ...query, limit: 5 }),
        this.getCapabilityUsage(query),
        this.getErrorAnalysis({ ...query, limit: 5 }),
      ]);

    return {
      overview,
      topClients,
      capabilityUsage,
      recentErrors,
    };
  }
}
