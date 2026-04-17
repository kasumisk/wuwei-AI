/**
 * V1.9: CoachPromptBuilder — 从 CoachService 提取的 prompt 构建逻辑
 *
 * 职责：
 * 1. buildSystemPrompt(): 构建系统 prompt（用户档案 + 饮食数据 + 行为洞察 + 人格语气）
 * 2. formatAnalysisContext(): 将分析上下文格式化为 prompt 片段
 *
 * 不涉及：会话管理、消息持久化、AI 调用 — 这些留在 CoachService
 */

import { Injectable, Logger } from '@nestjs/common';
import { estimateTokenCount, truncateToTokenBudget } from './prompt-token.util';
import { FoodService } from '../../../diet/app/services/food.service';
import { UserProfileService } from '../../../user/app/services/profile/user-profile.service';
import { BehaviorService } from '../../../diet/app/services/behavior.service';
import {
  getUserLocalHour,
  DEFAULT_TIMEZONE,
} from '../../../../common/utils/timezone.util';
import {
  t,
  Locale,
} from '../../../diet/app/recommendation/utils/i18n-messages';
import { COACH_LABELS, cl } from '../../../decision/i18n/decision-labels';
import {
  buildTonePrompt,
  getConfidenceModifier,
} from '../config/coach-tone.config';
import {
  CoachActionPlan,
  ConfidenceDiagnostics,
  BreakdownExplanation,
  DecisionChainStep,
  DecisionSummary,
  EvidencePack,
  ShouldEatAction,
} from '../../../decision/types/analysis-result.types';
import { CoachActionPlanService } from '../coaching/coach-action-plan.service';

// ==================== 分析上下文类型 ====================

export interface AnalysisContextInput {
  foods?: Array<{
    name: string;
    calories: number;
    protein?: number;
    fat?: number;
    carbs?: number;
  }>;
  totalCalories?: number;
  totalProtein?: number;
  totalFat?: number;
  totalCarbs?: number;
  decision?: string;
  riskLevel?: string;
  nutritionScore?: number;
  advice?: string;
  mealType?: string;
  breakdown?: Record<string, number>;
  decisionFactors?: Array<{
    dimension: string;
    score: number;
    impact: string;
    message: string;
  }>;
  optimalPortion?: {
    recommendedPercent: number;
    recommendedCalories: number;
  };
  nextMealAdvice?: {
    targetCalories: number;
    targetProtein: number;
    emphasis: string;
    suggestion: string;
  };
  breakdownExplanations?: BreakdownExplanation[];
  decisionChain?: DecisionChainStep[];
  issues?: Array<{
    category: string;
    severity: 'info' | 'warning' | 'critical';
    message: string;
    actionable?: string;
    data?: Record<string, number | string>;
  }>;
  macroProgress?: {
    calories: { consumed: number; target: number; percent: number };
    protein: { consumed: number; target: number; percent: number };
    fat: { consumed: number; target: number; percent: number };
    carbs: { consumed: number; target: number; percent: number };
  };
  /** V2.2: 决策结构化摘要 */
  summary?: DecisionSummary;
  /** V2.3: Should Eat 行动对象 */
  shouldEatAction?: ShouldEatAction;
  /** V2.3: 统一证据块 */
  evidencePack?: EvidencePack;
  /** V2.3: 分层置信度诊断 */
  confidenceDiagnostics?: ConfidenceDiagnostics;
  /** V2.3: 教练行动计划 */
  coachActionPlan?: CoachActionPlan;
}

@Injectable()
export class CoachPromptBuilderService {
  private readonly logger = new Logger(CoachPromptBuilderService.name);

  constructor(
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
    private readonly behaviorService: BehaviorService,
    private readonly coachActionPlanService: CoachActionPlanService,
  ) {}

