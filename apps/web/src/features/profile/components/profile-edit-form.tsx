'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useProfile } from '@/features/profile/hooks/use-profile';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useToast } from '@/lib/hooks/use-toast';
import type { UserProfile } from '@/types/user';
import {
  GOAL_OPTIONS,
  ACTIVITY_LEVEL_OPTIONS,
  TAKEOUT_OPTIONS,
  DIETARY_RESTRICTION_OPTIONS,
  FOOD_PREFERENCE_OPTIONS,
  DISCIPLINE_OPTIONS,
  WEAK_SLOT_OPTIONS,
  BINGE_TRIGGER_OPTIONS,
} from '@/features/onboarding/lib/onboarding-constants';
import { TagCloud } from '@/features/onboarding/components/shared/tag-cloud';
import { AllergenSelector } from '@/features/onboarding/components/shared/allergen-selector';

function toggleArr(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

export function ProfileEditForm() {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const { profile, updateProfile, isUpdating } = useProfile();
  const { toast } = useToast();

  const [form, setForm] = useState({
    gender: 'male',
    birthYear: '',
    heightCm: '',
    weightKg: '',
    targetWeightKg: '',
    activityLevel: 'light',
    dailyCalorieGoal: '',
    goal: 'health' as string,
    goalSpeed: 'steady' as string,
    mealsPerDay: 3,
    takeoutFrequency: 'sometimes' as string,
    canCook: true,
    foodPreferences: [] as string[],
    dietaryRestrictions: [] as string[],
    allergens: [] as string[],
    weakTimeSlots: [] as string[],
    bingeTriggers: [] as string[],
    discipline: 'medium' as string,
  });

  useEffect(() => {
    if (!isLoggedIn) {
      router.push('/login');
      return;
    }
    if (profile) {
      setForm({
        gender: profile.gender || 'male',
        birthYear: profile.birthYear ? String(profile.birthYear) : '',
        heightCm: profile.heightCm ? String(profile.heightCm) : '',
        weightKg: profile.weightKg ? String(profile.weightKg) : '',
        targetWeightKg: profile.targetWeightKg ? String(profile.targetWeightKg) : '',
        activityLevel: profile.activityLevel || 'light',
        dailyCalorieGoal: profile.dailyCalorieGoal ? String(profile.dailyCalorieGoal) : '',
        goal: profile.goal || 'health',
        goalSpeed: profile.goalSpeed || 'steady',
        mealsPerDay: profile.mealsPerDay || 3,
        takeoutFrequency: profile.takeoutFrequency || 'sometimes',
        canCook: profile.canCook !== undefined ? profile.canCook : true,
        foodPreferences: profile.foodPreferences || [],
        dietaryRestrictions: profile.dietaryRestrictions || [],
        allergens: profile.allergens || [],
        weakTimeSlots: profile.weakTimeSlots || [],
        bingeTriggers: profile.bingeTriggers || [],
        discipline: profile.discipline || 'medium',
      });
    }
  }, [isLoggedIn, profile, router]);

  const up = useCallback(<K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.heightCm || !form.weightKg || !form.birthYear) {
      toast({ title: '请填写身高、体重和出生年份', variant: 'destructive' });
      return;
    }
    try {
      const data: Partial<UserProfile> = {
        gender: form.gender,
        activityLevel: form.activityLevel,
        goal: form.goal as UserProfile['goal'],
        goalSpeed: form.goalSpeed as UserProfile['goalSpeed'],
        mealsPerDay: form.mealsPerDay,
        takeoutFrequency: form.takeoutFrequency as UserProfile['takeoutFrequency'],
        canCook: form.canCook,
        foodPreferences: form.foodPreferences,
        dietaryRestrictions: form.dietaryRestrictions,
        allergens: form.allergens,
        weakTimeSlots: form.weakTimeSlots,
        bingeTriggers: form.bingeTriggers,
        discipline: form.discipline as UserProfile['discipline'],
      };
      if (form.birthYear) data.birthYear = parseInt(form.birthYear);
      if (form.heightCm) data.heightCm = parseFloat(form.heightCm);
      if (form.weightKg) data.weightKg = parseFloat(form.weightKg);
      if (form.targetWeightKg) data.targetWeightKg = parseFloat(form.targetWeightKg);
      if (form.dailyCalorieGoal) data.dailyCalorieGoal = parseInt(form.dailyCalorieGoal);

      await updateProfile(data);
      toast({ title: '保存成功' });
      router.back();
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : '保存失败', variant: 'destructive' });
    }
  }, [form, updateProfile, toast, router]);

  const SectionTitle = ({ children }: { children: React.ReactNode }) => (
    <p className="text-sm font-extrabold text-foreground mt-6 mb-3 first:mt-0">{children}</p>
  );

  const SubLabel = ({ children }: { children: React.ReactNode }) => (
    <p className="text-xs font-semibold text-muted-foreground mb-2">{children}</p>
  );

  const Divider = () => <div className="border-t border-border/40 my-5" />;

  const BtnGroup = ({
    options,
    value,
    onChange,
  }: {
    options: ReadonlyArray<{ key: string; label: string }>;
    value: string;
    onChange: (k: string) => void;
  }) => (
    <div className="flex gap-2">
      {options.map(({ key, label }) => (
        <button
          key={key}
          type="button"
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
          <button
            onClick={() => router.back()}
            className="mr-4 text-foreground/70 hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </button>
          <h1 className="text-xl font-extrabold font-headline tracking-tight">编辑档案</h1>
        </div>
      </nav>

      <main className="px-6 py-6 max-w-lg mx-auto pb-32">
        <div className="bg-card rounded-2xl p-6 mb-5">
          {/* 基本信息 */}
          <SectionTitle>基本信息</SectionTitle>

          <SubLabel>性别</SubLabel>
          <BtnGroup
            options={[
              { key: 'male', label: '男' },
              { key: 'female', label: '女' },
            ]}
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
            {ACTIVITY_LEVEL_OPTIONS.map(({ key, label, icon, desc }) => (
              <button
                key={key}
                type="button"
                onClick={() => up('activityLevel', key)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-medium transition-all ${
                  form.activityLevel === key
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <span>{icon}</span>
                <div>
                  <span className="font-bold">{label}</span>
                  <p
                    className={`text-[11px] ${form.activityLevel === key ? 'text-primary-foreground/80' : 'text-muted-foreground/70'}`}
                  >
                    {desc}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <Divider />

          {/* 目标 */}
          <SectionTitle>🎯 你的目标</SectionTitle>

          <SubLabel>主要目标</SubLabel>
          <div className="grid grid-cols-2 gap-2">
            {GOAL_OPTIONS.map(({ key, label, emoji, desc }) => (
              <button
                key={key}
                type="button"
                onClick={() => up('goal', key)}
                className={`py-3 px-3 rounded-xl text-sm font-bold transition-all text-left ${
                  form.goal === key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <span className="text-base">
                  {emoji} {label}
                </span>
                <p
                  className={`text-[11px] mt-0.5 font-normal ${form.goal === key ? 'opacity-80' : 'opacity-60'}`}
                >
                  {desc}
                </p>
              </button>
            ))}
          </div>

          <div className="mt-4">
            <SubLabel>目标速度</SubLabel>
            <BtnGroup
              options={[
                { key: 'aggressive', label: '激进' },
                { key: 'steady', label: '稳定' },
                { key: 'relaxed', label: '佛系' },
              ]}
              value={form.goalSpeed}
              onChange={(k) => up('goalSpeed', k)}
            />
          </div>

          <Divider />

          {/* 饮食习惯 */}
          <SectionTitle>🥗 饮食习惯</SectionTitle>

          <SubLabel>一天几餐</SubLabel>
          <div className="flex gap-2">
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
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
              options={TAKEOUT_OPTIONS}
              value={form.takeoutFrequency}
              onChange={(k) => up('takeoutFrequency', k)}
            />
          </div>

          <div className="mt-4">
            <SubLabel>是否会做饭</SubLabel>
            <BtnGroup
              options={[
                { key: 'yes', label: '会做饭' },
                { key: 'no', label: '不会' },
              ]}
              value={form.canCook ? 'yes' : 'no'}
              onChange={(k) => up('canCook', k === 'yes')}
            />
          </div>

          <Divider />

          {/* 过敏原 */}
          <AllergenSelector
            selected={form.allergens}
            onChange={(allergens) => up('allergens', allergens)}
          />

          <Divider />

          {/* 忌口 */}
          <div>
            <SubLabel>忌口（可多选）</SubLabel>
            <TagCloud
              options={DIETARY_RESTRICTION_OPTIONS}
              selected={form.dietaryRestrictions}
              onChange={(v) => up('dietaryRestrictions', v)}
            />
          </div>

          <div className="mt-4">
            <SubLabel>饮食偏好（可多选）</SubLabel>
            <TagCloud
              options={FOOD_PREFERENCE_OPTIONS}
              selected={form.foodPreferences}
              onChange={(v) => up('foodPreferences', v)}
            />
          </div>

          <Divider />

          {/* 行为习惯 */}
          <SectionTitle>🧠 行为习惯</SectionTitle>

          <SubLabel>饮食执行力</SubLabel>
          <div className="space-y-2">
            {DISCIPLINE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => up('discipline', key)}
                className={`w-full px-4 py-3 rounded-xl text-left text-sm font-medium transition-all ${
                  form.discipline === key
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4">
            <SubLabel>容易乱吃时段（可多选）</SubLabel>
            <TagCloud
              options={WEAK_SLOT_OPTIONS}
              selected={form.weakTimeSlots}
              onChange={(v) => up('weakTimeSlots', v)}
            />
          </div>

          <div className="mt-4">
            <SubLabel>容易多吃的情况（可多选）</SubLabel>
            <TagCloud
              options={BINGE_TRIGGER_OPTIONS}
              selected={form.bingeTriggers}
              onChange={(v) => up('bingeTriggers', v)}
            />
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

          <button
            onClick={handleSave}
            disabled={isUpdating}
            className="w-full mt-6 bg-primary text-primary-foreground font-bold py-4 rounded-full active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            {isUpdating ? '保存中...' : '保存档案'}
          </button>
        </div>
      </main>
    </div>
  );
}
