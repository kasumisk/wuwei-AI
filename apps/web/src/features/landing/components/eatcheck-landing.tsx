'use client';

import Link from 'next/link';
import { motion, useReducedMotion, useScroll, useTransform, type Variants } from 'framer-motion';
import { EMAIL_ADDRESS } from '@/lib/constants/config';
import { EatCheckHeroLottie } from '@/features/landing/components/eatcheck-hero-lottie';

type EatCheckLandingProps = {
  homeHref: string;
  privacyHref: string;
  termsHref: string;
};

const ease = [0.22, 1, 0.36, 1] as const;

const reveal: Variants = {
  hidden: { opacity: 0, y: 28, filter: 'blur(12px)' },
  show: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.8, ease },
  },
};

const stagger: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.12, delayChildren: 0.08 },
  },
};

const systemSteps = [
  {
    eyebrow: 'Capture',
    title: 'Log what actually happened.',
    body: 'Photo, text, or manual entry keeps the habit lightweight. The goal is continuity, not perfection.',
  },
  {
    eyebrow: 'Read',
    title: 'Turn a meal into context.',
    body: 'EatCheck compares structure, portions, and daily rhythm so the feedback feels closer to a coach note than a database row.',
  },
  {
    eyebrow: 'Adjust',
    title: 'Make the next choice calmer.',
    body: 'Small suggestions help you notice what to add, rebalance, or repeat without turning food into a spreadsheet.',
  },
];

const featureLayers = [
  {
    title: 'Meal structure',
    body: 'See how protein, plants, grains, and snacks shape the day instead of reading isolated numbers.',
    metric: '82%',
    caption: 'variety signal',
  },
  {
    title: 'Daily record',
    body: 'Keep a clean timeline of meals, notes, and adjustments that stays useful after the moment passes.',
    metric: '4',
    caption: 'meals logged',
  },
  {
    title: 'Trend reports',
    body: 'Spot repeat patterns across days and weeks: skipped meals, late snacks, low fiber, or steady wins.',
    metric: '7d',
    caption: 'pattern window',
  },
];

function LogoMark() {
  return (
    <div className="relative flex w-30 items-center justify-center ">
      <img src={'/logo.png'} alt=''  />
    </div>
  );
}

function NoiseLayer() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 opacity-[0.035] mix-blend-multiply"
      style={{
        backgroundImage:
          'radial-gradient(circle at 1px 1px, rgba(3, 7, 18, 0.9) 1px, transparent 0)',
        backgroundSize: '18px 18px',
      }}
    />
  );
}

