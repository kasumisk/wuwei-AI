import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../../core/decorators/public.decorator';
import { AppUpdateService } from './app-update.service';
import {
  CheckUpdateDto,
  GetLatestVersionQueryDto,
  GetVersionHistoryQueryDto,
} from './dto/update.dto';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('App 版本更新')
@Controller('app/update')
export class AppUpdateController {
  constructor(private readonly appUpdateService: AppUpdateService) {}

  /**
   * 检查 App 更新
   * POST /api/app/update/check
   */
  @Public()
  @Post('check')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '检查 App 更新' })
  async checkUpdate(@Body() checkDto: CheckUpdateDto): Promise<ApiResponse> {
    const data = await this.appUpdateService.checkUpdate(checkDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.needUpdate ? '发现新版本' : '已是最新版本',
      data,
    };
  }

  /**
   * 获取最新版本信息
   * GET /api/app/update/latest?platform=android&channel=official&language=zh-CN
   */
  @Public()
  @Get('latest')
  @ApiOperation({ summary: '获取最新版本信息' })
  async getLatestVersion(
    @Query() query: GetLatestVersionQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.appUpdateService.getLatestVersion(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取最新版本信息成功',
      data,
    };
  }

  /**
   * 获取版本更新历史
   * GET /api/app/update/history?platform=android&page=1&pageSize=10&language=zh-CN
   */
  @Public()
  @Get('history')
  @ApiOperation({ summary: '获取版本更新历史' })
  async getVersionHistory(
    @Query() query: GetVersionHistoryQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.appUpdateService.getVersionHistory(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取版本历史成功',
      data,
    };
  }
}
