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
import { JwtAuthGuard } from '../admin/guards/jwt-auth.guard';
import { RolesGuard } from '../admin/guards/roles.guard';
import { Roles } from '../admin/decorators/roles.decorator';
import { ApiResponse } from '../common/types/response.type';
import { FoodPipelineOrchestratorService } from './services/food-pipeline-orchestrator.service';
import { UsdaFetcherService } from './services/usda-fetcher.service';
import { OpenFoodFactsService } from './services/openfoodfacts.service';
import { FoodRuleEngineService } from './services/food-rule-engine.service';
import { FoodAiLabelService } from './services/food-ai-label.service';
import { FoodImageRecognitionService } from './services/food-image-recognition.service';
import { FoodQualityMonitorService } from './services/food-quality-monitor.service';

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
  ) {}

  // ==================== USDA 数据导入 ====================

  @Post('import/usda')
  @ApiOperation({ summary: 'USDA 数据导入' })
  async importUsda(
    @Body() body: { query: string; maxItems?: number },
  ): Promise<ApiResponse> {
    const result = await this.orchestrator.importFromUsda(body.query, body.maxItems || 100);
    return { success: true, code: HttpStatus.OK, message: '导入完成', data: result };
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
      return { success: false, code: HttpStatus.NOT_FOUND, message: '未找到产品', data: null };
    }
    return { success: true, code: HttpStatus.OK, message: '查询成功', data: food };
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
    return { success: true, code: HttpStatus.OK, message: 'AI标注完成', data: result };
  }

  @Post('ai/translate')
  @ApiOperation({ summary: '批量 AI 翻译' })
  async batchAiTranslate(
    @Body() body: { targetLocale: string; limit?: number; untranslatedOnly?: boolean },
  ): Promise<ApiResponse> {
    const result = await this.orchestrator.batchAiTranslate(body);
    return { success: true, code: HttpStatus.OK, message: '翻译完成', data: result };
  }

  // ==================== 规则引擎 ====================

  @Post('rules/apply')
  @ApiOperation({ summary: '批量应用规则引擎（计算分数和标签）' })
  async batchApplyRules(
    @Body() body: { limit?: number; recalcAll?: boolean },
  ): Promise<ApiResponse> {
    const result = await this.orchestrator.batchApplyRules(body);
    return { success: true, code: HttpStatus.OK, message: '规则计算完成', data: result };
  }

  // ==================== 冲突解决 ====================

  @Post('conflicts/resolve-all')
  @ApiOperation({ summary: '自动解决所有待处理冲突' })
  async resolveAllConflicts(): Promise<ApiResponse> {
    const result = await this.orchestrator.resolveAllConflicts();
    return { success: true, code: HttpStatus.OK, message: '冲突解决完成', data: result };
  }

  // ==================== 图片识别 ====================

  @Post('recognize/image')
  @ApiOperation({ summary: '食物图片识别' })
  @UseInterceptors(FileInterceptor('image'))
  async recognizeImage(@UploadedFile() file: any): Promise<ApiResponse> {
    if (!file) {
      return { success: false, code: HttpStatus.BAD_REQUEST, message: '请上传图片', data: null };
    }
    const imageBase64 = file.buffer.toString('base64');
    const results = await this.imageRecognition.recognizeFood(imageBase64);
    return { success: true, code: HttpStatus.OK, message: '识别完成', data: results };
  }

  @Post('recognize/url')
  @ApiOperation({ summary: '通过URL识别食物图片' })
  async recognizeImageByUrl(@Body() body: { imageUrl: string }): Promise<ApiResponse> {
    const results = await this.imageRecognition.recognizeFoodByUrl(body.imageUrl);
    return { success: true, code: HttpStatus.OK, message: '识别完成', data: results };
  }

  // ==================== 数据质量监控 ====================

  @Get('quality/report')
  @ApiOperation({ summary: '数据质量监控报告' })
  async getQualityReport(): Promise<ApiResponse> {
    const report = await this.qualityMonitor.generateReport();
    return { success: true, code: HttpStatus.OK, message: '获取成功', data: report };
  }
}
