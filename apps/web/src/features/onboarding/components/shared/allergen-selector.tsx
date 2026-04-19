'use client';

import { ALLERGEN_OPTIONS } from '../../lib/onboarding-constants';

interface AllergenSelectorProps {
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function AllergenSelector({ selected, onChange }: AllergenSelectorProps) {
  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-amber-500 text-lg">⚠️</span>
        <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
          过敏原（安全提醒）
        </span>
      </div>
      <p className="text-xs text-muted-foreground mb-3">
        选择你的过敏原，我们会在推荐中严格避开这些食物
      </p>
      <div className="flex flex-wrap gap-2">
        {ALLERGEN_OPTIONS.map(({ key, label, icon }) => {
          const active = selected.includes(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              className={`flex items-center gap-1.5 px-3.5 py-2  text-sm font-bold transition-all active:scale-95 border ${
                active
                  ? 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-600'
                  : 'bg-muted text-muted-foreground border-transparent hover:bg-muted/80'
              }`}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
