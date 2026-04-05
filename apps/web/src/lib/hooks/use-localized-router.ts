import { useLocale } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { i18n } from '@/lib/i18n/config';

/**
 * 多语言路由跳转 Hook
 * 自动处理语言前缀，确保跳转到正确的语言版本
 */
export function useLocalizedRouter() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  /**
   * 跳转到指定路径（自动添加当前语言前缀）
   * @param path - 目标路径（不带语言前缀）
   * @example push('/about') -> 英文: /about, 中文: /zh/about
   */
  const push = (path: string) => {
    const localizedPath = getLocalizedPath(path, locale);
    router.push(localizedPath);
  };

  /**
   * 替换当前路径（自动添加当前语言前缀）
   */
  const replace = (path: string) => {
    const localizedPath = getLocalizedPath(path, locale);
    router.replace(localizedPath);
  };

  /**
   * 跳转到指定语言的相同路径
   * @param newLocale - 目标语言
   */
  const switchLocale = (newLocale: string) => {
    const pathWithoutLocale = removeLocalePrefix(pathname);
    const newPath = getLocalizedPath(pathWithoutLocale, newLocale);
    router.push(newPath);
  };

  /**
   * 获取当前路径（不带语言前缀）
   */
  const getCurrentPath = () => {
    return removeLocalePrefix(pathname);
  };

  return {
    push,
    replace,
    switchLocale,
    getCurrentPath,
    locale,
    router,
  };
}

/**
 * 根据语言获取本地化路径
 */
export function getLocalizedPath(path: string, locale: string): string {
  // 确保路径以 / 开头
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  
  // 如果是默认语言（英文），不添加前缀
  if (locale === i18n.defaultLocale) {
    return normalizedPath;
  }
  
  // 其他语言添加语言前缀
  return `/${locale}${normalizedPath}`;
}

/**
 * 移除路径中的语言前缀
 */
export function removeLocalePrefix(pathname: string): string {
  // 移除当前语言前缀
  for (const locale of i18n.locales) {
    if (pathname.startsWith(`/${locale}/`)) {
      return pathname.replace(`/${locale}`, '');
    }
    if (pathname === `/${locale}`) {
      return '/';
    }
  }
  return pathname;
}

/**
 * 获取所有语言版本的路径
 */
export function getAllLocalizedPaths(path: string): Record<string, string> {
  const paths: Record<string, string> = {};
  
  for (const locale of i18n.locales) {
    paths[locale] = getLocalizedPath(path, locale);
  }
  
  return paths;
}
