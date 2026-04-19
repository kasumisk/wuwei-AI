'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Search, Gem, User } from 'lucide-react';
import { ThemeToggle } from '@/components/common/theme-toggle';
import { LanguageToggle } from '@/components/common/language-toggle';
import { LocalizedLink } from '@/components/common/localized-link';

const headerNav = [
  { labelKey: 'nav.tools', href: '/tools', pattern: /\/tools/ },
  { labelKey: 'nav.workspace', href: '/tools', pattern: /\/workspace/ },
];

interface SiteHeaderProps {
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
}

export function SiteHeader({ searchQuery = '', onSearchChange }: SiteHeaderProps) {
  const pathname = usePathname();
  const t = useTranslations();

  // Determine active nav item from pathname
  const isActive = (pattern: RegExp) => {
    const path = pathname ?? '';
    // Homepage is also a "Tools" active context
    if (pattern.source === '\\/tools') {
      return /\/(tools|$)/.test(path.replace(/^\/[a-z]{2}/, ''));
    }
    return pattern.test(path);
  };

  return (
    <header className="fixed top-0 w-full z-50 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl shadow-[0_20px_40px_rgba(0,88,190,0.06)] border-b border-slate-100/80 dark:border-slate-800/30">
      <div className="flex justify-between items-center px-8 h-16 w-full max-w-screen-2xl mx-auto">
        {/* Left: Logo + Nav */}
        <div className="flex items-center gap-8">
          <LocalizedLink href="/">
            <h1 className="text-xl font-bold bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent font-headline cursor-pointer">
              无畏健康
            </h1>
          </LocalizedLink>
          <nav className="hidden md:flex items-center gap-4">
            {headerNav.map((item) => (
              <LocalizedLink
                key={item.labelKey}
                href={item.href}
                className={`font-headline tracking-tight text-sm font-semibold transition-all duration-200 active:scale-95 ${
                  isActive(item.pattern)
                    ? 'text-blue-700 dark:text-blue-400 border-b-2 border-blue-600 pb-1'
                    : 'text-slate-600 dark:text-slate-400 hover:text-blue-500'
                }`}
              >
                {t(item.labelKey)}
              </LocalizedLink>
            ))}
          </nav>
        </div>

        {/* Right: Search + Controls */}
        <div className="flex items-center gap-4">
          {/* Search Bar */}
          <div className="hidden lg:flex relative group items-center">
            <Search className="absolute left-3 h-4 w-4 text-slate-400 group-focus-within:text-blue-600 transition-colors" />
            <input
              className="block w-64 pl-10 pr-4 py-1.5 bg-slate-100/50 dark:bg-slate-800/50 border-none  text-sm focus:ring-2 focus:ring-blue-600/20 focus:bg-white dark:focus:bg-slate-800 transition-all outline-none text-slate-900 dark:text-white placeholder:text-slate-400"
              placeholder={t('nav.searchTools')}
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange?.(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-4">
            {/* <span className="hidden sm:inline text-blue-700 dark:text-blue-400 font-headline tracking-tight text-sm font-semibold cursor-default">
              500 <Gem className="inline h-3.5 w-3.5 -mt-0.5" />
            </span> */}
            <LanguageToggle />
            <ThemeToggle />
            {/* <button className="flex items-center gap-2 group transition-all duration-200 hover:opacity-80 active:scale-95">
              <div className="h-8 w-8  overflow-hidden bg-slate-200 dark:bg-slate-700 border border-slate-200/50 flex items-center justify-center">
                <User className="h-4 w-4 text-slate-500 dark:text-slate-400" />
              </div>
              <span className="hidden sm:inline font-headline tracking-tight text-sm font-semibold text-slate-700 dark:text-slate-300">
                Profile
              </span>
            </button> */}
          </div>
        </div>
      </div>
    </header>
  );
}
