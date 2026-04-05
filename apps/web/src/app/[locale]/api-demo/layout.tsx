import { getTranslations } from 'next-intl/server';

export async function generateMetadata() {
  const t = await getTranslations('pages.api-demo');
  return {
    title: t('title'),
    description: t('description'),
  };
}

export default async function ApiDemoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
