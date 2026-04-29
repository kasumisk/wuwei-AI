import type { Metadata } from 'next';
import { getLocale } from 'next-intl/server';
import { EatCheckLanding } from '@/features/landing/components/eatcheck-landing';
import { i18n } from '@/lib/i18n/config';

export const metadata: Metadata = {
  title: 'EatCheck | Nutrition awareness for everyday meals',
  description:
    'EatCheck helps people understand meal patterns, nutrition context, and daily eating habits for general wellness. Not medical advice.',
};

function localizedPath(path: string, locale: string) {
  return locale === i18n.defaultLocale ? path : `/${locale}${path}`;
}

export default async function LandingPage() {
  const locale = await getLocale();

  return (
    <EatCheckLanding
      homeHref={localizedPath('/home', locale)}
      privacyHref={localizedPath('/privacy', locale)}
      termsHref={localizedPath('/terms', locale)}
    />
  );
}
