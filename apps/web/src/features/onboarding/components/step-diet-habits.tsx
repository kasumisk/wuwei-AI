'use client';

import type { StepDietHabitsData } from '../types';
import {
  MEALS_PER_DAY_OPTIONS,
  TAKEOUT_OPTIONS,
  DIETARY_RESTRICTION_OPTIONS,
  FOOD_PREFERENCE_OPTIONS,
} from '../lib/onboarding-constants';
import { TagCloud } from './shared/tag-cloud';
import { AllergenSelector } from './shared/allergen-selector';

interface StepDietHabitsProps {
  data: StepDietHabitsData;
  onChange: (data: Partial<StepDietHabitsData>) => void;
}

export function StepDietHabits({ data, onChange }: StepDietHabitsProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-extrabold font-headline">饮食习惯</h2>
        <p className="text-sm text-muted-foreground mt-2">了解你的饮食偏好，推荐更精准</p>
      </div>

      <div className="space-y-6">
        {/* 一天几餐 */}
        <div>
          <p className="text-sm font-bold text-foreground mb-3">一天几餐</p>
          <div className="flex gap-2">
            {MEALS_PER_DAY_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => onChange({ mealsPerDay: n })}
                className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all active:scale-95 ${
                  data.mealsPerDay === n
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {n} 餐
              </button>
            ))}
          </div>
        </div>

        {/* 外卖频率 */}
        <div>
          <p className="text-sm font-bold text-foreground mb-3">外卖频率</p>
          <div className="flex gap-2">
            {TAKEOUT_OPTIONS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  onChange({ takeoutFrequency: key as StepDietHabitsData['takeoutFrequency'] })
                }
                className={`flex-1 py-3 rounded-2xl text-sm font-bold transition-all active:scale-95 ${
                  data.takeoutFrequency === key
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* 过敏原（独立区域，安全优先） */}
        <AllergenSelector
          selected={data.allergens ?? []}
          onChange={(allergens) => onChange({ allergens })}
        />

        {/* 忌口 */}
        <div>
          <p className="text-sm font-bold text-foreground mb-3">忌口（可多选）</p>
          <TagCloud
            options={DIETARY_RESTRICTION_OPTIONS}
            selected={data.dietaryRestrictions ?? []}
            onChange={(dietaryRestrictions) => onChange({ dietaryRestrictions })}
          />
        </div>

        {/* 饮食偏好 */}
        <div>
          <p className="text-sm font-bold text-foreground mb-3">喜欢吃什么（可多选）</p>
          <TagCloud
            options={FOOD_PREFERENCE_OPTIONS}
            selected={data.foodPreferences ?? []}
            onChange={(foodPreferences) => onChange({ foodPreferences })}
          />
        </div>
      </div>
    </div>
  );
}
