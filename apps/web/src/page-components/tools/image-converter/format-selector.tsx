'use client';

import { IMAGE_FORMATS, OUTPUT_FORMATS } from '@/lib/image-converter';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useTranslations } from 'next-intl';

interface FormatSelectorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function FormatSelector({ value, onChange, disabled }: FormatSelectorProps) {
  const t = useTranslations('components.formatSelector');
  return (
    <div className="space-y-2">
      <Label htmlFor="format">{t('label')}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger id="format" className="w-full">
          <SelectValue placeholder={t('placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {OUTPUT_FORMATS.map((formatId) => {
            const format = IMAGE_FORMATS[formatId];
            return (
              <SelectItem key={formatId} value={formatId}>
                <span className="font-medium">{format.name}</span>
                <span className="text-muted-foreground ml-2">({format.extension})</span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}
