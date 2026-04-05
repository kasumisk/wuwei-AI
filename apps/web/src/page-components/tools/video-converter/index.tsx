'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
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
  Video,
  X,
  RefreshCw,
  Loader2,
  FileVideo,
  CheckCircle,
  Settings2,
  AlertCircle,
  Scissors,
  VolumeX,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  getFFmpeg,
  fetchFile,
  videoFormats,
  formatFileSize,
  formatDuration,
  getVideoInfo,
} from '@/lib/ffmpeg';

interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

interface ConvertedVideo {
  original: File;
  converted: Blob;
  originalSize: number;
  convertedSize: number;
  url: string;
  filename: string;
  format: string;
}

export function VideoConverter() {
  const t = useTranslations('components.videoConverter');
  const [file, setFile] = useState<File | null>(null);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [targetFormat, setTargetFormat] = useState('mp4');
  const [quality, setQuality] = useState(23); // CRF value (lower = better)
  const [resolution, setResolution] = useState('original');
  const [removeAudio, setRemoveAudio] = useState(false);
  const [enableTrim, setEnableTrim] = useState(false);
  const [trimStart, setTrimStart] = useState('');
  const [trimEnd, setTrimEnd] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<ConvertedVideo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);
  const videoPreviewRef = useRef<HTMLVideoElement>(null);

  // 预加载 FFmpeg
  useEffect(() => {
    const loadFFmpeg = async () => {
      setIsLoading(true);
      try {
        await getFFmpeg();
        setFfmpegLoaded(true);
        setError(null);
      } catch (err) {
        console.error('FFmpeg 加载失败:', err);
        setError(t('errorLoadFailed'));
      } finally {
        setIsLoading(false);
      }
    };
    loadFFmpeg();
  }, []);

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const videoFile = acceptedFiles[0];
    if (videoFile) {
      setFile(videoFile);
      setResult(null);
      setError(null);
      setProgress(0);

      try {
        const info = await getVideoInfo(videoFile);
        setVideoInfo(info);
      } catch {
        setError(t('errorReadVideo'));
      }
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv', '.m4v', '.wmv', '.flv'],
    },
    maxFiles: 1,
    maxSize: 500 * 1024 * 1024, // 500MB
  });

  const handleConvert = async () => {
    if (!file || !ffmpegLoaded) return;

    setIsConverting(true);
    setProgress(0);
    setError(null);

    try {
      const ffmpeg = await getFFmpeg();

      // 监听进度
      ffmpeg.on('progress', ({ progress: p }) => {
        setProgress(Math.round(p * 100));
      });

      // 写入输入文件
      const inputName = `input.${file.name.split('.').pop()}`;
      const outputName = `output.${targetFormat}`;

      await ffmpeg.writeFile(inputName, await fetchFile(file));

      // 构建转换命令
      const args = ['-i', inputName];

      // 裁剪时间
      if (enableTrim) {
        if (trimStart) args.unshift('-ss', trimStart);
        if (trimEnd) args.push('-to', trimEnd);
      }

      // 分辨率限制
      if (resolution !== 'original') {
        const h = parseInt(resolution);
        args.push('-vf', `scale=-2:${h}`);
      }

      // 根据格式选择编码器
      if (targetFormat === 'mp4') {
        args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', String(quality));
        if (!removeAudio) args.push('-c:a', 'aac', '-b:a', '128k');
      } else if (targetFormat === 'webm') {
        args.push('-c:v', 'libvpx-vp9', '-crf', String(quality), '-b:v', '0');
        if (!removeAudio) args.push('-c:a', 'libopus', '-b:a', '128k');
      } else if (targetFormat === 'gif') {
        const scaleFilter = resolution !== 'original' ? `scale=-2:${resolution}` : 'scale=480:-1';
        args.push('-vf', `fps=10,${scaleFilter}:flags=lanczos`);
        args.push('-loop', '0');
      } else {
        args.push('-c:v', 'copy');
        if (!removeAudio) args.push('-c:a', 'copy');
      }

      if (removeAudio) args.push('-an');

      args.push('-y', outputName);

      // 执行转换
      await ffmpeg.exec(args);

      // 读取输出文件
      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data instanceof Uint8Array ? new Uint8Array(data) : data], {
        type: videoFormats.find((f) => f.value === targetFormat)?.mimeType || 'video/mp4',
      });

      // 生成文件名
      const baseName = file.name.replace(/\.[^/.]+$/, '');
      const filename = `${baseName}.${targetFormat}`;

      setResult({
        original: file,
        converted: blob,
        originalSize: file.size,
        convertedSize: blob.size,
        url: URL.createObjectURL(blob),
        filename,
        format: targetFormat,
      });

      // 清理临时文件
      await ffmpeg.deleteFile(inputName);
      await ffmpeg.deleteFile(outputName);
    } catch (err) {
      console.error('转换失败:', err);
      setError(t('errorConvertFailed'));
    } finally {
      setIsConverting(false);
    }
  };

  const handleDownload = () => {
    if (!result) return;
    const a = document.createElement('a');
    a.href = result.url;
    a.download = result.filename;
    a.click();
  };

  const handleReset = () => {
    if (result) URL.revokeObjectURL(result.url);
    setFile(null);
    setVideoInfo(null);
    setResult(null);
    setProgress(0);
    setError(null);
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (result) URL.revokeObjectURL(result.url);
    };
  }, [result]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Video className="w-7 h-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground">
            {t('description')}
          </p>
        </div>
        {file && (
          <Button variant="outline" onClick={handleReset}>
            <RefreshCw className="w-4 h-4 mr-2" />
            {t('reset')}
          </Button>
        )}
      </div>

      {/* Loading FFmpeg */}
      {isLoading && (
        <div className="p-6 bg-muted/50 rounded-lg text-center">
          <Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin text-primary" />
          <p className="font-medium">{t('loadingEngine')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('loadingHint')}</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-destructive/10 border border-destructive/20 rounded-lg flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-destructive">{t('errorTitle')}</p>
            <p className="text-sm text-destructive/80 whitespace-pre-line">{error}</p>
          </div>
        </div>
      )}

      {ffmpegLoaded && !isLoading && (
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left: Upload & Settings */}
          <div className="lg:col-span-2 space-y-6">
            {/* Upload */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">{t('selectVideo')}</CardTitle>
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
                    <p className="font-medium">{t('dropOrClick')}</p>
                    <p className="text-sm text-muted-foreground mt-2">
                      {t('supportedFormats')}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Video Preview */}
                    <div className="relative bg-black rounded-lg overflow-hidden">
                      <video
                        ref={videoPreviewRef}
                        src={URL.createObjectURL(file)}
                        controls
                        className="w-full max-h-[300px]"
                      />
                    </div>

                    {/* Video Info */}
                    <div className="flex items-center gap-4 p-3 bg-muted rounded-lg">
                      <FileVideo className="w-10 h-10 text-primary shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{file.name}</p>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                          <span>{formatFileSize(file.size)}</span>
                          {videoInfo && (
                            <>
                              <span>
                                {videoInfo.width}×{videoInfo.height}
                              </span>
                              <span>{formatDuration(videoInfo.duration)}</span>
                            </>
                          )}
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
                        {t('converting')}
                      </span>
                      <span className="text-sm text-muted-foreground">{progress}%</span>
                    </div>
                    <Progress value={progress} />
                    <p className="text-xs text-muted-foreground text-center">
                      {t('processingHint')}
                    </p>
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
                      {t('convertComplete')}
                    </CardTitle>
                    <Button onClick={handleDownload}>
                      <Download className="w-4 h-4 mr-2" />
                      {t('downloadVideo')}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <video src={result.url} controls className="w-full rounded-lg max-h-[300px]" />
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-muted-foreground">{t('originalSize')}</p>
                        <p className="font-medium">{formatFileSize(result.originalSize)}</p>
                      </div>
                      <div className="p-3 bg-muted rounded-lg">
                        <p className="text-muted-foreground">{t('convertedSize')}</p>
                        <p className="font-medium">{formatFileSize(result.convertedSize)}</p>
                      </div>
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
                  {t('settings')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>{t('targetFormat')}</Label>
                  <Select value={targetFormat} onValueChange={setTargetFormat}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {videoFormats.map((format) => (
                        <SelectItem key={format.value} value={format.value}>
                          <div className="flex items-center justify-between w-full">
                            <span>{format.label}</span>
                            <span className="text-xs text-muted-foreground ml-2">
                              {format.desc}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Quality (CRF) */}
                {targetFormat !== 'gif' && (
                  <div className="space-y-2">
                    <div className="flex justify-between">
                      <Label>{t('quality')}</Label>
                      <span className="text-sm text-muted-foreground">
                        {quality} {quality <= 18 ? `(${t('qualityVeryHigh')})` : quality <= 23 ? `(${t('qualityHigh')})` : quality <= 28 ? `(${t('qualityMedium')})` : `(${t('qualityLow')})`}
                      </span>
                    </div>
                    <Slider
                      min={15}
                      max={35}
                      step={1}
                      value={[quality]}
                      onValueChange={([v]) => setQuality(v)}
                      disabled={isConverting}
                    />
                    <p className="text-xs text-muted-foreground">{t('qualityHint')}</p>
                  </div>
                )}

                {/* Resolution */}
                <div className="space-y-2">
                  <Label>{t('resolution')}</Label>
                  <Select value={resolution} onValueChange={setResolution}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">{t('keepOriginal')}</SelectItem>
                      <SelectItem value="1080">1080p</SelectItem>
                      <SelectItem value="720">720p</SelectItem>
                      <SelectItem value="480">480p</SelectItem>
                      <SelectItem value="360">360p</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Remove Audio */}
                <div className="flex items-center justify-between">
                  <Label htmlFor="remove-audio" className="flex items-center gap-2">
                    <VolumeX className="w-4 h-4" />
                    {t('removeAudio')}
                  </Label>
                  <Switch
                    id="remove-audio"
                    checked={removeAudio}
                    onCheckedChange={setRemoveAudio}
                    disabled={isConverting}
                  />
                </div>

                {/* Trim */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="enable-trim" className="flex items-center gap-2">
                      <Scissors className="w-4 h-4" />
                      {t('trimClip')}
                    </Label>
                    <Switch
                      id="enable-trim"
                      checked={enableTrim}
                      onCheckedChange={setEnableTrim}
                      disabled={isConverting}
                    />
                  </div>
                  {enableTrim && (
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">{t('startTime')}</Label>
                        <Input
                          placeholder="00:00:00"
                          value={trimStart}
                          onChange={(e) => setTrimStart(e.target.value)}
                          className="font-mono text-sm"
                          disabled={isConverting}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">{t('endTime')}</Label>
                        <Input
                          placeholder="00:01:00"
                          value={trimEnd}
                          onChange={(e) => setTrimEnd(e.target.value)}
                          className="font-mono text-sm"
                          disabled={isConverting}
                        />
                      </div>
                      <p className="col-span-2 text-xs text-muted-foreground">
                        {t('timeFormat')}
                      </p>
                    </div>
                  )}
                </div>

                <Button
                  className="w-full"
                  size="lg"
                  onClick={handleConvert}
                  disabled={!file || isConverting}
                >
                  {isConverting ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      {t('converting')}
                    </>
                  ) : (
                    <>
                      <Video className="w-4 h-4 mr-2" />
                      {t('startConvert')}
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {/* Tips */}
            <Card className="bg-muted/50">
              <CardContent className="pt-4">
                <h4 className="font-medium mb-2">{t('formatGuide')}</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>
                    <strong>MP4</strong> - {t('formatMp4')}
                  </li>
                  <li>
                    <strong>WebM</strong> - {t('formatWebm')}
                  </li>
                  <li>
                    <strong>GIF</strong> - {t('formatGif')}
                  </li>
                  <li>
                    <strong>MOV</strong> - {t('formatMov')}
                  </li>
                </ul>
              </CardContent>
            </Card>

            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="pt-4">
                <p className="text-sm">
                  <strong>🔒 {t('privacyTitle')}</strong>
                  <br />
                  {t('privacyDescription')}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
