'use client';

interface GenderSelectorProps {
  value?: string;
  onChange: (gender: string) => void;
}

export function GenderSelector({ value, onChange }: GenderSelectorProps) {
  return (
    <div className="grid grid-cols-2 gap-4">
      {[
        { key: 'male', label: '男生', icon: '👨' },
        { key: 'female', label: '女生', icon: '👩' },
      ].map(({ key, label, icon }) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          className={`flex flex-col items-center gap-3 py-8 rounded-2xl font-bold text-lg transition-all active:scale-[0.97] ${
            value === key
              ? 'bg-primary text-primary-foreground shadow-lg shadow-primary/20'
              : 'bg-muted text-muted-foreground hover:bg-muted/80'
          }`}
        >
          <span className="text-4xl">{icon}</span>
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
