import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';
import { I18nService } from '../../../../../core/i18n';
import {
  getBehavior,
  getInferred,
} from '../../../user-profile-merge.helper';

/**
 * 持续收集触发器
 * 根据使用天数和已填字段，生成持续收集提醒
 *
 * 触发规则：
 * - 使用 7 天 + Step 3 未填 → 提醒 allergens, dietaryRestrictions
 * - V4 规则 6: 连续替换同类食物 ≥ 3 次 → 确认偏好（Toast）
 * - 使用 14 天 → cookingSkillLevel, budgetLevel
 * - 使用 30 天 → exerciseProfile
 * - V4 规则 7: 目标达成/停滞 → 调整 goal, goalSpeed
 * - V4 规则 8: 累计记录 ≥ 50 次 → tasteIntensity（可自动推断）
 */
export interface CollectionReminder {
  type: 'popup' | 'toast' | 'card' | 'settings_guide';
  field: string;
  title: string;
  message: string;
  priority: 'high' | 'medium' | 'low';
  dismissable: boolean;
  /** 下次提醒间隔（天），null 表示不再提醒 */
  nextReminderDays: number | null;
}

@Injectable()
export class CollectionTriggerService {
  private readonly logger = new Logger(CollectionTriggerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly i18n: I18nService,
  ) {}

