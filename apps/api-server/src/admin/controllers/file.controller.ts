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
  Delete,
  Param,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiResponse as SwaggerResponse,
  ApiConsumes,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RolesGuard } from '../guards/roles.guard';
import { Roles } from '../decorators/roles.decorator';
import { StorageService } from '../../storage/storage.service';
import {
  UploadFileDto,
  PresignedUploadDto,
  UploadResponseDto,
  PresignedUploadResponseDto,
  FileCategory,
} from '../../storage/dto/upload.dto';
import { ApiResponse } from '../../common/types/response.type';

/** 管理后台最大上传 500MB（App 安装包可能较大） */
const MAX_FILE_SIZE = 500 * 1024 * 1024;

@ApiTags('文件管理')
@Controller('admin/files')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
@ApiBearerAuth()
export class FileController {
  constructor(private readonly storageService: StorageService) {}

  @Post('upload')
  @ApiOperation({ summary: '上传文件（管理后台通用）' })
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
  ): Promise<ApiResponse> {
    const category = dto.category || FileCategory.GENERAL;
    const result = await this.storageService.upload(
      file.buffer,
      file.originalname,
      file.mimetype,
      category,
    );
    return {
      success: true,
      code: HttpStatus.CREATED,
      message: '文件上传成功',
      data: result,
    };
  }

  @Post('presigned-url')
  @ApiOperation({ summary: '获取预签名上传 URL（客户端直传）' })
  @SwaggerResponse({ status: 200, type: PresignedUploadResponseDto })
  async getPresignedUrl(@Body() dto: PresignedUploadDto): Promise<ApiResponse> {
    const category = dto.category || FileCategory.GENERAL;
    const result = await this.storageService.getPresignedUploadUrl(
      dto.fileName,
      dto.mimeType,
      category,
    );
    return {
      success: true,
      code: HttpStatus.OK,
      message: '获取预签名 URL 成功',
      data: result,
    };
  }

  @Delete('*key')
  @ApiOperation({ summary: '删除文件' })
  async deleteFile(@Param('key') key: string): Promise<ApiResponse> {
    await this.storageService.delete(key);
    return {
      success: true,
      code: HttpStatus.OK,
      message: '文件删除成功',
      data: null,
    };
  }
}
