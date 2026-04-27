import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerResponse,
} from '@nestjs/swagger';
import { I18n, I18nContext } from '../../../core/i18n/i18n.decorator';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { AppVersionService } from './app-version.service';
import {
  CreateAppVersionDto,
  UpdateAppVersionDto,
  GetAppVersionsQueryDto,
  PublishAppVersionDto,
  AppVersionInfoDto,
  AppVersionsListResponseDto,
} from './dto/app-version-management.dto';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('版本管理')
@Controller('admin/app-versions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AppVersionController {
  constructor(private readonly appVersionService: AppVersionService) {}

  @Get()
  @ApiOperation({ summary: '获取版本列表' })
  @SwaggerResponse({ status: 200, type: AppVersionsListResponseDto })
  async findAll(
    @Query() query: GetAppVersionsQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appVersionService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersion.fetchListSuccess'),
      data,
    };
  }

  @Get('stats')
  @ApiOperation({ summary: '获取版本统计信息' })
  async getStats(@I18n() i18n: I18nContext): Promise<ApiResponse> {
    const data = await this.appVersionService.getStats();
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersion.fetchStatsSuccess'),
      data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: '获取版本详情' })
  @SwaggerResponse({ status: 200, type: AppVersionInfoDto })
  async findOne(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appVersionService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersion.fetchDetailSuccess'),
      data,
    };
  }

  @Post()
  @ApiOperation({ summary: '创建版本' })
  @SwaggerResponse({ status: 201, type: AppVersionInfoDto })
  async create(
    @Body() createDto: CreateAppVersionDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appVersionService.create(createDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: i18n.t('appVersion.appVersion.createSuccess'),
      data,
    };
  }

  @Put(':id')
  @ApiOperation({ summary: '更新版本' })
  @SwaggerResponse({ status: 200, type: AppVersionInfoDto })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateAppVersionDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appVersionService.update(id, updateDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersion.updateSuccess'),
      data,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除版本' })
  async remove(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appVersionService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersion.deleteSuccess'),
      data,
    };
  }

  @Post(':id/publish')
  @ApiOperation({ summary: '发布版本' })
  @SwaggerResponse({ status: 200, type: AppVersionInfoDto })
  async publish(
    @Param('id') id: string,
    @Body() publishDto: PublishAppVersionDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appVersionService.publish(id, publishDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersion.publishSuccess'),
      data,
    };
  }

  @Post(':id/archive')
  @ApiOperation({ summary: '归档版本' })
  @SwaggerResponse({ status: 200, type: AppVersionInfoDto })
  async archive(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.appVersionService.archive(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersion.archiveSuccess'),
      data,
    };
  }
}