  /**
   * 构建完整系统 Prompt（用户档案 + 饮食数据 + 行为洞察 + 人格语气）
   */
  async buildSystemPrompt(userId: string, locale?: Locale): Promise<string> {
    const [
      profile,
      todaySummary,
      recentSummaries,
      behaviorProfile,
      behaviorContext,
    ] = await Promise.all([
      this.userProfileService.getProfile(userId),
      this.foodService.getTodaySummary(userId),
      this.foodService.getRecentSummaries(userId, 7),
      this.behaviorService.getProfile(userId).catch(() => null),
      this.behaviorService.getBehaviorContext(userId).catch(() => ''),
    ]);

    const hour = getUserLocalHour(profile?.timezone || DEFAULT_TIMEZONE);
    const timeHint =
      hour < 10
        ? t('coach.time.morning', {}, locale)
        : hour < 14
          ? t('coach.time.lunch', {}, locale)
          : hour < 18
            ? t('coach.time.afternoon', {}, locale)
            : hour < 21
              ? t('coach.time.dinner', {}, locale)
              : t('coach.time.night', {}, locale);

    const bmi =
      profile && profile.heightCm && profile.weightKg
        ? (
            Number(profile.weightKg) /
            (Number(profile.heightCm) / 100) ** 2
          ).toFixed(1)
        : null;

    const avgCalories =
      recentSummaries.length > 0
        ? Math.round(
            recentSummaries.reduce((s, d) => s + d.totalCalories, 0) /
              recentSummaries.length,
          )
        : 0;

    const onTargetDays =
      recentSummaries.length > 0
        ? recentSummaries.filter(
            (d) => d.totalCalories <= (todaySummary.calorieGoal || 2000),
          ).length
        : 0;

    const isEn = locale === 'en-US';
    const isJa = locale === 'ja-JP';

    const replyLang = isEn
      ? 'Reply in English'
      : isJa
        ? '日本語で回答してください'
        : '用中文回复';

    const structuredFormat = isEn
      ? `When the user asks whether they can eat something or how to pair meals, answer in this structure:
1. Conclusion (one sentence verdict)
2. Reason (why, 1-2 sentences)
3. Suggested action (what to do specifically)
4. Alternatives (if better options exist, list 1-2)`
      : isJa
        ? `ユーザーが食べ物について質問した場合、以下の構造で回答：
1. 結論（一文で判定）
2. 理由（なぜそう判定したか、1-2文）
3. 推奨行動（具体的に何をすべきか）
4. 代替案（より良い選択があれば1-2個）`
        : `当用户询问某食物能不能吃、某餐怎么搭配时，请按以下结构回答：
1. 结论（一句话判定）
2. 原因（为什么这么判定，1-2句）
3. 建议行动（具体该怎么做）
4. 替代选择（如果有更好的选择，列出1-2个）`;

    // V1.9 Phase 3.3: Few-shot examples for structured output
    const fewShotExample = isEn
      ? `Example:
User: "Can I have fried chicken for dinner?"
Coach: "Not ideal tonight — you've already hit 85% of your calorie target. Fried chicken adds ~450kcal with high fat. I'd suggest grilled chicken breast (~200kcal, 30g protein) instead. If you really want it, go for 2 pieces max and skip the skin."`
      : isJa
        ? `例：
ユーザー：「夜にフライドチキン食べていい？」
コーチ：「今夜はちょっと厳しいかな。カロリー目標の85%に達しています。フライドチキンは約450kcal・高脂質。代わりにグリルチキン（約200kcal・タンパク質30g）がおすすめ。どうしても食べたいなら2ピースまで、皮は外して。」`
        : `示例：
用户："晚饭能吃炸鸡吗？"
教练："今晚不太合适——你已经吃了目标热量的85%。炸鸡大约450kcal，脂肪偏高。建议换成烤鸡胸（约200kcal，蛋白质30g）。如果实在想吃，最多2块，去皮。"`;

    const roleIntro = isEn
      ? `You are the AI nutrition coach for Wuwei Health. Your tone is warm, professional, and concise.
${replyLang}, keep each message under 150 words, do not use Markdown formatting.`
      : isJa
        ? `あなたは無畏健康のAI栄養コーチです。親しみやすく、専門的で、簡潔なスタイルです。
${replyLang}、各メッセージは150文字以内、Markdown形式は使わないでください。`
        : `你是无畏健康的 AI 营养教练，风格亲切、专业、简洁。
${replyLang}，每条消息不超过 150 字，不要使用 Markdown 格式。`;

    const profileLabel = isEn
      ? 'User Profile'
      : isJa
        ? 'ユーザープロフィール'
        : '用户档案';
    const todayLabel = isEn ? "Today's Diet" : isJa ? '今日の食事' : '今日饮食';
    const recentLabel = isEn
      ? 'Recent 7 Days'
      : isJa
        ? '最近7日間'
        : '最近 7 天平均';
    const timeLabel = isEn ? 'Time Info' : isJa ? '時間情報' : '时间信息';
    const closingInstruction = isEn
      ? 'Based on the above info, give personalized, warm dietary advice. If the user asks about food calories, give an estimate directly — do not say "consult a doctor".'
      : isJa
        ? '上記の情報に基づき、パーソナライズされた温かい食事アドバイスをしてください。カロリーを聞かれたら直接推定値を答え、「医師に相談」とは言わないでください。'
        : '根据以上信息，给出个性化、有温度的饮食建议。如果用户问某食物热量，直接给出估算值，不要说"建议咨询医生"。';

    // V1.5: 主动检查提醒
    let proactiveHint = '';
    try {
      const proactiveReminder =
        await this.behaviorService.proactiveCheck(userId);
      if (proactiveReminder) {
        const urgencyMap: Record<string, string> = isEn
          ? { high: 'URGENT', medium: 'NOTE', low: 'FYI' }
          : isJa
            ? { high: '緊急', medium: '注意', low: '参考' }
            : { high: '紧急', medium: '注意', low: '参考' };
        const urgencyLabel =
          urgencyMap[proactiveReminder.urgency] || urgencyMap['low'];
        const reminderTitle = isEn
          ? 'Proactive Reminder'
          : isJa
            ? 'プロアクティブ通知'
            : '主动提醒';
        proactiveHint = `\n【${reminderTitle}】[${urgencyLabel}] ${proactiveReminder.message}\n`;
      }
    } catch {
      /* 忽略 */
    }

    const genderStr = isEn
      ? profile?.gender === 'male'
        ? 'Male'
        : 'Female'
      : isJa
        ? profile?.gender === 'male'
          ? '男性'
          : '女性'
        : profile?.gender === 'male'
          ? '男'
          : '女';

    // V1.9: 使用 Goal×Tone 矩阵构建语气 prompt
    const coachStyle = behaviorProfile?.coachStyle || 'friendly';
    const goalType = (profile?.goal as string) || 'health';
    const tonePrompt = buildTonePrompt(coachStyle, goalType, locale);

    const basePrompt = `${roleIntro}

【${isEn ? 'Reply Format' : isJa ? '回答形式' : 'P3-1 回复格式指令'}】
${structuredFormat}
${isEn ? 'For non-diet questions, reply freely.' : isJa ? '食事以外の質問には自由に回答してOK。' : '非饮食问题可自由回复。'}

${fewShotExample}

【${profileLabel}】
${
  profile
    ? `- ${isEn ? 'Gender' : isJa ? '性別' : '性别'}：${genderStr}
- ${isEn ? 'Age' : isJa ? '年齢' : '年龄'}：${new Date().getFullYear() - (profile.birthYear || 1990)} ${isEn ? 'years' : isJa ? '歳' : '岁'}
- BMI：${bmi}（${isEn ? 'Height' : isJa ? '身長' : '身高'} ${profile.heightCm}cm，${isEn ? 'Weight' : isJa ? '体重' : '体重'} ${profile.weightKg}kg）
- ${isEn ? 'Activity Level' : isJa ? '活動レベル' : '活动等级'}：${profile.activityLevel}
- ${isEn ? 'Daily Calorie Target' : isJa ? '1日カロリー目標' : '每日热量目标'}：${todaySummary.calorieGoal || 2000} kcal`
    : isEn
      ? 'User has not filled in health profile yet. Guide them to fill it in for more accurate advice.'
      : isJa
        ? 'ユーザーはまだ健康プロフィールを入力していません。入力を促しましょう。'
        : '用户尚未填写健康档案，可引导他去填写以获得更精准建议。'
}

【${todayLabel}】
- ${isEn ? 'Consumed' : isJa ? '摂取済み' : '已摄入'}：${todaySummary.totalCalories} kcal / ${isEn ? 'Target' : isJa ? '目標' : '目标'} ${todaySummary.calorieGoal || 2000} kcal
- ${isEn ? 'Remaining' : isJa ? '残り' : '剩余'}：${todaySummary.remaining} kcal
- ${isEn ? 'Meals logged' : isJa ? '記録した食事数' : '今日记录餐数'}：${todaySummary.mealCount} ${isEn ? 'meals' : isJa ? '食' : '餐'}
- ${isEn ? 'Protein' : isJa ? 'タンパク質' : '蛋白质'}：${todaySummary.totalProtein || 0}g / ${isEn ? 'Target' : isJa ? '目標' : '目标'} ${todaySummary.proteinGoal || 65}g (${todaySummary.proteinGoal ? Math.round(((todaySummary.totalProtein || 0) / todaySummary.proteinGoal) * 100) : 0}%)
- ${isEn ? 'Fat' : isJa ? '脂質' : '脂肪'}：${todaySummary.totalFat || 0}g / ${isEn ? 'Target' : isJa ? '目標' : '目标'} ${todaySummary.fatGoal || 65}g (${todaySummary.fatGoal ? Math.round(((todaySummary.totalFat || 0) / todaySummary.fatGoal) * 100) : 0}%)
- ${isEn ? 'Carbs' : isJa ? '炭水化物' : '碳水'}：${todaySummary.totalCarbs || 0}g / ${isEn ? 'Target' : isJa ? '目標' : '目标'} ${todaySummary.carbsGoal || 275}g (${todaySummary.carbsGoal ? Math.round(((todaySummary.totalCarbs || 0) / todaySummary.carbsGoal) * 100) : 0}%)

【${recentLabel}】
- ${isEn ? 'Daily avg' : isJa ? '日平均' : '日均摄入'}：${avgCalories} kcal
- ${isEn ? 'On-target days' : isJa ? '達成日数' : '达标天数'}：${onTargetDays} / ${recentSummaries.length} ${isEn ? 'days' : isJa ? '日' : '天'}

【${timeLabel}】${timeHint}

${this.buildConditionalSections(profile, behaviorProfile, isEn, isJa, locale)}
${closingInstruction}

${this.buildCapabilitiesSection(isEn, isJa)}
${proactiveHint}
${behaviorContext ? `${behaviorContext}\n` : ''}${tonePrompt}`;

    // V2.0 Phase 3.2: token 安全 — 估算并截断，防止超出模型上下文窗口
    const MAX_SYSTEM_PROMPT_TOKENS = 2800;
    const tokenCount = estimateTokenCount(basePrompt);
    if (tokenCount > MAX_SYSTEM_PROMPT_TOKENS) {
      this.logger.warn(
        `System prompt exceeds token budget: ~${tokenCount} tokens (limit ${MAX_SYSTEM_PROMPT_TOKENS}). Truncating...`,
      );
      return truncateToTokenBudget(basePrompt, MAX_SYSTEM_PROMPT_TOKENS);
    }

    return basePrompt;
  }

