/**
 * V6 Phase 1.1 — 核心域事件定义
 *
 * 定义系统中所有跨模块通信的域事件类型和载荷结构。
 * 各模块通过 EventEmitter2 emit / @OnEvent 订阅，替代直接 @Inject() 耦合。
 *
 * 命名规则: {模块}.{实体}.{动作} (小写点分隔)
 */

// ─── 事件名称常量 ───

export const DomainEvents = {
  // 用户反馈相关
  FEEDBACK_SUBMITTED: 'user.feedback.submitted',

  // 饮食记录相关
  MEAL_RECORDED: 'user.meal.recorded',

  // 用户画像相关
  PROFILE_UPDATED: 'user.profile.updated',

  // 推荐生成相关
  RECOMMENDATION_GENERATED: 'recommendation.generated',

  // 订阅变更（Phase 2 使用）
  SUBSCRIPTION_CHANGED: 'subscription.changed',

  // 目标达成（Phase 2 使用）
  GOAL_ACHIEVED: 'user.goal.achieved',

  // V6.1: 分析结果保存为饮食记录
  ANALYSIS_SAVED_TO_RECORD: 'food.analysis.saved_to_record',

  // V6.1 Phase 2: 食物分析生命周期事件
  ANALYSIS_SUBMITTED: 'food.analysis.submitted',
  ANALYSIS_COMPLETED: 'food.analysis.completed',
  ANALYSIS_FAILED: 'food.analysis.failed',

  // V6.1 Phase 2: 候选食物事件
  CANDIDATE_CREATED: 'food.candidate.created',
  CANDIDATE_PROMOTED: 'food.candidate.promoted',

  // V6.1 Phase 2: 订阅付费墙触发
  PAYWALL_TRIGGERED: 'subscription.paywall.triggered',
} as const;

export type DomainEventName = (typeof DomainEvents)[keyof typeof DomainEvents];

// ─── 事件载荷定义 ───

/**
 * V6 2.19: 多维反馈评分结构
 * 每个维度独立评分 1-5 星，null = 用户未评价该维度
 */
export interface FeedbackRatings {
  /** 口味满意度: 1=非常不满意, 5=非常满意 */
  taste?: number;
  /** 份量满意度: 1=太少, 3=刚好, 5=太多 */
  portion?: number;
  /** 价格满意度: 1=太贵, 3=合理, 5=很划算 */
  price?: number;
  /** 时间适合度: 1=完全不适合当前时段, 5=非常适合 */
  timing?: number;
  /** 用户文字备注 */
  comment?: string;
}

/**
 * V6 2.19: 隐式行为信号
 * 前端上报的用户交互行为
 */
export interface ImplicitSignals {
  /** 用户在推荐卡片上的停留时间（毫秒） */
  dwellTimeMs?: number;
  /** 用户是否点击了详情展开 */
  detailExpanded?: boolean;
}

/**
 * 用户提交推荐反馈时触发
 * 监听方: 权重学习 / 画像更新 / A/B 数据记录 / 实时画像
 */
export class FeedbackSubmittedEvent {
  /** 事件名称（方便日志和调试） */
  readonly eventName = DomainEvents.FEEDBACK_SUBMITTED;
  /** 事件产生时间 */
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 餐次类型 */
    public readonly mealType: string,
    /** 食物名称 */
    public readonly foodName: string,
    /** 食物 ID（可选） */
    public readonly foodId: string | undefined,
    /** 用户操作: accepted / replaced / skipped */
    public readonly action: 'accepted' | 'replaced' | 'skipped',
    /** 替换食物名称（仅 action=replaced 时） */
    public readonly replacementFood?: string,
    /** 推荐时的评分（用于权重学习） */
    public readonly recommendationScore?: number,
    /** 用户目标类型 */
    public readonly goalType?: string,
    /** A/B 实验 ID */
    public readonly experimentId?: string,
    /** A/B 实验分组 */
    public readonly groupId?: string,
    /** V6 2.19: 多维评分（口味/份量/价格/时间） */
    public readonly ratings?: FeedbackRatings,
    /** V6 2.19: 隐式行为信号 */
    public readonly implicitSignals?: ImplicitSignals,
  ) {}
}

/**
 * 用户记录饮食时触发
 * 监听方: 行为画像更新 / 连续性检测 / 成就检查 / 实时画像
 */
export class MealRecordedEvent {
  readonly eventName = DomainEvents.MEAL_RECORDED;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 餐次类型 */
    public readonly mealType: string,
    /** 记录的食物名称列表 */
    public readonly foodNames: string[],
    /** 总热量（千卡） */
    public readonly totalCalories: number,
    /** 记录来源: manual / ai_analysis / quick_add */
    public readonly source: string,
    /** 饮食记录 ID */
    public readonly recordId?: string,
  ) {}
}

/**
 * 用户画像更新时触发
 * 监听方: 缓存失效 / 推荐预计算失效 / 细分重算
 */
export class ProfileUpdatedEvent {
  readonly eventName = DomainEvents.PROFILE_UPDATED;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 画像更新类型: preference_weights / behavior / inferred / declared */
    public readonly updateType:
      | 'preference_weights'
      | 'behavior'
      | 'inferred'
      | 'declared',
    /** 更新来源: feedback / cron / manual / event */
    public readonly source: string,
    /** 变更的字段列表（用于精准缓存失效） */
    public readonly changedFields?: string[],
    /** V6 2.17: 变更前的值（仅变更字段），用于画像变更日志 */
    public readonly beforeValues?: Record<string, unknown>,
    /** V6 2.17: 变更后的值（仅变更字段），用于画像变更日志 */
    public readonly afterValues?: Record<string, unknown>,
    /** V6 2.17: 变更原因描述（人类可读） */
    public readonly reason?: string,
  ) {}
}

