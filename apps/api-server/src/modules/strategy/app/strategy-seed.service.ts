/**
 * V6.3 P2-1 — 策略种子数据服务
 *
 * 在应用启动时检查并创建 4 套预设策略（如果尚未存在）。
 * 每套策略对应一个用户分群，通过 StrategySelectorService（P2-2）自动映射。
 *
 * 策略 → 分群映射:
 *   warm_start → new_user（新用户温启动）
 *   re_engage  → returning_user（回归用户召回）
 *   precision  → disciplined_loser / muscle_builder（精准营养）
 *   discovery  → casual_maintainer / active_maintainer（探索发现）
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import {
  StrategyConfig,
  StrategyScope,
  StrategyStatus,
} from '../strategy.types';

/** 预设策略定义 */
interface PresetStrategy {
  name: string;
  description: string;
  config: StrategyConfig;
  /** 是否作为全局默认策略（仅 discovery 是默认） */
  isDefault: boolean;
  priority: number;
}

/**
 * 4 套预设策略
 *
 * 每套策略定义 8 个维度的参数:
 * - recall: 召回源权重
 * - exploration: 探索率
 * - rank: 评分权重覆盖（可选）
 * - boost: 加分/惩罚调整（可选）
 * - assembly: 菜谱优先 / 多样性
 * - explain: 解释详细程度 / 雷达图
 * - multiObjective: 多目标权重（可选）
 * - meal: 餐次组合（保持默认）
 */
const PRESET_STRATEGIES: PresetStrategy[] = [
  {
    name: 'warm_start',
    description:
      '新用户温启动策略 — 热门食物优先 + 高探索率 + 简化解释，降低新用户认知负担',
    config: {
      recall: {
        sources: {
          rule: { enabled: true },
          popular: { enabled: true, weight: 0.5 },
          cf: { enabled: false },
          vector: { enabled: true, weight: 0.5 },
        },
      },
      exploration: {
        baseMin: 0.2,
        baseMax: 1.8,
        maturityShrink: 0.3,
        matureThreshold: 20,
      },
      assembly: {
        preferRecipe: true,
        diversityLevel: 'high',
      },
      explain: {
        detailLevel: 'simple',
        showNutritionRadar: false,
      },
    },
    isDefault: false,
    priority: 10,
  },
  {
    name: 're_engage',
    description:
      '回归用户策略 — 历史偏好食物优先 + 新品探索 15% + 标准解释，重建用户信任',
    config: {
      recall: {
        sources: {
          rule: { enabled: true },
          popular: { enabled: true, weight: 0.2 },
          cf: { enabled: true, weight: 0.3 },
          vector: { enabled: true, weight: 0.5 },
        },
      },
      exploration: {
        baseMin: 0.4,
        baseMax: 1.5,
        maturityShrink: 0.3,
        matureThreshold: 50,
      },
      boost: {
        preference: {
          lovesMultiplier: 1.2,
        },
      },
      assembly: {
        preferRecipe: true,
        diversityLevel: 'medium',
      },
      explain: {
        detailLevel: 'standard',
        showNutritionRadar: true,
      },
    },
    isDefault: false,
    priority: 10,
  },
  {
    name: 'precision',
    description:
      '精准营养策略 — 严格营养匹配 + 低探索率 + 详细营养解释，适合目标明确的用户',
    config: {
      recall: {
        sources: {
          rule: { enabled: true },
          popular: { enabled: true, weight: 0.1 },
          cf: { enabled: true, weight: 0.4 },
          vector: { enabled: true, weight: 0.5 },
        },
      },
      exploration: {
        baseMin: 0.5,
        baseMax: 1.3,
        maturityShrink: 0.2,
        matureThreshold: 30,
      },
      multiObjective: {
        enabled: true,
        preferences: {
          health: 0.5,
          taste: 0.25,
          cost: 0.1,
          convenience: 0.15,
        },
      },
      assembly: {
        preferRecipe: false,
        diversityLevel: 'low',
      },
      explain: {
        detailLevel: 'detailed',
        showNutritionRadar: true,
      },
    },
    isDefault: false,
    priority: 10,
  },
  {
    name: 'discovery',
    description:
      '探索发现策略 — 多样性优先 + 菜谱推荐 + 轻量解释，适合日常维持型用户',
    config: {
      recall: {
        sources: {
          rule: { enabled: true },
          popular: { enabled: true, weight: 0.3 },
          cf: { enabled: true, weight: 0.3 },
          vector: { enabled: true, weight: 0.4 },
        },
      },
      exploration: {
        baseMin: 0.3,
        baseMax: 1.6,
        maturityShrink: 0.3,
        matureThreshold: 50,
      },
      multiObjective: {
        enabled: true,
        preferences: {
          health: 0.35,
          taste: 0.35,
          cost: 0.15,
          convenience: 0.15,
        },
      },
      assembly: {
        preferRecipe: true,
        diversityLevel: 'high',
      },
      explain: {
        detailLevel: 'standard',
        showNutritionRadar: false,
      },
    },
    isDefault: true,
    priority: 0,
  },
];

@Injectable()
export class StrategySeedService implements OnModuleInit {
  private readonly logger = new Logger(StrategySeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    await this.seedPresetStrategies();
  }

  /**
   * 检查并创建预设策略（幂等操作）
   *
   * 逻辑:
   * 1. 对每个预设策略，按 name 查询是否已存在
   * 2. 如果不存在，创建为 ACTIVE 状态
   * 3. 如果已存在，跳过（不覆盖用户修改）
   * 4. discovery 策略额外标记为 scope=GLOBAL（全局默认）
   */
  private async seedPresetStrategies(): Promise<void> {
    let created = 0;
    let skipped = 0;

    for (const preset of PRESET_STRATEGIES) {
      const existing = await this.prisma.strategy.findFirst({
        where: { name: preset.name },
      });

      if (existing) {
        skipped++;
        continue;
      }

      await this.prisma.strategy.create({
        data: {
          name: preset.name,
          description: preset.description,
          scope: preset.isDefault
            ? StrategyScope.GLOBAL
            : StrategyScope.GOAL_TYPE,
          scope_target: preset.isDefault ? null : preset.name,
          config: preset.config as any,
          status: StrategyStatus.ACTIVE,
          priority: preset.priority,
          version: 1,
        },
      });
      created++;
    }

    if (created > 0) {
      this.logger.log(
        `V6.3 预设策略种子数据: 创建 ${created} 条, 跳过 ${skipped} 条`,
      );
    } else {
      this.logger.debug(`V6.3 预设策略种子数据: 全部已存在 (${skipped} 条)`);
    }
  }
}
