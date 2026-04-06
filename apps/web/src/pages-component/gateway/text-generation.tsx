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
import { Slider } from '@/components/ui/slider';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { generateText, type TextGenerationResponse } from '@/lib/api/gateway-client';
import { Loader2, Send, AlertCircle, Copy, Check } from 'lucide-react';

const MODELS = [
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { value: 'gpt-4', label: 'GPT-4' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'qwen-plus', label: 'Qwen Plus' },
  { value: 'deepseek-chat', label: 'DeepSeek Chat' },
];

export function TextGenerationTest() {
  const t = useTranslations('components.textGeneration');
  const [prompt, setPrompt] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [model, setModel] = useState('gpt-3.5-turbo');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);
  const [topP, setTopP] = useState(1.0);

  const [isLoading, setIsLoading] = useState(false);
  const [response, setResponse] = useState<TextGenerationResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async () => {
    if (!prompt.trim()) {
      setError(t('errorEmptyPrompt'));
      return;
    }

    setIsLoading(true);
    setError(null);
    setResponse(null);

    // 使用 OpenAI 标准的 messages 格式
    const messages = [];
    if (systemPrompt.trim()) {
      messages.push({ role: 'system' as const, content: systemPrompt });
    }
    messages.push({ role: 'user' as const, content: prompt });

    const result = await generateText({
      messages,
      model,
      temperature,
      maxTokens,
      topP,
    });

    setIsLoading(false);

    if (result.success && result.data) {
      setResponse(result.data);
    } else {
      setError(result?.message || t('errorRequestFailed'));
    }
  };
  console.log('response', response);

  const handleCopy = () => {
    if (response?.text) {
      navigator.clipboard.writeText(response.text);
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
          <Select value={model} onValueChange={setModel}>
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
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="topP">Top P: {topP.toFixed(2)}</Label>
          <Slider
            id="topP"
            min={0}
            max={1}
            step={0.1}
            value={[topP]}
            onValueChange={([value]) => setTopP(value)}
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
        />
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
            <Send className="h-4 w-4" />
            {t('submit')}
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

      {/* 响应结果 */}
      {response && (
        <div className="space-y-4">
          <Card>
            <CardContent className="pt-6">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">{t('result')}</h3>
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
              </div>
              <div className="rounded-lg bg-muted p-4">
                <pre className="whitespace-pre-wrap font-sans text-sm">{response.text}</pre>
              </div>
            </CardContent>
          </Card>

          {/* <Card>
            <CardContent className="pt-6">
              <h3 className="mb-3 font-semibold">使用统计</h3>
              <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">模型</div>
                  <div className="font-mono text-sm font-medium">{response.model}</div>
                </div>
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">输入 Token</div>
                  <div className="font-mono text-sm font-medium">
                    {response.usage.promptTokens.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">输出 Token</div>
                  <div className="font-mono text-sm font-medium">
                    {response.usage.completionTokens.toLocaleString()}
                  </div>
                </div>
                <div className="rounded-lg border bg-muted/50 p-3">
                  <div className="text-xs text-muted-foreground">总计 Token</div>
                  <div className="font-mono text-sm font-medium">
                    {response.usage.totalTokens.toLocaleString()}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <h3 className="mb-3 font-semibold">费用信息</h3>
              <div className="rounded-lg border bg-gradient-to-br from-primary/10 to-primary/5 p-4">
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold">{response.cost.amount.toFixed(6)}</span>
                  <span className="text-lg text-muted-foreground">{response.cost.currency}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Request ID: {response.requestId}
                </div>
              </div>
            </CardContent>
          </Card> */}
        </div>
      )}
    </div>
  );
}
