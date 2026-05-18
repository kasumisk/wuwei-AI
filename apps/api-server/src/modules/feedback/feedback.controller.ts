import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../auth/app/app-user-payload.type';
import { ApiResponse } from '../../common/types/response.type';
import { CreateAppFeedbackDto } from './dto/feedback.dto';
import { FeedbackService } from './feedback.service';

@ApiTags('App Feedback')
@Controller('app/feedback')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '提交 App 用户反馈' })
  async create(
    @CurrentAppUser() user: AppUserPayload,
    @Body(new ValidationPipe({ transform: true, whitelist: true }))
    dto: CreateAppFeedbackDto,
  ): Promise<ApiResponse> {
    const feedback = await this.feedbackService.create(user.id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: 'Feedback submitted',
      data: feedback,
    };
  }
}
