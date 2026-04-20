import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import { ApiResponse } from '../../../../common/types/response.type';
import { FoodService } from '../services/food.service';
import { FoodLibraryService } from '../../../food/app/services/food-library.service';
import {
  UpdateFoodRecordDto,
  AddFromLibraryDto,
  CreateFoodRecordDto,
  FoodRecordQueryDto,
} from '../dto/food.dto';

@ApiTags('App 饮食记录')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodRecordController {
  constructor(
    private readonly foodService: FoodService,
    private readonly foodLibraryService: FoodLibraryService,
  ) {}

  // ==================== V8: Food Records 统一接口 ====================

  /**
   * V8: 统一写入 Food Record（支持所有来源）
   * POST /api/app/food/records
   */
  @Post('records')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'V8: 统一写入 Food Record' })
  async createRecord(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: CreateFoodRecordDto,
  ): Promise<ApiResponse> {
    const record = await this.foodService.createRecord(user.id, dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '记录已保存',
      data: record,
    };
  }

  /**
   * 从食物库添加饮食记录
   * POST /api/app/food/records/from-library
   *
   * 根据食物库 ID + 用餐克数，自动换算营养素并创建记录。
   */
  @Post('records/from-library')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '从食物库添加饮食记录' })
  async addFromLibrary(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: AddFromLibraryDto,
  ): Promise<ApiResponse> {
    const record = await this.foodLibraryService.addFromLibrary(
      user.id,
      dto.foodLibraryId,
      dto.servingGrams,
      dto.mealType,
    );
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '添加成功',
      data: record,
    };
  }

  /**
   * V8: 查询 Food Records（支持单日/日期范围+来源筛选）
   * GET /api/app/food/records?date=2026-04-18
   * GET /api/app/food/records?startDate=2026-04-13&endDate=2026-04-20
   */
  @Get('records')
  @ApiOperation({ summary: 'V8: 查询 Food Records' })
  async queryRecords(
    @CurrentAppUser() user: AppUserPayload,
    @Query() query: FoodRecordQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.foodService.queryRecords(user.id, query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  /**
   * V8: 修改 Food Record 条目
   * PUT /api/app/food/records/:id
   */
  @Put('records/:id')
  @ApiOperation({ summary: 'V8: 修改 Food Record 条目' })
  async updateRecord(
    @CurrentAppUser() user: AppUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFoodRecordDto,
  ): Promise<ApiResponse> {
    const record = await this.foodService.updateRecord(user.id, id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '更新成功',
      data: record,
    };
  }

  /**
   * V8: 删除 Food Record 条目
   * DELETE /api/app/food/records/:id
   */
  @Delete('records/:id')
  @ApiOperation({ summary: 'V8: 删除 Food Record 条目' })
  async deleteRecord(
    @CurrentAppUser() user: AppUserPayload,
    @Param('id') id: string,
  ): Promise<ApiResponse> {
    await this.foodService.deleteRecord(user.id, id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '删除成功',
      data: null,
    };
  }

  // ==================== 食物库 ====================

  /**
   * 获取用户常吃食物
   * GET /api/app/food/frequent-foods
   */
  @Get('frequent-foods')
  @ApiOperation({ summary: '获取用户常吃食物排行' })
  async getFrequentFoods(
    @CurrentAppUser() user: AppUserPayload,
    @Query('limit') limit?: string,
  ): Promise<ApiResponse> {
    const data = await this.foodLibraryService.getFrequent(
      user.id,
      limit ? parseInt(limit, 10) : 10,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }
}
