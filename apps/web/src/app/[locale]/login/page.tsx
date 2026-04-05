'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, ShieldCheck, Lock } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/hooks/use-auth';
import { useToast } from '@/lib/hooks/use-toast';
import {
  auth,
  googleProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
} from '@/lib/firebase';

/* ─── Icon Components ─── */
function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  );
}

type AuthMode = 'login' | 'register' | 'reset';

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const { loginAnonymously, loginWithFirebase, loading } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isLoading = loading || submitting;

  const handleSuccess = (msg?: string) => {
    toast({ title: msg || (mode === 'register' ? t('toast.registerSuccess') : t('toast.loginSuccess')) });
    router.push('/');
  };

  const handleError = (err: unknown) => {
    const msg = err instanceof Error ? err.message : t('toast.operationFailed');
    toast({ title: msg, variant: 'destructive' });
  };

  const firebaseLogin = async (idToken: string) => {
    await loginWithFirebase(idToken);
  };

  const handleGoogleLogin = async () => {
    setSubmitting(true);
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const idToken = await result.user.getIdToken();
      await firebaseLogin(idToken);
      handleSuccess();
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailLogin = async () => {
    setSubmitting(true);
    try {
      const credential = await signInWithEmailAndPassword(auth, email, password);
      const idToken = await credential.user.getIdToken();
      await firebaseLogin(idToken);
      handleSuccess();
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleEmailRegister = async () => {
    setSubmitting(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      const idToken = await credential.user.getIdToken();
      await firebaseLogin(idToken);
      handleSuccess(t('toast.registerSuccess'));
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResetPassword = async () => {
    if (!email) {
      toast({ title: t('toast.enterEmail'), variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      await sendPasswordResetEmail(auth, email);
      toast({ title: t('toast.resetEmailSent') });
      setMode('login');
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleAnonymousLogin = async () => {
    try {
      await loginAnonymously();
      handleSuccess();
    } catch (err) {
      handleError(err);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'reset') {
      await handleResetPassword();
    } else if (mode === 'register') {
      await handleEmailRegister();
    } else {
      await handleEmailLogin();
    }
  };

  return (
    <main className="flex min-h-screen">
      {/* ─── Left Visual Panel (desktop only) ─── */}
      <section className="hidden lg:flex lg:w-7/12 relative overflow-hidden ai-gradient-bg flex-col justify-between p-16">
        {/* Decorative blur circles */}
        <div className="absolute inset-0 pointer-events-none bg-primary">
        </div>

       

        {/* Top: Logo + Badge */}
        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <span className="text-white font-headline text-3xl font-black tracking-tighter">
              {tc('appName')}
            </span>
            <span className="px-2 py-0.5 rounded bg-white/10 text-white/80 text-[10px] uppercase tracking-widest font-bold backdrop-blur-md border border-white/10">
              Quantum Tier
            </span>
          </div>
        </div>

        {/* Middle: Tagline + Testimonial */}
        <div className="relative z-10 max-w-xl">
          <h1 className="font-headline text-5xl text-white font-extrabold tracking-tight leading-[1.1] mb-6">
            {t('headline')} <br />
            <span className="text-teal-200">{t('headlineHighlight')}</span>
          </h1>
          <p className="text-lg text-white/70 font-light leading-relaxed mb-12">
            {t('description')}
          </p>

          {/* Testimonial glass card */}
          <div className="glass-morphism p-8 rounded-xl border border-white/10 max-w-md">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-blue-200 bg-linear-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-lg">
                A
              </div>
              <div>
                <p className="font-headline font-bold text-white">{t('testimonial.author')}</p>
                <p className="text-xs text-white/60">{t('testimonial.authorTitle')}</p>
              </div>
            </div>
            <p className="italic text-white/70 leading-relaxed">
              &ldquo;{t('testimonial.content')}&rdquo;
            </p>
          </div>
        </div>

        {/* Bottom: Footer links */}
        <div className="relative z-10 flex gap-8 text-white/50 text-xs font-medium uppercase tracking-widest">
          <span> {t('footer.copyright')}</span>
          <span className="hover:text-white cursor-pointer transition-colors">{t('footer.privacy')}</span>
          <span className="hover:text-white cursor-pointer transition-colors">{t('footer.security')}</span>
        </div>
      </section>

      {/* ─── Right Auth Form Panel ─── */}
      <section className="w-full lg:w-5/12 bg-white dark:bg-slate-950 flex flex-col justify-center items-center p-8 sm:p-16 overflow-y-auto">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="lg:hidden mb-12 flex justify-center">
            <span className="bg-linear-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent font-headline text-3xl font-black tracking-tighter">
              {tc('appName')}
            </span>
          </div>

          {/* Heading */}
          <div className="mb-10 text-center lg:text-left">
            <h2 className="font-headline text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight mb-2">
              {mode === 'register' ? t('mode.register') : mode === 'reset' ? t('mode.reset') : t('mode.login')}
            </h2>
            <p className="text-slate-500 dark:text-slate-400">
              {mode === 'register'
                ? t('subtitle.register')
                : mode === 'reset'
                  ? t('subtitle.reset')
                  : t('subtitle.login')}
            </p>
          </div>

          {/* Social Auth Buttons */}
          {mode !== 'reset' && (
            <>
              <div className="grid grid-cols-1 gap-4 mb-8">
                <button
                  type="button"
                  onClick={handleGoogleLogin}
                  disabled={isLoading}
                  className="flex items-center justify-center gap-3 w-full py-3.5 px-4 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors rounded-xl font-semibold text-slate-900 dark:text-white border border-slate-200/60 dark:border-slate-700/60 disabled:opacity-50"
                >
                  <GoogleIcon />
                  {t('social.google')}
                </button>
                <button
                  type="button"
                  disabled={isLoading}
                  className="flex items-center justify-center gap-3 w-full py-3.5 px-4 bg-slate-50 dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors rounded-xl font-semibold text-slate-900 dark:text-white border border-slate-200/60 dark:border-slate-700/60 disabled:opacity-50"
                >
                  <GitHubIcon />
                  {t('social.github')}
                </button>
              </div>

              {/* Divider */}
              <div className="relative my-8">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200 dark:border-slate-700" />
                </div>
                <div className="relative flex justify-center text-xs uppercase tracking-widest font-bold">
                  <span className="bg-white dark:bg-slate-950 px-4 text-slate-400">{t('form.divider')}</span>
                </div>
              </div>
            </>
          )}

          {/* Email Form */}
          <form onSubmit={handleEmailSubmit} className="space-y-5">
            {mode === 'register' && (
              <div>
                <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2" htmlFor="nickname">
                  {t('form.nickname')}
                </label>
                <input
                  id="nickname"
                  placeholder={t('form.optional')}
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value)}
                  disabled={isLoading}
                  className="w-full px-4 py-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-slate-400 transition-all text-slate-900 dark:text-white"
                />
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-900 dark:text-white mb-2" htmlFor="email">
                {t('form.email')}
              </label>
              <input
                id="email"
                type="email"
                placeholder={t('form.emailPlaceholder')}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                className="w-full px-4 py-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-slate-400 transition-all text-slate-900 dark:text-white"
              />
            </div>

            {mode !== 'reset' && (
              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-sm font-semibold text-slate-900 dark:text-white" htmlFor="password">
                    {t('form.password')}
                  </label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      className="text-xs font-bold text-blue-600 hover:text-blue-800 dark:text-blue-400 transition-colors"
                      onClick={() => setMode('reset')}
                    >
                      {t('form.forgotAccess')}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    className="w-full px-4 py-3.5 rounded-xl bg-slate-50 dark:bg-slate-900 border-none focus:ring-2 focus:ring-blue-500/40 placeholder:text-slate-400 transition-all pr-12 text-slate-900 dark:text-white"
                  />
                  <button
                    type="button"
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-600 transition-colors"
                    onClick={() => setShowPassword(!showPassword)}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-headline font-bold rounded-xl shadow-[0_8px_16px_rgba(0,88,190,0.2)] hover:shadow-[0_12px_24px_rgba(0,88,190,0.3)] active:scale-[0.98] transition-all disabled:opacity-50 disabled:pointer-events-none"
            >
              {isLoading
                ? tc('status.processing')
                : mode === 'register'
                  ? t('submit.register')
                  : mode === 'reset'
                    ? t('submit.reset')
                    : t('submit.login')}
            </button>
          </form>

          {/* Mode switching */}
          <div className="mt-10 text-center">
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              {mode === 'login' ? (
                <>
                  {t('switch.noAccount')}{' '}
                  <button type="button" className="text-blue-600 dark:text-blue-400 font-bold hover:underline decoration-2 underline-offset-4" onClick={() => setMode('register')}>
                    {t('switch.createFree')}
                  </button>
                </>
              ) : (
                <>
                  {mode === 'reset' ? t('switch.rememberPassword') : t('switch.alreadyHaveAccount')}{' '}
                  <button type="button" className="text-blue-600 dark:text-blue-400 font-bold hover:underline decoration-2 underline-offset-4" onClick={() => setMode('login')}>
                    {t('switch.signIn')}
                  </button>
                </>
              )}
            </p>
          </div>

          {/* Anonymous login */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-700" />
            </div>
            <div className="relative flex justify-center text-xs uppercase tracking-widest font-bold">
              <span className="bg-white dark:bg-slate-950 px-4 text-slate-400">{t('form.dividerOr')}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleAnonymousLogin}
            disabled={isLoading}
            className="w-full py-3 text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 font-medium transition-colors disabled:opacity-50"
          >
            {t('guest')}
          </button>

          {/* Trust badges */}
          <div className="mt-12 flex items-center justify-center gap-6 opacity-30 grayscale hover:opacity-60 transition-opacity">
            <div className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-widest">SOC2 Type II</span>
            </div>
            <div className="flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" />
              <span className="text-[10px] font-bold uppercase tracking-widest">AES-256</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
