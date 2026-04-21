'use client';

import type { StepBehaviorData } from '../types';
import {
  DISCIPLINE_OPTIONS,
  WEAK_SLOT_OPTIONS,
  BINGE_TRIGGER_OPTIONS,
  HEALTH_CONDITION_OPTIONS,
} from '../lib/onboarding-constants';
import { TagCloud } from './shared/tag-cloud';

interface StepBehaviorProps {
  data: StepBehaviorData;
  onChange: (data: Partial<StepBehaviorData>) => void;
}

export function StepBehavior({ data, onChange }: StepBehaviorProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-extrabold font-headline">行为与健康</h2>
        <p className="text-sm text-muted-foreground mt-2">帮我们制定更适合你的方案</p>
      </div>

      <div className="space-y-6">
        {/* 自律程度 */}
        <div>
          <p className="text-sm font-bold text-foreground mb-3">你的饮食执行力如何？</p>
          <div className="space-y-2">
            {DISCIPLINE_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => onChange({ discipline: key as StepBehaviorData['discipline'] })}
                className={`w-full px-4 py-3.5  text-left text-sm font-medium transition-all active:scale-[0.98] ${
                  data.discipline === key
                    ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 容易乱吃时段 */}
        <div>
          <p className="text-sm font-bold text-foreground mb-3">什么时段更容易控制不住？</p>
          <TagCloud
            options={WEAK_SLOT_OPTIONS}
            selected={data.weakTimeSlots ?? []}
            onChange={(weakTimeSlots) => onChange({ weakTimeSlots })}
          />
        </div>

        {/* 暴食触发因素 */}
        <div>
          <p className="text-sm font-bold text-foreground mb-3">什么情况下你容易多吃？</p>
          <TagCloud
            options={BINGE_TRIGGER_OPTIONS}
            selected={data.bingeTriggers ?? []}
            onChange={(bingeTriggers) => onChange({ bingeTriggers })}
          />
        </div>

        {/* 是否会做饭 */}
        <div>
          <p className="text-sm font-bold text-foreground mb-3">会做饭吗？</p>
          <div className="flex gap-3">
            {[
              { key: true, label: '会做饭 🍳' },
              { key: false, label: '不太会 🤷' },
            ].map(({ key, label }) => (
              <button
                key={String(key)}
                type="button"
                onClick={() => onChange({ canCook: key })}
                className={`flex-1 py-3  text-sm font-bold transition-all active:scale-95 ${
                  data.canCook === key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 健康状况 */}
        <div>
          <p className="text-sm font-bold text-foreground mb-1">是否有以下健康状况？</p>
          <p className="text-xs text-muted-foreground mb-3">
            如实填写可让 AI 规避风险食物，保障你的安全（可跳过）
          </p>
          <div className="grid grid-cols-3 gap-2">
            {HEALTH_CONDITION_OPTIONS.map(({ key, label, icon }) => {
              const selected = (data.healthConditions ?? []).includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => {
                    const prev = data.healthConditions ?? [];
                    if (key === 'none') {
                      // "无" is mutex: clear all others
                      onChange({ healthConditions: selected ? [] : ['none'] });
                    } else {
                      // Selecting a condition clears "none"
                      const filtered = prev.filter((k) => k !== 'none');
                      const next = selected ? filtered.filter((k) => k !== key) : [...filtered, key];
                      onChange({ healthConditions: next });
                    }
                  }}
                  className={`flex flex-col items-center gap-1 py-3 px-2  text-xs font-medium transition-all active:scale-95 ${
                    selected
                      ? 'bg-amber-500 text-white shadow-sm shadow-amber-500/30'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  }`}
                >
                  <span className="text-base">{icon}</span>
                  <span className="leading-tight text-center">{label}</span>
                </button>
              );
            })}
          </div>
          {(data.healthConditions ?? []).length > 0 && (
            <p className="text-xs text-amber-600 mt-2 font-medium">
              已选 {data.healthConditions!.length} 项，AI 将据此调整推荐策略
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
