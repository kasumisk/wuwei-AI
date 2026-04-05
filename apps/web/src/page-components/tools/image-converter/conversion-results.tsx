'use client';

import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  formatFileSize,
  calculateSizeReduction,
  downloadBlob,
  createZipFromBlobs,
} from '@/lib/image-converter/utils';
import type { ConvertResult } from '@/lib/image-converter/converter';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { useTranslations } from 'next-intl';

interface ConversionResultsProps {
  results: ConvertResult[];
  originalSizes: number[];
}

export function ConversionResults({ results, originalSizes }: ConversionResultsProps) {
  const t = useTranslations('components.conversionResults');
  const [downloadingAll, setDownloadingAll] = useState(false);

  if (results.length === 0) {
    return null;
  }

  const totalOriginalSize = originalSizes.reduce((a, b) => a + b, 0);
  const totalConvertedSize = results.reduce((a, r) => a + r.convertedSize, 0);

  const handleDownloadAll = async () => {
    if (results.length === 1) {
      downloadBlob(results[0].blob, results[0].filename);
      return;
    }

    setDownloadingAll(true);
    try {
      const zipBlob = await createZipFromBlobs(
        results.map((r) => ({ blob: r.blob, filename: r.filename }))
      );
      downloadBlob(zipBlob, 'converted-images.zip');
    } catch (error) {
      console.error('Failed to create zip:', error);
    } finally {
      setDownloadingAll(false);
    }
  };

  const handleDownloadSingle = (result: ConvertResult) => {
    downloadBlob(result.blob, result.filename);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">{t('title')}</h3>
          <p className="text-sm text-muted-foreground">
            {t('summary', { count: results.length, size: formatFileSize(totalConvertedSize) })}
            <span
              className={
                totalConvertedSize < totalOriginalSize ? ' text-green-500' : ' text-orange-500'
              }
            >
              {' '}
              ({calculateSizeReduction(totalOriginalSize, totalConvertedSize)})
            </span>
          </p>
        </div>
        <Button onClick={handleDownloadAll} disabled={downloadingAll}>
          <Download className="w-4 h-4 mr-2" />
          {results.length > 1 ? t('downloadAllZip') : t('download')}
        </Button>
      </div>

      <div className="grid gap-3 max-h-80 overflow-y-auto">
        {results.map((result, index) => (
          <Card key={`${result.filename}-${index}`} className="p-3 flex items-center gap-3">
            <div className="relative w-12 h-12 bg-muted rounded overflow-hidden shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={result.url} alt={result.filename} className="w-full h-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{result.filename}</p>
              <p className="text-xs text-muted-foreground">
                {result.width} × {result.height} px • {formatFileSize(result.convertedSize)}
                <span
                  className={
                    result.convertedSize < originalSizes[index]
                      ? ' text-green-500'
                      : ' text-orange-500'
                  }
                >
                  {' '}
                  ({calculateSizeReduction(originalSizes[index], result.convertedSize)})
                </span>
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => handleDownloadSingle(result)}>
              <Download className="w-4 h-4" />
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}
