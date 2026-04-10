// Enums and types extracted from entity files for use after TypeORM removal

/**
 * 管理员角色枚举
 */
export enum AdminRole {
  SUPER_ADMIN = 'super_admin',
  ADMIN = 'admin',
}

/**
 * 管理员状态枚举
 */
export enum AdminUserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  SUSPENDED = 'suspended',
}

/**
 * App 用户认证方式枚举
 */
export enum AppUserAuthType {
  ANONYMOUS = 'anonymous',
  GOOGLE = 'google',
  EMAIL = 'email',
  PHONE = 'phone',
  WECHAT = 'wechat',
  WECHAT_MINI = 'wechat_mini',
  APPLE = 'apple',
}

/**
 * App 用户状态枚举
 */
export enum AppUserStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  BANNED = 'banned',
}

/**
 * 画像变更类型
 */
export type ProfileChangeType =
  | 'preference_weights' // 偏好权重变更
  | 'behavior' // 行为画像变更
  | 'inferred' // 推断画像变更
  | 'declared' // 用户声明信息变更（手动修改目标/过敏原等）
  | 'short_term' // 短期画像变更
  | 'segment'; // 用户细分变更

/**
 * 变更来源
 */
export type ProfileChangeSource =
  | 'feedback' // 用户反馈触发
  | 'meal_record' // 饮食记录触发
  | 'cron' // 定时任务触发
  | 'manual' // 用户手动修改
  | 'event' // 域事件触发
  | 'migration' // 数据迁移
  | 'admin'; // 管理员操作

/**
 * 活动等级枚举
 */
export enum ActivityLevel {
  SEDENTARY = 'sedentary',
  LIGHT = 'light',
  MODERATE = 'moderate',
  ACTIVE = 'active',
}

/**
 * 目标类型枚举
 */
export enum GoalType {
  FAT_LOSS = 'fat_loss', // 减脂
  MUSCLE_GAIN = 'muscle_gain', // 增肌
  HEALTH = 'health', // 保持健康
  HABIT = 'habit', // 改善习惯
}

/**
 * 目标速度枚举
 */
export enum GoalSpeed {
  AGGRESSIVE = 'aggressive', // 快速（激进）
  STEADY = 'steady', // 稳定（推荐）
  RELAXED = 'relaxed', // 佛系（轻松）
}

/**
 * 自律程度枚举
 */
export enum Discipline {
  HIGH = 'high', // 很强
  MEDIUM = 'medium', // 一般
  LOW = 'low', // 容易放弃
}
