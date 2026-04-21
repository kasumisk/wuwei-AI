'use client';

/**
 * AI 教练 API 服务
 * 对接 api-server 的 /api/app/coach/* 端点
 */

import { clientGet, clientDelete } from './client-api';
import type { ApiResponse } from './http-client';

// ==================== 辅助函数 ====================

async function unwrap<T>(promise: Promise<ApiResponse<T>>): Promise<T> {
  const res = await promise;
  if (!res.success) {
    throw new Error(res.message || '请求失败');
  }
  return res.data;
}

// ==================== 类型定义 ====================

export interface CoachMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  tokensUsed: number;
  createdAt: string;
}

export interface CoachConversation {
  id: string;
  userId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DailyGreeting {
  greeting: string;
  suggestions: string[];
}

export interface CoachMessagesPaginated {
  items: CoachMessage[];
  total: number;
}

// ==================== SSE 流式聊天 ====================

export interface CoachStreamCallbacks {
  onDelta: (delta: string) => void;
  onDone: (conversationId: string) => void;
  onError: (error: string) => void;
}

/**
 * 发送消息并接收 SSE 流式响应
 */
export async function sendCoachMessage(
  message: string,
  conversationId: string | null,
  callbacks: CoachStreamCallbacks,
  signal?: AbortSignal
): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('app_auth_token') : null;

  const apiUrl = typeof window !== 'undefined' ? process.env.NEXT_PUBLIC_API_URL || '' : '';

  // P2-5: 读取 sessionStorage 中的分析上下文（不立即删除，等流成功后再清理）
  let analysisContext: Record<string, unknown> | undefined;
  let hasAnalysisContext = false;
  try {
    const raw =
      typeof window !== 'undefined' ? sessionStorage.getItem('coach_analysis_context') : null;
    if (raw) {
      analysisContext = JSON.parse(raw);
      hasAnalysisContext = true;
    }
  } catch {
    /* ignore */
  }

  const res = await fetch(`${apiUrl}/app/coach/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      message,
      ...(conversationId ? { conversationId } : {}),
      ...(analysisContext ? { analysisContext } : {}),
    }),
    signal,
  });

  if (!res.ok) {
    callbacks.onError('服务暂时不可用，请稍后重试');
    return;
  }

  const reader = res.body?.getReader();
  if (!reader) {
    callbacks.onError('无法读取响应流');
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        try {
          const data = JSON.parse(line.slice(6));
          if (data.error) {
            callbacks.onError(data.error);
            return;
          }
          if (data.delta) {
            callbacks.onDelta(data.delta);
          }
          if (data.done) {
            // Delete the analysis context only after successful stream completion
            if (hasAnalysisContext) {
              try { sessionStorage.removeItem('coach_analysis_context'); } catch { /* ignore */ }
            }
            callbacks.onDone(data.conversationId);
            return;
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ==================== REST API ====================

export const coachService = {
  /**
   * 获取每日问候
   */
  getDailyGreeting: async (): Promise<DailyGreeting> => {
    return unwrap(clientGet<DailyGreeting>('/app/coach/daily-greeting'));
  },

  /**
   * 获取对话列表
   */
  getConversations: async (): Promise<CoachConversation[]> => {
    return unwrap(clientGet<CoachConversation[]>('/app/coach/conversations'));
  },

  /**
   * 获取对话消息历史
   */
  getMessages: async (
    conversationId: string,
    page?: number,
    limit?: number
  ): Promise<CoachMessagesPaginated> => {
    const params = new URLSearchParams();
    if (page != null) params.set('page', String(page));
    if (limit != null) params.set('limit', String(limit));
    const qs = params.toString();
    return unwrap(
      clientGet<CoachMessagesPaginated>(
        `/app/coach/conversations/${conversationId}/messages${qs ? `?${qs}` : ''}`
      )
    );
  },

  /**
   * 删除对话
   */
  deleteConversation: async (conversationId: string): Promise<void> => {
    await unwrap(clientDelete<null>(`/app/coach/conversations/${conversationId}`));
  },
};
