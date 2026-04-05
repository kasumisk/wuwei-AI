import { PDFDocument } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import { jsPDF } from 'jspdf';

// 设置 PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
}

// PDF 页面信息
export interface PdfPageInfo {
  pageNumber: number;
  width: number;
  height: number;
}

// PDF 文档信息
export interface PdfDocumentInfo {
  numPages: number;
  title?: string;
  author?: string;
  pages: PdfPageInfo[];
}

/**
 * 获取 PDF 文档信息
 */
export async function getPdfInfo(file: File): Promise<PdfDocumentInfo> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages: PdfPageInfo[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 1 });
    pages.push({
      pageNumber: i,
      width: viewport.width,
      height: viewport.height,
    });
  }

  const metadata = await pdf.getMetadata().catch(() => null);
  const info = metadata?.info as Record<string, unknown> | undefined;

  return {
    numPages: pdf.numPages,
    title: info?.Title as string | undefined,
    author: info?.Author as string | undefined,
    pages,
  };
}

/**
 * PDF 转图片 - 将 PDF 的指定页面转换为图片
 */
export async function pdfToImages(
  file: File,
  options: {
    scale?: number;
    format?: 'png' | 'jpeg';
    quality?: number;
    pages?: number[]; // 指定页码，默认全部
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<{ pageNumber: number; dataUrl: string; blob: Blob }[]> {
  const { scale = 2, format = 'png', quality = 0.92, pages, onProgress } = options;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageNumbers = pages || Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const results: { pageNumber: number; dataUrl: string; blob: Blob }[] = [];

  for (let i = 0; i < pageNumbers.length; i++) {
    const pageNum = pageNumbers[i];
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    // pdfjs-dist v5 需要 canvas 参数
    await page.render({
      canvasContext: context as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    } as Parameters<typeof page.render>[0]).promise;

    const mimeType = format === 'png' ? 'image/png' : 'image/jpeg';
    const dataUrl = canvas.toDataURL(mimeType, quality);

    // 转换为 Blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();

    results.push({
      pageNumber: pageNum,
      dataUrl,
      blob,
    });

    onProgress?.(i + 1, pageNumbers.length);
  }

  return results;
}

/**
 * 图片转 PDF - 将多张图片合并为 PDF
 */
export async function imagesToPdf(
  images: File[],
  options: {
    pageSize?: 'a4' | 'letter' | 'fit'; // fit = 适应图片大小
    orientation?: 'portrait' | 'landscape' | 'auto';
    margin?: number; // 边距（mm）
    quality?: number;
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<Blob> {
  const { pageSize = 'a4', orientation = 'auto', margin = 10, onProgress } = options;

  // 获取页面尺寸（mm）
  const pageSizes = {
    a4: { width: 210, height: 297 },
    letter: { width: 215.9, height: 279.4 },
    fit: { width: 0, height: 0 }, // 动态计算
  };

  let pdf: jsPDF | null = null;

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const dataUrl = await fileToDataUrl(image);
    const imgDimensions = await getImageDimensions(dataUrl);

    let pageWidth: number;
    let pageHeight: number;
    const imgOrientation: 'portrait' | 'landscape' =
      imgDimensions.width > imgDimensions.height ? 'landscape' : 'portrait';

    if (pageSize === 'fit') {
      // 使用图片原始比例，转换为mm（假设 96 DPI）
      const pxToMm = 25.4 / 96;
      pageWidth = imgDimensions.width * pxToMm + margin * 2;
      pageHeight = imgDimensions.height * pxToMm + margin * 2;
    } else {
      const size = pageSizes[pageSize];
      const finalOrientation = orientation === 'auto' ? imgOrientation : orientation;

      if (finalOrientation === 'landscape') {
        pageWidth = Math.max(size.width, size.height);
        pageHeight = Math.min(size.width, size.height);
      } else {
        pageWidth = Math.min(size.width, size.height);
        pageHeight = Math.max(size.width, size.height);
      }
    }

    if (i === 0) {
      pdf = new jsPDF({
        orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pageWidth, pageHeight],
      });
    } else {
      pdf!.addPage([pageWidth, pageHeight], pageWidth > pageHeight ? 'landscape' : 'portrait');
    }

    // 计算图片在页面中的位置和大小
    const availableWidth = pageWidth - margin * 2;
    const availableHeight = pageHeight - margin * 2;
    const imgRatio = imgDimensions.width / imgDimensions.height;
    const pageRatio = availableWidth / availableHeight;

    let imgWidth: number;
    let imgHeight: number;

    if (imgRatio > pageRatio) {
      imgWidth = availableWidth;
      imgHeight = availableWidth / imgRatio;
    } else {
      imgHeight = availableHeight;
      imgWidth = availableHeight * imgRatio;
    }

    const x = margin + (availableWidth - imgWidth) / 2;
    const y = margin + (availableHeight - imgHeight) / 2;

    pdf!.addImage(dataUrl, 'JPEG', x, y, imgWidth, imgHeight, undefined, 'MEDIUM');

    onProgress?.(i + 1, images.length);
  }

  return pdf!.output('blob');
}

/**
 * PDF 提取文本
 */
export async function pdfToText(
  file: File,
  options: {
    pages?: number[];
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<{ pageNumber: number; text: string }[]> {
  const { pages, onProgress } = options;

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pageNumbers = pages || Array.from({ length: pdf.numPages }, (_, i) => i + 1);
  const results: { pageNumber: number; text: string }[] = [];

  for (let i = 0; i < pageNumbers.length; i++) {
    const pageNum = pageNumbers[i];
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const text = textContent.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    results.push({
      pageNumber: pageNum,
      text,
    });

    onProgress?.(i + 1, pageNumbers.length);
  }

  return results;
}

/**
 * PDF 合并 - 将多个 PDF 合并为一个
 */
export async function mergePdfs(
  files: File[],
  options: {
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<Blob> {
  const { onProgress } = options;

  const mergedPdf = await PDFDocument.create();

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

    for (const page of pages) {
      mergedPdf.addPage(page);
    }

    onProgress?.(i + 1, files.length);
  }

  const pdfBytes = await mergedPdf.save();
  return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
}

/**
 * PDF 拆分 - 将 PDF 按页拆分
 */
export async function splitPdf(
  file: File,
  options: {
    ranges?: { start: number; end: number }[]; // 页码范围，从1开始
    onProgress?: (current: number, total: number) => void;
  } = {}
): Promise<{ range: string; blob: Blob }[]> {
  const { ranges, onProgress } = options;

  const arrayBuffer = await file.arrayBuffer();
  const sourcePdf = await PDFDocument.load(arrayBuffer);
  const totalPages = sourcePdf.getPageCount();

  // 如果没有指定范围，则每页拆分为一个文件
  const splitRanges =
    ranges || Array.from({ length: totalPages }, (_, i) => ({ start: i + 1, end: i + 1 }));

  const results: { range: string; blob: Blob }[] = [];

  for (let i = 0; i < splitRanges.length; i++) {
    const { start, end } = splitRanges[i];
    const newPdf = await PDFDocument.create();

    // 复制指定范围的页面
    const pageIndices = Array.from({ length: end - start + 1 }, (_, j) => start - 1 + j);
    const pages = await newPdf.copyPages(sourcePdf, pageIndices);

    for (const page of pages) {
      newPdf.addPage(page);
    }

    const pdfBytes = await newPdf.save();
    const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });

    results.push({
      range: start === end ? `${start}` : `${start}-${end}`,
      blob,
    });

    onProgress?.(i + 1, splitRanges.length);
  }

  return results;
}

/**
 * PDF 转 Base64
 */
export async function pdfToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 移除 data:application/pdf;base64, 前缀
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Base64 转 PDF
 */
export function base64ToPdf(base64: string): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

// 辅助函数：文件转 DataURL
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// 辅助函数：获取图片尺寸
function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = reject;
    img.src = dataUrl;
  });
}

// 格式化文件大小
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}
