import { useThemeStore } from '@/store';
import { locales } from '@/locales';

export const useI18n = () => {
  const { locale } = useThemeStore();
  
  const t = (key: string, defaultValue?: string): string => {
    const currentLocale = locale as keyof typeof locales;
    const messages = locales[currentLocale] || locales['zh-CN'];
    return (messages as Record<string, string>)[key] || defaultValue || key;
  };

  return { t, locale };
};