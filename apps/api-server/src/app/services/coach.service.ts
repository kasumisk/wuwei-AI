import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoachConversation } from '../../entities/coach-conversation.entity';
import { CoachMessage } from '../../entities/coach-message.entity';
import { FoodService } from './food.service';
import { UserProfileService } from './user-profile.service';
import { BehaviorService } from './behavior.service';

// V5: AI 人格 Prompt
const PERSONA_PROMPTS: Record<string, string> = {
  strict: `你的风格是严格教练：直接了当，不拐弯抹角。重点强调目标和纪律。语气坚定但不攻击。`,
  friendly: `你的风格是暖心朋友：温和鼓励，理解失败很正常。避免强烈否定，多给替代方案。`,
  data: `你的风格是数据分析师：客观冷静，用数字说话。减少情感表达，强调数据对比。`,
};

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

  constructor(
    @InjectRepository(CoachConversation)
    private readonly convRepo: Repository<CoachConversation>,
    @InjectRepository(CoachMessage)
    private readonly msgRepo: Repository<CoachMessage>,
    private readonly foodService: FoodService,
    private readonly userProfileService: UserProfileService,
    private readonly behaviorService: BehaviorService,
    private readonly configService: ConfigService,
  ) {
    this.apiKey =
      this.configService.get<string>('OPENROUTER_API_KEY') || '';
    this.baseUrl =
      this.configService.get<string>('OPENROUTER_BASE_URL') ||
      'https://openrouter.ai/api/v1';
    this.chatModel =
      this.configService.get<string>('COACH_MODEL') ||
      'deepseek/deepseek-chat-v3-0324';

    if (!this.apiKey) {
      this.logger.warn('OPENROUTER_API_KEY 未配置，AI Coach 将不可用');
    } else {
      this.logger.log(
        `AI Coach 已初始化: model=${this.chatModel}`,
      );
    }
  }

  /**
   * 构建系统 Prompt（注入用户数据上下文）
   */
  async buildSystemPrompt(userId: string): Promise<string> {
    const [profile, todaySummary, recentSummaries, behaviorProfile, behaviorContext] = await Promise.all([
      this.userProfileService.getProfile(userId),
      this.foodService.getTodaySummary(userId),
      this.foodService.getRecentSummaries(userId, 7),
      this.behaviorService.getProfile(userId).catch(() => null),
      this.behaviorService.getBehaviorContext(userId).catch(() => ''),
    ]);

    const hour = new Date().getHours();
    const timeHint =
      hour < 10
        ? '现在是早晨，用户可能还没吃早餐'
        : hour < 14
          ? '现在是午餐时间'
          : hour < 18
            ? '现在是下午'
            : hour < 21
              ? '现在是晚餐时间'
              : '现在是夜间，提醒用户注意宵夜热量';

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
            (d) =>
              d.totalCalories <= (todaySummary.calorieGoal || 2000),
          ).length
        : 0;

    return `你是无畏健康的 AI 营养教练，风格亲切、专业、简洁。
用中文回复，每条消息不超过 150 字，不要使用 Markdown 格式。

【用户档案】
${
  profile
    ? `- 性别：${profile.gender === 'male' ? '男' : '女'}
