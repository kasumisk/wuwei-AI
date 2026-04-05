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
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { AppVersionService } from '../services/app-version.service';
import {
  CreateAppVersionDto,
  UpdateAppVersionDto,
  GetAppVersionsQueryDto,
  PublishAppVersionDto,
  AppVersionInfoDto,
  AppVersionsListResponseDto,
} from '../dto/app-version-management.dto';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('版本管理')
@Controller('admin/app-versions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AppVersionController {
  constructor(private readonly appVersionService: AppVersionService) {}

  /**
   * 获取版本列表
   * GET /api/admin/app-versions
   */
  @Get()
  @ApiOperation({ summary: '获取版本列表' })
  @SwaggerResponse({ status: 200, type: AppVersionsListResponseDto })
  async findAll(@Query() query: GetAppVersionsQueryDto): Promise<ApiResponse> {
    const data = await this.appVersionService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取版本列表成功',
      data,
    };
  }

  /**
   * 获取版本详情
   * GET /api/admin/app-versions/:id
   */
  @Get('stats')
  @ApiOperation({ summary: '获取版本统计信息' })
  async getStats(): Promise<ApiResponse> {
    const data = await this.appVersionService.getStats();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取版本统计成功',
      data,
    };
  }

  /**
   * 获取版本详情
   * GET /api/admin/app-versions/:id
   */
  @Get(':id')
  @ApiOperation({ summary: '获取版本详情' })
  @SwaggerResponse({ status: 200, type: AppVersionInfoDto })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.appVersionService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取版本详情成功',
      data,
    };
  }

  /**
   * 创建版本
   * POST /api/admin/app-versions
   */
  @Post()
  @ApiOperation({ summary: '创建版本' })
  @SwaggerResponse({ status: 201, type: AppVersionInfoDto })
  async create(@Body() createDto: CreateAppVersionDto): Promise<ApiResponse> {
    const data = await this.appVersionService.create(createDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '版本创建成功',
      data,
    };
  }

  /**
   * 更新版本
   * PUT /api/admin/app-versions/:id
   */
  @Put(':id')
  @ApiOperation({ summary: '更新版本' })
  @SwaggerResponse({ status: 200, type: AppVersionInfoDto })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateAppVersionDto,
  ): Promise<ApiResponse> {
    const data = await this.appVersionService.update(id, updateDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '版本更新成功',
      data,
    };
  }

  /**
   * 删除版本
   * DELETE /api/admin/app-versions/:id
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除版本' })
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.appVersionService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '版本删除成功',
      data,
    };
  }

  /**
   * 发布版本
   * POST /api/admin/app-versions/:id/publish
   */
  @Post(':id/publish')
  @ApiOperation({ summary: '发布版本' })
  @SwaggerResponse({ status: 200, type: AppVersionInfoDto })
  async publish(
    @Param('id') id: string,
    @Body() publishDto: PublishAppVersionDto,
  ): Promise<ApiResponse> {
    const data = await this.appVersionService.publish(id, publishDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '版本发布成功',
      data,
    };
  }

  /**
   * 归档版本
   * POST /api/admin/app-versions/:id/archive
   */
  @Post(':id/archive')
  @ApiOperation({ summary: '归档版本' })
  @SwaggerResponse({ status: 200, type: AppVersionInfoDto })
  async archive(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.appVersionService.archive(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '版本归档成功',
      data,
    };
  }
}
