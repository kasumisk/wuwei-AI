import { serverGet, serverPost } from '@/lib/api/server-api';
import type { PublicShareResponse } from './types';

export async function getPublicShare(token: string): Promise<PublicShareResponse | null> {
  try {
    const res = await serverGet<PublicShareResponse>(`/app/shares/${token}`);
    return res.data;
  } catch {
    return null;
  }
}

export async function trackShareView(token: string): Promise<void> {
  try {
    await serverPost(`/app/shares/${token}/view`);
  } catch {
    // Analytics must never block rendering.
  }
}

export async function trackShareCta(token: string): Promise<string | null> {
  try {
    const res = await serverPost<{ redirectUrl: string }>(`/app/shares/${token}/cta`);
    return res.data.redirectUrl;
  } catch {
    return null;
  }
}
