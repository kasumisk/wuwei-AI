'use client';

interface ActivityLevelPickerProps {
  options: ReadonlyArray<{ key: string; label: string; icon: string; desc: string }>;
  value?: string;
  onChange: (key: string) => void;
}

export function ActivityLevelPicker({ options, value, onChange }: ActivityLevelPickerProps) {
  return (
    <div className="space-y-2">
      {options.map(({ key, label, icon, desc }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-all active:scale-[0.98] ${
            value === key
              ? 'bg-primary text-primary-foreground shadow-md shadow-primary/20'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          <span className="text-xl flex-shrink-0">{icon}</span>
          <div>
            <span className="font-bold text-sm">{label}</span>
            <p
              className={`text-[11px] ${value === key ? 'text-primary-foreground/80' : 'text-muted-foreground/70'}`}
            >
              {desc}
            </p>
          </div>
        </button>
      ))}
    </div>
  );
}
