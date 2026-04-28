'use client';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white font-headline mb-4">
        {title}
      </h2>
      <div className="text-slate-600 dark:text-slate-400 leading-7 space-y-3">{children}</div>
    </section>
  );
}

function Ul({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="mt-2 w-1.5 h-1.5 bg-purple-400 dark:bg-purple-500 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[#f7f9fb] dark:bg-slate-950 text-slate-900 dark:text-white">
      <main>
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="mb-8">
            <h1 className="text-3xl font-extrabold font-headline text-slate-900 dark:text-white mb-2">
              Terms of Service
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Effective Date: April 28, 2026</p>
          </div>
          <p className="text-slate-600 dark:text-slate-400 leading-7 mb-10">
            By using <strong className="text-slate-800 dark:text-slate-200">EatCheck</strong>, you
            agree to these Terms of Service.
          </p>

          <Section title="1. Description of Service">
            <p>
              EatCheck provides AI-powered nutrition insights and dietary recommendations for
              general wellness purposes.
            </p>
          </Section>

          <Section title="2. Eligibility">
            <p>You must be at least 13 years old to use this app.</p>
          </Section>

          <Section title="3. User Accounts">
            <p>You may access the app via:</p>
            <Ul
              items={[
                'Email login (magic link via Firebase)',
                'Google account',
                'Apple ID (iOS only)',
              ]}
            />
            <p>You are responsible for maintaining access to your account.</p>
          </Section>

          <Section title="4. Acceptable Use">
            <p>You agree not to:</p>
            <Ul
              items={[
                'Use the app for unlawful purposes',
                'Misuse or interfere with the service',
                'Attempt to access unauthorized systems',
              ]}
            />
          </Section>

          <Section title="5. No Medical Advice">
            <p>
              EatCheck does{' '}
              <strong className="text-slate-800 dark:text-slate-200">not provide medical advice</strong>.
              All content is for informational purposes only and should not replace professional
              medical consultation.
            </p>
          </Section>

          <Section title="6. Subscriptions (if applicable)">
            <Ul
              items={[
                'Payments are handled via Apple App Store or Google Play',
                'Subscriptions renew automatically unless canceled',
                'You can manage subscriptions through your app store account',
              ]}
            />
          </Section>

          <Section title="7. Intellectual Property">
            <p>
              All content, trademarks, and technology are owned by EatCheck. You may not copy or
              distribute without permission.
            </p>
          </Section>

          <Section title="8. Limitation of Liability">
            <p>The service is provided &ldquo;as is&rdquo; without warranties.</p>
            <p>We are not responsible for:</p>
            <Ul
              items={[
                'Health outcomes',
                'Decisions made based on AI recommendations',
                'Service interruptions',
              ]}
            />
          </Section>

          <Section title="9. Termination">
            <p>We may suspend or terminate access if you violate these terms.</p>
          </Section>

          <Section title="10. Governing Law">
            <p>These terms are governed by the laws of China.</p>
          </Section>

          <Section title="11. Changes to Terms">
            <p>
              We may update these Terms at any time. Continued use means acceptance.
            </p>
          </Section>

          <Section title="12. Contact">
            <p>
              For questions, please contact:{' '}
              <a
                href="mailto:xiehaiji@gmail.com"
                className="text-purple-600 dark:text-purple-400 hover:underline font-medium"
              >
                xiehaiji@gmail.com
              </a>
            </p>
          </Section>
        </div>
      </main>
    </div>
  );
}
