'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getApiKeyConfig, saveApiKeyConfig, clearApiKeyConfig } from '@/lib/api/gateway-client';
import { Key, CheckCircle2 } from 'lucide-react';

export function ApiKeyConfig() {
  const t = useTranslations('components.apiKeyConfig');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [isConfigured, setIsConfigured] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    const config = getApiKeyConfig();
    if (config) {
      setApiKey(config.apiKey);
      setApiSecret(config.apiSecret);
      setIsConfigured(true);
    }
  }, []);

  const handleSave = () => {
    if (!apiKey || !apiSecret) {
      return;
    }

    const config = { apiKey, apiSecret };
    saveApiKeyConfig(config);
    setIsConfigured(true);
    setSaveSuccess(true);

    // 3秒后隐藏成功提示
    setTimeout(() => {
      setSaveSuccess(false);
    }, 3000);
  };

  const handleClear = () => {
    clearApiKeyConfig();
    setApiKey('');
    setApiSecret('');
    setIsConfigured(false);
    setSaveSuccess(false);
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Key className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold">{t('title')}</h3>
              <p className="text-sm text-muted-foreground">
                {t('description')}
              </p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                placeholder={t('keyPlaceholder')}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiSecret">API Secret</Label>
              <Input
                id="apiSecret"
                type="password"
                placeholder={t('secretPlaceholder')}
                value={apiSecret}
                onChange={(e) => setApiSecret(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-2">
            <Button onClick={handleSave} disabled={!apiKey || !apiSecret} className="gap-2">
              {isConfigured ? t('update') : t('save')}
            </Button>

            {isConfigured && (
              <Button variant="outline" onClick={handleClear}>
                {t('clear')}
              </Button>
            )}
          </div>

          {saveSuccess && (
            <Alert className="border-green-500 bg-green-50 dark:bg-green-950/30">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
              <AlertDescription className="text-green-600 dark:text-green-500">
                {t('success')}
              </AlertDescription>
            </Alert>
          )}

          {!apiKey || !apiSecret ? (
            <Alert>
              <AlertDescription className="text-sm">
                {t('hint')}
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
