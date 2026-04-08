'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/hooks/use-auth';
import { useFood } from '@/lib/hooks/use-food';
import { useToast } from '@/lib/hooks/use-toast';
import type { UserProfile } from '@/lib/api/food';

const activityOptions = [
  { key: 'sedentary', label: '久坐不动（办公室工作）' },
  { key: 'light', label: '轻度活动（偶尔散步）' },
  { key: 'moderate', label: '中度活动（每周运动 3-5 次）' },
  { key: 'active', label: '高强度（每天运动）' },
];

const goalOptions = [
  { key: 'fat_loss', label: '减脂', emoji: '🔥', desc: '减少体脂，塑造体型' },
  { key: 'muscle_gain', label: '增肌', emoji: '💪', desc: '增加肌肉量，提升力量' },
  { key: 'health', label: '保持健康', emoji: '🧘', desc: '维持健康体重和状态' },
  { key: 'habit', label: '改善习惯', emoji: '🌱', desc: '养成规律饮食的好习惯' },
];

const goalSpeedOptions = [
  { key: 'aggressive', label: '激进', desc: '快速见效' },
  { key: 'steady', label: '稳定', desc: '推荐' },
  { key: 'relaxed', label: '佛系', desc: '慢慢来' },
];

const takeoutOptions = [
  { key: 'never', label: '很少' },
  { key: 'sometimes', label: '偶尔' },
  { key: 'often', label: '经常' },
];

const disciplineOptions = [
  { key: 'high', label: '很强' },
  { key: 'medium', label: '一般' },
  { key: 'low', label: '容易放弃' },
];

const foodPreferenceOptions = [
  { key: 'sweet', label: '甜食' },
  { key: 'fried', label: '油炸' },
  { key: 'carbs', label: '碳水' },
  { key: 'meat', label: '肉类' },
  { key: 'spicy', label: '辛辣' },
];

const dietaryRestrictionOptions = [
  { key: 'no_beef', label: '不吃牛肉' },
  { key: 'vegetarian', label: '素食' },
  { key: 'lactose_free', label: '乳糖不耐' },
  { key: 'halal', label: '清真' },
];

const weakSlotOptions = [
  { key: 'afternoon', label: '下午' },
  { key: 'evening', label: '傍晚' },
  { key: 'midnight', label: '深夜' },
];

