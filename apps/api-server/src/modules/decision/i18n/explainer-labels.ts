/**
 * V4.0 P3.5 — 决策链路标签 i18n
 *
 * 从 decision-explainer.service.ts 提取的 CHAIN_LABELS，
 * 用于决策推理链步骤的多语言展示。
 */

import { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

export const CHAIN_LABELS: Record<string, Record<string, string>> = {
  'zh-CN': {
    'step.aggregation': '营养数据聚合',
    'step.aggregation.input': '解析 {count} 种食物的营养成分',
    'step.aggregation.output':
      '总计 {cal}kcal / 蛋白{pro}g / 脂肪{fat}g / 碳水{carbs}g',
    'step.context': '用户上下文构建',
    'step.context.input': '加载用户目标、健康状况、今日进度',
    'step.context.output': '目标 {goal}，剩余 {remaining}kcal，{conditions}',
    'step.scoring': '营养评分计算',
    'step.scoring.input': '基于7维评分引擎计算',
    'step.scoring.output.high': '评分 {score}，整体优秀',
    'step.scoring.output.mid': '评分 {score}，中等水平',
    'step.scoring.output.low': '评分 {score}，需要改善',
    'step.allergen': '过敏原检查',
    'step.allergen.input': '检查食物是否含有用户过敏原',
    'step.allergen.triggered': '检测到过敏原: {allergens}，强制标记为避免',
    'step.allergen.clear': '未检测到过敏原',
    'step.health': '健康状况检查',
    'step.health.input': '检查食物是否与用户健康状况冲突',
    'step.health.triggered': '与健康状况冲突: {conditions}',
    'step.health.clear': '无健康状况冲突',
    'step.timing': '用餐时间检查',
    'step.timing.input': '当前时间 {hour}:00',
    'step.timing.lateNight': '深夜用餐，建议控制摄入',
    'step.timing.normal': '用餐时间正常',
    'step.budget': '热量预算检查',
    'step.budget.input': '剩余预算 {remaining} kcal，本餐 {meal} kcal',
    'step.budget.over': '超出每日热量预算',
    'step.budget.ok': '在热量预算范围内',
    'step.final': '最终决策',
    'step.final.input': '综合所有因素',
    'step.final.recommend': '建议食用',
    'step.final.caution': '谨慎食用',
    'step.final.avoid': '不建议食用',
    'step.coach': 'AI教练输出',
    'step.coach.input': '基于决策结果生成行动建议',
    'step.coach.output': '教练判定: {verdict}，生成 {count} 条行动建议',
  },
  'en-US': {
    'step.aggregation': 'Nutrition Aggregation',
    'step.aggregation.input': 'Parsing nutrition data from {count} food items',
    'step.aggregation.output':
      'Total {cal}kcal / Protein {pro}g / Fat {fat}g / Carbs {carbs}g',
    'step.context': 'User Context Build',
    'step.context.input':
      "Loading user goals, health conditions, today's progress",
    'step.context.output':
      'Goal: {goal}, Remaining: {remaining}kcal, {conditions}',
    'step.scoring': 'Nutrition Scoring',
    'step.scoring.input': 'Calculated via 7-dimension scoring engine',
    'step.scoring.output.high': 'Score {score}, excellent overall',
    'step.scoring.output.mid': 'Score {score}, moderate level',
    'step.scoring.output.low': 'Score {score}, needs improvement',
    'step.allergen': 'Allergen Check',
    'step.allergen.input': 'Checking for user allergens in food',
    'step.allergen.triggered':
      'Allergens detected: {allergens}, marked as avoid',
    'step.allergen.clear': 'No allergens detected',
    'step.health': 'Health Condition Check',
    'step.health.input': 'Checking food against user health conditions',
    'step.health.triggered': 'Conflicts with health conditions: {conditions}',
    'step.health.clear': 'No health condition conflicts',
    'step.timing': 'Meal Timing Check',
    'step.timing.input': 'Current time {hour}:00',
    'step.timing.lateNight': 'Late night meal, suggest controlling intake',
    'step.timing.normal': 'Normal meal time',
    'step.budget': 'Calorie Budget Check',
    'step.budget.input':
      'Remaining budget {remaining} kcal, this meal {meal} kcal',
    'step.budget.over': 'Exceeds daily calorie budget',
    'step.budget.ok': 'Within calorie budget',
    'step.final': 'Final Decision',
    'step.final.input': 'Combining all factors',
    'step.final.recommend': 'Recommended to eat',
    'step.final.caution': 'Eat with caution',
    'step.final.avoid': 'Not recommended',
    'step.coach': 'AI Coach Output',
    'step.coach.input': 'Generating action recommendations based on decision',
    'step.coach.output':
      'Coach verdict: {verdict}, generated {count} action items',
  },
  'ja-JP': {
    'step.aggregation': '栄養データ集約',
    'step.aggregation.input': '{count}種類の食品の栄養成分を解析',
    'step.aggregation.output':
      '合計 {cal}kcal / タンパク質{pro}g / 脂質{fat}g / 炭水化物{carbs}g',
    'step.context': 'ユーザーコンテキスト構築',
    'step.context.input': 'ユーザーの目標、健康状態、今日の進捗を読み込み',
    'step.context.output': '目標: {goal}、残り {remaining}kcal、{conditions}',
    'step.scoring': '栄養スコア計算',
    'step.scoring.input': '7次元スコアリングエンジンで計算',
    'step.scoring.output.high': 'スコア {score}、全体的に優秀',
    'step.scoring.output.mid': 'スコア {score}、中程度',
    'step.scoring.output.low': 'スコア {score}、改善が必要',
    'step.allergen': 'アレルゲンチェック',
    'step.allergen.input': '食品にユーザーのアレルゲンが含まれているか確認',
    'step.allergen.triggered': 'アレルゲン検出: {allergens}、回避として設定',
    'step.allergen.clear': 'アレルゲンは検出されませんでした',
    'step.health': '健康状態チェック',
    'step.health.input': '食品がユーザーの健康状態と矛盾しないか確認',
    'step.health.triggered': '健康状態と矛盾: {conditions}',
    'step.health.clear': '健康状態との矛盾なし',
    'step.timing': '食事時間チェック',
    'step.timing.input': '現在時刻 {hour}:00',
    'step.timing.lateNight': '深夜の食事、摂取量の制御を推奨',
    'step.timing.normal': '通常の食事時間',
    'step.budget': 'カロリー予算チェック',
    'step.budget.input': '残り予算 {remaining} kcal、この食事 {meal} kcal',
    'step.budget.over': '1日のカロリー予算を超過',
    'step.budget.ok': 'カロリー予算内',
    'step.final': '最終判定',
    'step.final.input': '全ての要素を総合',
    'step.final.recommend': '食べることを推奨',
    'step.final.caution': '注意して食べる',
    'step.final.avoid': '食べることを推奨しない',
    'step.coach': 'AIコーチ出力',
    'step.coach.input': '判定結果に基づいてアクション提案を生成',
    'step.coach.output':
      'コーチ判定: {verdict}、{count}件のアクション提案を生成',
  },
};

/**
 * 查询链路标签，支持变量替换
 */
export function chainLabel(
  key: string,
  vars?: Record<string, string>,
  locale?: Locale,
): string {
  const loc = locale || 'zh-CN';
  const labels = CHAIN_LABELS[loc] || CHAIN_LABELS['zh-CN'];
  let text = labels[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      text = text.replace(`{${k}}`, v);
    }
  }
  return text;
}
