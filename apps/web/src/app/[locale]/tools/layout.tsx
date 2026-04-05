import { SiteHeader } from '@/components/common/site-header';

export default function ToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#f7f9fb] dark:bg-slate-950 text-slate-900 dark:text-white">
      <SiteHeader />
      <main className="pt-16">{children}</main>
    </div>
  );
}
