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
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { PermissionTemplateService } from '../services/permission-template.service';
import type {
  CreatePermissionTemplateDto,
  UpdatePermissionTemplateDto,
  PermissionTemplateQueryDto,
  TemplatePreviewDto,
} from '@ai-platform/shared';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('权限模板管理')
@Controller('admin/permission-templates')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class PermissionTemplateController {
  constructor(private readonly templateService: PermissionTemplateService) {}

  /**
   * 获取权限模板列表
   * GET /api/admin/permission-templates
   */
  @Get()
  @ApiOperation({ summary: '获取权限模板列表' })
  @ApiQuery({ name: 'page', required: false, description: '页码' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页数量' })
  @ApiQuery({ name: 'code', required: false, description: '模板编码' })
  @ApiQuery({ name: 'name', required: false, description: '模板名称' })
  async findAll(
    @Query() query: PermissionTemplateQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.templateService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取模板列表成功',
      data,
    };
  }

  /**
   * 获取权限模板详情
   * GET /api/admin/permission-templates/:id
   */
  @Get(':id')
  @ApiOperation({ summary: '获取权限模板详情' })
  @ApiParam({ name: 'id', description: '模板ID' })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.templateService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取模板详情成功',
      data,
    };
  }

  /**
   * 创建权限模板
   * POST /api/admin/permission-templates
   */
  @Post()
  @ApiOperation({ summary: '创建权限模板' })
  async create(
    @Body() createDto: CreatePermissionTemplateDto,
  ): Promise<ApiResponse> {
    const data = await this.templateService.create(createDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '模板创建成功',
      data,
    };
  }

  /**
   * 更新权限模板
   * PUT /api/admin/permission-templates/:id
   */
  @Put(':id')
  @ApiOperation({ summary: '更新权限模板' })
  @ApiParam({ name: 'id', description: '模板ID' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdatePermissionTemplateDto,
  ): Promise<ApiResponse> {
    const data = await this.templateService.update(id, updateDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '模板更新成功',
      data,
    };
  }

  /**
   * 删除权限模板
   * DELETE /api/admin/permission-templates/:id
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除权限模板' })
  @ApiParam({ name: 'id', description: '模板ID' })
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.templateService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data: null,
    };
  }

  /**
   * 预览模板展开后的权限
   * POST /api/admin/permission-templates/preview
   */
  @Post('preview')
  @ApiOperation({ summary: '预览模板展开后的权限' })
  async preview(@Body() previewDto: TemplatePreviewDto): Promise<ApiResponse> {
    const data = await this.templateService.preview(previewDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '预览成功',
      data,
    };
  }
}
