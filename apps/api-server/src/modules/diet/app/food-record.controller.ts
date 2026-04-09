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
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { ApiResponse } from '../../../common/types/response.type';
import { FoodService } from './food.service';
import { FoodLibraryService } from '../../food/app/food-library.service';
import {
  SaveFoodRecordDto,
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
  AddFromLibraryDto,
} from './food.dto';

@ApiTags('App 饮食记录')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodRecordController {
  constructor(
    private readonly foodService: FoodService,
    private readonly foodLibraryService: FoodLibraryService,
  ) {}

  /**
   * 确认并保存饮食记录
   * POST /api/app/food/records
   */
  @Post('records')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '保存饮食记录' })
  async saveRecord(
    @CurrentAppUser() user: any,
    @Body() dto: SaveFoodRecordDto,
  ): Promise<ApiResponse> {
    const record = await this.foodService.saveRecord(user.id, dto);
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '记录已保存',
      data: record,
    };
  }

  /**
   * 从食物库添加饮食记录（手动记录入口）
   * POST /api/app/food/records/from-library
   */
  @Post('records/from-library')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '从食物库添加饮食记录' })
  async addFromLibrary(
    @CurrentAppUser() user: any,
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
      message: '记录已保存',
      data: record,
    };
  }

  /**
   * 获取用户常吃食物
   * GET /api/app/food/frequent-foods
   */
  @Get('frequent-foods')
  @ApiOperation({ summary: '获取用户常吃食物排行' })
  async getFrequentFoods(
    @CurrentAppUser() user: any,
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

  /**
   * 获取今日所有记录
   * GET /api/app/food/records/today
   */
  @Get('records/today')
  @ApiOperation({ summary: '获取今日饮食记录' })
  async getTodayRecords(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const records = await this.foodService.getTodayRecords(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: records,
    };
  }

  /**
   * 分页查询历史记录
   * GET /api/app/food/records?page=1&limit=20&date=2026-04-06
   */
  @Get('records')
  @ApiOperation({ summary: '查询饮食记录（分页）' })
  async getRecords(
    @CurrentAppUser() user: any,
    @Query() query: FoodRecordQueryDto,
  ): Promise<ApiResponse> {
    const data = await this.foodService.getRecords(user.id, query);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  /**
   * 修改记录
   * PUT /api/app/food/records/:id
   */
  @Put('records/:id')
  @ApiOperation({ summary: '修改饮食记录' })
  async updateRecord(
    @CurrentAppUser() user: any,
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
   * 删除记录
   * DELETE /api/app/food/records/:id
   */
  @Delete('records/:id')
  @ApiOperation({ summary: '删除饮食记录' })
  async deleteRecord(
    @CurrentAppUser() user: any,
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
}
