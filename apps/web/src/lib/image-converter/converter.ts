/**
 * 图片格式转换核心逻辑
 */

import { IMAGE_FORMATS, getFormatFromMimeType, getFormatFromExtension } from './formats';
import { loadImage, createCanvas, generateOutputFilename, calculateNewDimensions } from './utils';

export interface ConvertOptions {
  targetFormat: string;
  quality: number; // 0-100
  width?: number;
  height?: number;
  maintainAspectRatio: boolean;
  backgroundColor?: string; // For formats that don't support transparency
}

export interface ConvertResult {
  blob: Blob;
  filename: string;
  originalSize: number;
  convertedSize: number;
  width: number;
  height: number;
  format: string;
  url: string;
}

export interface ImageInfo {
  file: File;
  name: string;
  size: number;
  type: string;
  format: string | null;
  width: number;
  height: number;
  url: string;
}

export async function getImageInfo(file: File): Promise<ImageInfo> {
  const img = await loadImage(file);
  const format = getFormatFromMimeType(file.type) || getFormatFromExtension(file.name);

  return {
    file,
    name: file.name,
    size: file.size,
    type: file.type,
    format,
    width: img.naturalWidth,
    height: img.naturalHeight,
    url: URL.createObjectURL(file),
  };
}

export async function convertImage(file: File, options: ConvertOptions): Promise<ConvertResult> {
  const img = await loadImage(file);
  const format = IMAGE_FORMATS[options.targetFormat];

  if (!format) {
    throw new Error(`Unsupported format: ${options.targetFormat}`);
  }

  // Calculate dimensions
  const { width, height } = calculateNewDimensions(
    img.naturalWidth,
    img.naturalHeight,
    options.width,
    options.height,
    options.maintainAspectRatio
  );

  // Create canvas
  const { canvas, ctx } = createCanvas(width, height);

  // Fill background for formats that don't support transparency
  if (!format.supportsTransparency || options.backgroundColor) {
    ctx.fillStyle = options.backgroundColor || '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
  }

  // Draw image
  ctx.drawImage(img, 0, 0, width, height);

  // Convert to blob
  const quality = format.supportsQuality ? options.quality / 100 : undefined;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Failed to convert image'));
        }
      },
      format.mimeType,
      quality
    );
  });

  // Generate filename
  const filename = generateOutputFilename(file.name, options.targetFormat, format.extension);

  // Clean up
  URL.revokeObjectURL(img.src);

  return {
    blob,
    filename,
    originalSize: file.size,
    convertedSize: blob.size,
    width,
    height,
    format: options.targetFormat,
    url: URL.createObjectURL(blob),
  };
}

export async function convertImages(
  files: File[],
  options: ConvertOptions,
  onProgress?: (current: number, total: number, result?: ConvertResult) => void
): Promise<ConvertResult[]> {
  const results: ConvertResult[] = [];

  for (let i = 0; i < files.length; i++) {
    try {
      const result = await convertImage(files[i], options);
      results.push(result);
      onProgress?.(i + 1, files.length, result);
    } catch (error) {
      console.error(`Failed to convert ${files[i].name}:`, error);
      onProgress?.(i + 1, files.length);
    }
  }

  return results;
}
