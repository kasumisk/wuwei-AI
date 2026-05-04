/**
 * FoodAnalysisSaveController
 *
 * Phase 7: 保存分析结果子控制器，从 FoodAnalyzeController 拆分。
 * 路由前缀: app/food
 *
 * 端点：
 * - POST analyze-save — 将分析结果保存为饮食记录
 */

import {
  Controller,
  Post,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiBody } from '@nestjs/swagger';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import {
  ApiResponse,
  ResponseWrapper,
} from '../../../../common/types/response.type';
import { UserApiThrottle } from '../../../../core/throttle/throttle.constants';
import { SaveAnalysisToRecordDto } from '../dto/save-analysis.dto';
import { FoodService } from '../../../diet/app/services/food.service';
import { RecordSource, MealType } from '../../../diet/diet.types';
import {
  DomainEvents,
  AnalysisSavedToRecordEvent,
} from '../../../../core/events/domain-events';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { I18nService } from '../../../../core/i18n';
import { AnalyzeResultHelperService } from '../services/analyze-result-helper.service';

@ApiTags('App 食物分析')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodAnalysisSaveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly foodService: FoodService,
    private readonly eventEmitter: EventEmitter2,
    private readonly i18n: I18nService,
    private readonly helper: AnalyzeResultHelperService,
  ) {}

  @Post('analyze-save')
  @HttpCode(HttpStatus.CREATED)
  @UserApiThrottle(30, 60)
  @ApiOperation({ summary: '保存分析结果为饮食记录' })
  @ApiBody({ type: SaveAnalysisToRecordDto })
  async saveAnalysisToRecord(
    @Body() dto: SaveAnalysisToRecordDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const analysisRecord = await this.prisma.foodAnalysisRecords.findUnique({
      where: { id: dto.analysisId },
    });

    if (!analysisRecord) {
      throw new NotFoundException(this.i18n.t('food.analysisRecordNotFound'));
    }
    if (analysisRecord.userId !== user.id) {
      throw new ForbiddenException(
        this.i18n.t('food.analysisNoPermissionEdit'),
      );
    }
    if (analysisRecord.status !== 'completed') {
      throw new BadRequestException(this.i18n.t('food.analysisIncomplete'));
    }

    const result = this.helper.reconstructAnalysisResult(analysisRecord);
    const mealType =
      dto.mealType || (analysisRecord.mealType as MealType) || MealType.LUNCH;

    const createDto = {
      analysisId: dto.analysisId,
      source: RecordSource.DECISION,
      mealType,
      foods:
        result.foods?.map((f) => ({
          name: f.name,
          calories: f.calories ?? 0,
          quantity: f.quantity,
          category: f.category,
          protein: f.protein,
          fat: f.fat,
          carbs: f.carbs,
          glycemicIndex: f.glycemicIndex,
        })) ?? [],
      totalCalories: result.totals?.calories ?? 0,
      advice: result.explanation?.summary,
      isHealthy: result.decision?.shouldEat ?? true,
      recordedAt: dto.recordedAt,
      decision: this.helper.mapRecommendationToDecision(
        result.decision?.recommendation,
      ),
      riskLevel: this.helper.mapRiskLevel(result.decision?.riskLevel),
      reason: result.decision?.reason,
      suggestion: result.explanation?.primaryReason,
      insteadOptions: result.alternatives?.map((a) => a.name) ?? [],
      totalProtein: result.totals?.protein ?? 0,
      totalFat: result.totals?.fat ?? 0,
      totalCarbs: result.totals?.carbs ?? 0,
      nutritionScore: result.score?.nutritionScore ?? 0,
    };

    const record = await this.foodService.createRecord(
      user.id,
      createDto as any,
    );

    this.eventEmitter.emit(
      DomainEvents.ANALYSIS_SAVED_TO_RECORD,
      new AnalysisSavedToRecordEvent(
        user.id,
        dto.analysisId,
        record.id,
        analysisRecord.inputType as 'text' | 'image',
        mealType,
        result.foods?.map((f) => f.name) ?? [],
        result.totals?.calories ?? 0,
      ),
    );

    return ResponseWrapper.success(
      { recordId: record.id, analysisId: dto.analysisId },
      this.i18n.t('food.analyzeSavedAsRecord'),
    );
  }
}
