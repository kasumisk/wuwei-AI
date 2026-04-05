'use client';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-bold text-slate-900 dark:text-white font-headline mb-4">{title}</h2>
      <div className="text-slate-600 dark:text-slate-400 leading-7 space-y-3">{children}</div>
    </section>
  );
}

function Ul({ items }: { items: string[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex items-start gap-2">
          <span className="mt-2 w-1.5 h-1.5 rounded-full bg-purple-400 dark:bg-purple-500 shrink-0" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function TermsOfServicePage() {
  return (
    <div className="min-h-screen bg-[#f7f9fb] dark:bg-slate-950 text-slate-900 dark:text-white">
      <main className="">

        {/* Content */}
        <div className="max-w-3xl mx-auto px-6 py-6">
          {/* Language notice */}
          <div className="mb-10 rounded-2xl border border-purple-100 dark:border-purple-900/40 bg-purple-50/60 dark:bg-purple-950/30 px-6 py-4 text-sm text-purple-700 dark:text-purple-300">
            本文档提供中英双语版本。Chinese and English versions are both provided below.
          </div>

          {/* ── English Version ── */}
          <div className="mb-16">
            <div className="mb-8">
              <h2 className="text-2xl font-extrabold font-headline text-slate-900 dark:text-white mb-2">
                Terms of Service (English)
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm">Last Updated: March 30, 2026</p>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-7 mb-8">
              By using{' '}
              <strong className="text-slate-800 dark:text-slate-200">Procify Toolkit</strong>, you agree to these terms.
            </p>

            <Section title="1. Services">
              <p>We provide tools such as:</p>
              <Ul
                items={[
                  'Image processing (compression, conversion, etc.)',
                  'Developer utilities',
                  'Future: account system and paid features (if enabled)',
                ]}
              />
            </Section>

            <Section title="2. User Conduct">
              <p>You agree not to:</p>
              <Ul
                items={[
                  'Upload illegal, infringing, or inappropriate content',
                  'Abuse system resources or conduct attacks',
                  "Infringe on others' intellectual property",
                ]}
              />
            </Section>

            <Section title="3. Accounts (if applicable)">
              <Ul
                items={[
                  'You are responsible for maintaining the security of your account',
                  'You may not share or transfer your account',
                ]}
              />
            </Section>

            <Section title="4. Payments & Subscriptions (if applicable)">
              <Ul
                items={[
                  'Certain features may require payment or credits',
                  'All payments are processed via Apple In-App Purchase',
                  'Subscriptions renew automatically unless cancelled',
                  "Refunds follow Apple's official refund policy",
                ]}
              />
            </Section>

            <Section title="5. Intellectual Property">
              <Ul
                items={[
                  'The app and its content are owned by the developer',
                  'User-uploaded content remains yours; you grant us a license to process it',
                ]}
              />
            </Section>

            <Section title="6. Disclaimer">
              <Ul
                items={[
                  'Service is provided “as is” without warranties',
                  'We are not liable for damages arising from use of the app',
                  'AI and tool outputs are for reference only',
                ]}
              />
            </Section>

            <Section title="7. Termination">
              <p>We may modify or discontinue the service, or suspend access for violations.</p>
            </Section>

            <Section title="8. Contact">
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

          <div className="border-t border-slate-200 dark:border-slate-800 mb-16" />

          {/* ── 中文版 ── */}
          <div>
            <div className="mb-8">
              <h2 className="text-2xl font-extrabold font-headline text-slate-900 dark:text-white mb-2">
                服务条款（中文）
              </h2>
              <p className="text-slate-500 dark:text-slate-400 text-sm">最后更新日期：2026-03-30</p>
            </div>
            <p className="text-slate-600 dark:text-slate-400 leading-7 mb-8">
              欢迎使用{' '}
              <strong className="text-slate-800 dark:text-slate-200">Procify Toolkit</strong>。使用本应用即表示您同意以下条款。
            </p>

            <Section title="一、服务说明">
              <p>本应用提供包括但不限于：</p>
              <Ul
                items={[
                  '图片处理（压缩、转换等）',
                  '开发辅助工具',
                  '未来可能提供账号系统与付费功能',
                ]}
              />
            </Section>

            <Section title="二、用户行为规范">
              <p>您同意不会：</p>
              <Ul
                items={[
                  '上传违法、侵权或不当内容',
                  '滥用系统资源或进行攻击行为',
                  '侵犯他人知识产权',
                ]}
              />
            </Section>

            <Section title="三、账号与安全（如适用）">
              <p>如未来提供账号功能：</p>
              <Ul items={['您需对账号安全负责', '不得共享或转让账号']} />
            </Section>

            <Section title="四、付费与订阅（如适用）">
              <Ul
                items={[
                  '部分功能可能需要付费或积分',
                  '所有支付通过 Apple In-App Purchase 进行',
                  '订阅将自动续费，除非取消',
                  '退款遵循 Apple 官方政策',
                ]}
              />
            </Section>

            <Section title="五、知识产权">
              <Ul
                items={[
                  '本应用及其内容归开发者所有',
                  '用户上传内容归用户所有，但授予我们用于处理的必要授权',
                ]}
              />
            </Section>

            <Section title="六、免责声明">
              <Ul
                items={[
                  '本应用按"现状"提供，不保证无错误或不中断',
                  '对因使用本应用造成的损失不承担责任',
                  'AI 或工具结果仅供参考',
                ]}
              />
            </Section>

            <Section title="七、服务变更与终止">
              <p>我们有权：</p>
              <Ul items={['修改或停止服务', '在违规情况下终止用户使用']} />
            </Section>

            <Section title="八、法律适用">
              <p>本条款受相关法律法规约束。</p>
            </Section>

            <Section title="九、联系我们">
              <p>
                如有疑问，请联系：{' '}
                <a
                  href="mailto:xiehaiji@gmail.com"
                  className="text-purple-600 dark:text-purple-400 hover:underline font-medium"
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
