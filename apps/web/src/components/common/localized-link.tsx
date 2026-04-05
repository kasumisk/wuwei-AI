'use client';

import { useLocalizedRouter, getLocalizedPath } from '@/lib/hooks/use-localized-router';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface LocalizedLinkProps {
  href: string;
  children: React.ReactNode;
  className?: string;
  variant?: 'default' | 'ghost' | 'outline' | 'secondary' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
  asButton?: boolean;
}

/**
 * 支持多语言的 Link 组件
 * 自动添加当前语言前缀
 */
export function LocalizedLink({
  href,
  children,
  className,
  variant,
  size,
  asButton = false,
}: LocalizedLinkProps) {
  const { locale } = useLocalizedRouter();
  
  // 使用 getLocalizedPath 来构建本地化路径
  const localizedHref = getLocalizedPath(href, locale);

  if (asButton) {
    return (
      <Button variant={variant} size={size} className={className} asChild>
        <Link href={localizedHref}>{children}</Link>
      </Button>
    );
  }

  return (
    <Link href={localizedHref} className={className}>
      {children}
    </Link>
  );
}
