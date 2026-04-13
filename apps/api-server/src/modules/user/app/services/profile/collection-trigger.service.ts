import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../../../core/prisma/prisma.service';

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

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 检查并返回需要收集的字段提醒
   * 由客户端在 App 打开时调用
   */
  async checkCollectionTriggers(userId: string): Promise<CollectionReminder[]> {
    const [profile, behavior] = await Promise.all([
      this.prisma.userProfiles.findUnique({ where: { userId: userId } }),
      this.prisma.userBehaviorProfiles.findUnique({
        where: { userId: userId },
      }),
    ]);

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
          title: '⚠️ 你有食物过敏吗？',
          message: '告诉我们你的过敏原，确保推荐的食物绝对安全',
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
          title: '有没有忌口的食物？',
          message: '比如素食、不吃辣、低盐等，帮我们更好地过滤推荐',
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
          title: '你的烹饪水平如何？',
          message: '告诉我们你的厨艺，推荐更适合你的食谱',
          priority: 'low',
          dismissable: true,
          nextReminderDays: 30,
        });
      }

      if (!profile.budgetLevel) {
        reminders.push({
          type: 'settings_guide',
          field: 'budgetLevel',
          title: '你的饮食预算偏好？',
          message: '帮我们推荐更符合你预算的食物',
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
          title: '💪 告诉我们你的运动习惯',
          message:
            '运动用户的热量和蛋白质需求不同，完善运动信息可以让推荐更精准',
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
        title: '有特殊健康状况吗？',
        message: '如糖尿病、高血压等，确保推荐食物的安全性',
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
        title: '完善信息，提升推荐准确度',
        message: `当前信息完整度 ${Math.round(completeness * 100)}%，完善基本信息可提升推荐准确度约 30%`,
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
          title: `你似乎更喜欢「${categoryPreference}」类食物`,
          message: '我们注意到你连续多次替换为同类食物，是否确认这个偏好？',
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
    const foods = await this.prisma.foods.findMany({
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
    const inferred = await this.prisma.userInferredProfiles.findUnique({
      where: { userId: userId },
    });
    const goalProgress = inferred?.goalProgress as any;
    if (!goalProgress) return null;

    const { progressPercent, trend } = goalProgress;

    // 目标即将达成 (≥90%)
    if (progressPercent != null && progressPercent >= 90) {
      return {
        type: 'card',
        field: 'goal',
        title: '🎉 目标即将达成！',
        message: `你的目标已完成 ${Math.round(progressPercent)}%，是否设定新的目标？`,
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
        title: '📊 进展似乎有些停滞',
        message:
          '你的体重/指标近期波动不大，是否要调整目标速度或重新评估计划？',
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
      title: '🍽️ 我们可以帮你分析口味偏好',
      message: `你已记录 ${recordCount} 餐，系统可以根据你的饮食历史自动推断口味偏好，让推荐更精准`,
      priority: 'low',
      dismissable: true,
      nextReminderDays: 30,
    };
  }

  /** 品类代码 → 显示名称 */
  private categoryToDisplayName(category: string): string {
    const map: Record<string, string> = {
      protein: '蛋白质',
      grain: '谷物',
      veggie: '蔬菜',
      fruit: '水果',
      dairy: '乳制品',
      fat: '油脂',
      beverage: '饮品',
      snack: '零食',
      condiment: '调味品',
      composite: '复合菜肴',
    };
    return map[category] || category;
  }
}
