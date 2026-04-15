'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileService } from '@/lib/api/profile';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useToast } from '@/lib/hooks/use-toast';
import type {
  RecommendationPreferences,
  UpdateRecommendationPreferencesDto,
  UserProfile,
  KitchenProfile,
} from '@/types/user';

// ── Types ──
type SectionKey = 'recommendation' | 'kitchen' | 'lifestyle';

const SECTIONS: { key: SectionKey; label: string; icon: string; desc: string }[] = [
  { key: 'recommendation', label: '推荐偏好', icon: '🎛️', desc: '控制 AI 的推荐风格' },
  { key: 'kitchen', label: '厨房装备', icon: '🍳', desc: '告诉 AI 你能做什么' },
  { key: 'lifestyle', label: '生活方式', icon: '🌱', desc: '精调健康推荐权重' },
];

// ── Recommendation preference options ──
const POPULARITY_OPTS = [
  { value: 'popular', label: '大众', desc: '推荐常见食物' },
  { value: 'balanced', label: '均衡', desc: '兼顾熟悉与新奇' },
  { value: 'adventurous', label: '尝新', desc: '乐于探索新食物' },
] as const;

const COOKING_OPTS = [
  { value: 'quick', label: '快手', desc: '15 分钟内' },
  { value: 'moderate', label: '适中', desc: '30 分钟左右' },
  { value: 'elaborate', label: '精心', desc: '不怕麻烦' },
] as const;

const BUDGET_OPTS = [
  { value: 'budget', label: '省钱', desc: '控制每餐成本' },
  { value: 'moderate', label: '适中', desc: '性价比优先' },
  { value: 'unlimited', label: '不限', desc: '品质优先' },
] as const;

const DIVERSITY_OPTS = [
  { value: 'low', label: '稳定', desc: '重复也没关系' },
  { value: 'medium', label: '适度', desc: '偶尔尝新' },
  { value: 'high', label: '多变', desc: '每天都不同' },
] as const;

const PHILOSOPHY_OPTS = [
  { value: 'omnivore', label: '杂食' },
  { value: 'pescatarian', label: '鱼素' },
  { value: 'vegetarian', label: '素食' },
  { value: 'vegan', label: '纯素' },
  { value: 'none', label: '不限' },
] as const;

const MEAL_PATTERN_OPTS = [
  { value: 'frequent_small', label: '少食多餐', desc: '每天 4-6 次小份' },
  { value: 'standard_three', label: '一日三餐', desc: '标准三餐规律' },
  { value: 'intermittent_fasting', label: '间歇禁食', desc: '16:8 等方案' },
] as const;

const FLAVOR_OPTS = [
  { value: 'conservative', label: '保守', desc: '熟悉的口味' },
  { value: 'moderate', label: '适中', desc: '偶尔尝试' },
  { value: 'adventurous', label: '探索', desc: '热爱新奇口味' },
] as const;

const REALISM_OPTS = [
  { value: 'strict', label: '严格', desc: '必须精准可执行' },
  { value: 'normal', label: '正常', desc: '允许偶尔偏差' },
  { value: 'relaxed', label: '宽松', desc: '仅提供大方向' },
  { value: 'off', label: '关闭', desc: '不做限制' },
] as const;

// ── Kitchen ──
const APPLIANCES: {
  key: keyof Omit<KitchenProfile, 'primaryStove'>;
  label: string;
  icon: string;
}[] = [
  { key: 'hasMicrowave', label: '微波炉', icon: '📡' },
  { key: 'hasRiceCooker', label: '电饭煲', icon: '🍚' },
  { key: 'hasSteamer', label: '蒸锅', icon: '🫧' },
  { key: 'hasAirFryer', label: '空气炸锅', icon: '🌪️' },
  { key: 'hasOven', label: '烤箱', icon: '🔥' },
];
const STOVE_OPTS = [
  { value: 'gas' as const, label: '燃气灶' },
  { value: 'induction' as const, label: '电磁炉' },
  { value: 'none' as const, label: '无灶具' },
];

