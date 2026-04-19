'use client';

import type { StepBodyGoalData } from '../types';
import {
  GOAL_OPTIONS,
  ACTIVITY_LEVEL_OPTIONS,
  GOAL_SPEED_OPTIONS,
} from '../lib/onboarding-constants';
import { SliderInput } from './shared/slider-input';
import { GoalCards } from './shared/goal-cards';
import { ActivityLevelPicker } from './shared/activity-level-picker';

interface StepBodyGoalProps {
  data: StepBodyGoalData;
  onChange: (data: Partial<StepBodyGoalData>) => void;
}

export function StepBodyGoal({ data, onChange }: StepBodyGoalProps) {
  const showTargetWeight = data.goal === 'fat_loss' || data.goal === 'muscle_gain';
  const showGoalSpeed = data.goal === 'fat_loss' || data.goal === 'muscle_gain';

  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-extrabold font-headline">目标与身体</h2>
        <p className="text-sm text-muted-foreground mt-2">帮你精准计算每日营养需求</p>
      </div>

      <div className="space-y-6">
        <SliderInput
          label="身高"
          value={data.heightCm}
          onChange={(heightCm) => onChange({ heightCm })}
          min={100}
          max={220}
          unit="cm"
          placeholder="拖动选择身高"
        />

        <SliderInput
          label="体重"
          value={data.weightKg}
          onChange={(weightKg) => onChange({ weightKg })}
          min={30}
          max={200}
          unit="kg"
          placeholder="拖动选择体重"
        />

        <div>
          <p className="text-sm font-bold text-foreground mb-3">🎯 你的目标</p>
          <GoalCards
            options={GOAL_OPTIONS}
            value={data.goal}
            onChange={(goal) => onChange({ goal: goal as StepBodyGoalData['goal'] })}
          />
        </div>

        {showTargetWeight && (
          <SliderInput
            label="目标体重"
            value={data.targetWeightKg}
            onChange={(targetWeightKg) => onChange({ targetWeightKg })}
            min={30}
            max={200}
            unit="kg"
            placeholder="拖动选择目标体重"
          />
        )}

        {/* 3.6: goalSpeed 选择块 */}
        {showGoalSpeed && (
          <div>
            <p className="text-sm font-bold text-foreground mb-3">⚡ 目标速度</p>
            <div className="grid grid-cols-3 gap-2">
              {GOAL_SPEED_OPTIONS.map(({ key, label, emoji, desc }) => {
                const isSelected = (data.goalSpeed ?? 'normal') === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => onChange({ goalSpeed: key })}
                    className={`flex flex-col items-center py-4 px-2  text-center transition-all space-y-1 ${
                      isSelected
                        ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    <span className="text-2xl leading-none">{emoji}</span>
                    <span className="text-sm font-bold">{label}</span>
                    <span
                      className={`text-[10px] leading-tight ${isSelected ? 'text-primary-foreground/80' : 'opacity-60'}`}
                    >
                      {desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <p className="text-sm font-bold text-foreground mb-3">日常活动量</p>
          <ActivityLevelPicker
            options={ACTIVITY_LEVEL_OPTIONS}
            value={data.activityLevel}
            onChange={(activityLevel) =>
              onChange({ activityLevel: activityLevel as StepBodyGoalData['activityLevel'] })
            }
          />
        </div>
      </div>
    </div>
  );
}
