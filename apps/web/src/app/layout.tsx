import type { Metadata, Viewport } from 'next';
import { siteConfig } from '@/lib/seo/metadata';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: '你的 AI 营养管家 — 拍照识别食物、个性化营养分析、智能饮食推荐',
  manifest: '/manifest.json',
  icons: siteConfig.icons,
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: 'white' },
    { media: '(prefers-color-scheme: dark)', color: 'black' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
