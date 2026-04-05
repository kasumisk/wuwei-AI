'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  QrCode,
  Download,
  RefreshCw,
  Upload,
  X,
  Palette,
  Settings2,
  Image as ImageIcon,
  Link as LinkIcon,
  Mail,
  Phone,
  Wifi,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import QRCodeStyling, {
  DotType,
  CornerSquareType,
  CornerDotType,
  ErrorCorrectionLevel,
} from 'qr-code-styling';

// 预设颜色
const presetColors = [
  '#000000',
  '#1a1a1a',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#dc2626',
  '#ea580c',
  '#16a34a',
  '#0891b2',
  '#4f46e5',
];

// 点样式选项
const dotStyles: { value: DotType; labelKey: string }[] = [
  { value: 'square', labelKey: 'dotStyles.square' },
  { value: 'dots', labelKey: 'dotStyles.dots' },
  { value: 'rounded', labelKey: 'dotStyles.rounded' },
  { value: 'extra-rounded', labelKey: 'dotStyles.extraRounded' },
  { value: 'classy', labelKey: 'dotStyles.classy' },
  { value: 'classy-rounded', labelKey: 'dotStyles.classyRounded' },
];

// 角样式选项
const cornerSquareStyles: { value: CornerSquareType; labelKey: string }[] = [
  { value: 'square', labelKey: 'cornerStyles.square' },
  { value: 'dot', labelKey: 'cornerStyles.dot' },
  { value: 'extra-rounded', labelKey: 'cornerStyles.extraRounded' },
];

const cornerDotStyles: { value: CornerDotType; labelKey: string }[] = [
  { value: 'square', labelKey: 'cornerDotStyles.square' },
  { value: 'dot', labelKey: 'cornerDotStyles.dot' },
];

// 快捷模板
const templates = [
  { id: 'url', nameKey: 'templates.url', icon: LinkIcon, prefix: '' },
  { id: 'email', nameKey: 'templates.email', icon: Mail, prefix: 'mailto:' },
  { id: 'phone', nameKey: 'templates.phone', icon: Phone, prefix: 'tel:' },
  { id: 'sms', nameKey: 'templates.sms', icon: MessageSquare, prefix: 'sms:' },
  { id: 'wifi', nameKey: 'templates.wifi', icon: Wifi, prefix: '' },
  { id: 'text', nameKey: 'templates.text', icon: QrCode, prefix: '' },
];

