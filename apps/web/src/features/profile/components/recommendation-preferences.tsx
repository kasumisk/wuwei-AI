'use client';

import { useCallback, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { profileService } from '@/lib/api/profile';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useToast } from '@/lib/hooks/use-toast';
import type { PopularityPreference, CookingEffort, BudgetSensitivity } from '@/types/user';

/**
 * 推荐偏好设置卡片
 * 调用 GET/PUT /api/app/user-profile/recommendation-preferences
 * 三档选择器：热度/烹饪难度/预算
 */

const POPULARITY_OPTIONS: { value: PopularityPreference; label: string; desc: string }[] = [
  { value: 'popular', label: '大众', desc: '优先推荐大众熟知的食物' },
  { value: 'balanced', label: '均衡', desc: '兼顾大众与新奇' },
  { value: 'adventurous', label: '尝新', desc: '乐于尝试新食物新搭配' },
];

const COOKING_OPTIONS: { value: CookingEffort; label: string; desc: string }[] = [
  { value: 'quick', label: '快手', desc: '15分钟内可完成' },
  { value: 'moderate', label: '适中', desc: '30分钟左右' },
  { value: 'elaborate', label: '精心', desc: '不怕麻烦，追求品质' },
];

const BUDGET_OPTIONS: { value: BudgetSensitivity; label: string; desc: string }[] = [
  { value: 'budget', label: '节省', desc: '控制每餐成本' },
  { value: 'moderate', label: '适中', desc: '性价比优先' },
  { value: 'unlimited', label: '不限', desc: '品质优先，不限预算' },
];

interface SegmentPickerProps<T extends string> {
  label: string;
  options: { value: T; label: string; desc: string }[];
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
      <div className="flex bg-muted rounded-xl p-1 gap-1">
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

  // Local state for optimistic updates
  const [localPopularity, setLocalPopularity] = useState<PopularityPreference | undefined>();
  const [localCooking, setLocalCooking] = useState<CookingEffort | undefined>();
  const [localBudget, setLocalBudget] = useState<BudgetSensitivity | undefined>();
  const [initialized, setInitialized] = useState(false);

  // Sync server data → local state once
  if (prefs && !initialized) {
    setLocalPopularity(prefs.popularityPreference);
    setLocalCooking(prefs.cookingEffort);
    setLocalBudget(prefs.budgetSensitivity);
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
    (field: string, value: string) => {
      const update: Record<string, string> = {};
      if (field === 'popularity') {
        setLocalPopularity(value as PopularityPreference);
        update.popularityPreference = value;
      } else if (field === 'cooking') {
        setLocalCooking(value as CookingEffort);
        update.cookingEffort = value;
      } else if (field === 'budget') {
        setLocalBudget(value as BudgetSensitivity);
        update.budgetSensitivity = value;
      }
      // 自动保存（debounce 不需要，用户选择即保存）
      updateMutation.mutate(update);
    },
    [updateMutation]
  );

  if (isLoading) {
    return (
      <div className="bg-card rounded-2xl p-4 animate-pulse space-y-4">
        <div className="h-4 w-28 bg-muted rounded" />
        <div className="h-10 bg-muted rounded-xl" />
        <div className="h-10 bg-muted rounded-xl" />
        <div className="h-10 bg-muted rounded-xl" />
      </div>
    );
  }

  return (
    <div className="bg-card rounded-2xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-base">🎛️</span>
        <h3 className="text-sm font-bold">推荐偏好</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">调整后自动生效</span>
      </div>

      <SegmentPicker
        label="热度偏好"
        options={POPULARITY_OPTIONS}
        value={localPopularity}
        onChange={(v) => handleChange('popularity', v)}
        disabled={updateMutation.isPending}
      />

      <SegmentPicker
        label="烹饪投入"
        options={COOKING_OPTIONS}
        value={localCooking}
        onChange={(v) => handleChange('cooking', v)}
        disabled={updateMutation.isPending}
      />

      <SegmentPicker
        label="预算敏感度"
        options={BUDGET_OPTIONS}
        value={localBudget}
        onChange={(v) => handleChange('budget', v)}
        disabled={updateMutation.isPending}
      />
    </div>
  );
}
