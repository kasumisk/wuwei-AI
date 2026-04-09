'use client';

import type { StepBehaviorData } from '../types';
import {
  DISCIPLINE_OPTIONS,
  WEAK_SLOT_OPTIONS,
  BINGE_TRIGGER_OPTIONS,
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
        <h2 className="text-2xl font-extrabold font-headline">行为与心理</h2>
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
                className={`w-full px-4 py-3.5 rounded-2xl text-left text-sm font-medium transition-all active:scale-[0.98] ${
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
                className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all active:scale-95 ${
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
      </div>
    </div>
  );
}
