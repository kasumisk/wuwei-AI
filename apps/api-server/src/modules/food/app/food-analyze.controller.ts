import {
  Controller,
  Post,
  Body,
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
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { ApiResponse } from '../../../common/types/response.type';
import { StorageService } from '../../../storage/storage.service';
import { AnalyzeService } from './analyze.service';
import { AnalyzeImageDto } from 'src/modules/diet/app/food.dto';

@ApiTags('App 食物分析')
@Controller('app/food')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class FoodAnalyzeController {
  constructor(
    private readonly analyzeService: AnalyzeService,
    private readonly storageService: StorageService,
  ) {}

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
}
