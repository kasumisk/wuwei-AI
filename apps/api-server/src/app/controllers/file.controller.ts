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
import { AppJwtAuthGuard } from '../guards/app-jwt-auth.guard';
import { CurrentAppUser } from '../decorators/current-app-user.decorator';
import { StorageService } from '../../storage/storage.service';
import {
  UploadFileDto,
  PresignedUploadDto,
  UploadResponseDto,
  PresignedUploadResponseDto,
  FileCategory,
} from '../../storage/dto/upload.dto';
import { ApiResponse } from '../../common/types/response.type';

/** App 端最大上传 20MB */
const MAX_FILE_SIZE = 20 * 1024 * 1024;

@ApiTags('App 文件上传')
@Controller('app/files')
@UseGuards(AppJwtAuthGuard)
@ApiBearerAuth()
export class AppFileController {
  constructor(private readonly storageService: StorageService) {}

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
    @CurrentAppUser() user: any,
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
      message: '上传成功',
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
    @CurrentAppUser() user: any,
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
      message: '获取上传链接成功',
      data: result,
    };
  }
}
