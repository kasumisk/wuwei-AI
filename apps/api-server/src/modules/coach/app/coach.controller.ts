import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Response } from 'express';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../auth/app/app-user-payload.type';
import { IgnoreResponseInterceptor } from '../../../core/decorators/ignore-response-interceptor.decorator';
import { ApiResponse } from '../../../common/types/response.type';
import { CoachService } from './coach.service';
import { BehaviorService } from '../../diet/app/services/behavior.service';
import { CoachChatDto, CoachMessagesQueryDto } from './dto/coach.dto';
import { RequireFeature } from '../../subscription/app/decorators/require-feature.decorator';
import { GatedFeature } from '../../subscription/subscription.types';
import { QuotaGateService } from '../../subscription/app/services/quota-gate.service';
import { SubscriptionService } from '../../subscription/app/services/subscription.service';
import { I18nService } from '../../../core/i18n/i18n.service';
import type { Locale } from '../../diet/app/recommendation/utils/i18n-messages';

@ApiTags('App AI 教练')
@Controller('app/coach')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class CoachController {
  private readonly logger = new Logger(CoachController.name);

  constructor(
    private readonly coachService: CoachService,
    private readonly behaviorService: BehaviorService,
    private readonly quotaGateService: QuotaGateService,
    private readonly subscriptionService: SubscriptionService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 发送消息（SSE 流式响应）
   * POST /api/app/coach/chat
   */
  @Post('chat')
  @IgnoreResponseInterceptor()
  @ApiOperation({ summary: 'AI 教练聊天（SSE 流式）' })
  async chat(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: CoachChatDto,
    @Res() res: Response,
  ): Promise<void> {
    const summary = await this.subscriptionService.getUserSummary(user.id);
    const access = await this.quotaGateService.checkAccess({
      userId: user.id,
      feature: GatedFeature.AI_COACH,
      scene: 'ai_coach_chat',
      consumeQuota: true,
    });

    if (!access.allowed) {
      const locale = (dto.locale as Locale | undefined) || undefined;
      const errorMessage =
        access.paywall?.message ??
        (locale === 'en-US'
          ? 'AI coach quota exceeded'
          : locale === 'ja-JP'
            ? 'AIコーチの利用枠が不足しています'
            : 'AI 教练配额不足');
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();
      res.write(
        `data: ${JSON.stringify({
          error: errorMessage,
          feature: GatedFeature.AI_COACH,
          tier: summary.tier,
        })}\n\n`,
      );
      res.end();
      return;
    }

    // SSE 响应头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    let conversationId: string;
    let fullText = '';

    try {
      // 1. 准备对话上下文
      const locale = (dto.locale as Locale | undefined) || undefined;
      const context = await this.coachService.prepareContext(
        user.id,
        dto.conversationId,
        dto.message,
        dto.analysisContext,
        locale,
      );
      conversationId = context.conversationId;

      // 2. 调用 LLM 流式接口（AsyncIterable）
      const stream = this.coachService.createChatStream(
        user.id,
        context.messages,
      );

      let tokensUsed = 0;

      for await (const chunk of stream) {
        if (chunk.delta) {
          fullText += chunk.delta;
          res.write(
            `data: ${JSON.stringify({ delta: chunk.delta, conversationId })}\n\n`,
          );
        }
        if (chunk.usage?.totalTokens) {
          tokensUsed = chunk.usage.totalTokens;
        }
        if (chunk.done) {
          await this.coachService.saveMessage(
            conversationId,
            user.id,
            dto.message,
            fullText,
            tokensUsed,
          );
          res.write(
            `data: ${JSON.stringify({ done: true, conversationId })}\n\n`,
          );
          res.end();
          return;
        }
      }

      // 流正常结束但没有收到 done 标志（防御性）
      if (fullText) {
        await this.coachService.saveMessage(
          conversationId,
          user.id,
          dto.message,
          fullText,
          tokensUsed,
        );
        res.write(
          `data: ${JSON.stringify({ done: true, conversationId })}\n\n`,
        );
      }
      res.end();
    } catch (error) {
      const err = error as Error;
      const errName = err.constructor?.name;
      let userMsg = this.i18n.t('coach.serviceUnavailable');
      if (errName === 'LlmQuotaExceededError') {
        userMsg = this.i18n.t('coach.quotaExceeded') || '今日配额已用完';
      }
      this.logger.error(`Coach chat error: ${err.message}`);
      res.write(`data: ${JSON.stringify({ error: userMsg })}\n\n`);
      res.end();
    }
  }

  /**
   * 获取历史对话列表
   * GET /api/app/coach/conversations
   */
  @Get('conversations')
  @ApiOperation({ summary: '获取教练对话列表' })
  async getConversations(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const data = await this.coachService.getConversations(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('coach.ok'),
      data,
    };
  }

  /**
   * 获取对话消息历史
   * GET /api/app/coach/conversations/:id/messages
   */
  @Get('conversations/:id/messages')
  @ApiOperation({ summary: '获取对话消息历史' })
  async getMessages(
    @CurrentAppUser() user: AppUserPayload,
    @Param('id') id: string,
    @Query() query: CoachMessagesQueryDto,
  ): Promise<ApiResponse> {
    const page = query.page ? parseInt(query.page, 10) : 1;
    const limit = query.limit ? parseInt(query.limit, 10) : 50;
    const data = await this.coachService.getMessages(id, user.id, page, limit);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('coach.ok'),
      data,
    };
  }

  /**
   * 删除对话
   * DELETE /api/app/coach/conversations/:id
   */
  @Delete('conversations/:id')
  @ApiOperation({ summary: '删除教练对话' })
  async deleteConversation(
    @CurrentAppUser() user: AppUserPayload,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    await this.coachService.deleteConversation(id, user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('coach.deletedOk'),
      data: null,
    };
  }

  /**
   * 获取每日开场建议
   * GET /api/app/coach/daily-greeting
   */
  @Get('daily-greeting')
  @ApiOperation({ summary: '获取每日教练问候' })
  async getDailyGreeting(
    @CurrentAppUser() user: AppUserPayload,
    @Query('locale') locale?: string,
  ): Promise<ApiResponse> {
    const data = await this.coachService.getDailyGreeting(
      user.id,
      (locale as Locale | undefined) || undefined,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('coach.ok'),
      data,
    };
  }

  // ==================== V5: 教练风格 ====================

  /**
   * 切换教练风格
   * PUT /api/app/coach/style
   */
  @Put('style')
  @RequireFeature(GatedFeature.COACH_STYLE)
  @ApiOperation({ summary: '切换教练风格' })
  async updateCoachStyle(
    @CurrentAppUser() user: AppUserPayload,
    @Body() body: { style: 'strict' | 'friendly' | 'data' },
  ): Promise<ApiResponse> {
    const profile = await this.behaviorService.updateCoachStyle(
      user.id,
      body.style,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('coach.coachStyleUpdated'),
      data: { coachStyle: profile.coachStyle },
    };
  }
}
