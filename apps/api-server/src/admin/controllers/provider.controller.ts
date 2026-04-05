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
import { ProviderService } from '../services/provider.service';
import {
  CreateProviderDto,
  UpdateProviderDto,
  GetProvidersQueryDto,
  TestProviderDto,
  ProviderInfoDto,
  ProvidersListResponseDto,
  TestProviderResponseDto,
  ProviderHealthDto,
} from '../dto/provider-management.dto';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('提供商管理')
@Controller('admin/providers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ProviderController {
  constructor(private readonly providerService: ProviderService) {}

  /**
   * 获取提供商列表
   * GET /api/admin/providers
   */
  @Get()
  @ApiOperation({ summary: '获取提供商列表' })
  @SwaggerResponse({ status: 200, type: ProvidersListResponseDto })
  async findAll(@Query() query: GetProvidersQueryDto): Promise<ApiResponse> {
    const data = await this.providerService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取提供商列表成功',
      data,
    };
  }

  /**
   * 获取提供商详情
   * GET /api/admin/providers/:id
   */
  @Get(':id')
  @ApiOperation({ summary: '获取提供商详情' })
  @SwaggerResponse({ status: 200, type: ProviderInfoDto })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.providerService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取提供商详情成功',
      data,
    };
  }

  /**
   * 创建提供商
   * POST /api/admin/providers
   */
  @Post()
  @ApiOperation({ summary: '创建提供商' })
  @SwaggerResponse({ status: 201, type: ProviderInfoDto })
  async create(
    @Body() createProviderDto: CreateProviderDto,
  ): Promise<ApiResponse> {
    const data = await this.providerService.create(createProviderDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '提供商创建成功',
      data,
    };
  }

  /**
   * 更新提供商
   * PUT /api/admin/providers/:id
   */
  @Put(':id')
  @ApiOperation({ summary: '更新提供商' })
  @SwaggerResponse({ status: 200, type: ProviderInfoDto })
  async update(
    @Param('id') id: string,
    @Body() updateProviderDto: UpdateProviderDto,
  ): Promise<ApiResponse> {
    const data = await this.providerService.update(id, updateProviderDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '提供商更新成功',
      data,
    };
  }

  /**
   * 删除提供商
   * DELETE /api/admin/providers/:id
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除提供商' })
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.providerService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '提供商删除成功',
      data,
    };
  }

  /**
   * 测试提供商连接
   * POST /api/admin/providers/test
   */
  @Post('test')
  @ApiOperation({ summary: '测试提供商连接' })
  @SwaggerResponse({ status: 200, type: TestProviderResponseDto })
  async test(@Body() testDto: TestProviderDto): Promise<ApiResponse> {
    const data = await this.providerService.test(testDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '测试完成',
      data,
    };
  }

  /**
   * 获取提供商健康状态
   * GET /api/admin/providers/:id/health
   */
  @Get(':id/health')
  @ApiOperation({ summary: '获取提供商健康状态' })
  @SwaggerResponse({ status: 200, type: ProviderHealthDto })
  async getHealth(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.providerService.getHealth(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取健康状态成功',
      data,
    };
  }

  /**
   * 批量检查所有提供商健康状态
   * POST /api/admin/providers/health/check-all
   */
  @Post('health/check-all')
  @ApiOperation({ summary: '批量检查所有提供商健康状态' })
  async checkAllHealth(): Promise<ApiResponse> {
    const data = await this.providerService.checkAllHealth();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '健康检查完成',
      data,
    };
  }
}
