import {
  Controller,
  Post,
  Get,
  UseInterceptors,
  UploadedFiles,
  Body,
  HttpStatus,
  HttpCode,
  ParseFilePipe,
  MaxFileSizeValidator,
  FileTypeValidator,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { Public } from '../core/decorators/public.decorator';
import { CompressService } from './compress.service';

/** 50 MB */
const MAX_FILE_SIZE = 50 * 1024 * 1024;

@ApiTags('图片压缩')
@Controller('compress')
export class CompressController {
  constructor(private readonly compressService: CompressService) {}

  /**
   * 压缩图片
   * POST /api/compress
   *
   * Body (multipart/form-data):
   *   files     - 图片文件（最多 20 张）
   *   quality   - 压缩质量 1-100，默认 85
   *   maxWidth  - 最大宽度（可选）
   *   maxHeight - 最大高度（可选）
   *   keepFormat - 是否保持原格式，默认 true
   */
  @Post()
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '压缩图片（最多 20 张，单文件 50 MB）' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
        quality: { type: 'integer', minimum: 1, maximum: 100, default: 85 },
        maxWidth: { type: 'integer' },
        maxHeight: { type: 'integer' },
        keepFormat: { type: 'boolean', default: true },
      },
      required: ['files'],
    },
  })
  @ApiResponse({
    status: 200,
    description: '压缩成功',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        results: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              filename: { type: 'string' },
              originalSize: { type: 'integer' },
              compressedSize: { type: 'integer' },
              format: { type: 'string' },
              data: { type: 'string', description: 'base64 data URL' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
  })
  @UseInterceptors(FilesInterceptor('files', 20))
  async compress(
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_FILE_SIZE }),
          new FileTypeValidator({ fileType: /^image\// }),
        ],
        fileIsRequired: true,
      }),
    )
    files: Express.Multer.File[],
    @Body('quality') quality?: string,
    @Body('maxWidth') maxWidth?: string,
    @Body('maxHeight') maxHeight?: string,
    @Body('keepFormat') keepFormat?: string,
  ) {
    const results = await this.compressService.compressFiles(files, {
      quality: quality ? parseInt(quality, 10) : 85,
      maxWidth: maxWidth ? parseInt(maxWidth, 10) : undefined,
      maxHeight: maxHeight ? parseInt(maxHeight, 10) : undefined,
      keepFormat: keepFormat !== 'false',
    });

    return { success: true, results };
  }

  /**
   * 健康检查
   * GET /api/compress
   */
  @Get()
  @Public()
  @ApiOperation({ summary: '压缩服务健康检查' })
  health() {
    return {
      status: 'ok',
      service: 'compress',
      timestamp: new Date().toISOString(),
    };
  }
}
