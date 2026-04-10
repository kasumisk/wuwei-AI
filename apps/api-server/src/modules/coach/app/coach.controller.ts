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
import { BehaviorService } from '../../diet/app/behavior.service';
import { CoachChatDto, CoachMessagesQueryDto } from './dto/coach.dto';

@ApiTags('App AI 教练')
@Controller('app/coach')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class CoachController {
  private readonly logger = new Logger(CoachController.name);

  constructor(
    private readonly coachService: CoachService,
    private readonly behaviorService: BehaviorService,
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
      const context = await this.coachService.prepareContext(
        user.id,
        dto.conversationId,
        dto.message,
      );
      conversationId = context.conversationId;

      // 2. 调用 OpenRouter 流式接口
      const streamResponse = await this.coachService.createChatStream(
        context.messages,
      );

      // 3. 解析 SSE 流
      const reader = streamResponse.body as any;
      // Node.js 的 fetch 返回 ReadableStream
      if (!reader) {
        throw new Error('No response body');
      }

      let buffer = '';
      let tokensUsed = 0;

      // 使用 async iteration over the readable stream
      for await (const chunk of reader) {
        const text =
          typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
        buffer += text;

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.trim() === 'data: [DONE]') {
            // 保存消息
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

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const delta = data.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                res.write(
                  `data: ${JSON.stringify({ delta, conversationId })}\n\n`,
                );
              }
              if (data.usage) {
                tokensUsed = data.usage.total_tokens || 0;
              }
            } catch {
              // 忽略无法解析的行
            }
          }
        }
      }

      // 流正常结束但没有 [DONE]
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
      this.logger.error(`Coach chat error: ${(error as Error).message}`);
      res.write(
        `data: ${JSON.stringify({ error: '服务暂时不可用，请稍后重试' })}\n\n`,
      );
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
      message: '获取成功',
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
      message: '获取成功',
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
      message: '删除成功',
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
  ): Promise<ApiResponse> {
    const data = await this.coachService.getDailyGreeting(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  // ==================== V5: 教练风格 ====================

  /**
   * 切换教练风格
   * PUT /api/app/coach/style
   */
  @Put('style')
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
      message: '教练风格已更新',
      data: { coachStyle: profile.coachStyle },
    };
  }
}
