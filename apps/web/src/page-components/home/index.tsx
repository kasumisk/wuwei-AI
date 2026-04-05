'use client';

import { useTranslations } from 'next-intl';
import { SiteHeader } from '@/components/common/site-header';
import { LocalizedLink } from '@/components/common/localized-link';
import {
  LayoutGrid,
  Image,
  Code,
  FileText,
  Video,
  Wrench,
  Clock,
  Star,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Bookmark,
  Sparkles,
  Plus,
  User,
  Compass,
} from 'lucide-react';
import { useState, useRef } from 'react';
import { tools, type Tool } from '@/lib/config/tools';

const sidebarNav = [
  { labelKey: 'nav.allTools', icon: LayoutGrid, category: 'all' },
  { labelKey: 'nav.imageTools', icon: Image, category: 'image' },
  { labelKey: 'nav.videoTools', icon: Video, category: 'video' },
  { labelKey: 'nav.devTools', icon: Code, category: 'dev' },
  { labelKey: 'nav.pdfTools', icon: FileText, category: 'pdf' },
  { labelKey: 'nav.utilities', icon: Wrench, category: 'other' },
];

const featured = [
  {
    tagKey: 'home.featured.newFeature',
    tagClass: 'bg-purple-600',
    titleKey: 'home.featured.smartColorPicker',
    descKey: 'home.featured.smartColorPickerDesc',
    href: '/tools/color-picker',
    gradient: 'from-blue-600 via-indigo-700 to-purple-800',
    pattern: 'radial-gradient(ellipse at 30% 80%, rgba(107,56,212,0.4), transparent 60%), radial-gradient(ellipse at 70% 20%, rgba(0,88,190,0.3), transparent 50%)',
  },
  {
    tagKey: 'home.featured.productivity',
    tagClass: 'bg-blue-600',
    titleKey: 'home.featured.batchImageCompressor',
    descKey: 'home.featured.batchImageCompressorDesc',
    href: '/tools/image-compressor',
    gradient: 'from-slate-700 via-slate-800 to-slate-900',
    pattern: 'radial-gradient(ellipse at 20% 50%, rgba(0,101,119,0.5), transparent 60%), radial-gradient(ellipse at 80% 30%, rgba(0,88,190,0.3), transparent 50%)',
  },
  {
    tagKey: 'home.featured.trending',
    tagClass: 'bg-teal-600',
    titleKey: 'home.featured.videoConverter',
    descKey: 'home.featured.videoConverterDesc',
    href: '/tools/video-converter',
    gradient: 'from-teal-700 via-cyan-800 to-blue-900',
    pattern: 'radial-gradient(ellipse at 60% 70%, rgba(0,101,119,0.4), transparent 60%), radial-gradient(ellipse at 30% 20%, rgba(107,56,212,0.3), transparent 50%)',
  },
];

const recentTools = tools.filter((tool) => !tool.comingSoon).slice(0, 4);

