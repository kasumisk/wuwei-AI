/**
 * V6.2 Phase 3.10 — 数据导出服务
 *
 * 负责将用户饮食数据（food_records + daily_summaries）导出为 CSV 格式。
 *
 * 功能权益控制：
 * - Pro: csv 格式
 * - Premium: pdf_excel 格式（预留，当前仅实现 CSV）
 * - Free: 无导出权限（在入队前由 QuotaGateService 拦截）
 *
 * 导出流程：
 * 1. 控制器验证权限后将任务入队 export 队列
 * 2. ExportProcessor 消费 job → 调用本 Service 生成导出数据
 * 3. 生成的 CSV 存储到本地临时目录或云存储
 * 4. 通知用户导出完成（通过 NotificationService）
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { t } from '../recommendation/utils/i18n-messages';

/** 导出任务数据结构 — 由控制器入队时构造 */
export interface ExportJobData {
  /** 导出任务唯一 ID（用于轮询结果） */
  exportId: string;
  /** 用户 ID */
  userId: string;
  /** 导出格式：csv | pdf | xlsx */
  format: 'csv' | 'pdf' | 'xlsx';
  /** 开始日期（ISO string，如 '2025-01-01'） */
  startDate: string;
  /** 结束日期（ISO string，如 '2025-01-31'） */
  endDate: string;
  /** 导出内容类型 */
  dataTypes: ('food_records' | 'daily_summaries')[];
}

/** 导出结果 */
export interface ExportResult {
  exportId: string;
  /** 生成的 CSV 内容（当前直接返回文本，后续可改为文件 URL） */
  content: string;
  format: string;
  /** 记录数 */
  recordCount: number;
  /** 生成时间 */
  generatedAt: string;
}

@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 生成用户数据导出
   */
  async generateExport(jobData: ExportJobData): Promise<ExportResult> {
    const { exportId, userId, format, startDate, endDate, dataTypes } = jobData;
    this.logger.log(
      `开始导出: exportId=${exportId}, userId=${userId}, format=${format}, range=${startDate}~${endDate}`,
    );

    const start = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T23:59:59.999Z`);

    const sections: string[] = [];
    let totalRecords = 0;

    // 导出饮食记录
    if (dataTypes.includes('food_records')) {
      const { csv, count } = await this.exportFoodRecords(userId, start, end);
      if (count > 0) {
        sections.push(`${t('export.section.foodRecords')}${csv}`);
        totalRecords += count;
      }
    }

    // 导出每日汇总
    if (dataTypes.includes('daily_summaries')) {
      const { csv, count } = await this.exportDailySummaries(
        userId,
        start,
        end,
      );
      if (count > 0) {
        sections.push(`${t('export.section.dailySummaries')}${csv}`);
        totalRecords += count;
      }
    }

    const content =
      sections.length > 0
        ? sections.join(
            t('export.section.separator') + t('export.section.separator'),
          )
        : `# ${t('export.fallback.unknown')}\n`;

    this.logger.log(`导出完成: exportId=${exportId}, records=${totalRecords}`);

    return {
      exportId,
      content,
      format,
      recordCount: totalRecords,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * 导出饮食记录为 CSV
   */
  private async exportFoodRecords(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<{ csv: string; count: number }> {
    const records = await this.prisma.foodRecords.findMany({
      where: {
        userId: userId,
        recordedAt: { gte: start, lte: end },
      },
      orderBy: { recordedAt: 'asc' },
    });

    if (records.length === 0) {
      return { csv: '', count: 0 };
    }

    const headers = [
      t('export.record_header.date'),
      t('export.record_header.mealType'),
      t('export.record_header.food'),
      t('export.record_header.totalCalories'),
      t('export.record_header.protein'),
      t('export.record_header.fat'),
      t('export.record_header.carbs'),
      t('export.record_header.fiber'),
      t('export.record_header.sodium'),
      t('export.record_header.quantity'),
      t('export.record_header.unit'),
      t('export.record_header.source'),
    ];

    const rows = records.map((r) => {
      const foodsStr = this.formatFoods(r.foods);
      return [
        this.formatDate(r.recordedAt),
        r.mealType,
        this.escapeCsv(foodsStr),
        r.totalCalories,
        Number(r.totalProtein) || 0,
        Number(r.totalFat) || 0,
        Number(r.totalCarbs) || 0,
        Number(r.avgQuality) || 0,
        Number(r.avgSatiety) || 0,
        r.nutritionScore,
        r.decision,
        r.source,
      ].join(',');
    });

    const csv = [headers.join(','), ...rows].join('\n');
    return { csv, count: records.length };
  }

  /**
   * 导出每日汇总为 CSV
   */
  private async exportDailySummaries(
    userId: string,
    start: Date,
    end: Date,
  ): Promise<{ csv: string; count: number }> {
    const summaries = await this.prisma.dailySummaries.findMany({
      where: {
        userId: userId,
        date: { gte: start, lte: end },
      },
      orderBy: { date: 'asc' },
    });

    if (summaries.length === 0) {
      return { csv: '', count: 0 };
    }

    const headers = [
      t('export.summary_header.date'),
      t('export.summary_header.totalCalories'),
      t('export.summary_header.caloriesTarget'),
      t('export.summary_header.caloriesPercent'),
      t('export.summary_header.protein'),
      t('export.summary_header.proteinTarget'),
      t('export.summary_header.fat'),
      t('export.summary_header.fatTarget'),
      t('export.summary_header.carbs'),
      t('export.summary_header.carbsTarget'),
      t('export.summary_header.fiber'),
      t('export.summary_header.sodium'),
      t('export.summary_header.score'),
    ];

    const rows = summaries.map((s) =>
      [
        this.formatDate(s.date),
        s.totalCalories,
        s.calorieGoal ?? '',
        s.mealCount,
        Number(s.totalProtein) || 0,
        Number(s.proteinGoal) || 0,
        Number(s.totalFat) || 0,
        Number(s.fatGoal) || 0,
        Number(s.totalCarbs) || 0,
        Number(s.carbsGoal) || 0,
        Number(s.avgQuality) || 0,
        Number(s.avgSatiety) || 0,
        s.nutritionScore,
      ].join(','),
    );

    const csv = [headers.join(','), ...rows].join('\n');
    return { csv, count: summaries.length };
  }

  // ─── Helpers ───

  /**
   * 将 JSONB foods 字段格式化为可读字符串
   */
  private formatFoods(foods: unknown): string {
    if (!foods || !Array.isArray(foods)) return '';
    return (foods as Array<{ name?: string; foodName?: string }>)
      .map((f) => f.name || f.foodName || t('export.fallback.unknown'))
      .join('; ');
  }

  /**
   * 格式化日期为 YYYY-MM-DD
   */
  private formatDate(date: Date): string {
    return date.toISOString().slice(0, 10);
  }

  /**
   * CSV 字段转义：含逗号/换行/引号的字段用双引号包裹
   */
  private escapeCsv(value: string): string {
    if (value.includes(',') || value.includes('\n') || value.includes('"')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
