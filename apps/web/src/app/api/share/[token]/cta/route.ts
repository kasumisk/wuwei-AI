import { NextResponse } from 'next/server';
import { trackShareCta } from '@/lib/share/api';

type RouteContext = {
  params: Promise<{ token: string }>;
};

const FALLBACK_APP_STORE_URL = 'https://apps.apple.com/us/app/eatcheck/id6763199295';

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const redirectUrl = (await trackShareCta(token)) || FALLBACK_APP_STORE_URL;
  return NextResponse.redirect(redirectUrl, 302);
}
