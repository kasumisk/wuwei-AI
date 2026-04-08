import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AdminJwtAuthGuard } from '../../auth/guards/admin-jwt-auth.guard';
import { AppVersionService } from '../services/app-version.service';
import { AppPlatform, AppVersionStatus } from '../entities/app-version.entity';
import { Public } from '../../../infrastructure/common/decorators/public.decorator';

@ApiTags('Admin - App Version')
@Controller('api/admin/app-versions')
export class AppVersionController {
  constructor(private readonly versionService: AppVersionService) {}

  @Get()
  @ApiBearerAuth('admin-jwt')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '版本列表' })
  findAll(
    @Query('platform') platform?: AppPlatform,
    @Query('status') status?: AppVersionStatus,
    @Query('keyword') keyword?: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ) {
    return this.versionService.findAll({ platform, status, keyword, page, pageSize });
  }

  @Get(':id')
  @ApiBearerAuth('admin-jwt')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '版本详情' })
  findOne(@Param('id') id: string) {
    return this.versionService.findOne(id);
  }

  @Post()
  @ApiBearerAuth('admin-jwt')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '创建版本' })
  create(@Body() body: any) {
    return this.versionService.create(body);
  }

  @Put(':id')
  @ApiBearerAuth('admin-jwt')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '更新版本' })
  update(@Param('id') id: string, @Body() body: any) {
    return this.versionService.update(id, body);
  }

  @Delete(':id')
  @ApiBearerAuth('admin-jwt')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '删除版本' })
  remove(@Param('id') id: string) {
    return this.versionService.remove(id);
  }

  @Post(':id/publish')
  @ApiBearerAuth('admin-jwt')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '发布版本' })
  publish(@Param('id') id: string) {
    return this.versionService.publish(id);
  }

  @Post(':id/archive')
  @ApiBearerAuth('admin-jwt')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '归档版本' })
  archive(@Param('id') id: string) {
    return this.versionService.archive(id);
  }

  @Get('check-update')
  @Public()
  @ApiOperation({ summary: '客户端检查更新' })
  checkUpdate(
    @Query('platform') platform: AppPlatform,
    @Query('versionCode') versionCode: number,
    @Query('deviceId') deviceId?: string,
  ) {
    return this.versionService.checkUpdate(platform, versionCode, deviceId);
  }

  // ===== Package endpoints =====

  @Get(':versionId/packages')
  @ApiBearerAuth('admin-jwt')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '获取版本渠道包' })
  getPackages(@Param('versionId') versionId: string) {
    return this.versionService.findPackagesByVersion(versionId);
  }

  @Post(':versionId/packages')
  @ApiBearerAuth('admin-jwt')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '创建渠道包' })
  createPackage(@Param('versionId') versionId: string, @Body() body: any) {
    return this.versionService.createPackage(versionId, body);
  }

  @Put('packages/:id')
  @ApiBearerAuth('admin-jwt')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '更新渠道包' })
  updatePackage(@Param('id') id: string, @Body() body: any) {
    return this.versionService.updatePackage(id, body);
  }

  @Delete('packages/:id')
  @ApiBearerAuth('admin-jwt')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: '删除渠道包' })
  removePackage(@Param('id') id: string) {
    return this.versionService.removePackage(id);
  }
}
