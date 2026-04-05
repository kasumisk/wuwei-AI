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
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { AdminUserService } from '../services/admin-user.service';
import {
  CreateUserDto,
  UpdateUserDto,
  GetUsersQueryDto,
  AdminResetPasswordDto,
} from '../dto/user-management.dto';
import { ApiResponse } from '../../common/types/response.type';

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
  async findAll(@Query() query: GetUsersQueryDto): Promise<ApiResponse> {
    const data = await this.adminUserService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取用户列表成功',
      data,
    };
  }

  /**
   * 获取用户详情
   * GET /api/admin/users/:id
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.adminUserService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取用户详情成功',
      data,
    };
  }

  /**
   * 创建用户
   * POST /api/admin/users
   */
  @Post()
  async create(@Body() createUserDto: CreateUserDto): Promise<ApiResponse> {
    const data = await this.adminUserService.create(createUserDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '用户创建成功',
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
  ): Promise<ApiResponse> {
    const data = await this.adminUserService.update(id, updateUserDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '用户更新成功',
      data,
    };
  }

  /**
   * 删除用户
   * DELETE /api/admin/users/:id
   */
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.adminUserService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '用户删除成功',
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
  ): Promise<ApiResponse> {
    const data = await this.adminUserService.resetPassword(
      id,
      resetPasswordDto,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '密码重置成功',
      data,
    };
  }

  /**
   * 获取用户角色
   * GET /api/admin/users/:id/roles
   */
  @Get(':id/roles')
  async getUserRoles(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.adminUserService.getUserRoles(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取用户角色成功',
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
  ): Promise<ApiResponse> {
    const data = await this.adminUserService.assignRoles(id, body.roleIds);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '角色分配成功',
      data,
    };
  }
}