  /**
   * 格式化分析上下文为 prompt 片段
   */
  formatAnalysisContext(
    analysisContext: AnalysisContextInput,
    locale?: Locale,
  ): string {
    if (!analysisContext.foods || analysisContext.foods.length === 0) {
      return '';
    }

    if (!analysisContext.coachActionPlan && analysisContext.shouldEatAction) {
      analysisContext.coachActionPlan = this.coachActionPlanService.build({
        shouldEatAction: analysisContext.shouldEatAction,
        summary: analysisContext.summary,
        evidencePack: analysisContext.evidencePack,
        confidenceDiagnostics: analysisContext.confidenceDiagnostics,
        breakdownExplanations: analysisContext.breakdownExplanations,
        nextMealAdvice: analysisContext.nextMealAdvice,
      });
    }

    if (analysisContext.coachActionPlan) {
      return this.formatCoachActionContext(analysisContext, locale);
    }

    // V2.2: 如果有结构化摘要，优先使用精简上下文
    if (analysisContext.summary) {
      return this.formatSummaryContext(analysisContext, locale);
    }

    let ctx = '';

    const foodList = analysisContext.foods
      .map((f) => {
        const macros = [
          f.protein != null ? `P${f.protein}g` : '',
          f.fat != null ? `F${f.fat}g` : '',
          f.carbs != null ? `C${f.carbs}g` : '',
        ]
          .filter(Boolean)
          .join('/');
        return macros
          ? `${f.name}(${f.calories}kcal, ${macros})`
          : `${f.name}(${f.calories}kcal)`;
      })
      .join('、');

    const macroSummary = [
      analysisContext.totalProtein != null
        ? `${cl('protein', locale)}${analysisContext.totalProtein}g`
        : '',
      analysisContext.totalFat != null
        ? `${cl('fat', locale)}${analysisContext.totalFat}g`
        : '',
      analysisContext.totalCarbs != null
        ? `${cl('carbs', locale)}${analysisContext.totalCarbs}g`
        : '',
    ]
      .filter(Boolean)
      .join('、');

    ctx += `\n\n【${cl('analyzedFood', locale)}】
- ${cl('food', locale)}: ${foodList}
- ${cl('totalCalories', locale)}: ${analysisContext.totalCalories || 0} kcal${macroSummary ? `\n- ${cl('macros', locale)}: ${macroSummary}` : ''}
- ${cl('aiDecision', locale)}: ${analysisContext.decision || cl('unknown', locale)}
- ${cl('riskLevel', locale)}: ${analysisContext.riskLevel || cl('unknown', locale)}
- ${cl('nutritionScore', locale)}: ${analysisContext.nutritionScore || cl('unknown', locale)}/100
- ${cl('aiAdvice', locale)}: ${analysisContext.advice || cl('none', locale)}
- ${cl('mealType', locale)}: ${analysisContext.mealType || cl('unknown', locale)}`;

    // V1.3: 7维评分分解
    if (analysisContext.breakdown) {
      const dims = Object.entries(analysisContext.breakdown)
        .map(([k, v]) => `${k}: ${v}${cl('points', locale)}`)
        .join('、');
      ctx += `\n- ${cl('breakdown7d', locale)}: ${dims}`;
    }

    // V1.3: 决策因子
    if (
      analysisContext.decisionFactors &&
      analysisContext.decisionFactors.length > 0
    ) {
      const factors = analysisContext.decisionFactors
        .map(
          (f) =>
            `[${f.impact}] ${f.dimension}(${f.score}${cl('points', locale)}): ${f.message}`,
        )
        .join('；');
      ctx += `\n- ${cl('decisionFactors', locale)}: ${factors}`;
    }

    // V1.3: 最优份量建议
    if (analysisContext.optimalPortion) {
      const portionText = cl('portionTemplate', locale)
        .replace(
          '{{percent}}',
          String(analysisContext.optimalPortion.recommendedPercent),
        )
        .replace(
          '{{cal}}',
          String(analysisContext.optimalPortion.recommendedCalories),
        );
      ctx += `\n- ${cl('suggestedPortion', locale)}: ${portionText}`;
    }

    // V1.3: 下一餐建议
    if (analysisContext.nextMealAdvice) {
      const nma = analysisContext.nextMealAdvice;
      const nmaText = cl('nextMealTemplate', locale)
        .replace('{{emphasis}}', nma.emphasis)
        .replace('{{cal}}', String(nma.targetCalories))
        .replace('{{protein}}', String(nma.targetProtein));
      ctx += `\n- ${cl('nextMealAdvice', locale)}: ${nmaText}`;
    }

    // V1.6: 评分维度解释
    if (
      analysisContext.breakdownExplanations &&
      analysisContext.breakdownExplanations.length > 0
    ) {
      const bdLines = analysisContext.breakdownExplanations
        .map((be) => {
          const impactLabel = cl(
            `impact${be.impact.charAt(0).toUpperCase() + be.impact.slice(1)}`,
            locale,
          );
          let line = `- ${be.label}: ${be.score}${cl('points', locale)} (${impactLabel}) — ${be.message}`;
          // V1.9: 附加改善建议
          if (be.suggestion) {
            line += ` → ${be.suggestion}`;
          }
          return line;
        })
        .join('\n');
      ctx += `\n\n【${cl('scoreBreakdown', locale)}】\n${bdLines}`;
    }

    // V1.6: 决策推理链
    if (
      analysisContext.decisionChain &&
      analysisContext.decisionChain.length > 0
    ) {
      const dcLines = analysisContext.decisionChain
        .map((step, i) => {
          let line = `${i + 1}. ${step.step}: ${step.input} → ${step.output}`;
          // V1.9: 附加置信度
          if (step.confidence != null) {
            line += ` [${Math.round(step.confidence * 100)}%]`;
          }
          return line;
        })
        .join('\n');
      ctx += `\n\n【${cl('decisionChain', locale)}】\n${dcLines}`;
    }

    // V1.7: 结构化问题
    if (analysisContext.issues && analysisContext.issues.length > 0) {
      const severityLabel = (s: string) =>
        cl(`severity${s.charAt(0).toUpperCase() + s.slice(1)}`, locale);
      const issueLines = analysisContext.issues
        .map((issue) => {
          let line = `- [${severityLabel(issue.severity)}] ${issue.message}`;
          // V1.9: 附加可执行建议
          if (issue.actionable) {
            line += ` → ${issue.actionable}`;
          }
          return line;
        })
        .join('\n');
      ctx += `\n\n【${cl('issuesTitle', locale)}】\n${issueLines}`;
    }

    // V1.7: 宏量进度
    if (analysisContext.macroProgress) {
      const mp = analysisContext.macroProgress;
      const lines = [
        `- ${cl('totalCalories', locale)}: ${mp.calories.consumed}/${mp.calories.target} kcal (${mp.calories.percent}%)`,
        `- ${cl('protein', locale)}: ${mp.protein.consumed}/${mp.protein.target}g (${mp.protein.percent}%)`,
        `- ${cl('fat', locale)}: ${mp.fat.consumed}/${mp.fat.target}g (${mp.fat.percent}%)`,
        `- ${cl('carbs', locale)}: ${mp.carbs.consumed}/${mp.carbs.target}g (${mp.carbs.percent}%)`,
      ].join('\n');
      ctx += `\n\n【${cl('macroProgressTitle', locale)}】\n${lines}`;
    }

    ctx += `\n${cl('contextHint', locale)}`;

    // V1.9 Phase 3.4: 分析置信度影响教练语气
    if (
      analysisContext.decisionChain &&
      analysisContext.decisionChain.length > 0
    ) {
      const confidences = analysisContext.decisionChain
        .filter((s) => s.confidence != null)
        .map((s) => s.confidence!);
      if (confidences.length > 0) {
        const avgConfidence =
          confidences.reduce((a, b) => a + b, 0) / confidences.length;
        const confMod = getConfidenceModifier(avgConfidence, locale);
        if (confMod) {
          ctx += confMod;
        }
      }
    }

    return ctx;
  }

