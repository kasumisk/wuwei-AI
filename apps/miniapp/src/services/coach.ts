import { get, post, del } from './request';
import Taro from '@tarojs/taro';
import { getToken } from '@/utils/storage';
import type { CoachMessage, CoachConversation, DailyGreeting } from '@/types/api';

const API_BASE_URL = process.env.TARO_APP_API_URL || 'https://uway-api.dev-net.uk/api';

/** 发送教练消息（非流式回退） */
export function sendMessage(message: string, conversationId?: string) {
  return post<{ message: CoachMessage; conversationId: string }>('/app/coach/chat', {
    message,
    conversationId,
  });
}

/**
 * 发送教练消息 - 流式（使用 requestTask + onChunk）
 * 小程序环境下使用 enableChunked 实现类流式效果
 */
export function sendMessageStream(
  message: string,
  conversationId: string | undefined,
  onChunk: (text: string) => void,
  onDone: (fullText: string, convId: string) => void,
  onError: (err: Error) => void
) {
  const token = getToken();
  let fullText = '';
  let newConvId = conversationId || '';
  let done = false; // 防止 onDone 被调用多次
  let lineBuffer = ''; // 跨 chunk 行缓冲

  function finalize() {
    if (done) return;
    done = true;
    onDone(fullText, newConvId);
  }

  const task = Taro.request({
    url: `${API_BASE_URL}/app/coach/chat`,
    method: 'POST',
    header: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    data: { message, conversationId },
    enableChunked: true,
    success: () => {
      // 流结束 — 仅在 [DONE] 未触发时收尾
      finalize();
    },
    fail: (err) => {
      if (!done) {
        onError(new Error(err.errMsg || '请求失败'));
      }
    },
  } as any);

  // 监听 chunk 数据
  (task as any).onChunkReceived?.((res: { data: ArrayBuffer }) => {
    try {
      const text = new TextDecoder().decode(res.data);
      // 将缓冲的不完整行与新数据拼接
      const combined = lineBuffer + text;
      const lines = combined.split('\n');
      // 最后一个元素可能是不完整行，保留到下次
      lineBuffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue; // 空行跳过
        if (trimmed.startsWith('data: ')) {
          const data = trimmed.slice(6).trim();
          if (data === '[DONE]') {
            finalize();
            return;
          }
          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              fullText += parsed.content;
              onChunk(fullText);
            }
            if (parsed.conversationId) {
              newConvId = parsed.conversationId;
            }
          } catch {
            // 非 JSON 数据，可能是纯文本 chunk
            fullText += data;
            onChunk(fullText);
          }
        }
      }
    } catch {
      // ignore decode errors
    }
  });

  return task;
}

/** 每日问候 */
export function getDailyGreeting() {
  return get<DailyGreeting>('/app/coach/daily-greeting');
}

/** 获取对话列表 */
export function getConversations() {
  return get<CoachConversation[]>('/app/coach/conversations');
}

/** 获取对话消息 */
export function getMessages(conversationId: string, page = 1, limit = 50) {
  return get<{ items: CoachMessage[]; total: number }>(
    `/app/coach/conversations/${conversationId}/messages`,
    { page, limit }
  );
}

/** 删除对话 */
export function deleteConversation(conversationId: string) {
  return del(`/app/coach/conversations/${conversationId}`);
}
