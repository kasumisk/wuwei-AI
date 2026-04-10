import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { Prisma } from '@prisma/client';
import {
  GetOverviewQueryDto,
  GetTopClientsQueryDto,
  GetCapabilityUsageQueryDto,
  GetTimeSeriesQueryDto,
  GetCostAnalysisQueryDto,
  GetErrorAnalysisQueryDto,
} from './dto/analytics.dto';
import { TimeInterval, GroupBy } from '@ai-platform/shared';

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取总览数据
   */
  async getOverview(query: GetOverviewQueryDto) {
    const { startDate, endDate } = query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    // 总请求数
    const totalRequests = await this.prisma.usage_records.count({
      where: {
        timestamp: { gte: start, lte: end },
      },
    });

    // 成功请求数
    const successRequests = await this.prisma.usage_records.count({
      where: {
        timestamp: { gte: start, lte: end },
        status: 'success',
      },
    });

    // 成功率
    const successRate =
      totalRequests > 0 ? (successRequests / totalRequests) * 100 : 0;

    // 平均响应时间和总成本
    const stats: any[] = await this.prisma.$queryRaw(Prisma.sql`
      SELECT
        AVG(response_time) AS "avgResponseTime",
        SUM(cost) AS "totalCost",
        SUM((usage->>'inputTokens')::int + (usage->>'outputTokens')::int) AS "totalTokens"
      FROM usage_records
      WHERE timestamp BETWEEN ${start} AND ${end}
    `);

    const statsRow = stats[0] || {};

    // 独立客户端数
    const uniqueClientsResult: any[] = await this.prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(DISTINCT client_id) AS "count"
      FROM usage_records
      WHERE timestamp BETWEEN ${start} AND ${end}
    `);

    const uniqueClientsRow = uniqueClientsResult[0] || {};

    return {
      totalRequests,
      successRate: Math.round(successRate * 100) / 100,
      avgResponseTime: Math.round(parseFloat(statsRow.avgResponseTime) || 0),
      totalCost: parseFloat(statsRow.totalCost) || 0,
      totalTokens: parseInt(statsRow.totalTokens) || 0,
      uniqueClients: parseInt(uniqueClientsRow.count) || 0,
    };
  }

  /**
   * 获取客户端排行
   */
  async getTopClients(query: GetTopClientsQueryDto) {
    const { startDate, endDate, limit = 10 } = query;
    const start = new Date(startDate);
    const end = new Date(endDate);

    const topClients: any[] = await this.prisma.$queryRaw(Prisma.sql`
      SELECT
        client_id AS "clientId",
        COUNT(*) AS "totalRequests",
        CAST(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 AS "successRate",
        AVG(response_time) AS "avgResponseTime",
        SUM(cost) AS "totalCost",
        SUM((usage->>'inputTokens')::int + (usage->>'outputTokens')::int) AS "totalTokens"
      FROM usage_records
      WHERE timestamp BETWEEN ${start} AND ${end}
      GROUP BY client_id
      ORDER BY COUNT(*) DESC
      LIMIT ${limit}
    `);

    // 获取客户端名称
    const clientIds = topClients.map((c) => c.clientId);
    const clients = await this.prisma.clients.findMany({
      where: { id: { in: clientIds } },
    });
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
    const start = new Date(startDate);
    const end = new Date(endDate);

    let usage: any[];

    if (capabilityType) {
      usage = await this.prisma.$queryRaw(Prisma.sql`
        SELECT
          capability_type AS "capabilityType",
          COUNT(*) AS "totalRequests",
          CAST(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 AS "successRate",
          AVG(response_time) AS "avgResponseTime",
          SUM(cost) AS "totalCost",
          SUM((usage->>'inputTokens')::int + (usage->>'outputTokens')::int) AS "totalTokens"
        FROM usage_records
        WHERE timestamp BETWEEN ${start} AND ${end}
          AND capability_type = ${capabilityType}
        GROUP BY capability_type
        ORDER BY COUNT(*) DESC
      `);
    } else {
      usage = await this.prisma.$queryRaw(Prisma.sql`
        SELECT
          capability_type AS "capabilityType",
          COUNT(*) AS "totalRequests",
          CAST(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS FLOAT) / COUNT(*) * 100 AS "successRate",
          AVG(response_time) AS "avgResponseTime",
          SUM(cost) AS "totalCost",
          SUM((usage->>'inputTokens')::int + (usage->>'outputTokens')::int) AS "totalTokens"
        FROM usage_records
        WHERE timestamp BETWEEN ${start} AND ${end}
        GROUP BY capability_type
        ORDER BY COUNT(*) DESC
      `);
    }

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
    const start = new Date(startDate);
    const end = new Date(endDate);

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
        valueSelect = 'AVG(response_time)';
        break;
      default:
        valueSelect = 'COUNT(*)';
    }

    const data: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT ${dateFormat} AS "timestamp", ${valueSelect} AS "value"
       FROM usage_records
       WHERE timestamp BETWEEN $1 AND $2
       GROUP BY ${dateFormat}
       ORDER BY "timestamp" ASC`,
      start,
      end,
    );

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
    const start = new Date(startDate);
    const end = new Date(endDate);

    let groupField: string;

    switch (groupBy) {
      case GroupBy.CLIENT:
        groupField = 'client_id';
        break;
      case GroupBy.CAPABILITY:
        groupField = 'capability_type';
        break;
      case GroupBy.PROVIDER:
        groupField = 'provider';
        break;
      case GroupBy.MODEL:
        groupField = 'model';
        break;
      default:
        groupField = 'client_id';
    }

    const items: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT
         ${groupField} AS "id",
         SUM(cost) AS "cost",
         COUNT(*) AS "requests",
         SUM((usage->>'inputTokens')::int + (usage->>'outputTokens')::int) AS "tokens"
       FROM usage_records
       WHERE timestamp BETWEEN $1 AND $2
       GROUP BY ${groupField}
       ORDER BY SUM(cost) DESC`,
      start,
      end,
    );

    // 计算总成本
    const totalCost = items.reduce(
      (sum, item) => sum + parseFloat(item.cost),
      0,
    );

    // 如果按客户端分组，获取客户端名称
    let nameMap = new Map<string, string>();
    if (groupBy === GroupBy.CLIENT) {
      const clientIds = items.map((i) => i.id);
      const clients = await this.prisma.clients.findMany({
        where: { id: { in: clientIds } },
      });
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
    const start = new Date(startDate);
    const end = new Date(endDate);

    const errors: any[] = await this.prisma.$queryRaw(Prisma.sql`
      SELECT
        metadata->>'errorCode' AS "errorType",
        metadata->>'errorMessage' AS "errorMessage",
        COUNT(*) AS "count",
        MAX(timestamp) AS "lastOccurrence"
      FROM usage_records
      WHERE timestamp BETWEEN ${start} AND ${end}
        AND status != 'success'
      GROUP BY metadata->>'errorCode', metadata->>'errorMessage'
      ORDER BY COUNT(*) DESC
      LIMIT ${limit}
    `);

    // 总错误数
    const totalErrors = await this.prisma.usage_records.count({
      where: {
        timestamp: { gte: start, lte: end },
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
