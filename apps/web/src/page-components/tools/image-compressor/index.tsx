'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  Download,
  Shrink,
  X,
  RefreshCw,
  Loader2,
  Image as ImageIcon,
  CheckCircle,
  Settings2,
  Server,
  Eye,
  Monitor,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatFileSize, downloadBlob, createZipFromBlobs } from '@/lib/image-converter/utils';

interface CompressedImage {
  original: File;
  compressed: Blob;
  originalSize: number;
  compressedSize: number;
  url: string;
  filename: string;
  format: string;
}

interface CompressApiResult {
  filename: string;
  originalSize: number;
  compressedSize: number;
  format: string;
  data: string; // base64 data URL
  error?: string;
}

// 从 base64 data URL 创建 Blob
function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',');
  const mimeMatch = header.match(/:(.*?);/);
  const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
  const byteString = atob(base64);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([new Uint8Array(ab)], { type: mimeType });
}

// 获取压缩后的文件扩展名
function getExtensionFromMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/png':
      return '.png';
    case 'image/webp':
      return '.webp';
    case 'image/gif':
      return '.gif';
    default:
      return '.jpg';
  }
}

// 质量预设
const QUALITY_PRESETS = [
  { labelKey: 'presets.web' as const, quality: 75, descKey: 'presets.webDesc' as const },
  { labelKey: 'presets.social' as const, quality: 80, descKey: 'presets.socialDesc' as const },
  { labelKey: 'presets.recommended' as const, quality: 85, descKey: 'presets.recommendedDesc' as const },
  { labelKey: 'presets.hd' as const, quality: 92, descKey: 'presets.hdDesc' as const },
];

// 客户端 Canvas 压缩（API 不可用时的回退方案）
function compressWithCanvas(
  file: File,
  quality: number,
  maxWidth?: number
): Promise<{ blob: Blob; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (maxWidth && w > maxWidth) {
        h = Math.round((h * maxWidth) / w);
        w = maxWidth;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas context failed'));
      ctx.drawImage(img, 0, 0, w, h);
      const mimeType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
      canvas.toBlob(
        (blob) => {
          if (blob) resolve({ blob, width: w, height: h });
          else reject(new Error('Canvas blob failed'));
        },
        mimeType,
        quality / 100
      );
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = URL.createObjectURL(file);
  });
}

