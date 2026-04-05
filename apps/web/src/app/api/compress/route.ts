import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

export const runtime = 'nodejs';
export const maxDuration = 60; // 最大执行时间 60 秒

interface CompressOptions {
  quality?: number; // 压缩质量 (1-100)
  maxWidth?: number; // 最大宽度
  maxHeight?: number; // 最大高度
  keepFormat?: boolean; // 是否保持原格式
}

// 获取文件的 MIME 类型
function getMimeType(filename: string): string {
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

// 压缩单张图片
async function compressImage(
  buffer: Buffer,
  filename: string,
  options: CompressOptions
): Promise<{ buffer: Buffer; format: string; originalSize: number; compressedSize: number }> {
  const { quality = 85, maxWidth, maxHeight, keepFormat = true } = options;
  const originalSize = buffer.length;
  const mimeType = getMimeType(filename);

  let sharpInstance = sharp(buffer);
  const metadata = await sharpInstance.metadata();

  // 调整尺寸（如果需要）
  if (maxWidth || maxHeight) {
    const currentWidth = metadata.width || 0;
    const currentHeight = metadata.height || 0;

    if ((maxWidth && currentWidth > maxWidth) || (maxHeight && currentHeight > maxHeight)) {
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

  // 根据原始格式选择压缩策略
  if (mimeType === 'image/png' && keepFormat) {
    // PNG: 使用 palette 量化（类似 pngquant 的效果）
    // 尝试颜色量化压缩
    outputBuffer = await sharpInstance
      .png({
        quality: quality,
        compressionLevel: 9, // 最高压缩级别
        palette: true, // 启用调色板模式（类似 pngquant）
        effort: 10, // 最大努力
        colors: 256, // 最多 256 色
      })
      .toBuffer();
    outputFormat = 'image/png';

    // 如果量化后反而变大，尝试不使用 palette
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
            : undefined
        )
        .png({
          compressionLevel: 9,
          palette: false,
        })
        .toBuffer();

      if (noPaletteBuffer.length < outputBuffer.length) {
        outputBuffer = noPaletteBuffer;
      }
    }
  } else if (mimeType === 'image/webp' && keepFormat) {
    // WebP: 有损压缩
    outputBuffer = await sharpInstance
      .webp({
        quality: quality,
        effort: 6, // 压缩努力程度
        smartSubsample: true, // 智能色度子采样
      })
      .toBuffer();
    outputFormat = 'image/webp';
  } else if (mimeType === 'image/gif' && keepFormat) {
    // GIF: 保持格式，优化调色板
    outputBuffer = await sharpInstance
      .gif({
        effort: 10,
        colours: 256,
      })
      .toBuffer();
    outputFormat = 'image/gif';
  } else {
    // JPEG 或其他: 使用 mozjpeg 压缩
    outputBuffer = await sharpInstance
      .jpeg({
        quality: quality,
        mozjpeg: true, // 使用 mozjpeg 编码器（更好的压缩）
        chromaSubsampling: '4:2:0', // 色度子采样
        trellisQuantisation: true, // 网格量化
        overshootDeringing: true, // 过冲消除
        optimiseScans: true, // 优化扫描
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

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];
    const quality = parseInt(formData.get('quality') as string) || 85;
    const maxWidth = formData.get('maxWidth')
      ? parseInt(formData.get('maxWidth') as string)
      : undefined;
    const maxHeight = formData.get('maxHeight')
      ? parseInt(formData.get('maxHeight') as string)
      : undefined;
    const keepFormat = formData.get('keepFormat') !== 'false';

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 });
    }

    // 限制文件数量
    if (files.length > 20) {
      return NextResponse.json({ error: 'Maximum 20 files allowed' }, { status: 400 });
    }

    const results = [];

    for (const file of files) {
      try {
        // 检查文件类型
        if (!file.type.startsWith('image/')) {
          results.push({
            filename: file.name,
            error: 'Not an image file',
          });
          continue;
        }

        // 限制单个文件大小 (50MB)
        if (file.size > 50 * 1024 * 1024) {
          results.push({
            filename: file.name,
            error: 'File too large (max 50MB)',
          });
          continue;
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const compressed = await compressImage(buffer, file.name, {
          quality,
          maxWidth,
          maxHeight,
          keepFormat,
        });

        // 将压缩后的图片转为 base64
        const base64 = compressed.buffer.toString('base64');

        results.push({
          filename: file.name,
          originalSize: compressed.originalSize,
          compressedSize: compressed.compressedSize,
          format: compressed.format,
          data: `data:${compressed.format};base64,${base64}`,
        });
      } catch (error) {
        console.error(`Error compressing ${file.name}:`, error);
        results.push({
          filename: file.name,
          error: error instanceof Error ? error.message : 'Compression failed',
        });
      }
    }

    return NextResponse.json({
      success: true,
      results,
    });
  } catch (error) {
    console.error('Compression API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// 健康检查
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'image-compress',
    features: ['png-palette', 'mozjpeg', 'webp', 'gif'],
  });
}