  // ==================== 私有辅助方法 ====================

  /**
   * V2.2: 基于结构化摘要构建精简教练上下文
   *
   * 相比原始 20 段数据，摘要版本更紧凑，LLM 更容易抓住重点
   */
  private formatSummaryContext(
    analysisContext: AnalysisContextInput,
    locale?: Locale,
  ): string {
    const summary = analysisContext.summary!;
    let ctx = '';

    // 食物列表（精简版）
    const foodList = analysisContext
      .foods!.map((f) => `${f.name}(${f.calories}kcal)`)
      .join('、');

    ctx += `\n\n【${cl('analyzedFood', locale)}】${foodList}`;
     ctx += `\n\n【${cl('summaryTitle', locale)}】`;
     ctx += `\n- ${cl('verdictLabel', locale)}：${summary.headline}`;
     ctx += `\n- ${cl('verdictLabel', locale)}等级：${summary.verdict}`;

    if (summary.topIssues.length > 0) {
      ctx += `\n- ${cl('topIssuesLabel', locale)}：${summary.topIssues.join('；')}`;
    }

    if (summary.topStrengths.length > 0) {
      ctx += `\n- ${cl('strengthsLabel', locale)}：${summary.topStrengths.join('；')}`;
    }

     ctx += `\n- ${cl('dataLabel', locale)}：${summary.quantitativeHighlight}`;

    if (summary.actionItems.length > 0) {
      ctx += `\n- ${cl('actionItemsLabel', locale)}：${summary.actionItems.join('；')}`;
    }

    if (summary.contextSignals && summary.contextSignals.length > 0) {
      ctx += `\n- ${cl('contextSignalLabel', locale)}：${summary.contextSignals.join('；')}`;
    }

    if (summary.coachFocus) {
      ctx += `\n- ${cl('coachFocusLabel', locale)}：${summary.coachFocus}`;
    }

    if (summary.alternativeSummary) {
      ctx += `\n- ${cl('alternativeLabel', locale)}：${summary.alternativeSummary}`;
    }
    if (summary.analysisQualityNote) {
      ctx += `\n- ${cl('analysisQualityLabel', locale)}：${summary.analysisQualityNote}`;
    }
    if (summary.dynamicDecisionHint) {
      ctx += `\n- ${cl('dynamicHintLabel', locale)}：${summary.dynamicDecisionHint}`;
    }
    if (summary.healthConstraintNote) {
      ctx += `\n- ${cl('healthConstraintLabel', locale)}：${summary.healthConstraintNote}`;
    }
    if (summary.decisionGuardrails && summary.decisionGuardrails.length > 0) {
      ctx += `\n- ${cl('decisionGuardrailsLabel', locale)}：${summary.decisionGuardrails.join('；')}`;
    }
    if (summary.reviewLevel) {
      const reviewLevelText =
        summary.reviewLevel === 'manual_review'
          ? cl('reviewManual', locale)
          : cl('reviewAuto', locale);
      ctx += `\n- ${cl('reviewLevelLabel', locale)}：${reviewLevelText}`;
    }
    // V3.0: 信号追踪
    if (summary.signalTrace && summary.signalTrace.length > 0) {
      const depth = analysisContext.evidencePack?.promptDepth ?? 'standard';
      // V3.1: brief 模式只显示 1 条, standard 5 条, detailed 全部
      const traceLimit = depth === 'brief' ? 1 : depth === 'detailed' ? 10 : 5;
      const traceLines = summary.signalTrace.slice(0, traceLimit)
        .map((t, i) => `  ${i + 1}. [${t.source}] ${t.description} (priority=${t.priority})`)
        .join('\n');
      ctx += `\n\n【${cl('signalTraceLabel', locale)}】\n${traceLines}`;
    }
    // V3.1: dailyMacroSummary 摘要文本
    if (analysisContext.evidencePack?.dailyMacroSummary) {
      ctx += `\n\n【每日摘要】\n${analysisContext.evidencePack.dailyMacroSummary}`;
    }
    // V3.0: 语气修饰
    if (analysisContext.evidencePack?.toneModifier) {
      ctx += `\n\n【${cl('toneModifierLabel', locale)}】\n${analysisContext.evidencePack.toneModifier}`;
    }
    // V3.0: 解释节点 — V3.1 brief 模式下跳过
    const promptDepth = analysisContext.evidencePack?.promptDepth ?? 'standard';
    if (promptDepth !== 'brief' && analysisContext.evidencePack?.explanationNodes?.length) {
      const nodeLines = analysisContext.evidencePack.explanationNodes
        .map((n) => `  ${n.step}. [${n.source}${n.weight ? '/' + n.weight : ''}] ${n.content}`)
        .join('\n');
      ctx += `\n\n【解释链路】\n${nodeLines}`;
    }
    // V3.1: detailed 模式追加结构化输出摘要
    if (promptDepth === 'detailed' && analysisContext.evidencePack?.structuredOutput) {
      const so = analysisContext.evidencePack.structuredOutput;
      ctx += `\n\n【结构化建议】\n判决: ${so.verdict}\n主要原因: ${so.mainReason}`;
      if (so.cautionNote) ctx += `\n注意: ${so.cautionNote}`;
      if (so.confidenceNote) ctx += `\n置信度说明: ${so.confidenceNote}`;
    }

    // 宏量进度（保留，教练需要全局视角）
    if (analysisContext.macroProgress) {
      const mp = analysisContext.macroProgress;
      const lines = [
        `- ${cl('totalCalories', locale)}: ${mp.calories.consumed}/${mp.calories.target} kcal (${mp.calories.percent}%)`,
        `- ${cl('protein', locale)}: ${mp.protein.consumed}/${mp.protein.target}g (${mp.protein.percent}%)`,
        `- ${cl('fat', locale)}: ${mp.fat.consumed}/${mp.fat.target}g (${mp.fat.percent}%)`,
        `- ${cl('carbs', locale)}: ${mp.carbs.consumed}/${mp.carbs.target}g (${mp.carbs.percent}%)`,
      ].join('\n');
      ctx += `\n\n【${cl('macroProgressTitle', locale)}】\n${lines}`;
    }

    ctx += `\n${cl('contextHint', locale)}`;

    // V1.9 Phase 3.4: 分析置信度影响教练语气
    if (
      analysisContext.decisionChain &&
      analysisContext.decisionChain.length > 0
    ) {
      const confidences = analysisContext.decisionChain
        .filter((s) => s.confidence != null)
        .map((s) => s.confidence!);
      if (confidences.length > 0) {
        const avgConfidence =
          confidences.reduce((a, b) => a + b, 0) / confidences.length;
        const confMod = getConfidenceModifier(avgConfidence, locale);
        if (confMod) {
          ctx += confMod;
        }
      }
    }

    return ctx;
  }

