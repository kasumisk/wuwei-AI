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

export function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#f7fbf6] text-slate-900 dark:bg-slate-950 dark:text-white">
      <main>
        <div className="mx-auto max-w-3xl px-4 py-12">
          <div className="mb-8">
            <h1 className="mb-2 text-3xl font-extrabold text-slate-900 dark:text-white font-headline">
              Privacy Policy
            </h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Effective Date: April 28, 2026</p>
          </div>

          <p className="mb-10 text-slate-600 dark:text-slate-400 leading-7">
            <strong className="text-slate-800 dark:text-slate-200">EatCheck</strong> (&ldquo;we&rdquo;,
            &ldquo;our&rdquo;, or &ldquo;us&rdquo;) respects your privacy. This Privacy Policy explains
            what information we collect, how we use it, when it may be shared, and how you can
            contact us about your data.
          </p>

          <Section title="1. Information We Collect">
            <p className="font-medium text-slate-700 dark:text-slate-300">1.1 Account Information</p>
            <Ul items={['Email address', 'Sign-in identifiers from Apple, Google, or other supported authentication providers']} />
            <p className="mt-3 font-medium text-slate-700 dark:text-slate-300">1.2 Nutrition and Meal Data</p>
            <Ul items={['Food intake and meal logs', 'Meal photos or text descriptions you choose to submit', 'Nutrition inputs, dietary preferences, goals, and feedback']} />
            <p className="mt-3 font-medium text-slate-700 dark:text-slate-300">1.3 Usage and Device Data</p>
            <Ul items={['App interactions and feature usage', 'Device type, operating system, app version, and approximate region', 'Crash logs, diagnostics, and performance data']} />
          </Section>

          <Section title="2. How We Use Information">
            <Ul
              items={[
                'Provide AI-powered nutrition insights and meal analysis',
                'Personalize your app experience based on the information you provide',
                'Authenticate users, manage accounts, and provide customer support',
                'Maintain security, prevent misuse, fix bugs, and improve app reliability',
                'Analyze aggregated or de-identified usage trends to improve EatCheck',
              ]}
            />
          </Section>

          <Section title="3. Data Sharing">
            <p>
              We do <strong className="text-slate-800 dark:text-slate-200">not sell</strong> your
              personal data and do not share it for third-party advertising.
            </p>
            <p>We may share limited data only in the following cases:</p>
            <Ul
              items={[
                'With service providers that help operate the app, such as authentication, hosting, analytics, crash reporting, and AI processing providers',
                'When required by law, regulation, legal process, or to protect rights, safety, and security',
                'With your consent or at your direction',
              ]}
            />
          </Section>

          <Section title="4. Data Retention and Deletion">
            <p>
              We retain personal data only for as long as needed to provide EatCheck, comply with
              legal obligations, resolve disputes, and maintain security. You may request deletion
              of your account and associated personal data by contacting us at{' '}
              <a className="font-medium text-emerald-700 hover:underline dark:text-emerald-400" href={`mailto:${EMAIL_ADDRESS}`}>
                {EMAIL_ADDRESS}
              </a>
              .
            </p>
          </Section>

          <Section title="5. Your Rights">
            <p>Depending on your location, you may have rights to:</p>
            <Ul
              items={[
                'Access the personal data we hold about you',
                'Request correction of inaccurate information',
                'Request deletion of your personal data',
                'Withdraw consent where processing is based on consent',
                'Ask questions or object to certain processing activities',
              ]}
            />
            <p>
              To exercise these rights, contact{' '}
              <a className="font-medium text-emerald-700 hover:underline dark:text-emerald-400" href="mailto:{EMAIL_ADDRESS}">
                {EMAIL_ADDRESS}
              </a>
              .
            </p>
          </Section>

          <Section title="6. Data Security">
            <p>
              We use reasonable technical and organizational safeguards designed to protect your
              information. However, no internet or electronic storage system is completely secure,
              and we cannot guarantee absolute security.
            </p>
          </Section>

          <Section title="7. Children's Privacy">
            <p>
              EatCheck is not intended for children under 13. We do not knowingly collect personal
              data from children under 13. If you believe a child has provided personal data, please
              contact us so we can take appropriate action.
            </p>
          </Section>

          <Section title="8. Third-Party Services">
            <p>
              EatCheck may use third-party services for authentication, infrastructure, analytics,
              diagnostics, payment processing, and AI processing. These providers may process data
              according to their own privacy policies and our instructions where applicable.
            </p>
          </Section>

          <Section title="9. International Processing">
            <p>
              Your information may be processed in countries or regions other than where you live.
              Where required, we use appropriate safeguards for such processing.
            </p>
          </Section>

          <Section title="10. Health and AI Disclaimer">
            <p>
              EatCheck provides AI-generated nutrition information for general wellness reference
              only. It does <strong className="text-slate-800 dark:text-slate-200">not provide medical advice</strong>,
              diagnosis, treatment, cure, or prevention of any disease. Consult a qualified
              healthcare professional before making health, nutrition, or medical decisions.
            </p>
          </Section>

          <Section title="11. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. We will update the effective date
              above when changes are made.
            </p>
          </Section>

          <Section title="12. Contact Us">
            <p>
              If you have questions about this Privacy Policy or your data, contact us at{' '}
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
