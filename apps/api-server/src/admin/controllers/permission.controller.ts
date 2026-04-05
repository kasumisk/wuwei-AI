import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { PermissionService } from '../services/permission.service';
import {
  CreatePermissionDto,
  UpdatePermissionDto,
  BatchUpdatePermissionsDto,
} from '../dto/permission-management.dto';
import { ApiResponse } from '../../common/types/response.type';

@Controller('admin/clients/:clientId/permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  /**
   * 获取客户端权限列表
   * GET /api/admin/clients/:clientId/permissions
   */
  @Get()
  async findByClient(
    @Param('clientId') clientId: string,
  ): Promise<ApiResponse> {
    const data = await this.permissionService.findByClient(clientId);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取客户端权限列表成功',
      data,
    };
  }

  /**
   * 添加权限
   * POST /api/admin/clients/:clientId/permissions
   */
  @Post()
  async create(
    @Param('clientId') clientId: string,
    @Body() createPermissionDto: CreatePermissionDto,
  ): Promise<ApiResponse> {
    // 确保 clientId 匹配
    createPermissionDto.clientId = clientId;

    const data = await this.permissionService.create(createPermissionDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '权限添加成功',
      data,
    };
  }

  /**
   * 更新权限
   * PUT /api/admin/clients/:clientId/permissions/:permissionId
   */
  @Put(':permissionId')
  async update(
    @Param('clientId') clientId: string,
    @Param('permissionId') permissionId: string,
    @Body() updatePermissionDto: UpdatePermissionDto,
  ): Promise<ApiResponse> {
    const data = await this.permissionService.update(
      permissionId,
      updatePermissionDto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '权限更新成功',
      data,
    };
  }

  /**
   * 删除权限
   * DELETE /api/admin/clients/:clientId/permissions/:permissionId
   */
  @Delete(':permissionId')
  async remove(
    @Param('clientId') clientId: string,
    @Param('permissionId') permissionId: string,
  ): Promise<ApiResponse> {
    const data = await this.permissionService.remove(permissionId);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '权限删除成功',
      data,
    };
  }

  /**
   * 批量更新权限
   * POST /api/admin/clients/:clientId/permissions/batch
   */
  @Post('batch')
  async batchUpdate(
    @Param('clientId') clientId: string,
    @Body() batchDto: BatchUpdatePermissionsDto,
  ): Promise<ApiResponse> {
    const data = await this.permissionService.batchUpdate(clientId, batchDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '批量更新权限完成',
      data,
    };
  }
}
