/**
 * channel.ts — 推荐渠道（channel）规范化
 *
 * 背景（审计 P0-3）：
 *   PrecomputedRecommendations 表使用 (userId, date, mealType, channel) 作为唯一键，
 *   设计意图是让不同渠道（App / Web / 小程序）享受差异化推荐策略与独立缓存。
 *   但实际代码中 channel 默认值为字符串 'unknown'，且上游 controller 完全没有
 *   传 channel —— channel 维度形同虚设，所有渠道共享同一份缓存。
 *
 * 短期方案（本文件）：
 *   - 提供 normalizeChannel：白名单化 + 大小写归一 + trim。
 *   - 让 precompute 服务两端（lookup / store）走同一规范化函数，杜绝
 *     "App" / "app" / " app " 等导致的缓存键漂移。
 *   - 不在请求层强制必填 channel（项目尚无 device/UA middleware），保留
 *     'unknown' fallback；但限定只能命中已知值之一，未知输入会被吞回 'unknown'
 *     并打 warn，便于后续接入 device-detector 时观察真实分布。
 *
 * 长期方案（P1+）：
 *   - 引入 client-context middleware 从 X-Client-Type header / User-Agent 解析；
 *   - 将 channel 类型升级为 enum 并写入 Prisma schema（migration 配套）。
 */

/** 推荐系统支持的渠道白名单。新增渠道时同步更新此处与 schema 注释。 */
export const KNOWN_CHANNELS = [
  'app', // 移动端原生 App（iOS/Android）
  'web', // 浏览器 Web 端
  'miniprogram', // 微信/支付宝 等小程序
  'api', // 服务端到服务端 / 第三方集成
  'unknown', // 未识别（fallback，期望长期归零）
] as const;

export type RecommendationChannel = (typeof KNOWN_CHANNELS)[number];

/** O(1) 查找用 set */
const KNOWN_CHANNEL_SET: Set<string> = new Set(KNOWN_CHANNELS);

/**
 * 规范化 channel 输入。
 *
 * 输入类型故意宽泛（unknown/null/undefined/任意字符串），覆盖来自 query string、
 * header、job payload 等弱类型来源；输出永远是 KNOWN_CHANNELS 之一。
 *
 * @param input  原始 channel 值（可能未 trim、混大小写、null、非法字符串）
 * @param onUnknown  可选回调：当输入非空但不在白名单时触发，便于 metrics 计数。
 *                   不抛错，避免阻塞主链路。
 * @returns RecommendationChannel
 */
export function normalizeChannel(
  input: unknown,
  onUnknown?: (rawValue: string) => void,
): RecommendationChannel {
  if (input === null || input === undefined) {
    return 'unknown';
  }

  if (typeof input !== 'string') {
    // 非字符串类型（比如误传 number/object）也视作 unknown，但触发回调以便排查。
    onUnknown?.(String(input));
    return 'unknown';
  }

  const trimmed = input.trim().toLowerCase();
  if (trimmed.length === 0) {
    return 'unknown';
  }

  if (KNOWN_CHANNEL_SET.has(trimmed)) {
    return trimmed as RecommendationChannel;
  }

  // 常见别名兜底（保持保守，只处理高置信度变体）
  if (trimmed === 'ios' || trimmed === 'android' || trimmed === 'mobile') {
    return 'app';
  }
  if (trimmed === 'browser' || trimmed === 'h5' || trimmed === 'pwa') {
    return 'web';
  }
  if (trimmed === 'wechat' || trimmed === 'mp' || trimmed === 'mini') {
    return 'miniprogram';
  }

  onUnknown?.(trimmed);
  return 'unknown';
}
