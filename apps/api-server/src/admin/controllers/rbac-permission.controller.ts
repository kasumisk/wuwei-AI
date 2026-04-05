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
import { CurrentUser } from '../decorators/current-user.decorator';
import { RbacPermissionService } from '../services/rbac-permission.service';
import type {
  CreateRbacPermissionDto,
  UpdateRbacPermissionDto,
  RbacPermissionQueryDto,
} from '@ai-platform/shared';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('RBAC权限管理')
@Controller('admin/rbac-permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class RbacPermissionController {
  constructor(private readonly permissionService: RbacPermissionService) {}

  /**
   * 获取权限列表
   * GET /api/admin/rbac-permissions
   */
  @Get()
  @ApiOperation({ summary: '获取权限列表' })
  @ApiQuery({ name: 'page', required: false, description: '页码' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页数量' })
  @ApiQuery({ name: 'code', required: false, description: '权限编码' })
  @ApiQuery({ name: 'name', required: false, description: '权限名称' })
  @ApiQuery({ name: 'type', required: false, description: '权限类型' })
  @ApiQuery({ name: 'status', required: false, description: '状态' })
  async findAll(@Query() query: RbacPermissionQueryDto): Promise<ApiResponse> {
    const data = await this.permissionService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取权限列表成功',
      data,
    };
  }

  /**
   * 获取权限树
   * GET /api/admin/rbac-permissions/tree
   */
  @Get('tree')
  @ApiOperation({ summary: '获取权限树' })
  async getTree(): Promise<ApiResponse> {
    const data = await this.permissionService.getTree();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取权限树成功',
      data,
    };
  }

  /**
   * 获取所有模块（用于展开通配符）
   * GET /api/admin/rbac-permissions/modules
   */
  @Get('modules')
  @ApiOperation({ summary: '获取所有模块（用于展开通配符）' })
  async getModules(): Promise<ApiResponse> {
    const data = await this.permissionService.getAllModules();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取模块列表成功',
      data,
    };
  }

  /**
   * 获取当前用户权限
   * GET /api/admin/rbac-permissions/user/permissions
   */
  @Get('user/permissions')
  @ApiOperation({ summary: '获取当前用户权限' })
  async getUserPermissions(
    @CurrentUser() user: { id: string },
  ): Promise<ApiResponse> {
    const data = await this.permissionService.getUserPermissions(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取用户权限成功',
      data,
    };
  }

  /**
   * 获取权限详情
   * GET /api/admin/rbac-permissions/:id
   */
  @Get(':id')
  @ApiOperation({ summary: '获取权限详情' })
  @ApiParam({ name: 'id', description: '权限ID' })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.permissionService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取权限详情成功',
      data,
    };
  }

  /**
   * 创建权限
   * POST /api/admin/rbac-permissions
   */
  @Post()
  @ApiOperation({ summary: '创建权限' })
  async create(
    @Body() createDto: CreateRbacPermissionDto,
  ): Promise<ApiResponse> {
    const data = await this.permissionService.create(createDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '权限创建成功',
      data,
    };
  }

  /**
   * 更新权限
   * PUT /api/admin/rbac-permissions/:id
   */
  @Put(':id')
  @ApiOperation({ summary: '更新权限' })
  @ApiParam({ name: 'id', description: '权限ID' })
  async update(
    @Param('id') id: string,
    @Body() updateDto: UpdateRbacPermissionDto,
  ): Promise<ApiResponse> {
    const data = await this.permissionService.update(id, updateDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '权限更新成功',
      data,
    };
  }

  /**
   * 删除权限
   * DELETE /api/admin/rbac-permissions/:id
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除权限' })
  @ApiParam({ name: 'id', description: '权限ID' })
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.permissionService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data: null,
    };
  }
}
