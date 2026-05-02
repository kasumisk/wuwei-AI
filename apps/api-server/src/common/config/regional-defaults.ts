/**
 * 区域 / 时区 / 语言 默认值（单点常量）
 *
 * 设计目标：
 * - 整个后端使用一组**集中、可单点修改**的默认值，避免散落的 'CN' / 'Asia/Shanghai' / 'zh-CN' 字面量。
 * - 推荐引擎、画像聚合、时区工具、Prisma schema default 都以这里为唯一来源。
 * - 修改默认面向市场时，只需改这一文件 + schema.prisma 中对应的 @default()。
 *
 * 当前默认面向：北美英文用户。
 */

/**
 * 默认区域代码（FoodRegionalInfo.region / UserProfiles.regionCode）
 *
 * 格式与 food-regional-info.util.ts 的 parseFoodRegionScope 兼容：
 *   'US'        → countryCode='US', regionCode=null, cityCode=null
 *   'US-CA'     → countryCode='US', regionCode='CA', cityCode=null
 *   'US-CA-LAX' → countryCode='US', regionCode='CA', cityCode='LAX'
 *
 * 当前默认：北美英文用户 → 'US'
 * 注意：不要使用 'NA'（会被 parseFoodRegionScope 截成无效的两字母 countryCode）。
 */
export const DEFAULT_REGION_CODE = 'US';

/**
 * 默认 IANA 时区
 *
 * 用于：
 * - timezone.util.ts 全部工具函数的 timezone 参数缺省值
 * - PipelineContext.timezone 缺失时的兜底
 * - 用户画像中 declared.timezone 缺失时的最终兜底
 */
export const DEFAULT_TIMEZONE = 'America/New_York';

/**
 * 默认 BCP 47 语言标签（UserProfiles.locale）
 *
 * 用于：
 * - 推荐结果 i18n 文案 fallback
 * - 阶段 1.4 当 regionCode 缺失时通过 localeToFoodRegion(locale) 兜底推断 region
 */
export const DEFAULT_LOCALE = 'en-US';

// ─── P3-2.4 / P3-3.3 / P3-3.4 区域调参表 ──────────────────────────────────────

/**
 * 南半球国家 ISO 代码（季节翻转用）
 *
 * 用于：
 * - explanation-generator monthToSeason
 * - SeasonalityService 月份权重读取
 *
 * 注：仅含 region 主导市场的南半球国家，扩展时与 monthToSeason 同步。
 */
export const SOUTHERN_HEMISPHERE_REGIONS: ReadonlySet<string> = new Set([
  'AU', // Australia
  'NZ', // New Zealand
  'AR', // Argentina
  'CL', // Chile
  'ZA', // South Africa
  'BR', // Brazil
  'PE', // Peru
  'UY', // Uruguay
]);

/**
 * 判断 region 是否在南半球
 *
 * regionCode 支持 'AU' / 'AU-NSW' / 'AU-NSW-SYD' 等格式，仅看 country 段。
 */
export function isSouthernHemisphere(regionCode?: string | null): boolean {
  if (!regionCode) return false;
  const country = regionCode.split('-')[0]?.toUpperCase();
  return country ? SOUTHERN_HEMISPHERE_REGIONS.has(country) : false;
}

/**
 * P3-2.4 区域分段阈值调参表
 *
 * 用于 inferUserSegment：不同区域用户行为节奏存在系统差异，
 * 同一行为模式应得到不同 segment 推断。
 *
 * 默认值（default 行）= 与历史行为完全一致。具体 region 的数值
 * 待 §1.8 监控数据 + strategy-auto-tuner 复盘后基于 A/B 数据迭代。
 *
 * 当前所有 region 都使用 default 值（开关式上线，不影响存量）。
 */
export interface RegionSegmentTuning {
  /** new_user 截止 usageDays（< 此值视为新用户） */
  newUserUsageDays: number;
  /** returning_user 触发的 daysSinceLastRecord 阈值 */
  returningInactiveDays: number;
  /** disciplined_loser / active_maintainer 的 compliance 阈值 */
  highComplianceThreshold: number;
}

export const DEFAULT_REGION_SEGMENT_TUNING: RegionSegmentTuning = {
  newUserUsageDays: 7,
  returningInactiveDays: 14,
  highComplianceThreshold: 0.7,
};

export const REGION_SEGMENT_TUNING: Record<string, RegionSegmentTuning> = {
  // 当前全部 = default；保留 key 以便后续按需差异化（zero-impact 上线）
  US: { ...DEFAULT_REGION_SEGMENT_TUNING },
  CN: { ...DEFAULT_REGION_SEGMENT_TUNING },
  JP: { ...DEFAULT_REGION_SEGMENT_TUNING },
};

export function getRegionSegmentTuning(
  regionCode?: string | null,
): RegionSegmentTuning {
  if (!regionCode) return DEFAULT_REGION_SEGMENT_TUNING;
  const country = regionCode.split('-')[0]?.toUpperCase();
  return (
    (country && REGION_SEGMENT_TUNING[country]) || DEFAULT_REGION_SEGMENT_TUNING
  );
}

/**
 * P3-2.4 区域 macro 比例偏置表（百分点 pp）
 *
 * 用于在 cron 计算 macroTargets 后做 region 微调。
 * 正值 = 该 macro 在该 region 的占比上调；负值 = 下调。
 *
 * 总偏置（pp 之和）应为 0，避免引入总热量漂移。
 *
 * 默认值（所有 region）= 0 pp（开关式上线）。
 */
export interface RegionMacroBias {
  proteinPct?: number;
  carbsPct?: number;
  fatPct?: number;
}

export const REGION_MACRO_BIAS: Record<string, RegionMacroBias> = {
  // 全部为 0；后续基于 §1.8 监控数据迭代
  US: { proteinPct: 0, carbsPct: 0, fatPct: 0 },
  CN: { proteinPct: 0, carbsPct: 0, fatPct: 0 },
  JP: { proteinPct: 0, carbsPct: 0, fatPct: 0 },
};

export function getRegionMacroBias(
  regionCode?: string | null,
): RegionMacroBias {
  if (!regionCode) return {};
  const country = regionCode.split('-')[0]?.toUpperCase();
  return (country && REGION_MACRO_BIAS[country]) || {};
}
