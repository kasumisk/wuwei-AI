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
import { RoleService } from '../services/role.service';
import { PermissionTemplateService } from '../services/permission-template.service';
import type {
  CreateRoleDto,
  UpdateRoleDto,
  RoleQueryDto,
  AssignPermissionsDto,
  ApplyTemplateDto,
} from '@ai-platform/shared';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('角色管理')
@Controller('admin/roles')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class RoleController {
  constructor(
    private readonly roleService: RoleService,
    private readonly templateService: PermissionTemplateService,
  ) {}

  /**
   * 获取角色列表
   * GET /api/admin/roles
   */
  @Get()
  @ApiOperation({ summary: '获取角色列表' })
  @ApiQuery({ name: 'page', required: false, description: '页码' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页数量' })
  @ApiQuery({ name: 'code', required: false, description: '角色编码' })
  @ApiQuery({ name: 'name', required: false, description: '角色名称' })
  @ApiQuery({ name: 'status', required: false, description: '状态' })
  async findAll(@Query() query: RoleQueryDto): Promise<ApiResponse> {
    const data = await this.roleService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取角色列表成功',
      data,
    };
  }

  /**
   * 获取角色树（含继承关系）
   * GET /api/admin/roles/tree
   */
  @Get('tree')
  @ApiOperation({ summary: '获取角色树（含继承关系）' })
  async getTree(): Promise<ApiResponse> {
    const data = await this.roleService.getTree();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取角色树成功',
      data,
    };
  }

  /**
   * 获取角色详情
   * GET /api/admin/roles/:id
   */
  @Get(':id')
  @ApiOperation({ summary: '获取角色详情' })
  @ApiParam({ name: 'id', description: '角色ID' })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.roleService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取角色详情成功',
      data,
    };
  }

  /**
   * 创建角色
   * POST /api/admin/roles
   */
  @Post()
  @ApiOperation({ summary: '创建角色' })
  async create(@Body() createRoleDto: CreateRoleDto): Promise<ApiResponse> {
    const data = await this.roleService.create(createRoleDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '角色创建成功',
      data,
    };
  }

  /**
   * 更新角色
   * PUT /api/admin/roles/:id
   */
  @Put(':id')
  @ApiOperation({ summary: '更新角色' })
  @ApiParam({ name: 'id', description: '角色ID' })
  async update(
    @Param('id') id: string,
    @Body() updateRoleDto: UpdateRoleDto,
  ): Promise<ApiResponse> {
    const data = await this.roleService.update(id, updateRoleDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '角色更新成功',
      data,
    };
  }

  /**
   * 删除角色
   * DELETE /api/admin/roles/:id
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除角色' })
  @ApiParam({ name: 'id', description: '角色ID' })
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.roleService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data: null,
    };
  }

  /**
   * 获取角色权限（包含继承的权限）
   * GET /api/admin/roles/:id/permissions
   */
  @Get(':id/permissions')
  @ApiOperation({ summary: '获取角色权限（包含继承的权限）' })
  @ApiParam({ name: 'id', description: '角色ID' })
  async getRolePermissions(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.roleService.getRolePermissions(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取角色权限成功',
      data,
    };
  }

  /**
   * 为角色分配权限
   * POST /api/admin/roles/:id/permissions
   */
  @Post(':id/permissions')
  @ApiOperation({ summary: '为角色分配权限' })
  @ApiParam({ name: 'id', description: '角色ID' })
  async assignPermissions(
    @Param('id') id: string,
    @Body() assignPermissionsDto: AssignPermissionsDto,
  ): Promise<ApiResponse> {
    const data = await this.roleService.assignPermissions(
      id,
      assignPermissionsDto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: data.message,
      data: null,
    };
  }

  /**
   * 应用权限模板到角色
   * POST /api/admin/roles/:id/apply-template
   */
  @Post(':id/apply-template')
  @ApiOperation({ summary: '应用权限模板到角色' })
  @ApiParam({ name: 'id', description: '角色ID' })
  async applyTemplate(
    @Param('id') id: string,
    @Body() applyTemplateDto: ApplyTemplateDto,
  ): Promise<ApiResponse> {
    const data = await this.templateService.applyToRole(
      id,
      applyTemplateDto.templateCode,
      applyTemplateDto.modules,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '模板应用成功',
      data,
    };
  }
}
