'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  Download,
  FileText,
  RefreshCw,
  Loader2,
  CheckCircle,
  Settings2,
  AlertCircle,
  GripVertical,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { imagesToPdf, formatFileSize } from '@/lib/pdf';
import { saveAs } from 'file-saver';

interface ImageFile {
  id: string;
  file: File;
  preview: string;
}

export function ImageToPdf() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [pageSize, setPageSize] = useState<'a4' | 'letter' | 'fit'>('a4');
  const [orientation, setOrientation] = useState<'portrait' | 'landscape' | 'auto'>('auto');
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newImages = acceptedFiles.map((file) => ({
      id: Math.random().toString(36).substring(7),
      file,
      preview: URL.createObjectURL(file),
    }));
    setImages((prev) => [...prev, ...newImages]);
    setResult(null);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
    },
    maxSize: 50 * 1024 * 1024, // 50MB per image
  });

  const handleRemoveImage = (id: string) => {
    setImages((prev) => {
      const image = prev.find((img) => img.id === id);
      if (image) URL.revokeObjectURL(image.preview);
      return prev.filter((img) => img.id !== id);
    });
    setResult(null);
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newImages = [...images];
    const draggedImage = newImages[draggedIndex];
    newImages.splice(draggedIndex, 1);
    newImages.splice(index, 0, draggedImage);
    setImages(newImages);
    setDraggedIndex(index);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
  };

  const handleConvert = async () => {
    if (images.length === 0) return;

    setIsConverting(true);
    setProgress(0);
    setError(null);

    try {
      const files = images.map((img) => img.file);
      const pdfBlob = await imagesToPdf(files, {
        pageSize,
        orientation,
        onProgress: (current, total) => {
          setProgress(Math.round((current / total) * 100));
        },
      });

      setResult(pdfBlob);
    } catch (err) {
      console.error('转换失败:', err);
      setError('转换失败，请检查图片文件');
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    saveAs(result, 'images_to_pdf.pdf');
  };

  const handleReset = () => {
    images.forEach((img) => URL.revokeObjectURL(img.preview));
    setImages([]);
    setResult(null);
    setProgress(0);
    setError(null);
  };

  const totalSize = images.reduce((acc, img) => acc + img.file.size, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-7 h-7" />
            图片转 PDF
          </h1>
          <p className="text-muted-foreground">将多张图片合并为一个 PDF 文件，支持拖拽排序</p>
        </div>
        {images.length > 0 && (
          <Button variant="outline" onClick={handleReset}>
            <RefreshCw className="w-4 h-4 mr-2" />
            清空重来
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">错误</p>
            <p className="text-sm text-destructive/80">{error}</p>
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Upload & Images */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upload */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">添加图片</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                {...getRootProps()}
                className={cn(
                  'border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors',
                  isDragActive
                    ? 'border-primary bg-primary/5'
                    : 'border-muted-foreground/25 hover:border-primary/50'
                )}
              >
                <input {...getInputProps()} />
                <Upload className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
                <p className="font-medium">拖拽或点击添加图片</p>
                <p className="text-sm text-muted-foreground mt-1">
                  支持 PNG、JPG、GIF、WebP 等格式
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Images List */}
          {images.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center justify-between">
                  <span>已选图片 ({images.length} 张)</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    总大小: {formatFileSize(totalSize)}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground mb-3">💡 拖拽图片可调整顺序</p>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {images.map((image, index) => (
                    <div
                      key={image.id}
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnd={handleDragEnd}
                      className={cn(
                        'relative group border rounded-lg overflow-hidden bg-muted cursor-move',
                        draggedIndex === index && 'opacity-50'
                      )}
                    >
                      <div className="absolute top-1 left-1 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded">
                        {index + 1}
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.preview}
                        alt={image.file.name}
                        className="w-full h-24 object-cover"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <div className="text-white/80">
                          <GripVertical className="w-5 h-5" />
                        </div>
                      </div>
                      <Button
                        variant="destructive"
                        size="icon"
                        className="absolute top-1 right-1 w-6 h-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleRemoveImage(image.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                      <div className="p-1.5 text-xs truncate">{image.file.name}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Converting Progress */}
          {isConverting && (
            <Card>
              <CardContent className="py-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      正在转换...
                    </span>
                    <span className="text-sm text-muted-foreground">{progress}%</span>
                  </div>
                  <Progress value={progress} />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Result */}
          {result && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    转换完成
                  </CardTitle>
                  <Button onClick={handleDownload}>
                    <Download className="w-4 h-4 mr-2" />
                    下载 PDF
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
                  <FileText className="w-10 h-10 text-red-500 shrink-0" />
                  <div className="flex-1">
                    <p className="font-medium">images_to_pdf.pdf</p>
                    <p className="text-sm text-muted-foreground">
                      {formatFileSize(result.size)} · {images.length} 页
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Settings */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                PDF 设置
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* 页面尺寸 */}
              <div className="space-y-2">
                <Label>页面尺寸</Label>
                <Select
                  value={pageSize}
                  onValueChange={(v) => setPageSize(v as 'a4' | 'letter' | 'fit')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="a4">A4 (210×297mm)</SelectItem>
                    <SelectItem value="letter">Letter (216×279mm)</SelectItem>
                    <SelectItem value="fit">适应图片大小</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 页面方向 */}
              {pageSize !== 'fit' && (
                <div className="space-y-2">
                  <Label>页面方向</Label>
                  <Select
                    value={orientation}
                    onValueChange={(v) => setOrientation(v as 'portrait' | 'landscape' | 'auto')}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">自动（根据图片）</SelectItem>
                      <SelectItem value="portrait">纵向</SelectItem>
                      <SelectItem value="landscape">横向</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={handleConvert}
                disabled={images.length === 0 || isConverting}
              >
                {isConverting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    转换中...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    生成 PDF
                  </>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Tips */}
          <Card className="bg-muted/50">
            <CardContent className="pt-4">
              <h4 className="font-medium mb-2">提示</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• 拖拽图片可调整页面顺序</li>
                <li>• 选择「适应图片」保持原始比例</li>
                <li>• 所有处理在浏览器本地完成</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
