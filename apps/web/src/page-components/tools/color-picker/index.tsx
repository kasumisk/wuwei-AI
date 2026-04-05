'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useDropzone } from 'react-dropzone';
import { Upload, Copy, Pipette, X, RefreshCw, CheckCircle, Plus, Monitor, Palette } from 'lucide-react';
import { cn } from '@/lib/utils';

// EyeDropper API 类型声明
interface EyeDropperResult {
  sRGBHex: string;
}

interface EyeDropperAPI {
  open: () => Promise<EyeDropperResult>;
}

declare global {
  interface Window {
    EyeDropper?: new () => EyeDropperAPI;
  }
}

interface ExtractedColor {
  hex: string;
  rgb: { r: number; g: number; b: number };
  hsl: { h: number; s: number; l: number };
}

// Convert RGB to HSL
function rgbToHsl(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

// Convert RGB to Hex
function rgbToHex(r: number, g: number, b: number) {
  return (
    '#' +
    [r, g, b]
      .map((x) => x.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

// Parse HEX to RGB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const match = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) {
    // Try 3-char hex
    const short = hex.replace('#', '').match(/^([0-9a-f])([0-9a-f])([0-9a-f])$/i);
    if (!short) return null;
    return { r: parseInt(short[1]+short[1], 16), g: parseInt(short[2]+short[2], 16), b: parseInt(short[3]+short[3], 16) };
  }
  return { r: parseInt(match[1], 16), g: parseInt(match[2], 16), b: parseInt(match[3], 16) };
}

// WCAG Relative Luminance
function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

// WCAG Contrast Ratio
function contrastRatio(rgb1: { r: number; g: number; b: number }, rgb2: { r: number; g: number; b: number }): number {
  const l1 = relativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const l2 = relativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getWcagLevel(ratio: number): { aa: boolean; aaLarge: boolean; aaa: boolean; aaaLarge: boolean } {
  return {
    aa: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaa: ratio >= 7,
    aaaLarge: ratio >= 4.5,
  };
}

export function ColorPicker() {
  const t = useTranslations('components.colorPicker');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [colors, setColors] = useState<ExtractedColor[]>([]);
  const [currentColor, setCurrentColor] = useState<ExtractedColor | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [isPicking, setIsPicking] = useState(false);
  const [isScreenPicking, setIsScreenPicking] = useState(false);
  const [eyeDropperSupported, setEyeDropperSupported] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [manualHex, setManualHex] = useState('');
  const [contrastBg, setContrastBg] = useState('#FFFFFF');

  // 检测 EyeDropper API 支持
  useEffect(() => {
    setEyeDropperSupported(typeof window !== 'undefined' && 'EyeDropper' in window);
  }, []);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      const url = URL.createObjectURL(file);
      setImageUrl(url);
      setColors([]);
      setCurrentColor(null);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'] },
    maxFiles: 1,
  });

  // Draw image on canvas when loaded
  useEffect(() => {
    if (!imageUrl || !canvasRef.current) return;

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      // Set canvas size to match image aspect ratio
      const maxWidth = 600;
      const maxHeight = 400;
      let width = img.naturalWidth;
      let height = img.naturalHeight;

      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      if (height > maxHeight) {
        width = (width * maxHeight) / height;
        height = maxHeight;
      }

      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
      }
      imgRef.current = img;
    };
    img.src = imageUrl;

    return () => {
      URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPicking) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Scale to canvas coordinates
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pixel = ctx.getImageData(x * scaleX, y * scaleY, 1, 1).data;
    const r = pixel[0],
      g = pixel[1],
      b = pixel[2];

    const color: ExtractedColor = {
      hex: rgbToHex(r, g, b),
      rgb: { r, g, b },
      hsl: rgbToHsl(r, g, b),
    };

    setCurrentColor(color);
    setIsPicking(false);
  };

  const handleCanvasMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isPicking) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pixel = ctx.getImageData(x * scaleX, y * scaleY, 1, 1).data;
    const r = pixel[0],
      g = pixel[1],
      b = pixel[2];

    setCurrentColor({
      hex: rgbToHex(r, g, b),
      rgb: { r, g, b },
      hsl: rgbToHsl(r, g, b),
    });
  };

  const addColorToPalette = () => {
    if (currentColor && !colors.find((c) => c.hex === currentColor.hex)) {
      setColors((prev) => [...prev, currentColor]);
    }
  };

  const removeColor = (hex: string) => {
    setColors((prev) => prev.filter((c) => c.hex !== hex));
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(text);
    setTimeout(() => setCopied(null), 1500);
  };

  // 屏幕取色功能
  const handleScreenPick = async () => {
    if (!window.EyeDropper) {
      alert(t('eyeDropperNotSupported'));
      return;
    }

    setIsScreenPicking(true);
    try {
      const eyeDropper = new window.EyeDropper();
      const result = await eyeDropper.open();

      // 解析 HEX 颜色
      const hex = result.sRGBHex.toUpperCase();
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);

      const color: ExtractedColor = {
        hex,
        rgb: { r, g, b },
        hsl: rgbToHsl(r, g, b),
      };

      setCurrentColor(color);
    } catch {
      // 用户取消选择（按 ESC），不做处理
    } finally {
      setIsScreenPicking(false);
    }
  };

  const handleReset = () => {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    setImageUrl(null);
    setColors([]);
    setCurrentColor(null);
    setIsPicking(false);
  };

  // Manual hex input
  const handleManualHexInput = (hex: string) => {
    setManualHex(hex);
    const rgb = hexToRgb(hex);
    if (rgb) {
      setCurrentColor({
        hex: rgbToHex(rgb.r, rgb.g, rgb.b),
        rgb,
        hsl: rgbToHsl(rgb.r, rgb.g, rgb.b),
      });
    }
  };

  // WCAG contrast result
  const contrastResult = currentColor ? (() => {
    const bgRgb = hexToRgb(contrastBg);
    if (!bgRgb) return null;
    const ratio = contrastRatio(currentColor.rgb, bgRgb);
    const levels = getWcagLevel(ratio);
    return { ratio: Math.round(ratio * 100) / 100, ...levels };
  })() : null;

  // CSS/Tailwind export
  const cssExport = currentColor ? {
    css: `color: ${currentColor.hex};\nbackground-color: ${currentColor.hex};`,
    cssVar: `--color-custom: ${currentColor.hex};`,
    rgb: `color: rgb(${currentColor.rgb.r}, ${currentColor.rgb.g}, ${currentColor.rgb.b});`,
    hsl: `color: hsl(${currentColor.hsl.h}, ${currentColor.hsl.s}%, ${currentColor.hsl.l}%);`,
    tailwind: `bg-[${currentColor.hex}] text-[${currentColor.hex}]`,
  } : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Pipette className="w-7 h-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* 屏幕取色按钮 */}
          {eyeDropperSupported && (
            <Button
              variant={isScreenPicking ? 'default' : 'outline'}
              onClick={handleScreenPick}
              disabled={isScreenPicking}
            >
              <Monitor className="w-4 h-4 mr-2" />
              {isScreenPicking ? t('screenPicking') : t('screenPick')}
            </Button>
          )}
          {imageUrl && (
            <Button variant="outline" onClick={handleReset}>
              <RefreshCw className="w-4 h-4 mr-2" />
              {t('reset')}
            </Button>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Image */}
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{t('image')}</CardTitle>
                {imageUrl && (
                  <Button
                    variant={isPicking ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setIsPicking(!isPicking)}
                  >
                    <Pipette className="w-4 h-4 mr-2" />
                    {isPicking ? t('picking') : t('startPick')}
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {!imageUrl ? (
                <div
                  {...getRootProps()}
                  className={cn(
                    'border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors min-h-[300px] flex flex-col items-center justify-center',
                    isDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50'
                  )}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-12 h-12 mb-4 text-muted-foreground" />
                  <p className="font-medium">{t('dropOrClick')}</p>
                  <p className="text-sm text-muted-foreground mt-2">{t('supportedFormats')}</p>
                </div>
              ) : (
                <div className="relative">
                  <canvas
                    ref={canvasRef}
                    onClick={handleCanvasClick}
                    onMouseMove={handleCanvasMove}
                    className={cn(
                      'max-w-full mx-auto rounded-lg border shadow-sm',
                      isPicking && 'cursor-crosshair'
                    )}
                  />
                  {isPicking && (
                    <div className="absolute top-2 left-2 bg-background/90 backdrop-blur px-3 py-1.5 rounded-full text-sm flex items-center gap-2">
                      <Pipette className="w-4 h-4" />
                      {t('clickToExtract')}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: Color Info & Palette */}
        <div className="space-y-6">
          {/* Manual Color Input */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Palette className="w-4 h-4" />
                {t('manualInput')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  value={currentColor?.hex || '#000000'}
                  onChange={(e) => handleManualHexInput(e.target.value)}
                  className="w-12 h-10 p-0 border-0 cursor-pointer"
                />
                <Input
                  value={manualHex || currentColor?.hex || ''}
                  onChange={(e) => handleManualHexInput(e.target.value)}
                  placeholder="#000000"
                  className="font-mono"
                />
              </div>
            </CardContent>
          </Card>

          {/* Current Color */}
          {currentColor && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{t('currentColor')}</CardTitle>
                  <Button size="sm" variant="outline" onClick={addColorToPalette}>
                    <Plus className="w-4 h-4 mr-1" />
                    {t('addToPalette')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div
                  className="w-full h-24 rounded-lg border shadow-inner"
                  style={{ backgroundColor: currentColor.hex }}
                />

                <div className="space-y-2">
                  {/* HEX */}
                  <div className="flex items-center gap-2">
                    <Label className="w-12 shrink-0">HEX</Label>
                    <Input value={currentColor.hex} readOnly className="font-mono" />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() => copyToClipboard(currentColor.hex)}
                    >
                      {copied === currentColor.hex ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>

                  {/* RGB */}
                  <div className="flex items-center gap-2">
                    <Label className="w-12 shrink-0">RGB</Label>
                    <Input
                      value={`rgb(${currentColor.rgb.r}, ${currentColor.rgb.g}, ${currentColor.rgb.b})`}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() =>
                        copyToClipboard(
                          `rgb(${currentColor.rgb.r}, ${currentColor.rgb.g}, ${currentColor.rgb.b})`
                        )
                      }
                    >
                      {copied ===
                      `rgb(${currentColor.rgb.r}, ${currentColor.rgb.g}, ${currentColor.rgb.b})` ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>

                  {/* HSL */}
                  <div className="flex items-center gap-2">
                    <Label className="w-12 shrink-0">HSL</Label>
                    <Input
                      value={`hsl(${currentColor.hsl.h}, ${currentColor.hsl.s}%, ${currentColor.hsl.l}%)`}
                      readOnly
                      className="font-mono text-sm"
                    />
                    <Button
                      size="icon"
                      variant="outline"
                      onClick={() =>
                        copyToClipboard(
                          `hsl(${currentColor.hsl.h}, ${currentColor.hsl.s}%, ${currentColor.hsl.l}%)`
                        )
                      }
                    >
                      {copied ===
                      `hsl(${currentColor.hsl.h}, ${currentColor.hsl.s}%, ${currentColor.hsl.l}%)` ? (
                        <CheckCircle className="w-4 h-4 text-green-500" />
                      ) : (
                        <Copy className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Color Palette */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                {t('palette')} {colors.length > 0 && `(${colors.length})`}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {colors.length > 0 ? (
                <div className="grid grid-cols-4 gap-2">
                  {colors.map((color) => (
                    <div
                      key={color.hex}
                      className="group relative aspect-square rounded-lg border shadow-sm cursor-pointer hover:ring-2 ring-primary"
                      style={{ backgroundColor: color.hex }}
                      onClick={() => copyToClipboard(color.hex)}
                      title={color.hex}
                    >
                      <button
                        className="absolute -top-1 -right-1 w-5 h-5 bg-destructive text-destructive-foreground rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeColor(color.hex);
                        }}
                      >
                        <X className="w-3 h-3" />
                      </button>
                      {copied === color.hex && (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/50 rounded-lg">
                          <CheckCircle className="w-5 h-5 text-white" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  <Pipette className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p>{t('paletteEmpty')}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* WCAG Contrast Checker */}
          {currentColor && contrastResult && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('contrastCheck')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-2">
                  <Label className="shrink-0 text-sm">{t('bgColor')}</Label>
                  <Input
                    type="color"
                    value={contrastBg}
                    onChange={(e) => setContrastBg(e.target.value)}
                    className="w-10 h-8 p-0 border-0 cursor-pointer"
                  />
                  <Input
                    value={contrastBg}
                    onChange={(e) => setContrastBg(e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
                <div
                  className="rounded-lg p-4 border text-center"
                  style={{ backgroundColor: contrastBg }}
                >
                  <span className="text-lg font-bold" style={{ color: currentColor.hex }}>
                    {t('sampleText')}
                  </span>
                </div>
                <div className="text-center font-mono text-lg font-bold">
                  {contrastResult.ratio} : 1
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {([
                    ['AA', contrastResult.aa],
                    ['AA Large', contrastResult.aaLarge],
                    ['AAA', contrastResult.aaa],
                    ['AAA Large', contrastResult.aaaLarge],
                  ] as const).map(([label, pass]) => (
                    <div
                      key={label}
                      className={`flex items-center justify-between px-2 py-1 rounded ${pass ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'}`}
                    >
                      <span className="font-medium">{label}</span>
                      <span>{pass ? '✓ Pass' : '✗ Fail'}</span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* CSS Export */}
          {currentColor && cssExport && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('codeExport')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {[
                  { label: 'CSS', value: cssExport.css },
                  { label: 'CSS Var', value: cssExport.cssVar },
                  { label: 'RGB', value: cssExport.rgb },
                  { label: 'HSL', value: cssExport.hsl },
                  { label: 'Tailwind', value: cssExport.tailwind },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2">
                    <Label className="w-16 shrink-0 text-xs">{item.label}</Label>
                    <code className="flex-1 text-xs bg-muted px-2 py-1 rounded truncate">
                      {item.value}
                    </code>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7 shrink-0"
                      onClick={() => copyToClipboard(item.value)}
                    >
                      {copied === item.value ? (
                        <CheckCircle className="w-3 h-3 text-green-500" />
                      ) : (
                        <Copy className="w-3 h-3" />
                      )}
                    </Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Tips */}
          {!imageUrl && (
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <h4 className="font-medium mb-2">{t('tipsTitle')}</h4>
                <div className="text-sm text-muted-foreground space-y-3">
                  <div>
                    <p className="font-medium text-foreground mb-1">📷 {t('tipsImagePick')}</p>
                    <ol className="space-y-1 list-decimal list-inside pl-2">
                      <li>{t('tipsImageStep1')}</li>
                      <li>{t('tipsImageStep2')}</li>
                      <li>{t('tipsImageStep3')}</li>
                    </ol>
                  </div>
                  {eyeDropperSupported && (
                    <div>
                      <p className="font-medium text-foreground mb-1">🖥️ {t('tipsScreenPick')}</p>
                      <ol className="space-y-1 list-decimal list-inside pl-2">
                        <li>{t('tipsScreenStep1')}</li>
                        <li>{t('tipsScreenStep2')}</li>
                        <li>{t('tipsScreenStep3')}</li>
                      </ol>
                    </div>
                  )}
                  {!eyeDropperSupported && (
                    <p className="text-xs text-orange-500">
                      💡 {t('tipsScreenNotSupported')}
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
