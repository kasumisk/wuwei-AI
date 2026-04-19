'use client';

interface GoalCardsProps {
  options: ReadonlyArray<{ key: string; label: string; emoji: string; desc: string }>;
  value?: string;
  onChange: (key: string) => void;
}

export function GoalCards({ options, value, onChange }: GoalCardsProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {options.map(({ key, label, emoji, desc }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`py-4 px-4  text-left transition-all active:scale-[0.97] ${
            value === key
              ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          <span className="text-2xl">{emoji}</span>
          <p className="font-bold text-sm mt-2">{label}</p>
          <p
            className={`text-[11px] mt-0.5 ${value === key ? 'text-primary-foreground/80' : 'text-muted-foreground/70'}`}
          >
            {desc}
          </p>
        </button>
      ))}
    </div>
  );
}
