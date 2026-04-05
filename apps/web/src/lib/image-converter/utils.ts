/**
 * 图片转换工具函数
 */

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function calculateSizeReduction(original: number, converted: number): string {
  const reduction = ((original - converted) / original) * 100;
  if (reduction > 0) {
    return `-${reduction.toFixed(1)}%`;
  } else if (reduction < 0) {
    return `+${Math.abs(reduction).toFixed(1)}%`;
  }
  return '0%';
}

export function generateOutputFilename(
  originalName: string,
  targetFormat: string,
  extension: string
): string {
  const baseName = originalName.replace(/\.[^/.]+$/, '');
  return `${baseName}${extension}`;
}

export async function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

export function createCanvas(
  width: number,
  height: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Failed to get canvas context');
  }
  return { canvas, ctx };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function createZipFromBlobs(
  files: Array<{ blob: Blob; filename: string }>
): Promise<Blob> {
  // 简单的 ZIP 实现，使用动态导入
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  for (const file of files) {
    zip.file(file.filename, file.blob);
  }

  return zip.generateAsync({ type: 'blob' });
}

export function calculateNewDimensions(
  originalWidth: number,
  originalHeight: number,
  targetWidth?: number,
  targetHeight?: number,
  maintainAspectRatio: boolean = true
): { width: number; height: number } {
  if (!targetWidth && !targetHeight) {
    return { width: originalWidth, height: originalHeight };
  }

  if (maintainAspectRatio) {
    const aspectRatio = originalWidth / originalHeight;

    if (targetWidth && !targetHeight) {
      return {
        width: targetWidth,
        height: Math.round(targetWidth / aspectRatio),
      };
    }

    if (targetHeight && !targetWidth) {
      return {
        width: Math.round(targetHeight * aspectRatio),
        height: targetHeight,
      };
    }

    if (targetWidth && targetHeight) {
      const widthRatio = targetWidth / originalWidth;
      const heightRatio = targetHeight / originalHeight;
      const ratio = Math.min(widthRatio, heightRatio);
      return {
        width: Math.round(originalWidth * ratio),
        height: Math.round(originalHeight * ratio),
      };
    }
  }

  return {
    width: targetWidth || originalWidth,
    height: targetHeight || originalHeight,
  };
}
