/**
 * 获取今天的日期字符串 (YYYY-MM-DD)
 */
export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * 从 birthYear 计算年龄
 */
export function calculateAge(birthYear: number): number {
  return new Date().getFullYear() - birthYear;
}
