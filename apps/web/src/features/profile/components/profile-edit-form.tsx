'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
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
  HEALTH_CONDITION_OPTIONS,
  CUISINE_OPTIONS,
  COOKING_SKILL_OPTIONS,
} from '@/features/onboarding/lib/onboarding-constants';
import { TagCloud } from '@/features/onboarding/components/shared/tag-cloud';
import { AllergenSelector } from '@/features/onboarding/components/shared/allergen-selector';

type TabKey = 'basic' | 'diet' | 'behavior' | 'health';

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'basic', label: '基本体征', icon: '📏' },
  { key: 'diet', label: '饮食习惯', icon: '🥗' },
  { key: 'behavior', label: '行为偏好', icon: '🧠' },
  { key: 'health', label: '健康状况', icon: '❤️' },
];

function toggleArr(arr: string[], val: string): string[] {
  return arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val];
}

export function ProfileEditForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoggedIn } = useAuth();
  const { profile, updateProfile, isUpdating } = useProfile();
  const { toast } = useToast();

  const VALID_TABS: TabKey[] = ['basic', 'diet', 'behavior', 'health'];
  const initialTab = (searchParams.get('tab') as TabKey | null);
  const [activeTab, setActiveTab] = useState<TabKey>(
    initialTab && VALID_TABS.includes(initialTab) ? initialTab : 'basic',
  );

  const [form, setForm] = useState({
    // 基本体征
    gender: 'male',
    birthYear: '',
    heightCm: '',
    weightKg: '',
    targetWeightKg: '',
    activityLevel: 'light',
    dailyCalorieGoal: '',
    goal: 'health' as string,
    goalSpeed: 'steady' as string,
    // 饮食习惯
    mealsPerDay: 3,
    takeoutFrequency: 'sometimes' as string,
    canCook: true,
    cookingSkillLevel: 'basic' as string,
    foodPreferences: [] as string[],
    cuisinePreferences: [] as string[],
    dietaryRestrictions: [] as string[],
    allergens: [] as string[],
    // 行为偏好
    weakTimeSlots: [] as string[],
    bingeTriggers: [] as string[],
    discipline: 'medium' as string,
    // 健康状况
    healthConditions: [] as string[],
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
        cookingSkillLevel: profile.cookingSkillLevel || 'basic',
        foodPreferences: profile.foodPreferences || [],
        cuisinePreferences: profile.cuisinePreferences || [],
        dietaryRestrictions: profile.dietaryRestrictions || [],
        allergens: profile.allergens || [],
        weakTimeSlots: profile.weakTimeSlots || [],
        bingeTriggers: profile.bingeTriggers || [],
        discipline: profile.discipline || 'medium',
        healthConditions: profile.healthConditions || [],
      });
    }
  }, [isLoggedIn, profile, router]);

  const up = useCallback(<K extends keyof typeof form>(key: K, value: (typeof form)[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.heightCm || !form.weightKg || !form.birthYear) {
      toast({ title: '请填写身高、体重和出生年份', variant: 'destructive' });
      setActiveTab('basic');
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
        cookingSkillLevel: form.cookingSkillLevel as UserProfile['cookingSkillLevel'],
        foodPreferences: form.foodPreferences,
        cuisinePreferences: form.cuisinePreferences,
        dietaryRestrictions: form.dietaryRestrictions,
        allergens: form.allergens,
        weakTimeSlots: form.weakTimeSlots,
        bingeTriggers: form.bingeTriggers,
        discipline: form.discipline as UserProfile['discipline'],
        healthConditions: form.healthConditions,
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

  // ── Shared UI primitives ──

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

  // ── Tab panels ──

  const BasicTab = () => (
    <>
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

      <SubLabel>活动等级</SubLabel>
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

      <div className="mt-4">
        <SubLabel>每日热量目标 (kcal，留空自动计算)</SubLabel>
        <input
          type="number"
          value={form.dailyCalorieGoal}
          onChange={(e) => up('dailyCalorieGoal', e.target.value)}
          placeholder="自动计算"
          className="w-full px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
    </>
  );

  const DietTab = () => (
    <>
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

      {form.canCook && (
        <div className="mt-4">
          <SubLabel>烹饪水平</SubLabel>
          <div className="space-y-2">
            {COOKING_SKILL_OPTIONS.map(({ key, label, desc }) => (
              <button
                key={key}
                type="button"
                onClick={() => up('cookingSkillLevel', key)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl text-left text-sm font-medium transition-all ${
                  form.cookingSkillLevel === key
                    ? 'bg-primary text-primary-foreground font-bold'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <span className="font-bold">{label}</span>
                <span
                  className={`text-[11px] ${form.cookingSkillLevel === key ? 'text-primary-foreground/80' : 'text-muted-foreground/70'}`}
                >
                  {desc}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <Divider />

      <SubLabel>菜系偏好（可多选）</SubLabel>
      <div className="grid grid-cols-3 gap-2">
        {CUISINE_OPTIONS.map(({ key, label, icon }) => {
          const selected = form.cuisinePreferences.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => up('cuisinePreferences', toggleArr(form.cuisinePreferences, key))}
              className={`flex flex-col items-center py-3 rounded-xl text-xs font-bold transition-all gap-1 ${
                selected ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              <span className="text-xl">{icon}</span>
              {label}
            </button>
          );
        })}
      </div>

      <Divider />

      <AllergenSelector
        selected={form.allergens}
        onChange={(allergens) => up('allergens', allergens)}
      />

      <Divider />

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
    </>
  );

  const BehaviorTab = () => (
    <>
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
    </>
  );

  const HealthTab = () => (
    <>
      <div className="mb-4 px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/20">
        <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
          ⚠️ 健康状况用于过滤不适合你的食物，直接影响推荐安全性。请如实填写。
        </p>
      </div>

      <SubLabel>已有健康状况（可多选，无则留空）</SubLabel>
      <div className="grid grid-cols-2 gap-2">
        {HEALTH_CONDITION_OPTIONS.map(({ key, label, icon }) => {
          const selected = form.healthConditions.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => up('healthConditions', toggleArr(form.healthConditions, key))}
              className={`flex items-center gap-2 px-3 py-3 rounded-xl text-sm font-medium transition-all text-left ${
                selected
                  ? 'bg-primary text-primary-foreground font-bold'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              <span className="text-base">{icon}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {form.healthConditions.length === 0 && (
        <div className="mt-4 px-4 py-3 rounded-xl bg-muted/60 text-center">
          <p className="text-xs text-muted-foreground">未选择任何健康状况 — 视为无特殊限制</p>
        </div>
      )}
    </>
  );

  const tabContent: Record<TabKey, React.ReactNode> = {
    basic: <BasicTab />,
    diet: <DietTab />,
    behavior: <BehaviorTab />,
    health: <HealthTab />,
  };

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

        {/* Tab bar */}
        <div className="flex border-t border-border/30 max-w-lg mx-auto">
          {TABS.map(({ key, label, icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveTab(key)}
              className={`flex-1 flex flex-col items-center py-2 text-[11px] font-bold transition-all gap-0.5 ${
                activeTab === key
                  ? 'text-primary border-b-2 border-primary'
                  : 'text-muted-foreground border-b-2 border-transparent'
              }`}
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </button>
          ))}
        </div>
      </nav>

      <main className="px-6 py-6 max-w-lg mx-auto pb-32">
        <div className="bg-card rounded-2xl p-6 mb-5">{tabContent[activeTab]}</div>
      </main>

      {/* Floating save button */}
      <div className="fixed bottom-0 left-0 right-0 z-40 pb-safe">
        <div className="max-w-lg mx-auto px-6 pb-6">
          <button
            onClick={handleSave}
            disabled={isUpdating}
            className="w-full bg-primary text-primary-foreground font-bold py-4 rounded-full active:scale-[0.98] transition-all shadow-lg shadow-primary/20 disabled:opacity-50"
          >
            {isUpdating ? '保存中...' : '保存档案'}
          </button>
        </div>
      </div>
    </div>
  );
}
