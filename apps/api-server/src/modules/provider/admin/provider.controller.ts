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
import { I18n, I18nContext } from '../../../core/i18n/i18n.decorator';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { ProviderService } from './provider.service';
import {
  CreateProviderDto,
  UpdateProviderDto,
  GetProvidersQueryDto,
  TestProviderDto,
  ProviderInfoDto,
  ProvidersListResponseDto,
  TestProviderResponseDto,
  ProviderHealthDto,
} from './dto/provider-management.dto';
import { ApiResponse } from '../../../common/types/response.type';

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
  async findAll(
    @Query() query: GetProvidersQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.providerService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.provider.fetchListSuccess'),
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
  async findOne(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.providerService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.provider.fetchDetailSuccess'),
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
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.providerService.create(createProviderDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: i18n.t('provider.provider.createSuccess'),
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
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.providerService.update(id, updateProviderDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.provider.updateSuccess'),
      data,
    };
  }

  /**
   * 删除提供商
   * DELETE /api/admin/providers/:id
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除提供商' })
  async remove(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.providerService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.provider.deleteSuccess'),
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
  async test(
    @Body() testDto: TestProviderDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.providerService.test(testDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.provider.testComplete'),
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
  async getHealth(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.providerService.getHealth(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.provider.healthSuccess'),
      data,
    };
  }

  /**
   * 批量检查所有提供商健康状态
   * POST /api/admin/providers/health/check-all
   */
  @Post('health/check-all')
  @ApiOperation({ summary: '批量检查所有提供商健康状态' })
  async checkAllHealth(@I18n() i18n: I18nContext): Promise<ApiResponse> {
    const data = await this.providerService.checkAllHealth();
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.provider.healthCheckComplete'),
      data,
    };
  }
}
