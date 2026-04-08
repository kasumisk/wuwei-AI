import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '../../../infrastructure/common/decorators/public.decorator';
import { CurrentUser } from '../../../infrastructure/common/decorators/current-user.decorator';
import { AppJwtAuthGuard } from '../guards/app-jwt-auth.guard';
import { AppAuthService } from '../services/app-auth.service';
import {
  LoginAnonymousDto,
  LoginByPhoneDto,
  LoginByWechatMiniDto,
  LoginByEmailDto,
  RegisterByEmailDto,
} from '../dto/app-auth.dto';

@ApiTags('App Auth')
@Controller('api/app/auth')
export class AppAuthController {
  constructor(private readonly appAuthService: AppAuthService) {}

  @Public()
  @Post('anonymous')
  @ApiOperation({ summary: '匿名登录' })
  loginAnonymous(@Body() dto: LoginAnonymousDto) {
    return this.appAuthService.loginAnonymous(dto);
  }

  @Public()
  @Post('phone')
  @ApiOperation({ summary: '手机号登录' })
  loginByPhone(@Body() dto: LoginByPhoneDto) {
    return this.appAuthService.loginByPhone(dto);
  }

  @Public()
  @Post('wechat-mini')
  @ApiOperation({ summary: '微信小程序登录' })
  loginByWechatMini(@Body() dto: LoginByWechatMiniDto) {
    return this.appAuthService.loginByWechatMini(dto);
  }

  @Public()
  @Post('email/login')
  @ApiOperation({ summary: '邮箱登录' })
  loginByEmail(@Body() dto: LoginByEmailDto) {
    return this.appAuthService.loginByEmail(dto);
  }

  @Public()
  @Post('email/register')
  @ApiOperation({ summary: '邮箱注册' })
  registerByEmail(@Body() dto: RegisterByEmailDto) {
    return this.appAuthService.registerByEmail(dto);
  }

  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth('app-jwt')
  @Get('profile')
  @ApiOperation({ summary: '获取用户信息' })
  getProfile(@CurrentUser('id') userId: string) {
    return this.appAuthService.getProfile(userId);
  }
}
