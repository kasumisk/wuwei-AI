/**
 * 时区工具函数
 *
 * V5 Phase 1.8: 统一使用 IANA 时区字符串替代 new Date().getHours() / toISOString().split('T')[0]
 * 所有涉及用户本地时间的计算都应通过此工具获取，避免服务器时区偏差。
 */

/** 默认时区 — 当用户未设置时区时使用 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai';

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
  // en-CA locale 保证输出 YYYY-MM-DD 格式
  return date.toLocaleDateString('en-CA', { timeZone: timezone });
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
  return Number(
    date.toLocaleString('en-US', {
      timeZone: timezone,
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
  // 用 en-US locale 的 weekday: 'short' 拿到缩写，再映射为数字
  const weekdayStr = date.toLocaleDateString('en-US', {
    timeZone: timezone,
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
  // 构造两个格式化器：一个 UTC、一个目标时区
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: timezone });
  // 解析为 Date 对象计算差值（Date.parse 以本地时区解析，但两者一致所以差值正确）
  return new Date(tzStr).getTime() - new Date(utcStr).getTime();
}