function toggleArr(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

export default function HealthProfilePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get('from') === 'onboarding';

  const { isLoggedIn } = useAuth();
  const { getProfile, saveProfile, loading } = useFood();
  const { toast } = useToast();

  const [form, setForm] = useState({
    gender: 'male',
    birthYear: '',
    heightCm: '',
    weightKg: '',
    targetWeightKg: '',
    activityLevel: 'light',
    dailyCalorieGoal: '',
    goal: 'health' as 'fat_loss' | 'muscle_gain' | 'health' | 'habit',
    goalSpeed: 'steady' as 'aggressive' | 'steady' | 'relaxed',
    mealsPerDay: 3,
    takeoutFrequency: 'sometimes' as 'never' | 'sometimes' | 'often',
    canCook: true,
    foodPreferences: [] as string[],
    dietaryRestrictions: [] as string[],
    weakTimeSlots: [] as string[],
    discipline: 'medium' as 'high' | 'medium' | 'low',
  });

  useEffect(() => {
    if (!isLoggedIn) {
      router.push('/login');
      return;
    }
    getProfile().then((p) => {
      if (p) {
        setForm({
          gender: p.gender || 'male',
          birthYear: p.birthYear ? String(p.birthYear) : '',
          heightCm: p.heightCm ? String(p.heightCm) : '',
          weightKg: p.weightKg ? String(p.weightKg) : '',
          targetWeightKg: p.targetWeightKg ? String(p.targetWeightKg) : '',
          activityLevel: p.activityLevel || 'light',
          dailyCalorieGoal: p.dailyCalorieGoal ? String(p.dailyCalorieGoal) : '',
          goal: p.goal || 'health',
          goalSpeed: p.goalSpeed || 'steady',
          mealsPerDay: p.mealsPerDay || 3,
          takeoutFrequency: p.takeoutFrequency || 'sometimes',
          canCook: p.canCook !== undefined ? p.canCook : true,
          foodPreferences: p.foodPreferences || [],
          dietaryRestrictions: p.dietaryRestrictions || [],
          weakTimeSlots: p.weakTimeSlots || [],
          discipline: p.discipline || 'medium',
        });
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  const up = useCallback(<K extends keyof typeof form>(key: K, value: typeof form[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const toggleChip = useCallback((key: 'foodPreferences' | 'dietaryRestrictions' | 'weakTimeSlots', val: string) => {
    setForm((f) => ({ ...f, [key]: toggleArr(f[key], val) }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.heightCm || !form.weightKg || !form.birthYear) {
      toast({ title: '请填写身高、体重和出生年份', variant: 'destructive' });
      return;
    }
    try {
      const data: Partial<UserProfile> = {
        activityLevel: form.activityLevel,
        goal: form.goal,
        goalSpeed: form.goalSpeed,
        mealsPerDay: form.mealsPerDay,
        takeoutFrequency: form.takeoutFrequency,
        canCook: form.canCook,
        foodPreferences: form.foodPreferences,
        dietaryRestrictions: form.dietaryRestrictions,
        weakTimeSlots: form.weakTimeSlots,
        discipline: form.discipline,
        onboardingCompleted: true,
      };
      if (form.gender) data.gender = form.gender;
      if (form.birthYear) data.birthYear = parseInt(form.birthYear);
      if (form.heightCm) data.heightCm = parseFloat(form.heightCm);
      if (form.weightKg) data.weightKg = parseFloat(form.weightKg);
      if (form.targetWeightKg) data.targetWeightKg = parseFloat(form.targetWeightKg);
      if (form.dailyCalorieGoal) data.dailyCalorieGoal = parseInt(form.dailyCalorieGoal);

      await saveProfile(data);
      toast({ title: '保存成功' });

      if (isOnboarding) {
        router.push('/');
      } else {
        router.back();
      }
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : '保存失败', variant: 'destructive' });
    }
  }, [form, saveProfile, toast, isOnboarding, router]);

  // ── Sub-components ──
  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <p className="text-sm font-extrabold text-foreground mt-6 mb-3 first:mt-0">{children}</p>
  );

  const SubLabel = ({ children }: { children: React.ReactNode }) => (
    <p className="text-xs font-semibold text-muted-foreground mb-2">{children}</p>
  );

  const Divider = () => (
    <div className="border-t border-border/40 my-5" />
  );

  const ChipRow = ({
    field, options,
  }: { field: 'foodPreferences' | 'dietaryRestrictions' | 'weakTimeSlots'; options: { key: string; label: string }[] }) => (
    <div className="flex flex-wrap gap-2">
      {options.map(({ key, label }) => {
        const active = form[field].includes(key);
        return (
          <button
            key={key}
            onClick={() => toggleChip(field, key)}
            className={`px-3 py-1.5 rounded-full text-sm font-bold transition-all ${
              active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  const BtnGroup = ({
    options, value, onChange,
  }: { options: { key: string; label: string }[]; value: string; onChange: (k: string) => void }) => (
    <div className="flex gap-2">
      {options.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
            value === key ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <nav className="sticky top-0 z-50 glass-morphism">
        <div className="flex items-center px-6 py-4 max-w-lg mx-auto">
          {!isOnboarding && (
            <button onClick={() => router.back()} className="mr-4 text-foreground/70 hover:text-foreground">
              <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
                <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
              </svg>
            </button>
          )}
          <div>
            <h1 className="text-xl font-extrabold font-headline tracking-tight">健康档案</h1>
            {isOnboarding && (
              <p className="text-xs text-muted-foreground mt-0.5">填写后将为你制定个性化饮食方案</p>
            )}
          </div>
        </div>
      </nav>

      <main className="px-6 py-6 max-w-lg mx-auto pb-32">
        <div className="bg-card rounded-2xl p-6 mb-5">

          {/* 基本信息 */}
          <SectionTitle>基本信息</SectionTitle>

          <SubLabel>性别</SubLabel>
          <BtnGroup
            options={[{ key: 'male', label: '男' }, { key: 'female', label: '女' }]}
            value={form.gender}
            onChange={(k) => up('gender', k)}
          />

          <div className="mt-4">
            <SubLabel>出生年份 *</SubLabel>
            <input
              type="number"
              value={form.birthYear}
              onChange={(e) => up('birthYear', e.target.value)}
              placeholder="例如 1995"
              className="w-full px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3 mt-4">
            <div>
              <SubLabel>身高 (cm) *</SubLabel>
              <input
                type="number"
                value={form.heightCm}
                onChange={(e) => up('heightCm', e.target.value)}
                placeholder="170"
                className="w-full px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
            <div>
              <SubLabel>体重 (kg) *</SubLabel>
              <input
                type="number"
                value={form.weightKg}
                onChange={(e) => up('weightKg', e.target.value)}
                placeholder="65"
                className="w-full px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="mt-4">
            <SubLabel>目标体重 (kg)</SubLabel>
            <input
              type="number"
              value={form.targetWeightKg}
              onChange={(e) => up('targetWeightKg', e.target.value)}
              placeholder="60"
              className="w-full px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          <Divider />

          {/* 活动等级 */}
          <SectionTitle>活动等级</SectionTitle>
          <div className="space-y-2">
            {activityOptions.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => up('activityLevel', key)}
                className={`w-full px-4 py-3 rounded-xl text-left text-sm font-medium transition-all ${
                  form.activityLevel === key
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <Divider />

          {/* 你的目标 */}
          <SectionTitle>🎯 你的目标</SectionTitle>

          <SubLabel>主要目标</SubLabel>
          <div className="grid grid-cols-2 gap-2">
            {goalOptions.map(({ key, label, emoji, desc }) => (
              <button
                key={key}
                onClick={() => up('goal', key as typeof form.goal)}
                className={`py-3 px-3 rounded-xl text-sm font-bold transition-all text-left ${
                  form.goal === key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <span className="text-base">{emoji} {label}</span>
                <p className={`text-[11px] mt-0.5 font-normal ${form.goal === key ? 'opacity-80' : 'opacity-60'}`}>{desc}</p>
              </button>
            ))}
          </div>

          <div className="mt-4">
            <SubLabel>目标速度</SubLabel>
            <div className="flex gap-2">
              {goalSpeedOptions.map(({ key, label, desc }) => (
                <button
                  key={key}
                  onClick={() => up('goalSpeed', key as typeof form.goalSpeed)}
                  className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all flex flex-col items-center gap-0.5 ${
                    form.goalSpeed === key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  <span>{label}</span>
                  <span className={`text-[10px] font-normal ${form.goalSpeed === key ? 'opacity-80' : 'opacity-60'}`}>{desc}</span>
                </button>
              ))}
            </div>
          </div>

          <Divider />

          {/* 饮食习惯 */}
          <SectionTitle>🥗 饮食习惯</SectionTitle>

          <SubLabel>一天几餐</SubLabel>
          <div className="flex gap-2">
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => up('mealsPerDay', n)}
                className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  form.mealsPerDay === n
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {n} 餐
              </button>
            ))}
          </div>

          <div className="mt-4">
            <SubLabel>外卖频率</SubLabel>
            <BtnGroup
              options={takeoutOptions}
              value={form.takeoutFrequency}
              onChange={(k) => up('takeoutFrequency', k as typeof form.takeoutFrequency)}
            />
          </div>

          <div className="mt-4">
            <SubLabel>是否会做饭</SubLabel>
            <BtnGroup
              options={[{ key: 'yes', label: '会做饭' }, { key: 'no', label: '不会' }]}
              value={form.canCook ? 'yes' : 'no'}
              onChange={(k) => up('canCook', k === 'yes')}
            />
          </div>

          <div className="mt-4">
            <SubLabel>饮食偏好（可多选）</SubLabel>
            <ChipRow field="foodPreferences" options={foodPreferenceOptions} />
          </div>

          <div className="mt-4">
            <SubLabel>忌口（可多选）</SubLabel>
            <ChipRow field="dietaryRestrictions" options={dietaryRestrictionOptions} />
          </div>

          <Divider />

          {/* 行为习惯 */}
          <SectionTitle>🧠 行为习惯</SectionTitle>

          <SubLabel>自律程度</SubLabel>
          <BtnGroup
            options={disciplineOptions}
            value={form.discipline}
            onChange={(k) => up('discipline', k as typeof form.discipline)}
          />

          <div className="mt-4">
            <SubLabel>容易乱吃时段（可多选）</SubLabel>
            <ChipRow field="weakTimeSlots" options={weakSlotOptions} />
          </div>

          <Divider />

          <SubLabel>每日热量目标 (kcal，留空自动计算)</SubLabel>
          <input
            type="number"
            value={form.dailyCalorieGoal}
            onChange={(e) => up('dailyCalorieGoal', e.target.value)}
            placeholder="自动计算"
            className="w-full px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
          />

          {/* 保存按钮 */}
          <button
            onClick={handleSave}
            disabled={loading}
            className="w-full mt-6 bg-primary text-primary-foreground font-bold py-4 rounded-full active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            {loading ? '保存中...' : isOnboarding ? '完成设置，开始使用 →' : '保存档案'}
          </button>

          {isOnboarding && (
            <button
              onClick={() => router.push('/')}
              className="w-full mt-3 py-3 rounded-full text-sm text-muted-foreground border border-border/50 active:scale-[0.98] transition-all"
            >
              暂时跳过
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
