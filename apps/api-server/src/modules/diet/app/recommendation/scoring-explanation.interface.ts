/**
 * V4 Phase 2.3 — 评分解释结构化 (D8)
 *
 * 每个评分维度记录 raw 分数和 weighted 分数，
 * 加上各阶段的调整因子，实现推荐可解释性。
 *
 * 设计原则：
 * - 仅对 Top-K 食物（Rerank 后）生成，避免性能开销
 * - Optional 字段，不影响已有评分逻辑
 * - 支持后续持久化到 ai_decision_logs
 */

/** 单个评分维度的分解 */
export interface DimensionScore {
  /** 原始分 (0-1) */
  raw: number;
  /** 加权后分 (raw × weight) */
  weighted: number;
}

/** 完整评分解释 */
export interface ScoringExplanation {
  /** 10 维营养评分分解 (V5 2.6: 新增 fiber) */
  dimensions: {
    calories: DimensionScore;
    protein: DimensionScore;
    carbs: DimensionScore;
    fat: DimensionScore;
    quality: DimensionScore;
    satiety: DimensionScore;
    glycemic: DimensionScore;
    nutrientDensity: DimensionScore;
    inflammation: DimensionScore;
    fiber: DimensionScore; // V5 2.6: 膳食纤维评分
  };

  /** NOVA 加工惩罚乘数 (0.55-1.0) */
  novaPenalty: number;

  /** 健康修正引擎结果 (V5 2.8: 由 penaltyResult 保留字段名，类型不变) */
  penaltyResult: {
    multiplier: number;
    reasons: string[];
    vetoed: boolean;
  };

  /** 数据置信度因子 (0.7 + 0.3 × confidence) */
  confidenceFactor: number;

  /** 用户偏好加权乘数（loves/avoids） */
  preferenceBoost: number;

  /** 偏好画像四维加权乘数 */
  profileBoost: number;

  /** 地区感知偏移乘数 */
  regionalBoost: number;

  /** 探索策略乘数（Thompson Sampling） */
  explorationMultiplier: number;

  /** 相似度去重惩罚 */
  similarityPenalty: number;

  /** 食物搭配关系加分 (E5: goodWith/badWith) */
  compatibilityBonus: number;

  /** V4 Phase 4.4: 协同过滤加成 (0~0.15) */
  cfBoost: number;

  /** V6 1.9: 短期画像偏好乘数（基于近 7 天行为） */
  shortTermBoost: number;

  /** V6 2.18: 上下文场景加权乘数（工作日/周末/深夜等场景修正） */
  sceneBoost: number;

  /** V6.1 Phase 3.5: 分析画像加权乘数（近期分析分类兴趣加成 + 风险食物惩罚） */
  analysisBoost: number;

  /** 最终分数 */
  finalScore: number;
}

// ==================== V6 2.7 ExplainV2 — 可视化解释数据结构 ====================

/**
 * 雷达图单维度数据 — 对应食物评分的 10 维评分可视化
 */
export interface RadarChartDimension {
  /** 维度名（如 'calories', 'protein' 等） */
  name: string;
  /** 维度中文标签（如 '热量匹配', '蛋白质'） */
  label: string;
  /** 该维度原始分 (0-1) */
  score: number;
  /** 该维度权重 (0-1) */
  weight: number;
  /** 该维度基准线分数（同目标用户平均值，0-1；暂用 0.5 作为默认基准） */
  benchmark: number;
}

/**
 * 雷达图数据 — 10 维评分可视化
 */
export interface RadarChartData {
  dimensions: RadarChartDimension[];
}

/**
 * 营养素进度条状态
 */
export type NutrientStatus = 'under' | 'optimal' | 'over';

/**
 * 营养素进度条数据 — 当前摄入 vs 目标
 */
export interface ProgressBarData {
  /** 营养素名称（如 '热量', '蛋白质', '碳水', '脂肪', '膳食纤维'） */
  nutrient: string;
  /** 当前这道食物的该营养素供给量 */
  current: number;
  /** 该餐次目标值 */
  target: number;
  /** 单位（如 'kcal', 'g'） */
  unit: string;
  /** 完成百分比 (0-100+) */
  percent: number;
  /** 状态标记 */
  status: NutrientStatus;
}

/**
 * 趋势数据点 — 用于 7 日趋势线
 */
export interface TrendPoint {
  /** 日期标签（如 'Day 1', 'Day 2'...） */
  label: string;
  /** 该维度的归一化分值 (0-1) */
  value: number;
}

/**
 * 对比卡片数据 — 与基准的对比
 */
export interface ComparisonData {
  /** 与同目标用户平均的差异（正数=优于平均，-1~1） */
  vsUserAvg: number;
  /** 与健康标准的匹配度（0-1） */
  vsHealthyTarget: number;
  /** 7 日综合评分趋势（暂为空数组，由画像系统填充） */
  trend7d: TrendPoint[];
}

/**
 * V6 2.7: ExplainV2 完整可视化解释结构
 *
 * 在现有 UserFacingExplanation 基础上增加结构化可视化数据，
 * 前端可直接渲染雷达图、进度条、对比卡片。
 *
 * 向后兼容: 包含原有 V1 所有字段（summary/primaryReason/healthTip/scoreBreakdown/nutritionHighlights）
 */
export interface ExplanationV2 {
  // ─── V1 原有字段（向后兼容） ───

  /** 一句话解释摘要（即 primaryReason） */
  summary: string;
  /** 推荐主因 */
  primaryReason: string;
  /** 健康提示（可选） */
  healthTip?: string;

  // ─── V2 新增可视化字段 ───

  /** 雷达图数据 — 10 维评分可视化 */
  radarChart: RadarChartData;
  /** 营养素进度条 — 食物营养 vs 餐次目标 */
  progressBars: ProgressBarData[];
  /** 对比卡片 — 与平均/健康标准的对比 */
  comparisonCard: ComparisonData;

  // ─── V2 预留字段（2.8/2.9 实现） ───

  /** 反向解释（"为什么没推荐 X？"）— 2.8 实现 */
  whyNotExplanation?: string;
  /** 付费预览提示（"升级查看完整分析"）— 2.9 实现 */
  upgradeTeaser?: string;
  /** 语言标识（默认 'zh-CN'）— 2.10/2.11 实现 */
  locale: string;
}
