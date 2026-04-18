/**
 * 食物分析相关共享常量
 *
 * 避免在多个组件中重复定义 MEAL_LABELS、DECISION_CONFIG、
 * GOAL_LABELS、SCORE_LABELS 以及评分工具函数。
 */

// ── 餐次标签 ──
export const MEAL_LABELS: Record<string, string> = {
  breakfast: '早餐',
  lunch: '午餐',
  dinner: '晚餐',
  snack: '加餐',
};

// ── 决策配置（完整版：用于分析结果、详情页等） ──
export const DECISION_CONFIG: Record<
  string,
  {
    emoji: string;
    label: string;
    bgClass: string;
    textClass: string;
    badgeClass: string;
    barClass: string;
  }
> = {
  SAFE: {
    emoji: '🟢',
    label: '放心吃',
    bgClass: 'bg-green-50 border-green-200',
    textClass: 'text-green-800',
    badgeClass: 'bg-green-100 text-green-800',
    barClass: 'bg-green-500',
  },
  OK: {
    emoji: '🟡',
    label: '注意份量',
    bgClass: 'bg-yellow-50 border-yellow-200',
    textClass: 'text-yellow-800',
    badgeClass: 'bg-yellow-100 text-yellow-800',
    barClass: 'bg-yellow-500',
  },
  LIMIT: {
    emoji: '🟠',
    label: '建议少吃',
    bgClass: 'bg-orange-50 border-orange-200',
    textClass: 'text-orange-800',
    badgeClass: 'bg-orange-100 text-orange-800',
    barClass: 'bg-orange-500',
  },
  AVOID: {
    emoji: '🔴',
    label: '不建议',
    bgClass: 'bg-red-50 border-red-200',
    textClass: 'text-red-800',
    badgeClass: 'bg-red-100 text-red-800',
    barClass: 'bg-red-500',
  },
};

// ── 决策配置（精简版：用于卡片列表等空间受限场景） ──
export const DECISION_CONFIG_COMPACT: Record<string, { label: string; bg: string; text: string }> =
  {
    SAFE: { label: '健康', bg: 'bg-green-100', text: 'text-green-800' },
    OK: { label: '注意', bg: 'bg-yellow-100', text: 'text-yellow-800' },
    LIMIT: { label: '少吃', bg: 'bg-orange-100', text: 'text-orange-800' },
    AVOID: { label: '不建议', bg: 'bg-red-100', text: 'text-red-800' },
  };

// ── 目标标签 ──
export const GOAL_LABELS: Record<string, string> = {
  fat_loss: '减脂',
  muscle_gain: '增肌',
  health: '健康维持',
  habit: '改善习惯',
};

// ── 目标标签（带 emoji，用于个人资料展示等） ──
export const GOAL_LABELS_EMOJI: Record<string, string> = {
  fat_loss: '🔥 减脂',
  muscle_gain: '💪 增肌',
  health: '🧘 保持健康',
  habit: '🌱 改善习惯',
};

// ── 评分维度标签 ──
export const SCORE_LABELS: Record<string, string> = {
  energy: '能量',
  proteinRatio: '蛋白质比',
  macroBalance: '宏量素平衡',
  foodQuality: '食物品质',
  satiety: '饱腹感',
  stability: '稳定性',
  glycemicImpact: '血糖影响',
  mealQuality: '进餐质量',
};

// ── 评分工具函数 ──

/** 分数 → Tailwind 背景色 class */
export function getScoreColor(score: number): string {
  if (score >= 80) return 'bg-green-500';
  if (score >= 60) return 'bg-yellow-500';
  if (score >= 40) return 'bg-orange-500';
  return 'bg-red-500';
}

/** 分数 → 中文等级标签 */
export function getScoreLabel(score: number): string {
  if (score >= 90) return '优秀';
  if (score >= 75) return '良好';
  if (score >= 60) return '一般';
  if (score >= 40) return '较差';
  return '不达标';
}
