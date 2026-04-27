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
import { AdminService } from './admin-auth.service';
import {
  LoginDto,
  LoginByPhoneDto,
  LoginByTokenDto,
  RegisterDto,
  SendCodeDto,
  UpdateProfileDto,
} from './dto/auth.dto';
import { Public } from '../../../core/decorators/public.decorator';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from './current-user.decorator';
import { LoginResponseDto } from '@ai-platform/shared';
import { I18n, I18nContext } from '../../../core/i18n';

@ApiTags('管理员认证')
@Controller('auth')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /**
   * 用户名密码登录
   */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '用户名密码登录' })
  async login(@Body() loginDto: LoginDto): Promise<LoginResponseDto> {
    return this.adminService.login(loginDto);
  }

  /**
   * 手机验证码登录
   */
  @Public()
  @Post('login/phone')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '手机验证码登录' })
  async loginByPhone(@Body() loginByPhoneDto: LoginByPhoneDto) {
    return this.adminService.loginByPhone(loginByPhoneDto);
  }

  /**
   * Token 登录
   */
  @Public()
  @Post('login_by_token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Token 登录' })
  async loginByToken(@Body() loginByTokenDto: LoginByTokenDto) {
    return this.adminService.loginByToken(loginByTokenDto.token);
  }

  /**
   * 用户注册
   */
  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '用户注册' })
  async register(@Body() registerDto: RegisterDto) {
    return this.adminService.register(registerDto);
  }

  /**
   * 发送验证码
   */
  @Public()
  @Post('send_code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '发送验证码' })
  async sendCode(@Body() sendCodeDto: SendCodeDto, @I18n() i18n: I18nContext) {
    const { phone, email, type } = sendCodeDto;
    const target = phone || email;

    if (!target) {
      return { message: i18n.t('auth.providePhoneOrEmail') };
    }

    return this.adminService.sendCode(target, type);
  }

  /**
   * 获取当前用户信息
   */
  @Get('info')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '获取当前用户信息' })
  async getUserInfo(@CurrentUser() user: any) {
    return this.adminService.getUserInfo(user.id);
  }

  /**
   * 更新用户资料
   */
  @Put('profile')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: '更新用户资料' })
  async updateProfile(
    @CurrentUser() user: any,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    return this.adminService.updateProfile(user.id, updateProfileDto);
  }

  /**
   * 退出登录
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '退出登录' })
  logout(@I18n() i18n: I18nContext) {
    // JWT 是无状态的,前端删除 token 即可
    return { message: i18n.t('auth.logoutSuccess') };
  }
}
