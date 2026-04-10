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
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { AiHeavyThrottle } from '../../../core/throttle';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../auth/app/app-user-payload.type';
import { ApiResponse } from '../../../common/types/response.type';
import { StorageService } from '../../../storage/storage.service';
import { FoodService } from './food.service';
import { AnalyzeService } from '../../food/app/analyze.service';
import { FoodLibraryService } from '../../food/app/food-library.service';
import {
  SaveFoodRecordDto,
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
  AddFromLibraryDto,
  AnalyzeImageDto,
} from './food.dto';

@ApiTags('App 饮食记录')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodRecordController {
  constructor(
    private readonly foodService: FoodService,
    private readonly foodLibraryService: FoodLibraryService,
    private readonly analyzeService: AnalyzeService,
    private readonly storageService: StorageService,
  ) {}

  // ==================== 图片分析 ====================

  /**
   * 上传图片并提交 AI 分析（异步模式）
   * POST /api/app/food/analyze
   *
   * V6 Phase 1.4: 改为异步队列模式
   * - 图片上传到 R2 后立即返回 requestId
   * - 客户端通过 GET /api/app/food/analyze/:requestId 轮询结果
   */
  @Post('analyze')
  @AiHeavyThrottle(5, 60)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传食物图片 AI 分析（异步）' })
  async analyzeImage(
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: 10 * 1024 * 1024 }),
          new FileTypeValidator({
            fileType: 'jpeg|png|webp|heic',
            skipMagicNumbersValidation: true,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: AnalyzeImageDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    // 1. 上传图片到 R2（同步，通常很快）
    const uploaded = await this.storageService.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
      'food-images',
    );

    // 2. 提交 AI 分析任务到队列（非阻塞）
    const { requestId } = await this.analyzeService.submitAnalysis(
      uploaded.url,
      dto.mealType,
      user.id,
    );

    return {
      success: true,
      code: HttpStatus.OK,
      message: '分析任务已提交',
      data: {
        requestId,
        status: 'processing',
        imageUrl: uploaded.url,
      },
    };
  }

  // ==================== 饮食记录 CRUD ====================

  /**
   * 确认并保存饮食记录
   * POST /api/app/food/records
   */
  @Post('records')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: '保存饮食记录' })
  async saveRecord(
    @CurrentAppUser() user: AppUserPayload,
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

  /**
   * 获取今日所有记录
   * GET /api/app/food/records/today
   */
  @Get('records/today')
  @ApiOperation({ summary: '获取今日饮食记录' })
  async getTodayRecords(
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
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
    @CurrentAppUser() user: AppUserPayload,
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
   * 删除记录
   * DELETE /api/app/food/records/:id
   */
  @Delete('records/:id')
  @ApiOperation({ summary: '删除饮食记录' })
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
}
