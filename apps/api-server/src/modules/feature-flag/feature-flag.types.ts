/** 功能开关类型 */
export enum FeatureFlagType {
  /** 全局开/关 */
  BOOLEAN = 'boolean',
  /** 百分比放量 */
  PERCENTAGE = 'percentage',
  /** 白名单/黑名单 */
  USER_LIST = 'user_list',
  /** 按用户画像段 */
  SEGMENT = 'segment',
}
