import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../auth/app/app-user-payload.type';
import {
  RegisterPushTokenDto,
  TestPushDto,
  UnregisterPushTokenDto,
  UpdatePushPreferencesDto,
} from './dto/push.dto';
import { PushService } from './push.service';
import { PushNotificationType } from './push.types';

@ApiTags('App Push')
@Controller('push')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Post('register-token')
  registerToken(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: RegisterPushTokenDto,
  ) {
    return this.pushService.registerToken(user.id, dto);
  }

  @Post('unregister-token')
  unregisterToken(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: UnregisterPushTokenDto,
  ) {
    return this.pushService.unregisterToken(user.id, dto);
  }

  @Get('preferences')
  getPreferences(@CurrentAppUser() user: AppUserPayload) {
    return this.pushService.getPreferences(user.id);
  }

  @Patch('preferences')
  updatePreferences(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: UpdatePushPreferencesDto,
  ) {
    return this.pushService.updatePreferences(user.id, dto);
  }

  @Post('test')
  test(@CurrentAppUser() user: AppUserPayload, @Body() dto: TestPushDto) {
    return this.pushService.send({
      userId: user.id,
      type: dto.type ?? PushNotificationType.DAILY_CHECK_IN,
      payload: { target: 'home', ...dto.payload },
      force: true,
    });
  }
}
