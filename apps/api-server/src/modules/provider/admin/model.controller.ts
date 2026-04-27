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
import { ModelService } from './model.service';
import {
  CreateModelDto,
  UpdateModelDto,
  GetModelsQueryDto,
  TestModelDto,
  ModelInfoDto,
  ModelsListResponseDto,
  TestModelResponseDto,
} from './dto/model-management.dto';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('模型管理')
@Controller('admin/models')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ModelController {
  constructor(private readonly modelService: ModelService) {}

  @Get()
  @ApiOperation({ summary: '获取模型列表' })
  @SwaggerResponse({ status: 200, type: ModelsListResponseDto })
  async findAll(
    @Query() query: GetModelsQueryDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.modelService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.model.fetchListSuccess'),
      data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: '获取模型详情' })
  @SwaggerResponse({ status: 200, type: ModelInfoDto })
  async findOne(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.modelService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.model.fetchDetailSuccess'),
      data,
    };
  }

  @Post()
  @ApiOperation({ summary: '创建模型' })
  @SwaggerResponse({ status: 201, type: ModelInfoDto })
  async create(
    @Body() createModelDto: CreateModelDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.modelService.create(createModelDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: i18n.t('provider.model.createSuccess'),
      data,
    };
  }

  @Put(':id')
  @ApiOperation({ summary: '更新模型' })
  @SwaggerResponse({ status: 200, type: ModelInfoDto })
  async update(
    @Param('id') id: string,
    @Body() updateModelDto: UpdateModelDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.modelService.update(id, updateModelDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.model.updateSuccess'),
      data,
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除模型' })
  async remove(
    @Param('id') id: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.modelService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.model.deleteSuccess'),
      data,
    };
  }

  @Post('test')
  @ApiOperation({ summary: '测试模型' })
  @SwaggerResponse({ status: 200, type: TestModelResponseDto })
  async test(
    @Body() testDto: TestModelDto,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.modelService.test(testDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.model.testComplete'),
      data,
    };
  }

  @Get('provider/:providerId')
  @ApiOperation({ summary: '按提供商获取模型' })
  async findByProvider(
    @Param('providerId') providerId: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.modelService.findByProvider(providerId);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.model.fetchListSuccess'),
      data,
    };
  }

  @Get('capability/:capabilityType')
  @ApiOperation({ summary: '按能力类型获取可用模型' })
  async findByCapabilityType(
    @Param('capabilityType') capabilityType: string,
    @I18n() i18n: I18nContext,
  ): Promise<ApiResponse> {
    const data = await this.modelService.findByCapabilityType(capabilityType);
    return {
      success: true,
      code: HttpStatus.OK,
      message: i18n.t('provider.model.fetchListSuccess'),
      data,
    };
  }
}
