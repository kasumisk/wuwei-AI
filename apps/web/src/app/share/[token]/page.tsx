import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { JsonLd } from '@/lib/seo/JsonLd';
import { siteConfig } from '@/lib/seo/metadata';
import { getPublicShare, trackShareView } from '@/lib/share/api';
import type { PublicShareResponse, ShareMetric, ShareSnapshot } from '@/lib/share/types';

type PageProps = {
  params: Promise<{ token: string }>;
};

const APP_STORE_URL = 'https://apps.apple.com/us/app/eatcheck/id6763199295';

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { token } = await params;
  const share = await getPublicShare(token);
  if (!share) {
    return {
      title: 'Shared meal insight | EatCheck',
      robots: { index: false, follow: false },
    };
  }

  const url = `${siteConfig.url}/share/${token}`;
  const ogImage = `${siteConfig.url}/api/og/share/${token}`;
  const indexable = share.visibility === 'public_indexed' && share.snapshot.seo.indexable;

  return {
    title: share.snapshot.seo.title,
    description: share.snapshot.seo.description,
    robots: { index: indexable, follow: true },
    alternates: { canonical: url },
    openGraph: {
      type: 'article',
      url,
      title: share.snapshot.seo.title,
      description: share.snapshot.seo.description,
      siteName: 'EatCheck',
      images: [{ url: ogImage, width: 1200, height: 630, alt: share.snapshot.hook }],
    },
    twitter: {
      card: 'summary_large_image',
      title: share.snapshot.seo.title,
      description: share.snapshot.seo.description,
      images: [ogImage],
    },
  };
}

export default async function SharePage({ params }: PageProps) {
  const { token } = await params;
  const share = await getPublicShare(token);
  if (!share) notFound();

  trackShareView(token).catch(() => {});

  const snapshot = share.snapshot;
  const score = Math.max(0, Math.min(100, Math.round(snapshot.score ?? 0)));
  const appStoreUrl = `/api/share/${token}/cta`;
  const googlePlayUrl = snapshot.cta.googlePlayUrl || APP_STORE_URL;

  return (
    <>
        <JsonLd data={buildShareSchema(share)} />
        <main className="relative min-h-screen overflow-hidden">
          <div className="absolute left-1/2 top-[-18rem] h-[42rem] w-[42rem] -translate-x-1/2 rounded-full bg-emerald-400/18 blur-3xl" />
          <div className="absolute right-[-12rem] top-24 h-[34rem] w-[34rem] rounded-full bg-lime-300/12 blur-3xl" />
          <div className="absolute bottom-[-18rem] left-[-12rem] h-[40rem] w-[40rem] rounded-full bg-cyan-300/10 blur-3xl" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_34%),linear-gradient(180deg,rgba(255,255,255,0.06),transparent_24%)]" />

          <section className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 py-6 sm:px-8 lg:px-10">
            <header className="flex items-center justify-between">
              <a href="/" className="flex items-center gap-3" aria-label="EatCheck home">
                <span className="grid h-10 w-10 place-items-center rounded-2xl border border-white/12 bg-white/10 text-sm font-black shadow-2xl backdrop-blur-xl">
                  EC
                </span>
                <span>
                  <span className="block text-sm font-bold tracking-[-0.03em]">EatCheck</span>
                  <span className="block text-[10px] uppercase tracking-[0.24em] text-emerald-100/50">
                    AI Health
                  </span>
                </span>
              </a>
              <a
                href={appStoreUrl}
                className="rounded-full border border-white/14 bg-white/10 px-4 py-2 text-sm font-semibold text-emerald-50 shadow-[0_16px_60px_rgba(0,0,0,0.24)] backdrop-blur-xl transition hover:bg-white/16"
              >
                Scan yours
              </a>
            </header>

            <div className="grid flex-1 items-center gap-8 py-14 lg:grid-cols-[1.08fr_0.92fr] lg:py-20">
              <Hero snapshot={snapshot} score={score} />
              <ShareCard snapshot={snapshot} score={score} />
            </div>

            <section className="grid gap-4 pb-8 md:grid-cols-3">
              <InsightPanel title="Nutrition Signals" items={snapshot.highlights} tone="good" />
              <InsightPanel title="Watch Outs" items={snapshot.risks} tone="warning" />
              <CtaPanel appStoreUrl={appStoreUrl} googlePlayUrl={googlePlayUrl} />
            </section>
          </section>
        </main>
    </>
  );
}

function Hero({ snapshot, score }: { snapshot: ShareSnapshot; score: number }) {
  return (
    <div className="max-w-2xl">
      <div className="mb-5 inline-flex rounded-full border border-emerald-200/12 bg-emerald-200/8 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100/72 backdrop-blur-xl">
        AI analyzed this meal
      </div>
      <h1 className="text-balance text-5xl font-black leading-[0.9] tracking-[-0.075em] text-white sm:text-7xl lg:text-8xl">
        {snapshot.hook}
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-8 text-emerald-50/68 sm:text-xl">
        {snapshot.summary}
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Pill label="Meal score" value={`${score}/100`} />
        {snapshot.betterChoice ? <Pill label="Better choice" value={snapshot.betterChoice} /> : null}
        {snapshot.decision ? <Pill label="AI call" value={snapshot.decision} /> : null}
      </div>
    </div>
  );
}

