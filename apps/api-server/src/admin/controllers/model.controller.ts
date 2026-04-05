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
import { ModelService } from '../services/model.service';
import {
  CreateModelDto,
  UpdateModelDto,
  GetModelsQueryDto,
  TestModelDto,
  ModelInfoDto,
  ModelsListResponseDto,
  TestModelResponseDto,
} from '../dto/model-management.dto';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('模型管理')
@Controller('admin/models')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
export class ModelController {
  constructor(private readonly modelService: ModelService) {}

  /**
   * 获取模型列表
   * GET /api/admin/models
   */
  @Get()
  @ApiOperation({ summary: '获取模型列表' })
  @SwaggerResponse({ status: 200, type: ModelsListResponseDto })
  async findAll(@Query() query: GetModelsQueryDto): Promise<ApiResponse> {
    const data = await this.modelService.findAll(query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取模型列表成功',
      data,
    };
  }

  /**
   * 获取模型详情
   * GET /api/admin/models/:id
   */
  @Get(':id')
  @ApiOperation({ summary: '获取模型详情' })
  @SwaggerResponse({ status: 200, type: ModelInfoDto })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.modelService.findOne(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取模型详情成功',
      data,
    };
  }

  /**
   * 创建模型
   * POST /api/admin/models
   */
  @Post()
  @ApiOperation({ summary: '创建模型' })
  @SwaggerResponse({ status: 201, type: ModelInfoDto })
  async create(@Body() createModelDto: CreateModelDto): Promise<ApiResponse> {
    const data = await this.modelService.create(createModelDto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '模型创建成功',
      data,
    };
  }

  /**
   * 更新模型
   * PUT /api/admin/models/:id
   */
  @Put(':id')
  @ApiOperation({ summary: '更新模型' })
  @SwaggerResponse({ status: 200, type: ModelInfoDto })
  async update(
    @Param('id') id: string,
    @Body() updateModelDto: UpdateModelDto,
  ): Promise<ApiResponse> {
    const data = await this.modelService.update(id, updateModelDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '模型更新成功',
      data,
    };
  }

  /**
   * 删除模型
   * DELETE /api/admin/models/:id
   */
  @Delete(':id')
  @ApiOperation({ summary: '删除模型' })
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.modelService.remove(id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '模型删除成功',
      data,
    };
  }

  /**
   * 测试模型
   * POST /api/admin/models/test
   */
  @Post('test')
  @ApiOperation({ summary: '测试模型' })
  @SwaggerResponse({ status: 200, type: TestModelResponseDto })
  async test(@Body() testDto: TestModelDto): Promise<ApiResponse> {
    const data = await this.modelService.test(testDto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '测试完成',
      data,
    };
  }

  /**
   * 按提供商获取模型
   * GET /api/admin/models/provider/:providerId
   */
  @Get('provider/:providerId')
  @ApiOperation({ summary: '按提供商获取模型' })
  async findByProvider(
    @Param('providerId') providerId: string,
  ): Promise<ApiResponse> {
    const data = await this.modelService.findByProvider(providerId);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取模型成功',
      data,
    };
  }

  /**
   * 按能力类型获取可用模型
   * GET /api/admin/models/capability/:capabilityType
   */
  @Get('capability/:capabilityType')
  @ApiOperation({ summary: '按能力类型获取可用模型' })
  async findByCapabilityType(
    @Param('capabilityType') capabilityType: string,
  ): Promise<ApiResponse> {
    const data = await this.modelService.findByCapabilityType(capabilityType);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取可用模型成功',
      data,
    };
  }
}
