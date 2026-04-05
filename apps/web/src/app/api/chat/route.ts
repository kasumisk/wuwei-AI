import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';

export const runtime = 'edge';

export async function POST(req: NextRequest) {
  try {
    const { messages } = await req.json();

    // TODO: Get real auth token from session/cookie
    // For now using the test keys as requested, but securely on server side
    const apiKey = 'test-api-key-123';
    const apiSecret = 'test-secret-456';

    // Forward request to NestJS backend
    const response = await fetch(`${env.NEXT_PUBLIC_API_URL}/langchain/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'x-api-secret': apiSecret,
      },
      body: JSON.stringify({
        messages,
        model: 'gpt-3.5-turbo', // Default model, can be dynamic
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      return NextResponse.json({ error }, { status: response.status });
    }

    // Forward the stream directly
    return new Response(response.body, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    console.error('Chat API Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
