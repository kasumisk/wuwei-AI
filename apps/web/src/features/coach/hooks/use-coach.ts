'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
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

export function useCoach() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [greeting, setGreeting] = useState<DailyGreeting | null>(null);
  const [conversations, setConversations] = useState<CoachConversation[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [loadingGreeting, setLoadingGreeting] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  const loadGreeting = useCallback(async () => {
    setLoadingGreeting(true);
    try {
      const g = await coachService.getDailyGreeting();
      setGreeting(g);
    } catch {
      setGreeting({
        greeting: '你好！我是你的 AI 营养教练，有什么可以帮你的？',
        suggestions: ['帮我规划今日饮食', '推荐健康午餐', '今天的热量目标'],
      });
    } finally {
      setLoadingGreeting(false);
    }
  }, []);

  const handleSend = useCallback(
    async (text?: string) => {
      const content = (text || inputValue).trim();
      if (!content || isStreaming) return;

      setInputValue('');
      setIsStreaming(true);

      setMessages((prev) => [...prev, { role: 'user', content }]);
      setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true }]);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      await sendCoachMessage(
        content,
        conversationId,
        {
          onDelta: (delta) => {
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                updated[updated.length - 1] = { ...last, content: last.content + delta };
              }
              return updated;
            });
          },
          onDone: (newConvId) => {
            setConversationId(newConvId);
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last) updated[updated.length - 1] = { ...last, streaming: false };
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
        },
        ctrl.signal
      );
    },
    [inputValue, isStreaming, conversationId]
  );

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsStreaming(false);
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last) updated[updated.length - 1] = { ...last, streaming: false };
      return updated;
    });
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const convs = await coachService.getConversations();
      setConversations(convs);
    } catch {
      // ignore
    }
  }, []);

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
      // ignore
    }
  }, []);

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
        // ignore
      }
    },
    [conversationId]
  );

  const startNewConversation = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setShowHistory(false);
  }, []);

  const toggleHistory = useCallback(() => {
    setShowHistory((prev) => {
      if (!prev) loadConversations();
      return !prev;
    });
  }, [loadConversations]);

  return {
    messages,
    inputValue,
    setInputValue,
    isStreaming,
    greeting,
    loadingGreeting,
    conversations,
    showHistory,
    handleSend,
    handleStop,
    loadGreeting,
    loadConversation,
    deleteConversation,
    startNewConversation,
    toggleHistory,
    setShowHistory,
  };
}
