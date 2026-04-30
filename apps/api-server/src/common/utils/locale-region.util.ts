const LOCALE_REGION_MAP: Record<string, string> = {
  'zh-CN': 'CN',
  'zh-TW': 'TW',
  'en-US': 'US',
  'ja-JP': 'JP',
  'ko-KR': 'KR',
  'es-ES': 'ES',
};

export function normalizeLocale(locale: string): string {
  const [language, region] = locale.trim().replace('_', '-').split('-');
  if (!language) return locale;
  return region
    ? `${language.toLowerCase()}-${region.toUpperCase()}`
    : language.toLowerCase();
}

export function localeToFoodRegion(locale: string): string | null {
  const normalized = normalizeLocale(locale);
  if (LOCALE_REGION_MAP[normalized]) return LOCALE_REGION_MAP[normalized];

  const region = normalized.split('-')[1];
  return region ? region.toUpperCase() : null;
}

export function localesToFoodRegions(locales?: string[]): string[] {
  const regions = (locales ?? [])
    .map(localeToFoodRegion)
    .filter((region): region is string => !!region);

  return [...new Set(regions)];
}
