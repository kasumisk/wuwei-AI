/**
 * 区域+时区优化（阶段 3.1 + 3.2）：区域候选过滤
 *
 * 在 RealisticFilter 之后、scoring 之前应用，基于 food_regional_info 数据：
 *
 * 阶段 3.1 — Availability 过滤：
 *   - 剔除 availability='RARE' 或 'LIMITED' 的食物
 *   - 保留 YEAR_ROUND / SEASONAL / null（无数据视为可用）
 *
 * 阶段 3.2 — RegulatoryInfo 过滤：
 *   - 剔除 regulatoryInfo.forbidden=true 的食物
 *
 * 兜底策略：过滤后候选数 < MIN_CANDIDATES 时跳过过滤，保留原候选池。
 */
import { Injectable, Logger } from '@nestjs/common';
import { FoodLibrary } from '../../../../food/food.types';
import { SeasonalityService } from '../utils/seasonality.service';

/** 过滤后至少保留的候选数量（与 RealisticFilter 对齐） */
const MIN_CANDIDATES = 5;

/** 被视为"稀缺/不可获取"的 availability 值，直接剔除 */
const UNAVAILABLE_STATUSES = new Set(['RARE', 'LIMITED']);

@Injectable()
export class RegionalCandidateFilterService {
  private readonly logger = new Logger(RegionalCandidateFilterService.name);

  constructor(private readonly seasonalityService: SeasonalityService) {}

  /**
   * 对召回候选执行区域可用性 + 法规过滤
   *
   * @param candidates recall 后的候选食物列表
   * @param regionCode 当前用户区域代码（仅用于日志）
   * @returns 过滤后的候选列表（不足 MIN_CANDIDATES 时返回原列表）
   */
  filter(candidates: FoodLibrary[], regionCode: string): FoodLibrary[] {
    if (!candidates.length) return candidates;

    const filtered = candidates.filter((food) => {
      // 阶段 3.2：法规禁止（P0-2: 显式传 regionCode 防止跨 region 污染）
      if (this.seasonalityService.isRegulatoryForbidden(food.id, regionCode)) {
        return false;
      }

      // 阶段 3.1：availability 不可用状态
      const avail = this.seasonalityService.getAvailability(food.id, regionCode);
      if (avail !== null && UNAVAILABLE_STATUSES.has(avail)) {
        return false;
      }

      return true;
    });

    // 兜底：过滤后不足最小候选数时放弃过滤
    if (filtered.length < MIN_CANDIDATES) {
      this.logger.debug(
        `[RegionalFilter] region=${regionCode}: filtered=${filtered.length} < MIN(${MIN_CANDIDATES}), skipping filter`,
      );
      return candidates;
    }

    const removedCount = candidates.length - filtered.length;
    if (removedCount > 0) {
      this.logger.debug(
        `[RegionalFilter] region=${regionCode}: removed ${removedCount} candidates ` +
          `(RARE/LIMITED/forbidden), remaining=${filtered.length}`,
      );
    }

    return filtered;
  }
}
