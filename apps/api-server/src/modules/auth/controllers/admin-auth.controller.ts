import { Controller, Post, Body, Get, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { Public } from '../../../infrastructure/common/decorators/public.decorator';
import { CurrentUser } from '../../../infrastructure/common/decorators/current-user.decorator';
import { AdminJwtAuthGuard } from '../guards/admin-jwt-auth.guard';
import { AdminAuthService } from '../services/admin-auth.service';
import { AdminLoginDto } from '../dto/admin-auth.dto';

@ApiTags('Admin Auth')
@Controller('api/admin/auth')
export class AdminAuthController {
  constructor(private readonly adminAuthService: AdminAuthService) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: '管理员登录' })
  login(@Body() dto: AdminLoginDto) {
    return this.adminAuthService.login(dto);
  }

  @UseGuards(AdminJwtAuthGuard)
  @ApiBearerAuth('admin-jwt')
  @Get('profile')
  @ApiOperation({ summary: '获取管理员信息' })
  getProfile(@CurrentUser('id') userId: string) {
    return this.adminAuthService.getProfile(userId);
  }
}
