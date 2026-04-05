'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Binary,
  Copy,
  CheckCircle,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  AlertCircle,
  FileText,
  Upload,
  Download,
  Image as ImageIcon,
  ArrowLeftRight,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type Mode = 'encode' | 'decode';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function isBase64Image(str: string): { isImage: boolean; mimeType: string } {
  const match = str.match(/^data:(image\/[a-zA-Z+]+);base64,/);
  if (match) return { isImage: true, mimeType: match[1] };
  // Try to decode and check if it looks like an image header
  try {
    const decoded = atob(str.slice(0, 20));
    if (decoded.startsWith('\x89PNG') || decoded.startsWith('\xFF\xD8\xFF')) {
      return { isImage: true, mimeType: decoded.startsWith('\x89PNG') ? 'image/png' : 'image/jpeg' };
    }
  } catch {
    // not valid base64
  }
  return { isImage: false, mimeType: '' };
}

export function Base64Tool() {
  const t = useTranslations('components.base64Tool');

  const [mode, setMode] = useState<Mode>('encode');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [urlSafe, setUrlSafe] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Auto-convert on input/mode/urlSafe change
  const processConversion = useCallback(
    (text: string, currentMode: Mode, isUrlSafe: boolean) => {
      setError(null);
      if (!text.trim()) {
        setOutput('');
        setImagePreview(null);
        return;
      }

      try {
        if (currentMode === 'encode') {
          const encoded = btoa(unescape(encodeURIComponent(text)));
          const result = isUrlSafe
            ? encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
            : encoded;
          setOutput(result);
          setImagePreview(null);
        } else {
          // Restore URL-safe chars before decoding
          let base64 = text.trim();
          if (isUrlSafe) {
            base64 = base64.replace(/-/g, '+').replace(/_/g, '/');
            const pad = base64.length % 4;
            if (pad) base64 += '='.repeat(4 - pad);
          }
          // Check if it's a data URL with base64
          const dataUrlMatch = base64.match(/^data:[^;]+;base64,(.+)$/);
          const rawBase64 = dataUrlMatch ? dataUrlMatch[1] : base64;

          const decoded = decodeURIComponent(escape(atob(rawBase64)));
          setOutput(decoded);

          // Check for image preview
          const imgCheck = isBase64Image(text.trim());
          if (imgCheck.isImage) {
            const src = text.trim().startsWith('data:')
              ? text.trim()
              : `data:${imgCheck.mimeType};base64,${rawBase64}`;
            setImagePreview(src);
          } else {
            setImagePreview(null);
          }
        }
      } catch {
        setError(currentMode === 'decode' ? t('errorInvalid') : t('errorEncode'));
        setOutput('');
        setImagePreview(null);
      }
    },
    [t]
  );

  // Debounced auto-convert
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      processConversion(input, mode, urlSafe);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [input, mode, urlSafe, processConversion]);

  const copyToClipboard = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleReset = () => {
    setInput('');
    setOutput('');
    setError(null);
    setFileName(null);
    setImagePreview(null);
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      setInput(text);
    } catch {
      // clipboard read failed
    }
  };

  const swapInputOutput = () => {
    const prevOutput = output;
    setInput(prevOutput);
    setOutput('');
    setError(null);
    setMode(mode === 'encode' ? 'decode' : 'encode');
  };

  // File upload handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setMode('encode');

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // For images, keep data URL; for others, read as text or binary
      if (file.type.startsWith('image/')) {
        setInput(result); // data URL
        setImagePreview(result);
      } else {
        // Read as ArrayBuffer for binary files
        const binReader = new FileReader();
        binReader.onload = () => {
          const bytes = new Uint8Array(binReader.result as ArrayBuffer);
          let binary = '';
          bytes.forEach((b) => (binary += String.fromCharCode(b)));
          const base64 = btoa(binary);
          setOutput(urlSafe ? base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : base64);
          setInput(`${t('filePrefix')} ${file.name} (${formatBytes(file.size)})`);
        };
        binReader.readAsArrayBuffer(file);
      }
    };
    reader.readAsDataURL(file);
    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Download decoded output as file
  const handleDownload = () => {
    if (!output) return;
    const blob = new Blob([output], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'decoded.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Stats
  const inputBytes = new Blob([input]).size;
  const outputBytes = new Blob([output]).size;
  const ratio = inputBytes > 0 && outputBytes > 0
    ? ((outputBytes / inputBytes) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Binary className="w-7 h-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button variant="outline" onClick={handleReset}>
          <RefreshCw className="w-4 h-4 mr-2" />
          {t('reset')}
        </Button>
      </div>

      {/* Mode Toggle & Options */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <Label>{t('modeLabel')}</Label>
              <div className="flex gap-1 bg-muted p-1 rounded-lg">
                <Button
                  variant={mode === 'encode' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setMode('encode')}
                  className={cn(mode !== 'encode' && 'hover:bg-background')}
                >
                  <ArrowDown className="w-4 h-4 mr-2" />
                  {t('encode')}
                </Button>
                <Button
                  variant={mode === 'decode' ? 'default' : 'ghost'}
                  size="sm"
                  onClick={() => setMode('decode')}
                  className={cn(mode !== 'decode' && 'hover:bg-background')}
                >
                  <ArrowUp className="w-4 h-4 mr-2" />
                  {t('decode')}
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="url-safe"
                  checked={urlSafe}
                  onCheckedChange={setUrlSafe}
                />
                <Label htmlFor="url-safe" className="text-sm">{t('urlSafeMode')}</Label>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileUpload}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="w-4 h-4 mr-2" />
                {t('uploadFile')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Input */}
        <Card className="h-full">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="w-4 h-4" />
                {mode === 'encode' ? t('originalText') : t('base64Encoded')}
                {fileName && (
                  <span className="text-xs text-muted-foreground font-normal">({fileName})</span>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatBytes(inputBytes)}</span>
                <Button variant="outline" size="sm" onClick={handlePaste}>
                  {t('paste')}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              value={input}
              onChange={(e) => { setInput(e.target.value); setFileName(null); }}
              placeholder={mode === 'encode' ? t('encodePlaceholder') : t('decodePlaceholder')}
              className="font-mono text-sm min-h-[300px] resize-none"
            />
          </CardContent>
        </Card>

        {/* Output */}
        <Card className="h-full">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Binary className="w-4 h-4" />
                {mode === 'encode' ? t('base64Encoded') : t('decodeResult')}
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{formatBytes(outputBytes)}</span>
                {mode === 'decode' && output && (
                  <Button variant="outline" size="sm" onClick={handleDownload}>
                    <Download className="w-4 h-4 mr-1" />
                    {t('download')}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={copyToClipboard} disabled={!output}>
                  {copied ? (
                    <>
                      <CheckCircle className="w-4 h-4 mr-1 text-green-500" />
                      {t('copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4 mr-1" />
                      {t('copy')}
                    </>
                  )}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {error ? (
              <div className="flex items-start gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive min-h-[300px]">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium">{t('conversionError')}</p>
                  <p className="text-sm mt-1">{error}</p>
                </div>
              </div>
            ) : (
              <Textarea
                value={output}
                readOnly
                placeholder={t('outputPlaceholder')}
                className="font-mono text-sm min-h-[300px] resize-none bg-muted"
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Image Preview */}
      {imagePreview && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ImageIcon className="w-4 h-4" />
              {t('imagePreview')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex justify-center p-4 bg-muted rounded-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={imagePreview}
                alt="Base64 preview"
                className="max-w-full max-h-[300px] rounded border object-contain"
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Actions & Stats */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              {output && (
                <Button variant="outline" onClick={swapInputOutput}>
                  <ArrowLeftRight className="w-4 h-4 mr-2" />
                  {mode === 'encode' ? t('swapDecode') : t('swapEncode')}
                </Button>
              )}
            </div>
            {input && output && (
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <BarChart3 className="w-4 h-4" />
                <span>{t('inputLabel')}: {formatBytes(inputBytes)}</span>
                <span>→</span>
                <span>{t('outputLabel')}: {formatBytes(outputBytes)}</span>
                <span className={cn(
                  'font-medium',
                  mode === 'encode' ? 'text-amber-600' : 'text-green-600'
                )}>
                  ({ratio}%)
                </span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
