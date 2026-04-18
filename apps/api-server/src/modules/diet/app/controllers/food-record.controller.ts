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
  CreateFoodLogDto,
  FoodLogQueryDto,
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

  // ==================== V8: Food Log 统一接口 ====================

  /**
   * V8: 统一写入 Food Log（支持所有来源）
   * POST /api/app/food/records
   */
  @Post('records')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'V8: 统一写入 Food Log' })
  async createFoodLog(
    @CurrentAppUser() user: AppUserPayload,
    @Body() dto: CreateFoodLogDto,
  ): Promise<ApiResponse> {
    const record = await this.foodService.createFoodLog(user.id, dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '记录已保存',
      data: record,
    };
  }

  /**
   * V8: 按日期+来源查询 Food Log
   * GET /api/app/food/records?date=2026-04-18&source=recommend
   */
  @Get('records')
  @ApiOperation({ summary: 'V8: 按日期查询 Food Log' })
  async getFoodLog(
    @CurrentAppUser() user: AppUserPayload,
    @Query() query: FoodLogQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.foodService.getFoodLog(user.id, query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  /**
   * V8: 修改 Food Log 条目
   * PUT /api/app/food/records/:id
   */
  @Put('records/:id')
  @ApiOperation({ summary: 'V8: 修改 Food Log 条目' })
  async updateFoodLog(
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
   * V8: 删除 Food Log 条目
   * DELETE /api/app/food/records/:id
   */
  @Delete('records/:id')
  @ApiOperation({ summary: 'V8: 删除 Food Log 条目' })
  async deleteFoodLog(
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
