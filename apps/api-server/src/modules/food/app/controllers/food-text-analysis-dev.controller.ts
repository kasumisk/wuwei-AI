import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiResponse,
  ResponseWrapper,
} from '../../../../common/types/response.type';
import { Locale } from '../../../diet/app/recommendation/utils/i18n-messages';
import { AnalyzeTextDto } from '../dto/analyze-text.dto';
import { TextFoodAnalysisService } from '../services/text-food-analysis.service';

@ApiTags('Dev 食物分析')
@Controller('dev/food')
export class FoodTextAnalysisDevController {
  private readonly logger = new Logger(FoodTextAnalysisDevController.name);

  constructor(
    private readonly textFoodAnalysisService: TextFoodAnalysisService,
    private readonly config: ConfigService,
  ) {}

  @Post('analyze-text')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '本地测试文本食物分析（无登录、无额度、无持久化）',
  })
  @ApiBody({ type: AnalyzeTextDto })
  async analyzeText(@Body() dto: AnalyzeTextDto): Promise<ApiResponse> {
    this.assertEnabled();

    const locale = (dto.locale || 'zh-CN') as Locale;
    this.logger.log(
      `[DevAnalyzeText] start mealType=${dto.mealType || 'none'} locale=${locale} textLength=${dto.text?.trim().length || 0}`,
    );

    const result = await this.textFoodAnalysisService.analyze(
      dto.text,
      dto.mealType,
      undefined,
      locale,
      dto.contextOverride?.localHour,
      dto.hints,
      {
        persistRecord: false,
        emitCompletedEvent: false,
        awaitPersistence: false,
      },
    );

    return ResponseWrapper.success(result, 'dev text analysis complete');
  }

  private assertEnabled(): void {
    const nodeEnv = this.config.get<string>('NODE_ENV') || 'development';
    const enabled =
      this.config.get<string>('ENABLE_TEXT_ANALYSIS_TEST_ENDPOINT') === 'true';

    if (nodeEnv === 'production' || !enabled) {
      throw new NotFoundException();
    }
  }
}
