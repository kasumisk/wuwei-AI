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
import { Prisma } from '@prisma/client';
import { AppJwtAuthGuard } from '../../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../../auth/app/app-user-payload.type';
import {
  ApiResponse,
  ResponseWrapper,
} from '../../../../common/types/response.type';
import { UserApiThrottle } from '../../../../core/throttle/throttle.constants';
import { SaveAnalysisToRecordDto } from '../dto/save-analysis.dto';
import { RecordSource, MealType } from '../../../diet/diet.types';
import {
  DomainEvents,
  AnalysisSavedToRecordEvent,
  MealRecordedEvent,
} from '../../../../core/events/domain-events';
import { PrismaService } from '../../../../core/prisma/prisma.service';
import { I18nService } from '../../../../core/i18n';
import { AnalyzeResultHelperService } from '../services/analyze-result-helper.service';
import { BehaviorService } from '../../../diet/app/services/behavior.service';
import { DailySummaryService } from '../../../diet/app/services/daily-summary.service';

type ExistingSaveRecordResult = {
  id: string;
  existed: true;
};

type CreatedSaveRecordResult = {
  id: string;
  existed: false;
  recordedAt: Date;
  totalCalories: number;
  inputType: string;
  inputImageUrl: string | null;
  mealType: MealType;
  decision: string;
  riskLevel: string | null;
  result: any;
};

@ApiTags('App 食物分析')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodAnalysisSaveController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    private readonly i18n: I18nService,
    private readonly helper: AnalyzeResultHelperService,
    private readonly behaviorService: BehaviorService,
    private readonly dailySummaryService: DailySummaryService,
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
    const record = await this.prisma.$transaction<
      ExistingSaveRecordResult | CreatedSaveRecordResult
    >(
      async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`food-analysis-save:${user.id}:${dto.analysisId}`}))
        `;

        const existingRecord = await tx.foodRecords.findFirst({
          where: {
            userId: user.id,
            analysisId: dto.analysisId,
          },
          select: { id: true },
        });
        if (existingRecord) {
          return { id: existingRecord.id, existed: true };
        }

        const analysisRecord = await tx.foodAnalysisRecords.findUnique({
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

        const recordedAt = createDto.recordedAt
          ? new Date(createDto.recordedAt)
          : new Date();

        const saved = await tx.foodRecords.create({
          data: {
            userId: user.id,
            foods: createDto.foods as Prisma.InputJsonValue,
            totalCalories: createDto.totalCalories,
            mealType: createDto.mealType as any,
            source: createDto.source as any,
            advice: createDto.advice,
            isHealthy: createDto.isHealthy,
            recordedAt,
            totalProtein: createDto.totalProtein ?? 0,
            totalFat: createDto.totalFat ?? 0,
            totalCarbs: createDto.totalCarbs ?? 0,
            nutritionScore: createDto.nutritionScore ?? 0,
            analysisId: createDto.analysisId,
            decision: createDto.decision || 'SAFE',
            riskLevel: createDto.riskLevel,
            reason: createDto.reason,
            suggestion: createDto.suggestion,
            insteadOptions: createDto.insteadOptions as Prisma.InputJsonValue,
          },
        });

        return {
          ...saved,
          existed: false,
          inputType: analysisRecord.inputType,
          inputImageUrl: analysisRecord.imageUrl,
          mealType,
          decision: createDto.decision,
          riskLevel: createDto.riskLevel,
          result,
        };
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    );

    if (record.existed) {
      return ResponseWrapper.success(
        { recordId: record.id, analysisId: dto.analysisId },
        this.i18n.t('food.analyzeSavedAsRecord'),
      );
    }

    await this.behaviorService.logDecision({
      userId: user.id,
      recordId: record.id,
      inputContext: {
        analysisId: dto.analysisId,
        inputType: record.inputType,
        mealType: record.mealType,
        foods: record.result.foods?.map((f: any) => f.name) ?? [],
      },
      inputImageUrl: record.inputImageUrl ?? undefined,
      decision: record.decision,
      riskLevel: record.riskLevel ?? undefined,
      fullResponse: {
        decision: record.result.decision,
        explanation: record.result.explanation,
        summary: record.result.summary,
      },
    });

    this.dailySummaryService
      .updateDailySummary(user.id, record.recordedAt)
      .catch(() => undefined);

    this.eventEmitter.emit(
      DomainEvents.MEAL_RECORDED,
      new MealRecordedEvent(
        user.id,
        record.mealType || 'unknown',
        (record.result.foods?.map((f: any) => f.name).filter(Boolean) || []) as string[],
        record.totalCalories || 0,
        RecordSource.DECISION,
        record.id,
      ),
    );

    this.eventEmitter.emit(
      DomainEvents.ANALYSIS_SAVED_TO_RECORD,
      new AnalysisSavedToRecordEvent(
        user.id,
        dto.analysisId,
        record.id,
        record.inputType as 'text' | 'image',
        record.mealType,
        record.result.foods?.map((f: any) => f.name) ?? [],
        record.result.totals?.calories ?? 0,
      ),
    );

    return ResponseWrapper.success(
      { recordId: record.id, analysisId: dto.analysisId },
      this.i18n.t('food.analyzeSavedAsRecord'),
    );
  }
}
