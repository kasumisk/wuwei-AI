import { getTranslations, getLocale } from 'next-intl/server';
import { buildPageMetadata, toolRouteKeyMap } from '@/lib/seo/metadata';
import { buildToolSchema, buildBreadcrumbSchema } from '@/lib/seo/structured-data';
import { JsonLd } from '@/lib/seo/JsonLd';
import type { Locale } from '@/lib/i18n/config';

/**
 * Generate full SEO metadata for a tool page.
 * Call from each tool page's generateMetadata().
 */
export async function generateToolMetadata(toolSlug: string) {
  const translationKey = toolRouteKeyMap[toolSlug];
  if (!translationKey) throw new Error(`Unknown tool slug: ${toolSlug}`);

  const t = await getTranslations(`tools.${translationKey}`);
  const locale = (await getLocale()) as Locale;

  return buildPageMetadata({
    title: t('pageTitle'),
    description: t('pageDescription'),
    path: `/tools/${toolSlug}`,
    locale,
  });
}

/**
 * Server component that renders JSON-LD structured data for a tool page.
 * Include in each tool page's default export.
 */
export async function ToolJsonLd({ toolSlug }: { toolSlug: string }) {
  const translationKey = toolRouteKeyMap[toolSlug];
  if (!translationKey) return null;

  const t = await getTranslations(`tools.${translationKey}`);
  const tCommon = await getTranslations('tools.toolbox');
  const locale = (await getLocale()) as Locale;

  const toolSchema = buildToolSchema({
    name: t('pageTitle'),
    description: t('pageDescription'),
    toolSlug,
    locale,
  });

  const breadcrumbSchema = buildBreadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: tCommon('title'), url: '/tools' },
    { name: t('pageTitle'), url: `/tools/${toolSlug}` },
  ]);

  return (
    <>
      <JsonLd data={toolSchema} />
      <JsonLd data={breadcrumbSchema} />
    </>
  );
}
