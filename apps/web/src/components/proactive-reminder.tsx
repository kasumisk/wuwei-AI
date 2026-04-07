'use client';

import type { ProactiveReminder } from '@/lib/api/food';

const URGENCY_CONFIG = {
  low: { bgClass: 'bg-blue-50 border-blue-200', textClass: 'text-blue-800', icon: '💡' },
  medium: { bgClass: 'bg-yellow-50 border-yellow-200', textClass: 'text-yellow-800', icon: '⚠️' },
  high: { bgClass: 'bg-red-50 border-red-200', textClass: 'text-red-800', icon: '🚨' },
};

interface ProactiveReminderCardProps {
  reminder: ProactiveReminder;
  onDismiss?: () => void;
}

export function ProactiveReminderCard({ reminder, onDismiss }: ProactiveReminderCardProps) {
  const config = URGENCY_CONFIG[reminder.urgency] || URGENCY_CONFIG.low;

  return (
    <div className={`rounded-2xl p-4 border ${config.bgClass} flex items-start gap-3`}>
      <span className="text-xl flex-shrink-0">{config.icon}</span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium ${config.textClass}`}>{reminder.message}</p>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="text-muted-foreground hover:text-foreground text-lg leading-none flex-shrink-0"
          aria-label="关闭"
        >
          ×
        </button>
      )}
    </div>
  );
}
