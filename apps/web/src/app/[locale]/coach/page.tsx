'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import {
  sendCoachMessage,
  coachService,
  type CoachConversation,
  type DailyGreeting,
} from '@/lib/api/coach';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

export default function CoachPage() {
  const router = useRouter();
  const { isLoggedIn } = useAuth();

  // 状态
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<DailyGreeting | null>(null);
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingGreeting, setLoadingGreeting] = useState(true);

  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // 加载每日问候
  useEffect(() => {
    if (!isLoggedIn) return;
    setLoadingGreeting(true);
    coachService
      .getDailyGreeting()
      .then(setGreeting)
      .catch(() => {
        setGreeting({
          greeting: '你好！我是你的 AI 营养教练，有什么可以帮你的？',
          suggestions: ['帮我规划今日饮食', '推荐健康午餐', '今天的热量目标'],
        });
      })
      .finally(() => setLoadingGreeting(false));
  }, [isLoggedIn]);

  // 登录检查
  useEffect(() => {
    if (!isLoggedIn) {
      router.push('/login');
    }
  }, [isLoggedIn, router]);

  // 发送消息
  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text || inputValue).trim();
      if (!content || isStreaming) return;

      setInputValue('');
      setIsStreaming(true);

      // 添加用户消息
      setMessages((prev) => [...prev, { role: 'user', content }]);
      // 添加空的助手消息（流式填充）
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '', streaming: true },
      ]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      await sendCoachMessage(content, conversationId, {
        onDelta: (delta) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = {
                ...last,
                content: last.content + delta,
              };
            }
            return updated;
          });
        },
        onDone: (newConvId) => {
          setConversationId(newConvId);
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last) {
              updated[updated.length - 1] = { ...last, streaming: false };
            }
            return updated;
          });
          setIsStreaming(false);
        },
        onError: (error) => {
          setMessages((prev) => {
            const updated = [...prev];
            const last = updated[updated.length - 1];
            if (last && last.role === 'assistant') {
              updated[updated.length - 1] = {
                ...last,
                content: error || '抱歉，出现了错误，请重试。',
                streaming: false,
              };
            }
            return updated;
          });
          setIsStreaming(false);
        },
      }, ctrl.signal);
    },
    [inputValue, isStreaming, conversationId],
  );

  // 停止生成
  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last) {
        updated[updated.length - 1] = { ...last, streaming: false };
      }
      return updated;
    });
  }, []);

  // 加载历史对话
  const loadConversations = useCallback(async () => {
    try {
      const convs = await coachService.getConversations();
      setConversations(convs);
    } catch {
      // 忽略错误
    }
  }, []);

  // 加载对话消息
  const loadConversation = useCallback(async (conv: CoachConversation) => {
    try {
      const data = await coachService.getMessages(conv.id);
      const msgs: ChatMessage[] = data.items.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));
      setMessages(msgs);
      setConversationId(conv.id);
      setShowHistory(false);
    } catch {
      // 忽略错误
    }
  }, []);

  // 删除对话
  const deleteConversation = useCallback(
    async (convId: string) => {
      try {
        await coachService.deleteConversation(convId);
        setConversations((prev) => prev.filter((c) => c.id !== convId));
        if (conversationId === convId) {
          setMessages([]);
          setConversationId(null);
        }
      } catch {
        // 忽略错误
      }
    },
    [conversationId],
  );

  // 新对话
  const startNewConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setShowHistory(false);
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSend();
  };

  if (!isLoggedIn) return null;

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* 顶部导航 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-lg hover:bg-muted transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold">AI 营养教练</h1>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={startNewConversation}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            title="新对话"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </button>
          <button
            onClick={() => {
              setShowHistory(!showHistory);
              if (!showHistory) loadConversations();
            }}
            className="p-2 rounded-lg hover:bg-muted transition-colors"
            title="历史记录"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>
        </div>
      </header>

      {/* 历史记录面板 */}
      {showHistory && (
        <div className="absolute inset-0 z-20 bg-background flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <h2 className="text-lg font-semibold">历史对话</h2>
            <button
              onClick={() => setShowHistory(false)}
              className="p-2 rounded-lg hover:bg-muted transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {conversations.length === 0 && (
              <p className="text-center text-muted-foreground py-8">暂无历史对话</p>
            )}
            {conversations.map((conv) => (
              <div
                key={conv.id}
                className="flex items-center justify-between p-3 rounded-lg hover:bg-muted transition-colors cursor-pointer"
              >
                <button
                  onClick={() => loadConversation(conv)}
                  className="flex-1 text-left"
                >
                  <p className="text-sm font-medium truncate">
                    {conv.title || '新对话'}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {new Date(conv.updatedAt).toLocaleDateString('zh-CN')}
                  </p>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(conv.id);
                  }}
                  className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 消息区域 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 pb-32">
        {/* 每日问候卡片 */}
        {messages.length === 0 && (
          <div className="space-y-4 mt-4">
            {loadingGreeting ? (
              <div className="bg-primary/5 rounded-2xl p-4 animate-pulse">
                <div className="h-4 bg-primary/10 rounded w-3/4 mb-2" />
                <div className="h-3 bg-primary/10 rounded w-1/2" />
              </div>
            ) : (
              greeting && (
                <>
                  <div className="bg-primary/5 border border-primary/10 rounded-2xl p-4">
                    <div className="flex items-start gap-3">
                      <span className="text-2xl">🤖</span>
                      <p className="text-sm text-foreground leading-relaxed pt-1">
                        {greeting.greeting}
                      </p>
                    </div>
                  </div>

                  {/* 快捷操作 */}
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground font-medium px-1">
                      快捷提问
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {greeting.suggestions.map((s, i) => (
                        <button
                          key={i}
                          onClick={() => handleSend(s)}
                          disabled={isStreaming}
                          className="px-3 py-1.5 text-sm bg-muted hover:bg-muted/80 text-foreground 
                            rounded-full transition-colors disabled:opacity-50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )
            )}
          </div>
        )}

        {/* 聊天消息 */}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary text-primary-foreground rounded-br-md'
                  : 'bg-muted text-foreground rounded-bl-md'
              }`}
            >
              <p className="whitespace-pre-wrap">{msg.content}</p>
              {msg.streaming && (
                <span className="inline-block w-1.5 h-4 bg-current opacity-60 animate-pulse ml-0.5 align-text-bottom" />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 输入栏 */}
      <div className="fixed bottom-0 left-0 w-full bg-background/80 backdrop-blur-sm border-t border-border px-4 py-3 pb-safe">
        <form onSubmit={handleSubmit} className="flex items-center gap-2 max-w-2xl mx-auto">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="问我任何饮食问题..."
            disabled={isStreaming}
            className="flex-1 h-10 px-4 rounded-full bg-muted border-none text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
          />
          {isStreaming ? (
            <button
              type="button"
              onClick={handleStop}
              className="h-10 w-10 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center flex-shrink-0 transition-colors"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              type="submit"
              disabled={!inputValue.trim()}
              className="h-10 w-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center flex-shrink-0 disabled:opacity-30 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19V5m0 0l-7 7m7-7l7 7" />
              </svg>
            </button>
          )}
        </form>
      </div>
    </div>
  );
}
