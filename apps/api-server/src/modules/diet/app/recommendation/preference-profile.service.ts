import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FoodRecord } from '../../entities/food-record.entity';
import { RecommendationFeedback } from '../../entities/recommendation-feedback.entity';
import { FoodRegionalInfo } from '../../../food/entities/food-regional-info.entity';
import { UserPreferenceProfile } from './recommendation.types';

/**
 * 用户偏好画像服务 (V4 Phase 2.2 — 从 RecommendationEngineService 提取)
 *
 * 职责:
 * - 构建用户偏好画像: getUserPreferenceProfile()
 * - 获取地区感知偏移: getRegionalBoostMap()
 * - 获取近期食物名: getRecentFoodNames()
 */
@Injectable()
export class PreferenceProfileService {
  private readonly logger = new Logger(PreferenceProfileService.name);

  constructor(
    @InjectRepository(RecommendationFeedback)
    private readonly feedbackRepo: Repository<RecommendationFeedback>,
    @InjectRepository(FoodRecord)
    private readonly foodRecordRepo: Repository<FoodRecord>,
    @InjectRepository(FoodRegionalInfo)
    private readonly regionalInfoRepo: Repository<FoodRegionalInfo>,
  ) {}

  /**
   * 构建用户偏好画像 — 从反馈记录按 category/mainIngredient/foodGroup 聚合
   * 返回三维偏好乘数：接受率高 → >1.0（最高1.3），接受率低 → <1.0（最低0.3）
   * 至少需要3条反馈才纳入统计，避免小样本噪声
   */
  async getUserPreferenceProfile(
    userId: string,
  ): Promise<UserPreferenceProfile> {
    const empty: UserPreferenceProfile = {
      categoryWeights: {},
      ingredientWeights: {},
      foodGroupWeights: {},
      foodNameWeights: {},
    };

    try {
      const since = new Date();
      since.setDate(since.getDate() - 60); // 60天窗口

      // JOIN 反馈表和食物库，获取分类维度
      const rows: Array<{
        action: string;
        category: string;
        main_ingredient: string;
        food_group: string;
        food_name: string;
        created_at: Date | string;
      }> = await this.feedbackRepo.query(
        `SELECT rf.action, rf.food_name, rf.created_at,
                fl.category, fl.main_ingredient, fl.food_group
         FROM recommendation_feedbacks rf
         LEFT JOIN food_library fl ON fl.id = rf.food_id
         WHERE rf.user_id = $1
           AND rf.created_at >= $2`,
        [userId, since],
      );

      if (rows.length < 3) return empty;

      // 按维度聚合统计
      const aggregate = (
        keyFn: (r: (typeof rows)[0]) => string,
      ): Record<string, number> => {
        const stats: Record<string, { accepted: number; total: number }> = {};
        for (const row of rows) {
          const key = keyFn(row);
          if (!key) continue;
          if (!stats[key]) stats[key] = { accepted: 0, total: 0 };
          stats[key].total++;
          if (row.action === 'accepted') stats[key].accepted++;
        }

        const result: Record<string, number> = {};
        for (const [key, s] of Object.entries(stats)) {
          if (s.total < 3) continue; // 至少3条数据
          const rate = s.accepted / s.total;
          // 映射到 0.3~1.3: rate=0 → 0.3, rate=0.5 → 0.8, rate=1 → 1.3
          result[key] = 0.3 + rate * 1.0;
        }
        return result;
      };

      // 按食物名构建偏好 — 指数衰减加权，映射到 0.7~1.2
      // 比 category 范围窄，避免食物名级别过拟合
      const foodNameWeights: Record<string, number> = {};
      const now = Date.now();
      const nameStats: Record<
        string,
        { weightedAccepted: number; weightedTotal: number }
      > = {};

      for (const row of rows) {
        const name = row.food_name;
        if (!name) continue;
        if (!nameStats[name])
          nameStats[name] = { weightedAccepted: 0, weightedTotal: 0 };

        // 计算反馈距今天数，应用指数衰减 e^(-0.05 × days)
        const createdAt =
          row.created_at instanceof Date
            ? row.created_at
            : new Date(row.created_at);
        const daysSince = Math.floor(
          (now - createdAt.getTime()) / (1000 * 60 * 60 * 24),
        );
        const decayWeight = Math.exp(-0.05 * daysSince);

        nameStats[name].weightedTotal += decayWeight;
        if (row.action === 'accepted') {
          nameStats[name].weightedAccepted += decayWeight;
        }
      }

      for (const [name, s] of Object.entries(nameStats)) {
        if (s.weightedTotal < 1.5) continue; // 至少约2条有效数据
        const rate = s.weightedAccepted / s.weightedTotal;
        // 映射到 0.7~1.2: rate=0 → 0.7, rate=0.5 → 0.95, rate=1 → 1.2
        foodNameWeights[name] = 0.7 + rate * 0.5;
      }

      return {
        categoryWeights: aggregate((r) => r.category),
        ingredientWeights: aggregate((r) => r.main_ingredient),
        foodGroupWeights: aggregate((r) => r.food_group),
        foodNameWeights,
      };
    } catch (err) {
      this.logger.warn(`构建偏好画像失败: ${err}`);
      return empty;
    }
  }

  /**
   * 获取指定地区的食物评分偏移映射
   * 返回 foodId → 乘数 (0.85 ~ 1.08)
   *   common + 高流行度 → 1.05~1.08（本地常见食物加分）
   *   common → 1.02（可获得但流行度一般）
   *   seasonal → 0.95（季节性，获取不稳定）
   *   rare → 0.85（当地罕见，获取困难）
   *   无数据 → 不在映射中（×1.0 不调整）
   */
  async getRegionalBoostMap(region: string): Promise<Record<string, number>> {
    const boostMap: Record<string, number> = {};
    try {
      const infos = await this.regionalInfoRepo.find({
        where: { region },
      });

      for (const info of infos) {
        let boost = 1.0;
        switch (info.availability) {
          case 'common':
            // 高流行度的常见食物额外加分
            boost = info.localPopularity > 50 ? 1.08 : 1.02;
            break;
          case 'seasonal':
            boost = 0.95;
            break;
          case 'rare':
            boost = 0.85;
            break;
        }
        if (boost !== 1.0) {
          boostMap[info.foodId] = boost;
        }
      }
    } catch (err) {
      this.logger.warn(`加载地区信息失败 [${region}]: ${err}`);
    }
    return boostMap;
  }

  /**
   * 获取用户近期记录的食物名（用于多样性去重）
   */
  async getRecentFoodNames(userId: string, days: number): Promise<string[]> {
    try {
      const since = new Date();
      since.setDate(since.getDate() - days);

      const records: Array<{ name: string }> = await this.foodRecordRepo.query(
        `SELECT DISTINCT food_item->>'name' AS name
         FROM food_records fr
         CROSS JOIN LATERAL jsonb_array_elements(fr.foods) AS food_item
         WHERE fr.user_id = $1
           AND fr.recorded_at >= $2`,
        [userId, since],
      );

      return records.map((r) => r.name);
    } catch {
      return [];
    }
  }
}
