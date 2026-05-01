/**
 * 区域+时区优化（阶段 4.1 + P2-2.2）：价格适配因子
 *
 * 双路径软评分：
 *
 * 路径 A（精确预算，P2-2.2 新增）：
 *   - 触发条件：userProfile.declared.budgetPerMeal + currencyCode 存在
 *   - 数据源：FoodRegionalInfo.priceMin/priceMax/currencyCode/priceUnit
 *           （由 SeasonalityService.getPriceInfo 缓存暴露）
 *   - 跨币种：食物币种 ≠ 用户币种 → 因子跳过该食物（不加不减），trace=`currency_mismatch`
 *   - priceUnit 限制：仅识别 per_serving 系列（null/空/包含 "serving" 子串均视为可比）；
 *                     其他单位（per_kg / per_box 等）→ 回退路径 B
 *
 * 路径 B（旧逻辑，回退）：
 *   - 当路径 A 数据不全时，使用 budgetLevel × estimatedCostLevel 粗粒度匹配
 *
 * 评分曲线（路径 A，priceMid = (priceMin+priceMax)/2 或 priceMin）：
 *   - priceMid ≤ budget                → 1.05（完全在内，微加分）
 *   - budget < priceMid ≤ budget×1.30  → 0.85（轻度超支 ≤30%）
 *   - budget×1.30 < priceMid ≤ budget×1.80 → 0.70（中度超支 30-80%）
 *   - priceMid > budget×1.80           → 0.60（严重超支 >80%）
 *
 * 评分曲线（路径 B，估价等级 1-5）：
 *   - cost ≤ budgetMax → 1.05
 *   - 超出 1 级 → 0.85
 *   - 超出 2 级 → 0.70
 *   - 超出 3+ 级 → 0.60
 *
 * 设计原则：
 * - 软评分（不同于召回阶段的硬过滤）
 * - 跨币种"零外部依赖"策略：不引入汇率服务，币种不一致直接跳过
 * - 路径 A 失败 silent fallback 路径 B，确保始终可用（除非 budgetLevel 也缺失）
 */
import type { FoodLibrary } from '../../../../../food/food.types';
import type { PipelineContext } from '../../types/recommendation.types';
import type { FoodPriceInfo } from '../../utils/seasonality.service';
import type {
  ScoringAdjustment,
  ScoringFactor,
} from '../scoring-factor.interface';

/** budgetLevel → 最优 cost 上限（对应 estimatedCostLevel 1-5），路径 B 用 */
const BUDGET_MAX_COST: Record<string, number> = {
  low: 2,
  medium: 3,
  high: 5,
};

/** 路径 B：cost 超出 budget 级差 → 乘数 */
const OVERBUDGET_MULTIPLIER_LEGACY: Record<number, number> = {
  1: 0.85,
  2: 0.7,
  3: 0.6,
};

/** 路径 A：超支比例阈值 → 乘数 */
const OVER_30_PCT = 1.3;
const OVER_80_PCT = 1.8;

/**
 * 判断 priceUnit 是否为 per_serving 兼容单位
 *
 * 兼容：null / '' / 'per_serving' / 'serving' / 含 'serving' 子串
 * 拒绝：'per_kg' / 'per_box' / 'per_100g' 等
 */
function isPerServingCompatible(priceUnit: string | null): boolean {
  if (priceUnit == null) return true;
  const u = priceUnit.trim().toLowerCase();
  if (u === '') return true;
  return u.includes('serving');
}

export class PriceFitFactor implements ScoringFactor {
  readonly name = 'price-fit';
  readonly order = 20; // 在 regional-boost(15) 之后

  /** P2-2.2: 注入的食物价格查询函数（来自 SeasonalityService.getPriceInfo）
   *  P0-2: 签名增加 regionCode，避免跨 region 缓存污染。
   *        旧签名 (foodId) => FoodPriceInfo 仍兼容（regionCode 可选）
   */
  constructor(
    private readonly getPriceInfo: (
      foodId: string,
      regionCode?: string | null,
    ) => FoodPriceInfo,
  ) {}

  // ─── init 缓存 ───
  private budgetMaxLegacy = 5; // 路径 B
  private budgetPerMeal: number | null = null; // 路径 A
  private userCurrency: string | null = null; // 路径 A
  private hasExactBudget = false; // 是否启用路径 A

  isApplicable(ctx: PipelineContext): boolean {
    // 任一路径数据存在即启用
    const declared = (
      ctx.userProfile as { declared?: Record<string, unknown> } | undefined
    )?.declared;
    const hasExact =
      typeof declared?.['budgetPerMeal'] === 'number' &&
      typeof declared?.['currencyCode'] === 'string' &&
      (declared['budgetPerMeal'] as number) > 0;
    const hasLegacy =
      !!ctx.userProfile?.budgetLevel &&
      ctx.userProfile.budgetLevel in BUDGET_MAX_COST;
    return hasExact || hasLegacy;
  }