function ShareCard({ snapshot, score }: { snapshot: ShareSnapshot; score: number }) {
  return (
    <div className="relative mx-auto w-full max-w-[28rem]">
      <div className="absolute -inset-1 rounded-[2.6rem] bg-gradient-to-br from-white/24 via-emerald-300/24 to-transparent blur-2xl" />
      <div className="relative overflow-hidden rounded-[2.4rem] border border-white/14 bg-white/[0.075] p-5 shadow-[0_40px_140px_rgba(0,0,0,0.55)] backdrop-blur-2xl">
        <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-white/16 to-transparent" />
        <div className="relative rounded-[2rem] border border-white/12 bg-[#08110d]/78 p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-100/48">
                {snapshot.subtitle ?? 'AI result'}
              </p>
              <h2 className="mt-2 text-2xl font-black tracking-[-0.05em] text-white">
                {snapshot.title}
              </h2>
            </div>
            <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full bg-[conic-gradient(from_180deg,#9dff93_0deg,#eaffd0_120deg,#24593b_260deg,#9dff93_360deg)] p-1 shadow-[0_20px_80px_rgba(145,247,142,0.22)]">
              <div className="grid h-full w-full place-items-center rounded-full bg-[#07100c]">
                <span className="text-3xl font-black tracking-[-0.08em]">{score}</span>
              </div>
            </div>
          </div>

          <div className="mt-7 grid grid-cols-2 gap-3">
            {snapshot.metrics.map((metric) => (
              <MetricTile key={metric.label} metric={metric} />
            ))}
          </div>

          {snapshot.foods.length > 0 ? (
            <div className="mt-7 rounded-[1.45rem] border border-white/10 bg-white/[0.055] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-100/44">
                Detected foods
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {snapshot.foods.slice(0, 4).map((food) => (
                  <span
                    key={food.name}
                    className="rounded-full bg-white/10 px-3 py-1.5 text-sm font-semibold text-white/84"
                  >
                    {food.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-7 flex items-center justify-between border-t border-white/10 pt-5 text-xs text-emerald-100/44">
            <span>Not medical advice</span>
            <span className="font-bold text-emerald-100/70">EatCheck</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetricTile({ metric }: { metric: ShareMetric }) {
  const toneClass =
    metric.tone === 'good'
      ? 'text-emerald-200'
      : metric.tone === 'warning'
        ? 'text-amber-200'
        : metric.tone === 'danger'
          ? 'text-rose-200'
          : 'text-white';

  return (
    <div className="rounded-[1.25rem] border border-white/10 bg-white/[0.06] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-100/40">
        {metric.label}
      </p>
      <p className={`mt-2 text-2xl font-black tracking-[-0.06em] ${toneClass}`}>
        {metric.value}
        {metric.unit ? <span className="ml-1 text-sm font-bold tracking-[-0.02em] opacity-62">{metric.unit}</span> : null}
      </p>
    </div>
  );
}

function Pill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-full border border-white/12 bg-white/8 px-4 py-2 backdrop-blur-xl">
      <span className="text-xs uppercase tracking-[0.16em] text-emerald-100/42">{label}</span>
      <span className="ml-2 text-sm font-bold text-white/86">{value}</span>
    </div>
  );
}

function InsightPanel({ title, items, tone }: { title: string; items: string[]; tone: 'good' | 'warning' }) {
  return (
    <div className="rounded-[1.8rem] border border-white/10 bg-white/[0.065] p-5 backdrop-blur-xl">
      <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white/70">{title}</h2>
      <ul className="mt-4 space-y-3">
        {(items.length ? items : ['No major flags found']).map((item) => (
          <li key={item} className="flex gap-3 text-sm leading-6 text-emerald-50/68">
            <span className={`mt-2 h-1.5 w-1.5 rounded-full ${tone === 'good' ? 'bg-emerald-300' : 'bg-amber-300'}`} />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CtaPanel({ appStoreUrl, googlePlayUrl }: { appStoreUrl: string; googlePlayUrl: string }) {
  return (
    <div className="rounded-[1.8rem] border border-emerald-200/14 bg-emerald-200/[0.085] p-5 backdrop-blur-xl">
      <h2 className="text-sm font-black uppercase tracking-[0.18em] text-white/70">Try it</h2>
      <p className="mt-4 text-sm leading-6 text-emerald-50/68">
        Scan your own meal and get an AI decision before you eat.
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row md:flex-col">
        <a href={appStoreUrl} className="rounded-full bg-white px-5 py-3 text-center text-sm font-black text-[#07100c] transition hover:bg-emerald-100">
          App Store
        </a>
        <a href={googlePlayUrl} className="rounded-full border border-white/16 px-5 py-3 text-center text-sm font-bold text-white transition hover:bg-white/10">
          Google Play
        </a>
      </div>
    </div>
  );
}

function buildShareSchema(share: PublicShareResponse) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: share.snapshot.seo.title,
    description: share.snapshot.seo.description,
    datePublished: share.createdAt,
    publisher: {
      '@type': 'Organization',
      name: 'EatCheck',
      url: siteConfig.url,
    },
    mainEntityOfPage: `${siteConfig.url}/share/${share.token}`,
  };
}
