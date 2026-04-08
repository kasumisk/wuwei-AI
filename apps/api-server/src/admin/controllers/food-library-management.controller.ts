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
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { FoodLibraryManagementService } from '../services/food-library-management.service';
import {
  GetFoodLibraryQueryDto,
  CreateFoodLibraryDto,
  UpdateFoodLibraryDto,
  BatchImportFoodDto,
} from '../dto/food-library-management.dto';
import { ApiResponse } from '../../common/types/response.type';

@ApiTags('管理后台 - 食物库管理')
@Controller('admin/food-library')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class FoodLibraryManagementController {
  constructor(
    private readonly foodLibraryService: FoodLibraryManagementService,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取食物库列表' })
  async findAll(@Query() query: GetFoodLibraryQueryDto): Promise<ApiResponse> {
    const data = await this.foodLibraryService.findAll(query);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get('statistics')
  @ApiOperation({ summary: '获取食物库统计' })
  async getStatistics(): Promise<ApiResponse> {
    const data = await this.foodLibraryService.getStatistics();
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get('categories')
  @ApiOperation({ summary: '获取食物分类列表' })
  async getCategories(): Promise<ApiResponse> {
    const data = await this.foodLibraryService.getCategories();
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get(':id')
  @ApiOperation({ summary: '获取食物详情' })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.foodLibraryService.findOne(id);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Post()
  @ApiOperation({ summary: '创建食物' })
  async create(@Body() dto: CreateFoodLibraryDto): Promise<ApiResponse> {
    const data = await this.foodLibraryService.create(dto);
    return { success: true, code: HttpStatus.CREATED, message: '创建成功', data };
  }

  @Post('batch-import')
  @ApiOperation({ summary: '批量导入食物' })
  async batchImport(@Body() dto: BatchImportFoodDto): Promise<ApiResponse> {
    const data = await this.foodLibraryService.batchImport(dto.foods);
    return { success: true, code: HttpStatus.OK, message: '导入完成', data };
  }

  @Put(':id')
  @ApiOperation({ summary: '更新食物' })
  async update(@Param('id') id: string, @Body() dto: UpdateFoodLibraryDto): Promise<ApiResponse> {
    const data = await this.foodLibraryService.update(id, dto);
    return { success: true, code: HttpStatus.OK, message: '更新成功', data };
  }

  @Post(':id/toggle-verified')
  @ApiOperation({ summary: '切换食物验证状态' })
  async toggleVerified(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.foodLibraryService.toggleVerified(id);
    return { success: true, code: HttpStatus.OK, message: '状态已更新', data };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除食物' })
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.foodLibraryService.remove(id);
    return { success: true, code: HttpStatus.OK, message: data.message, data };
  }
}
