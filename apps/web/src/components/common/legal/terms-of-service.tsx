'use client';

import { EMAIL_ADDRESS } from "@/lib/constants/config";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="mb-4 text-lg font-bold text-slate-900 dark:text-white font-headline">
        {title}
      </h2>
      <div className="space-y-3 text-slate-600 dark:text-slate-400 leading-7">{children}</div>
    </section>
  );
}

function Ul({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item) => (
        <li key={item} className="flex items-start gap-2">
          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[#f7fbf6] text-slate-900 dark:bg-slate-950 dark:text-white">
      <main>
        <div className="mx-auto max-w-3xl px-4 py-12">
          <div className="mb-8">
            <h1 className="mb-2 text-3xl font-extrabold text-slate-900 dark:text-white font-headline">
              Terms of Use
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Effective Date: April 28, 2026</p>
          </div>

          <p className="mb-10 text-slate-600 dark:text-slate-400 leading-7">
            By accessing or using <strong className="text-slate-800 dark:text-slate-200">EatCheck</strong>,
            you agree to these Terms of Use. If you do not agree, do not use the app.
          </p>

          <Section title="1. Description of Service">
            <p>
              EatCheck provides AI-powered meal analysis, nutrition insights, daily tracking, and
              trend reports for general wellness and informational purposes.
            </p>
          </Section>

          <Section title="2. Eligibility">
            <p>
              You must be at least 13 years old to use EatCheck. If you are under the age of majority
              in your region, you should use EatCheck only with permission from a parent or guardian.
            </p>
          </Section>

          <Section title="3. Accounts and User Responsibilities">
            <Ul
              items={[
                'You are responsible for maintaining access to and security of your account.',
                'You agree to provide accurate information when using meal tracking or nutrition features.',
                'You should not use EatCheck for unlawful, harmful, abusive, or unauthorized purposes.',
                'You should not attempt to interfere with, reverse engineer, or gain unauthorized access to the service.',
              ]}
            />
          </Section>

          <Section title="4. No Medical Advice">
            <p>
              EatCheck does <strong className="text-slate-800 dark:text-slate-200">not provide medical advice</strong>.
              AI-generated nutrition insights are for general wellness reference only and are not a
              diagnosis, treatment, cure, or prevention of any disease or health condition. Always
              consult a qualified physician, registered dietitian, or licensed healthcare professional
              before making health, nutrition, or medical decisions.
            </p>
          </Section>

          <Section title="5. AI-Generated Information">
            <p>
              EatCheck uses AI to generate nutrition-related information based on available inputs.
              AI outputs may be incomplete, inaccurate, or not suitable for your personal situation.
              You are responsible for reviewing information carefully and using your own judgment.
            </p>
          </Section>

          <Section title="6. Auto-Renewable Subscriptions">
            <p>
              EatCheck may offer optional auto-renewable subscriptions that unlock premium analysis,
              extended reports, advanced trend insights, or increased usage limits.
            </p>
            <Ul
              items={[
                'Payment is charged to your App Store account when you confirm purchase.',
                'Subscriptions automatically renew unless canceled at least 24 hours before the end of the current billing period.',
                'Your account may be charged for renewal within 24 hours before the end of the current billing period.',
                'You can manage or cancel subscriptions in your App Store account settings.',
                'Any free trial, if offered, may be forfeited when you purchase a subscription where permitted by Apple policies.',
              ]}
            />
          </Section>

          <Section title="7. Intellectual Property">
            <p>
              EatCheck, including its software, design, text, graphics, trademarks, and other content,
              is owned by us or our licensors. You may not copy, modify, distribute, sell, or lease
              any part of the service unless permitted by law or by written permission.
            </p>
          </Section>

          <Section title="8. Limitation of Liability">
            <p>
              EatCheck is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo; without warranties
              of any kind to the fullest extent permitted by law. We are not responsible for:
            </p>
            <Ul
              items={[
                'Health outcomes or decisions made based on app content or AI-generated information',
                'Errors, omissions, interruptions, delays, or data loss',
                'Third-party services, platforms, or payment systems',
              ]}
            />
          </Section>

          <Section title="9. Termination">
            <p>
              We may suspend or terminate access to EatCheck if you violate these Terms, misuse the
              service, or create risk for other users, us, or third parties.
            </p>
          </Section>

          <Section title="10. Changes to Terms">
            <p>
              We may update these Terms from time to time. Continued use of EatCheck after updates
              means you accept the revised Terms.
            </p>
          </Section>

          <Section title="11. Contact">
            <p>
              For questions about these Terms, contact us at{' '}
              <a className="font-medium text-emerald-700 hover:underline dark:text-emerald-400" href="mailto:{EMAIL_ADDRESS}">
                {EMAIL_ADDRESS}
              </a>
              .
            </p>
          </Section>
        </div>
      </main>
    </div>
  );
}
