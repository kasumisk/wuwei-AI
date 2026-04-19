'use client';

interface TagCloudProps {
  options: ReadonlyArray<{ key: string; label: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
}

export function TagCloud({ options, selected, onChange }: TagCloudProps) {
  const toggle = (key: string) => {
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };

  return (
    <div className="flex flex-wrap gap-2">
      {options.map(({ key, label }) => {
        const active = selected.includes(key);
        return (
          <button
            key={key}
            type="button"
            onClick={() => toggle(key)}
            className={`px-4 py-2  text-sm font-bold transition-all active:scale-95 ${
              active
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
