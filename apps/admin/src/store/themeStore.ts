import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { theme } from 'antd';
import type { ThemeConfig } from 'antd';

export type ThemeMode = 'light' | 'dark' | 'auto';

interface ThemeState {
  mode: ThemeMode;
  primaryColor: string;
  collapsed: boolean;
  locale: string;
  
  // Actions
  setMode: (mode: ThemeMode) => void;
  setPrimaryColor: (color: string) => void;
  setCollapsed: (collapsed: boolean) => void;
  setLocale: (locale: string) => void;
  toggleCollapsed: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'light',
      primaryColor: '#1677ff',
      collapsed: false,
      locale: 'zh-CN',

      setMode: (mode) => set({ mode }),
      setPrimaryColor: (primaryColor) => set({ primaryColor }),
      setCollapsed: (collapsed) => set({ collapsed }),
      setLocale: (locale) => set({ locale }),
      toggleCollapsed: () => {
        const { collapsed } = get();
        set({ collapsed: !collapsed });
      },
    }),
    {
      name: 'theme-storage',
    }
  )
);

// 获取 Ant Design 主题配置
export const getAntdTheme = (themeState: Pick<ThemeState, 'mode' | 'primaryColor'>): ThemeConfig => {
  const { mode, primaryColor } = themeState;
  
  return {
    token: {
      colorPrimary: primaryColor,
    },
    algorithm: mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
  };
};