// ── Lifestyle ──
const SLEEP_OPTS = [
  { value: 'poor' as const, label: '差', desc: '经常失眠' },
  { value: 'fair' as const, label: '一般', desc: '偶尔不好' },
  { value: 'good' as const, label: '好', desc: '规律质量高' },
];
const STRESS_OPTS = [
  { value: 'low' as const, label: '低', desc: '生活轻松' },
  { value: 'medium' as const, label: '中', desc: '日常压力' },
  { value: 'high' as const, label: '高', desc: '长期高压' },
];
const TIMING_OPTS = [
  { value: 'early_bird' as const, label: '早食', desc: '早餐 7 点前' },
  { value: 'standard' as const, label: '标准', desc: '三餐规律' },
  { value: 'late_eater' as const, label: '晚食', desc: '习惯晚吃' },
];

// ── Shared primitive ──
function Seg<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  options: ReadonlyArray<{ value: T; label: string; desc?: string }>;
  value: T | undefined;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const sel = options.find((o) => o.value === value);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-sm font-bold text-foreground">{label}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </div>
      <div className="flex bg-muted rounded-xl p-1 gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            disabled={disabled}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all ${
              value === o.value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            } disabled:opacity-50`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {sel?.desc && <p className="text-[11px] text-muted-foreground mt-1.5">{sel.desc}</p>}
    </div>
  );
}

function SectionCard({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-2xl p-5 space-y-5">
      <div className="flex items-center gap-2 pb-1 border-b border-border/30">
        <span className="text-lg">{icon}</span>
        <h2 className="text-sm font-extrabold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest -mb-2">
      {children}
    </p>
  );
}

export default function PreferencesPage() {
  const router = useRouter();
  const { isLoggedIn } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [activeSection, setActiveSection] = useState<SectionKey>('recommendation');

  useEffect(() => {
    if (!isLoggedIn) router.push('/login');
  }, [isLoggedIn, router]);

  // ── Recommendation preferences ──
  const { data: prefs, isLoading: prefsLoading } = useQuery({
    queryKey: ['profile', 'recommendation-preferences'],
    queryFn: () => profileService.getRecommendationPreferences(),
    enabled: isLoggedIn,
    staleTime: 10 * 60 * 1000,
  });

  const [localPrefs, setLocalPrefs] = useState<Partial<RecommendationPreferences>>({});
  const [prefsInit, setPrefsInit] = useState(false);
  if (prefs && !prefsInit) {
    setLocalPrefs(prefs);
    setPrefsInit(true);
  }

  const prefsMutation = useMutation({
    mutationFn: (data: UpdateRecommendationPreferencesDto) =>
      profileService.updateRecommendationPreferences(data),
    onSuccess: (updated) => {
      setLocalPrefs(updated);
      queryClient.invalidateQueries({ queryKey: ['profile', 'recommendation-preferences'] });
      toast({ title: '偏好已保存' });
    },
    onError: () => toast({ title: '保存失败', variant: 'destructive' }),
  });

  const savePrefs = useCallback(
    <K extends keyof UpdateRecommendationPreferencesDto>(
      key: K,
      value: UpdateRecommendationPreferencesDto[K]
    ) => {
      setLocalPrefs((p) => ({ ...p, [key]: value }));
      prefsMutation.mutate({ [key]: value } as UpdateRecommendationPreferencesDto);
    },
    [prefsMutation]
  );

  // ── Profile (kitchen + lifestyle) ──
  const { data: profileFull, isLoading: profileLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => profileService.getProfile(),
    enabled: isLoggedIn,
    staleTime: 5 * 60 * 1000,
  });

  const defaultKitchen: KitchenProfile = {
    hasOven: false,
    hasMicrowave: true,
    hasAirFryer: false,
    hasRiceCooker: true,
    hasSteamer: true,
    primaryStove: 'gas',
  };
  const [kitchen, setKitchen] = useState<KitchenProfile>(defaultKitchen);
  const [lifestyle, setLifestyle] = useState<{
    sleepQuality: UserProfile['sleepQuality'];
    stressLevel: UserProfile['stressLevel'];
    hydrationGoal: number | undefined;
    mealTimingPreference: UserProfile['mealTimingPreference'];
  }>({ sleepQuality: undefined, stressLevel: undefined, hydrationGoal: undefined, mealTimingPreference: undefined });
  const [profileInit, setProfileInit] = useState(false);
  const [hydrationInput, setHydrationInput] = useState('');

  if (profileFull && !profileInit) {
    const k = (profileFull as UserProfile)?.kitchenProfile ?? defaultKitchen;
    setKitchen(k as KitchenProfile);
    setLifestyle({
      sleepQuality: (profileFull as UserProfile)?.sleepQuality,
      stressLevel: (profileFull as UserProfile)?.stressLevel,
      hydrationGoal: (profileFull as UserProfile)?.hydrationGoal,
      mealTimingPreference: (profileFull as UserProfile)?.mealTimingPreference,
    });
    setHydrationInput(
      (profileFull as UserProfile)?.hydrationGoal
        ? String((profileFull as UserProfile).hydrationGoal)
        : ''
    );
    setProfileInit(true);
  }

  const profileMutation = useMutation({
    mutationFn: (data: Partial<UserProfile>) => profileService.updateDeclaredProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      toast({ title: '设置已保存' });
    },
    onError: () => toast({ title: '保存失败', variant: 'destructive' }),
  });

  const saveKitchen = useCallback(
    (updated: KitchenProfile) => {
      setKitchen(updated);
      profileMutation.mutate({ kitchenProfile: updated });
    },
    [profileMutation]
  );

  const saveLifestyle = useCallback(
    <K extends keyof typeof lifestyle>(key: K, value: (typeof lifestyle)[K]) => {
      setLifestyle((p) => ({ ...p, [key]: value }));
      profileMutation.mutate({ [key]: value } as Partial<UserProfile>);
    },
    [profileMutation]
  );

  const saveHydration = useCallback(() => {
    const val = parseInt(hydrationInput);
    if (isNaN(val) || val < 500 || val > 5000) {
      toast({ title: '饮水目标应在 500-5000ml 之间', variant: 'destructive' });
      return;
    }
    saveLifestyle('hydrationGoal', val);
  }, [hydrationInput, saveLifestyle, toast]);

  const isLoading = prefsLoading || profileLoading;
  const isSaving = prefsMutation.isPending || profileMutation.isPending;

  // ── Render sections ──
  const renderRecommendation = () => (
    <SectionCard title="推荐偏好" icon="🎛️">
      <GroupLabel>基础设置</GroupLabel>
      <Seg
        label="热度偏好"
        hint="影响食物常见度"
        options={POPULARITY_OPTS}
        value={localPrefs.popularityPreference}
        onChange={(v) => savePrefs('popularityPreference', v)}
        disabled={isSaving}
      />
      <Seg
        label="烹饪投入"
        hint="影响推荐菜谱复杂度"
        options={COOKING_OPTS}
        value={localPrefs.cookingEffort}
        onChange={(v) => savePrefs('cookingEffort', v)}
        disabled={isSaving}
      />
      <Seg
        label="预算敏感度"
        options={BUDGET_OPTS}
        value={localPrefs.budgetSensitivity}
        onChange={(v) => savePrefs('budgetSensitivity', v)}
        disabled={isSaving}
      />

      <div className="border-t border-border/30 pt-1" />
      <GroupLabel>饮食哲学</GroupLabel>

      <div>
        <p className="text-sm font-bold text-foreground mb-2">饮食理念</p>
        <div className="flex flex-wrap gap-2">
          {PHILOSOPHY_OPTS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => savePrefs('dietaryPhilosophy', value)}
              disabled={isSaving}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                localPrefs.dietaryPhilosophy === value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              } disabled:opacity-50`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <Seg
        label="用餐模式"
        hint="影响热量分配方式"
        options={MEAL_PATTERN_OPTS}
        value={localPrefs.mealPattern}
        onChange={(v) => savePrefs('mealPattern', v)}
        disabled={isSaving}
      />

      <div className="border-t border-border/30 pt-1" />
      <GroupLabel>口味 & 多样性</GroupLabel>

      <Seg
        label="口味探索度"
        options={FLAVOR_OPTS}
        value={localPrefs.flavorOpenness}
        onChange={(v) => savePrefs('flavorOpenness', v)}
        disabled={isSaving}
      />
      <Seg
        label="菜单多样性"
        hint="每周重复程度"
        options={DIVERSITY_OPTS}
        value={localPrefs.diversityTolerance}
        onChange={(v) => savePrefs('diversityTolerance', v)}
        disabled={isSaving}
      />

      <div className="border-t border-border/30 pt-1" />
      <GroupLabel>计划执行</GroupLabel>

      <Seg
        label="可行性要求"
        hint="推荐方案的执行严格度"
        options={REALISM_OPTS}
        value={localPrefs.realismLevel}
        onChange={(v) => savePrefs('realismLevel', v)}
        disabled={isSaving}
      />
    </SectionCard>
  );

  const renderKitchen = () => (
    <SectionCard title="厨房装备" icon="🍳">
      <div className="px-3 py-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20">
        <p className="text-xs text-blue-600 dark:text-blue-400">
          告诉 AI 你有哪些厨房设备，可以更精准推荐适合你的菜谱
        </p>
      </div>

      <div>
        <p className="text-sm font-bold text-foreground mb-2">灶具类型</p>
        <div className="flex gap-2">
          {STOVE_OPTS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => saveKitchen({ ...kitchen, primaryStove: value })}
              disabled={isSaving}
              className={`flex-1 py-2.5 rounded-xl text-xs font-bold transition-all ${
                kitchen.primaryStove === value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              } disabled:opacity-50`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-sm font-bold text-foreground mb-2">已有家电</p>
        <div className="grid grid-cols-3 gap-2">
          {APPLIANCES.map(({ key, label, icon }) => {
            const has = kitchen[key];
            return (
              <button
                key={key}
                type="button"
                onClick={() => saveKitchen({ ...kitchen, [key]: !has })}
                disabled={isSaving}
                className={`flex flex-col items-center py-4 rounded-xl text-xs font-bold gap-1.5 transition-all ${
                  has
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground/50'
                } disabled:opacity-30`}
              >
                <span className="text-2xl">{icon}</span>
                <span>{label}</span>
                <span className={`text-[10px] font-normal ${has ? 'opacity-80' : 'opacity-60'}`}>
                  {has ? '✓ 有' : '没有'}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </SectionCard>
  );

  const renderLifestyle = () => (
    <SectionCard title="生活方式" icon="🌱">
      <div className="px-3 py-2.5 rounded-xl bg-green-500/10 border border-green-500/20">
        <p className="text-xs text-green-700 dark:text-green-400">
          生活方式数据帮助 AI 精调推荐权重，例如高压时期推荐更多舒压食物
        </p>
      </div>

      <Seg
        label="睡眠质量"
        options={SLEEP_OPTS}
        value={lifestyle.sleepQuality}
        onChange={(v) => saveLifestyle('sleepQuality', v)}
        disabled={isSaving}
      />
      <Seg
        label="日常压力"
        options={STRESS_OPTS}
        value={lifestyle.stressLevel}
        onChange={(v) => saveLifestyle('stressLevel', v)}
        disabled={isSaving}
      />
      <Seg
        label="用餐时间偏好"
        options={TIMING_OPTS}
        value={lifestyle.mealTimingPreference}
        onChange={(v) => saveLifestyle('mealTimingPreference', v)}
        disabled={isSaving}
      />

      <div>
        <p className="text-sm font-bold text-foreground mb-2">每日饮水目标 (ml)</p>
        <div className="flex gap-2">
          <input
            type="number"
            value={hydrationInput}
            onChange={(e) => setHydrationInput(e.target.value)}
            onBlur={saveHydration}
            placeholder="例如 2000"
            min={500}
            max={5000}
            className="flex-1 px-4 py-2.5 rounded-xl bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            type="button"
            onClick={saveHydration}
            disabled={isSaving}
            className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50"
          >
            保存
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">推荐 1500-3000ml</p>
      </div>
    </SectionCard>
  );

  const sectionContent: Record<SectionKey, React.ReactNode> = {
    recommendation: renderRecommendation(),
    kitchen: renderKitchen(),
    lifestyle: renderLifestyle(),
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <nav className="sticky top-0 z-50 glass-morphism">
        <div className="flex items-center px-5 py-4 max-w-lg mx-auto">
          <button
            type="button"
            onClick={() => router.back()}
            className="mr-4 text-foreground/70 hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
              <path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" />
            </svg>
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-extrabold tracking-tight">偏好设置</h1>
            <p className="text-[11px] text-muted-foreground">影响推荐系统的行为</p>
          </div>
          {isSaving && (
            <span className="text-[11px] text-muted-foreground animate-pulse">保存中...</span>
          )}
        </div>

        {/* Section tabs */}
        <div className="flex border-t border-border/30 max-w-lg mx-auto">
          {SECTIONS.map(({ key, label, icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveSection(key)}
              className={`flex-1 flex flex-col items-center py-2.5 text-[11px] font-bold transition-all gap-0.5 ${
                activeSection === key
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

      <main className="px-5 py-5 max-w-lg mx-auto pb-24">
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-14 bg-muted rounded-2xl animate-pulse" />
            ))}
          </div>
        ) : (
          sectionContent[activeSection]
        )}
      </main>
    </div>
  );
}
