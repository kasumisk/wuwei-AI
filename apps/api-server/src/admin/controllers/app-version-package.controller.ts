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
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { AppVersionPackageService } from '../services/app-version-package.service';
import {
  CreateAppVersionPackageDto,
  UpdateAppVersionPackageDto,
} from '../dto/app-version-management.dto';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('版本渠道包管理')
@Controller('admin/app-versions/:versionId/packages')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AppVersionPackageController {
  constructor(private readonly packageService: AppVersionPackageService) {}

  /** GET /admin/app-versions/:versionId/packages */
  @Get()
  @ApiOperation({ summary: '获取版本的所有渠道包' })
  async findAll(@Param('versionId') versionId: string): Promise<ApiResponse> {
    const data = await this.packageService.findByVersion(versionId);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取渠道包列表成功',
      data,
    };
  }

  /** GET /admin/app-versions/store-defaults */
  @Get('store-defaults')
  @ApiOperation({ summary: '获取商店渠道默认URL配置' })
  getStoreDefaults(): ApiResponse {
    const data = this.packageService.getStoreDefaults();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取默认配置成功',
      data,
    };
  }

  /** POST /admin/app-versions/:versionId/packages */
  @Post()
  @ApiOperation({ summary: '新增渠道包' })
  async create(
    @Param('versionId') versionId: string,
    @Body() dto: CreateAppVersionPackageDto,
  ): Promise<ApiResponse> {
    const data = await this.packageService.create(versionId, dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '渠道包创建成功',
      data,
    };
  }

  /** PUT /admin/app-versions/:versionId/packages/:id */
  @Put(':id')
  @ApiOperation({ summary: '更新渠道包' })
  async update(
    @Param('versionId') versionId: string,
    @Param('id') id: string,
    @Body() dto: UpdateAppVersionPackageDto,
  ): Promise<ApiResponse> {
    const data = await this.packageService.update(versionId, id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '渠道包更新成功',
      data,
    };
  }

  /** PATCH /admin/app-versions/:versionId/packages/:id/toggle */
  @Patch(':id/toggle')
  @ApiOperation({ summary: '切换渠道包启用状态' })
  async toggleEnabled(
    @Param('versionId') versionId: string,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    const data = await this.packageService.toggleEnabled(versionId, id);
    return { success: true, code: HttpStatus.OK, message: '状态已切换', data };
  }

  /** DELETE /admin/app-versions/:versionId/packages/:id */
  @Delete(':id')
  @ApiOperation({ summary: '删除渠道包' })
  async remove(
    @Param('versionId') versionId: string,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    const data = await this.packageService.remove(versionId, id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '渠道包删除成功',
      data,
    };
  }
}
