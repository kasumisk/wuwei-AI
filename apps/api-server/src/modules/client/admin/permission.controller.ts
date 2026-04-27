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
import { I18n, I18nContext } from '../../../core/i18n/i18n.decorator';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { PermissionService } from './permission.service';
import {
  CreatePermissionDto,
  UpdatePermissionDto,
  BatchUpdatePermissionsDto,
} from '../../rbac/admin/dto/permission-management.dto';
import { ApiResponse } from '../../../common/types/response.type';

@Controller('admin/clients/:clientId/permissions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class PermissionController {
  constructor(private readonly permissionService: PermissionService) {}

  @Get()
  async findByClient(
    @Param('clientId') clientId: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.permissionService.findByClient(clientId);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('client.clientPermission.fetchSuccess'),
      data,
    };
  }

  @Post()
  async create(
    @Param('clientId') clientId: string,
    @Body() createPermissionDto: CreatePermissionDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    createPermissionDto.clientId = clientId;
    const data = await this.permissionService.create(createPermissionDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: i18n.t('client.clientPermission.grantSuccess'),
      data,
    };
  }

  @Put(':permissionId')
  async update(
    @Param('clientId') clientId: string,
    @Param('permissionId') permissionId: string,
    @Body() updatePermissionDto: UpdatePermissionDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.permissionService.update(
      permissionId,
      updatePermissionDto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('client.clientPermission.updateSuccess'),
      data,
    };
  }

  @Delete(':permissionId')
  async remove(
    @Param('clientId') clientId: string,
    @Param('permissionId') permissionId: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.permissionService.remove(permissionId);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('client.clientPermission.revokeSuccess'),
      data,
    };
  }

  @Post('batch')
  async batchUpdate(
    @Param('clientId') clientId: string,
    @Body() batchDto: BatchUpdatePermissionsDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.permissionService.batchUpdate(clientId, batchDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('client.clientPermission.updateSuccess'),
      data,
    };
  }
}
