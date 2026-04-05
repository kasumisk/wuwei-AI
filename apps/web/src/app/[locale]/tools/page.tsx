import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, getLocale } from 'next-intl/server';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { KeyRound, Palette, Video, FileText, FileJson } from 'lucide-react';
import { buildPageMetadata, toolRouteKeyMap } from '@/lib/seo/metadata';
import { buildToolListSchema, buildBreadcrumbSchema } from '@/lib/seo/structured-data';
import { JsonLd } from '@/lib/seo/JsonLd';
import type { Locale } from '@/lib/i18n/config';
import { tools, type Tool } from '@/lib/config/tools';

const categoryIds = ['all', 'image', 'video', 'pdf', 'dev', 'other'] as const;

const categoryIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  image: Palette,
  video: Video,
  pdf: FileText,
  dev: FileJson,
  other: KeyRound,
};

const categoryIconColors: Record<string, string> = {
  image: 'text-blue-500',
  video: 'text-violet-500',
  pdf: 'text-red-500',
  dev: 'text-yellow-500',
  other: 'text-red-500',
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('tools');
  const locale = (await getLocale()) as Locale;
  return buildPageMetadata({
    title: t('toolbox.pageTitle'),
    description: t('toolbox.pageDescription'),
    path: '/tools',
    locale,
  });
}

export default async function ToolsPage() {
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;

  // Build ItemList structured data from real tools
  const toolItems = Object.entries(toolRouteKeyMap).map(([slug, key]) => ({
    name: t(`tools.${key}.shortTitle`),
    slug,
    description: t(`tools.${key}.description`),
  }));

  const breadcrumbSchema = buildBreadcrumbSchema([
    { name: 'Home', url: '/' },
    { name: t('tools.toolbox.title'), url: '/tools' },
  ]);

  const toolListSchema = buildToolListSchema(toolItems, locale);

  return (
    <div className="container mx-auto py-8 px-4">
      <JsonLd data={breadcrumbSchema} />
      <JsonLd data={toolListSchema} />
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">{t('tools.toolbox.title')}</h1>
        <p className="text-muted-foreground">
          {t('tools.toolbox.description')}
        </p>
      </div>

      {/* Category Navigation */}
      <div className="mb-6 flex flex-wrap gap-2">
        {categoryIds.map((catId) => (
          <a
            key={catId}
            href={catId === 'all' ? '#' : `#${catId}`}
            className="px-4 py-2 rounded-full bg-muted hover:bg-primary/10 transition-colors text-sm font-medium"
          >
            {t(`tools.categories.${catId}`)}
          </a>
        ))}
      </div>

      {/* Tool sections by category */}
      {categoryIds.filter(id => id !== 'all').map((catId) => {
        const catTools = tools.filter((tool) => tool.category === catId);
        if (catTools.length === 0) return null;
        const IconComponent = categoryIcons[catId];
        return (
          <section key={catId} id={catId} className="mb-10">
            <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
              {IconComponent && <IconComponent className={`w-5 h-5 ${categoryIconColors[catId]}`} />}
              {t(`tools.categories.${catId}`)}
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {catTools.map((tool) => (
                <ToolCard key={tool.href} tool={tool} title={t(tool.shortTitleKey)} description={t(tool.descKey)} comingSoonLabel={t('tools.toolbox.comingSoon')} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ToolCard({ tool, title, description, comingSoonLabel }: { tool: Tool; title: string; description: string; comingSoonLabel?: string }) {
  if (tool.comingSoon) {
    return (
      <div>
        <Card className="h-full transition-all cursor-not-allowed opacity-60">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg bg-muted ${tool.color}`}>
                <tool.icon className="w-6 h-6" />
              </div>
              <div className="flex-1">
                <CardTitle className="flex items-center gap-2">
                  {title}
                  <span className="px-1.5 py-0.5 text-xs bg-muted-foreground/20 text-muted-foreground rounded">
                    {comingSoonLabel || 'Coming Soon'}
                  </span>
                </CardTitle>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <CardDescription>{description}</CardDescription>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <Link href={tool.href}>
      <Card className="h-full hover:shadow-lg transition-all hover:-translate-y-1 cursor-pointer group">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg bg-muted ${tool.color}`}>
              <tool.icon className="w-6 h-6" />
            </div>
            <div className="flex-1">
              <CardTitle className="group-hover:text-primary transition-colors flex items-center gap-2">
                {title}
                {tool.isNew && (
                  <span className="px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded">
                    NEW
                  </span>
                )}
              </CardTitle>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <CardDescription>{description}</CardDescription>
        </CardContent>
      </Card>
    </Link>
  );
}