  /**
   * 检查并返回需要收集的字段提醒
   * 由客户端在 App 打开时调用
   */
  async checkCollectionTriggers(userId: string): Promise<CollectionReminder[]> {
    const profile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });

    if (!profile) return [];

    const reminders: CollectionReminder[] = [];
    const completeness = Number(profile.dataCompleteness || 0);
    // V4 修复 B7: 使用日历天数替代 totalRecords
    const createdAt =
      profile.createdAt instanceof Date
        ? profile.createdAt
        : new Date(profile.createdAt);
    const usageDays = Math.max(
      0,
      Math.floor((Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24)),
    );

    // ── 规则 1: 使用 7 天 + Step 3 核心字段未填 ──
    if (usageDays >= 7) {
      if (!profile.allergens || (profile.allergens as any[]).length === 0) {
        reminders.push({
          type: 'popup',
          field: 'allergens',
          title: this.i18n.t('user.trigger.allergies.title'),
          message: this.i18n.t('user.trigger.allergies.message'),
          priority: 'high',
          dismissable: true,
          nextReminderDays: 7,
        });
      }

      if (
        !profile.dietaryRestrictions ||
        (profile.dietaryRestrictions as any[]).length === 0
      ) {
        reminders.push({
          type: 'popup',
          field: 'dietaryRestrictions',
          title: this.i18n.t('user.trigger.dietaryRestrictions.title'),
          message: this.i18n.t('user.trigger.dietaryRestrictions.message'),
          priority: 'medium',
          dismissable: true,
          nextReminderDays: 14,
        });
      }
    }

    // ── 规则 2: 使用 14 天 → 烹饪水平和预算 ──
    if (usageDays >= 14) {
      if (!profile.cookingSkillLevel) {
        reminders.push({
          type: 'settings_guide',
          field: 'cookingSkillLevel',
          title: this.i18n.t('user.trigger.cookingSkill.title'),
          message: this.i18n.t('user.trigger.cookingSkill.message'),
          priority: 'low',
          dismissable: true,
          nextReminderDays: 30,
        });
      }

      if (!profile.budgetLevel) {
        reminders.push({
          type: 'settings_guide',
          field: 'budgetLevel',
          title: this.i18n.t('user.trigger.budget.title'),
          message: this.i18n.t('user.trigger.budget.message'),
          priority: 'low',
          dismissable: true,
          nextReminderDays: 30,
        });
      }
    }

    // ── 规则 3: 使用 30 天 → 运动习惯 ──
    if (usageDays >= 30) {
      const exerciseProfile = profile.exerciseProfile as Record<
        string,
        any
      > | null;
      if (!exerciseProfile || Object.keys(exerciseProfile).length === 0) {
        reminders.push({
          type: 'card',
          field: 'exerciseProfile',
          title: this.i18n.t('user.trigger.exercise.title'),
          message: this.i18n.t('user.trigger.exercise.message'),
          priority: 'medium',
          dismissable: true,
          nextReminderDays: 30,
        });
      }
    }

    // ── 规则 4: 健康状况未填 + 完整度低 ──
    if (
      usageDays >= 7 &&
      (!profile.healthConditions ||
        (profile.healthConditions as any[]).length === 0) &&
      completeness < 0.6
    ) {
      reminders.push({
        type: 'popup',
        field: 'healthConditions',
        title: this.i18n.t('user.trigger.healthConditions.title'),
        message: this.i18n.t('user.trigger.healthConditions.message'),
        priority: 'high',
        dismissable: true,
        nextReminderDays: 14,
      });
    }

    // ── 规则 5: 极低完整度持续提醒 ──
    if (completeness < 0.3 && usageDays >= 3) {
      reminders.push({
        type: 'popup',
        field: 'general',
        title: this.i18n.t('user.trigger.completeness.title'),
        message: this.i18n.t('user.trigger.completeness.message', {
          percent: Math.round(completeness * 100),
        }),
        priority: 'high',
        dismissable: false,
        nextReminderDays: 3,
      });
    }

    // ── 规则 6: 连续替换同品类 ≥3 次 → 确认偏好 ──
    try {
      const categoryPreference =
        await this.detectRepeatedCategoryReplacement(userId);
      if (categoryPreference) {
        reminders.push({
          type: 'toast',
          field: 'preferenceConfirmation',
          title: this.i18n.t('user.trigger.swapPreference.title', {
            category: categoryPreference,
          }),
          message: this.i18n.t('user.trigger.swapPreference.message'),
          priority: 'low',
          dismissable: true,
          nextReminderDays: 30,
        });
      }
    } catch (err) {
      this.logger.warn(`Rule 6 (category replacement) failed: ${err}`);
    }

    // ── 规则 7: 目标达成/停滞 → 调整目标建议 ──
    try {
      const goalSuggestion = await this.detectGoalAdjustmentNeed(userId);
      if (goalSuggestion) {
        reminders.push(goalSuggestion);
      }
    } catch (err) {
      this.logger.warn(`Rule 7 (goal adjustment) failed: ${err}`);
    }

    // ── 规则 8: 累计记录 ≥ 50 次 + tasteIntensity 未填 → 自动推断 ──
    try {
      const tasteReminder = await this.detectTasteIntensityInference(
        userId,
        profile,
      );
      if (tasteReminder) {
        reminders.push(tasteReminder);
      }
    } catch (err) {
      this.logger.warn(`Rule 8 (taste intensity) failed: ${err}`);
    }

    // 按优先级排序，每次最多返回 2 条提醒（避免骚扰）
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    reminders.sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
    );

    // V5 3.9: 过滤已关闭且在冷却期内的提醒
    const filtered = await this.filterDismissedReminders(userId, reminders);

    return filtered.slice(0, 2);
  }

  /**
   * V5 3.9: 用户关闭提醒
   *
   * 使用 UPSERT 语义：如果已有关闭记录则更新 dismissedAt，
   * 否则插入新记录。基于 UNIQUE(user_id, reminder_type) 约束。
   */
  async dismissReminder(userId: string, reminderType: string): Promise<void> {
    await this.prisma.reminderDismissals.upsert({
      where: {
        userId_reminderType: {
          userId: userId,
          reminderType: reminderType,
        },
      },
      update: {
        dismissedAt: new Date(),
      },
      create: {
        userId: userId,
        reminderType: reminderType,
        dismissedAt: new Date(),
      },
    });
    this.logger.debug(`用户 ${userId} 关闭了提醒: ${reminderType}`);
  }

  /**
   * V5 3.9: 过滤已关闭且仍在冷却期内的提醒
   *
   * 逻辑：
   * - 查询该用户所有关闭记录
   * - 对每条提醒，检查是否有对应关闭记录
   * - 如果有关闭记录且 dismissedAt + nextReminderDays > 当前时间 → 过滤掉
   * - 如果 nextReminderDays 为 null → 永久关闭，始终过滤
   * - 如果 dismissable 为 false → 不可关闭的提醒不受影响
   */
  private async filterDismissedReminders(
    userId: string,
    reminders: CollectionReminder[],
  ): Promise<CollectionReminder[]> {
    if (reminders.length === 0) return reminders;

    const dismissals = await this.prisma.reminderDismissals.findMany({
      where: { userId: userId },
    });

    if (dismissals.length === 0) return reminders;

    // 构建 reminderType → dismissedAt 映射
    const dismissalMap = new Map<string, Date>();
    for (const d of dismissals) {
      dismissalMap.set(d.reminderType, new Date(d.dismissedAt));
    }

    const now = Date.now();

    return reminders.filter((reminder) => {
      // 不可关闭的提醒不受去重影响
      if (!reminder.dismissable) return true;

      const dismissedAt = dismissalMap.get(reminder.field);
      if (!dismissedAt) return true; // 未关闭过，保留

      // nextReminderDays 为 null → 永久关闭
      if (reminder.nextReminderDays === null) return false;

      // 检查是否已超过冷却期
      const cooldownMs = reminder.nextReminderDays * 24 * 60 * 60 * 1000;
      const cooldownExpiry = dismissedAt.getTime() + cooldownMs;

      return now >= cooldownExpiry; // 冷却期已过 → 保留
    });
  }

  /**
   * 规则 6: 检测连续替换同品类食物 ≥3 次
   * 查询最近 10 条 replaced 反馈，按时间倒序检查连续同品类
   */
  private async detectRepeatedCategoryReplacement(
    userId: string,
  ): Promise<string | null> {
    // 获取最近 10 条替换反馈
    const recentReplacements =
      await this.prisma.recommendationFeedbacks.findMany({
        where: { userId: userId, action: 'replaced' },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });

    if (recentReplacements.length < 3) return null;

    // 获取替换目标食物的品类信息
    const replacementNames = recentReplacements
      .map((r) => r.replacementFood)
      .filter((name): name is string => !!name);

    if (replacementNames.length < 3) return null;

    // 批量查询食物品类
    const foods = await this.prisma.food.findMany({
      where: { name: { in: replacementNames } },
      select: { name: true, category: true },
    });

    const nameToCategory = new Map<string, string>();
    for (const food of foods) {
      nameToCategory.set(food.name, food.category);
    }

    // 按时间顺序检测连续同品类（从最近开始）
    let streak = 1;
    let currentCategory: string | null = null;

    for (const replacement of recentReplacements) {
      if (!replacement.replacementFood) continue;
      const category = nameToCategory.get(replacement.replacementFood);
      if (!category) continue;

      if (currentCategory === null) {
        currentCategory = category;
        streak = 1;
      } else if (category === currentCategory) {
        streak++;
        if (streak >= 3) {
          return this.categoryToDisplayName(currentCategory);
        }
      } else {
        // 连续中断，从当前开始重新计数
        currentCategory = category;
        streak = 1;
      }
    }

    return null;
  }

  /**
   * 规则 7: 检测目标达成或停滞，建议调整
   */
  private async detectGoalAdjustmentNeed(
    userId: string,
  ): Promise<CollectionReminder | null> {
    const userProfile = await this.prisma.userProfiles.findUnique({
      where: { userId: userId },
    });
    const inferred = userProfile ? getInferred(userProfile) : null;
    const goalProgress = inferred?.goalProgress as any;
    if (!goalProgress) return null;

    const { progressPercent, trend } = goalProgress;

    // 目标即将达成 (≥90%)
    if (progressPercent != null && progressPercent >= 90) {
      return {
        type: 'card',
        field: 'goal',
        title: this.i18n.t('user.trigger.goalReached.title'),
        message: this.i18n.t('user.trigger.goalReached.message', {
          percent: Math.round(progressPercent),
        }),
        priority: 'medium',
        dismissable: true,
        nextReminderDays: 7,
      };
    }

    // 停滞 (trend === 'plateau')
    if (trend === 'plateau') {
      return {
        type: 'card',
        field: 'goalSpeed',
        title: this.i18n.t('user.trigger.goalPlateau.title'),
        message: this.i18n.t('user.trigger.goalPlateau.message'),
        priority: 'medium',
        dismissable: true,
        nextReminderDays: 14,
      };
    }

    return null;
  }

  /**
   * 规则 8: 累计记录 ≥50 条 + tasteIntensity 未填 → 提示可自动推断
   */
  private async detectTasteIntensityInference(
    userId: string,
    profile: any,
  ): Promise<CollectionReminder | null> {
    // 检查 tasteIntensity 是否已有有效值
    const tasteIntensity = (profile.tasteIntensity ??
      profile.tasteIntensity) as Record<string, number>;
    if (tasteIntensity && Object.keys(tasteIntensity).length > 0) {
      // 检查是否所有值都是默认值（0）
      const hasNonDefault = Object.values(tasteIntensity).some((v) => v > 0);
      if (hasNonDefault) return null;
    }

    // 统计用户的饮食记录总数
    const recordCount = await this.prisma.foodRecords.count({
      where: { userId: userId },
    });

    if (recordCount < 50) return null;

    return {
      type: 'settings_guide',
      field: 'tasteIntensity',
      title: this.i18n.t('user.trigger.tasteIntensity.title'),
      message: this.i18n.t('user.trigger.tasteIntensity.message', {
        count: recordCount,
      }),
      priority: 'low',
      dismissable: true,
      nextReminderDays: 30,
    };
  }

  /** 品类代码 → 显示名称（i18n） */
  private categoryToDisplayName(category: string): string {
    const translated = this.i18n.t(`user.category.${category}`);
    // 若 key 缺失，i18n.t 返回原 key 本身，此时回退到 category 原值
    return translated === `user.category.${category}` ? category : translated;
  }
}
