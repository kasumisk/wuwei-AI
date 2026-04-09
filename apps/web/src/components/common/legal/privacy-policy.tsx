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
          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-blue-400 dark:bg-blue-500 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#f7f9fb] dark:bg-slate-950 text-slate-900 dark:text-white">
      <main className="">
        {/* Content */}
        <div className="max-w-3xl mx-auto px-6 py-12">
          {/* Language notice */}
          <div className="mb-10 rounded-2xl border border-blue-100 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-950/30 px-6 py-4 text-sm text-blue-700 dark:text-blue-300">
            本文档提供中英双语版本。Chinese and English versions are both provided below.
          </div>

          {/* ── English Version ── */}
          <div className="mb-16">
            <div className="mb-8">
              <h2 className="text-2xl font-extrabold font-headline text-slate-900 dark:text-white mb-2">
                Privacy Policy (English)
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm">
                Last Updated: March 30, 2026
              </p>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-7 mb-8">
              We value your privacy. This Privacy Policy explains how we collect, use, and protect
              your information when you use{' '}
              <strong className="text-slate-800 dark:text-slate-200">Procify Toolkit</strong>.
            </p>

            <Section title="1. Information We Collect">
              <Ul
                items={[
                  'Device information (model, OS version, IP address)',
                  'Uploaded images/files — used for processing only, not stored long-term',
                  'Push notification identifiers and preferences (if enabled)',
                  'Future: account info and payment data handled by third-party providers (if features are enabled)',
                ]}
              />
            </Section>

            <Section title="2. How We Use Information">
              <Ul
                items={[
                  'Provide and improve app features',
                  'Optimize performance and user experience',
                  'Send notifications (feature updates, system messages)',
                  'Prevent fraud and abuse',
                ]}
              />
            </Section>

            <Section title="3. Third-Party Services">
              <p>We may use:</p>
              <Ul
                items={[
                  'Firebase (analytics, push notifications, authentication)',
                  'Cloud storage (for temporary file processing)',
                  'Apple In-App Purchase (for payments)',
                ]}
              />
              <p>These third parties may process your data under their own privacy policies.</p>
            </Section>

            <Section title="4. Data Security">
              <Ul
                items={[
                  'We implement reasonable safeguards to protect your information',
                  'Uploaded files are processed temporarily and not stored long-term',
                  'We do not sell your personal data',
                ]}
              />
            </Section>

            <Section title="5. Your Rights">
              <p>You may:</p>
              <Ul
                items={[
                  'Request access to or deletion of your data (when account features are available)',
                  'Disable push notifications at any time',
                  'Stop using the app',
                ]}
              />
            </Section>

            <Section title="6. Children">
              <p>
                This app is not directed to children under 13. If we become aware of data collected
                from such users, we will delete it promptly.
              </p>
            </Section>

            <Section title="7. Updates">
              <p>
                We may update this policy periodically. Changes will be announced in the app or on
                our website.
              </p>
            </Section>

            <Section title="8. Contact">
              <p>
                For questions about this policy, please contact:{' '}
                <a
                  href="mailto:xiehaiji@gmail.com"
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  xiehaiji@gmail.com
                </a>
              </p>
            </Section>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 mb-16" />

          {/* ── 中文版 ── */}
          <div>
            <div className="mb-8">
              <h2 className="text-2xl font-extrabold font-headline text-slate-900 dark:text-white mb-2">
                隐私政策（中文）
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm">最后更新日期：2026-03-30</p>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-7 mb-8">
              欢迎使用{' '}
              <strong className="text-slate-800 dark:text-slate-200">Procify Toolkit</strong>
              （以下简称&ldquo;本应用&rdquo;）。我们非常重视您的隐私和个人信息保护。本隐私政策说明我们如何收集、使用和保护您的信息。
            </p>

            <Section title="一、我们收集的信息">
              <p className="font-medium text-slate-700 dark:text-slate-300">1. 设备与日志信息</p>
              <Ul items={['设备型号、操作系统版本', 'IP 地址', '应用崩溃日志、性能数据']} />
              <p className="font-medium text-slate-700 dark:text-slate-300 pt-2">
                2. 图片与文件数据
              </p>
              <Ul
                items={[
                  '您主动上传的图片或文件（用于处理功能，如压缩、转换等）',
                  '我们不会在未经允许的情况下长期存储您的文件',
                ]}
              />
              <p className="font-medium text-slate-700 dark:text-slate-300 pt-2">
                3. 推送通知（如启用）
              </p>
              <Ul items={['设备推送标识符（Push Token）', '通知偏好设置']} />
              <p className="font-medium text-slate-700 dark:text-slate-300 pt-2">
                4. 未来可能收集的信息（如启用相关功能）
              </p>
              <Ul
                items={[
                  '账号信息（如邮箱、第三方登录信息）',
                  '支付信息（由第三方支付平台处理，我们不直接存储）',
                ]}
              />
            </Section>

            <Section title="二、我们如何使用信息">
              <p>我们收集的信息将用于：</p>
              <Ul
                items={[
                  '提供和优化图片处理及工具功能',
                  '改善用户体验与性能',
                  '发送通知（如功能更新、系统消息）',
                  '防止欺诈和滥用行为',
                ]}
              />
            </Section>

            <Section title="三、第三方服务">
              <p>本应用可能使用以下第三方服务：</p>
              <Ul
                items={[
                  'Firebase（用于分析、推送通知、身份认证）',
                  '云存储服务（用于临时文件处理）',
                  '支付服务提供商（如 Apple In-App Purchase）',
                ]}
              />
              <p>这些第三方可能会根据其隐私政策处理您的数据。</p>
            </Section>

            <Section title="四、数据存储与安全">
              <Ul
                items={[
                  '我们采取合理措施保护您的信息安全',
                  '上传的文件通常为临时处理，不会长期存储',
                  '我们不会出售您的个人信息',
                ]}
              />
            </Section>

            <Section title="五、您的权利">
              <p>您有权：</p>
              <Ul
                items={[
                  '访问或删除您的数据（如未来提供账号功能）',
                  '关闭推送通知',
                  '停止使用本应用',
                ]}
              />
            </Section>

            <Section title="六、未成年人保护">
              <p>本应用不面向 13 岁以下儿童。如发现相关数据将及时删除。</p>
            </Section>

            <Section title="七、隐私政策的更新">
              <p>我们可能会不时更新本政策，更新后将在应用内或网站公布。</p>
            </Section>

            <Section title="八、联系我们">
              <p>
                如您对本政策有任何疑问，请联系：
                <br />
                <a
                  href="mailto:xiehaiji@gmail.com"
                  className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                >
                  xiehaiji@gmail.com
                </a>
              </p>
            </Section>
          </div>
        </div>
      </main>
    </div>
  );
}
