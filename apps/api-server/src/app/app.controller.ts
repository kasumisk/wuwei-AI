import {
  Controller,
  Post,
  Get,
  Put,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppAuthService } from './services/app-auth.service';
import {
  FirebaseLoginDto,
  AnonymousLoginDto,
  GoogleLoginDto,
  EmailRegisterDto,
  EmailLoginDto,
  EmailCodeLoginDto,
  SendEmailCodeDto,
  ResetPasswordDto,
  UpdateAppUserProfileDto,
  UpgradeAnonymousDto,
} from './dto/auth.dto';
import { Public } from '../core/decorators/public.decorator';
import { AppJwtAuthGuard } from './guards/app-jwt-auth.guard';
import { CurrentAppUser } from './decorators/current-app-user.decorator';
import { ApiResponse } from '../common/types/response.type';

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

  /**
   * Firebase 登录（Google / Email via Firebase）
   * POST /api/app/auth/firebase
   */
  @Public()
  @Post('firebase')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Firebase 登录' })
  async loginWithFirebase(@Body() dto: FirebaseLoginDto): Promise<ApiResponse> {
    const data = await this.appAuthService.loginWithFirebase(dto.firebaseToken);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '登录成功',
      data,
    };
  }

  /**
   * Google 授权登录
   * POST /api/app/auth/google
   */
  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Google 授权登录' })
  async googleLogin(@Body() dto: GoogleLoginDto): Promise<ApiResponse> {
    const data = await this.appAuthService.googleLogin(dto.idToken);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '登录成功',
      data,
    };
  }

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
      data: null,
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
      data: null,
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
  async getProfile(@CurrentAppUser() user: any): Promise<ApiResponse> {
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
    @CurrentAppUser() user: any,
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
    @CurrentAppUser() user: any,
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
  async refreshToken(@CurrentAppUser() user: any): Promise<ApiResponse> {
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
