'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TextGenerationTest } from '@/pages-component/gateway/text-generation';
import { StreamGenerationTest } from '@/pages-component/gateway/stream-generation';
import { ImageGenerationTest } from '@/pages-component/gateway/image-generation';
import { ApiKeyConfig } from '@/pages-component/gateway/api-key-config';
import { TestHistory } from '@/pages-component/gateway/test-history';
import { Sparkles, MessageSquare, Image as ImageIcon, History, Settings } from 'lucide-react';

export default function GatewayTestPage() {
  const t = useTranslations('gatewayTest');
  const [activeTab, setActiveTab] = useState('text');

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/30 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
              <Sparkles className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
              <p className="text-muted-foreground">{t('description')}</p>
            </div>
          </div>
        </div>

        {/* API Key Configuration */}
        <ApiKeyConfig />

        {/* Main Content */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
            <TabsTrigger value="text" className="gap-2">
              <MessageSquare className="h-4 w-4" />
              {t('tabs.text')}
            </TabsTrigger>
            <TabsTrigger value="stream" className="gap-2">
              <Sparkles className="h-4 w-4" />
              {t('tabs.stream')}
            </TabsTrigger>
            <TabsTrigger value="image" className="gap-2">
              <ImageIcon className="h-4 w-4" />
              {t('tabs.image')}
            </TabsTrigger>
            <TabsTrigger value="history" className="gap-2">
              <History className="h-4 w-4" />
              {t('tabs.history')}
            </TabsTrigger>
            <TabsTrigger value="settings" className="gap-2">
              <Settings className="h-4 w-4" />
              {t('tabs.settings')}
            </TabsTrigger>
          </TabsList>

          {/* 文本生成 */}
          <TabsContent value="text" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('text.title')}</CardTitle>
                <CardDescription>
                  {t('text.description')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TextGenerationTest />
              </CardContent>
            </Card>
          </TabsContent>

          {/* 流式生成 */}
          <TabsContent value="stream" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('stream.title')}</CardTitle>
                <CardDescription>
                  {t('stream.description')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <StreamGenerationTest />
              </CardContent>
            </Card>
          </TabsContent>

          {/* 图像生成 */}
          <TabsContent value="image" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('image.title')}</CardTitle>
                <CardDescription>
                  {t('image.description')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ImageGenerationTest />
              </CardContent>
            </Card>
          </TabsContent>

          {/* 测试历史 */}
          <TabsContent value="history" className="space-y-6">
            <TestHistory />
          </TabsContent>

          {/* 设置 */}
          <TabsContent value="settings" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('settings.title')}</CardTitle>
                <CardDescription>{t('settings.description')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="rounded-lg border bg-muted/50 p-4">
                  <h3 className="mb-2 font-semibold">{t('settings.endpoint')}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.endpointDev')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.endpointProd')}
                  </p>
                </div>

                <div className="rounded-lg border bg-muted/50 p-4">
                  <h3 className="mb-2 font-semibold">{t('settings.auth')}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.authDesc')}
                  </p>
                </div>

                <div className="rounded-lg border bg-muted/50 p-4">
                  <h3 className="mb-2 font-semibold">{t('settings.rateLimit')}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t('settings.rateLimitDesc')}
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Documentation Link */}
        <Card className="border-dashed">
          <CardContent className="flex items-center justify-between p-6">
            <div className="space-y-1">
              <p className="font-medium">{t('help.title')}</p>
              <p className="text-sm text-muted-foreground">{t('help.description')}</p>
            </div>
            <a
              href="http://localhost:3005/api-docs"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
            >
              {t('help.viewDocs')}
            </a>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
