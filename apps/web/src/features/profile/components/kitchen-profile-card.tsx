'use client';

import { useState, useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useProfile } from '@/features/profile/hooks/use-profile';
import { profileService } from '@/lib/api/profile';
import { useAuth } from '@/features/auth/hooks/use-auth';
import { useToast } from '@/lib/hooks/use-toast';
import type { KitchenProfile } from '@/types/user';

const DEFAULT_KITCHEN: KitchenProfile = {
  hasOven: false,
  hasMicrowave: true,
  hasAirFryer: false,
  hasRiceCooker: true,
  hasSteamer: true,
  primaryStove: 'gas',
};

const APPLIANCES: { key: keyof Omit<KitchenProfile, 'primaryStove'>; label: string; icon: string }[] = [
  { key: 'hasMicrowave', label: '微波炉', icon: '📡' },
  { key: 'hasRiceCooker', label: '电饭煲', icon: '🍚' },
  { key: 'hasSteamer', label: '蒸锅', icon: '🫧' },
  { key: 'hasAirFryer', label: '空气炸锅', icon: '🌪️' },
  { key: 'hasOven', label: '烤箱', icon: '🔥' },
];

const STOVE_OPTIONS: { value: KitchenProfile['primaryStove']; label: string }[] = [
  { value: 'gas', label: '燃气灶' },
  { value: 'induction', label: '电磁炉' },
  { value: 'none', label: '无灶具' },
];

export function KitchenProfileCard() {
  const { isLoggedIn } = useAuth();
  const { profile } = useProfile();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const serverKitchen = (profile?.kitchenProfile as KitchenProfile | undefined) ?? DEFAULT_KITCHEN;
  const [local, setLocal] = useState<KitchenProfile>(serverKitchen);
  const [synced, setSynced] = useState(false);

  // Sync server data once on first render
  if (profile && !synced) {
    setLocal(serverKitchen);
    setSynced(true);
  }

  const mutation = useMutation({
    mutationFn: (data: KitchenProfile) =>
      profileService.updateDeclaredProfile({ kitchenProfile: data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
      toast({ title: '厨房设置已保存' });
    },
    onError: () => {
      toast({ title: '保存失败，请重试', variant: 'destructive' });
    },
  });

  const toggleAppliance = useCallback(
    (key: keyof Omit<KitchenProfile, 'primaryStove'>) => {
      const updated = { ...local, [key]: !local[key] };
      setLocal(updated);
      mutation.mutate(updated);
    },
    [local, mutation]
  );

  const setStove = useCallback(
    (stove: KitchenProfile['primaryStove']) => {
      const updated = { ...local, primaryStove: stove };
      setLocal(updated);
      mutation.mutate(updated);
    },
    [local, mutation]
  );

  if (!isLoggedIn) return null;

  return (
    <div className="bg-card rounded-2xl p-4 space-y-4">
      <div className="flex items-center gap-2">
        <span className="text-base">🍳</span>
        <h3 className="text-sm font-bold">厨房装备</h3>
        <span className="text-[10px] text-muted-foreground ml-auto">影响菜谱推荐方式</span>
      </div>

      {/* 灶具类型 */}
      <div>
        <p className="text-xs font-bold text-foreground mb-2">灶具类型</p>
        <div className="flex gap-2">
          {STOVE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStove(value)}
              disabled={mutation.isPending}
              className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all active:scale-[0.97] ${
                local.primaryStove === value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              } disabled:opacity-50`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 家电列表 */}
      <div>
        <p className="text-xs font-bold text-foreground mb-2">已有家电（点击切换）</p>
        <div className="grid grid-cols-3 gap-2">
          {APPLIANCES.map(({ key, label, icon }) => {
            const has = local[key];
            return (
              <button
                key={key}
                onClick={() => toggleAppliance(key)}
                disabled={mutation.isPending}
                className={`flex flex-col items-center py-3 rounded-xl text-xs font-bold transition-all gap-1 ${
                  has
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground opacity-50'
                } disabled:opacity-30`}
              >
                <span className="text-xl">{icon}</span>
                {label}
                <span className="text-[10px] font-normal">{has ? '✓ 有' : '没有'}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