export function QRCodeGenerator() {
  const t = useTranslations('components.qrcodeGenerator');
  const [content, setContent] = useState('https://example.com');
  const [activeTemplate, setActiveTemplate] = useState('url');
  const [size, setSize] = useState(300);
  const [margin, setMargin] = useState(10);
  const [dotColor, setDotColor] = useState('#000000');
  const [backgroundColor, setBackgroundColor] = useState('#ffffff');
  const [dotType, setDotType] = useState<DotType>('square');
  const [cornerSquareType, setCornerSquareType] = useState<CornerSquareType>('square');
  const [cornerDotType, setCornerDotType] = useState<CornerDotType>('square');
  const [errorCorrectionLevel, setErrorCorrectionLevel] = useState<ErrorCorrectionLevel>('M');
  const [logo, setLogo] = useState<string | null>(null);
  const [logoSize, setLogoSize] = useState(0.3);
  const [logoMargin, setLogoMargin] = useState(5);
  const [hideBackgroundDots, setHideBackgroundDots] = useState(true);

  // WiFi 专用字段
  const [wifiSSID, setWifiSSID] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [wifiType, setWifiType] = useState<'WPA' | 'WEP' | 'nopass'>('WPA');

  const qrRef = useRef<HTMLDivElement>(null);
  const qrCodeRef = useRef<QRCodeStyling | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 生成 WiFi 格式内容
  const generateWifiContent = useCallback(() => {
    return `WIFI:T:${wifiType};S:${wifiSSID};P:${wifiPassword};;`;
  }, [wifiType, wifiSSID, wifiPassword]);

  // 获取实际内容
  const getActualContent = useCallback(() => {
    if (activeTemplate === 'wifi') {
      return generateWifiContent();
    }
    const template = templates.find((t) => t.id === activeTemplate);
    if (template && template.prefix && !content.startsWith(template.prefix)) {
      return template.prefix + content;
    }
    return content;
  }, [activeTemplate, content, generateWifiContent]);

  // 初始化 QR Code
  useEffect(() => {
    qrCodeRef.current = new QRCodeStyling({
      width: size,
      height: size,
      margin: margin,
      data: getActualContent(),
      dotsOptions: {
        color: dotColor,
        type: dotType,
      },
      backgroundOptions: {
        color: backgroundColor,
      },
      cornersSquareOptions: {
        type: cornerSquareType,
        color: dotColor,
      },
      cornersDotOptions: {
        type: cornerDotType,
        color: dotColor,
      },
      imageOptions: {
        crossOrigin: 'anonymous',
        margin: logoMargin,
        imageSize: logoSize,
        hideBackgroundDots: hideBackgroundDots,
      },
      image: logo || undefined,
      qrOptions: {
        errorCorrectionLevel: errorCorrectionLevel,
      },
    });

    const currentRef = qrRef.current;
    if (currentRef) {
      currentRef.innerHTML = '';
      qrCodeRef.current.append(currentRef);
    }

    return () => {
      if (currentRef) {
        currentRef.innerHTML = '';
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 更新 QR Code
  useEffect(() => {
    if (qrCodeRef.current) {
      qrCodeRef.current.update({
        width: size,
        height: size,
        margin: margin,
        data: getActualContent(),
        dotsOptions: {
          color: dotColor,
          type: dotType,
        },
        backgroundOptions: {
          color: backgroundColor,
        },
        cornersSquareOptions: {
          type: cornerSquareType,
          color: dotColor,
        },
        cornersDotOptions: {
          type: cornerDotType,
          color: dotColor,
        },
        imageOptions: {
          crossOrigin: 'anonymous',
          margin: logoMargin,
          imageSize: logoSize,
          hideBackgroundDots: hideBackgroundDots,
        },
        image: logo || undefined,
        qrOptions: {
          errorCorrectionLevel: errorCorrectionLevel,
        },
      });
    }
  }, [
    size,
    margin,
    dotColor,
    backgroundColor,
    dotType,
    cornerSquareType,
    cornerDotType,
    errorCorrectionLevel,
    logo,
    logoSize,
    logoMargin,
    hideBackgroundDots,
    getActualContent,
  ]);

  // 确保 canvas 元素自适应容器
  useEffect(() => {
    const canvas = qrRef.current?.querySelector('canvas');
    if (canvas) {
      canvas.style.maxWidth = '100%';
      canvas.style.maxHeight = '100%';
      canvas.style.width = 'auto';
      canvas.style.height = 'auto';
      canvas.style.objectFit = 'contain';
    }
  }, [size, margin, dotColor, backgroundColor, dotType, cornerSquareType, cornerDotType, logo]);

  // 上传 Logo
  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        setLogo(reader.result as string);
        // 有 Logo 时提高纠错级别
        setErrorCorrectionLevel('H');
      };
      reader.readAsDataURL(file);
    }
  };

  const removeLogo = () => {
    setLogo(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // 下载二维码
  const handleDownload = async (format: 'png' | 'svg' | 'jpeg') => {
    if (qrCodeRef.current) {
      await qrCodeRef.current.download({
        name: 'qrcode',
        extension: format,
      });
    }
  };

  // 重置设置
  const handleReset = () => {
    setContent('https://example.com');
    setActiveTemplate('url');
    setSize(300);
    setMargin(10);
    setDotColor('#000000');
    setBackgroundColor('#ffffff');
    setDotType('square');
    setCornerSquareType('square');
    setCornerDotType('square');
    setErrorCorrectionLevel('M');
    setLogo(null);
    setLogoSize(0.3);
    setLogoMargin(5);
    setHideBackgroundDots(true);
    setWifiSSID('');
    setWifiPassword('');
    setWifiType('WPA');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <QrCode className="w-7 h-7" />
            {t('title')}
          </h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button variant="outline" onClick={handleReset}>
          <RefreshCw className="w-4 h-4 mr-2" />
          {t('reset')}
        </Button>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: Settings */}
        <div className="lg:col-span-2 space-y-6">
          {/* Content Input */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('content')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* 模板选择 */}
              <div className="flex flex-wrap gap-2">
                {templates.map((template) => (
                  <Button
                    key={template.id}
                    variant={activeTemplate === template.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveTemplate(template.id)}
                  >
                    <template.icon className="w-4 h-4 mr-1" />
                    {t(template.nameKey)}
                  </Button>
                ))}
              </div>

              {/* WiFi 特殊表单 */}
              {activeTemplate === 'wifi' ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label>{t('wifiName')}</Label>
                    <Input
                      value={wifiSSID}
                      onChange={(e) => setWifiSSID(e.target.value)}
                      placeholder={t('wifiNamePlaceholder')}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('password')}</Label>
                    <Input
                      value={wifiPassword}
                      onChange={(e) => setWifiPassword(e.target.value)}
                      placeholder={t('wifiPasswordPlaceholder')}
                      type="password"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>{t('encryption')}</Label>
                    <Select
                      value={wifiType}
                      onValueChange={(v) => setWifiType(v as 'WPA' | 'WEP' | 'nopass')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="WPA">WPA/WPA2</SelectItem>
                        <SelectItem value="WEP">WEP</SelectItem>
                        <SelectItem value="nopass">{t('noPassword')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>
                    {activeTemplate === 'url' && t('url')}
                    {activeTemplate === 'email' && t('emailAddress')}
                    {activeTemplate === 'phone' && t('phoneNumber')}
                    {activeTemplate === 'sms' && t('mobileNumber')}
                    {activeTemplate === 'text' && t('textContent')}
                  </Label>
                  <Input
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={
                      activeTemplate === 'url'
                        ? t('urlPlaceholder')
                        : activeTemplate === 'email'
                          ? t('emailPlaceholder')
                          : activeTemplate === 'phone'
                            ? t('phonePlaceholder')
                            : activeTemplate === 'sms'
                              ? t('smsPlaceholder')
                              : t('textPlaceholder')
                    }
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Style Settings */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings2 className="w-4 h-4" />
                {t('styleSettings')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="basic" className="w-full">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="basic">{t('tabBasic')}</TabsTrigger>
                  <TabsTrigger value="colors">{t('tabColors')}</TabsTrigger>
                  <TabsTrigger value="logo">{t('tabLogo')}</TabsTrigger>
                </TabsList>

                {/* 基础设置 */}
                <TabsContent value="basic" className="space-y-4 pt-4">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Label>{t('size')}</Label>
                        <span className="text-sm text-muted-foreground">{size}px</span>
                      </div>
                      <Slider
                        min={128}
                        max={512}
                        step={8}
                        value={[size]}
                        onValueChange={([v]) => setSize(v)}
                      />
                    </div>
                    <div className="space-y-2">
                      <div className="flex justify-between">
                        <Label>{t('margin')}</Label>
                        <span className="text-sm text-muted-foreground">{margin}px</span>
                      </div>
                      <Slider
                        min={0}
                        max={50}
                        step={5}
                        value={[margin]}
                        onValueChange={([v]) => setMargin(v)}
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>{t('dotStyle')}</Label>
                      <Select value={dotType} onValueChange={(v) => setDotType(v as DotType)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {dotStyles.map((style) => (
                            <SelectItem key={style.value} value={style.value}>
                              {t(style.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('cornerFrameStyle')}</Label>
                      <Select
                        value={cornerSquareType}
                        onValueChange={(v) => setCornerSquareType(v as CornerSquareType)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {cornerSquareStyles.map((style) => (
                            <SelectItem key={style.value} value={style.value}>
                              {t(style.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>{t('cornerDotStyle')}</Label>
                      <Select
                        value={cornerDotType}
                        onValueChange={(v) => setCornerDotType(v as CornerDotType)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {cornerDotStyles.map((style) => (
                            <SelectItem key={style.value} value={style.value}>
                              {t(style.labelKey)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>{t('errorCorrectionLevel')}</Label>
                    <Select
                      value={errorCorrectionLevel}
                      onValueChange={(v) => setErrorCorrectionLevel(v as ErrorCorrectionLevel)}
                    >
                      <SelectTrigger className="w-full sm:w-48">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="L">{t('ecLow')}</SelectItem>
                        <SelectItem value="M">{t('ecMedium')}</SelectItem>
                        <SelectItem value="Q">{t('ecQuartile')}</SelectItem>
                        <SelectItem value="H">{t('ecHigh')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </TabsContent>

                {/* 颜色设置 */}
                <TabsContent value="colors" className="space-y-4 pt-4">
                  <div className="space-y-3">
                    <Label>{t('foregroundColor')}</Label>
                    <div className="flex items-center gap-3">
                      <div className="flex flex-wrap gap-2">
                        {presetColors.map((color) => (
                          <button
                            key={color}
                            className={cn(
                              'w-8 h-8 rounded-full border-2 transition-all',
                              dotColor === color
                                ? 'border-primary ring-2 ring-primary/30'
                                : 'border-transparent hover:scale-110'
                            )}
                            style={{ backgroundColor: color }}
                            onClick={() => setDotColor(color)}
                          />
                        ))}
                      </div>
                      <Input
                        type="color"
                        value={dotColor}
                        onChange={(e) => setDotColor(e.target.value)}
                        className="w-12 h-8 p-0 border-0 cursor-pointer"
                      />
                      <Input
                        value={dotColor}
                        onChange={(e) => setDotColor(e.target.value)}
                        className="w-24 font-mono text-sm"
                      />
                    </div>
                  </div>

                  <div className="space-y-3">
                    <Label>{t('bgColor')}</Label>
                    <div className="flex items-center gap-3">
                      <div className="flex gap-2">
                        {['#ffffff', '#f5f5f5', '#fef3c7', '#dbeafe', '#f3e8ff', '#fce7f3'].map(
                          (color) => (
                            <button
                              key={color}
                              className={cn(
                                'w-8 h-8 rounded-full border-2 transition-all',
                                backgroundColor === color
                                  ? 'border-primary ring-2 ring-primary/30'
                                  : 'border-muted-foreground/30 hover:scale-110'
                              )}
                              style={{ backgroundColor: color }}
                              onClick={() => setBackgroundColor(color)}
                            />
                          )
                        )}
                      </div>
                      <Input
                        type="color"
                        value={backgroundColor}
                        onChange={(e) => setBackgroundColor(e.target.value)}
                        className="w-12 h-8 p-0 border-0 cursor-pointer"
                      />
                      <Input
                        value={backgroundColor}
                        onChange={(e) => setBackgroundColor(e.target.value)}
                        className="w-24 font-mono text-sm"
                      />
                    </div>
                  </div>
                </TabsContent>

                {/* Logo 设置 */}
                <TabsContent value="logo" className="space-y-4 pt-4">
                  <div className="space-y-3">
                    <Label>{t('uploadLogo')}</Label>
                    <div className="flex items-center gap-3">
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                      <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                        <Upload className="w-4 h-4 mr-2" />
                        {t('selectImage')}
                      </Button>
                      {logo && (
                        <Button variant="ghost" size="sm" onClick={removeLogo}>
                          <X className="w-4 h-4 mr-1" />
                          {t('removeLogo')}
                        </Button>
                      )}
                    </div>
                    {logo && (
                      <div className="flex items-center gap-3 p-3 bg-muted rounded-lg">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={logo}
                          alt="Logo preview"
                          className="w-12 h-12 object-contain rounded"
                        />
                        <span className="text-sm text-muted-foreground">{t('logoUploaded')}</span>
                      </div>
                    )}
                  </div>

                  {logo && (
                    <>
                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label>{t('logoSize')}</Label>
                          <span className="text-sm text-muted-foreground">
                            {Math.round(logoSize * 100)}%
                          </span>
                        </div>
                        <Slider
                          min={0.1}
                          max={0.5}
                          step={0.05}
                          value={[logoSize]}
                          onValueChange={([v]) => setLogoSize(v)}
                        />
                      </div>

                      <div className="space-y-2">
                        <div className="flex justify-between">
                          <Label>{t('logoMargin')}</Label>
                          <span className="text-sm text-muted-foreground">{logoMargin}px</span>
                        </div>
                        <Slider
                          min={0}
                          max={20}
                          step={1}
                          value={[logoMargin]}
                          onValueChange={([v]) => setLogoMargin(v)}
                        />
                      </div>

                      <div className="flex items-center justify-between">
                        <Label htmlFor="hide-dots">{t('hideDotsUnderLogo')}</Label>
                        <Switch
                          id="hide-dots"
                          checked={hideBackgroundDots}
                          onCheckedChange={setHideBackgroundDots}
                        />
                      </div>
                    </>
                  )}

                  {!logo && (
                    <div className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-lg">
                      <p className="flex items-center gap-2">
                        <ImageIcon className="w-4 h-4" />
                        {t('logoAutoCorrection')}
                      </p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        {/* Right: Preview & Download */}
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t('preview')}</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="flex items-center justify-center bg-muted/30 rounded-lg"
                style={{
                  width: '100%',
                  height: '340px',
                  maxWidth: '340px',
                }}
              >
                <div
                  ref={qrRef}
                  className="rounded-lg overflow-hidden shadow-lg"
                  style={{
                    backgroundColor,
                    maxWidth: '100%',
                    maxHeight: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground text-center mt-2">
                {t('qrSize', { size })}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Download className="w-4 h-4" />
                {t('download')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Button className="w-full" onClick={() => handleDownload('png')}>
                <Download className="w-4 h-4 mr-2" />
                {t('downloadPng')}
              </Button>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" onClick={() => handleDownload('svg')}>
                  {t('downloadSvg')}
                </Button>
                <Button variant="outline" onClick={() => handleDownload('jpeg')}>
                  {t('downloadJpeg')}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                {t('downloadHint')}
              </p>
            </CardContent>
          </Card>

          {/* Tips */}
          <Card className="bg-muted/50">
            <CardContent className="pt-4">
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Palette className="w-4 h-4" />
                {t('tipsTitle')}
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• {t('tipContrast')}</li>
                <li>• {t('tipLogo')}</li>
                <li>• {t('tipWifi')}</li>
                <li>• {t('tipSvg')}</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
