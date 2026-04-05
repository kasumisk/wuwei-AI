'use client';

import { useState, useCallback, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ImageUploader } from './image-uploader';
import { FormatSelector } from './format-selector';
import { QualitySlider } from './quality-slider';
import { ResizeOptions } from './resize-options';
import { ImagePreview } from './image-preview';
import { ConversionResults } from './conversion-results';
import {
  convertImages,
  getImageInfo,
  type ConvertResult,
  type ImageInfo,
  type ConvertOptions,
} from '@/lib/image-converter/converter';
import { IMAGE_FORMATS } from '@/lib/image-converter/formats';
import { RefreshCw, Loader2, Image as ImageIcon, Settings2 } from 'lucide-react';

export function ImageConverter() {
  const t = useTranslations('components.imageConverter');

  // Files state
  const [files, setFiles] = useState<File[]>([]);
  const [imageInfos, setImageInfos] = useState<ImageInfo[]>([]);

  // Options state
  const [targetFormat, setTargetFormat] = useState('jpeg');
  const [quality, setQuality] = useState(85);
  const [resizeEnabled, setResizeEnabled] = useState(false);
  const [width, setWidth] = useState<number | undefined>(undefined);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const [maintainAspectRatio, setMaintainAspectRatio] = useState(true);

  // Conversion state
  const [isConverting, setIsConverting] = useState(false);
  const [results, setResults] = useState<ConvertResult[]>([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  // Preview state (for single file)
  const [previewInfo, setPreviewInfo] = useState<ImageInfo | null>(null);
  const [previewResult, setPreviewResult] = useState<ConvertResult | null>(null);

  // Handle file selection
  const handleFilesSelected = useCallback(
    async (newFiles: File[]) => {
      setFiles((prev) => [...prev, ...newFiles]);
      setResults([]); // Clear previous results

      // Get image info for all files
      const infos = await Promise.all(newFiles.map(getImageInfo));
      setImageInfos((prev) => [...prev, ...infos]);

      // Set preview to first file
      if (infos.length > 0 && !previewInfo) {
        setPreviewInfo(infos[0]);
      }
    },
    [previewInfo]
  );

  // Handle file removal
  const handleRemoveFile = useCallback(
    (index: number) => {
      setFiles((prev) => prev.filter((_, i) => i !== index));
      setImageInfos((prev) => {
        const newInfos = prev.filter((_, i) => i !== index);
        // Update preview if needed
        if (previewInfo && newInfos.length > 0) {
          setPreviewInfo(newInfos[0]);
        } else if (newInfos.length === 0) {
          setPreviewInfo(null);
          setPreviewResult(null);
        }
        return newInfos;
      });
      setResults([]);
    },
    [previewInfo]
  );

  // Handle conversion
  const handleConvert = useCallback(async () => {
    if (files.length === 0) return;

    setIsConverting(true);
    setResults([]);
    setProgress({ current: 0, total: files.length });

    const options: ConvertOptions = {
      targetFormat,
      quality,
      width: resizeEnabled ? width : undefined,
      height: resizeEnabled ? height : undefined,
      maintainAspectRatio,
      backgroundColor: IMAGE_FORMATS[targetFormat]?.supportsTransparency ? undefined : '#FFFFFF',
    };

    try {
      const convertedResults = await convertImages(files, options, (current, total, result) => {
        setProgress({ current, total });
        // Update preview result for first file
        if (current === 1 && result) {
          setPreviewResult(result);
        }
      });
      setResults(convertedResults);
    } catch (error) {
      console.error('Conversion failed:', error);
    } finally {
      setIsConverting(false);
    }
  }, [files, targetFormat, quality, resizeEnabled, width, height, maintainAspectRatio]);

  // Reset all
  const handleReset = useCallback(() => {
    // Clean up URLs
    imageInfos.forEach((info) => URL.revokeObjectURL(info.url));
    results.forEach((result) => URL.revokeObjectURL(result.url));

    setFiles([]);
    setImageInfos([]);
    setResults([]);
    setPreviewInfo(null);
    setPreviewResult(null);
    setProgress({ current: 0, total: 0 });
  }, [imageInfos, results]);

  // Clean up URLs on unmount
  useEffect(() => {
    const currentImageInfos = imageInfos;
    const currentResults = results;
    return () => {
      currentImageInfos.forEach((info) => URL.revokeObjectURL(info.url));
      currentResults.forEach((result) => URL.revokeObjectURL(result.url));
    };
  }, [imageInfos, results]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ImageIcon className="w-7 h-7" />
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

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Upload & Settings */}
        <div className="lg:col-span-1 space-y-6">
          {/* Upload */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('uploadTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              <ImageUploader
                files={files}
                onFilesSelected={handleFilesSelected}
                onRemoveFile={handleRemoveFile}
                disabled={isConverting}
              />
            </CardContent>
          </Card>

          {/* Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                {t('settingsTitle')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <FormatSelector
                value={targetFormat}
                onChange={setTargetFormat}
                disabled={isConverting}
              />

              <QualitySlider
                value={quality}
                onChange={setQuality}
                targetFormat={targetFormat}
                disabled={isConverting}
              />

              <ResizeOptions
                enabled={resizeEnabled}
                onEnabledChange={setResizeEnabled}
                width={width}
                height={height}
                onWidthChange={setWidth}
                onHeightChange={setHeight}
                maintainAspectRatio={maintainAspectRatio}
                onMaintainAspectRatioChange={setMaintainAspectRatio}
                disabled={isConverting}
              />

              <Button
                className="w-full"
                size="lg"
                onClick={handleConvert}
                disabled={files.length === 0 || isConverting}
              >
                {isConverting ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t('converting', { current: progress.current, total: progress.total })}
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    {t('startConvert')} {files.length > 0 && `(${files.length})`}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right: Preview & Results */}
        <div className="lg:col-span-2 space-y-6">
          {/* Preview */}
          {(previewInfo || isConverting) && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('previewTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ImagePreview
                  original={previewInfo}
                  converted={previewResult}
                  isConverting={isConverting && progress.current === 0}
                />
              </CardContent>
            </Card>
          )}

          {/* Results */}
          {results.length > 0 && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('resultsTitle')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ConversionResults
                  results={results}
                  originalSizes={imageInfos.map((info) => info.size)}
                />
              </CardContent>
            </Card>
          )}

          {/* Empty state */}
          {files.length === 0 && (
            <Card className="lg:min-h-[400px] flex items-center justify-center">
              <CardContent className="text-center py-12">
                <ImageIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground/30" />
                <h3 className="font-medium mb-2">{t('emptyTitle')}</h3>
                <p className="text-sm text-muted-foreground">{t('emptyDescription')}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
