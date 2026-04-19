'use client';

import { useMemo } from 'react';

interface YearPickerProps {
  value?: number;
  onChange: (year: number) => void;
  min?: number;
  max?: number;
}

export function YearPicker({ value, onChange, min = 1940, max = 2020 }: YearPickerProps) {
  const years = useMemo(() => {
    const arr: number[] = [];
    for (let y = max; y >= min; y--) arr.push(y);
    return arr;
  }, [min, max]);

  return (
    <div className="relative">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full appearance-none px-4 py-3.5  bg-muted text-foreground text-base font-medium outline-none focus:ring-2 focus:ring-primary cursor-pointer"
      >
        <option value="" disabled>
          选择出生年份
        </option>
        {years.map((y) => (
          <option key={y} value={y}>
            {y} 年
          </option>
        ))}
      </select>
      <div className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground">
        ▾
      </div>
    </div>
  );
}
