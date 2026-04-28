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
          <span className="mt-2 w-1.5 h-1.5 bg-blue-400 dark:bg-blue-500 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#f7f9fb] dark:bg-slate-950 text-slate-900 dark:text-white">
      <main>
        <div className="max-w-3xl mx-auto px-4 py-12">
          <div className="mb-8">
            <h1 className="text-3xl font-extrabold font-headline text-slate-900 dark:text-white mb-2">
              Privacy Policy
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm">Effective Date: April 28, 2026</p>
          </div>
          <p className="text-slate-600 dark:text-slate-400 leading-7 mb-10">
            <strong className="text-slate-800 dark:text-slate-200">EatCheck</strong> (&ldquo;we&rdquo;,
            &ldquo;our&rdquo;, or &ldquo;us&rdquo;) respects your privacy. This Privacy Policy
            describes how we collect, use, and protect your personal information. This policy is
            intended for users <strong className="text-slate-800 dark:text-slate-200">outside the
            European Economic Area (EEA) and mainland China</strong>.
          </p>

          <Section title="1. Information We Collect">
            <p className="font-medium text-slate-700 dark:text-slate-300">1.1 Personal Information</p>
            <Ul items={['Email address', 'Google account ID (if using Google Sign-In)', 'Apple ID (if using Apple Sign-In)']} />
            <p className="font-medium text-slate-700 dark:text-slate-300 mt-3">1.2 User-Provided Data</p>
            <Ul items={['Food intake and meal logs', 'Dietary preferences and goals', 'Nutrition inputs and feedback']} />
            <p className="font-medium text-slate-700 dark:text-slate-300 mt-3">1.3 Usage Data</p>
            <Ul items={['App interactions and feature usage', 'Device information and OS version', 'Crash logs and diagnostics']} />
          </Section>

          <Section title="2. How We Use Your Information">
            <Ul
              items={[
                'Deliver personalized AI-powered nutrition insights',
                'Authenticate your identity and manage your account',
                'Improve app features and user experience',
                'Analyze aggregated trends to enhance our service',
              ]}
            />
          </Section>

          <Section title="3. Data Sharing">
            <p>We do <strong className="text-slate-800 dark:text-slate-200">not sell</strong> your personal data.</p>
            <p>We may share data with:</p>
            <Ul
              items={[
                'Service providers that help operate our infrastructure (e.g., Firebase)',
                'Legal authorities when required by applicable law',
              ]}
            />
          </Section>

          <Section title="4. Data Retention">
            <p>
              We retain your data for as long as your account is active or as needed to provide
              services. You may request deletion of your account and data at any time by contacting
              us.
            </p>
          </Section>

          <Section title="5. Data Security">
            <p>
              We use reasonable technical and organizational safeguards to protect your data.
              However, no system is fully secure, and we cannot guarantee absolute security.
            </p>
          </Section>

          <Section title="6. California Privacy Rights (CCPA)">
            <p>If you are a California resident, you have the right to:</p>
            <Ul
              items={[
                'Know what personal data we collect and how it is used',
                'Request deletion of your personal data',
                'Know the categories of third parties with whom data is shared',
              ]}
            />
            <p>
              To exercise these rights, contact us at{' '}
              <a
                href="mailto:xiehaiji@gmail.com"
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                xiehaiji@gmail.com
              </a>
              .
            </p>
          </Section>

          <Section title="7. Children's Privacy">
            <p>EatCheck is not intended for users under the age of 13. We do not knowingly collect data from children.</p>
          </Section>

          <Section title="8. Third-Party Services">
            <p>We use the following third-party services that may collect data independently:</p>
            <Ul items={['Firebase Authentication', 'Google Sign-In', 'Apple Sign-In']} />
            <p>Please review their respective privacy policies for details.</p>
          </Section>

          <Section title="9. International Data Transfers">
            <p>
              Your data may be processed in the United States or other countries. By using EatCheck,
              you consent to such transfers.
            </p>
          </Section>

          <Section title="10. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. We will notify you of material
              changes by updating the effective date above.
            </p>
          </Section>

          <Section title="11. Contact Us">
            <p>
              If you have questions about this Privacy Policy, please contact us at:{' '}
              <a
                href="mailto:xiehaiji@gmail.com"
                className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                xiehaiji@gmail.com
              </a>
            </p>
          </Section>

          <Section title="12. Disclaimer">
            <p>
              The nutrition insights provided by EatCheck are generated by AI and are for
              informational purposes only. They do{' '}
              <strong className="text-slate-800 dark:text-slate-200">not constitute medical advice</strong>.
              Always consult a qualified healthcare professional before making dietary or health
              decisions.
            </p>
          </Section>
        </div>
      </main>
    </div>
  );
}
