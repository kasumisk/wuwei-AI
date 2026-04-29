'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { profileService } from '@/lib/api/profile';
import { useToast } from '@/lib/hooks/use-toast';

/* ─── SVG Icon Components ─── */
function IconPlant({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M6 21h12v-2H6v2zm6-16c-.55 0-1 .45-1 1v6.07c-1.13.2-2 1.19-2 2.37V18h6v-3.56c0-1.18-.87-2.17-2-2.37V6c0-.55-.45-1-1-1zm4.5 1c0 2.49-2.01 4.5-4.5 4.5S7.5 8.49 7.5 6h-2C5.5 9.59 8.41 12.5 12 12.5S18.5 9.59 18.5 6h-2z" />
    </svg>
  );
}

function IconArrowForward({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="m12 4-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" />
    </svg>
  );
}

function IconChat({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
    </svg>
  );
}

function IconArrowBack({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
      <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
    </svg>
  );
}

type Step = 'phone' | 'code';

export default function LoginPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { sendPhoneCode, loginWithPhone, getWechatAuthUrl, loginWithWechatToken, loading } =
    useAuth();

  /** 登录成功后根据档案完成情况决定跳转目标 */
  const redirectAfterLogin = useCallback(async () => {
    try {
      const profile = await profileService.getProfile();
      if (profile?.onboardingCompleted) {
        router.push('/home');
      } else {
        const startStep = profile?.onboardingStep ?? 1;
        router.push(`/onboarding?step=${startStep}`);
      }
    } catch {
      // 新用户尚未创建档案 → 引导填写
      router.push('/onboarding');
    }
  }, [router]);

  const [step, setStep] = useState<Step>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isLoading = loading || submitting;

  /* ─── Countdown timer ─── */
  useEffect(() => {
    if (countdown <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }
    timerRef.current = setInterval(() => {
      setCountdown((c) => c - 1);
    }, 1000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [countdown]);

  const handleError = useCallback(
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : '操作失败，请重试';
      toast({ title: msg, variant: 'destructive' });
    },
    [toast]
  );

  /* ─── Handle WeChat OAuth callback token ─── */
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const wechatToken = params.get('wechat_token');
    const errorMsg = params.get('error');
    if (wechatToken) {
      // 清除 URL 参数，避免刷新重复触发
      window.history.replaceState({}, '', window.location.pathname);
      loginWithWechatToken(wechatToken)
        .then(() => redirectAfterLogin())
        .catch(handleError);
    } else if (errorMsg) {
      window.history.replaceState({}, '', window.location.pathname);
      toast({ title: decodeURIComponent(errorMsg), variant: 'destructive' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ─── Send verification code ─── */
  const handleSendCode = async () => {
    const trimmed = phone.replace(/\s/g, '');
    if (!/^1\d{10}$/.test(trimmed)) {
      toast({ title: '请输入正确的11位手机号', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      await sendPhoneCode(trimmed);
      toast({ title: '验证码已发送' });
      setStep('code');
      setCountdown(60);
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  };

  /* ─── Verify code & login ─── */
  const handleLogin = async () => {
    if (code.length < 4) {
      toast({ title: '请输入验证码', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      await loginWithPhone(phone.replace(/\s/g, ''), code);
      toast({ title: '登录成功' });
      await redirectAfterLogin();
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  };

  /* ─── WeChat login ─── */
  const handleWechatLogin = async () => {
    try {
      // redirect_uri 指向后端 callback，后端换 token 后再重定向回前端
      const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || 'https://uway-api.dev-net.uk/api';
      const redirectUri = `${apiBase}/app/auth/wechat/callback`;
      const { url } = await getWechatAuthUrl(redirectUri);
      if (url) window.location.href = url;
    } catch (err) {
      handleError(err);
    }
  };

  /* ─── Resend code ─── */
  const handleResend = async () => {
    if (countdown > 0) return;
    setSubmitting(true);
    try {
      await sendPhoneCode(phone.replace(/\s/g, ''));
      toast({ title: '验证码已重新发送' });
      setCountdown(60);
    } catch (err) {
      handleError(err);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="bg-background text-foreground min-h-screen flex flex-col items-center justify-center p-4 selection:bg-(--color-primary-container) relative overflow-hidden">
      {/* Subtle Background Organic Shapes */}
      <div className="fixed top-[-10%] right-[-10%] w-[60%] h-[50%] bg-surface-container-low  blur-[120px] -z-10" />
      <div className="fixed bottom-[-5%] left-[-10%] w-[50%] h-[40%] bg-(--color-surface-variant)/40  blur-[100px] -z-10" />

      <div className="w-full max-w-md flex flex-col space-y-12">
        {/* Header Branding */}
        <header className="space-y-4">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary  text-primary-foreground shadow-xl shadow-primary/10">
            <IconPlant className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            {step === 'phone' ? (
              <>
                <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-foreground font-headline">
                  欢迎回来
                </h1>
                <p className="text-muted-foreground text-lg leading-relaxed max-w-70">
                  继续你的健康饮食之旅。
                </p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setStep('phone')}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-2"
                >
                  <IconArrowBack className="w-4 h-4" />
                  返回
                </button>
                <h1 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-foreground font-headline">
                  输入验证码
                </h1>
                <p className="text-muted-foreground text-lg leading-relaxed max-w-75">
                  验证码已发送至 +86 {phone}
                </p>
              </>
            )}
          </div>
        </header>

        {/* Login Form */}
        <section className="space-y-8">
          {step === 'phone' ? (
            <>
              {/* Phone Input */}
              <div className="space-y-4">
                <label
                  className="block text-xs font-bold tracking-[0.05em] uppercase text-muted-foreground ml-1"
                  htmlFor="phone"
                >
                  手机号码
                </label>
                <div className="relative group">
                  <div className="absolute left-5 top-1/2 -translate-y-1/2 flex items-center space-x-2 text-muted-foreground">
                    <span className="text-base font-semibold">+86</span>
                    <div className="w-px h-4 bg-(--color-outline-variant)/30" />
                  </div>
                  <input
                    id="phone"
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    placeholder="138 0000 0000"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/[^\d\s]/g, ''))}
                    disabled={isLoading}
                    maxLength={13}
                    className="w-full bg-(--color-surface-variant) border-none  py-5 pl-20 pr-6 text-lg font-medium text-foreground placeholder:text-muted-foreground/40 focus:ring-2 focus:ring-primary focus:bg-card transition-all outline-none"
                  />
                </div>
              </div>

              {/* Continue Button */}
              <button
                type="button"
                onClick={handleSendCode}
                disabled={isLoading || phone.replace(/\s/g, '').length < 11}
                className="w-full bg-primary text-primary-foreground font-bold py-5  text-lg shadow-lg shadow-primary/20 active:scale-[0.98] transition-all flex items-center justify-center space-x-2 disabled:opacity-50 disabled:pointer-events-none"
              >
                <span>{isLoading ? '发送中...' : '获取验证码'}</span>
                <IconArrowForward className="w-5 h-5" />
              </button>
            </>
          ) : (
            <>
              {/* Code Input */}
              <div className="space-y-4">
                <label
                  className="block text-xs font-bold tracking-[0.05em] uppercase text-muted-foreground ml-1"
                  htmlFor="code"
                >
                  验证码
                </label>
                <input
                  id="code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  placeholder="输入6位验证码"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  disabled={isLoading}
                  maxLength={6}
                  className="w-full bg-(--color-surface-variant) border-none  py-5 px-4 text-center text-2xl font-bold tracking-[0.5em] text-foreground placeholder:text-muted-foreground/40 placeholder:text-base placeholder:tracking-normal focus:ring-2 focus:ring-primary focus:bg-card transition-all outline-none"
                />
                <div className="text-center">
                  {countdown > 0 ? (
                    <span className="text-sm text-muted-foreground">{countdown}s 后可重新发送</span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleResend}
                      disabled={isLoading}
                      className="text-sm font-bold text-primary hover:underline disabled:opacity-50"
                    >
                      重新发送验证码
                    </button>
                  )}
                </div>
              </div>

              {/* Login Button */}
              <button
                type="button"
                onClick={handleLogin}
                disabled={isLoading || code.length < 4}
                className="w-full bg-primary text-primary-foreground font-bold py-5  text-lg shadow-lg shadow-primary/20 active:scale-[0.98] transition-all flex items-center justify-center space-x-2 disabled:opacity-50 disabled:pointer-events-none"
              >
                <span>{isLoading ? '登录中...' : '登录'}</span>
                <IconArrowForward className="w-5 h-5" />
              </button>
            </>
          )}
        </section>

        {/* Divider */}
        <div className="relative flex items-center justify-center py-2">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full h-px bg-(--color-outline-variant)/20" />
          </div>
          <span className="relative px-4 bg-background text-xs font-bold tracking-widest uppercase text-muted-foreground/60">
            其他登录方式
          </span>
        </div>

        {/* Social Login */}
        <footer className="flex items-center justify-center space-x-6">
          <button
            type="button"
            onClick={handleWechatLogin}
            className="w-14 h-14 flex items-center justify-center bg-(--color-surface-container-highest)  active:scale-95 transition-all hover:bg-surface-container-high group"
            title="微信登录"
          >
            <IconChat className="w-6 h-6 text-muted-foreground group-hover:text-foreground" />
          </button>
        </footer>

        {/* Decorative botanical image */}
        <div className="pt-8 overflow-hidden  opacity-40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="botanical background"
            className="w-full h-24 object-cover grayscale brightness-110"
            src="https://lh3.googleusercontent.com/aida-public/AB6AXuCtSw8PzrAMHJe5BxNSAKCAy4GHxnD5_BpbtcWjlzckVY7cYRQybfvgQuQ76WvpdEPuuqCDScBfdszXUMx1SUbBmss7nDSYoEn5xApZvDqosCVu5DC32IHBvJjBzNRDypE34gs8mBv5O8EiESFumeBsdoZqZzucXI_Pd7WvXcWxe3RoYQx6swvv4WVuzztuyBeIGO77Nwg8Q_6pFoyEqVhAizJcfjZgy6DcfCtooVXjJPbILsMQ9Oc_uviSFXLTd2arINXcsl5XJHc"
          />
        </div>
      </div>

      {/* Bottom Legal Links */}
      <div className="fixed bottom-8 text-center w-full px-4">
        <p className="text-[10px] text-muted-foreground/60 font-medium tracking-tight">
          继续即表示您同意我们的{' '}
          <a
            className="underline decoration-primary/30 hover:text-primary transition-colors"
            href="#"
          >
            隐私政策
          </a>{' '}
          和{' '}
          <a
            className="underline decoration-primary/30 hover:text-primary transition-colors"
            href="#"
          >
            服务条款
          </a>
        </p>
      </div>
    </main>
  );
}
