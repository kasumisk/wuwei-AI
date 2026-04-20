'use client';

import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileService } from '@/lib/api/profile';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useToast } from '@/lib/hooks/use-toast';
import type {
  PopularityPreference,
  CookingEffort,
  BudgetSensitivity,
  RecommendationPreferences,
} from '@/types/user';

/**
 * 推荐偏好设置卡片（全 8 字段）
 * 调用 GET/PUT /api/app/user-profile/recommendation-preferences
 */

type DiversityTolerance = 'low' | 'medium' | 'high';
type MealPattern = 'frequent_small' | 'standard_three' | 'intermittent_fasting';
type FlavorOpenness = 'conservative' | 'moderate' | 'adventurous';
type RealismLevel = 'strict' | 'normal' | 'relaxed' | 'off';

const POPULARITY_OPTIONS: { value: PopularityPreference; label: string; desc: string }[] = [
  { value: 'popular', label: '大众', desc: '优先推荐大众熟知的食物' },
  { value: 'balanced', label: '均衡', desc: '兼顾大众与新奇' },
  { value: 'adventurous', label: '尝新', desc: '乐于尝试新食物新搭配' },
];

const COOKING_OPTIONS: { value: CookingEffort; label: string; desc: string }[] = [
  { value: 'quick', label: '快手', desc: '15 分钟内可完成' },
  { value: 'moderate', label: '适中', desc: '30 分钟左右' },
  { value: 'elaborate', label: '精心', desc: '不怕麻烦，追求品质' },
];

const BUDGET_OPTIONS: { value: BudgetSensitivity; label: string; desc: string }[] = [
  { value: 'budget', label: '节省', desc: '控制每餐成本' },
  { value: 'moderate', label: '适中', desc: '性价比优先' },
  { value: 'unlimited', label: '不限', desc: '品质优先，不限预算' },
];

const DIVERSITY_OPTIONS: { value: DiversityTolerance; label: string; desc: string }[] = [
  { value: 'low', label: '稳定', desc: '每周重复同样菜品也没关系' },
  { value: 'medium', label: '适度', desc: '偶尔尝新，保持一定规律' },
  { value: 'high', label: '多变', desc: '每天都想吃不同的东西' },
];

const MEAL_PATTERN_OPTIONS: { value: MealPattern; label: string; desc: string }[] = [
  { value: 'frequent_small', label: '少食多餐', desc: '每天 4-6 次小份进食' },
  { value: 'standard_three', label: '一日三餐', desc: '标准三餐规律进食' },
  { value: 'intermittent_fasting', label: '间歇性禁食', desc: '16:8 或 18:6 等禁食方案' },
];

const FLAVOR_OPTIONS: { value: FlavorOpenness; label: string; desc: string }[] = [
  { value: 'conservative', label: '保守', desc: '只吃熟悉的口味' },
  { value: 'moderate', label: '适中', desc: '偶尔尝试新口味' },
  { value: 'adventurous', label: '探索', desc: '热爱挑战各种新奇口味' },
];

const REALISM_OPTIONS: { value: RealismLevel; label: string; desc: string }[] = [
  { value: 'strict', label: '严格', desc: '方案必须精准可执行' },
  { value: 'normal', label: '正常', desc: '允许偶尔偏差' },
  { value: 'relaxed', label: '宽松', desc: '仅提供大方向' },
  { value: 'off', label: '关闭', desc: '不做可行性限制' },
];

