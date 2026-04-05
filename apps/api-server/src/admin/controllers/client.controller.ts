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
import { ClientService } from '../services/client.service';
import {
  CreateClientDto,
  UpdateClientDto,
  GetClientsQueryDto,
  GetClientUsageQueryDto,
} from '../dto/client-management.dto';
import { ApiResponse } from '../../common/types/response.type';

@Controller('admin/clients')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ClientController {
  constructor(private readonly clientService: ClientService) {}

  /**
   * 获取客户端列表
   * GET /api/admin/clients
   */
  @Get()
  async findAll(@Query() query: GetClientsQueryDto): Promise<ApiResponse> {
    const data = await this.clientService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取客户端列表成功',
      data,
    };
  }

  /**
   * 获取客户端详情
   * GET /api/admin/clients/:id
   */
  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.clientService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取客户端详情成功',
      data,
    };
  }

  /**
   * 创建客户端
   * POST /api/admin/clients
   */
  @Post()
  async create(@Body() createClientDto: CreateClientDto): Promise<ApiResponse> {
    const data = await this.clientService.create(createClientDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '客户端创建成功',
      data,
    };
  }

  /**
   * 更新客户端
   * PUT /api/admin/clients/:id
   */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
  ): Promise<ApiResponse> {
    const data = await this.clientService.update(id, updateClientDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '客户端更新成功',
      data,
    };
  }

  /**
   * 删除客户端
   * DELETE /api/admin/clients/:id
   */
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.clientService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '客户端删除成功',
      data,
    };
  }

  /**
   * 重新生成 API Secret
   * POST /api/admin/clients/:id/regenerate-secret
   */
  @Post(':id/regenerate-secret')
  async regenerateSecret(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.clientService.regenerateSecret(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: 'API Secret 重新生成成功',
      data,
    };
  }

  /**
   * 获取客户端使用统计
   * GET /api/admin/clients/:id/usage
   */
  @Get(':id/usage')
  async getUsageStats(
    @Param('id') id: string,
    @Query() query: GetClientUsageQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.clientService.getUsageStats(id, query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取客户端使用统计成功',
      data,
    };
  }
}
