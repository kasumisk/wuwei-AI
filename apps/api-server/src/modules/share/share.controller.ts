import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ResponseWrapper } from '../../common/types/response.type';
import { Public } from '../../core/decorators/public.decorator';
import { UserApiThrottle } from '../../core/throttle/throttle.constants';
import { AppJwtAuthGuard } from '../auth/app/app-jwt-auth.guard';
import { AppUserPayload } from '../auth/app/app-user-payload.type';
import { CurrentAppUser } from '../auth/app/current-app-user.decorator';
import { CreateShareDto } from './dto/create-share.dto';
import { ShareService } from './share.service';

@ApiTags('Growth Sharing')
@Controller('app/shares')
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Post()
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @UserApiThrottle(20, 60)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a public AI result share from a snapshot' })
  async createShare(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: CreateShareDto,
  ) {
    const data = await this.shareService.createForUser(user.id, dto);
    return ResponseWrapper.success(data, 'Share created');
  }

  @Public()
  @Get(':token')
  @UserApiThrottle(120, 60)
  @ApiOperation({ summary: 'Read public share snapshot' })
  async getShare(@Param('token') token: string) {
    const data = await this.shareService.getPublicShare(token);
    return ResponseWrapper.success(data);
  }

  @Public()
  @Post(':token/view')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UserApiThrottle(120, 60)
  @ApiOperation({ summary: 'Track share page view' })
  async trackView(@Param('token') token: string) {
    await this.shareService.trackView(token);
  }

  @Public()
  @Post(':token/cta')
  @UserApiThrottle(60, 60)
  @ApiOperation({ summary: 'Track share CTA click' })
  async trackCta(@Param('token') token: string) {
    const data = await this.shareService.trackCta(token);
    return ResponseWrapper.success(data);
  }
}
