import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpStatus,
  ParseFilePipe,
  MaxFileSizeValidator,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiConsumes,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AppJwtAuthGuard } from '../../auth/app/app-jwt-auth.guard';
import { CurrentAppUser } from '../../auth/app/current-app-user.decorator';
import { AppUserPayload } from '../../auth/app/app-user-payload.type';
import { StorageService } from '../../../storage/storage.service';
import {
  UploadFileDto,
  PresignedUploadDto,
  UploadResponseDto,
  PresignedUploadResponseDto,
  FileCategory,
} from '../../../storage/dto/upload.dto';
import { ApiResponse } from '../../../common/types/response.type';
import { I18nService } from '../../../core/i18n/i18n.service';

/** App 端最大上传 20MB */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

@ApiTags('App 文件上传')
@Controller('app/files')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class AppFileController {
  constructor(
    private readonly storageService: StorageService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 上传文件（App 用户）
   * POST /api/app/files/upload
   */
  @Post('upload')
  @ApiOperation({ summary: '上传文件（App 用户）' })
  @ApiConsumes('multipart/form-data')
  @SwaggerResponse({ status: 201, type: UploadResponseDto })
  @UseInterceptors(FileInterceptor('file'))
  async upload(
    @UploadedFile(
      new ParseFilePipe({
        validators: [new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE })],
      }),
    )
    file: Express.Multer.File,
    @Body() dto: UploadFileDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const category = dto.category || FileCategory.IMAGE;
    const folder = `${category}/user-${user.id}`;
    const result = await this.storageService.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
      folder,
    );
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: this.i18n.t('file.app.uploadSuccess'),
      data: result,
    };
  }

  /**
   * 获取预签名上传 URL（App 客户端直传）
   * POST /api/app/files/presigned-url
   */
  @Post('presigned-url')
  @ApiOperation({ summary: '获取预签名上传 URL（App 客户端直传）' })
  @SwaggerResponse({ status: 200, type: PresignedUploadResponseDto })
  async getPresignedUrl(
    @Body() dto: PresignedUploadDto,
    @CurrentAppUser() user: AppUserPayload,
  ): Promise<ApiResponse> {
    const category = dto.category || FileCategory.IMAGE;
    const folder = `${category}/user-${user.id}`;
    const result = await this.storageService.getPresignedUploadUrl(
      dto.fileName,
      dto.mimeType,
      folder,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: this.i18n.t('file.app.presignedUrlSuccess'),
      data: result,
    };
  }
}