function RevealBlock({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      variants={reveal}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: '-80px' }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function MagneticLink({ href, children, variant = 'primary' }: { href: string; children: React.ReactNode; variant?: 'primary' | 'secondary' }) {
  const base =
    'group relative inline-flex items-center justify-center overflow-hidden rounded-full px-6 py-3.5 text-sm font-semibold tracking-[-0.01em] transition will-change-transform focus:outline-none focus:ring-4';
  const styles =
    variant === 'primary'
      ? 'bg-slate-950 text-white shadow-[0_22px_60px_rgba(15,23,42,0.22)] focus:ring-slate-300'
      : 'border border-slate-200 bg-white/55 text-slate-800 shadow-[0_16px_50px_rgba(15,23,42,0.08)] backdrop-blur-xl focus:ring-emerald-100';

  return (
    <motion.div whileHover={{ y: -2, scale: 1.015 }} whileTap={{ scale: 0.985 }} transition={{ duration: 0.2 }}>
      <Link href={href} className={`${base} ${styles}`}>
        <span className="absolute inset-0 translate-y-full bg-emerald-600/90 transition-transform duration-500 ease-out group-hover:translate-y-0" />
        <span className="relative z-10 flex items-center gap-2">
          {children}
          <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
        </span>
      </Link>
    </motion.div>
  );
}

function Header({ privacyHref, termsHref }: Pick<EatCheckLandingProps, 'privacyHref' | 'termsHref'>) {
  return (
    <motion.header
      className="fixed left-0 right-0 top-0 z-40 px-4 pt-4 sm:px-6"
      initial={{ y: -20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease }}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between rounded-full border border-white/70 bg-white/60 px-3 shadow-[0_18px_60px_rgba(15,23,42,0.08)] backdrop-blur-2xl sm:px-4">
        <Link href="#top" className="group flex items-center gap-3" aria-label="EatCheck home">
          <LogoMark />
        </Link>
        <nav className="hidden items-center gap-7 text-[13px] font-semibold text-slate-600 md:flex" aria-label="Primary navigation">
          <a className="transition hover:text-slate-950" href="#system">
            System
          </a>
          <a className="transition hover:text-slate-950" href="#trust">
            Trust
          </a>
          <Link className="transition hover:text-slate-950" href={privacyHref}>
            Privacy
          </Link>
          <Link className="transition hover:text-slate-950" href={termsHref}>
            Terms
          </Link>
        </nav>
        <a
          href={`mailto:${EMAIL_ADDRESS}`}
          className="rounded-full bg-slate-950 px-4 py-2 text-[13px] font-semibold text-white transition hover:-translate-y-0.5 hover:bg-emerald-700"
        >
          Contact
        </a>
      </div>
    </motion.header>
  );
}

function Hero({ homeHref }: Pick<EatCheckLandingProps, 'homeHref'>) {
  const shouldReduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const y = useTransform(scrollYProgress, [0, 0.25], shouldReduceMotion ? [0, 0] : [0, -44]);
  const opacity = useTransform(scrollYProgress, [0, 0.22], [1, 0.55]);

  return (
    <section id="top" className="relative mx-auto grid min-h-[92vh] w-full max-w-6xl items-center gap-12 px-5 pb-20 pt-32 sm:px-6 lg:grid-cols-[1.02fr_0.98fr] lg:px-8">
      <motion.div variants={stagger} initial="hidden" animate="show" style={{ y, opacity }}>
        <motion.p variants={reveal} className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">
          Nutrition awareness for everyday meals
        </motion.p>
        <motion.h1 variants={reveal} className="mt-7 max-w-4xl text-[clamp(4.4rem,12vw,10.5rem)] font-black leading-[0.78] tracking-[-0.055em] text-slate-950">
          Food, with memory.
        </motion.h1>
        <motion.p variants={reveal} className="mt-8 max-w-2xl text-[clamp(1.35rem,2.6vw,2.85rem)] font-semibold leading-[1.08] tracking-[-0.055em] text-slate-800">
          EatCheck turns scattered meals into a quiet record of what supports you.
        </motion.p>
        <motion.p variants={reveal} className="mt-6 max-w-xl text-base leading-8 text-slate-600 sm:text-lg">
          Log a meal. Read the pattern. Make the next choice with less guesswork. Built for wellness reflection, not diagnosis.
        </motion.p>
        <motion.div variants={reveal} className="mt-9 flex flex-col gap-3 sm:flex-row">
          <MagneticLink href={homeHref}>Download / Coming Soon</MagneticLink>
          <MagneticLink href="#trust" variant="secondary">Read the safety notes</MagneticLink>
        </motion.div>
      </motion.div>

      <div className="relative">
        <motion.div
          aria-hidden="true"
          className="absolute -left-10 top-8 h-56 w-56 rounded-full bg-lime-200/55 blur-3xl"
          animate={shouldReduceMotion ? undefined : { x: [0, 14, 0], y: [0, -12, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          aria-hidden="true"
          className="absolute -right-8 bottom-10 h-72 w-72 rounded-full bg-cyan-200/45 blur-3xl"
          animate={shouldReduceMotion ? undefined : { scale: [1, 1.08, 1] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.div
          initial={{ opacity: 0, y: 35, rotateX: 8, filter: 'blur(14px)' }}
          animate={{ opacity: 1, y: 0, rotateX: 0, filter: 'blur(0px)' }}
          transition={{ duration: 1, delay: 0.25, ease }}
        >
          <EatCheckHeroLottie />
        </motion.div>
      </div>
    </section>
  );
}

function InsightSection() {
  return (
    <section className="relative mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
        <RevealBlock>
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-400">The shift</p>
          <h2 className="mt-5 text-[clamp(2.6rem,7vw,6.2rem)] font-black leading-[0.86] tracking-[-0.045em] text-slate-950">
            Less counting. More noticing.
          </h2>
        </RevealBlock>
        <RevealBlock className="max-w-2xl lg:pb-4">
          <p className="text-xl font-semibold leading-8 tracking-[-0.035em] text-slate-800 sm:text-2xl sm:leading-10">
            Most food apps ask you to manage a ledger. EatCheck is designed around a softer behavior: noticing what keeps repeating.
          </p>
          <p className="mt-6 text-base leading-8 text-slate-600">
            A high-calorie lunch is not a story. A week of late lunches, low fiber, and strong dinners is. EatCheck helps surface that context in language you can act on.
          </p>
        </RevealBlock>
      </div>
      <RevealBlock className="mt-14 overflow-hidden rounded-[2.25rem] border border-white/70 bg-white/50 p-3 shadow-[0_35px_110px_rgba(15,23,42,0.09)] backdrop-blur-2xl">
        <div className="grid gap-3 rounded-[1.8rem] bg-slate-950 p-4 text-white md:grid-cols-[1.15fr_0.85fr] md:p-6">
          <div className="rounded-[1.4rem] bg-white/[0.06] p-6 ring-1 ring-white/10">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-200">Today became clearer</p>
            <div className="mt-8 space-y-5">
              {['Breakfast was light', 'Lunch carried the day', 'Dinner can stay simple'].map((item, index) => (
                <motion.div
                  key={item}
                  className="flex items-center justify-between border-b border-white/10 pb-5 last:border-none last:pb-0"
                  initial={{ opacity: 0, x: -16 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.12 }}
                >
                  <span className="text-lg font-semibold tracking-[-0.03em]">{item}</span>
                  <span className="h-2 w-2 rounded-full bg-emerald-300" />
                </motion.div>
              ))}
            </div>
          </div>
          <div className="rounded-[1.4rem] bg-[#eaffd8] p-6 text-slate-950">
            <p className="text-sm font-semibold text-emerald-800">Plain-language insight</p>
            <p className="mt-6 text-3xl font-black leading-[1.02] tracking-[-0.06em]">
              Keep dinner boring tonight. Your earlier meals already did the heavy lifting.
            </p>
          </div>
        </div>
      </RevealBlock>
    </section>
  );
}

function SystemSection() {
  return (
    <section id="system" className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <RevealBlock className="max-w-3xl">
        <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">The system</p>
        <h2 className="mt-5 text-[clamp(2.7rem,7vw,6.8rem)] font-black leading-[0.86] tracking-[-0.045em] text-slate-950">
          Three moments, one habit loop.
        </h2>
      </RevealBlock>
      <div className="mt-14 grid gap-10 lg:grid-cols-[0.55fr_1.45fr]">
        <RevealBlock className="hidden lg:block">
          <div className="sticky top-28 rounded-[2rem] border border-white/70 bg-white/55 p-6 shadow-[0_25px_90px_rgba(15,23,42,0.08)] backdrop-blur-2xl">
            <p className="text-sm font-semibold text-slate-500">Typical flow</p>
            <div className="mt-6 space-y-3">
              {['Meal logged', 'Context generated', 'Next choice adjusted'].map((item) => (
                <div key={item} className="rounded-2xl bg-slate-950 px-4 py-3 text-sm font-semibold text-white">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </RevealBlock>
        <div className="relative space-y-5">
          <div className="absolute left-5 top-6 hidden h-[calc(100%-3rem)] w-px bg-gradient-to-b from-emerald-300 via-slate-200 to-transparent sm:block" />
          {systemSteps.map((step, index) => (
            <RevealBlock key={step.title}>
              <motion.article
                className="relative rounded-[2rem] border border-white/70 bg-white/60 p-6 shadow-[0_22px_70px_rgba(15,23,42,0.07)] backdrop-blur-xl transition hover:bg-white/75 sm:ml-12 sm:p-8"
                whileHover={{ y: -4 }}
                transition={{ duration: 0.25 }}
              >
                <span className="absolute -left-[3.25rem] top-8 hidden h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-sm font-black text-white shadow-[0_14px_35px_rgba(4,120,87,0.28)] sm:flex">
                  {index + 1}
                </span>
                <p className="text-sm font-semibold uppercase tracking-[0.22em] text-emerald-700">{step.eyebrow}</p>
                <h3 className="mt-4 text-3xl font-black tracking-[-0.055em] text-slate-950">{step.title}</h3>
                <p className="mt-4 max-w-2xl text-base leading-8 text-slate-600">{step.body}</p>
              </motion.article>
            </RevealBlock>
          ))}
        </div>
      </div>
    </section>
  );
}

function DeepFeatures() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:items-start">
        <RevealBlock className="lg:sticky lg:top-28">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-slate-400">Product depth</p>
          <h2 className="mt-5 text-[clamp(2.7rem,7vw,6.4rem)] font-black leading-[0.86] tracking-[-0.045em] text-slate-950">
            A record that gets more useful after day one.
          </h2>
          <p className="mt-7 max-w-md text-base leading-8 text-slate-600">
            The product is intentionally quiet: fewer dashboards, stronger signals, and a timeline that rewards consistency.
          </p>
        </RevealBlock>
        <motion.div variants={stagger} initial="hidden" whileInView="show" viewport={{ once: true, margin: '-80px' }} className="space-y-4">
          {featureLayers.map((feature, index) => (
            <motion.article
              key={feature.title}
              variants={reveal}
              whileHover={{ x: -4, scale: 1.01 }}
              className="group overflow-hidden rounded-[2rem] border border-white/70 bg-white/60 p-6 shadow-[0_22px_80px_rgba(15,23,42,0.07)] backdrop-blur-2xl sm:p-7"
            >
              <div className="flex items-start justify-between gap-8">
                <div>
                  <p className="text-sm font-semibold text-slate-400">0{index + 1}</p>
                  <h3 className="mt-4 text-3xl font-black tracking-[-0.055em] text-slate-950">{feature.title}</h3>
                </div>
                <div className="text-right">
                  <p className="text-4xl font-black tracking-[-0.03em] text-emerald-700">{feature.metric}</p>
                  <p className="mt-1 text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">{feature.caption}</p>
                </div>
              </div>
              <p className="mt-6 max-w-xl text-base leading-8 text-slate-600">{feature.body}</p>
              <div className="mt-7 h-px w-full bg-gradient-to-r from-emerald-300/80 via-slate-200 to-transparent" />
            </motion.article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function TrustSection({ privacyHref, termsHref }: Pick<EatCheckLandingProps, 'privacyHref' | 'termsHref'>) {
  return (
    <section id="trust" className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <RevealBlock>
        <div className="overflow-hidden rounded-[2.4rem] bg-slate-950 p-6 text-white shadow-[0_45px_140px_rgba(15,23,42,0.24)] sm:p-8 lg:p-10">
          <div className="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-200">Trust layer</p>
              <h2 className="mt-6 max-w-3xl text-[clamp(2.5rem,6vw,5.8rem)] font-black leading-[0.88] tracking-[-0.03em]">
                Health software should know its limits.
              </h2>
              <p className="mt-7 max-w-2xl text-base leading-8 text-slate-300">
                EatCheck is for general wellness reference. It does not provide medical advice, diagnosis, treatment, cure, or prevention of any disease. For medical or dietary decisions, consult a qualified healthcare professional.
              </p>
            </div>
            <div className="grid content-end gap-3">
              {[
                'Not medical advice',
                'No sale of personal data',
                'Account and data deletion requests supported',
                'Auto-renewable subscriptions managed through App Store settings',
              ].map((item) => (
                <motion.div
                  key={item}
                  className="rounded-2xl bg-white/[0.07] p-4 text-sm font-semibold text-slate-100 ring-1 ring-white/10"
                  whileHover={{ x: 3, backgroundColor: 'rgba(255,255,255,0.1)' }}
                >
                  {item}
                </motion.div>
              ))}
              <div className="mt-4 flex flex-wrap gap-3 text-sm font-semibold">
                <Link className="rounded-full bg-white px-4 py-2.5 text-slate-950 transition hover:bg-emerald-100" href={privacyHref}>
                  Privacy Policy
                </Link>
                <Link className="rounded-full border border-white/20 px-4 py-2.5 text-white transition hover:bg-white/10" href={termsHref}>
                  Terms of Use
                </Link>
              </div>
            </div>
          </div>
        </div>
      </RevealBlock>
    </section>
  );
}

function SubscriptionValue() {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
        <RevealBlock>
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">Premium value</p>
          <h2 className="mt-5 text-[clamp(2.6rem,6vw,5.7rem)] font-black leading-[0.88] tracking-[-0.03em] text-slate-950">
            More history. Better context.
          </h2>
        </RevealBlock>
        <RevealBlock>
          <div className="rounded-[2.2rem] border border-white/70 bg-white/60 p-6 shadow-[0_25px_90px_rgba(15,23,42,0.08)] backdrop-blur-2xl sm:p-8">
            <p className="text-xl font-semibold leading-9 tracking-[-0.035em] text-slate-800">
              Premium analysis, if available, is framed around continuity: longer trend windows, deeper reports, and higher analysis limits.
            </p>
            <p className="mt-5 text-base leading-8 text-slate-600">
              It may be offered as an auto-renewable subscription through the App Store. Subscriptions renew automatically unless canceled in App Store account settings at least 24 hours before the current period ends.
            </p>
          </div>
        </RevealBlock>
      </div>
    </section>
  );
}

function FinalCta({ homeHref }: Pick<EatCheckLandingProps, 'homeHref'>) {
  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-20 sm:px-6 lg:px-8 lg:py-28">
      <RevealBlock>
        <div className="relative overflow-hidden rounded-[2.6rem] border border-emerald-100 bg-[#effbea] p-8 shadow-[0_35px_110px_rgba(15,23,42,0.09)] sm:p-10 lg:p-14">
          <motion.div
            aria-hidden="true"
            className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-200/80 blur-3xl"
            animate={{ scale: [1, 1.12, 1] }}
            transition={{ duration: 7, repeat: Infinity, ease: 'easeInOut' }}
          />
          <div className="relative max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.28em] text-emerald-700">EatCheck</p>
            <h2 className="mt-5 text-[clamp(2.8rem,7vw,7rem)] font-black leading-[0.84] tracking-[-0.045em] text-slate-950">
              Build a calmer relationship with the next meal.
            </h2>
            <p className="mt-7 max-w-xl text-base leading-8 text-slate-600">
              Start with one meal. Keep the record honest. Let the pattern become easier to see.
            </p>
            <div className="mt-9">
              <MagneticLink href={homeHref}>Download / Coming Soon</MagneticLink>
            </div>
          </div>
        </div>
      </RevealBlock>
    </section>
  );
}

function Footer({ privacyHref, termsHref }: Pick<EatCheckLandingProps, 'privacyHref' | 'termsHref'>) {
  return (
    <footer className="relative z-10 mx-auto flex w-full max-w-6xl flex-col gap-5 border-t border-slate-200/80 px-5 py-8 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <div>
          <LogoMark />
          <p>© 2026. General wellness only.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-5 font-semibold">
        <Link className="transition hover:text-slate-950" href={privacyHref}>
          Privacy
        </Link>
        <Link className="transition hover:text-slate-950" href={termsHref}>
          Terms
        </Link>
        <a className="transition hover:text-slate-950" href={`mailto:${EMAIL_ADDRESS}`}>
          Contact
        </a>
      </div>
    </footer>
  );
}

export function EatCheckLanding({ homeHref, privacyHref, termsHref }: EatCheckLandingProps) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7fbf3] text-slate-950 selection:bg-emerald-200/80 selection:text-slate-950">
      <NoiseLayer />
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_at_18%_8%,rgba(187,247,208,0.72),transparent_34%),radial-gradient(circle_at_82%_15%,rgba(207,250,254,0.58),transparent_30%),linear-gradient(180deg,#f7fbf3_0%,#ffffff_48%,#f4fbef_100%)]" />
      <div className="relative z-10">
        <Header privacyHref={privacyHref} termsHref={termsHref} />
        <Hero homeHref={homeHref} />
        <InsightSection />
        <SystemSection />
        <DeepFeatures />
        <TrustSection privacyHref={privacyHref} termsHref={termsHref} />
        <SubscriptionValue />
        <FinalCta homeHref={homeHref} />
        <Footer privacyHref={privacyHref} termsHref={termsHref} />
      </div>
    </main>
  );
}
