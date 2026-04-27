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
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { I18n, I18nContext } from '../../../core/i18n';
import { AdminUserService } from './admin-user.service';
import {
  CreateUserDto,
  UpdateUserDto,
  GetUsersQueryDto,
  AdminResetPasswordDto,
} from './dto/user-management.dto';
import { ApiResponse } from '../../../common/types/response.type';

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class AdminUserController {
  constructor(private readonly adminUserService: AdminUserService) {}

  /**
   * 获取用户列表
   * GET /api/admin/users
   */
  @Get()
  async findAll(
    @Query() query: GetUsersQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.adminUserService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.userListFetched'),
      data,
    };
  }

  /**
   * 获取用户详情
   * GET /api/admin/users/:id
   */
  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.adminUserService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.userDetailFetched'),
      data,
    };
  }

  /**
   * 创建用户
   * POST /api/admin/users
   */
  @Post()
  async create(
    @Body() createUserDto: CreateUserDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.adminUserService.create(createUserDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: i18n.t('user.userCreated'),
      data,
    };
  }

  /**
   * 更新用户
   * PUT /api/admin/users/:id
   */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateUserDto: UpdateUserDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.adminUserService.update(id, updateUserDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.userUpdated'),
      data,
    };
  }

  /**
   * 删除用户
   * DELETE /api/admin/users/:id
   */
  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.adminUserService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.userDeleted'),
      data,
    };
  }

  /**
   * 重置密码
   * POST /api/admin/users/:id/reset-password
   */
  @Post(':id/reset-password')
  async resetPassword(
    @Param('id') id: string,
    @Body() resetPasswordDto: AdminResetPasswordDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.adminUserService.resetPassword(
      id,
      resetPasswordDto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.passwordReset'),
      data,
    };
  }

  /**
   * 获取用户角色
   * GET /api/admin/users/:id/roles
   */
  @Get(':id/roles')
  async getUserRoles(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.adminUserService.getUserRoles(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.rolesFetched'),
      data,
    };
  }

  /**
   * 分配用户角色
   * POST /api/admin/users/:id/roles
   */
  @Post(':id/roles')
  async assignRoles(
    @Param('id') id: string,
    @Body() body: { roleIds: string[] },
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.adminUserService.assignRoles(id, body.roleIds);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('user.rolesAssigned'),
      data,
    };
  }
}