export function ImageCompressor() {
  const t = useTranslations('components.imageCompressor');
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState(85);
  const [enableResize, setEnableResize] = useState(false);
  const [maxWidth, setMaxWidth] = useState(1920);
  const [isCompressing, setIsCompressing] = useState(false);
  const [results, setResults] = useState<CompressedImage[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [useClientSide, setUseClientSide] = useState(false);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    setFiles((prev) => [...prev, ...acceptedFiles].slice(0, 20));
    setResults([]);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.gif'] },
    maxFiles: 20,
  });

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
    setResults([]);
  };

  // 使用服务端 API 压缩
  const handleCompress = async () => {
    if (files.length === 0) return;

    setIsCompressing(true);
    setProgress({ current: 0, total: files.length });
    setError(null);

    try {
      // 创建 FormData
      const formData = new FormData();
      files.forEach((file) => {
        formData.append('files', file);
      });
      formData.append('quality', String(quality));
      if (enableResize) {
        formData.append('maxWidth', String(maxWidth));
      }
      formData.append('keepFormat', 'true');

      // 调用压缩 API
      const response = await fetch('/api/compress', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Compress failed: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Compress failed');
      }

      // 处理结果
      const compressed: CompressedImage[] = [];
      const apiResults = data.results as CompressApiResult[];

      for (let i = 0; i < apiResults.length; i++) {
        const result = apiResults[i];
        const originalFile = files.find((f) => f.name === result.filename);

        if (result.error || !originalFile) {
          console.error(`压缩失败: ${result.filename}`, result.error);
          continue;
        }

        const blob = dataUrlToBlob(result.data);
        const ext = getExtensionFromMime(result.format);
        const baseName = result.filename.replace(/\.[^/.]+$/, '');
        const filename = `${baseName}_compressed${ext}`;

        compressed.push({
          original: originalFile,
          compressed: blob,
          originalSize: result.originalSize,
          compressedSize: result.compressedSize,
          url: URL.createObjectURL(blob),
          filename,
          format: result.format,
        });

        setProgress({ current: i + 1, total: files.length });
      }

      setResults(compressed);
    } catch (err) {
      console.error('压缩错误:', err);
      setError(err instanceof Error ? err.message : t('errorCompressFailed'));
    } finally {
      setIsCompressing(false);
    }
  };

  // 客户端压缩
  const handleClientCompress = async () => {
    if (files.length === 0) return;
    setIsCompressing(true);
    setProgress({ current: 0, total: files.length });
    setError(null);

    try {
      const compressed: CompressedImage[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const { blob } = await compressWithCanvas(
          file,
          quality,
          enableResize ? maxWidth : undefined
        );
        const ext = getExtensionFromMime(blob.type);
        const baseName = file.name.replace(/\.[^/.]+$/, '');
        compressed.push({
          original: file,
          compressed: blob,
          originalSize: file.size,
          compressedSize: blob.size,
          url: URL.createObjectURL(blob),
          filename: `${baseName}_compressed${ext}`,
          format: blob.type,
        });
        setProgress({ current: i + 1, total: files.length });
      }
      setResults(compressed);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errorClientFailed'));
    } finally {
      setIsCompressing(false);
    }
  };

  const handleDownloadAll = async () => {
    if (results.length === 1) {
      downloadBlob(results[0].compressed, results[0].filename);
      return;
    }

    const zipBlob = await createZipFromBlobs(
      results.map((r) => ({ blob: r.compressed, filename: r.filename }))
    );
    downloadBlob(zipBlob, 'compressed-images.zip');
  };

  const handleReset = () => {
    results.forEach((r) => URL.revokeObjectURL(r.url));
    setFiles([]);
    setResults([]);
    setProgress({ current: 0, total: 0 });
    setError(null);
    setPreviewIndex(null);
  };

  const totalSaved = results.reduce(
    (acc, r) => acc + Math.max(0, r.originalSize - r.compressedSize),
    0
  );
  const totalOriginal = results.reduce((acc, r) => acc + r.originalSize, 0);
  const avgReduction =
    results.length > 0 && totalOriginal > 0 ? Math.round((totalSaved / totalOriginal) * 100) : 0;

  // Cleanup URLs on unmount
  useEffect(() => {
    return () => {
      results.forEach((r) => URL.revokeObjectURL(r.url));
    };
  }, [results]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Shrink className="w-7 h-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        {files.length > 0 && (
          <Button variant="outline" onClick={handleReset}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {t('reset')}
          </Button>
        )}
      </div>

      {/* Error Alert */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Upload & Settings */}
        <div className="lg:col-span-1 space-y-6">
          {/* Upload */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('selectImages')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                {...getRootProps()}
                className={cn(
                  'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                  isDragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-primary/50',
                  isCompressing && 'opacity-50 cursor-not-allowed'
                )}
              >
                <input {...getInputProps()} disabled={isCompressing} />
                <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="font-medium text-sm">{t('dropOrClick')}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t('supportedFormats')}
                </p>
              </div>

              {files.length > 0 && (
                <div className="mt-4 space-y-2 max-h-40 overflow-y-auto">
                  {files.map((file, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 p-2 bg-muted rounded text-sm"
                    >
                      <ImageIcon className="w-4 h-4 shrink-0" />
                      <span className="truncate flex-1">{file.name}</span>
                      <span className="text-muted-foreground shrink-0">
                        {formatFileSize(file.size)}
                      </span>
                      <button
                        onClick={() => removeFile(index)}
                        className="p-1 hover:bg-background rounded"
                        disabled={isCompressing}
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                {t('settings')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* 压缩模式 */}
              <div className="flex items-center justify-between">
                <Label htmlFor="client-mode" className="flex items-center gap-2">
                  {useClientSide ? <Monitor className="w-4 h-4" /> : <Server className="w-4 h-4" />}
                  {useClientSide ? t('clientMode') : t('serverMode')}
                </Label>
                <Switch
                  id="client-mode"
                  checked={useClientSide}
                  onCheckedChange={setUseClientSide}
                  disabled={isCompressing}
                />
              </div>

              {/* 引擎提示 */}
              <div className="flex items-start gap-2 p-3 bg-primary/5 rounded-lg text-sm">
                {useClientSide ? (
                  <>
                    <Monitor className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-primary">{t('clientHint')}</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        {t('clientDescription')}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <Server className="w-4 h-4 text-primary mt-0.5 shrink-0" />
                    <div>
                      <p className="font-medium text-primary">{t('serverHint')}</p>
                      <p className="text-muted-foreground text-xs mt-1">
                        {t('serverDescription')}
                      </p>
                    </div>
                  </>
                )}
              </div>

              {/* 质量预设 */}
              <div className="space-y-2">
                <Label>{t('quickPresets')}</Label>
                <div className="grid grid-cols-4 gap-1.5">
                  {QUALITY_PRESETS.map((preset) => (
                    <Button
                      key={preset.labelKey}
                      variant={quality === preset.quality ? 'default' : 'outline'}
                      size="sm"
                      className="text-xs h-8"
                      onClick={() => setQuality(preset.quality)}
                      disabled={isCompressing}
                      title={t(preset.descKey)}
                    >
                      {t(preset.labelKey)}
                    </Button>
                  ))}
                </div>
              </div>

              {/* 质量设置 */}
              <div className="space-y-2">
                <div className="flex justify-between">
                  <Label>{t('compressQuality')}</Label>
                  <span className="text-sm text-muted-foreground">{quality}%</span>
                </div>
                <Slider
                  min={60}
                  max={100}
                  step={5}
                  value={[quality]}
                  onValueChange={([v]) => setQuality(v)}
                  disabled={isCompressing}
                />
                <p className="text-xs text-muted-foreground">
                  {t('qualityHint')}
                </p>
              </div>

              {/* 可选：调整尺寸 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label htmlFor="enable-resize">{t('limitMaxWidth')}</Label>
                  <Switch
                    id="enable-resize"
                    checked={enableResize}
                    onCheckedChange={setEnableResize}
                    disabled={isCompressing}
                  />
                </div>

                {enableResize && (
                  <div className="space-y-2 pl-1">
                    <div className="flex justify-between">
                      <span className="text-sm text-muted-foreground">{t('maxWidth')}</span>
                      <span className="text-sm text-muted-foreground">{maxWidth}px</span>
                    </div>
                    <Slider
                      min={480}
                      max={4096}
                      step={64}
                      value={[maxWidth]}
                      onValueChange={([v]) => setMaxWidth(v)}
                      disabled={isCompressing}
                    />
                  </div>
                )}
              </div>

              <Button
                className="w-full"
                size="lg"
                onClick={useClientSide ? handleClientCompress : handleCompress}
                disabled={files.length === 0 || isCompressing}
              >
                {isCompressing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t('compressing', { current: progress.current, total: progress.total })}
                  </>
                ) : (
                  <>
                    <Shrink className="w-4 h-4 mr-2" />
                    {t('startCompress')} {files.length > 0 && `(${files.length})`}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right: Results */}
        <div className="lg:col-span-2">
          {results.length > 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base flex items-center gap-2">
                      <CheckCircle className="w-5 h-5 text-green-500" />
                      {t('compressComplete')}
                    </CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">
                      {totalSaved > 0
                        ? t('totalSaved', { size: formatFileSize(totalSaved), percent: avgReduction })
                        : t('optimized')}
                    </p>
                  </div>
                  <Button onClick={handleDownloadAll}>
                    <Download className="w-4 h-4 mr-2" />
                    {results.length > 1 ? t('downloadAllZip') : t('download')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 max-h-96 overflow-y-auto">
                  {results.map((result, index) => {
                    const saved = result.originalSize - result.compressedSize;
                    const reduction =
                      saved > 0 ? Math.round((saved / result.originalSize) * 100) : 0;
                    const increased = saved < 0;

                    return (
                      <div key={index} className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                        <div className="w-14 h-14 rounded overflow-hidden shrink-0 bg-background">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={result.url}
                            alt={result.filename}
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm truncate">{result.filename}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className={saved > 0 ? 'line-through' : ''}>
                              {formatFileSize(result.originalSize)}
                            </span>
                            <span>→</span>
                            <span className="text-foreground font-medium">
                              {formatFileSize(result.compressedSize)}
                            </span>
                            {saved > 0 ? (
                              <span className="text-green-500">-{reduction}%</span>
                            ) : increased ? (
                              <span className="text-orange-500 text-xs">
                                +{Math.abs(reduction)}%
                              </span>
                            ) : (
                              <span className="text-muted-foreground">{t('same')}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setPreviewIndex(previewIndex === index ? null : index)
                            }
                            title={t('compareBtn')}
                          >
                            <Eye className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => downloadBlob(result.compressed, result.filename)}
                          >
                            <Download className="w-4 h-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Before / After Preview */}
                {previewIndex !== null && results[previewIndex] && (
                  <div className="mt-4 border-t pt-4">
                    <h4 className="text-sm font-medium mb-3">
                      {t('comparePreview', { filename: results[previewIndex].filename })}
                    </h4>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground text-center">{t('original')}</p>
                        <div className="border rounded-lg overflow-hidden bg-muted/50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={URL.createObjectURL(results[previewIndex].original)}
                            alt="Original"
                            className="w-full max-h-64 object-contain"
                          />
                        </div>
                        <p className="text-xs text-center text-muted-foreground">
                          {formatFileSize(results[previewIndex].originalSize)}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground text-center">{t('compressed')}</p>
                        <div className="border rounded-lg overflow-hidden bg-muted/50">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={results[previewIndex].url}
                            alt="Compressed"
                            className="w-full max-h-64 object-contain"
                          />
                        </div>
                        <p className="text-xs text-center text-muted-foreground">
                          {formatFileSize(results[previewIndex].compressedSize)}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card className="h-full min-h-[400px] flex items-center justify-center">
              <CardContent className="text-center py-12">
                <Shrink className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
                <h3 className="font-medium mb-2">{t('emptyTitle')}</h3>
                <p className="text-sm text-muted-foreground mb-4">{t('emptyDescription')}</p>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>✓ {t('featurePng')}</p>
                  <p>✓ {t('featureJpg')}</p>
                  <p>✓ {t('featureWebp')}</p>
                  <p>✓ {t('featureFormat')}</p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
