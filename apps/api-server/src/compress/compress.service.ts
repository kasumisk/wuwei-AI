import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import sharp from 'sharp';

export interface CompressOptions {
  quality?: number;
  maxWidth?: number;
  maxHeight?: number;
  keepFormat?: boolean;
}

export interface CompressResult {
  filename: string;
  originalSize?: number;
  compressedSize?: number;
  format?: string;
  data?: string;
  error?: string;
}

@Injectable()
export class CompressService {
  private readonly logger = new Logger(CompressService.name);

  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'webp':
        return 'image/webp';
      case 'gif':
        return 'image/gif';
      case 'avif':
        return 'image/avif';
      case 'jpg':
      case 'jpeg':
      default:
        return 'image/jpeg';
    }
  }

  private async compressImage(
    buffer: Buffer,
    filename: string,
    options: CompressOptions,
  ): Promise<{
    buffer: Buffer;
    format: string;
    originalSize: number;
    compressedSize: number;
  }> {
    const { quality = 85, maxWidth, maxHeight, keepFormat = true } = options;
    const originalSize = buffer.length;
    const mimeType = this.getMimeType(filename);

    let sharpInstance = sharp(buffer);
    const metadata = await sharpInstance.metadata();

    // 按需缩放
    if (maxWidth || maxHeight) {
      const currentWidth = metadata.width || 0;
      const currentHeight = metadata.height || 0;
      if (
        (maxWidth && currentWidth > maxWidth) ||
        (maxHeight && currentHeight > maxHeight)
      ) {
        sharpInstance = sharpInstance.resize({
          width: maxWidth,
          height: maxHeight,
          fit: 'inside',
          withoutEnlargement: true,
        });
      }
    }

    let outputBuffer: Buffer;
    let outputFormat: string;

    if (mimeType === 'image/png' && keepFormat) {
      outputBuffer = await sharpInstance
        .png({
          quality,
          compressionLevel: 9,
          palette: true,
          effort: 10,
          colors: 256,
        })
        .toBuffer();
      outputFormat = 'image/png';

      if (outputBuffer.length > originalSize) {
        const noPaletteBuffer = await sharp(buffer)
          .resize(
            maxWidth
              ? {
                  width: maxWidth,
                  height: maxHeight,
                  fit: 'inside',
                  withoutEnlargement: true,
                }
              : undefined,
          )
          .png({ compressionLevel: 9, palette: false })
          .toBuffer();

        if (noPaletteBuffer.length < outputBuffer.length) {
          outputBuffer = noPaletteBuffer;
        }
      }
    } else if (mimeType === 'image/webp' && keepFormat) {
      outputBuffer = await sharpInstance
        .webp({ quality, effort: 6, smartSubsample: true })
        .toBuffer();
      outputFormat = 'image/webp';
    } else if (mimeType === 'image/gif' && keepFormat) {
      outputBuffer = await sharpInstance
        .gif({ effort: 10, colours: 256 })
        .toBuffer();
      outputFormat = 'image/gif';
    } else {
      outputBuffer = await sharpInstance
        .jpeg({
          quality,
          mozjpeg: true,
          chromaSubsampling: '4:2:0',
          trellisQuantisation: true,
          overshootDeringing: true,
          optimiseScans: true,
        })
        .toBuffer();
      outputFormat = 'image/jpeg';
    }

    return {
      buffer: outputBuffer,
      format: outputFormat,
      originalSize,
      compressedSize: outputBuffer.length,
    };
  }

  async compressFiles(
    files: Express.Multer.File[],
    options: CompressOptions,
  ): Promise<CompressResult[]> {
    if (!files || files.length === 0) {
      throw new BadRequestException('No files provided');
    }
    if (files.length > 20) {
      throw new BadRequestException('Maximum 20 files allowed');
    }

    const results: CompressResult[] = [];

    for (const file of files) {
      try {
        if (!file.mimetype.startsWith('image/')) {
          results.push({
            filename: file.originalname,
            error: 'Not an image file',
          });
          continue;
        }
        if (file.size > 50 * 1024 * 1024) {
          results.push({
            filename: file.originalname,
            error: 'File too large (max 50MB)',
          });
          continue;
        }

        const compressed = await this.compressImage(
          file.buffer,
          file.originalname,
          options,
        );
        const base64 = compressed.buffer.toString('base64');

        results.push({
          filename: file.originalname,
          originalSize: compressed.originalSize,
          compressedSize: compressed.compressedSize,
          format: compressed.format,
          data: `data:${compressed.format};base64,${base64}`,
        });
      } catch (err) {
        this.logger.error(`Error compressing ${file.originalname}`, err);
        results.push({
          filename: file.originalname,
          error: err instanceof Error ? err.message : 'Compression failed',
        });
      }
    }

    return results;
  }
}
