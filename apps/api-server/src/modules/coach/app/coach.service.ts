import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../core/prisma/prisma.service';
import { FoodService } from '../../diet/app/services/food.service';
import { UserProfileService } from '../../user/app/services/profile/user-profile.service';
import { BehaviorService } from '../../diet/app/services/behavior.service';
import { getUserLocalHour } from '../../../common/utils/timezone.util';
import { t, Locale } from '../../diet/app/recommendation/utils/i18n-messages';
import {
  CoachPromptBuilderService,
  AnalysisContextInput,
} from './prompt/coach-prompt-builder.service';
import { FoodAnalysisResultV61 } from '../../decision/types/analysis-result.types';

// V1.9: COACH_LABELS, cl(), PERSONA_PROMPTS 已提取到 CoachPromptBuilderService 和 coach-tone.config.ts

export interface DailyGreeting {
  greeting: string;
  suggestions: string[];
}

@Injectable()
export class CoachService {
  private readonly logger = new Logger(CoachService.name);
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly chatModel: string;

  /** V2.0: 最新分析结果缓存（userId → { result, timestamp }） */
  private readonly latestAnalysisCache = new Map<
    string,
    { result: FoodAnalysisResultV61; timestamp: number }
  >();
  /** 缓存有效期：5分钟 */
  private static readonly ANALYSIS_CACHE_TTL = 5 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
    private readonly behaviorService: BehaviorService,
    private readonly configService: ConfigService,
    private readonly promptBuilder: CoachPromptBuilderService,
  ) {
    this.apiKey = this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.baseUrl =
      this.configService.get<string>('OPENROUTER_BASE_URL') ||
      'https://openrouter.ai/api/v1';
    this.chatModel =
      this.configService.get<string>('COACH_MODEL') ||
      'deepseek/deepseek-chat-v3-0324';

    if (!this.apiKey) {
      this.logger.warn('OPENROUTER_API_KEY 未配置，AI Coach 将不可用');
    } else {
      this.logger.log(`AI Coach 已初始化: model=${this.chatModel}`);
    }
  }

  // ==================== V2.0: 分析事件自动桥接 ====================

  /**
   * 监听食物分析完成事件，缓存最新结果供教练对话使用
   */
  @OnEvent('food.analysis.completed')
  handleAnalysisCompleted(payload: {
    userId: string;
    result: FoodAnalysisResultV61;
  }) {
    this.latestAnalysisCache.set(payload.userId, {
      result: payload.result,
      timestamp: Date.now(),
    });
    this.logger.debug(
      `Cached analysis result for user ${payload.userId} (${payload.result?.inputType || 'unknown'})`,
    );
  }

  /**
   * 获取用户最新分析结果（5分钟内有效）
   */
  private getCachedAnalysis(userId: string): FoodAnalysisResultV61 | null {
    const cached = this.latestAnalysisCache.get(userId);
    if (!cached) return null;
    if (Date.now() - cached.timestamp > CoachService.ANALYSIS_CACHE_TTL) {
      this.latestAnalysisCache.delete(userId);
      return null;
    }
    return cached.result;
  }

  /**
   * 构建系统 Prompt — V1.9: 委托给 CoachPromptBuilderService
   */
  async buildSystemPrompt(userId: string, locale?: Locale): Promise<string> {
    return this.promptBuilder.buildSystemPrompt(userId, locale);
  }

  /**
   * 准备对话上下文（系统 prompt + 历史消息 + 新消息）
   */
  async prepareContext(
    userId: string,
    conversationId: string | undefined,
    message: string,
    analysisContext?: AnalysisContextInput,
    locale?: Locale,
  ): Promise<{
    messages: Array<{ role: string; content: string }>;
    conversationId: string;
  }> {
    if (!this.apiKey) {
      throw new BadRequestException('AI Coach 服务未配置');
    }

    let convId = conversationId;

    // 新建会话
    if (!convId) {
      const saved = await this.prisma.coachConversations.create({
        data: {
          userId: userId,
          title: message.substring(0, 100),
        },
      });
      convId = saved.id;
    } else {
      // 验证对话归属
      const conv = await this.prisma.coachConversations.findFirst({
        where: { id: convId, userId: userId },
      });
      if (!conv) {
        throw new NotFoundException('对话不存在');
      }
      // 更新时间戳
      await this.prisma.coachConversations.update({
        where: { id: convId },
        data: { updatedAt: new Date() },
      });
    }

    // 加载最近 10 条历史消息
    const history = await this.prisma.coachMessages.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    history.reverse();

    // 构建系统 prompt
    const systemPrompt = await this.buildSystemPrompt(userId, locale);

    // V1.9: 委托 CoachPromptBuilderService 格式化分析上下文
    // V2.0: 如果未显式传入 analysisContext，自动从缓存获取
    let contextEnhancedPrompt = systemPrompt;
    let effectiveAnalysisContext = analysisContext;
    if (!effectiveAnalysisContext) {
      const cached = this.getCachedAnalysis(userId);
      if (cached) {
        effectiveAnalysisContext = {
          foods: cached.foods.map((f) => ({
            name: f.name,
            calories: f.calories,
            protein: f.protein,
            fat: f.fat,
            carbs: f.carbs,
          })),
          totalCalories: cached.totals.calories,
          totalProtein: cached.totals.protein,
          totalFat: cached.totals.fat,
          totalCarbs: cached.totals.carbs,
          decision: cached.decision.recommendation,
          riskLevel: cached.decision.riskLevel,
          nutritionScore: cached.score?.nutritionScore,
          advice: cached.decision.advice,
          mealType: cached.inputSnapshot?.mealType,
          decisionFactors: cached.decision.decisionFactors,
          breakdownExplanations: cached.decision.breakdownExplanations,
          decisionChain: cached.decision.decisionChain,
          issues: cached.decision.issues,
          summary: cached.summary,
          shouldEatAction: cached.shouldEatAction,
          evidencePack: cached.evidencePack,
          confidenceDiagnostics: cached.confidenceDiagnostics,
          coachActionPlan: cached.coachActionPlan,
          // V3.5 P3.2: 注入上下文分析和用户上下文，激活 CoachInsight 注入点
          contextualAnalysis: cached.contextualAnalysis,
          unifiedUserContext: cached.unifiedUserContext,
        };
        this.logger.debug(
          `Auto-injected cached analysis context for user ${userId}`,
        );
      }
    }
    if (effectiveAnalysisContext) {
      contextEnhancedPrompt += this.promptBuilder.formatAnalysisContext(
        effectiveAnalysisContext,
        locale,
      );
    }

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: contextEnhancedPrompt },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: message },
    ];

    return { messages, conversationId: convId };
  }

  /**
   * 流式调用 OpenRouter（返回 ReadableStream for SSE）
   */
  async createChatStream(
    messages: Array<{ role: string; content: string }>,
  ): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://uway.dev-net.uk',
        'X-Title': 'Wuwei Health',
      },
      body: JSON.stringify({
        model: this.chatModel,
        messages,
        temperature: 0.7,
        max_tokens: 400,
        stream: true,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      this.logger.error(`OpenRouter API 错误: ${response.status} ${err}`);
      throw new BadRequestException('AI 服务暂时不可用，请稍后重试');
    }

    return response;
  }

  /**
   * 保存对话消息
   */
  async saveMessage(
    conversationId: string,
    userId: string,
    userMessage: string,
    assistantMessage: string,
    tokensUsed?: number,
  ): Promise<void> {
    // 保存用户消息
    await this.prisma.coachMessages.create({
      data: {
        conversationId: conversationId,
        role: 'user',
        content: userMessage,
        tokensUsed: 0,
      },
    });

    // 保存助手回复
    await this.prisma.coachMessages.create({
      data: {
        conversationId: conversationId,
        role: 'assistant',
        content: assistantMessage,
        tokensUsed: tokensUsed || 0,
      },
    });

    // 更新会话标题（如果还没有标题或是第一条消息）
    const conv = await this.prisma.coachConversations.findFirst({
      where: { id: conversationId },
    });
    if (conv && (!conv.title || conv.title === userMessage.substring(0, 100))) {
      await this.prisma.coachConversations.update({
        where: { id: conversationId },
        data: {
          title: userMessage.substring(0, 100),
          updatedAt: new Date(),
        },
      });
    }
  }

  /**
   * 获取对话列表
   */
  async getConversations(userId: string): Promise<any[]> {
    return this.prisma.coachConversations.findMany({
      where: { userId: userId },
      orderBy: { updatedAt: 'desc' },
      take: 50,
    });
  }

  /**
   * 获取对话消息
   */
  async getMessages(
    conversationId: string,
    userId: string,
    page: number = 1,
    limit: number = 50,
  ): Promise<{ items: any[]; total: number }> {
    // 验证对话归属
    const conv = await this.prisma.coachConversations.findFirst({
      where: { id: conversationId, userId: userId },
    });
    if (!conv) {
      throw new NotFoundException('对话不存在');
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      this.prisma.coachMessages.findMany({
        where: { conversationId: conversationId },
        orderBy: { createdAt: 'asc' },
        skip,
        take: limit,
      }),
      this.prisma.coachMessages.count({
        where: { conversationId: conversationId },
      }),
    ]);

    return { items, total };
  }

  /**
   * 删除对话
   */
  async deleteConversation(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const conv = await this.prisma.coachConversations.findFirst({
      where: { id: conversationId, userId: userId },
    });
    if (!conv) {
      throw new NotFoundException('对话不存在');
    }
    await this.prisma.coachConversations.delete({
      where: { id: conversationId },
    });
  }

  /**
   * P3-2: 获取每日开场问候（增加7天饮食模式分析+个性化建议）
   */
  async getDailyGreeting(
    userId: string,
    locale?: Locale,
  ): Promise<DailyGreeting> {
    const tz = await this.userProfileService.getTimezone(userId);
    const hour = getUserLocalHour(tz);
    const [summary, recentSummaries, behaviorProfile] = await Promise.all([
      this.foodService.getTodaySummary(userId),
      this.foodService
        .getRecentSummaries(userId, 7)
        .catch(() => [] as Array<{ totalCalories: number }>),
      this.behaviorService.getProfile(userId).catch(() => null),
    ]);

    // 补充热量目标
    if (!summary.calorieGoal) {
      summary.calorieGoal =
        await this.userProfileService.getDailyCalorieGoal(userId);
      summary.remaining = Math.max(
        0,
        summary.calorieGoal - summary.totalCalories,
      );
    }

    // P3-2: 7天模式分析
    let patternHint = '';
    if (recentSummaries.length >= 3) {
      const avgCal = Math.round(
        recentSummaries.map((d) => d.totalCalories).reduce((a, b) => a + b, 0) /
          recentSummaries.length,
      );
      const overDays = recentSummaries.filter(
        (d) => d.totalCalories > (summary.calorieGoal || 2000),
      ).length;
      const goalCal = summary.calorieGoal || 2000;

      if (overDays >= 4) {
        patternHint = t(
          'coach.pattern.overMany',
          {
            days: String(recentSummaries.length),
            overDays: String(overDays),
            avg: String(avgCal),
          },
          locale,
        );
      } else if (overDays === 0) {
        patternHint = t(
          'coach.pattern.allOnTarget',
          {
            days: String(recentSummaries.length),
            avg: String(avgCal),
          },
          locale,
        );
      } else {
        const ratio = Math.round((avgCal / goalCal) * 100);
        patternHint = t(
          'coach.pattern.average',
          {
            avg: String(avgCal),
            ratio: String(ratio),
          },
          locale,
        );
      }
    }

    // 根据时段+状态生成问候语
    let greeting: string;
    if (hour < 10) {
      greeting =
        summary.mealCount === 0
          ? t('coach.greeting.morning.noMeal', {}, locale)
          : t('coach.greeting.morning.hasMeal', {}, locale);
    } else if (hour < 14) {
      greeting =
        summary.mealCount === 0
          ? t('coach.greeting.noon.noMeal', {}, locale)
          : t(
              'coach.greeting.noon.hasMeal',
              { calories: String(summary.totalCalories) },
              locale,
            );
    } else if (hour < 18) {
      const pct = summary.calorieGoal
        ? Math.round((summary.totalCalories / summary.calorieGoal) * 100)
        : 0;
      const hint =
        pct > 80
          ? t('coach.greeting.afternoon.over80', {}, locale)
          : t('coach.greeting.afternoon.under80', {}, locale);
      greeting = t(
        'coach.greeting.afternoon',
        { percent: String(pct), hint },
        locale,
      );
    } else if (hour < 21) {
      greeting = t(
        'coach.greeting.evening',
        { remaining: String(summary.remaining) },
        locale,
      );
    } else {
      greeting =
        summary.totalCalories > (summary.calorieGoal || 2000)
          ? t('coach.greeting.night.over', {}, locale)
          : t('coach.greeting.night.under', {}, locale);
    }

    // 追加模式提示
    if (patternHint) {
      greeting += ` ${patternHint}`;
    }

    // P3-2: 个性化快捷建议（结合行为画像）
    const suggestions = this.getPersonalizedSuggestions(
      hour,
      summary,
      recentSummaries,
      behaviorProfile,
      locale,
    );

    return { greeting, suggestions };
  }

  /**
   * P3-2: 个性化快捷建议（结合时段、饮食数据、行为画像）
   */
  private getPersonalizedSuggestions(
    hour: number,
    summary: {
      totalCalories: number;
      calorieGoal: number | null;
      mealCount: number;
    },
    recentSummaries: Array<{ totalCalories: number }>,
    behaviorProfile: any,
    locale?: Locale,
  ): string[] {
    const suggestions: string[] = [];
    const goalCal = summary.calorieGoal || 2000;
    const pct = Math.round((summary.totalCalories / goalCal) * 100);

    // 时段基础建议
    if (hour < 10) {
      suggestions.push(t('coach.suggest.planToday', {}, locale));
      if (summary.mealCount === 0)
        suggestions.push(t('coach.suggest.highProteinBreakfast', {}, locale));
    } else if (hour < 14) {
      suggestions.push(
        pct > 50
          ? t('coach.suggest.lowCalLunch', {}, locale)
          : t('coach.suggest.bestLunch', {}, locale),
      );
    } else if (hour < 18) {
      suggestions.push(
        t(
          'coach.suggest.caloriesLeft',
          { calories: String(Math.max(0, goalCal - summary.totalCalories)) },
          locale,
        ),
      );
      suggestions.push(t('coach.suggest.healthySnack', {}, locale));
    } else if (hour < 21) {
      suggestions.push(
        pct > 80
          ? t('coach.suggest.lowCalDinner', {}, locale)
          : t('coach.suggest.lightDinner', {}, locale),
      );
    } else {
      suggestions.push(t('coach.suggest.todaySummary', {}, locale));
    }

    // 行为画像驱动建议
    if (behaviorProfile) {
      if (behaviorProfile.weakMealType === 'dinner') {
        suggestions.push(t('coach.suggest.improveDinner', {}, locale));
      }
      if (behaviorProfile.topExcessCategory) {
        suggestions.push(
          t(
            'coach.suggest.reduceCategory',
            { category: behaviorProfile.topExcessCategory },
            locale,
          ),
        );
      }
    }

    // 7天趋势建议
    if (recentSummaries.length >= 3) {
      const overDays = recentSummaries.filter(
        (d) => d.totalCalories > goalCal,
      ).length;
      if (overDays >= 3) {
        suggestions.push(t('coach.suggest.analyzeRecent', {}, locale));
      }
    }

    // 通用补充
    if (suggestions.length < 3) {
      suggestions.push(t('coach.suggest.tomorrowPlan', {}, locale));
    }

    return suggestions.slice(0, 3);
  }
}