interface SegmentPickerProps<T extends string> {
  label: string;
  options: { value: T; label: string; desc?: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
  disabled?: boolean;
}

function SegmentPicker<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: SegmentPickerProps<T>) {
  const selectedIndex = options.findIndex((o) => o.value === value);
  const selectedDesc = selectedIndex >= 0 ? options[selectedIndex].desc : '';

  return (
    <div className="space-y-2">
      <p className="text-xs font-bold text-foreground">{label}</p>
      <div className="flex bg-muted  p-1 gap-1">
        {options.map((o) => (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            disabled={disabled}
            className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all active:scale-[0.97] ${
              value === o.value
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            } disabled:opacity-50`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {selectedDesc && <p className="text-[11px] text-muted-foreground">{selectedDesc}</p>}
    </div>
  );
}

type LocalPrefs = {
  popularity: PopularityPreference | undefined;
  cooking: CookingEffort | undefined;
  budget: BudgetSensitivity | undefined;
  diversity: DiversityTolerance | undefined;
  mealPattern: MealPattern | undefined;
  flavor: FlavorOpenness | undefined;
  realism: RealismLevel | undefined;
};

function toLocalPrefs(prefs: RecommendationPreferences | undefined): Partial<LocalPrefs> {
  if (!prefs) return {};
  return {
    popularity: prefs.popularityPreference,
    cooking: prefs.cookingEffort,
    budget: prefs.budgetSensitivity,
    diversity: prefs.diversityTolerance as DiversityTolerance | undefined,
    mealPattern: prefs.mealPattern as MealPattern | undefined,
    flavor: prefs.flavorOpenness as FlavorOpenness | undefined,
    realism: prefs.realismLevel as RealismLevel | undefined,
  };
}

export function RecommendationPreferences() {
  const { isLoggedIn } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: prefs, isLoading } = useQuery({
    queryKey: ['profile', 'recommendation-preferences'],
    queryFn: () => profileService.getRecommendationPreferences(),
    enabled: isLoggedIn,
    staleTime: 10 * 60 * 1000,
  });

  const [local, setLocal] = useState<Partial<LocalPrefs>>({});
  const [initialized, setInitialized] = useState(false);

  if (prefs && !initialized) {
    setLocal(toLocalPrefs(prefs));
    setInitialized(true);
  }

  const updateMutation = useMutation({
    mutationFn: profileService.updateRecommendationPreferences,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile', 'recommendation-preferences'] });
      toast({ title: '偏好已保存' });
    },
    onError: () => {
      toast({ title: '保存失败，请重试', variant: 'destructive' });
    },
  });

  const handleChange = useCallback(
    <K extends keyof LocalPrefs>(field: K, value: LocalPrefs[K]) => {
      setLocal((prev) => ({ ...prev, [field]: value }));
      const fieldToDto: Record<string, string> = {
        popularity: 'popularityPreference',
        cooking: 'cookingEffort',
        budget: 'budgetSensitivity',
        diversity: 'diversityTolerance',
        mealPattern: 'mealPattern',
        flavor: 'flavorOpenness',
        realism: 'realismLevel',
      };
      updateMutation.mutate({ [fieldToDto[field]]: value });
    },
    [updateMutation]
  );

  if (isLoading) {
    return (
      <div className="bg-card rounded-md p-4 animate-pulse space-y-4">
        <div className="h-4 w-28 bg-muted rounded" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-muted " />
        ))}
      </div>
    );
  }

  const isPending = updateMutation.isPending;

  return (
    <div className="bg-card rounded-md p-4 space-y-5">
      <div className="flex items-center gap-2">
        <span className="text-base">🎛️</span>
        <h3 className="text-sm font-bold">推荐偏好</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">调整后自动生效</span>
      </div>

      {/* ── 第一组：基础偏好 ── */}
      <div className="space-y-4">
        <p className="text-[10px] font-bold text-muted-foreground">基础设置</p>
        <SegmentPicker
          label="热度偏好"
          options={POPULARITY_OPTIONS}
          value={local.popularity}
          onChange={(v) => handleChange('popularity', v)}
          disabled={isPending}
        />
        <SegmentPicker
          label="烹饪投入"
          options={COOKING_OPTIONS}
          value={local.cooking}
          onChange={(v) => handleChange('cooking', v)}
          disabled={isPending}
        />
        <SegmentPicker
          label="预算敏感度"
          options={BUDGET_OPTIONS}
          value={local.budget}
          onChange={(v) => handleChange('budget', v)}
          disabled={isPending}
        />
      </div>

      <div className="border-t border-border/40" />

      {/* ── 第二组：用餐模式 ── */}
      <div className="space-y-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          用餐模式
        </p>

        <SegmentPicker
          label="用餐模式"
          options={MEAL_PATTERN_OPTIONS}
          value={local.mealPattern}
          onChange={(v) => handleChange('mealPattern', v)}
          disabled={isPending}
        />
      </div>

      <div className="border-t border-border/40" />

      {/* ── 第三组：口味 & 多样性 ── */}
      <div className="space-y-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          口味 & 多样性
        </p>
        <SegmentPicker
          label="口味探索度"
          options={FLAVOR_OPTIONS}
          value={local.flavor}
          onChange={(v) => handleChange('flavor', v)}
          disabled={isPending}
        />
        <SegmentPicker
          label="菜单多样性"
          options={DIVERSITY_OPTIONS}
          value={local.diversity}
          onChange={(v) => handleChange('diversity', v)}
          disabled={isPending}
        />
      </div>

      <div className="border-t border-border/40" />

      {/* ── 第四组：计划执行 ── */}
      <div className="space-y-4">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          计划执行
        </p>
        <SegmentPicker
          label="可行性要求"
          options={REALISM_OPTIONS}
          value={local.realism}
          onChange={(v) => handleChange('realism', v)}
          disabled={isPending}
        />
      </div>
    </div>
  );
}
