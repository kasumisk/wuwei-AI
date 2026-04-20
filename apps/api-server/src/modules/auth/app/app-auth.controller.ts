import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppAuthService } from './app-auth.service';
import {
  AnonymousLoginDto,
  EmailRegisterDto,
  EmailLoginDto,
  EmailCodeLoginDto,
  SendEmailCodeDto,
  ResetPasswordDto,
  UpdateAppUserProfileDto,
  UpgradeAnonymousDto,
  PhoneSendCodeDto,
  PhoneVerifyDto,
  WechatCodeLoginDto,
  WechatAuthUrlDto,
  WechatMiniLoginDto,
} from './dto/auth.dto';
import { Public } from '../../../core/decorators/public.decorator';
import { IgnoreResponseInterceptor } from '../../../core/decorators/ignore-response-interceptor.decorator';
import { AppJwtAuthGuard } from './app-jwt-auth.guard';
import { CurrentAppUser } from './current-app-user.decorator';
import { AppUserPayload } from './app-user-payload.type';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('App 用户认证')
@Controller('app/auth')
export class AppAuthController {
  constructor(private readonly appAuthService: AppAuthService) {}

  // ==================== 公开接口（无需认证） ====================

  /**
   * 匿名登录
   * POST /api/app/auth/anonymous
   */
  @Public()
  @Post('anonymous')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '匿名登录' })
  async anonymousLogin(@Body() dto: AnonymousLoginDto): Promise<ApiResponse> {
    const data = await this.appAuthService.anonymousLogin(dto.deviceId);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '登录成功',
      data,
    };
  }

  // ==================== 手机号登录 ====================

  /**
   * 发送短信验证码
   * POST /api/app/auth/phone/send-code
   */
  @Public()
  @Post('phone/send-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送短信验证码（开发模式：万能验证码 888888）' })
  async sendPhoneCode(@Body() dto: PhoneSendCodeDto): Promise<ApiResponse> {
    const data = await this.appAuthService.sendPhoneCode(dto.phone);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data: null,
    };
  }

  /**
   * 手机号验证码登录/注册
   * POST /api/app/auth/phone/verify
   */
  @Public()
  @Post('phone/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '手机号验证码登录（新用户自动注册）' })
  async phoneLogin(@Body() dto: PhoneVerifyDto): Promise<ApiResponse> {
    const data = await this.appAuthService.phoneLogin(dto.phone, dto.code);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '登录成功',
      data,
    };
  }

  // ==================== 微信扫码登录 ====================

  /**
   * 获取微信授权 URL（给前端跳转用）
   * POST /api/app/auth/wechat/auth-url
   */
  @Public()
  @Post('wechat/auth-url')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '获取微信网页授权 URL' })
  getWechatAuthUrl(@Body() dto: WechatAuthUrlDto): ApiResponse {
    const url = this.appAuthService.getWechatAuthUrl(
      dto.redirectUri,
      dto.state,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: { url },
    };
  }

  /**
   * 微信授权回调登录（前端把 code 提交过来）
   * POST /api/app/auth/wechat/login
   */
  @Public()
  @Post('wechat/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信授权码登录' })
  async wechatLogin(@Body() dto: WechatCodeLoginDto): Promise<ApiResponse> {
    const data = await this.appAuthService.wechatLogin(dto.code);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '登录成功',
      data,
    };
  }

  /**
   * 微信小程序登录（wx.login 获取 code）
   * POST /api/app/auth/wechat/mini-login
   */
  @Public()
  @Post('wechat/mini-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '微信小程序登录' })
  async wechatMiniLogin(@Body() dto: WechatMiniLoginDto): Promise<ApiResponse> {
    const data = await this.appAuthService.wechatMiniLogin(dto.code);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '登录成功',
      data,
    };
  }

  /**
   * 微信网页授权回调接口
   * GET /api/app/auth/wechat/callback?code=xxx&state=xxx
   * 微信授权后回调到此地址，换取 token 后重定向回前端
   */
  @Public()
  @IgnoreResponseInterceptor()
  @Get('wechat/callback')
  @ApiOperation({ summary: '微信网页授权回调' })
  async wechatCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ): Promise<void> {
    const frontendUrl =
      process.env.WECHAT_FRONTEND_URL || 'https://uway.dev-net.uk';

    if (!code) {
      res.redirect(`${frontendUrl}/login?error=wechat_no_code`);
      return;
    }

    try {
      const data = await this.appAuthService.wechatLogin(code);
      // 带 token 重定向回前端登录页，前端读取后存储
      const redirectUrl = `${frontendUrl}/login?wechat_token=${data.token}&wechat_state=${state || ''}`;
      res.redirect(redirectUrl);
    } catch (err) {
      const msg =
        err instanceof Error ? encodeURIComponent(err.message) : 'wechat_error';
      res.redirect(`${frontendUrl}/login?error=${msg}`);
    }
  }

  /**
   * 微信验签接口（微信测试号配置 URL 验证用）
   * GET /api/app/auth/wechat/verify
   * 必须返回纯文本 echostr，不能走全局响应拦截器
   */
  @Public()
  @IgnoreResponseInterceptor()
  @Get('wechat/verify')
  @ApiOperation({ summary: '微信服务器验签（测试号配置用）' })
  wechatVerify(
    @Query('signature') signature: string,
    @Query('timestamp') timestamp: string,
    @Query('nonce') nonce: string,
    @Query('echostr') echostr: string,
    @Res() res: Response,
  ): void {
    const valid = this.appAuthService.verifyWechatSignature(
      signature,
      timestamp,
      nonce,
    );
    (res as any).set('Content-Type', 'text/plain');
    (res as any).send(valid ? echostr : 'fail');
  }

  // ==================== 邮箱登录 ====================

  /**
   * 邮箱密码注册
   * POST /api/app/auth/email/register
   */
  @Public()
  @Post('email/register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '邮箱注册' })
  async emailRegister(@Body() dto: EmailRegisterDto): Promise<ApiResponse> {
    const data = await this.appAuthService.emailRegister(
      dto.email,
      dto.password,
      dto.nickname,
    );
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '注册成功',
      data,
    };
  }

  /**
   * 邮箱密码登录
   * POST /api/app/auth/email/login
   */
  @Public()
  @Post('email/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '邮箱密码登录' })
  async emailLogin(@Body() dto: EmailLoginDto): Promise<ApiResponse> {
    const data = await this.appAuthService.emailLogin(dto.email, dto.password);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '登录成功',
      data,
    };
  }

  /**
   * 邮箱验证码登录
   * POST /api/app/auth/email/code-login
   */
  @Public()
  @Post('email/code-login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '邮箱验证码登录' })
  async emailCodeLogin(@Body() dto: EmailCodeLoginDto): Promise<ApiResponse> {
    const data = await this.appAuthService.emailCodeLogin(dto.email, dto.code);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '登录成功',
      data,
    };
  }

  /**
   * 发送邮箱验证码
   * POST /api/app/auth/email/send-code
   */
  @Public()
  @Post('email/send-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送邮箱验证码' })
  sendEmailCode(@Body() dto: SendEmailCodeDto): ApiResponse {
    const data = this.appAuthService.generateEmailCode(dto.email, dto.type);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data: { message: data.message },
    };
  }

  /**
   * 重置密码
   * POST /api/app/auth/email/reset-password
   */
  @Public()
  @Post('email/reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重置密码' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<ApiResponse> {
    const data = await this.appAuthService.resetPassword(
      dto.email,
      dto.code,
      dto.newPassword,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data: { message: data.message },
    };
  }

  // ==================== 需要认证的接口 ====================

  /**
   * 获取当前用户信息
   * GET /api/app/auth/profile
   */
  @Get('profile')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户信息' })
  async getProfile(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const data = await this.appAuthService.getUserInfo(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取用户信息成功',
      data,
    };
  }

  /**
   * 更新用户资料
   * PUT /api/app/auth/profile
   */
  @Put('profile')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新用户资料' })
  async updateProfile(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: UpdateAppUserProfileDto,
  ): Promise<ApiResponse> {
    const data = await this.appAuthService.updateProfile(user.id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '更新用户资料成功',
      data,
    };
  }

  /**
   * 匿名用户升级（绑定邮箱+密码）
   * POST /api/app/auth/upgrade
   */
  @Post('upgrade')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '匿名用户升级（绑定邮箱）' })
  async upgradeAnonymous(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: UpgradeAnonymousDto,
  ): Promise<ApiResponse> {
    const data = await this.appAuthService.upgradeAnonymous(
      user.id,
      dto.email,
      dto.password,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '账号升级成功',
      data,
    };
  }

  /**
   * 刷新 Token
   * POST /api/app/auth/refresh
   */
  @Post('refresh')
  @UseGuards(AppJwtAuthGuard)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '刷新 Token' })
  async refreshToken(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const data = await this.appAuthService.refreshToken(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '刷新 Token 成功',
      data,
    };
  }

  /**
   * 退出登录
   * POST /api/app/auth/logout
   */
  @Post('logout')
  @UseGuards(AppJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '退出登录' })
  logout(): ApiResponse {
    return {
      success: true,
      code: HttpStatus.OK,
      message: '退出成功',
      data: null,
    };
  }
}
