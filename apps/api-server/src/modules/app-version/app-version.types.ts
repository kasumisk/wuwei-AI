/**
 * 平台类型
 */
export enum AppPlatform {
  ANDROID = 'android',
  IOS = 'ios',
}

/**
 * 更新类型
 */
export enum UpdateType {
  OPTIONAL = 'optional',
  FORCE = 'force',
}

/**
 * 版本状态
 */
export enum AppVersionStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

/**
 * 渠道类型
 * - official / beta: 需要上传安装包
 * - app_store / google_play: 商店渠道，填写商店 URL，不上传安装包
 */
export enum AppChannel {
  OFFICIAL = 'official',
  BETA = 'beta',
  APP_STORE = 'app_store',
  GOOGLE_PLAY = 'google_play',
}

/**
 * 商店渠道列表（无需上传安装包）
 */
export const STORE_CHANNELS = [AppChannel.APP_STORE, AppChannel.GOOGLE_PLAY];
