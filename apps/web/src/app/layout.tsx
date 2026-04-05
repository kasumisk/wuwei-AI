import type { Metadata, Viewport } from "next";
import { siteConfig } from '@/lib/seo/metadata';
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(siteConfig.url),
  title: {
    default: siteConfig.name,
    template: `%s | ${siteConfig.name}`,
  },
  description: 'Free online tools — image converter, video compressor, PDF tools, QR code generator and more.',
  manifest: "/manifest.json",
  icons: siteConfig.icons,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "white" },
    { media: "(prefers-color-scheme: dark)", color: "black" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
