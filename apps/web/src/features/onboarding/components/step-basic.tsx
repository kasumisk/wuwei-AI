'use client';

import type { StepBasicData } from '../types';
import { GenderSelector } from './shared/gender-selector';
import { YearPicker } from './shared/year-picker';

interface StepBasicProps {
  data: StepBasicData;
  onChange: (data: Partial<StepBasicData>) => void;
}

export function StepBasic({ data, onChange }: StepBasicProps) {
  return (
    <div className="space-y-8">
      <div className="text-center">
        <h2 className="text-2xl font-extrabold font-headline">让我们用 3 秒认识你</h2>
        <p className="text-sm text-muted-foreground mt-2">这两项信息帮助我们精准计算你的营养需求</p>
      </div>

      <div className="space-y-6">
        <div>
          <p className="text-sm font-bold text-foreground mb-3">你的性别</p>
          <GenderSelector value={data.gender} onChange={(gender) => onChange({ gender })} />
        </div>

        <div>
          <p className="text-sm font-bold text-foreground mb-3">出生年份</p>
          <YearPicker value={data.birthYear} onChange={(birthYear) => onChange({ birthYear })} />
        </div>
      </div>
    </div>
  );
}