  init(ctx: PipelineContext): void {
    const declared = (
      ctx.userProfile as { declared?: Record<string, unknown> } | undefined
    )?.declared;
    const bpm = declared?.['budgetPerMeal'];
    const cc = declared?.['currencyCode'];
    if (typeof bpm === 'number' && bpm > 0 && typeof cc === 'string' && cc) {
      this.budgetPerMeal = bpm;
      this.userCurrency = cc.toUpperCase();
      this.hasExactBudget = true;
    } else {
      this.budgetPerMeal = null;
      this.userCurrency = null;
      this.hasExactBudget = false;
    }

    const bl = ctx.userProfile?.budgetLevel ?? 'high';
    this.budgetMaxLegacy = BUDGET_MAX_COST[bl] ?? 5;
  }

  computeAdjustment(
    food: FoodLibrary,
    _baseScore: number,
    ctx: PipelineContext,
  ): ScoringAdjustment | null {
    // ── 路径 A：精确预算 ──
    if (this.hasExactBudget && this.budgetPerMeal && this.userCurrency) {
      // P0-2: 透传 regionCode 到 SeasonalityService，避免跨 region 缓存污染
      const priceInfo = this.getPriceInfo(food.id, ctx.regionCode ?? null);
      const exactResult = this.tryExactPriceMatch(food, priceInfo);
      if (exactResult !== null) return exactResult; // 命中（含 currency_mismatch 跳过）
      // 否则 silent fallback 路径 B
    }

    // ── 路径 B：粗粒度 budgetLevel × estimatedCostLevel ──
    return this.computeLegacyAdjustment(food);
  }

  /**
   * 路径 A 主逻辑
   * @returns ScoringAdjustment | null（null 表示路径 A 数据不足，回退到路径 B）
   *          注意：currency_mismatch 不返回 null，而是返回 multiplier=1.0 的"跳过记录"
   */
  private tryExactPriceMatch(
    food: FoodLibrary,
    priceInfo: FoodPriceInfo,
  ): ScoringAdjustment | null {
    const { priceMin, priceMax, currencyCode, priceUnit } = priceInfo;

    // 数据缺失 → 回退 B
    if (priceMin == null || currencyCode == null) return null;

    // priceUnit 不兼容 → 回退 B
    if (!isPerServingCompatible(priceUnit)) return null;

    // 跨币种 → 跳过该食物（不加不减），路径 A 命中
    if (currencyCode.toUpperCase() !== this.userCurrency) {
      return {
        factorName: this.name,
        multiplier: 1.0,
        additive: 0,
        explanationKey: null,
        reason: `currency_mismatch (food=${currencyCode}, user=${this.userCurrency})`,
      };
    }

    // 命中：用 priceMid 与 budget 对比
    const priceMid =
      priceMax != null && priceMax >= priceMin
        ? (priceMin + priceMax) / 2
        : priceMin;
    const budget = this.budgetPerMeal!;

    let multiplier: number;
    let label: string;
    if (priceMid <= budget) {
      multiplier = 1.05;
      label = 'price_within_budget';
    } else if (priceMid <= budget * OVER_30_PCT) {
      multiplier = 0.85;
      label = 'price_over_30pct';
    } else if (priceMid <= budget * OVER_80_PCT) {
      multiplier = 0.7;
      label = 'price_over_80pct';
    } else {
      multiplier = 0.6;
      label = 'price_over_high';
    }

    return {
      factorName: this.name,
      multiplier,
      additive: 0,
      explanationKey: null,
      reason: `${label} (mid=${priceMid.toFixed(2)} ${currencyCode} vs budget=${budget.toFixed(2)})`,
    };
  }

  /** 路径 B：旧 budgetLevel × estimatedCostLevel 粗粒度逻辑 */
  private computeLegacyAdjustment(food: FoodLibrary): ScoringAdjustment {
    const cost = food.estimatedCostLevel ?? 2;
    const overBy = Math.max(0, cost - this.budgetMaxLegacy);

    if (overBy === 0) {
      return {
        factorName: this.name,
        multiplier: 1.05,
        additive: 0,
        explanationKey: null,
        reason: `price fit legacy (cost=${cost} ≤ max=${this.budgetMaxLegacy})`,
      };
    }

    const clampedOver = Math.min(overBy, 3) as 1 | 2 | 3;
    const multiplier = OVERBUDGET_MULTIPLIER_LEGACY[clampedOver] ?? 0.6;

    return {
      factorName: this.name,
      multiplier,
      additive: 0,
      explanationKey: null,
      reason: `price over budget legacy by ${overBy} (cost=${cost}, max=${this.budgetMaxLegacy})`,
    };
  }
}
