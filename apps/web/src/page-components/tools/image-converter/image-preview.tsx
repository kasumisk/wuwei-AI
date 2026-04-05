'use client';

import { Card } from '@/components/ui/card';
import { formatFileSize, calculateSizeReduction } from '@/lib/image-converter/utils';
import type { ImageInfo, ConvertResult } from '@/lib/image-converter/converter';
import { Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface ImagePreviewProps {
  original: ImageInfo | null;
  converted: ConvertResult | null;
  isConverting?: boolean;
}

export function ImagePreview({ original, converted, isConverting }: ImagePreviewProps) {
  const t = useTranslations('components.imagePreview');
  if (!original) {
    return null;
  }

  return (
    <div className="grid md:grid-cols-2 gap-4">
      {/* Original */}
      <Card className="p-4 space-y-3">
        <h4 className="font-medium text-sm">{t('original')}</h4>
        <div className="relative aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={original.url} alt="Original" className="max-w-full max-h-full object-contain" />
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p className="truncate font-medium text-foreground">{original.name}</p>
          <p>
            {original.width} × {original.height} px
          </p>
          <p>{formatFileSize(original.size)}</p>
          <p className="uppercase">{original.format}</p>
        </div>
      </Card>

      {/* Converted */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="font-medium text-sm">{t('converted')}</h4>
          {isConverting && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          {converted && !isConverting && <Check className="w-4 h-4 text-green-500" />}
        </div>
        <div className="relative aspect-video bg-muted rounded-lg overflow-hidden flex items-center justify-center">
          {converted ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={converted.url}
              alt="Converted"
              className="max-w-full max-h-full object-contain"
            />
          ) : (
            <div className="text-muted-foreground text-sm">
              {isConverting ? t('converting') : t('waiting')}
            </div>
          )}
        </div>
        {converted && (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p className="truncate font-medium text-foreground">{converted.filename}</p>
            <p>
              {converted.width} × {converted.height} px
            </p>
            <div className="flex items-center gap-2">
              <span>{formatFileSize(converted.convertedSize)}</span>
              <span
                className={
                  converted.convertedSize < original.size ? 'text-green-500' : 'text-orange-500'
                }
              >
                ({calculateSizeReduction(original.size, converted.convertedSize)})
              </span>
            </div>
            <p className="uppercase">{converted.format}</p>
          </div>
        )}
      </Card>
    </div>
  );
}
