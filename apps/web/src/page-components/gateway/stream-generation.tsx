'use client';

import { useState, useRef } from 'react';
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
import { Slider } from '@/components/ui/slider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { generateTextStream } from '@/lib/api/gateway-client';
import { Loader2, Send, AlertCircle, StopCircle, Copy, Check } from 'lucide-react';

const MODELS = [
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { value: 'gpt-4', label: 'GPT-4' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'qwen-plus', label: 'Qwen Plus' },
  { value: 'deepseek-chat', label: 'DeepSeek Chat' },
];

export function StreamGenerationTest() {
  const t = useTranslations('components.streamGeneration');
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [model, setModel] = useState('gpt-3.5-turbo');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);

  const [isStreaming, setIsStreaming] = useState(false);
  const [streamedText, setStreamedText] = useState('');
  const [usage, setUsage] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const stopStreamRef = useRef<(() => void) | null>(null);

  const handleSubmit = () => {
    if (!prompt.trim()) {
      setError(t('errorEmptyPrompt'));
      return;
    }

    setIsStreaming(true);
    setError(null);
    setStreamedText('');
    setUsage(null);

    const stopFn = generateTextStream(
      {
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature,
        maxTokens,
        stream: true,
      },
      (chunk) => {
        setStreamedText((prev) => prev + chunk);
      },
      (usage) => {
        setIsStreaming(false);
        setUsage(usage);
        stopStreamRef.current = null;
      },
      (error) => {
        setIsStreaming(false);
        setError(error.message);
        stopStreamRef.current = null;
      }
    );

    stopStreamRef.current = stopFn;
  };

  const handleStop = () => {
    if (stopStreamRef.current) {
      stopStreamRef.current();
      setIsStreaming(false);
      stopStreamRef.current = null;
    }
  };

  const handleCopy = () => {
    if (streamedText) {
      navigator.clipboard.writeText(streamedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      {/* 配置区 */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="model">{t('model')}</Label>
          <Select value={model} onValueChange={setModel} disabled={isStreaming}>
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
          <Label htmlFor="maxTokens">{t('maxTokens', { value: maxTokens })}</Label>
          <Slider
            id="maxTokens"
            min={100}
            max={2000}
            step={100}
            value={[maxTokens]}
            onValueChange={([value]) => setMaxTokens(value)}
            disabled={isStreaming}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="temperature">{t('temperature', { value: temperature.toFixed(2) })}</Label>
          <Slider
            id="temperature"
            min={0}
            max={2}
            step={0.1}
            value={[temperature]}
            onValueChange={([value]) => setTemperature(value)}
            disabled={isStreaming}
          />
        </div>
      </div>

      {/* 系统提示词 */}
      <div className="space-y-2">
        <Label htmlFor="systemPrompt">{t('systemPrompt')}</Label>
        <Textarea
          id="systemPrompt"
          placeholder={t('systemPromptPlaceholder')}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          rows={2}
          disabled={isStreaming}
        />
      </div>

      {/* 用户提示词 */}
      <div className="space-y-2">
        <Label htmlFor="prompt">{t('prompt')}</Label>
        <Textarea
          id="prompt"
          placeholder={t('promptPlaceholder')}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          disabled={isStreaming}
        />
      </div>

      {/* 控制按钮 */}
      <div className="flex gap-2">
        {!isStreaming ? (
          <Button onClick={handleSubmit} disabled={!prompt.trim()} className="flex-1 gap-2">
            <Send className="h-4 w-4" />
            {t('start')}
          </Button>
        ) : (
          <Button onClick={handleStop} variant="destructive" className="flex-1 gap-2">
            <StopCircle className="h-4 w-4" />
            {t('stop')}
          </Button>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* 流式输出区域 */}
      {(streamedText || isStreaming) && (
        <Card>
          <CardContent className="pt-6">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold">{t('streamOutput')}</h3>
                {isStreaming && (
                  <Badge variant="secondary" className="gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {t('generating')}
                  </Badge>
                )}
                {!isStreaming && streamedText && <Badge variant="default">{t('completed')}</Badge>}
              </div>
              {streamedText && (
                <Button variant="outline" size="sm" onClick={handleCopy} className="gap-2">
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" />
                      {t('copied')}
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      {t('copy')}
                    </>
                  )}
                </Button>
              )}
            </div>
            <div className="min-h-[200px] rounded-lg bg-muted p-4">
              <pre className="whitespace-pre-wrap font-sans text-sm">
                {streamedText}
                {isStreaming && <span className="animate-pulse">▊</span>}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 使用统计 */}
      {usage && (
        <Card>
          <CardContent className="pt-6">
            <h3 className="mb-3 font-semibold">{t('usageStats')}</h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-lg border bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">{t('promptTokens')}</div>
                <div className="font-mono text-sm font-medium">
                  {usage.promptTokens?.toLocaleString() || '-'}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">{t('completionTokens')}</div>
                <div className="font-mono text-sm font-medium">
                  {usage.completionTokens?.toLocaleString() || '-'}
                </div>
              </div>
              <div className="rounded-lg border bg-muted/50 p-3">
                <div className="text-xs text-muted-foreground">{t('totalTokens')}</div>
                <div className="font-mono text-sm font-medium">
                  {usage.totalTokens?.toLocaleString() || '-'}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* SSE 说明 */}
      <Alert>
        <AlertDescription className="text-sm">
          <strong>{t('sseHint')}</strong>
        </AlertDescription>
      </Alert>
    </div>
  );
}
