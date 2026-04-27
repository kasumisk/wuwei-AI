import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Patch,
  Body,
  Param,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { I18n, I18nContext } from '../../../core/i18n/i18n.decorator';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { AppVersionPackageService } from './app-version-package.service';
import {
  CreateAppVersionPackageDto,
  UpdateAppVersionPackageDto,
} from './dto/app-version-management.dto';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('版本渠道包管理')
@Controller('admin/app-versions/:versionId/packages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AppVersionPackageController {
  constructor(private readonly packageService: AppVersionPackageService) {}

  @Get()
  @ApiOperation({ summary: '获取版本的所有渠道包' })
  async findAll(
    @Param('versionId') versionId: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.packageService.findByVersion(versionId);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersionPackage.fetchSuccess'),
      data,
    };
  }

  @Get('store-defaults')
  @ApiOperation({ summary: '获取商店渠道默认URL配置' })
  getStoreDefaults(@I18n() i18n: I18nContext): ApiResponse {
    const data = this.packageService.getStoreDefaults();
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersionPackage.storeDefaultsSuccess'),
      data,
    };
  }

  @Post()
  @ApiOperation({ summary: '新增渠道包' })
  async create(
    @Param('versionId') versionId: string,
    @Body() dto: CreateAppVersionPackageDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.packageService.create(versionId, dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: i18n.t('appVersion.appVersionPackage.createSuccess'),
      data,
    };
  }

  @Put(':id')
  @ApiOperation({ summary: '更新渠道包' })
  async update(
    @Param('versionId') versionId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAppVersionPackageDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.packageService.update(versionId, id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersionPackage.updateSuccess'),
      data,
    };
  }

  @Patch(':id/toggle')
  @ApiOperation({ summary: '切换渠道包启用状态' })
  async toggleEnabled(
    @Param('versionId') versionId: string,
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.packageService.toggleEnabled(versionId, id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersionPackage.toggleSuccess'),
      data,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除渠道包' })
  async remove(
    @Param('versionId') versionId: string,
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.packageService.remove(versionId, id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('appVersion.appVersionPackage.deleteSuccess'),
      data,
    };
  }
}
