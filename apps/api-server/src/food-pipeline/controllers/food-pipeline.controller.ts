import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  UseGuards,
  HttpStatus,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../modules/auth/admin/jwt-auth.guard';
import { RolesGuard } from '../../modules/rbac/admin/roles.guard';
import { Roles } from '../../modules/rbac/admin/roles.decorator';
import { ApiResponse } from '../../common/types/response.type';
import { FoodPipelineOrchestratorService } from '../services/food-pipeline-orchestrator.service';
import { UsdaFetcherService } from '../services/fetchers/usda-fetcher.service';
import { OpenFoodFactsService } from '../services/fetchers/openfoodfacts.service';
import { FoodRuleEngineService } from '../services/processing/food-rule-engine.service';
import { FoodAiLabelService } from '../services/ai/food-ai-label.service';
import { FoodImageRecognitionService } from '../services/ai/food-image-recognition.service';
import { FoodQualityMonitorService } from '../services/food-quality-monitor.service';
import { FoodEnrichmentService } from '../services/food-enrichment.service';

@ApiTags('管理后台 - 食物数据管道')
@Controller('admin/food-pipeline')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'super_admin')
@ApiBearerAuth()
export class FoodPipelineController {
  constructor(
    private readonly orchestrator: FoodPipelineOrchestratorService,
    private readonly usdaFetcher: UsdaFetcherService,
    private readonly offService: OpenFoodFactsService,
    private readonly ruleEngine: FoodRuleEngineService,
    private readonly aiLabel: FoodAiLabelService,
    private readonly imageRecognition: FoodImageRecognitionService,
    private readonly qualityMonitor: FoodQualityMonitorService,
    private readonly enrichmentService: FoodEnrichmentService,
  ) {}

  // ==================== USDA 数据导入 ====================

  @Post('import/usda')
  @ApiOperation({ summary: 'USDA 数据导入' })
  async importUsda(
    @Body() body: { query: string; maxItems?: number },
  ): Promise<ApiResponse> {
    const result = await this.orchestrator.importFromUsda(
      body.query,
      body.maxItems || 100,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '导入完成',
      data: result,
    };
  }

  @Get('usda/search')
  @ApiOperation({ summary: 'USDA 食物搜索（预览，不入库）' })
  async searchUsda(
    @Query('query') query: string,
    @Query('pageSize') pageSize?: number,
  ): Promise<ApiResponse> {
    const data = await this.usdaFetcher.search(query, pageSize || 20);
    return { success: true, code: HttpStatus.OK, message: '搜索成功', data };
  }

  // ==================== OpenFoodFacts 条形码查询 ====================

  @Get('barcode/:code')
  @ApiOperation({ summary: '条形码查询（OpenFoodFacts）' })
  async lookupBarcode(@Param('code') code: string): Promise<ApiResponse> {
    const food = await this.orchestrator.importByBarcode(code);
    if (!food) {
      return {
        success: false,
        code: HttpStatus.NOT_FOUND,
        message: '未找到产品',
        data: null,
      };
    }
    return {
      success: true,
      code: HttpStatus.OK,
      message: '查询成功',
      data: food,
    };
  }

  @Get('openfoodfacts/search')
  @ApiOperation({ summary: 'OpenFoodFacts 搜索（预览）' })
  async searchOff(
    @Query('query') query: string,
    @Query('pageSize') pageSize?: number,
  ): Promise<ApiResponse> {
    const data = await this.offService.search(query, pageSize || 20);
    return { success: true, code: HttpStatus.OK, message: '搜索成功', data };
  }

  // ==================== AI 标注 ====================

  @Post('ai/label')
  @ApiOperation({ summary: '批量 AI 标注（分类/标签/评分）' })
  async batchAiLabel(
    @Body() body: { category?: string; unlabeled?: boolean; limit?: number },
  ): Promise<ApiResponse> {
    const result = await this.orchestrator.batchAiLabel(body);
    return {
      success: true,
      code: HttpStatus.OK,
      message: 'AI标注完成',
      data: result,
    };
  }