  private formatCoachActionContext(
    analysisContext: AnalysisContextInput,
    locale?: Locale,
  ): string {
    const plan = analysisContext.coachActionPlan!;
    let ctx = '';

    const foodList = analysisContext
      .foods!.map((f) => `${f.name}(${f.calories}kcal)`)
      .join('、');

    ctx += `\n\n【${cl('analyzedFood', locale)}】${foodList}`;
     ctx += `\n\n【${cl('coachPlanTitle', locale)}】`;
     ctx += `\n- ${cl('conclusionLabel', locale)}：${plan.conclusion}`;
    if (plan.why.length > 0) {
      ctx += `\n- ${cl('reasonLabel', locale)}：${plan.why.join('；')}`;
    }
    if (plan.doNow.length > 0) {
      ctx += `\n- ${cl('doNowLabel', locale)}：${plan.doNow.join('；')}`;
    }
    if (analysisContext.shouldEatAction?.followUpActions?.length) {
      ctx += `\n- ${cl('followUpLabel', locale)}：${analysisContext.shouldEatAction.followUpActions.join('；')}`;
    }
    if (plan.ifAlreadyAte && plan.ifAlreadyAte.length > 0) {
      ctx += `\n- ${cl('ifAlreadyAteLabel', locale)}：${plan.ifAlreadyAte.join('；')}`;
    }
    if (plan.alternatives && plan.alternatives.length > 0) {
      ctx += `\n- ${cl('alternativesLabel', locale)}：${plan.alternatives.join('；')}`;
    }
    if (plan.nextMeal) {
      ctx += `\n- ${cl('nextMealLabel', locale)}：${plan.nextMeal}`;
    }
    if (analysisContext.confidenceDiagnostics?.uncertaintyReasons?.length) {
      ctx += `\n- ${cl('uncertaintyLabel', locale)}：${analysisContext.confidenceDiagnostics.uncertaintyReasons.join('；')}`;
    }
    if (analysisContext.summary?.analysisQualityNote) {
      ctx += `\n- ${cl('analysisQualityLabel', locale)}：${analysisContext.summary.analysisQualityNote}`;
    }
    if (analysisContext.summary?.dynamicDecisionHint) {
      ctx += `\n- ${cl('dynamicHintLabel', locale)}：${analysisContext.summary.dynamicDecisionHint}`;
    }
    if (analysisContext.summary?.healthConstraintNote) {
      ctx += `\n- ${cl('healthConstraintLabel', locale)}：${analysisContext.summary.healthConstraintNote}`;
    }
    if (analysisContext.summary?.decisionGuardrails?.length) {
      ctx += `\n- ${cl('decisionGuardrailsLabel', locale)}：${analysisContext.summary.decisionGuardrails.join('；')}`;
    }
    if (analysisContext.summary?.reviewLevel) {
      const reviewLevelText =
        analysisContext.summary.reviewLevel === 'manual_review'
          ? cl('reviewManual', locale)
          : cl('reviewAuto', locale);
      ctx += `\n- ${cl('reviewLevelLabel', locale)}：${reviewLevelText}`;
    }
    if (analysisContext.confidenceDiagnostics?.decisionConfidence != null) {
      ctx += `\n- ${cl('decisionConfidenceLabel', locale)}：${Math.round(analysisContext.confidenceDiagnostics.decisionConfidence * 100)}%`;
    }
    // V3.0: 信号追踪
    if (analysisContext.summary?.signalTrace?.length) {
      const depth2 = analysisContext.evidencePack?.promptDepth ?? 'standard';
      const traceLimit2 = depth2 === 'brief' ? 1 : depth2 === 'detailed' ? 10 : 5;
      const traceLines = analysisContext.summary.signalTrace.slice(0, traceLimit2)
        .map((t, i) => `  ${i + 1}. [${t.source}] ${t.description} (priority=${t.priority})`)
        .join('\n');
      ctx += `\n\n【${cl('signalTraceLabel', locale)}】\n${traceLines}`;
    }
    // V3.1: dailyMacroSummary
    if (analysisContext.evidencePack?.dailyMacroSummary) {
      ctx += `\n\n【每日摘要】\n${analysisContext.evidencePack.dailyMacroSummary}`;
    }
    // V3.0: 语气修饰
    if (analysisContext.evidencePack?.toneModifier) {
      ctx += `\n\n【${cl('toneModifierLabel', locale)}】\n${analysisContext.evidencePack.toneModifier}`;
    }
    if (analysisContext.macroProgress) {
      const mp = analysisContext.macroProgress;
      ctx += `\n- ${cl('macroInlineLabel', locale)}：${cl('totalCalories', locale)}${mp.calories.percent}% / ${cl('protein', locale)}${mp.protein.percent}% / ${cl('fat', locale)}${mp.fat.percent}% / ${cl('carbs', locale)}${mp.carbs.percent}%`;
    }

    return ctx;
  }

