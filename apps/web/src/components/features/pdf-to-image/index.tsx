'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
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
  FileImage,
  X,
  RefreshCw,
  Loader2,
  FileText,
  CheckCircle,
  Settings2,
  AlertCircle,
  ImageIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { pdfToImages, getPdfInfo, formatFileSize, type PdfDocumentInfo } from '@/lib/pdf';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';

interface ConvertedImage {
  pageNumber: number;
  dataUrl: string;
  blob: Blob;
}

export function PdfToImage() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfInfo, setPdfInfo] = useState<PdfDocumentInfo | null>(null);
  const [scale, setScale] = useState(2);
  const [format, setFormat] = useState<'png' | 'jpeg'>('png');
  const [quality, setQuality] = useState(92);
  const [isConverting, setIsConverting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<ConvertedImage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const pdfFile = acceptedFiles[0];
    if (pdfFile) {
      setFile(pdfFile);
      setResults([]);
      setError(null);
      setProgress(0);

      try {
        const info = await getPdfInfo(pdfFile);
        setPdfInfo(info);
      } catch (err) {
        console.error('读取 PDF 信息失败:', err);
        setError('无法读取 PDF 文件，请确保文件格式正确');
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
    },
    maxFiles: 1,
    maxSize: 100 * 1024 * 1024, // 100MB
  });

  const handleConvert = async () => {
    if (!file) return;

    setIsConverting(true);
    setProgress(0);
    setError(null);

    try {
      const images = await pdfToImages(file, {
        scale,
        format,
        quality: quality / 100,
        onProgress: (current, total) => {
          setProgress(Math.round((current / total) * 100));
        },
      });

      setResults(images);
    } catch (err) {
      console.error('转换失败:', err);
      setError('PDF 转换失败，请检查文件或尝试降低缩放比例');
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownloadSingle = (image: ConvertedImage) => {
    const baseName = file?.name.replace(/\.pdf$/i, '') || 'page';
    const ext = format === 'png' ? 'png' : 'jpg';
    saveAs(image.blob, `${baseName}_page${image.pageNumber}.${ext}`);
  };

  const handleDownloadAll = async () => {
    if (results.length === 0) return;

    const zip = new JSZip();
    const baseName = file?.name.replace(/\.pdf$/i, '') || 'pdf';
    const ext = format === 'png' ? 'png' : 'jpg';

    results.forEach((image) => {
      zip.file(`${baseName}_page${image.pageNumber}.${ext}`, image.blob);
    });

    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, `${baseName}_images.zip`);
  };

  const handleReset = () => {
    setFile(null);
    setPdfInfo(null);
    setResults([]);
    setProgress(0);
    setError(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileImage className="w-7 h-7" />
            PDF 转图片
          </h1>
          <p className="text-muted-foreground">将 PDF 文档转换为高清图片，支持 PNG、JPG 格式</p>
        </div>
        {file && (
          <Button variant="outline" onClick={handleReset}>
            <RefreshCw className="w-4 h-4 mr-2" />
            重新开始
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
        {/* Left: Upload & Preview */}
        <div className="lg:col-span-2 space-y-6">
          {/* Upload */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">选择 PDF 文件</CardTitle>
            </CardHeader>
            <CardContent>
              {!file ? (
                <div
                  {...getRootProps()}
                  className={cn(
                    'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
                    isDragActive
                      ? 'border-primary bg-primary/5'
                      : 'border-muted-foreground/25 hover:border-primary/50'
                  )}
                >
                  <input {...getInputProps()} />
                  <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                  <p className="font-medium">拖拽或点击上传 PDF 文件</p>
                  <p className="text-sm text-muted-foreground mt-2">支持最大 100MB 的 PDF 文件</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* File Info */}
                  <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
                    <FileText className="w-10 h-10 text-red-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{file.name}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        <span>{formatFileSize(file.size)}</span>
                        {pdfInfo && <span>{pdfInfo.numPages} 页</span>}
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" onClick={handleReset}>
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

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

          {/* Results */}
          {results.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                    转换完成 ({results.length} 张图片)
                  </CardTitle>
                  <Button onClick={handleDownloadAll}>
                    <Download className="w-4 h-4 mr-2" />
                    下载全部 (ZIP)
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                  {results.map((image) => (
                    <div
                      key={image.pageNumber}
                      className="group relative border rounded-lg overflow-hidden bg-muted"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={image.dataUrl}
                        alt={`Page ${image.pageNumber}`}
                        className="w-full h-auto"
                      />
                      <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleDownloadSingle(image)}
                        >
                          <Download className="w-4 h-4 mr-1" />
                          下载
                        </Button>
                      </div>
                      <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-xs text-center py-1">
                        第 {image.pageNumber} 页
                      </div>
                    </div>
                  ))}
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
                转换设置
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* 输出格式 */}
              <div className="space-y-2">
                <Label>输出格式</Label>
                <Select value={format} onValueChange={(v) => setFormat(v as 'png' | 'jpeg')}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="png">PNG (无损)</SelectItem>
                    <SelectItem value="jpeg">JPG (压缩)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* 缩放比例 */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>缩放比例</Label>
                  <span className="text-sm text-muted-foreground">{scale}x</span>
                </div>
                <Slider
                  min={1}
                  max={4}
                  step={0.5}
                  value={[scale]}
                  onValueChange={([v]) => setScale(v)}
                />
                <p className="text-xs text-muted-foreground">比例越高图片越清晰，但文件越大</p>
              </div>

              {/* 图片质量 (仅 JPG) */}
              {format === 'jpeg' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>图片质量</Label>
                    <span className="text-sm text-muted-foreground">{quality}%</span>
                  </div>
                  <Slider
                    min={50}
                    max={100}
                    step={1}
                    value={[quality]}
                    onValueChange={([v]) => setQuality(v)}
                  />
                </div>
              )}

              <Button
                className="w-full"
                size="lg"
                onClick={handleConvert}
                disabled={!file || isConverting}
              >
                {isConverting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    转换中...
                  </>
                ) : (
                  <>
                    <ImageIcon className="w-4 h-4 mr-2" />
                    开始转换
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
                <li>• PNG 格式无损，适合文字类文档</li>
                <li>• JPG 格式体积小，适合图片类文档</li>
                <li>• 2x 缩放适合大多数场景</li>
                <li>• 所有处理在浏览器本地完成</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
