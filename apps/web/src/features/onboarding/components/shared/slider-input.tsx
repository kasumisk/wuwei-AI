'use client';

interface SliderInputProps {
  label: string;
  value?: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  unit: string;
  placeholder?: string;
}

export function SliderInput({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  unit,
  placeholder,
}: SliderInputProps) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-foreground">{label}</span>
        <span className="text-sm font-bold text-primary">
          {value != null ? `${value} ${unit}` : `-- ${unit}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value ?? Math.round((min + max) / 2)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-2 bg-muted rounded-full appearance-none cursor-pointer accent-primary"
      />
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted-foreground">
          {min} {unit}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {max} {unit}
        </span>
      </div>
      {value == null && placeholder && (
        <p className="text-xs text-muted-foreground mt-1">{placeholder}</p>
      )}
    </div>
  );
}