  /**
   * 构建条件性段落（饮食限制、目标优先级、行为洞察）
   */
  private buildConditionalSections(
    profile: any,
    behaviorProfile: any,
    isEn: boolean,
    isJa: boolean,
    locale?: Locale,
  ): string {
    const parts: string[] = [];

    // P3-2: 饮食限制/过敏原/健康状况
    const allergens = profile?.allergens as string[] | undefined;
    const restrictions = profile?.dietaryRestrictions as string[] | undefined;
    const conditions = profile?.healthConditions as string[] | undefined;
    if (
      (allergens && allergens.length > 0) ||
      (restrictions && restrictions.length > 0) ||
      (conditions && conditions.length > 0)
    ) {
      const sectionTitle = isEn
        ? 'Dietary Restrictions & Health'
        : isJa
          ? '食事制限・健康情報'
          : '饮食限制与健康';
      const lines: string[] = [`【${sectionTitle}】`];
      if (allergens && allergens.length > 0) {
        lines.push(
          `- ${isEn ? 'Allergens (MUST AVOID)' : isJa ? 'アレルゲン（必ず回避）' : '过敏原（必须回避）'}：${allergens.join('、')}`,
        );
      }
      if (restrictions && restrictions.length > 0) {
        lines.push(
          `- ${isEn ? 'Dietary restrictions' : isJa ? '食事制限' : '饮食限制'}：${restrictions.join('、')}`,
        );
      }
      if (conditions && conditions.length > 0) {
        lines.push(
          `- ${isEn ? 'Health conditions' : isJa ? '健康状態' : '健康状况'}：${conditions.join('、')}`,
        );
        const condSet = new Set(conditions.map((c) => c.toLowerCase()));
        if (
          condSet.has('hypertension') ||
          condSet.has('高血压') ||
          condSet.has('高血圧')
        ) {
          lines.push(
            `  ⚠ ${isEn ? 'Watch sodium intake — avoid high-salt foods' : isJa ? 'ナトリウム摂取に注意 — 高塩分食品を避けて' : '注意钠摄入，避免高盐食物'}`,
          );
        }
        if (condSet.has('diabetes') || condSet.has('糖尿病')) {
          lines.push(
            `  ⚠ ${isEn ? 'Watch sugar intake — avoid high-sugar foods' : isJa ? '糖質摂取に注意 — 高糖質食品を避けて' : '注意糖摄入，避免高糖食物'}`,
          );
        }
      }
      parts.push(lines.join('\n'));
    }

    // P3-3: 目标聚焦指令
    const goal = profile?.goal as string | undefined;
    if (goal) {
      const goalTitle = isEn
        ? 'Goal Priority'
        : isJa
          ? '目標優先事項'
          : '目标优先级';
      const goalInstructions: Record<string, string> = {
        fat_loss: isEn
          ? 'User goal: Fat Loss. Prioritize calorie deficit, high protein, low fat. Flag any calorie overages immediately.'
          : isJa
            ? 'ユーザー目標：減量。カロリー赤字、高タンパク、低脂質を優先。カロリー超過は即座に指摘。'
            : '用户目标：减脂。优先保证热量缺口、高蛋白、低脂。热量超标需立即提醒。',
        muscle_gain: isEn
          ? 'User goal: Muscle Gain. Ensure adequate protein (≥1.6g/kg) and caloric surplus. Encourage post-workout nutrition.'
          : isJa
            ? 'ユーザー目標：筋肉増量。十分なタンパク質（≥1.6g/kg）とカロリー余剰を確保。運動後の栄養を推奨。'
            : '用户目标：增肌。确保充足蛋白质（≥1.6g/kg）和热量盈余。鼓励训练后补充营养。',
        health: isEn
          ? 'User goal: General Health. Focus on balanced macros, adequate fiber, and micronutrient diversity.'
          : isJa
            ? 'ユーザー目標：健康維持。バランスの取れたマクロ、十分な食物繊維、微量栄養素の多様性を重視。'
            : '用户目标：健康维护。注重宏量平衡、充足膳食纤维、微量营养素多样性。',
        habit: isEn
          ? 'User goal: Build Healthy Habits. Focus on meal regularity and portion awareness. Be encouraging about consistency.'
          : isJa
            ? 'ユーザー目標：健康的な習慣づくり。食事の規則性と分量の意識を重視。継続を励ます。'
            : '用户目标：养成习惯。注重饮食规律性和份量意识。多鼓励坚持。',
      };
      const instruction = goalInstructions[goal] || goalInstructions['health'];
      parts.push(`【${goalTitle}】\n${instruction}`);
    }

    // P3-4: 行为洞察段
    if (behaviorProfile) {
      const insightLines: string[] = [];
      if (behaviorProfile.weakMealType) {
        const mealNames: Record<string, string> = isEn
          ? {
              breakfast: 'breakfast',
              lunch: 'lunch',
              dinner: 'dinner',
              snack: 'snacks',
            }
          : isJa
            ? {
                breakfast: '朝食',
                lunch: '昼食',
                dinner: '夕食',
                snack: '間食',
              }
            : {
                breakfast: '早餐',
                lunch: '午餐',
                dinner: '晚餐',
                snack: '加餐',
              };
        const mealName =
          mealNames[behaviorProfile.weakMealType] ||
          behaviorProfile.weakMealType;
        insightLines.push(
          isEn
            ? `- Weak meal: ${mealName} — tends to have worst nutritional balance. Pay extra attention when advising on this meal.`
            : isJa
              ? `- 弱点の食事：${mealName} — 栄養バランスが最も悪い傾向。この食事のアドバイスには特に注意。`
              : `- 薄弱餐次：${mealName} — 营养平衡最差的一餐，给建议时需重点关注。`,
        );
      }
      if (behaviorProfile.topExcessCategory) {
        insightLines.push(
          isEn
            ? `- Top excess category: ${behaviorProfile.topExcessCategory} — user tends to over-consume this. Suggest alternatives when relevant.`
            : isJa
              ? `- 過剰摂取カテゴリ：${behaviorProfile.topExcessCategory} — 過剰摂取の傾向あり。関連する場合は代替品を提案。`
              : `- 超标类别：${behaviorProfile.topExcessCategory} — 用户倾向于过量摄入，相关时建议替代方案。`,
        );
      }

      // V1.5: 用餐时间模式
      const mealTimingPatterns = behaviorProfile.mealTimingPatterns as Record<
        string,
        string
      > | null;
      if (mealTimingPatterns && Object.keys(mealTimingPatterns).length > 0) {
        const timingStr = Object.entries(mealTimingPatterns)
          .map(([meal, time]) => `${meal}: ${time}`)
          .join(', ');
        insightLines.push(
          isEn
            ? `- Typical meal times: ${timingStr}. Tailor advice to their schedule.`
            : isJa
              ? `- 典型的な食事時間：${timingStr}。スケジュールに合わせたアドバイスを。`
              : `- 典型用餐时间：${timingStr}。根据用户作息给出建议。`,
        );
      }

      // V1.5: 替换偏好模式
      const replacementPatterns = behaviorProfile.replacementPatterns as Record<
        string,
        number
      > | null;
      if (replacementPatterns && Object.keys(replacementPatterns).length > 0) {
        const topReplacements = Object.entries(replacementPatterns)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([pair, count]) => `${pair}(${count}次)`)
          .join(', ');
        insightLines.push(
          isEn
            ? `- Preferred substitutions: ${topReplacements}. Suggest these when relevant.`
            : isJa
              ? `- よく行う置き換え：${topReplacements}。関連する場合にこれらを提案。`
              : `- 常用替换：${topReplacements}。相关时优先推荐这些替代。`,
        );
      }

      // V1.5: 食物偏好
      const foodPrefs = behaviorProfile.foodPreferences as {
        frequentFoods?: string[];
        loves?: string[];
        avoids?: string[];
      } | null;
      if (foodPrefs) {
        if (foodPrefs.loves && foodPrefs.loves.length > 0) {
          insightLines.push(
            isEn
              ? `- Loved foods: ${foodPrefs.loves.join(', ')}. Incorporate when possible.`
              : isJa
                ? `- 好きな食べ物：${foodPrefs.loves.join('、')}。可能な限り取り入れる。`
                : `- 喜爱食物：${foodPrefs.loves.join('、')}。可以时优先推荐。`,
          );
        }
        if (foodPrefs.avoids && foodPrefs.avoids.length > 0) {
          insightLines.push(
            isEn
              ? `- Avoided foods: ${foodPrefs.avoids.join(', ')}. Never recommend these.`
              : isJa
                ? `- 避ける食べ物：${foodPrefs.avoids.join('、')}。これらは絶対に推奨しない。`
                : `- 不喜欢的食物：${foodPrefs.avoids.join('、')}。不要推荐这些。`,
          );
        }
        if (foodPrefs.frequentFoods && foodPrefs.frequentFoods.length > 0) {
          insightLines.push(
            isEn
              ? `- Frequently eaten: ${foodPrefs.frequentFoods.slice(0, 8).join(', ')}.`
              : isJa
                ? `- よく食べるもの：${foodPrefs.frequentFoods.slice(0, 8).join('、')}。`
                : `- 常吃食物：${foodPrefs.frequentFoods.slice(0, 8).join('、')}。`,
          );
        }
      }
      if (insightLines.length > 0) {
        const insightTitle = isEn
          ? 'Behavior Insights'
          : isJa
            ? '行動分析'
            : '行为洞察';
        parts.push(`【${insightTitle}】\n${insightLines.join('\n')}`);
      }
    }

