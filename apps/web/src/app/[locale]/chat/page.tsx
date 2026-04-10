'use client';

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { useChat } from '@ai-sdk/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Send, User, Bot, Settings2, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

import { ServerSSETransport } from '@/lib/server-sse-transport';

const MODELS = [
  { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' },
  { value: 'gpt-4', label: 'GPT-4' },
  { value: 'gpt-4-turbo', label: 'GPT-4 Turbo' },
  { value: 'qwen-plus', label: 'Qwen Plus' },
  { value: 'deepseek-chat', label: 'DeepSeek Chat' },
];

export default function ChatPage() {
  const t = useTranslations('chat');
  // Settings State
  const [model, setModel] = useState('deepseek-chat');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(500);
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful assistant.');
  const [showSettings, setShowSettings] = useState(false);

  const transport = useMemo(
    () =>
      new ServerSSETransport({
        api: '/api/gateway/text/generation/stream',
      }),
    []
  );

  const { messages, status, setMessages, stop, sendMessage } = useChat({
    transport,
    // body: {
    //   model,
    //   temperature,
    //   maxTokens,
    //   systemPrompt,
    // },
    onError: (error) => {
      console.error('Chat error:', error);
    },
  });

  const [inputValue, setInputValue] = useState('');

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputValue.trim()) return;

    await sendMessage({
      text: inputValue,
    });
    setInputValue('');
  };

  useEffect(() => {
    if (transport instanceof ServerSSETransport) {
      transport.updateBody({
        model,
        temperature,
        maxTokens,
        systemPrompt,
      });
    }
  }, [model, temperature, maxTokens, systemPrompt, transport]);

  const isLoading = status === 'submitted' || status === 'streaming';
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const clearChat = () => {
    setMessages([]);
  };

  return (
    <div className="container mx-auto p-4 pb-20 h-[calc(100vh-4rem)] flex gap-4">
      {/* Settings Sidebar (Desktop) */}
      <div
        className={cn(
          'w-80 flex-col gap-4 hidden md:flex',
          showSettings ? 'flex' : 'hidden md:flex'
        )}
      >
        <Card className="h-full overflow-y-auto">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Settings2 className="w-5 h-5" />
              {t('settings.title')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="model">{t('model')}</Label>
              <Select value={model} onValueChange={setModel} disabled={isLoading}>
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
              <div className="flex justify-between">
                <Label htmlFor="temperature">{t('temperature')}</Label>
                <span className="text-xs text-muted-foreground">{temperature.toFixed(1)}</span>
              </div>
              <Slider
                id="temperature"
                min={0}
                max={2}
                step={0.1}
                value={[temperature]}
                onValueChange={([value]) => setTemperature(value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <Label htmlFor="maxTokens">{t('maxTokens')}</Label>
                <span className="text-xs text-muted-foreground">{maxTokens}</span>
              </div>
              <Slider
                id="maxTokens"
                min={100}
                max={4000}
                step={100}
                value={[maxTokens]}
                onValueChange={([value]) => setMaxTokens(value)}
                disabled={isLoading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="systemPrompt">{t('systemPrompt')}</Label>
              <Textarea
                id="systemPrompt"
                placeholder={t('systemPromptPlaceholder')}
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                disabled={isLoading}
                className="resize-none"
              />
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={clearChat}
              disabled={isLoading || messages.length === 0}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {t('clearChat')}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Chat Area */}
      <Card className="flex-1 flex flex-col overflow-hidden">
        <CardHeader className="border-b py-3 flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Bot className="w-6 h-6" />
            {t('title')}
          </CardTitle>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setShowSettings(!showSettings)}
          >
            <Settings2 className="w-5 h-5" />
          </Button>
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4" ref={scrollRef}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground space-y-4">
              <Bot className="w-12 h-12 opacity-20" />
              <p>{t('startConversation')}</p>
            </div>
          )}
          {messages.map((m, idx) => (
            <div
              key={idx}
              className={cn('flex gap-3', m.role === 'user' ? 'flex-row-reverse' : 'flex-row')}
            >
              <Avatar className={cn('w-8 h-8', m.role === 'user' ? 'bg-primary' : 'bg-muted')}>
                <AvatarFallback>
                  {m.role === 'user' ? (
                    <User className="w-4 h-4 text-primary-foreground" />
                  ) : (
                    <Bot className="w-4 h-4" />
                  )}
                </AvatarFallback>
              </Avatar>
              <div
                className={cn(
                  'rounded-lg p-3 max-w-[80%] text-sm',
                  m.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground'
                )}
              >
                <div className="whitespace-pre-wrap">
                  {m.parts
                    .filter((part) => part.type === 'text')
                    .map((part, i) => (
                      <span key={i}>{part.text}</span>
                    ))}
                </div>
              </div>
            </div>
          ))}
          {isLoading && messages[messages.length - 1]?.role === 'user' && (
            <div className="flex gap-3">
              <Avatar className="w-8 h-8 bg-muted">
                <AvatarFallback>
                  <Bot className="w-4 h-4" />
                </AvatarFallback>
              </Avatar>
              <div className="bg-muted rounded-lg p-3">
                <div className="flex space-x-1">
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  ></div>
                  <div
                    className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  ></div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
        <CardFooter className="border-t p-4">
          <form onSubmit={handleSubmit} className="flex w-full gap-2">
            <Input
              value={inputValue}
              onChange={handleInputChange}
              placeholder={t('inputPlaceholder')}
              disabled={isLoading}
              className="flex-1"
            />
            {isLoading ? (
              <Button type="button" variant="destructive" onClick={() => stop()}>
                {t('stop')}
              </Button>
            ) : (
              <Button type="submit" disabled={!inputValue.trim()}>
                <Send className="w-4 h-4 mr-2" />
                {t('send')}
              </Button>
            )}
          </form>
        </CardFooter>
      </Card>
    </div>
  );
}
