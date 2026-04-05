import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { AppUserManagementService } from '../services/app-user-management.service';
import {
  GetAppUsersQueryDto,
  UpdateAppUserByAdminDto,
} from '../dto/app-user-management.dto';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('管理后台 - App 用户管理')
@Controller('admin/app-users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class AppUserManagementController {
  constructor(
    private readonly appUserManagementService: AppUserManagementService,
  ) {}

  /**
   * 获取 App 用户列表
   */
  @Get()
  @ApiOperation({ summary: '获取 App 用户列表' })
  async findAll(@Query() query: GetAppUsersQueryDto): Promise<ApiResponse> {
    const data = await this.appUserManagementService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取 App 用户列表成功',
      data,
    };
  }

  /**
   * 获取 App 用户统计
   */
  @Get('statistics')
  @ApiOperation({ summary: '获取 App 用户统计' })
  async getStatistics(): Promise<ApiResponse> {
    const data = await this.appUserManagementService.getStatistics();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取统计成功',
      data,
    };
  }

  /**
   * 获取 App 用户详情
   */
  @Get(':id')
  @ApiOperation({ summary: '获取 App 用户详情' })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.appUserManagementService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取 App 用户详情成功',
      data,
    };
  }

  /**
   * 更新 App 用户信息
   */
  @Put(':id')
  @ApiOperation({ summary: '更新 App 用户信息' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAppUserByAdminDto,
  ): Promise<ApiResponse> {
    const data = await this.appUserManagementService.update(id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '更新成功',
      data,
    };
  }

  /**
   * 封禁 App 用户
   */
  @Post(':id/ban')
  @ApiOperation({ summary: '封禁 App 用户' })
  async ban(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.appUserManagementService.ban(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data,
    };
  }

  /**
   * 解封 App 用户
   */
  @Post(':id/unban')
  @ApiOperation({ summary: '解封 App 用户' })
  async unban(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.appUserManagementService.unban(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data,
    };
  }

  /**
   * 删除 App 用户
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除 App 用户' })
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.appUserManagementService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data,
    };
  }
}
