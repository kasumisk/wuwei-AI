import { ChatTransport, UIMessage, UIMessageChunk, ChatRequestOptions } from 'ai';
import { getApiKeyConfig } from './api/gateway-client';

export class ServerSSETransport implements ChatTransport<UIMessage> {
  private api: string;
  private headers?: Record<string, string>;
  private body?: Record<string, any>;

  constructor({
    api,
    headers,
    body,
  }: {
    api: string;
    headers?: Record<string, string>;
    body?: Record<string, any>;
  }) {
    this.api = api;
    this.headers = headers;
    this.body = body;
  }

  public updateBody(body: Record<string, unknown>) {
    this.body = { ...this.body, ...body };
  }

  async sendMessages(
    options: {
      trigger: 'submit-message' | 'regenerate-message';
      chatId: string;
      messageId: string | undefined;
      messages: UIMessage[];
      abortSignal: AbortSignal | undefined;
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { messages, abortSignal, body } = options;

    // Convert UI messages to server format
    let serverMessages = messages.map((m) => ({
      role: m.role,
      content: m.parts
        .filter((p) => p.type === 'text')
        .map((p) => (p as { text: string }).text)
        .join(''),
    }));

    // Handle system prompt from body
    const requestBody = { ...this.body, ...body };
    if (requestBody.systemPrompt) {
      serverMessages = [{ role: 'system', content: requestBody.systemPrompt }, ...serverMessages];
      delete requestBody.systemPrompt;
    }

    const authConfig = getApiKeyConfig();
    const authHeaders = authConfig
      ? {
          'X-API-Key': authConfig.apiKey,
          'X-API-Secret': authConfig.apiSecret,
        }
      : {};

    // DEBUG: Hardcoded stream to test transport stability
    /*
    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        const chunks = ['Hello', ', ', 'this', ' is', ' a', ' test', '.'];
        for (const chunk of chunks) {
          console.log('[ServerSSETransport] Enqueueing chunk:', chunk);
          controller.enqueue({
            type: 'text-delta',
            delta: chunk,
            id: 'text-part-0',
          });
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        controller.enqueue({
          type: 'finish',
          finishReason: 'stop',
          usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        } as unknown as UIMessageChunk);
        controller.close();
      },
      cancel() {
        console.log('[ServerSSETransport] Hardcoded stream cancelled');
      }
    });
    */

    console.log('[ServerSSETransport] Fetching:', this.api);

    if (abortSignal?.aborted) {
      console.log('[ServerSSETransport] AbortSignal already aborted');
    }
    abortSignal?.addEventListener('abort', () => {
      console.log('[ServerSSETransport] AbortSignal triggered');
    });

    const response = await fetch(this.api, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeaders as Record<string, string>),
        ...this.headers,
        ...(options.headers as Record<string, string>),
      },
      body: JSON.stringify({
        messages: serverMessages,
        ...requestBody,
      }),
      signal: abortSignal,
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        // Send initial start event
        controller.enqueue({
          type: 'start',
          messageId: 'msg-' + Date.now(),
        } as unknown as UIMessageChunk);

        let hasStartedText = false;

        const processLine = (line: string) => {
          const trimmedLine = line.trim();
          if (!trimmedLine) return;

          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.slice(6).trim();
            if (!dataStr) return;

            try {
              const data = JSON.parse(dataStr);
              console.log('[ServerSSETransport] Parsed data:', data);

              if (data.error) {
                controller.enqueue({
                  type: 'error',
                  errorText: data.message || 'Unknown error',
                });
                return;
              }

              if (data.delta) {
                if (!hasStartedText) {
                  controller.enqueue({
                    type: 'text-start',
                    id: 'text-part-0',
                  } as unknown as UIMessageChunk);
                  hasStartedText = true;
                }

                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const chunk: any = {
                  type: 'text-delta',
                  delta: data.delta,
                  id: 'text-part-0',
                };
                // Compatibility: some versions expect textDelta
                chunk.textDelta = data.delta;

                controller.enqueue(chunk);
              }

              if (data.usage) {
                if (hasStartedText) {
                  controller.enqueue({
                    type: 'text-end',
                    id: 'text-part-0',
                  } as unknown as UIMessageChunk);
                }

                controller.enqueue({
                  type: 'finish',
                  finishReason: data.finishReason || 'stop',
                  usage: data.usage,
                } as unknown as UIMessageChunk);
              }
            } catch (e) {
              console.error('Error parsing SSE data:', e, line);
            }
          }
        };

        try {
          while (true) {
            // console.log('[ServerSSETransport] Waiting for chunk...');
            const { done, value } = await reader.read();
            // console.log('[ServerSSETransport] Chunk received:', { done, length: value?.length });

            if (done) {
              buffer += decoder.decode();
              const lines = buffer.split('\n');
              for (const line of lines) {
                processLine(line);
              }
              break;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              processLine(line);
            }
          }
        } catch (error) {
          console.error('[ServerSSETransport] Stream error:', error);
          controller.error(error);
        } finally {
          try {
            controller.close();
          } catch {
            // ignore
          }
          reader.releaseLock();
        }
      },
      cancel() {
        console.log('[ServerSSETransport] Stream cancelled by consumer');
        console.trace('[ServerSSETransport] Cancel trace');
        reader.cancel();
      },
    });
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    // Not implemented for this custom transport
    return null;
  }
}
