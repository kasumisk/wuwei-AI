'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useProfile } from '@/features/profile/hooks/use-profile';
import { profileService } from '@/lib/api/profile';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useToast } from '@/lib/hooks/use-toast';
import type { UserProfile } from '@/types/user';

type SleepQuality = 'poor' | 'fair' | 'good';
type StressLevel = 'low' | 'medium' | 'high';
type MealTiming = 'early_bird' | 'standard' | 'late_eater';

const SLEEP_OPTIONS: { value: SleepQuality; label: string; desc: string }[] = [
  { value: 'poor', label: '差', desc: '经常失眠或睡眠不足' },
  { value: 'fair', label: '一般', desc: '偶尔睡眠不好' },
  { value: 'good', label: '好', desc: '睡眠规律质量好' },
];

const STRESS_OPTIONS: { value: StressLevel; label: string; desc: string }[] = [
  { value: 'low', label: '低', desc: '生活轻松压力小' },
  { value: 'medium', label: '中', desc: '日常工作学习压力' },
  { value: 'high', label: '高', desc: '长期高压状态' },
];

const TIMING_OPTIONS: { value: MealTiming; label: string; desc: string }[] = [
  { value: 'early_bird', label: '早食', desc: '早餐 7 点前，晚餐 6 点前' },
  { value: 'standard', label: '标准', desc: '三餐规律标准时间' },
  { value: 'late_eater', label: '晚食', desc: '习惯晚吃或深夜进食' },
];

type LocalState = {
  sleepQuality: SleepQuality | undefined;
  stressLevel: StressLevel | undefined;
  hydrationGoal: number | undefined;
  mealTimingPreference: MealTiming | undefined;
};

function SegmentPicker<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: { value: T; label: string; desc?: string }[];
  value: T | undefined;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  const selected = options.find((o) => o.value === value);
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
      {selected?.desc && <p className="text-[11px] text-muted-foreground">{selected.desc}</p>}
    </div>
  );
}

export function LifestyleProfileCard() {
  const { isLoggedIn } = useAuth();
  const { profile } = useProfile();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [local, setLocal] = useState<LocalState>({
    sleepQuality: undefined,
    stressLevel: undefined,
    hydrationGoal: undefined,
    mealTimingPreference: undefined,
  });
  const [synced, setSynced] = useState(false);

  if (profile && !synced) {
    setLocal({
      sleepQuality: profile.sleepQuality,
      stressLevel: profile.stressLevel,
      hydrationGoal: profile.hydrationGoal,
      mealTimingPreference: profile.mealTimingPreference,
    });
    setSynced(true);
  }

  const mutation = useMutation({
    mutationFn: (data: Partial<UserProfile>) => profileService.updateDeclaredProfile(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      toast({ title: '生活方式已保存' });
    },
    onError: () => {
      toast({ title: '保存失败，请重试', variant: 'destructive' });
    },
  });

  const handleChange = useCallback(
    <K extends keyof LocalState>(key: K, value: LocalState[K]) => {
      setLocal((prev) => ({ ...prev, [key]: value }));
      mutation.mutate({ [key]: value });
    },
    [mutation]
  );

  const [hydrationInput, setHydrationInput] = useState(
    local.hydrationGoal ? String(local.hydrationGoal) : ''
  );

  const saveHydration = useCallback(() => {
    const val = parseInt(hydrationInput);
    if (isNaN(val) || val < 500 || val > 5000) {
      toast({ title: '饮水目标应在 500-5000ml 之间', variant: 'destructive' });
      return;
    }
    handleChange('hydrationGoal', val);
  }, [hydrationInput, handleChange, toast]);

  if (!isLoggedIn) return null;

  return (
    <div className="bg-card  p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-base">🌱</span>
        <h3 className="text-sm font-bold">生活方式</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">帮助 AI 精调推荐</span>
      </div>

      <SegmentPicker
        label="睡眠质量"
        options={SLEEP_OPTIONS}
        value={local.sleepQuality}
        onChange={(v) => handleChange('sleepQuality', v)}
        disabled={mutation.isPending}
      />

      <SegmentPicker
        label="日常压力"
        options={STRESS_OPTIONS}
        value={local.stressLevel}
        onChange={(v) => handleChange('stressLevel', v)}
        disabled={mutation.isPending}
      />

      <SegmentPicker
        label="用餐时间偏好"
        options={TIMING_OPTIONS}
        value={local.mealTimingPreference}
        onChange={(v) => handleChange('mealTimingPreference', v)}
        disabled={mutation.isPending}
      />

      <div>
        <p className="text-xs font-bold text-foreground mb-2">每日饮水目标 (ml)</p>
        <div className="flex gap-2">
          <input
            type="number"
            value={hydrationInput}
            onChange={(e) => setHydrationInput(e.target.value)}
            onBlur={saveHydration}
            placeholder="例如 2000"
            min={500}
            max={5000}
            className="flex-1 px-4 py-2.5  bg-muted text-foreground text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={saveHydration}
            disabled={mutation.isPending}
            className="px-4 py-2.5  bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50"
          >
            保存
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground mt-1">推荐 1500-3000ml，影响饮食补水建议</p>
      </div>
    </div>
  );
}
