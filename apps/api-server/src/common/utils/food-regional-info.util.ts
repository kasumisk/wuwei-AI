export interface FoodRegionScope {
  countryCode: string;
  regionCode: string | null;
  cityCode: string | null;
}

export function parseFoodRegionScope(regionCode: string): FoodRegionScope {
  const parts = regionCode
    .split('-')
    .map((part) => part.trim())
    .filter(Boolean);

  return {
    countryCode: (parts[0] || regionCode || 'CN').toUpperCase().slice(0, 2),
    regionCode: parts[1] ? parts[1].toUpperCase() : null,
    cityCode: parts[2] ? parts.slice(2).join('-').toUpperCase() : null,
  };
}

export function buildFoodRegionalWhere(regionCode: string) {
  const scope = parseFoodRegionScope(regionCode);

  return {
    countryCode: scope.countryCode,
    regionCode: scope.regionCode,
    cityCode: scope.cityCode,
  };
}

export function buildFoodRegionalFallbackWhere(regionCode: string) {
  const scope = parseFoodRegionScope(regionCode);

  return {
    countryCode: scope.countryCode,
    OR: [
      { regionCode: scope.regionCode, cityCode: scope.cityCode },
      { regionCode: scope.regionCode, cityCode: null },
      { regionCode: null, cityCode: null },
    ],
  };
}

export function getFoodRegionSpecificity(info: {
  regionCode?: string | null;
  cityCode?: string | null;
}): number {
  return (info.regionCode ? 1 : 0) + (info.cityCode ? 1 : 0);
}

export function normalizeFoodAvailability(value: unknown) {
  if (typeof value !== 'string') return undefined;

  switch (value.trim().toLowerCase()) {
    case 'year_round':
    case 'yearround':
    case 'all_year':
    case 'all-year':
    case 'common':
      return 'YEAR_ROUND';
    case 'seasonal':
      return 'SEASONAL';
    case 'rare':
      return 'RARE';
    case 'limited':
    case 'specialty':
    case 'imported':
      return 'LIMITED';
    case 'unknown':
      return 'UNKNOWN';
    default:
      return undefined;
  }
}

export function formatFoodRegionScope(scope: FoodRegionScope): string {
  return [scope.countryCode, scope.regionCode, scope.cityCode]
    .filter(Boolean)
    .join('-');
}
