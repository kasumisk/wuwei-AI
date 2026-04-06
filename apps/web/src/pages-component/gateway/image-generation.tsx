'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { generateImage, type ImageGenerationResponse } from '@/lib/api/gateway-client';
import { Loader2, Wand2, AlertCircle, Download, ExternalLink } from 'lucide-react';
import Image from 'next/image';

const MODELS = [
  { value: 'dall-e-2', label: 'DALL-E 2' },
  { value: 'dall-e-3', label: 'DALL-E 3' },
  { value: 'wanx-v1', label: 'Wanx V1' },
];

const DALL_E_2_SIZES = [
  { value: '256x256', label: '256x256' },
  { value: '512x512', label: '512x512' },
  { value: '1024x1024', label: '1024x1024' },
];

const DALL_E_3_SIZES = [
  { value: '1024x1024', label: '1024x1024' },
  { value: '1024x1792', labelKey: 'portrait' as const },
  { value: '1792x1024', labelKey: 'landscape' as const },
];

const WANX_SIZES = [
  { value: '1024*1024', label: '1024x1024' },
  { value: '720*1280', labelKey: 'portrait' as const },
  { value: '1280*720', labelKey: 'landscape' as const },
];

const QUALITIES = [
  { value: 'standard', labelKey: 'qualityStandard' as const },
  { value: 'hd', labelKey: 'qualityHD' as const },
];

export function ImageGenerationTest() {
  const t = useTranslations('components.imageGeneration');
  const [prompt, setPrompt] = useState('');
  const [model, setModel] = useState('dall-e-3');
  const [size, setSize] = useState('1024x1024');
  const [quality, setQuality] = useState('standard');
  const [n, setN] = useState(1);

  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<ImageGenerationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const getSizeOptions = () => {
    if (model === 'dall-e-2') return DALL_E_2_SIZES;
    if (model === 'dall-e-3') return DALL_E_3_SIZES;
    return WANX_SIZES;
  };

  const handleModelChange = (newModel: string) => {
    setModel(newModel);
    // 重置尺寸为第一个可用选项
    const sizeOptions =
      newModel === 'dall-e-2'
        ? DALL_E_2_SIZES
        : newModel === 'dall-e-3'
          ? DALL_E_3_SIZES
          : WANX_SIZES;
    setSize(sizeOptions[0].value);
  };

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setError(t('errorEmptyPrompt'));
      return;
    }

    setIsLoading(true);
    setError(null);
    setResponse(null);

    const result = await generateImage({
      model,
      prompt,
      size,
      quality: model === 'dall-e-3' ? quality : undefined,
      n,
    });

    setIsLoading(false);

    if (result.success && result.data) {
      setResponse(result.data);
    } else {
      setError(result.message || t('errorRequestFailed'));
    }
  };

  const handleDownload = async (url: string, index: number) => {
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = `image-${Date.now()}-${index + 1}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('下载失败:', error);
    }
  };

  return (
    <div className="space-y-6">
      {/* 配置区 */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="model">{t('model')}</Label>
          <Select value={model} onValueChange={handleModelChange}>
            <SelectTrigger id="model">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODELS.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="size">{t('size')}</Label>
          <Select value={size} onValueChange={setSize}>
            <SelectTrigger id="size">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {getSizeOptions().map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {'label' in s ? s.label : `${s.value.replace('*', 'x')} (${t(s.labelKey)})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {model === 'dall-e-3' && (
          <div className="space-y-2">
            <Label htmlFor="quality">{t('quality')}</Label>
            <Select value={quality} onValueChange={setQuality}>
              <SelectTrigger id="quality">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUALITIES.map((q) => (
                  <SelectItem key={q.value} value={q.value}>
                    {t(q.labelKey)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {model === 'dall-e-2' && (
          <div className="space-y-2">
            <Label htmlFor="n">{t('count')}</Label>
            <Select value={n.toString()} onValueChange={(v) => setN(parseInt(v))}>
              <SelectTrigger id="n">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 10 }, (_, i) => i + 1).map((num) => (
                  <SelectItem key={num} value={num.toString()}>
                    {num} {t('countUnit', { count: num }).split(' ').pop()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* 提示词 */}
      <div className="space-y-2">
        <Label htmlFor="prompt">{t('prompt')}</Label>
        <Textarea
          id="prompt"
          placeholder={t('promptPlaceholder')}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
        />
        <p className="text-xs text-muted-foreground">
          {t('promptHint')}
        </p>
      </div>

      {/* 提交按钮 */}
      <Button
        onClick={handleSubmit}
        disabled={isLoading || !prompt.trim()}
        className="w-full gap-2"
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('generating')}
          </>
        ) : (
          <>
            <Wand2 className="h-4 w-4" />
            {t('generateButton')}
          </>
        )}
      </Button>

      {/* 错误提示 */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 生成结果 */}
      {response && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <h3 className="mb-4 font-semibold">{t('generatedImages')}</h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {response.images.map((image, index) => (
                  <div
                    key={index}
                    className="group relative overflow-hidden rounded-lg border bg-muted"
                  >
                    <div className="relative aspect-square">
                      <Image
                        src={image.url}
                        alt={image.revisedPrompt || prompt}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                      />
                    </div>

                    {/* 操作按钮 */}
                    <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDownload(image.url, index)}
                        className="gap-2"
                      >
                        <Download className="h-4 w-4" />
                        {t('download')}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => window.open(image.url, '_blank')}
                        className="gap-2"
                      >
                        <ExternalLink className="h-4 w-4" />
                        {t('view')}
                      </Button>
                    </div>

                    {/* 修订后的提示词 */}
                    {image.revisedPrompt && (
                      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                        <p className="line-clamp-2 text-xs text-white">{image.revisedPrompt}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 className="mb-3 font-semibold">{t('generationInfo')}</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">{t('modelLabel')}</div>
                  <div className="font-mono text-sm font-medium">{response.model}</div>
                </div>
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">{t('countLabel')}</div>
                  <div className="font-mono text-sm font-medium">{t('imagesUnit', { count: response.images.length })}</div>
                </div>
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">Request ID</div>
                  <div className="truncate font-mono text-xs">{response.requestId}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 className="mb-3 font-semibold">{t('costInfo')}</h3>
              <div className="rounded-lg border bg-gradient-to-br from-primary/10 to-primary/5 p-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">{response.cost.amount.toFixed(6)}</span>
                  <span className="text-lg text-muted-foreground">{response.cost.currency}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t('perImage', { cost: (response.cost.amount / response.images.length).toFixed(6), currency: response.cost.currency })}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 定价说明 */}
      <Alert>
        <AlertDescription className="text-sm">
          <strong>{t('pricingRef')}</strong>
          <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-muted-foreground">
            <li>{t('pricingDalle2')}</li>
            <li>{t('pricingDalle3')}</li>
            <li>{t('pricingWanx')}</li>
          </ul>
        </AlertDescription>
      </Alert>
    </div>
  );
}