- 年龄：${new Date().getFullYear() - (profile.birthYear || 1990)} 岁
- BMI：${bmi}（身高 ${profile.heightCm}cm，体重 ${profile.weightKg}kg）
- 活动等级：${profile.activityLevel}
- 每日热量目标：${todaySummary.calorieGoal || 2000} kcal`
    : '用户尚未填写健康档案，可引导他去填写以获得更精准建议。'
}

【今日饮食】
- 已摄入：${todaySummary.totalCalories} kcal / 目标 ${todaySummary.calorieGoal || 2000} kcal
- 剩余：${todaySummary.remaining} kcal
- 今日记录餐数：${todaySummary.mealCount} 餐

【最近 7 天平均】
- 日均摄入：${avgCalories} kcal
- 达标天数：${onTargetDays} / ${recentSummaries.length} 天

【时间信息】${timeHint}

根据以上信息，给出个性化、有温度的饮食建议。如果用户问某食物热量，直接给出估算值，不要说"建议咨询医生"。

${behaviorContext ? behaviorContext + '\n' : ''}${PERSONA_PROMPTS[behaviorProfile?.coachStyle || 'friendly'] || ''}`;
  }

  /**
   * 准备对话上下文（系统 prompt + 历史消息 + 新消息）
   */
  async prepareContext(
    userId: string,
    conversationId: string | undefined,
    message: string,
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
      const conv = this.convRepo.create({
        userId,
        title: message.substring(0, 100),
      });
      const saved = await this.convRepo.save(conv);
      convId = saved.id;
    } else {
      // 验证对话归属
      const conv = await this.convRepo.findOne({
        where: { id: convId, userId },
      });
      if (!conv) {
        throw new NotFoundException('对话不存在');
      }
      // 更新时间戳
      conv.updatedAt = new Date();
      await this.convRepo.save(conv);
    }

    // 加载最近 10 条历史消息
    const history = await this.msgRepo.find({
      where: { conversationId: convId },
      order: { createdAt: 'DESC' },
      take: 10,
    });
    history.reverse();

    // 构建系统 prompt
    const systemPrompt = await this.buildSystemPrompt(userId);

    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: systemPrompt },
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
    await this.msgRepo.save(
      this.msgRepo.create({
        conversationId,
        role: 'user',
        content: userMessage,
        tokensUsed: 0,
      }),
    );

    // 保存助手回复
    await this.msgRepo.save(
      this.msgRepo.create({
        conversationId,
        role: 'assistant',
        content: assistantMessage,
        tokensUsed: tokensUsed || 0,
      }),
    );

    // 更新会话标题（如果还没有标题或是第一条消息）
    const conv = await this.convRepo.findOne({
      where: { id: conversationId },
    });
    if (conv && (!conv.title || conv.title === userMessage.substring(0, 100))) {
      conv.title = userMessage.substring(0, 100);
      conv.updatedAt = new Date();
      await this.convRepo.save(conv);
    }
  }

  /**
   * 获取对话列表
   */
  async getConversations(
    userId: string,
  ): Promise<CoachConversation[]> {
    return this.convRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
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
  ): Promise<{ items: CoachMessage[]; total: number }> {
    // 验证对话归属
    const conv = await this.convRepo.findOne({
      where: { id: conversationId, userId },
    });
    if (!conv) {
      throw new NotFoundException('对话不存在');
    }

    const [items, total] = await this.msgRepo.findAndCount({
      where: { conversationId },
      order: { createdAt: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
  }

  /**
   * 删除对话
   */
  async deleteConversation(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const conv = await this.convRepo.findOne({
      where: { id: conversationId, userId },
    });
    if (!conv) {
      throw new NotFoundException('对话不存在');
    }
    await this.convRepo.remove(conv);
  }

  /**
   * 获取每日开场问候
   */
  async getDailyGreeting(userId: string): Promise<DailyGreeting> {
    const hour = new Date().getHours();
    const summary = await this.foodService.getTodaySummary(userId);

    // 补充热量目标
    if (!summary.calorieGoal) {
      summary.calorieGoal =
        await this.userProfileService.getDailyCalorieGoal(userId);
      summary.remaining = Math.max(
        0,
        summary.calorieGoal - summary.totalCalories,
      );
    }

    // 根据时段+状态生成问候语
    let greeting: string;
    if (hour < 10) {
      greeting =
        summary.mealCount === 0
          ? '早上好！新的一天开始了，早餐是最重要的一餐哦～'
          : `早上好！你已经记录了今天的第一餐，继续保持！`;
    } else if (hour < 14) {
      greeting =
        summary.mealCount === 0
          ? '中午好！今天还没有记录饮食，该吃午餐啦～'
          : `中午好！你今天已摄入 ${summary.totalCalories} 卡，午餐注意搭配哦。`;
    } else if (hour < 18) {
      const pct = summary.calorieGoal
        ? Math.round((summary.totalCalories / summary.calorieGoal) * 100)
        : 0;
      greeting = `下午好！今日热量已达目标的 ${pct}%，${pct > 80 ? '晚餐注意控制' : '还有空间享用健康晚餐'}。`;
    } else if (hour < 21) {
      greeting = `晚上好！今天还剩 ${summary.remaining} 卡的额度，选一顿清淡的晚餐吧。`;
    } else {
      greeting =
        summary.totalCalories > (summary.calorieGoal || 2000)
          ? '夜深了，今天热量已超标，建议不要再进食了哦～'
          : '夜深了，如果饿了可以选择低热量零食，注意控制。';
    }

    const suggestions = this.getStaticSuggestions(hour, summary);

    return { greeting, suggestions };
  }

  /**
   * 根据时段生成快捷建议
   */
  private getStaticSuggestions(
    hour: number,
    summary: { totalCalories: number; calorieGoal: number | null; mealCount: number },
  ): string[] {
    if (hour < 10) {
      return ['帮我规划今日饮食', '早餐吃什么好', '今天的热量目标是多少'];
    }
    if (hour < 14) {
      return ['午餐怎么吃不超标', '帮我分析这顿午餐', '推荐低卡午餐'];
    }
    if (hour < 18) {
      return ['今天还能吃多少', '推荐健康下午茶', '今天的饮食评分'];
    }
    if (hour < 21) {
      return ['推荐清淡晚餐', '今天总结怎么样', '晚餐吃什么好'];
    }
    return ['今天饮食总结', '明天该怎么吃', '有什么低卡零食推荐'];
  }
}
