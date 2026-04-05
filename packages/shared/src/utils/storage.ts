/**
 * 本地存储工具类
 */
export class Storage {
  private prefix: string;

  constructor(prefix = 'app') {
    this.prefix = prefix;
  }

  private getKey(key: string): string {
    return `${this.prefix}:${key}`;
  }

  /**
   * 设置存储项
   * @param key 键
   * @param value 值
   * @param expire 过期时间（秒）
   */
  set<T>(key: string, value: T, expire?: number): void {
    const fullKey = this.getKey(key);
    const data = {
      value,
      expire: expire ? Date.now() + expire * 1000 : null,
    };
    localStorage.setItem(fullKey, JSON.stringify(data));
  }

  /**
   * 获取存储项
   * @param key 键
   */
  get<T>(key: string): T | null {
    const fullKey = this.getKey(key);
    const item = localStorage.getItem(fullKey);

    if (!item) return null;

    try {
      const data = JSON.parse(item);

      // 检查是否过期
      if (data.expire && Date.now() > data.expire) {
        this.remove(key);
        return null;
      }

      return data.value as T;
    } catch {
      return null;
    }
  }

  /**
   * 移除存储项
   * @param key 键
   */
  remove(key: string): void {
    const fullKey = this.getKey(key);
    localStorage.removeItem(fullKey);
  }

  /**
   * 清空所有存储项
   */
  clear(): void {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith(`${this.prefix}:`)) {
        localStorage.removeItem(key);
      }
    });
  }

  /**
   * 检查键是否存在
   * @param key 键
   */
  has(key: string): boolean {
    return this.get(key) !== null;
  }
}

/**
 * 默认存储实例
 */
export const storage = new Storage();
