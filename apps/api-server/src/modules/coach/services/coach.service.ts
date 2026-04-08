import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CoachConversation } from '../entities/coach-conversation.entity';
import { CoachMessage } from '../entities/coach-message.entity';
import { UserProfileService } from '../../user-profile/services/user-profile.service';
import { AiGatewayService } from '../../../infrastructure/ai-gateway/ai-gateway.service';

@Injectable()
export class CoachService {
  private readonly logger = new Logger(CoachService.name);

  constructor(
    @InjectRepository(CoachConversation)
    private convRepo: Repository<CoachConversation>,
    @InjectRepository(CoachMessage)
    private msgRepo: Repository<CoachMessage>,
    private profileService: UserProfileService,
    private aiGateway: AiGatewayService,
  ) {}

  async getConversations(userId: string) {
    return this.convRepo.find({
      where: { userId },
      order: { updatedAt: 'DESC' },
    });
  }

  async getConversation(userId: string, conversationId: string) {
    const conv = await this.convRepo.findOne({
      where: { id: conversationId, userId },
      relations: ['messages'],
    });
    if (!conv) throw new NotFoundException('会话不存在');
    return conv;
  }

  async createConversation(userId: string, title?: string) {
    const conv = this.convRepo.create({ userId, title });
    return this.convRepo.save(conv);
  }

  async sendMessage(userId: string, conversationId: string, content: string) {
    const conv = await this.getConversation(userId, conversationId);

    // Save user message
    const userMsg = this.msgRepo.create({
      conversationId,
      role: 'user',
      content,
    });
    await this.msgRepo.save(userMsg);

    // Build context
    const profile = await this.profileService.getOrCreate(userId);
    const behavior = await this.profileService.getBehavior(userId);
    const history = conv.messages.slice(-10).map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const systemPrompt = this.buildSystemPrompt(profile, behavior);
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...history,
      { role: 'user' as const, content },
    ];

    // Call AI
    const response = await this.aiGateway.generateText({
      model: 'deepseek/deepseek-chat',
      messages,
      temperature: 0.7,
      maxTokens: 800,
    });

    // Save assistant message
    const assistantMsg = this.msgRepo.create({
      conversationId,
      role: 'assistant',
      content: response.text,
      tokensUsed: response.usage?.totalTokens || 0,
    });
    await this.msgRepo.save(assistantMsg);

    // Update conversation title if first message
    if (conv.messages.length <= 1 && !conv.title) {
      conv.title = content.slice(0, 50);
      await this.convRepo.save(conv);
    }

    return assistantMsg;
  }

  private buildSystemPrompt(profile: any, behavior: any): string {
    const style = behavior.coachStyle || 'friendly';
    const goal = profile.goal || 'health';

    return `你是一个专业的饮食健康教练。用户目标：${goal}。
沟通风格：${style}。
用户信息：体重${profile.weightKg || '未知'}kg，身高${profile.heightCm || '未知'}cm，
活动等级${profile.activityLevel || 'light'}，自律程度${profile.discipline || 'medium'}。
连续打卡${behavior.streakDays || 0}天，健康饮食率${Math.round((behavior.avgComplianceRate || 0) * 100)}%。
请结合用户情况给出个性化建议，简洁友好，不超过200字。`;
  }
}
