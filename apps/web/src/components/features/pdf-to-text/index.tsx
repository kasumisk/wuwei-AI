'use client';

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
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
  Copy,
  Check,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { pdfToText, getPdfInfo, formatFileSize, type PdfDocumentInfo } from '@/lib/pdf';
import { saveAs } from 'file-saver';

export function PdfToText() {
  const [file, setFile] = useState<File | null>(null);
  const [pdfInfo, setPdfInfo] = useState<PdfDocumentInfo | null>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState<{ pageNumber: number; text: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
      } catch {
        setError('无法读取 PDF 文件');
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
    maxSize: 100 * 1024 * 1024,
  });

  const handleExtract = async () => {
    if (!file) return;

    setIsExtracting(true);
    setProgress(0);
    setError(null);

    try {
      const texts = await pdfToText(file, {
        onProgress: (current, total) => {
          setProgress(Math.round((current / total) * 100));
        },
      });
      setResults(texts);
    } catch (err) {
      console.error('提取失败:', err);
      setError('文本提取失败，PDF 可能是扫描版或加密的');
    } finally {
      setIsExtracting(false);
    }
  };

  const getAllText = () => {
    return results.map((r) => `=== 第 ${r.pageNumber} 页 ===\n${r.text}`).join('\n\n');
  };

  const handleCopy = async () => {
    const text = getAllText();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const text = getAllText();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const baseName = file?.name.replace(/\.pdf$/i, '') || 'document';
    saveAs(blob, `${baseName}.txt`);
  };

  const handleReset = () => {
    setFile(null);
    setPdfInfo(null);
    setResults([]);
    setProgress(0);
    setError(null);
  };

  const totalChars = results.reduce((acc, r) => acc + r.text.length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="w-7 h-7" />
            PDF 转文本
          </h1>
          <p className="text-muted-foreground">从 PDF 文档中提取文字内容，支持复制和下载</p>
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
        {/* Left: Upload & Results */}
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
              )}
            </CardContent>
          </Card>

          {/* Progress */}
          {isExtracting && (
            <Card>
              <CardContent className="py-6">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-medium flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      正在提取文本...
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
                    提取完成
                  </CardTitle>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={handleCopy}>
                      {copied ? (
                        <Check className="w-4 h-4 mr-1" />
                      ) : (
                        <Copy className="w-4 h-4 mr-1" />
                      )}
                      {copied ? '已复制' : '复制'}
                    </Button>
                    <Button size="sm" onClick={handleDownload}>
                      <Download className="w-4 h-4 mr-1" />
                      下载 TXT
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span>{results.length} 页</span>
                  <span>{totalChars.toLocaleString()} 字符</span>
                </div>

                <div className="space-y-4 max-h-[500px] overflow-y-auto">
                  {results.map((result) => (
                    <div key={result.pageNumber} className="space-y-2">
                      <div className="text-sm font-medium text-muted-foreground">
                        第 {result.pageNumber} 页
                      </div>
                      <Textarea
                        value={result.text || '(此页无文字内容)'}
                        readOnly
                        className="min-h-[100px] resize-none font-mono text-sm"
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right: Actions */}
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <Button
                className="w-full"
                size="lg"
                onClick={handleExtract}
                disabled={!file || isExtracting}
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    提取中...
                  </>
                ) : (
                  <>
                    <FileText className="w-4 h-4 mr-2" />
                    提取文本
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
                <li>• 适用于可选中文字的 PDF</li>
                <li>• 扫描版 PDF 无法直接提取</li>
                <li>• 加密 PDF 可能无法处理</li>
                <li>• 所有处理在浏览器本地完成</li>
              </ul>
            </CardContent>
          </Card>

          <Card className="bg-primary/5 border-primary/20">
            <CardContent className="pt-4">
              <p className="text-sm">
                <strong>🔒 隐私保护</strong>
                <br />
                PDF 文件不会上传到服务器，所有处理在本地完成
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
