/**
 * 格式化日期
 * @param date 日期
 * @param format 格式
 */
export function formatDate(date: Date | string | number, format = 'YYYY-MM-DD HH:mm:ss'): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');

  return format
    .replace('YYYY', String(year))
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

/**
 * 格式化文件大小
 * @param bytes 字节数
 * @param decimals 小数位数
 */
export function formatFileSize(bytes: number, decimals = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * 格式化数字（千分位）
 * @param num 数字
 * @param decimals 小数位数
 */
export function formatNumber(num: number, decimals?: number): string {
  const value = decimals !== undefined ? num.toFixed(decimals) : String(num);
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 格式化货币
 * @param amount 金额
 * @param currency 货币符号
 * @param decimals 小数位数
 */
export function formatCurrency(amount: number, currency = '$', decimals = 2): string {
  return `${currency}${formatNumber(amount, decimals)}`;
}

/**
 * 隐藏手机号中间四位
 * @param phone 手机号
 */
export function maskPhone(phone: string): string {
  return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
}

/**
 * 隐藏邮箱部分字符
 * @param email 邮箱
 */
export function maskEmail(email: string): string {
  const [name, domain] = email.split('@');
  const maskedName = name.substring(0, 2) + '***' + name.substring(name.length - 1);
  return `${maskedName}@${domain}`;
}
