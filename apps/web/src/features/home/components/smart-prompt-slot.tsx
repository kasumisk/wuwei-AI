'use client';

/**
 * SmartPromptSlot — 智能提示容器
 *
 * 统一展示来自不同来源的提示，按优先级选出最重要的 1 条。
 * 优先级：reminder > completion > goalTransition > collectionCard
 */

import { ProactiveReminderCard } from './proactive-reminder';
import { CompletionPrompt } from '@/features/profile/components/completion-prompt';
import { GoalTransitionCard } from './goal-transition-card';
import { ProfileCollectionCard } from './profile-collection-card';
import type { ProactiveReminder } from '@/types/food';

export interface SmartPromptSlotProps {
  reminder?: ProactiveReminder | null;
  showReminder: boolean;
  onDismissReminder: () => void;

  showCompletion: boolean;
  onDismissCompletion: () => void;

  showGoalTransition: boolean;
  onDismissGoalTransition: () => void;

  showCollectionCard: boolean;
  onDismissCollectionCard: () => void;
}

export function SmartPromptSlot({
  reminder,
  showReminder,
  onDismissReminder,
  showCompletion,
  onDismissCompletion,
  showGoalTransition,
  onDismissGoalTransition,
  showCollectionCard,
  onDismissCollectionCard,
}: SmartPromptSlotProps) {
  // Priority 1: proactive reminder
  if (reminder && showReminder) {
    return (
      <section className="mb-5">
        <ProactiveReminderCard reminder={reminder} onDismiss={onDismissReminder} />
      </section>
    );
  }

  // Priority 2: profile completion
  if (showCompletion) {
    return (
      <section className="mb-5">
        <CompletionPrompt onDismiss={onDismissCompletion} />
      </section>
    );
  }

  // Priority 3: goal transition
  if (showGoalTransition) {
    return (
      <section className="mb-5">
        <GoalTransitionCard onDismiss={onDismissGoalTransition} />
      </section>
    );
  }

  // Priority 4: profile collection
  if (showCollectionCard) {
    return (
      <section className="mb-5">
        <ProfileCollectionCard onDismiss={onDismissCollectionCard} />
      </section>
    );
  }

  return null;
}