/**
 * 推荐结果生成时触发
 * 监听方: 预缓存 / 解释生成 / 用量计数
 */
export class RecommendationGeneratedEvent {
  readonly eventName = DomainEvents.RECOMMENDATION_GENERATED;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 餐次类型 */
    public readonly mealType: string,
    /** 推荐食物数量 */
    public readonly foodCount: number,
    /** 计算耗时（毫秒） */
    public readonly latencyMs: number,
    /** 是否命中预计算 */
    public readonly fromPrecompute: boolean,
    /** 使用的策略版本（Phase 2 使用） */
    public readonly strategyVersion?: string,
  ) {}
}

/**
 * 订阅变更时触发（Phase 2 实现，此处预定义接口）
 * 监听方: 功能门控刷新 / 缓存清除
 */
export class SubscriptionChangedEvent {
  readonly eventName = DomainEvents.SUBSCRIPTION_CHANGED;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 原订阅等级 */
    public readonly previousTier: string,
    /** 新订阅等级 */
    public readonly newTier: string,
    /** 变更原因: purchase / upgrade / downgrade / cancel / expire */
    public readonly reason: string,
  ) {}
}

/**
 * 用户达成目标时触发（Phase 2 实现，此处预定义接口）
 * 监听方: 成就解锁 / 推送通知 / 教练消息
 */
export class GoalAchievedEvent {
  readonly eventName = DomainEvents.GOAL_ACHIEVED;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 达成的目标类型 */
    public readonly goalType: string,
    /** 目标描述 */
    public readonly description: string,
    /** 相关数据（如连续天数、体重变化等） */
    public readonly metadata?: Record<string, unknown>,
  ) {}
}

/**
 * V6.1 Phase 1.8: 分析结果保存为饮食记录时触发
 * 监听方: 画像更新 / 推荐预计算失效 / 数据沉淀
 */
export class AnalysisSavedToRecordEvent {
  readonly eventName = DomainEvents.ANALYSIS_SAVED_TO_RECORD;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 分析记录 ID */
    public readonly analysisId: string,
    /** 饮食记录 ID */
    public readonly foodRecordId: string,
    /** 分析类型: text / image */
    public readonly inputType: 'text' | 'image',
    /** 餐次类型 */
    public readonly mealType: string,
    /** 食物名称列表 */
    public readonly foodNames: string[],
    /** 总热量 */
    public readonly totalCalories: number,
  ) {}
}

// ─── V6.1 Phase 2: 食物分析生命周期事件 ───

/**
 * 食物分析任务提交时触发
 * 监听方: 分析计数 / 日志记录
 */
export class AnalysisSubmittedEvent {
  readonly eventName = DomainEvents.ANALYSIS_SUBMITTED;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 分析请求 ID */
    public readonly requestId: string,
    /** 分析类型: text / image */
    public readonly inputType: 'text' | 'image',
  ) {}
}

/**
 * 食物分析完成时触发
 * 监听方: 短期画像更新 / 推荐偏好注入 / 数据沉淀
 */
export class AnalysisCompletedEvent {
  readonly eventName = DomainEvents.ANALYSIS_COMPLETED;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 分析记录 ID */
    public readonly analysisId: string,
    /** 分析类型: text / image */
    public readonly inputType: 'text' | 'image',
    /** 识别到的食物名称列表 */
    public readonly foodNames: string[],
    /** 识别到的食物分类列表 */
    public readonly foodCategories: string[],
    /** 总热量 */
    public readonly totalCalories: number,
    /** 决策: recommend / caution / avoid */
    public readonly recommendation: string,
    /** 平均置信度（0-1） */
    public readonly avgConfidence: number,
  ) {}
}

/**
 * 食物分析失败时触发
 * 监听方: 错误统计 / 告警
 */
export class AnalysisFailedEvent {
  readonly eventName = DomainEvents.ANALYSIS_FAILED;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 分析请求 ID */
    public readonly requestId: string,
    /** 分析类型: text / image */
    public readonly inputType: 'text' | 'image',
    /** 失败原因 */
    public readonly errorMessage: string,
  ) {}
}

/**
 * 候选食物创建时触发
 * 监听方: 数据治理统计
 */
export class CandidateCreatedEvent {
  readonly eventName = DomainEvents.CANDIDATE_CREATED;
  readonly timestamp = new Date();

  constructor(
    /** 候选食物 ID */
    public readonly candidateId: string,
    /** 食物名称 */
    public readonly foodName: string,
    /** 来源分析 ID */
    public readonly sourceAnalysisId: string,
    /** 初始置信度 */
    public readonly confidenceScore: number,
  ) {}
}

/**
 * 候选食物提升为正式食物时触发
 * 监听方: 食物库同步 / 数据治理统计
 */
export class CandidatePromotedEvent {
  readonly eventName = DomainEvents.CANDIDATE_PROMOTED;
  readonly timestamp = new Date();

  constructor(
    /** 候选食物 ID */
    public readonly candidateId: string,
    /** 食物名称 */
    public readonly foodName: string,
    /** 关联的标准食物 ID */
    public readonly promotedFoodId: string,
  ) {}
}

/**
 * 订阅付费墙触发时发出
 * 监听方: 转化漏斗分析 / 运营统计
 */
export class PaywallTriggeredEvent {
  readonly eventName = DomainEvents.PAYWALL_TRIGGERED;
  readonly timestamp = new Date();

  constructor(
    /** 用户 ID */
    public readonly userId: string,
    /** 当前订阅等级 */
    public readonly currentTier: string,
    /** 推荐升级等级 */
    public readonly recommendedTier: string,
    /** 触发场景 */
    public readonly triggerScene: string,
    /** 触发功能 */
    public readonly feature: string,
  ) {}
}
