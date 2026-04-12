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
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../rbac/admin/roles.guard';
import { Roles } from '../../rbac/admin/roles.decorator';
import { FoodLibraryManagementService } from './food-library-management.service';
import {
  GetFoodLibraryQueryDto,
  CreateFoodLibraryDto,
  UpdateFoodLibraryDto,
  BatchImportFoodDto,
  CreateFoodTranslationDto,
  UpdateFoodTranslationDto,
  CreateFoodSourceDto,
  ResolveFoodConflictDto,
} from './dto/food-library-management.dto';
import { ApiResponse } from '../../../common/types/response.type';

@ApiTags('管理后台 - 食物库管理')
@Controller('admin/food-library')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class FoodLibraryManagementController {
  constructor(
    private readonly foodLibraryService: FoodLibraryManagementService,
  ) {}

  // ==================== 食物 CRUD ====================

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

  @Get('conflicts')
  @ApiOperation({ summary: '获取冲突列表' })
  async getConflicts(
    @Query()
    query: {
      foodId?: string;
      resolution?: string;
      page?: number;
      pageSize?: number;
    },
  ): Promise<ApiResponse> {
    const data = await this.foodLibraryService.getConflicts(query);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Get(':id')
  @ApiOperation({ summary: '获取食物详情（含翻译/来源/冲突）' })
  async findOne(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.foodLibraryService.findOne(id);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Post()
  @ApiOperation({ summary: '创建食物' })
  async create(@Body() dto: CreateFoodLibraryDto): Promise<ApiResponse> {
    const data = await this.foodLibraryService.create(dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '创建成功',
      data,
    };
  }

  @Post('batch-import')
  @ApiOperation({ summary: '批量导入食物' })
  async batchImport(@Body() dto: BatchImportFoodDto): Promise<ApiResponse> {
    const data = await this.foodLibraryService.batchImport(dto.foods);
    return { success: true, code: HttpStatus.OK, message: '导入完成', data };
  }

  @Put(':id')
  @ApiOperation({ summary: '更新食物' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateFoodLibraryDto,
    @Request() req: any,
  ): Promise<ApiResponse> {
    const operator: string = req.user?.username ?? 'admin';
    const data = await this.foodLibraryService.update(id, dto, operator);
    return { success: true, code: HttpStatus.OK, message: '更新成功', data };
  }

  @Post(':id/toggle-verified')
  @ApiOperation({ summary: '切换食物验证状态' })
  async toggleVerified(
    @Param('id') id: string,
    @Request() req: any,
  ): Promise<ApiResponse> {
    const operator: string = req.user?.username ?? 'admin';
    const data = await this.foodLibraryService.toggleVerified(id, operator);
    return { success: true, code: HttpStatus.OK, message: '状态已更新', data };
  }

  @Post(':id/status')
  @ApiOperation({ summary: '更新食物状态(draft/active/archived/merged)' })
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
    @Request() req: any,
  ): Promise<ApiResponse> {
    const operator: string = req.user?.username ?? 'admin';
    const data = await this.foodLibraryService.updateStatus(
      id,
      status,
      operator,
    );
    return { success: true, code: HttpStatus.OK, message: '状态已更新', data };
  }

  @Delete(':id')
  @ApiOperation({ summary: '删除食物' })
  async remove(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.foodLibraryService.remove(id);
    return { success: true, code: HttpStatus.OK, message: data.message, data };
  }

  // ==================== 翻译管理 ====================

  @Get(':id/translations')
  @ApiOperation({ summary: '获取食物翻译列表' })
  async getTranslations(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.foodLibraryService.getTranslations(id);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Post(':id/translations')
  @ApiOperation({ summary: '添加食物翻译' })
  async createTranslation(
    @Param('id') id: string,
    @Body() dto: CreateFoodTranslationDto,
  ): Promise<ApiResponse> {
    const data = await this.foodLibraryService.createTranslation(id, dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '创建成功',
      data,
    };
  }

  @Put('translations/:translationId')
  @ApiOperation({ summary: '更新食物翻译' })
  async updateTranslation(
    @Param('translationId') translationId: string,
    @Body() dto: UpdateFoodTranslationDto,
  ): Promise<ApiResponse> {
    const data = await this.foodLibraryService.updateTranslation(
      translationId,
      dto,
    );
    return { success: true, code: HttpStatus.OK, message: '更新成功', data };
  }

  @Delete('translations/:translationId')
  @ApiOperation({ summary: '删除食物翻译' })
  async deleteTranslation(
    @Param('translationId') translationId: string,
  ): Promise<ApiResponse> {
    const data = await this.foodLibraryService.deleteTranslation(translationId);
    return { success: true, code: HttpStatus.OK, message: data.message, data };
  }

  // ==================== 数据来源管理 ====================

  @Get(':id/sources')
  @ApiOperation({ summary: '获取食物数据来源列表' })
  async getSources(@Param('id') id: string): Promise<ApiResponse> {
    const data = await this.foodLibraryService.getSources(id);
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  @Post(':id/sources')
  @ApiOperation({ summary: '添加食物数据来源' })
  async createSource(
    @Param('id') id: string,
    @Body() dto: CreateFoodSourceDto,
  ): Promise<ApiResponse> {
    const data = await this.foodLibraryService.createSource(id, dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '创建成功',
      data,
    };
  }

  @Delete('sources/:sourceId')
  @ApiOperation({ summary: '删除食物数据来源' })
  async deleteSource(
    @Param('sourceId') sourceId: string,
  ): Promise<ApiResponse> {
    const data = await this.foodLibraryService.deleteSource(sourceId);
    return { success: true, code: HttpStatus.OK, message: data.message, data };
  }

  // ==================== 变更日志 ====================

  @Get(':id/change-logs')
  @ApiOperation({ summary: '获取食物变更日志' })
  async getChangeLogs(
    @Param('id') id: string,
    @Query('page') page?: number,
    @Query('pageSize') pageSize?: number,
  ): Promise<ApiResponse> {
    const data = await this.foodLibraryService.getChangeLogs(
      id,
      page ? Number(page) : 1,
      pageSize ? Number(pageSize) : 20,
    );
    return { success: true, code: HttpStatus.OK, message: '获取成功', data };
  }

  // ==================== 冲突解决 ====================

  @Post('conflicts/:conflictId/resolve')
  @ApiOperation({ summary: '解决食物数据冲突' })
  async resolveConflict(
    @Param('conflictId') conflictId: string,
    @Body() dto: ResolveFoodConflictDto,
    @Request() req: any,
  ): Promise<ApiResponse> {
    const operator: string = req.user?.username ?? 'admin';
    const data = await this.foodLibraryService.resolveConflict(
      conflictId,
      dto,
      operator,
    );
    return { success: true, code: HttpStatus.OK, message: '冲突已解决', data };
  }
}
