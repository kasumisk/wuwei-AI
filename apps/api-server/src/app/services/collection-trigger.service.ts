import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserProfile } from '../../entities/user-profile.entity';
import { UserBehaviorProfile } from '../../entities/user-behavior-profile.entity';

/**
 * 持续收集触发器
 * 根据使用天数和已填字段，生成持续收集提醒
 *
 * 触发规则：
 * - 使用 7 天 + Step 3 未填 → 提醒 allergens, dietaryRestrictions
 * - 连续替换同类食物 ≥ 3 次 → 确认偏好（Toast）
 * - 使用 14 天 → cookingSkillLevel, budgetLevel
 * - 使用 30 天 → exerciseProfile
 * - 目标达成/停滞 → 调整 goal, goalSpeed
 * - 累计记录 ≥ 50 次 → tasteIntensity（可自动推断）
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
    @InjectRepository(UserProfile)
    private readonly profileRepo: Repository<UserProfile>,
    @InjectRepository(UserBehaviorProfile)
    private readonly behaviorRepo: Repository<UserBehaviorProfile>,
  ) {}

  /**
   * 检查并返回需要收集的字段提醒
   * 由客户端在 App 打开时调用
   */
  async checkCollectionTriggers(userId: string): Promise<CollectionReminder[]> {
    const [profile, behavior] = await Promise.all([
      this.profileRepo.findOne({ where: { userId } }),
      this.behaviorRepo.findOne({ where: { userId } }),
    ]);

    if (!profile) return [];

    const reminders: CollectionReminder[] = [];
    const completeness = Number(profile.dataCompleteness || 0);
    const usageDays = behavior?.totalRecords || 0;

    // ── 规则 1: 使用 7 天 + Step 3 核心字段未填 ──
    if (usageDays >= 7) {
      if (!profile.allergens || profile.allergens.length === 0) {
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

      if (!profile.dietaryRestrictions || profile.dietaryRestrictions.length === 0) {
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
      const exerciseProfile = profile.exerciseProfile as Record<string, any> | null;
      if (!exerciseProfile || Object.keys(exerciseProfile).length === 0) {
        reminders.push({
          type: 'card',
          field: 'exerciseProfile',
          title: '💪 告诉我们你的运动习惯',
          message: '运动用户的热量和蛋白质需求不同，完善运动信息可以让推荐更精准',
          priority: 'medium',
          dismissable: true,
          nextReminderDays: 30,
        });
      }
    }

    // ── 规则 4: 健康状况未填 + 完整度低 ──
    if (
      usageDays >= 7 &&
      (!profile.healthConditions || profile.healthConditions.length === 0) &&
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

    // 按优先级排序，每次最多返回 2 条提醒（避免骚扰）
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    reminders.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    return reminders.slice(0, 2);
  }
}
