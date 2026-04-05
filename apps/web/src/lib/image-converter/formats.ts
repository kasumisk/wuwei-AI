/**
 * 图片格式定义
 */

export interface ImageFormat {
  id: string;
  name: string;
  mimeType: string;
  extension: string;
  supportsQuality: boolean;
  supportsTransparency: boolean;
}

export const IMAGE_FORMATS: Record<string, ImageFormat> = {
  png: {
    id: 'png',
    name: 'PNG',
    mimeType: 'image/png',
    extension: '.png',
    supportsQuality: false,
    supportsTransparency: true,
  },
  jpeg: {
    id: 'jpeg',
    name: 'JPEG',
    mimeType: 'image/jpeg',
    extension: '.jpg',
    supportsQuality: true,
    supportsTransparency: false,
  },
  webp: {
    id: 'webp',
    name: 'WebP',
    mimeType: 'image/webp',
    extension: '.webp',
    supportsQuality: true,
    supportsTransparency: true,
  },
  gif: {
    id: 'gif',
    name: 'GIF',
    mimeType: 'image/gif',
    extension: '.gif',
    supportsQuality: false,
    supportsTransparency: true,
  },
  bmp: {
    id: 'bmp',
    name: 'BMP',
    mimeType: 'image/bmp',
    extension: '.bmp',
    supportsQuality: false,
    supportsTransparency: false,
  },
  ico: {
    id: 'ico',
    name: 'ICO',
    mimeType: 'image/x-icon',
    extension: '.ico',
    supportsQuality: false,
    supportsTransparency: true,
  },
};

export const INPUT_FORMATS = ['png', 'jpeg', 'webp', 'gif', 'bmp', 'svg', 'avif'];
export const OUTPUT_FORMATS = ['png', 'jpeg', 'webp', 'gif', 'bmp', 'ico'];

export const ACCEPT_FILE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/svg+xml',
  'image/avif',
].join(',');

export function getFormatFromMimeType(mimeType: string): string | null {
  const formatMap: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpeg',
    'image/jpg': 'jpeg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/x-icon': 'ico',
  };
  return formatMap[mimeType] || null;
}

export function getFormatFromExtension(filename: string): string | null {
  const ext = filename.split('.').pop()?.toLowerCase();
  const extMap: Record<string, string> = {
    png: 'png',
    jpg: 'jpeg',
    jpeg: 'jpeg',
    webp: 'webp',
    gif: 'gif',
    bmp: 'bmp',
    svg: 'svg',
    avif: 'avif',
    ico: 'ico',
  };
  return ext ? extMap[ext] || null : null;
}
