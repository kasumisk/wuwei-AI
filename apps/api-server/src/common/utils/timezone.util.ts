/**
 * 时区工具函数
 *
 * V5 Phase 1.8: 统一使用 IANA 时区字符串替代 new Date().getHours() / toISOString().split('T')[0]
 * 所有涉及用户本地时间的计算都应通过此工具获取，避免服务器时区偏差。
 *
 * 区域+时区优化（阶段 1）：DEFAULT_TIMEZONE 来自 common/config/regional-defaults.ts，
 * 当前默认 'America/New_York'，修改默认面向市场时只需改 regional-defaults.ts。
 */

import { DEFAULT_TIMEZONE as REGIONAL_DEFAULT_TIMEZONE } from '../config/regional-defaults';

/** 默认时区 — 当用户未设置时区时使用（re-export 自 regional-defaults，保留旧引用路径） */
export const DEFAULT_TIMEZONE = REGIONAL_DEFAULT_TIMEZONE;

/**
 * Final-fix P1-7：非法/未知 IANA 时区 fallback
 *
 * 现状：用户 profile 可能写入非法 timezone（'GMT+8'/空字符串/老的 deprecated 'CST'），
 * 直接传给 Intl.DateTimeFormat 会抛 RangeError: Invalid time zone specified。
 * 在生产环境多处调用栈（recommend / scoring / 报表）都可能因此崩溃。
 *
 * 这里集中做一次 valid-check + warn-once 缓存，failure 走 DEFAULT_TIMEZONE。
 * 调用者无需改动；valid 缓存避免热点 path 反复 try/catch。
 */
const tzValidCache = new Map<string, string>();
const tzWarnedSet = new Set<string>();
function safeTimezone(tz: string | null | undefined): string {
  if (!tz) return DEFAULT_TIMEZONE;
  const cached = tzValidCache.get(tz);
  if (cached) return cached;
  try {
    // 真实使用 Intl 验证；非法时区会抛 RangeError
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    tzValidCache.set(tz, tz);
    return tz;
  } catch {
    if (!tzWarnedSet.has(tz)) {
      tzWarnedSet.add(tz);
      // 仅 warn 一次，避免日志爆炸
      // eslint-disable-next-line no-console
      console.warn(
        `[timezone.util] invalid timezone '${tz}', falling back to '${DEFAULT_TIMEZONE}'`,
      );
    }
    tzValidCache.set(tz, DEFAULT_TIMEZONE);
    return DEFAULT_TIMEZONE;
  }
}

/**
 * 获取用户本地日期字符串（YYYY-MM-DD 格式）
 *
 * @param timezone IANA 时区字符串，如 'Asia/Shanghai'
 * @param date 可选，指定某个时间点；默认为当前时间
 * @returns 用户本地日期字符串，如 '2025-01-15'
 */
export function getUserLocalDate(
  timezone: string = DEFAULT_TIMEZONE,
  date: Date = new Date(),
): string {
  const tz = safeTimezone(timezone);
  // en-CA locale 保证输出 YYYY-MM-DD 格式
  return date.toLocaleDateString('en-CA', { timeZone: tz });
}

/**
 * 获取用户本地小时数（0-23）
 *
 * @param timezone IANA 时区字符串，如 'Asia/Shanghai'
 * @param date 可选，指定某个时间点；默认为当前时间
 * @returns 用户本地小时数
 */
export function getUserLocalHour(
  timezone: string = DEFAULT_TIMEZONE,
  date: Date = new Date(),
): number {
  const tz = safeTimezone(timezone);
  return Number(
    date.toLocaleString('en-US', {
      timeZone: tz,
      hour: 'numeric',
      hour12: false,
    }),
  );
}

/**
 * V6 2.18: 获取用户本地星期几（0=周日, 1=周一, ..., 6=周六）
 *
 * @param timezone IANA 时区字符串
 * @param date 可选，指定某个时间点；默认为当前时间
 * @returns 0-6，其中 0=周日, 6=周六
 */
export function getUserLocalDayOfWeek(
  timezone: string = DEFAULT_TIMEZONE,
  date: Date = new Date(),
): number {
  const tz = safeTimezone(timezone);
  // 用 en-US locale 的 weekday: 'short' 拿到缩写，再映射为数字
  const weekdayStr = date.toLocaleDateString('en-US', {
    timeZone: tz,
    weekday: 'short',
  });
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[weekdayStr] ?? new Date().getDay();
}

/**
 * V6 2.18: 判断用户本地时间是否为周末（周六或周日）
 */
export function isUserLocalWeekend(
  timezone: string = DEFAULT_TIMEZONE,
  date: Date = new Date(),
): boolean {
  const dow = getUserLocalDayOfWeek(timezone, date);
  return dow === 0 || dow === 6;
}

/**
 * 区域+时区优化（阶段 1.2）：获取用户本地月份（1-12）
 *
 * 用于时令评分等基于月份的逻辑，避免使用服务器时区的 new Date().getMonth()
 * 在跨日界点 / 南半球用户场景下产生偏差。
 *
 * @param timezone IANA 时区字符串
 * @param date 可选，指定某个时间点；默认为当前时间
 * @returns 1-12 月份
 */
export function getUserLocalMonth(
  timezone: string = DEFAULT_TIMEZONE,
  date: Date = new Date(),
): number {
  const tz = safeTimezone(timezone);
  // 'numeric' month → "1".."12"
  const monthStr = date.toLocaleString('en-US', {
    timeZone: tz,
    month: 'numeric',
  });
  const m = Number(monthStr);
  if (Number.isFinite(m) && m >= 1 && m <= 12) return m;
  // 兜底：当地区无法解析时退回服务器月份
  return new Date().getMonth() + 1;
}

/**
 * 获取用户本地一天的起止时间（UTC Date 对象）
 *
 * 用于数据库查询：WHERE createdAt >= startOfDay AND createdAt < endOfDay
 *
 * 实现思路：先获取用户本地日期字符串，再通过 Intl.DateTimeFormat 计算时区偏移，
 * 从而推导出该日 00:00:00 和 24:00:00 对应的 UTC 时间。
 *
 * @param timezone IANA 时区字符串
 * @param date 可选，指定某个时间点；默认为当前时间
 * @returns { startOfDay, endOfDay } — UTC Date 对象
 */
export function getUserLocalDayBounds(
  timezone: string = DEFAULT_TIMEZONE,
  date: Date = new Date(),
): { startOfDay: Date; endOfDay: Date } {
  const localDate = getUserLocalDate(timezone, date);
  // localDate = 'YYYY-MM-DD'，构造该日本地午夜的 UTC 时间
  // 先用 Intl 获取精确的时区偏移量（分钟）
  const offsetMs = getTimezoneOffsetMs(timezone, date);
  // 本地午夜 = UTC 午夜 - 时区偏移
  const startOfDay = new Date(`${localDate}T00:00:00.000Z`);
  startOfDay.setTime(startOfDay.getTime() - offsetMs);
  const endOfDay = new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
  return { startOfDay, endOfDay };
}

/**
 * 获取指定时区相对 UTC 的偏移量（毫秒）
 *
 * 正值表示东区（如 Asia/Shanghai = +28800000 = +8h）
 *
 * @param timezone IANA 时区字符串
 * @param date 参考时间点（用于确定夏令时状态）
 */
function getTimezoneOffsetMs(timezone: string, date: Date): number {
  const tz = safeTimezone(timezone);
  // 构造两个格式化器：一个 UTC、一个目标时区
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: tz });
  // 解析为 Date 对象计算差值（Date.parse 以本地时区解析，但两者一致所以差值正确）
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}
