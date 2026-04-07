'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { useFood } from '@/lib/hooks/use-food';
import { useToast } from '@/lib/hooks/use-toast';
import type { UserProfile, BehaviorProfile } from '@/lib/api/food';

const activityLabels: Record<string, string> = {
  sedentary: '久坐不动（办公室工作）',
  light: '轻度活动（偶尔散步）',
  moderate: '中度活动（每周运动 3-5 次）',
  active: '高强度（每天运动）',
};

const coachStyleLabels: Record<string, { label: string; desc: string; emoji: string }> = {
  strict: { label: '严格教练', desc: '直接了当，目标导向', emoji: '🏋️' },
  friendly: { label: '暖心朋友', desc: '温和鼓励，理解你', emoji: '🤗' },
  data: { label: '数据理性', desc: '客观冷静，用数字说话', emoji: '📊' },
};

export default function ProfilePage() {
  const router = useRouter();
  const { user, isLoggedIn, logout } = useAuth();
  const { getProfile, saveProfile, loading, getBehaviorProfile, updateCoachStyle } = useFood();
  const { toast } = useToast();

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [behaviorProfile, setBehaviorProfile] = useState<BehaviorProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    gender: '',
    birthYear: '',
    heightCm: '',
    weightKg: '',
    targetWeightKg: '',
    activityLevel: 'light',
    dailyCalorieGoal: '',
  });

  useEffect(() => {
    if (!isLoggedIn) {
      router.push('/login');
      return;
    }
    getProfile().then((p) => {
      if (p) {
        setProfile(p);
        setForm({
          gender: p.gender || '',
          birthYear: p.birthYear ? String(p.birthYear) : '',
          heightCm: p.heightCm ? String(p.heightCm) : '',
          weightKg: p.weightKg ? String(p.weightKg) : '',
          targetWeightKg: p.targetWeightKg ? String(p.targetWeightKg) : '',
          activityLevel: p.activityLevel || 'light',
          dailyCalorieGoal: p.dailyCalorieGoal ? String(p.dailyCalorieGoal) : '',
        });
      } else {
        setEditing(true);
      }
    });
    getBehaviorProfile().then(setBehaviorProfile).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const handleStyleChange = useCallback(async (style: 'strict' | 'friendly' | 'data') => {
    try {
      await updateCoachStyle(style);
      setBehaviorProfile((prev) => prev ? { ...prev, coachStyle: style } : prev);
      toast({ title: '教练风格已切换' });
    } catch {
      toast({ title: '切换失败', variant: 'destructive' });
    }
  }, [updateCoachStyle, toast]);

  const handleSave = useCallback(async () => {
    try {
      const data: Record<string, unknown> = { activityLevel: form.activityLevel };
      if (form.gender) data.gender = form.gender;
      if (form.birthYear) data.birthYear = parseInt(form.birthYear);
      if (form.heightCm) data.heightCm = parseFloat(form.heightCm);
      if (form.weightKg) data.weightKg = parseFloat(form.weightKg);
      if (form.targetWeightKg) data.targetWeightKg = parseFloat(form.targetWeightKg);
      if (form.dailyCalorieGoal) data.dailyCalorieGoal = parseInt(form.dailyCalorieGoal);

      const saved = await saveProfile(data as any);
      setProfile(saved);
      setEditing(false);
      toast({ title: '档案已保存' });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : '保存失败', variant: 'destructive' });
    }
  }, [form, saveProfile, toast]);

  const handleLogout = useCallback(async () => {
    await logout();
    router.push('/login');
  }, [logout, router]);

  const InfoRow = ({ label, value }: { label: string; value: string }) => (
    <div className="flex justify-between items-center py-3 border-b border-(--color-outline-variant)/10">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="font-bold text-sm">{value || '未设置'}</span>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="sticky top-0 z-50 glass-morphism">
        <div className="flex items-center justify-between px-6 py-4 max-w-lg mx-auto">
          <div className="flex items-center">
            <button onClick={() => router.back()} className="mr-4 text-foreground/70 hover:text-foreground">
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
            </button>
            <h1 className="text-xl font-extrabold font-headline tracking-tight">我的</h1>
          </div>
          {!editing && profile && (
            <button onClick={() => setEditing(true)} className="text-primary text-sm font-bold">
              编辑
            </button>
          )}
        </div>
      </nav>

      <main className="px-6 py-6 max-w-lg mx-auto pb-32">
        {/* User info card */}
        <div className="bg-card rounded-2xl p-6 mb-6 flex items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center overflow-hidden border-2 border-(--color-primary-container)">
            {user?.avatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={user.avatar} alt="avatar" className="w-full h-full object-cover" />
            ) : (
              <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32" className="text-primary">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            )}
          </div>
          <div>
            <h2 className="font-bold text-lg">{user?.nickname || '无畏用户'}</h2>
            <p className="text-xs text-muted-foreground">{user?.phone || user?.email || '匿名用户'}</p>
          </div>
        </div>

        {/* Health profile */}
        <div className="bg-card rounded-2xl p-6 mb-6">
          <h3 className="font-bold mb-4">健康档案</h3>

          {editing ? (
            <div className="space-y-4">
              {/* Gender */}
              <div>
                <label className="text-sm text-muted-foreground block mb-1">性别</label>
                <div className="flex gap-2">
                  {['male', 'female'].map((g) => (
                    <button
                      key={g}
                      onClick={() => setForm((f) => ({ ...f, gender: g }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                        form.gender === g
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {g === 'male' ? '男' : '女'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Birth year */}
              <div>
                <label className="text-sm text-muted-foreground block mb-1">出生年份</label>
                <input
                  type="number"
                  value={form.birthYear}
                  onChange={(e) => setForm((f) => ({ ...f, birthYear: e.target.value }))}
                  placeholder="例如 1995"
                  className="w-full px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Height & Weight */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground block mb-1">身高 (cm)</label>
                  <input
                    type="number"
                    value={form.heightCm}
                    onChange={(e) => setForm((f) => ({ ...f, heightCm: e.target.value }))}
                    placeholder="170"
                    className="w-full px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground block mb-1">体重 (kg)</label>
                  <input
                    type="number"
                    value={form.weightKg}
                    onChange={(e) => setForm((f) => ({ ...f, weightKg: e.target.value }))}
                    placeholder="65"
                    className="w-full px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              {/* Target weight */}
              <div>
                <label className="text-sm text-muted-foreground block mb-1">目标体重 (kg)</label>
                <input
                  type="number"
                  value={form.targetWeightKg}
                  onChange={(e) => setForm((f) => ({ ...f, targetWeightKg: e.target.value }))}
                  placeholder="60"
                  className="w-full px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              {/* Activity level */}
              <div>
                <label className="text-sm text-muted-foreground block mb-1">活动等级</label>
                <div className="space-y-2">
                  {Object.entries(activityLabels).map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setForm((f) => ({ ...f, activityLevel: key }))}
                      className={`w-full px-4 py-3 rounded-xl text-left text-sm transition-all ${
                        form.activityLevel === key
                          ? 'bg-primary text-primary-foreground font-bold'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Calorie goal override */}
              <div>
                <label className="text-sm text-muted-foreground block mb-1">每日热量目标 (kcal，留空自动计算)</label>
                <input
                  type="number"
                  value={form.dailyCalorieGoal}
                  onChange={(e) => setForm((f) => ({ ...f, dailyCalorieGoal: e.target.value }))}
                  placeholder="自动计算"
                  className="w-full px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <button
                onClick={handleSave}
                disabled={loading}
                className="w-full bg-primary text-primary-foreground font-bold py-4 rounded-full active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
              >
                {loading ? '保存中...' : '保存档案'}
              </button>
            </div>
          ) : profile ? (
            <div>
              <InfoRow label="性别" value={profile.gender === 'male' ? '男' : profile.gender === 'female' ? '女' : ''} />
              <InfoRow label="出生年份" value={profile.birthYear ? String(profile.birthYear) : ''} />
              <InfoRow label="身高" value={profile.heightCm ? `${profile.heightCm} cm` : ''} />
              <InfoRow label="体重" value={profile.weightKg ? `${profile.weightKg} kg` : ''} />
              <InfoRow label="目标体重" value={profile.targetWeightKg ? `${profile.targetWeightKg} kg` : ''} />
              <InfoRow label="活动等级" value={activityLabels[profile.activityLevel] || ''} />
              <InfoRow label="每日热量目标" value={profile.dailyCalorieGoal ? `${profile.dailyCalorieGoal} kcal` : '自动计算'} />
            </div>
          ) : (
            <p className="text-center text-muted-foreground text-sm py-6">加载中...</p>
          )}
        </div>

        {/* V5: Coach Style Selector */}
        <div className="bg-card rounded-2xl p-6 mb-6">
          <h3 className="font-bold mb-4">🤖 AI 教练风格</h3>
          <div className="space-y-2">
            {Object.entries(coachStyleLabels).map(([key, { label, desc, emoji }]) => (
              <button
                key={key}
                onClick={() => handleStyleChange(key as 'strict' | 'friendly' | 'data')}
                className={`w-full px-4 py-3 rounded-xl text-left transition-all flex items-center gap-3 ${
                  behaviorProfile?.coachStyle === key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                <span className="text-xl">{emoji}</span>
                <div>
                  <span className="text-sm font-bold block">{label}</span>
                  <span className="text-xs opacity-80">{desc}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Stats */}
        {behaviorProfile && (
          <div className="bg-card rounded-2xl p-6 mb-6">
            <h3 className="font-bold mb-4">📊 饮食数据</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-2xl font-extrabold text-primary">{behaviorProfile.streakDays}</p>
                <p className="text-xs text-muted-foreground">连续达标天数</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-extrabold text-primary">{behaviorProfile.longestStreak}</p>
                <p className="text-xs text-muted-foreground">最长记录</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-extrabold text-primary">{behaviorProfile.totalRecords}</p>
                <p className="text-xs text-muted-foreground">总记录数</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-extrabold text-primary">{Math.round(Number(behaviorProfile.avgComplianceRate) * 100)}%</p>
                <p className="text-xs text-muted-foreground">健康率</p>
              </div>
            </div>
          </div>
        )}

        {/* Logout */}
        <button
          onClick={handleLogout}
          className="w-full bg-muted text-destructive font-bold py-4 rounded-full active:scale-[0.98] transition-all"
        >
          退出登录
        </button>
      </main>
    </div>
  );
}