    return parts.length > 0 ? '\n' + parts.join('\n\n') + '\n' : '';
  }

  /**
   * V1.6: 能力指令段
   */
  private buildCapabilitiesSection(isEn: boolean, isJa: boolean): string {
    const v16Title = isEn
      ? 'V1.6 Capabilities'
      : isJa
        ? 'V1.6 機能'
        : 'V1.6 能力';
    const v16Instructions = isEn
      ? `You can now explain the meaning and scoring rationale for each scoring dimension.
When the user asks "why is this not recommended", cite specific steps from the decision reasoning chain.
When suggesting alternative foods, provide quantitative comparisons (calorie difference, protein difference, etc.).`
      : isJa
        ? `各スコア次元の意味とスコアの理由を説明できるようになりました。
ユーザーが「なぜ食べない方がいいのか」と聞いたら、判定推論チェーンの具体的なステップを引用してください。
代替食品を提案する際は、定量的な比較（カロリー差、タンパク質差など）を提供してください。`
        : `你现在可以解释每个评分维度的含义和得分原因。
当用户问"为什么不建议吃"时，引用决策推理链中的具体步骤。
当建议替代食物时，提供定量对比（热量差、蛋白质差等）。`;
    return `【${v16Title}】\n${v16Instructions}`;
  }
}
