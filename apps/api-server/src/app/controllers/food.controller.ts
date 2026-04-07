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
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiConsumes,
} from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../guards/app-jwt-auth.guard';
import { CurrentAppUser } from '../decorators/current-app-user.decorator';
import { ApiResponse } from '../../common/types/response.type';
import { StorageService } from '../../storage/storage.service';
import { FoodService } from '../services/food.service';
import { AnalyzeService } from '../services/analyze.service';
import { UserProfileService } from '../services/user-profile.service';
import { FoodLibraryService } from '../services/food-library.service';
import { DailyPlanService } from '../services/daily-plan.service';
import { BehaviorService } from '../services/behavior.service';
import {
  SaveFoodRecordDto,
  UpdateFoodRecordDto,
  FoodRecordQueryDto,
  SaveUserProfileDto,
  AnalyzeImageDto,
  AddFromLibraryDto,
} from '../dto/food.dto';

@ApiTags('App 饮食记录')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodController {
  constructor(
    private readonly foodService: FoodService,
    private readonly analyzeService: AnalyzeService,
    private readonly userProfileService: UserProfileService,
    private readonly storageService: StorageService,
    private readonly foodLibraryService: FoodLibraryService,
    private readonly dailyPlanService: DailyPlanService,
    private readonly behaviorService: BehaviorService,
  ) {}

  // ==================== 图片分析 ====================

  /**
   * 上传图片并 AI 分析
   * POST /api/app/food/analyze
   */
  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: '上传食物图片 AI 分析' })
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
    @CurrentAppUser() user: any,
  ): Promise<ApiResponse> {
    // 1. 上传图片到 R2
    const uploaded = await this.storageService.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
      'food-images',
    );

    // 2. AI 分析
    const result = await this.analyzeService.analyzeImage(
      uploaded.url,
      dto.mealType,
      user.id,
    );

    return {
      success: true,
      code: HttpStatus.OK,
      message: '分析完成',
      data: result,
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

  // ==================== 汇总 ====================

  /**
   * 获取今日汇总（已摄入/目标/剩余）
   * GET /api/app/food/summary/today
   */
  @Get('summary/today')
  @ApiOperation({ summary: '获取今日饮食汇总' })
  async getTodaySummary(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const summary = await this.foodService.getTodaySummary(user.id);

    // 补充热量目标
    if (!summary.calorieGoal) {
      summary.calorieGoal =
        await this.userProfileService.getDailyCalorieGoal(user.id);
      summary.remaining = Math.max(
        0,
        summary.calorieGoal - summary.totalCalories,
      );
    }

    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: summary,
    };
  }

  /**
   * 获取最近 N 天汇总（趋势图）
   * GET /api/app/food/summary/recent?days=7
   */
  @Get('summary/recent')
  @ApiOperation({ summary: '获取最近 N 天饮食汇总' })
  async getRecentSummaries(
    @CurrentAppUser() user: any,
    @Query('days') days?: string,
  ): Promise<ApiResponse> {
    const data = await this.foodService.getRecentSummaries(
      user.id,
      days ? parseInt(days, 10) : 7,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }

  // ==================== 下一餐推荐 ====================

  /**
   * 获取下一餐推荐
   * GET /api/app/food/meal-suggestion
   */
  @Get('meal-suggestion')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '获取下一餐推荐' })
  async getMealSuggestion(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const suggestion = await this.foodService.getMealSuggestion(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: suggestion,
    };
  }

  // ==================== V2: 每日计划 ====================

  /**
   * 获取今日计划（惰性生成）
   * GET /api/app/food/daily-plan
   */
  @Get('daily-plan')
  @ApiOperation({ summary: '获取今日饮食计划' })
  async getDailyPlan(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const plan = await this.dailyPlanService.getPlan(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: plan,
    };
  }

  /**
   * 触发计划动态调整
   * POST /api/app/food/daily-plan/adjust
   */
  @Post('daily-plan/adjust')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '触发饮食计划调整' })
  async adjustDailyPlan(
    @CurrentAppUser() user: any,
    @Body() body: { reason: string },
  ): Promise<ApiResponse> {
    const result = await this.dailyPlanService.adjustPlan(user.id, body.reason);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '计划已调整',
      data: result,
    };
  }

  // ==================== V3: 行为建模 ====================

  /**
   * 获取行为画像
   * GET /api/app/food/behavior-profile
   */
  @Get('behavior-profile')
  @ApiOperation({ summary: '获取用户行为画像' })
  async getBehaviorProfile(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const profile = await this.behaviorService.getProfile(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: profile,
    };
  }

  /**
   * 主动提醒检查
   * GET /api/app/food/proactive-check
   */
  @Get('proactive-check')
  @ApiOperation({ summary: '主动提醒检查' })
  async proactiveCheck(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const reminder = await this.behaviorService.proactiveCheck(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '检查完成',
      data: { reminder },
    };
  }

  /**
   * AI 决策反馈
   * POST /api/app/food/decision-feedback
   */
  @Post('decision-feedback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'AI 决策反馈' })
  async decisionFeedback(
    @Body() body: { recordId: string; followed: boolean; feedback: 'helpful' | 'unhelpful' | 'wrong' },
  ): Promise<ApiResponse> {
    await this.behaviorService.logFeedback(body.recordId, body.followed, body.feedback);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '反馈已记录',
      data: null,
    };
  }

  // ==================== 用户健康档案 ====================

  /**
   * 获取用户健康档案
   * GET /api/app/food/profile
   */
  @Get('profile')
  @ApiOperation({ summary: '获取用户健康档案' })
  async getProfile(@CurrentAppUser() user: any): Promise<ApiResponse> {
    const profile = await this.userProfileService.getProfile(user.id);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: profile,
    };
  }

  /**
   * 保存/更新用户健康档案
   * PUT /api/app/food/profile
   */
  @Put('profile')
  @ApiOperation({ summary: '保存用户健康档案' })
  async saveProfile(
    @CurrentAppUser() user: any,
    @Body() dto: SaveUserProfileDto,
  ): Promise<ApiResponse> {
    const profile = await this.userProfileService.saveProfile(user.id, dto);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '保存成功',
      data: profile,
    };
  }
}
