'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  Download,
  FileText,
  X,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertCircle,
  GripVertical,
  Trash2,
  Merge,
  Split,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { mergePdfs, splitPdf, getPdfInfo, formatFileSize } from '@/lib/pdf';
import { saveAs } from 'file-saver';
import JSZip from 'jszip';

interface PdfFile {
  id: string;
  file: File;
  pageCount: number;
}

export function PdfMergeSplit() {
  const [activeTab, setActiveTab] = useState('merge');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FileText className="w-7 h-7" />
          PDF 合并 & 拆分
        </h1>
        <p className="text-muted-foreground">合并多个 PDF 文件，或将 PDF 按页拆分</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="merge" className="flex items-center gap-2">
            <Merge className="w-4 h-4" />
            合并 PDF
          </TabsTrigger>
          <TabsTrigger value="split" className="flex items-center gap-2">
            <Split className="w-4 h-4" />
            拆分 PDF
          </TabsTrigger>
        </TabsList>

        <TabsContent value="merge" className="mt-6">
          <MergePdf />
        </TabsContent>

        <TabsContent value="split" className="mt-6">
          <SplitPdf />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// 合并 PDF 组件
function MergePdf() {
  const [files, setFiles] = useState<PdfFile[]>([]);
  const [isMerging, setIsMerging] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const newFiles: PdfFile[] = [];
    for (const file of acceptedFiles) {
      try {
        const info = await getPdfInfo(file);
        newFiles.push({
          id: Math.random().toString(36).substring(7),
          file,
          pageCount: info.numPages,
        });
      } catch {
        // 忽略无效的 PDF 文件
      }
    }
    setFiles((prev) => [...prev, ...newFiles]);
    setResult(null);
    setError(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
  });

  const handleRemove = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
    setResult(null);
  };

  const handleDragStart = (index: number) => setDraggedIndex(index);
  const handleDragEnd = () => setDraggedIndex(null);
  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;
    const newFiles = [...files];
    const draggedFile = newFiles[draggedIndex];
    newFiles.splice(draggedIndex, 1);
    newFiles.splice(index, 0, draggedFile);
    setFiles(newFiles);
    setDraggedIndex(index);
  };

  const handleMerge = async () => {
    if (files.length < 2) return;
    setIsMerging(true);
    setProgress(0);
    setError(null);

    try {
      const pdfBlob = await mergePdfs(
        files.map((f) => f.file),
        {
          onProgress: (current, total) => setProgress(Math.round((current / total) * 100)),
        }
      );
      setResult(pdfBlob);
    } catch {
      setError('合并失败，请检查 PDF 文件');
    } finally {
      setIsMerging(false);
    }
  };

  const handleDownload = () => {
    if (result) saveAs(result, 'merged.pdf');
  };

  const handleReset = () => {
    setFiles([]);
    setResult(null);
    setError(null);
  };

  const totalPages = files.reduce((acc, f) => acc + f.pageCount, 0);

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {/* Upload */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">添加 PDF 文件</CardTitle>
              {files.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <RefreshCw className="w-4 h-4 mr-1" />
                  清空
                </Button>
              )}
            </div>
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
              <p className="font-medium">拖拽或点击添加 PDF 文件</p>
              <p className="text-sm text-muted-foreground mt-1">可添加多个文件</p>
            </div>
          </CardContent>
        </Card>

        {/* Files List */}
        {files.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">
                已选文件 ({files.length} 个，共 {totalPages} 页)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-muted-foreground mb-3">💡 拖拽文件可调整合并顺序</p>
              <div className="space-y-2">
                {files.map((file, index) => (
                  <div
                    key={file.id}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={(e) => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={cn(
                      'flex items-center gap-3 p-3 bg-muted rounded-lg cursor-move group',
                      draggedIndex === index && 'opacity-50'
                    )}
                  >
                    <GripVertical className="w-4 h-4 text-muted-foreground" />
                    <span className="w-6 h-6 flex items-center justify-center bg-primary/10 text-primary rounded text-sm font-medium">
                      {index + 1}
                    </span>
                    <FileText className="w-5 h-5 text-red-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm">{file.file.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatFileSize(file.file.size)} · {file.pageCount} 页
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="opacity-0 group-hover:opacity-100"
                      onClick={() => handleRemove(file.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Progress */}
        {isMerging && (
          <Card>
            <CardContent className="py-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    正在合并...
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
                  合并完成
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
                <div>
                  <p className="font-medium">merged.pdf</p>
                  <p className="text-sm text-muted-foreground">
                    {formatFileSize(result.size)} · {totalPages} 页
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <Button
              className="w-full"
              size="lg"
              onClick={handleMerge}
              disabled={files.length < 2 || isMerging}
            >
              {isMerging ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  合并中...
                </>
              ) : (
                <>
                  <Merge className="w-4 h-4 mr-2" />
                  合并 PDF
                </>
              )}
            </Button>
            {files.length > 0 && files.length < 2 && (
              <p className="text-xs text-muted-foreground text-center mt-2">
                请至少添加 2 个 PDF 文件
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="bg-muted/50">
          <CardContent className="pt-4">
            <h4 className="font-medium mb-2">提示</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• 拖拽文件调整合并顺序</li>
              <li>• 支持批量添加多个文件</li>
              <li>• 所有处理在浏览器本地完成</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// 拆分 PDF 组件
function SplitPdf() {
  const [file, setFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [isSplitting, setIsSplitting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ range: string; blob: Blob }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const pdfFile = acceptedFiles[0];
    if (pdfFile) {
      setFile(pdfFile);
      setResults([]);
      setError(null);
      try {
        const info = await getPdfInfo(pdfFile);
        setPageCount(info.numPages);
      } catch {
        setError('无法读取 PDF 文件');
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
  });

  const handleSplit = async () => {
    if (!file) return;
    setIsSplitting(true);
    setProgress(0);
    setError(null);

    try {
      const splitResults = await splitPdf(file, {
        onProgress: (current, total) => setProgress(Math.round((current / total) * 100)),
      });
      setResults(splitResults);
    } catch {
      setError('拆分失败，请检查 PDF 文件');
    } finally {
      setIsSplitting(false);
    }
  };

  const handleDownloadSingle = (result: { range: string; blob: Blob }) => {
    const baseName = file?.name.replace(/\.pdf$/i, '') || 'page';
    saveAs(result.blob, `${baseName}_page${result.range}.pdf`);
  };

  const handleDownloadAll = async () => {
    if (results.length === 0) return;
    const zip = new JSZip();
    const baseName = file?.name.replace(/\.pdf$/i, '') || 'pdf';
    results.forEach((r) => {
      zip.file(`${baseName}_page${r.range}.pdf`, r.blob);
    });
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    saveAs(zipBlob, `${baseName}_split.zip`);
  };

  const handleReset = () => {
    setFile(null);
    setPageCount(0);
    setResults([]);
    setError(null);
  };

  return (
    <div className="grid lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        {/* Upload */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">选择 PDF 文件</CardTitle>
              {file && (
                <Button variant="ghost" size="sm" onClick={handleReset}>
                  <RefreshCw className="w-4 h-4 mr-1" />
                  重选
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!file ? (
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
                <p className="font-medium">拖拽或点击上传 PDF 文件</p>
              </div>
            ) : (
              <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
                <FileText className="w-10 h-10 text-red-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{file.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatFileSize(file.size)} · {pageCount} 页
                  </p>
                </div>
                <Button variant="ghost" size="icon" onClick={handleReset}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Progress */}
        {isSplitting && (
          <Card>
            <CardContent className="py-6">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    正在拆分...
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
                  拆分完成 ({results.length} 个文件)
                </CardTitle>
                <Button onClick={handleDownloadAll}>
                  <Download className="w-4 h-4 mr-2" />
                  下载全部 (ZIP)
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                {results.map((result) => (
                  <div
                    key={result.range}
                    className="group p-3 bg-muted rounded-lg text-center cursor-pointer hover:bg-muted/80"
                    onClick={() => handleDownloadSingle(result)}
                  >
                    <FileText className="w-8 h-8 mx-auto mb-2 text-red-500" />
                    <p className="text-sm font-medium">第 {result.range} 页</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(result.blob.size)}
                    </p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {error && (
          <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}
      </div>

      {/* Settings */}
      <div className="space-y-6">
        <Card>
          <CardContent className="pt-6">
            <Button
              className="w-full"
              size="lg"
              onClick={handleSplit}
              disabled={!file || isSplitting}
            >
              {isSplitting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  拆分中...
                </>
              ) : (
                <>
                  <Split className="w-4 h-4 mr-2" />
                  按页拆分
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        <Card className="bg-muted/50">
          <CardContent className="pt-4">
            <h4 className="font-medium mb-2">提示</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• 每页拆分为单独的 PDF 文件</li>
              <li>• 可下载单个页面或全部打包</li>
              <li>• 所有处理在浏览器本地完成</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
