import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';
import {
  CronBackend,
  CronHandlerContext,
  CronHandlerRegistry,
} from '../../core/cron';
import { PushService } from './push.service';
import { PushNotificationType } from './push.types';

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PushScheduler implements OnModuleInit {
  private readonly logger = new Logger(PushScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly cronBackend: CronBackend,
    private readonly cronRegistry: CronHandlerRegistry,
  ) {}

  onModuleInit(): void {
    this.cronRegistry.register('push.daily-check-in', (ctx) =>
      this.runDailyCheckIn(ctx),
    );
    this.cronRegistry.register('push.no-analysis-today', (ctx) =>
      this.runNoAnalysisToday(ctx),
    );
    this.cronRegistry.register('push.weekly-report-ready', (ctx) =>
      this.runWeeklyReportReady(ctx),
    );
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async dailyCheckInTick() {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.runDailyCheckIn({
      trigger: 'inproc',
      triggeredAt: new Date().toISOString(),
    });
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async noAnalysisTodayTick() {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.runNoAnalysisToday({
      trigger: 'inproc',
      triggeredAt: new Date().toISOString(),
    });
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async weeklyReportReadyTick() {
    if (!this.cronBackend.shouldRunInProc()) return;
    await this.runWeeklyReportReady({
      trigger: 'inproc',
      triggeredAt: new Date().toISOString(),
    });
  }

  async runDailyCheckIn(_ctx: CronHandlerContext) {
    await this.runWindowedPreferenceJob(
      PushNotificationType.DAILY_CHECK_IN,
      'dailyCheckInEnabled',
      'dailyReminderTime',
    );
  }

  async runNoAnalysisToday(_ctx: CronHandlerContext) {
    const now = new Date();
    const prefs = await this.findDuePreferences(
      'noAnalysisTodayEnabled',
      'noAnalysisReminderTime',
      now,
    );

    for (const pref of prefs) {
      const localDay = this.localDateKey(now, pref.timezone);
      const localDayRange = this.utcRangeForLocalDay(now, pref.timezone);
      const alreadyAnalyzed = await this.prisma.foodAnalysisRecords.count({
        where: {
          userId: pref.userId,
          createdAt: {
            gte: localDayRange.start,
            lt: localDayRange.end,
          },
          status: 'completed',
        },
      });
      if (alreadyAnalyzed > 0) continue;

      if (
        await this.sentRecently(
          pref.userId,
          PushNotificationType.NO_ANALYSIS_TODAY,
          localDay,
        )
      ) {
        continue;
      }

      await this.pushService.send({
        userId: pref.userId,
        type: PushNotificationType.NO_ANALYSIS_TODAY,
        payload: { target: 'home', localDay },
        locale: pref.locale,
        scheduledFor: now,
      });
    }
  }

  async runWeeklyReportReady(_ctx: CronHandlerContext) {
    const now = new Date();
    const prefs = await this.findDuePreferences(
      'weeklyReportEnabled',
      'weeklyReportTime',
      now,
    );

    for (const pref of prefs) {
      const local = this.localParts(now, pref.timezone);
      if (local.weekday !== pref.weeklyReportDay) continue;
      const weekKey = `${local.year}-W${local.week}`;

      if (
        await this.sentRecently(
          pref.userId,
          PushNotificationType.WEEKLY_REPORT_READY,
          weekKey,
        )
      ) {
        continue;
      }

      await this.pushService.send({
        userId: pref.userId,
        type: PushNotificationType.WEEKLY_REPORT_READY,
        payload: { target: 'weekly_report', reportWeek: weekKey },
        locale: pref.locale,
        scheduledFor: now,
      });
    }
  }

  private async runWindowedPreferenceJob(
    type: PushNotificationType,
    enabledField: 'dailyCheckInEnabled',
    timeField: 'dailyReminderTime',
  ) {
    const now = new Date();
    const prefs = await this.findDuePreferences(enabledField, timeField, now);
    for (const pref of prefs) {
      const localDay = this.localDateKey(now, pref.timezone);
      if (await this.sentRecently(pref.userId, type, localDay)) continue;
      await this.pushService.send({
        userId: pref.userId,
        type,
        payload: { target: 'home', localDay },
        locale: pref.locale,
        scheduledFor: now,
      });
    }
  }

  private async findDuePreferences(
    enabledField:
      | 'dailyCheckInEnabled'
      | 'noAnalysisTodayEnabled'
      | 'weeklyReportEnabled',
    timeField:
      | 'dailyReminderTime'
      | 'noAnalysisReminderTime'
      | 'weeklyReportTime',
    now: Date,
  ) {
    const prefs = await this.prisma.userNotificationPreference.findMany({
      where: { pushEnabled: true, [enabledField]: true },
      take: 1000,
    });

    return prefs.filter((pref) => {
      const local = this.localParts(now, pref.timezone);
      const targetMinutes = this.parseMinutes(pref[timeField]);
      const currentMinutes = local.hour * 60 + local.minute;
      if (Math.abs(currentMinutes - targetMinutes) > 5) return false;
      return !this.isQuietTime(currentMinutes, pref.quietStart, pref.quietEnd);
    });
  }

  private async sentRecently(
    userId: string,
    type: PushNotificationType,
    marker: string,
  ): Promise<boolean> {
    const since = new Date(Date.now() - 8 * ONE_DAY_MS);
    const count = await this.prisma.pushNotificationLog.count({
      where: {
        userId,
        notificationType: type,
        status: 'SENT',
        createdAt: { gte: since },
        payload: { path: ['localDay'], equals: marker },
      },
    });
    if (count > 0) return true;

    const weeklyCount = await this.prisma.pushNotificationLog.count({
      where: {
        userId,
        notificationType: type,
        status: 'SENT',
        createdAt: { gte: since },
        payload: { path: ['reportWeek'], equals: marker },
      },
    });
    return weeklyCount > 0;
  }

  private parseMinutes(value: string): number {
    const [h, m] = value.split(':').map((part) => Number(part));
    return h * 60 + m;
  }

  private isQuietTime(now: number, start: string, end: string): boolean {
    const s = this.parseMinutes(start);
    const e = this.parseMinutes(end);
    if (s === e) return false;
    if (s < e) return now >= s && now < e;
    return now >= s || now < e;
  }

  private localDateKey(date: Date, timezone: string): string {
    const parts = this.localParts(date, timezone);
    return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
  }

  private localParts(date: Date, timezone: string) {
    try {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        weekday: 'short',
      }).formatToParts(date);
      const get = (type: string) =>
        parts.find((part) => part.type === type)?.value ?? '0';
      const year = Number(get('year'));
      const month = Number(get('month'));
      const day = Number(get('day'));
      const hour = Number(get('hour')) % 24;
      const minute = Number(get('minute'));
      const weekdayMap: Record<string, number> = {
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
        Sun: 7,
      };
      return {
        year,
        month,
        day,
        hour,
        minute,
        weekday: weekdayMap[get('weekday')] ?? 1,
        week: this.isoWeek(new Date(Date.UTC(year, month - 1, day))),
      };
    } catch {
      this.logger.warn(`Invalid timezone ${timezone}, fallback to UTC`);
      return this.localParts(date, 'UTC');
    }
  }

  private isoWeek(date: Date): number {
    const d = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
    );
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(
      ((d.getTime() - yearStart.getTime()) / ONE_DAY_MS + 1) / 7,
    );
  }

  private utcRangeForLocalDay(now: Date, timezone: string) {
    const parts = this.localParts(now, timezone);
    const start = this.utcFromLocalWallTime(
      parts.year,
      parts.month,
      parts.day,
      0,
      0,
      timezone,
    );
    const end = new Date(start.getTime() + ONE_DAY_MS);
    return { start, end };
  }

  private utcFromLocalWallTime(
    year: number,
    month: number,
    day: number,
    hour: number,
    minute: number,
    timezone: string,
  ): Date {
    const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute));
    const offset = this.timezoneOffsetMinutes(utcGuess, timezone);
    const corrected = new Date(utcGuess.getTime() - offset * 60_000);
    const correctedOffset = this.timezoneOffsetMinutes(corrected, timezone);
    return new Date(utcGuess.getTime() - correctedOffset * 60_000);
  }

  private timezoneOffsetMinutes(date: Date, timezone: string): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');
    const asUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour') % 24,
      get('minute'),
      get('second'),
    );
    return Math.round((asUtc - date.getTime()) / 60_000);
  }
}
