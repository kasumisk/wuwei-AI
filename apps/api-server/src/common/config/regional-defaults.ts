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
