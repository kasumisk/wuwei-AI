export type ShareType =
  | 'meal_score'
  | 'compare'
  | 'shock_insight'
  | 'weekly_summary';

export type ShareVisibility = 'private' | 'unlisted' | 'public_indexed';

export interface ShareMetric {
  label: string;
  value: number | string;
  unit?: string;
  tone?: 'good' | 'neutral' | 'warning' | 'danger';
}

export interface ShareSnapshot {
  version: 1;
  type: ShareType;
  sourceType: 'analysis' | 'record' | 'custom';
  sourceId?: string;
  title: string;
  subtitle?: string;
  hook: string;
  summary: string;
  score?: number;
  decision?: string;
  betterChoice?: string;
  imageUrl?: string;
  metrics: ShareMetric[];
  highlights: string[];
  risks: string[];
  foods: Array<{
    name: string;
    calories?: number;
    protein?: number;
    sugar?: number;
    sodium?: number;
  }>;
  cta: {
    label: string;
    appStoreUrl: string;
    googlePlayUrl?: string;
  };
  brand: {
    name: 'EatCheck';
    tagline: string;
  };
  seo: {
    title: string;
    description: string;
    indexable: boolean;
  };
  createdAt: string;
}

export interface PublicShareResponse {
  id: string;
  token: string;
  shareType: ShareType;
  sourceType: 'analysis' | 'record' | 'custom';
  visibility: ShareVisibility;
  status: string;
  locale?: string;
  title: string;
  description: string;
  snapshot: ShareSnapshot;
  createdAt: string;
  expiresAt?: string;
}