  @Post('ai/translate')
  @ApiOperation({ summary: '批量 AI 翻译' })
  async batchAiTranslate(
    @Body()
    body: {
      targetLocales?: string[];
      limit?: number;
      untranslatedOnly?: boolean;
    },
  ): Promise<ApiResponse> {
    const result = await this.orchestrator.batchAiTranslate(body);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '翻译完成',
      data: result,
    };
  }

  // ==================== 规则引擎 ====================

  @Post('rules/apply')
  @ApiOperation({ summary: '批量应用规则引擎（计算分数和标签）' })
  async batchApplyRules(
    @Body() body: { limit?: number; recalcAll?: boolean },
  ): Promise<ApiResponse> {
    const result = await this.orchestrator.batchApplyRules(body);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '规则计算完成',
      data: result,
    };
  }

  @Post('rules/backfill-nutrient-scores')
  @ApiOperation({
    summary:
      '批量回填营养密度分数（nutrientDensity/qualityScore/satietyScore）',
  })
  async backfillNutrientScores(
    @Body() body: { batchSize?: number },
  ): Promise<ApiResponse> {
    const result = await this.orchestrator.backfillNutrientScores(
      body.batchSize,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '回填完成',
      data: result,
    };
  }

  // ==================== 冲突解决 ====================

  @Post('conflicts/resolve-all')
  @ApiOperation({ summary: '自动解决所有待处理冲突' })
  async resolveAllConflicts(): Promise<ApiResponse> {
    const result = await this.orchestrator.resolveAllConflicts();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '冲突解决完成',
      data: result,
    };
  }

  // ==================== 图片识别 ====================

  @Post('recognize/image')
  @ApiOperation({ summary: '食物图片识别' })
  @UseInterceptors(FileInterceptor('image'))
  async recognizeImage(@UploadedFile() file: any): Promise<ApiResponse> {
    if (!file) {
      return {
        success: false,
        code: HttpStatus.BAD_REQUEST,
        message: '请上传图片',
        data: null,
      };
    }
    const imageBase64 = file.buffer.toString('base64');
    const results = await this.imageRecognition.recognizeFood(imageBase64);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '识别完成',
      data: results,
    };
  }

  @Post('recognize/url')
  @ApiOperation({ summary: '通过URL识别食物图片' })
  async recognizeImageByUrl(
    @Body() body: { imageUrl: string },
  ): Promise<ApiResponse> {
    const results = await this.imageRecognition.recognizeFoodByUrl(
      body.imageUrl,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '识别完成',
      data: results,
    };
  }

  // ==================== 数据质量监控 ====================

  @Get('quality/report')
  @ApiOperation({ summary: '数据质量监控报告' })
  async getQualityReport(): Promise<ApiResponse> {
    const report = await this.qualityMonitor.generateReport();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data: report,
    };
  }

  // ==================== V7.9: 候选食品晋升 ====================

  @Post('candidates/promote')
  @ApiOperation({ summary: 'V7.9 候选食品批量晋升为正式食物' })
  async promoteCandidates(
    @Body()
    body: {
      /** 最低置信度阈值，默认 0.7 */
      minConfidence?: number;
      /** 单次晋升上限，默认 50 */
      limit?: number;
    },
  ): Promise<ApiResponse> {
    const result = await this.orchestrator.promoteCandidates(
      body.minConfidence ?? 0.7,
      body.limit ?? 50,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: `候选晋升完成: ${result.promoted} 个成功, ${result.duplicates} 个重复`,
      data: result,
    };
  }

  // ==================== V7.9: 批量分阶段补全（即时执行） ====================

  @Post('enrichment/batch-stage')
  @ApiOperation({ summary: 'V7.9 批量分阶段 AI 补全（即时执行，不走队列）' })
  async batchEnrichByStage(
    @Body()
    body: {
      /** 指定阶段编号 1-5 */
      stages?: number[];
      /** 处理上限，默认 10 */
      limit?: number;
      /** 限定分类 */
      category?: string;
    },
  ): Promise<ApiResponse> {
    const result = await this.orchestrator.batchEnrichByStage(body);
    return {
      success: true,
      code: HttpStatus.OK,
      message: `分阶段补全完成: ${result.processed} 个食物, 补全 ${result.totalEnriched} 个字段`,
      data: result,
    };
  }

  // ==================== V7.9: 同类一致性校验 ====================

  @Get('quality/consistency/:id')
  @ApiOperation({ summary: 'V7.9 单食物同类一致性校验（IQR 离群检测）' })
  async checkConsistency(@Param('id') id: string): Promise<ApiResponse> {
    const result = await this.enrichmentService.validateCategoryConsistency(id);
    if (!result) {
      return {
        success: false,
        code: HttpStatus.NOT_FOUND,
        message: '食物不存在或同类样本不足',
        data: null,
      };
    }
    return {
      success: true,
      code: HttpStatus.OK,
      message: `发现 ${result.outliers.length} 个离群字段`,
      data: result,
    };
  }

  // ==================== V7.9: 补全统计 ====================

  @Get('enrichment/statistics')
  @ApiOperation({ summary: 'V7.9 AI 补全操作统计' })
  async getEnrichmentStatistics(): Promise<ApiResponse> {
    const data = await this.enrichmentService.getEnrichmentStatistics();
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取成功',
      data,
    };
  }
}