export function HomePage() {
  const t = useTranslations();
  const carouselRef = useRef<HTMLDivElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  const filteredTools = tools.filter((tool) => {
    if (tool.comingSoon) return false;
    const matchesSearch =
      !searchQuery ||
      t(tool.titleKey).toLowerCase().includes(searchQuery.toLowerCase()) ||
      t(tool.descKey).toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory =
      activeCategory === 'all' || tool.category === activeCategory;
    return matchesSearch && matchesCategory;
  });

  const showFeatured = activeCategory === 'all' && !searchQuery;

  const scrollCarousel = (dir: 'left' | 'right') => {
    if (!carouselRef.current) return;
    const amount = dir === 'left' ? -400 : 400;
    carouselRef.current.scrollBy({ left: amount, behavior: 'smooth' });
  };

  return (
    <div className="min-h-screen bg-[#f7f9fb] dark:bg-slate-950 text-slate-900 dark:text-white">
      {/* ─── Shared Header ─── */}
      <SiteHeader searchQuery={searchQuery} onSearchChange={setSearchQuery} />

      {/* ─── Body ─── */}
      <div className="flex pt-16 pb-24 md:pb-0">
        {/* ─── Sidebar (Desktop) ─── */}
        <aside className="hidden md:flex flex-col w-64 h-[calc(100vh-64px)] sticky top-16 px-4 py-8 overflow-y-auto border-r border-transparent">
          <nav className="space-y-2">
            <p className="px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-4">
              {t('nav.mainCategories')}
            </p>
            {sidebarNav.map((item) => (
              <button
                key={item.labelKey}
                onClick={() => setActiveCategory(item.category)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl font-semibold text-sm transition-all text-left ${
                  activeCategory === item.category
                    ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                }`}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                <span>{t(item.labelKey)}</span>
                {item.category !== 'all' && (
                  <span className="ml-auto text-[10px] font-bold tabular-nums text-slate-400 dark:text-slate-600">
                    {tools.filter((tool) => tool.category === item.category && !tool.comingSoon).length}
                  </span>
                )}
              </button>
            ))}

            <div className="pt-8">
              <p className="px-4 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 dark:text-slate-500 mb-4">
                {t('nav.workspace')}
              </p>
              <LocalizedLink
                href="/tools"
                className="flex items-center gap-3 px-4 py-3 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl transition-all text-sm"
              >
                <Clock className="h-5 w-5" />
                <span>{t('nav.recentProjects')}</span>
              </LocalizedLink>
              <LocalizedLink
                href="/tools"
                className="flex items-center gap-3 px-4 py-3 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50 rounded-xl transition-all text-sm"
              >
                <Star className="h-5 w-5" />
                <span>{t('nav.favorites')}</span>
              </LocalizedLink>
            </div>
          </nav>
        </aside>

        {/* ─── Main Content ─── */}
        <main className="flex-1 px-4 md:px-12 py-8 overflow-x-hidden">
          {/* ─── Featured Carousel ─── */}
          {showFeatured && (
            <section className="mb-6 md:mb-12">
              <div className="flex items-end justify-between mb-6">
                <div>
                  <h2 className="text-3xl font-extrabold tracking-tight font-headline text-slate-900 dark:text-white">
                    {t('home.featured.title')}
                  </h2>
                  <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
                    {t('home.featured.subtitle')}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => scrollCarousel('left')}
                    className="p-2 rounded-full bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <ChevronLeft className="h-5 w-5 text-slate-600 dark:text-slate-300" />
                  </button>
                  <button
                    onClick={() => scrollCarousel('right')}
                    className="p-2 rounded-full bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 shadow-sm hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    <ChevronRight className="h-5 w-5 text-slate-600 dark:text-slate-300" />
                  </button>
                </div>
              </div>
              <div
                ref={carouselRef}
                className="flex gap-6 overflow-x-auto pb-6 scrollbar-hide snap-x"
              >
                {featured.map((item) => (
                  <LocalizedLink
                    key={item.titleKey}
                    href={item.href}
                    className="min-w-100 md:min-w-150 h-80 rounded-3xl relative overflow-hidden group snap-start cursor-pointer shrink-0"
                  >
                    <div className={`absolute inset-0 bg-linear-to-br ${item.gradient}`} />
                    <div
                      className="absolute inset-0 group-hover:scale-105 transition-transform duration-700"
                      style={{ background: item.pattern }}
                    />
                    <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />
                    <div className="absolute bottom-0 left-0 p-8">
                      <span
                        className={`px-3 py-1 ${item.tagClass} text-white text-[10px] font-bold uppercase tracking-widest rounded-full mb-4 inline-block`}
                      >
                        {t(item.tagKey)}
                      </span>
                      <h3 className="text-white text-3xl font-extrabold mb-2 font-headline">
                        {t(item.titleKey)}
                      </h3>
                      <p className="text-white/80 max-w-md text-sm leading-relaxed">
                        {t(item.descKey)}
                      </p>
                    </div>
                  </LocalizedLink>
                ))}
              </div>
            </section>
          )}

          {/* ─── Recently Used ─── */}
          {showFeatured && (
            <section className="mb-12">
              <div className="flex items-center justify-between mb-2 md:mb-6">
                <h2 className="text-xl font-bold font-headline text-slate-900 dark:text-white">
                  {t('home.recentlyUsed')}
                </h2>
                <LocalizedLink
                  href="/tools"
                  className="text-blue-600 dark:text-blue-400 text-sm font-semibold hover:underline"
                >
                  {t('home.viewAll')}
                </LocalizedLink>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {recentTools.map((tool) => (
                  <LocalizedLink
                    key={tool.href}
                    href={tool.href}
                    className="flex items-center gap-4 p-4 bg-white dark:bg-slate-800/50 rounded-lg shadow-[0_4px_12px_rgba(0,0,0,0.02)] border border-transparent hover:border-blue-200/50 dark:hover:border-blue-800/50 transition-all cursor-pointer"
                  >
                    <div
                      className={`w-12 h-12 rounded-xl ${tool.accentClass} flex items-center justify-center ${tool.textClass}`}
                    >
                      <tool.icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate text-slate-900 dark:text-white">{t(tool.titleKey)}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">{t('home.hoursAgo')}</p>
                    </div>
                  </LocalizedLink>
                ))}
              </div>
            </section>
          )}

          {/* ─── Popular Tools (Bento Grid) ─── */}
          <section className="mb-12">
            <div className="flex items-center justify-between mb-2 md:mb-6">
              <div>
                <h2 className="text-2xl font-extrabold font-headline text-slate-900 dark:text-white">
                  {searchQuery
                    ? t('home.searchResults')
                    : activeCategory === 'all'
                      ? t('home.popularTools')
                      : activeCategory}
                </h2>
                {(searchQuery || activeCategory !== 'all') && (
                  <p className="text-slate-400 dark:text-slate-500 text-sm mt-1">
                    {t('home.toolsFound', { count: filteredTools.length })}
                  </p>
                )}
              </div>
              {activeCategory === 'all' && !searchQuery && (
                <select className="bg-white dark:bg-slate-800 border-none rounded-xl text-sm font-semibold shadow-sm focus:ring-blue-600/20 cursor-pointer py-2 px-3 text-slate-700 dark:text-slate-300">
                  <option>{t('home.sortOptions.trending')}</option>
                  <option>{t('home.sortOptions.alphabetical')}</option>
                  <option>{t('home.sortOptions.newest')}</option>
                </select>
              )}
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-2 md:gap-6">
              {filteredTools.map((tool, i) => (
                <LocalizedLink
                  key={tool.href}
                  href={tool.href}
                  className={`group bg-(--color-card) rounded-lg p-4 md:p-6 shadow-[0_10px_30px_rgba(0,0,0,0.02)] hover:shadow-[0_20px_40px_rgba(0,88,190,0.06)] transition-all cursor-pointer border border-transparent hover:border-blue-200/50 dark:hover:border-blue-800/30 flex flex-col h-full ${
                    i === 5 ? 'md:col-span-2' : ''
                  }`}
                >
                  {i === 5 ? (
                    /* Promotional wide card */
                    <div className="flex items-center gap-8 h-full relative overflow-hidden p-4">
                      <div className="absolute inset-0 ai-gradient-bg rounded-lg" />
                      <div className="flex-1 relative z-10">
                        <span className="text-blue-700 dark:text-blue-400 text-[10px] font-extrabold uppercase tracking-widest mb-2 block">
                          {t('home.premiumExperience')}
                        </span>
                        <h4 className="text-2xl font-black mb-3 font-headline text-slate-900 dark:text-white">
                          {t(tool.titleKey)}
                        </h4>
                        <p className="text-slate-600 dark:text-slate-400 text-sm leading-relaxed mb-2 md:mb-6 max-w-sm">
                          {t(tool.descKey)}
                        </p>
                        <span className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-sm shadow-lg shadow-blue-600/20 transition-colors">
                          {t('home.startTraining')}
                          <ArrowRight className="h-4 w-4" />
                        </span>
                      </div>
                      <div className="hidden lg:block absolute -right-12 -bottom-12 opacity-20 -rotate-12 group-hover:rotate-0 transition-transform duration-700">
                        <Sparkles className="h-64 w-64 text-blue-600" />
                      </div>
                    </div>
                  ) : (
                    /* Standard tool card */
                    <>
                      <div className="flex justify-between items-start mb-2 md:mb-6">
                        <div
                          className={`w-14 h-14 rounded-2xl ${tool.accentClass} flex items-center justify-center ${tool.textClass} group-hover:scale-110 transition-transform`}
                        >
                          <tool.icon className="h-7 w-7" />
                        </div>
                        <Bookmark className="h-5 w-5 text-slate-300 dark:text-slate-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors" />
                      </div>
                      <h4 className="text-lg font-bold mb-2 text-slate-900 dark:text-white">{t(tool.titleKey)}</h4>
                      <p className="text-slate-500 dark:text-slate-400 text-xs leading-relaxed mb-2 md:mb-6 grow">
                        {t(tool.descKey)}
                      </p>
                      <div className="flex items-center justify-between pt-4 border-t border-slate-50 dark:border-slate-700/50">
                        <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest">
                          {t(`tools.categories.${tool.category}`)}
                        </span>
                        <ArrowRight className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                      </div>
                    </>
                  )}
                </LocalizedLink>
              ))}
            </div>
          </section>
        </main>
      </div>

      {/* ─── Mobile Bottom Nav ─── */}
      <nav className="md:hidden fixed bottom-0 left-0 w-full z-50 flex justify-around items-center px-4 pb-6 pt-2 bg-white/80 dark:bg-slate-900/80 backdrop-blur-lg border-t border-slate-200/20 dark:border-slate-800/20 shadow-[0_-10px_30px_rgba(0,0,0,0.05)]">
        <LocalizedLink
          href="/tools"
          className="flex flex-col items-center justify-center text-blue-600 dark:text-blue-400 bg-blue-50/50 dark:bg-blue-900/20 rounded-xl px-3 py-1 transition-all"
        >
          <LayoutGrid className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-1">{t('nav.tools')}</span>
        </LocalizedLink>
        <LocalizedLink
          href="/tools"
          className="flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 transition-all"
        >
          <Sparkles className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-1">{t('nav.workspace')}</span>
        </LocalizedLink>
        <LocalizedLink
          href="/about"
          className="flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 transition-all"
        >
          <Compass className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-1">{t('nav.explore')}</span>
        </LocalizedLink>
        <LocalizedLink
          href="/login"
          className="flex flex-col items-center justify-center text-slate-500 dark:text-slate-400 transition-all"
        >
          <User className="h-5 w-5" />
          <span className="text-[10px] font-medium mt-1">{t('nav.account')}</span>
        </LocalizedLink>
      </nav>

      {/* ─── FAB ─── */}
      <button className="fixed bottom-8 right-8 md:bottom-12 md:right-12 w-16 h-16 bg-blue-600 hover:bg-blue-700 text-white rounded-full shadow-2xl shadow-blue-600/40 hidden md:flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-40">
        <Plus className="h-7 w-7" />
      </button>
    </div>
  );
}
