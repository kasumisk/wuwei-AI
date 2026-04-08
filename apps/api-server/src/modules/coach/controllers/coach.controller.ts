import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/guards/app-jwt-auth.guard';
import { CurrentUser } from '../../../infrastructure/common/decorators/current-user.decorator';
import { CoachService } from '../services/coach.service';

@ApiTags('Coach')
@ApiBearerAuth('app-jwt')
@UseGuards(AppJwtAuthGuard)
@Controller('api/app/coach')
export class CoachController {
  constructor(private readonly coachService: CoachService) {}

  @Get('conversations')
  @ApiOperation({ summary: '获取会话列表' })
  getConversations(@CurrentUser('id') userId: string) {
    return this.coachService.getConversations(userId);
  }

  @Get('conversations/:id')
  @ApiOperation({ summary: '获取会话详情' })
  getConversation(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.coachService.getConversation(userId, id);
  }

  @Post('conversations')
  @ApiOperation({ summary: '创建会话' })
  createConversation(
    @CurrentUser('id') userId: string,
    @Body() body: { title?: string },
  ) {
    return this.coachService.createConversation(userId, body.title);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: '发送消息' })
  sendMessage(
    @CurrentUser('id') userId: string,
    @Param('id') conversationId: string,
    @Body() body: { content: string },
  ) {
    return this.coachService.sendMessage(userId, conversationId, body.content);
  }
}
