'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  Download,
  Crop,
  X,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  RefreshCw,
  Loader2,
  Image as ImageIcon,
  Lock,
  Unlock,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/** 裁切区域（基于原始图片像素坐标） */
interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type AspectOption = {
  label?: string;
  labelKey?: string;
  value: number | null;
};

const ASPECT_OPTIONS: AspectOption[] = [
  { labelKey: 'aspectFree', value: null },
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
  { label: '3:2', value: 3 / 2 },
  { label: '2:3', value: 2 / 3 },
];

const OUTPUT_FORMATS = [
  { label: 'PNG', value: 'image/png', ext: '.png' },
  { label: 'JPEG', value: 'image/jpeg', ext: '.jpg' },
  { label: 'WebP', value: 'image/webp', ext: '.webp' },
];

/** 拖拽手柄类型 */
type HandleType =
  | 'nw'
  | 'ne'
  | 'sw'
  | 'se'
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'move'
  | null;

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

export function ImageCropper() {
  const t = useTranslations('components.imageCropper');
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [originalSize, setOriginalSize] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [aspectIndex, setAspectIndex] = useState(0);
  const [outputFormat, setOutputFormat] = useState(0);
  const [quality, setQuality] = useState(92);
  const [isExporting, setIsExporting] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [resultSize, setResultSize] = useState(0);

  // 原始图片尺寸
  const [imgNatW, setImgNatW] = useState(0);
  const [imgNatH, setImgNatH] = useState(0);

  // 裁切矩形（原始图片像素坐标）
  const [cropRect, setCropRect] = useState<CropRect>({ x: 0, y: 0, w: 0, h: 0 });

  // 尺寸输入（字符串，支持用户输入）
  const [inputW, setInputW] = useState('');
  const [inputH, setInputH] = useState('');
  const [lockRatio, setLockRatio] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const resultBlobRef = useRef<Blob | null>(null);

  // 绘图比例（canvas展示像素 vs 原图像素）
  const scaleRef = useRef(1);
  const offsetRef = useRef({ x: 0, y: 0 });

  // 拖拽状态
  const dragRef = useRef<{
    type: HandleType;
    startX: number;
    startY: number;
    startRect: CropRect;
  } | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (!file) return;
    setFileName(file.name);
    setOriginalSize(file.size);

    const reader = new FileReader();
    reader.onload = () => {
      setImageSrc(reader.result as string);
      resetCropState();
    };
    reader.readAsDataURL(file);
  }, []);

  const resetCropState = () => {
    setCropRect({ x: 0, y: 0, w: 0, h: 0 });
    setInputW('');
    setInputH('');
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setResultUrl(null);
    setResultSize(0);
    resultBlobRef.current = null;
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] },
    maxFiles: 1,
    multiple: false,
  });

  // 加载图片并初始化 canvas
  useEffect(() => {
    if (!imageSrc) return;
    const img = new window.Image();
    img.onload = () => {
      imgRef.current = img;
      setImgNatW(img.naturalWidth);
      setImgNatH(img.naturalHeight);
      // 默认选区为整张图
      const rect = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
      setCropRect(rect);
      setInputW(String(img.naturalWidth));
      setInputH(String(img.naturalHeight));
      drawCanvas(img, rect);
    };
    img.src = imageSrc;
  }, [imageSrc]);

  // 窗口变化刷新
  useEffect(() => {
    const handleResize = () => {
      if (imgRef.current) drawCanvas(imgRef.current, cropRect);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [cropRect]);

  /** 绘制 canvas：图片 + 暗化遮罩 + 裁切框 + 手柄 */
  const drawCanvas = useCallback(
    (img: HTMLImageElement, rect: CropRect) => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;

      const cw = container.clientWidth;
      const ch = 500;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;

      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);

      // 计算图片在 canvas 中的缩放和偏移
      const scale = Math.min(cw / img.naturalWidth, ch / img.naturalHeight, 1);
      const drawW = img.naturalWidth * scale;
      const drawH = img.naturalHeight * scale;
      const ox = (cw - drawW) / 2;
      const oy = (ch - drawH) / 2;
      scaleRef.current = scale;
      offsetRef.current = { x: ox, y: oy };

      // 清空
      ctx.clearRect(0, 0, cw, ch);

      // 背景方格（透明指示）
      ctx.fillStyle = '#e5e5e5';
      ctx.fillRect(0, 0, cw, ch);
      const gridSize = 10;
      ctx.fillStyle = '#d4d4d4';
      for (let gx = 0; gx < cw; gx += gridSize * 2) {
        for (let gy = 0; gy < ch; gy += gridSize * 2) {
          ctx.fillRect(gx, gy, gridSize, gridSize);
          ctx.fillRect(gx + gridSize, gy + gridSize, gridSize, gridSize);
        }
      }

      // 绘制图片
      ctx.drawImage(img, ox, oy, drawW, drawH);

      // 暗化遮罩
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, cw, ch);

      // 裁切区域（清除遮罩、重绘该区域图片）
      const sx = ox + rect.x * scale;
      const sy = oy + rect.y * scale;
      const sw = rect.w * scale;
      const sh = rect.h * scale;

      ctx.save();
      ctx.beginPath();
      ctx.rect(sx, sy, sw, sh);
      ctx.clip();
      ctx.clearRect(sx, sy, sw, sh);
      // 重绘方格背景
      ctx.fillStyle = '#e5e5e5';
      ctx.fillRect(sx, sy, sw, sh);
      ctx.fillStyle = '#d4d4d4';
      for (let gx = sx - (sx % (gridSize * 2)); gx < sx + sw; gx += gridSize * 2) {
        for (let gy = sy - (sy % (gridSize * 2)); gy < sy + sh; gy += gridSize * 2) {
          ctx.fillRect(gx, gy, gridSize, gridSize);
          ctx.fillRect(gx + gridSize, gy + gridSize, gridSize, gridSize);
        }
      }
      ctx.drawImage(img, ox, oy, drawW, drawH);
      ctx.restore();

      // 裁切框边框
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 2;
      ctx.strokeRect(sx, sy, sw, sh);

      // 三等分线
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1;
      for (let i = 1; i <= 2; i++) {
        // 竖线
        ctx.beginPath();
        ctx.moveTo(sx + (sw / 3) * i, sy);
        ctx.lineTo(sx + (sw / 3) * i, sy + sh);
        ctx.stroke();
        // 横线
        ctx.beginPath();
        ctx.moveTo(sx, sy + (sh / 3) * i);
        ctx.lineTo(sx + sw, sy + (sh / 3) * i);
        ctx.stroke();
      }

      // 角手柄 + 边手柄
      const handleSize = 8;
      ctx.fillStyle = '#3b82f6';
      const handles = [
        [sx, sy], // nw
        [sx + sw, sy], // ne
        [sx, sy + sh], // sw
        [sx + sw, sy + sh], // se
        [sx + sw / 2, sy], // n
        [sx + sw / 2, sy + sh], // s
        [sx + sw, sy + sh / 2], // e
        [sx, sy + sh / 2], // w
      ];
      handles.forEach(([hx, hy]) => {
        ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1;
        ctx.strokeRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
      });

      // 尺寸标签
      ctx.fillStyle = 'rgba(59,130,246,0.85)';
      const labelText = `${Math.round(rect.w)} × ${Math.round(rect.h)}`;
      ctx.font = '12px sans-serif';
      const textW = ctx.measureText(labelText).width;
      const labelX = sx + sw / 2 - textW / 2 - 6;
      const labelY = sy + sh + 4;
      ctx.fillRect(labelX, labelY, textW + 12, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(labelText, labelX + 6, labelY + 14);
    },
    []
  );

  // 重绘 when cropRect changes
  useEffect(() => {
    if (imgRef.current && cropRect.w > 0) {
      drawCanvas(imgRef.current, cropRect);
    }
  }, [cropRect, drawCanvas]);

  /** 将 canvas 坐标转化为原图像素坐标 */
  const canvasToImg = (cx: number, cy: number) => {
    const scale = scaleRef.current;
    const off = offsetRef.current;
    return {
      x: (cx - off.x) / scale,
      y: (cy - off.y) / scale,
    };
  };

  /** 检测鼠标位于哪个手柄上 */
  const hitTest = (cx: number, cy: number): HandleType => {
    const scale = scaleRef.current;
    const off = offsetRef.current;
    const r = cropRect;
    const sx = off.x + r.x * scale;
    const sy = off.y + r.y * scale;
    const sw = r.w * scale;
    const sh = r.h * scale;

    const margin = 8;
    const corners: { type: HandleType; x: number; y: number }[] = [
      { type: 'nw', x: sx, y: sy },
      { type: 'ne', x: sx + sw, y: sy },
      { type: 'sw', x: sx, y: sy + sh },
      { type: 'se', x: sx + sw, y: sy + sh },
      { type: 'n', x: sx + sw / 2, y: sy },
      { type: 's', x: sx + sw / 2, y: sy + sh },
      { type: 'e', x: sx + sw, y: sy + sh / 2 },
      { type: 'w', x: sx, y: sy + sh / 2 },
    ];
    for (const c of corners) {
      if (Math.abs(cx - c.x) <= margin && Math.abs(cy - c.y) <= margin) {
        return c.type;
      }
    }
    // 在裁切区域内 => move
    if (cx >= sx && cx <= sx + sw && cy >= sy && cy <= sy + sh) {
      return 'move';
    }
    return null;
  };

  const getCursorStyle = (type: HandleType): string => {
    switch (type) {
      case 'nw':
      case 'se':
        return 'nwse-resize';
      case 'ne':
      case 'sw':
        return 'nesw-resize';
      case 'n':
      case 's':
        return 'ns-resize';
      case 'e':
      case 'w':
        return 'ew-resize';
      case 'move':
        return 'move';
      default:
        return 'crosshair';
    }
  };

  /** 根据选区、宽高比锁定、约束来计算新的矩形 */
  const applyAspect = (rect: CropRect, anchor: HandleType): CropRect => {
    const aspect = ASPECT_OPTIONS[aspectIndex].value;
    if (!aspect || anchor === 'move') return rect;

    let { x, y, w, h } = rect;
    // 根据宽度调整高度
    h = w / aspect;
    // 确保不超出图片
    if (y + h > imgNatH) {
      h = imgNatH - y;
      w = h * aspect;
    }
    if (x + w > imgNatW) {
      w = imgNatW - x;
      h = w / aspect;
    }
    return { x, y, w: Math.max(1, w), h: Math.max(1, h) };
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const br = canvas.getBoundingClientRect();
    const cx = e.clientX - br.left;
    const cy = e.clientY - br.top;

    const type = hitTest(cx, cy);
    if (type) {
      dragRef.current = {
        type,
        startX: cx,
        startY: cy,
        startRect: { ...cropRect },
      };
    } else {
      // 在图片区域外裁切框 => 新建裁切框
      const imgPt = canvasToImg(cx, cy);
      if (
        imgPt.x >= 0 &&
        imgPt.x <= imgNatW &&
        imgPt.y >= 0 &&
        imgPt.y <= imgNatH
      ) {
        const newRect = {
          x: clamp(imgPt.x, 0, imgNatW),
          y: clamp(imgPt.y, 0, imgNatH),
          w: 1,
          h: 1,
        };
        setCropRect(newRect);
        dragRef.current = {
          type: 'se',
          startX: cx,
          startY: cy,
          startRect: newRect,
        };
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const br = canvas.getBoundingClientRect();
    const cx = e.clientX - br.left;
    const cy = e.clientY - br.top;

    // 更新光标
    if (!dragRef.current) {
      const type = hitTest(cx, cy);
      canvas.style.cursor = getCursorStyle(type);
      return;
    }

    const { type, startX, startY, startRect } = dragRef.current;
    const scale = scaleRef.current;
    const dx = (cx - startX) / scale;
    const dy = (cy - startY) / scale;

    let newRect = { ...startRect };

    switch (type) {
      case 'move': {
        newRect.x = clamp(startRect.x + dx, 0, imgNatW - startRect.w);
        newRect.y = clamp(startRect.y + dy, 0, imgNatH - startRect.h);
        break;
      }
      case 'se': {
        newRect.w = clamp(startRect.w + dx, 1, imgNatW - startRect.x);
        newRect.h = clamp(startRect.h + dy, 1, imgNatH - startRect.y);
        break;
      }
      case 'nw': {
        const nx = clamp(startRect.x + dx, 0, startRect.x + startRect.w - 1);
        const ny = clamp(startRect.y + dy, 0, startRect.y + startRect.h - 1);
        newRect.w = startRect.x + startRect.w - nx;
        newRect.h = startRect.y + startRect.h - ny;
        newRect.x = nx;
        newRect.y = ny;
        break;
      }
      case 'ne': {
        const ny = clamp(startRect.y + dy, 0, startRect.y + startRect.h - 1);
        newRect.w = clamp(startRect.w + dx, 1, imgNatW - startRect.x);
        newRect.h = startRect.y + startRect.h - ny;
        newRect.y = ny;
        break;
      }
      case 'sw': {
        const nx = clamp(startRect.x + dx, 0, startRect.x + startRect.w - 1);
        newRect.w = startRect.x + startRect.w - nx;
        newRect.h = clamp(startRect.h + dy, 1, imgNatH - startRect.y);
        newRect.x = nx;
        break;
      }
      case 'n': {
        const ny = clamp(startRect.y + dy, 0, startRect.y + startRect.h - 1);
        newRect.h = startRect.y + startRect.h - ny;
        newRect.y = ny;
        break;
      }
      case 's': {
        newRect.h = clamp(startRect.h + dy, 1, imgNatH - startRect.y);
        break;
      }
      case 'e': {
        newRect.w = clamp(startRect.w + dx, 1, imgNatW - startRect.x);
        break;
      }
      case 'w': {
        const nx = clamp(startRect.x + dx, 0, startRect.x + startRect.w - 1);
        newRect.w = startRect.x + startRect.w - nx;
        newRect.x = nx;
        break;
      }
    }

    newRect = applyAspect(newRect, type);
    setCropRect(newRect);
    setInputW(String(Math.round(newRect.w)));
    setInputH(String(Math.round(newRect.h)));
  };

  const handleMouseUp = () => {
    dragRef.current = null;
  };

  /** 宽度输入变更 */
  const handleWidthChange = (val: string) => {
    setInputW(val);
    const w = parseInt(val, 10);
    if (isNaN(w) || w <= 0) return;
    const clamped = clamp(w, 1, imgNatW - cropRect.x);
    const newRect = { ...cropRect, w: clamped };
    if (lockRatio && cropRect.w > 0) {
      const ratio = cropRect.h / cropRect.w;
      newRect.h = clamp(Math.round(clamped * ratio), 1, imgNatH - cropRect.y);
      setInputH(String(newRect.h));
    }
    const aspect = ASPECT_OPTIONS[aspectIndex].value;
    if (aspect) {
      newRect.h = clamp(Math.round(clamped / aspect), 1, imgNatH - cropRect.y);
      setInputH(String(newRect.h));
    }
    setCropRect(newRect);
  };

  /** 高度输入变更 */
  const handleHeightChange = (val: string) => {
    setInputH(val);
    const h = parseInt(val, 10);
    if (isNaN(h) || h <= 0) return;
    const clamped = clamp(h, 1, imgNatH - cropRect.y);
    const newRect = { ...cropRect, h: clamped };
    if (lockRatio && cropRect.h > 0) {
      const ratio = cropRect.w / cropRect.h;
      newRect.w = clamp(Math.round(clamped * ratio), 1, imgNatW - cropRect.x);
      setInputW(String(newRect.w));
    }
    const aspect = ASPECT_OPTIONS[aspectIndex].value;
    if (aspect) {
      newRect.w = clamp(Math.round(clamped * aspect), 1, imgNatW - cropRect.x);
      setInputW(String(newRect.w));
    }
    setCropRect(newRect);
  };

  /** 应用宽高比预设 */
  const handleAspectChange = (idx: number) => {
    setAspectIndex(idx);
    const aspect = ASPECT_OPTIONS[idx].value;
    if (!aspect || cropRect.w === 0) return;
    // 以当前宽度为基准调整高度
    let newH = Math.round(cropRect.w / aspect);
    if (cropRect.y + newH > imgNatH) {
      newH = imgNatH - cropRect.y;
      const newW = Math.round(newH * aspect);
      setCropRect({ ...cropRect, w: clamp(newW, 1, imgNatW - cropRect.x), h: newH });
      setInputW(String(clamp(newW, 1, imgNatW - cropRect.x)));
      setInputH(String(newH));
    } else {
      setCropRect({ ...cropRect, h: newH });
      setInputH(String(newH));
    }
  };

  /** 导出裁切图片 */
  const handleExport = async () => {
    if (!imgRef.current || cropRect.w <= 0 || cropRect.h <= 0) return;
    setIsExporting(true);
    try {
      const img = imgRef.current;
      const fmt = OUTPUT_FORMATS[outputFormat];

      // 处理旋转/翻转后的中间 canvas
      const radians = (rotation * Math.PI) / 180;
      const sin = Math.abs(Math.sin(radians));
      const cos = Math.abs(Math.cos(radians));
      const bw = img.naturalWidth * cos + img.naturalHeight * sin;
      const bh = img.naturalWidth * sin + img.naturalHeight * cos;

      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = bw;
      tempCanvas.height = bh;
      const tCtx = tempCanvas.getContext('2d')!;
      tCtx.translate(bw / 2, bh / 2);
      tCtx.rotate(radians);
      tCtx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
      tCtx.translate(-img.naturalWidth / 2, -img.naturalHeight / 2);
      tCtx.drawImage(img, 0, 0);

      // 裁切
      const outCanvas = document.createElement('canvas');
      const rw = Math.round(cropRect.w);
      const rh = Math.round(cropRect.h);
      outCanvas.width = rw;
      outCanvas.height = rh;
      const oCtx = outCanvas.getContext('2d')!;
      oCtx.drawImage(
        tempCanvas,
        Math.round(cropRect.x),
        Math.round(cropRect.y),
        rw,
        rh,
        0,
        0,
        rw,
        rh
      );

      const blob = await new Promise<Blob>((resolve, reject) => {
        outCanvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
          fmt.value,
          quality / 100
        );
      });

      resultBlobRef.current = blob;
      setResultSize(blob.size);
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      setResultUrl(URL.createObjectURL(blob));
    } catch {
      // ignore
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownload = () => {
    if (!resultBlobRef.current) return;
    const fmt = OUTPUT_FORMATS[outputFormat];
    const baseName = fileName.replace(/\.[^.]+$/, '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(resultBlobRef.current);
    a.download = `${baseName}_cropped${fmt.ext}`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const handleClear = () => {
    if (resultUrl) URL.revokeObjectURL(resultUrl);
    setImageSrc(null);
    setFileName('');
    setOriginalSize(0);
    resetCropState();
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* 标题 */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Crop className="w-7 h-7 text-amber-500" />
          {t('title')}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t('description')}
        </p>
      </div>

      {/* 上传区域 */}
      {!imageSrc && (
        <Card>
          <CardContent className="p-0">
            <div
              {...getRootProps()}
              className={cn(
                'flex flex-col items-center justify-center gap-4 py-20 px-6 cursor-pointer rounded-lg border-2 border-dashed transition-colors',
                isDragActive
                  ? 'border-primary bg-primary/5'
                  : 'border-muted-foreground/25 hover:border-primary/50'
              )}
            >
              <input {...getInputProps()} />
              <Upload className="w-12 h-12 text-muted-foreground" />
              <div className="text-center">
                <p className="text-lg font-medium">
                  {isDragActive ? t('dropToUpload') : t('dragOrClick')}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('supportedFormats')}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 编辑区域 */}
      {imageSrc && (
        <div className="grid lg:grid-cols-[1fr_320px] gap-6">
          {/* 左侧：裁切画布 */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ImageIcon className="w-4 h-4" />
                {fileName}
                <span className="text-xs text-muted-foreground font-normal">
                  ({formatFileSize(originalSize)} · {imgNatW}×{imgNatH})
                </span>
              </CardTitle>
              <Button variant="ghost" size="sm" onClick={handleClear}>
                <X className="w-4 h-4 mr-1" />
                {t('clear')}
              </Button>
            </CardHeader>
            <CardContent>
              <div
                ref={containerRef}
                className="relative bg-muted rounded-lg overflow-hidden select-none"
                style={{ height: '500px' }}
              >
                <canvas
                  ref={canvasRef}
                  className="absolute inset-0 w-full h-full"
                  onMouseDown={handleMouseDown}
                  onMouseMove={handleMouseMove}
                  onMouseUp={handleMouseUp}
                  onMouseLeave={handleMouseUp}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {t('tipDrag')}
              </p>
            </CardContent>
          </Card>

          {/* 右侧：设置面板 */}
          <div className="space-y-4">
            {/* 裁切尺寸输入 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t('cropSize')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label className="text-xs mb-1 block">{t('width')}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={imgNatW}
                      value={inputW}
                      onChange={(e) => handleWidthChange(e.target.value)}
                      className="h-9"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0"
                    onClick={() => setLockRatio((v) => !v)}
                    title={lockRatio ? t('unlockRatio') : t('lockRatio')}
                  >
                    {lockRatio ? (
                      <Lock className="w-4 h-4" />
                    ) : (
                      <Unlock className="w-4 h-4" />
                    )}
                  </Button>
                  <div className="flex-1">
                    <Label className="text-xs mb-1 block">{t('height')}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={imgNatH}
                      value={inputH}
                      onChange={(e) => handleHeightChange(e.target.value)}
                      className="h-9"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Label className="text-xs mb-1 block">{t('xOffset')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={imgNatW - 1}
                      value={Math.round(cropRect.x)}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v)) {
                          setCropRect((r) => ({
                            ...r,
                            x: clamp(v, 0, imgNatW - r.w),
                          }));
                        }
                      }}
                      className="h-9"
                    />
                  </div>
                  <div className="flex-1">
                    <Label className="text-xs mb-1 block">{t('yOffset')}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={imgNatH - 1}
                      value={Math.round(cropRect.y)}
                      onChange={(e) => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v)) {
                          setCropRect((r) => ({
                            ...r,
                            y: clamp(v, 0, imgNatH - r.h),
                          }));
                        }
                      }}
                      className="h-9"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* 宽高比 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t('aspectRatio')}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-4 gap-2">
                  {ASPECT_OPTIONS.map((opt, idx) => (
                    <Button
                      key={opt.label}
                      variant={aspectIndex === idx ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => handleAspectChange(idx)}
                      className="text-xs"
                    >
                      {opt.labelKey ? t(opt.labelKey) : opt.label}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* 旋转和翻转 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t('rotateAndFlip')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <Label className="text-xs w-10">{t('rotate')}</Label>
                  <Slider
                    value={[rotation]}
                    min={0}
                    max={360}
                    step={1}
                    onValueChange={([v]) => setRotation(v)}
                    className="flex-1"
                  />
                  <span className="text-xs text-muted-foreground w-10 text-right">
                    {rotation}°
                  </span>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setRotation((r) => (r + 90) % 360)}
                  >
                    <RotateCw className="w-4 h-4 mr-1" />
                    +90°
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setRotation((r) => (r + 270) % 360)}
                  >
                    <RotateCcw className="w-4 h-4 mr-1" />
                    -90°
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant={flipH ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setFlipH((f) => !f)}
                  >
                    <FlipHorizontal className="w-4 h-4 mr-1" />
                    {t('flipHorizontal')}
                  </Button>
                  <Button
                    variant={flipV ? 'default' : 'outline'}
                    size="sm"
                    className="flex-1"
                    onClick={() => setFlipV((f) => !f)}
                  >
                    <FlipVertical className="w-4 h-4 mr-1" />
                    {t('flipVertical')}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 输出设置 */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">{t('outputSettings')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <Label className="text-xs mb-1.5 block">{t('format')}</Label>
                  <div className="flex gap-2">
                    {OUTPUT_FORMATS.map((fmt, idx) => (
                      <Button
                        key={fmt.value}
                        variant={outputFormat === idx ? 'default' : 'outline'}
                        size="sm"
                        className="flex-1 text-xs"
                        onClick={() => setOutputFormat(idx)}
                      >
                        {fmt.label}
                      </Button>
                    ))}
                  </div>
                </div>
                {OUTPUT_FORMATS[outputFormat].value !== 'image/png' && (
                  <div className="flex items-center gap-3">
                    <Label className="text-xs w-10">{t('quality')}</Label>
                    <Slider
                      value={[quality]}
                      min={10}
                      max={100}
                      step={1}
                      onValueChange={([v]) => setQuality(v)}
                      className="flex-1"
                    />
                    <span className="text-xs text-muted-foreground w-10 text-right">
                      {quality}%
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 操作按钮 */}
            <div className="space-y-2">
              <Button
                className="w-full"
                onClick={handleExport}
                disabled={isExporting || cropRect.w <= 0}
              >
                {isExporting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t('processing')}
                  </>
                ) : (
                  <>
                    <Crop className="w-4 h-4 mr-2" />
                    {t('cropImage')}
                  </>
                )}
              </Button>
              <Button variant="outline" className="w-full" onClick={() => {
                resetCropState();
                if (imgRef.current) {
                  const img = imgRef.current;
                  const rect = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
                  setCropRect(rect);
                  setInputW(String(img.naturalWidth));
                  setInputH(String(img.naturalHeight));
                }
              }}>
                <RefreshCw className="w-4 h-4 mr-2" />
                {t('resetSelection')}
              </Button>
            </div>

            {/* 结果预览 */}
            {resultUrl && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm">{t('cropResult')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="rounded-lg overflow-hidden border bg-muted">
                    <img
                      src={resultUrl}
                      alt="Cropped"
                      className="w-full h-auto max-h-48 object-contain"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t('fileSize', { size: formatFileSize(resultSize) })}
                  </p>
                  <Button className="w-full" onClick={handleDownload}>
                    <Download className="w-4 h-4 mr-2" />
                    {t('downloadCropped')}
                  </Button>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
