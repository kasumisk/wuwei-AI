import { ScoredFood, MealTarget } from '../types/recommendation.types';

/**
 * Global Constraint Optimizer (V4 Phase 4.2 → V5 Phase 2.2 升级)
 *
 * 现有系统按餐次贪心选择食物，全局最优性无法保证：
 * - 早餐多选了碳水 → 午/晚餐碳水预算被挤压
 * - 某一餐蛋白质不足 → 全天蛋白质不达标
 *
 * 本模块在贪心选择后，对全天 4 餐的食物组合做全局微调：
 * 1. 计算全天实际营养 vs 目标偏差（6 维：cal/protein/fat/carbs/fiber/GL）
 * 2. 搜索最优单步动作（食物替换 或 份量调整 ±10%/±20%）
 * 3. 替换条件：替换后全天偏差减小 + 该餐评分不显著降低
 *
 * V5 改进：
 * - 偏差维度从 4 → 6（新增 fiber、glycemicLoad）
 * - 迭代次数从 8 → 12
 * - 新增份量微调动作（portion_adjust），允许 ±10%/±20% 调整
 * - 偏差权重重新分配（降低 cal/protein 权重，为新维度让出空间）
 *
 * 设计限制（实用性优先）：
 * - 不使用 LP/整数规划库（避免引入重量级依赖）
 * - 使用迭代贪心改进（iterative greedy improvement），默认最多 24 轮（参数 maxIterations）
 * - 每轮最多执行 1 个动作（替换或份量调整）
 * - 替换分数下降不超过 25%（默认 minScoreRatio=0.75，保证推荐质量；可由调用方覆写）
 */

// ─── V5 偏差权重配置（P1-1: fat/carbs 权重提升，覆盖四宏量均衡） ───
const DEVIATION_WEIGHTS = {
  calories: 0.22, // V4: 0.35 / V5: 0.30 → P1-1: 0.22
  protein: 0.22, // V4: 0.30 / V5: 0.25 → P1-1: 0.22
  fat: 0.2, // V4: 0.15 / V5: 0.12 → P1-1: 0.20（fat +73% 偏差的核心修复）
  carbs: 0.2, // V4: 0.20 / V5: 0.15 → P1-1: 0.20
  fiber: 0.1, // V5 新增
  glycemicLoad: 0.06, // V5: 0.08 → P1-1: 0.06
};

/** V5: 份量调整倍数选项 */
const PORTION_MULTIPLIERS = [0.8, 0.9, 1.1, 1.2];

/** 单餐的食物组合 + 候选池 */
export interface MealSlot {
  mealType: string;
  picks: ScoredFood[];
  candidates: ScoredFood[]; // 该餐的 Top-N 候选（包含未选中的）
  target: MealTarget;
}

/** 优化结果 */
export interface OptimizationResult {
  meals: MealSlot[];
  /** 优化前的全天偏差率（0-1，越小越好） */
  deviationBefore: number;
  /** 优化后的全天偏差率 */
  deviationAfter: number;
  /** 执行的替换/调整次数 */
  swapCount: number;
}

/**
 * 全局约束优化器 — 迭代贪心改进
 *
 * @param meals 4 餐的食物选择 + 候选池
 * @param dailyTarget 全天营养目标
 * @param maxIterations 最大迭代轮数（默认 24，与 minScoreRatio 协同收敛）
 * @param minScoreRatio 允许的最低评分比（替换后评分 / 替换前评分 >= 此值；默认 0.75）
 */
export function optimizeDailyPlan(
  meals: MealSlot[],
  dailyTarget: MealTarget,
  maxIterations = 24,
  minScoreRatio = 0.75,
): OptimizationResult {
  // 深拷贝，避免修改输入
  const mealSlots: MealSlot[] = meals.map((m) => ({
    mealType: m.mealType,
    picks: m.picks.map((p) => ({ ...p })),
    candidates: m.candidates,
    target: { ...m.target },
  }));

  const deviationBefore = calcDailyDeviation(mealSlots, dailyTarget);
  let currentDeviation = deviationBefore;
  let swapCount = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    // 搜索最佳食物替换
    const bestSwap = findBestSwap(mealSlots, dailyTarget, minScoreRatio);
    // 搜索最佳份量调整
    const bestPortion = findBestPortionAdjust(mealSlots, dailyTarget);

    // 选择偏差改进最大的动作
    const swapImprovement =
      bestSwap && bestSwap.newDeviation < currentDeviation
        ? currentDeviation - bestSwap.newDeviation
        : 0;
    const portionImprovement =
      bestPortion && bestPortion.newDeviation < currentDeviation
        ? currentDeviation - bestPortion.newDeviation
        : 0;

    if (swapImprovement <= 0 && portionImprovement <= 0) {
      break; // 没有可改进的动作了
    }

    if (swapImprovement >= portionImprovement && bestSwap) {
      // 执行食物替换
      const slot = mealSlots[bestSwap.mealIndex];
      slot.picks[bestSwap.pickIndex] = bestSwap.replacement;
      currentDeviation = bestSwap.newDeviation;
    } else if (bestPortion) {
      // 执行份量调整
      const slot = mealSlots[bestPortion.mealIndex];
      const pick = slot.picks[bestPortion.pickIndex];
      const m = bestPortion.multiplier;
      slot.picks[bestPortion.pickIndex] = {
        ...pick,
        servingCalories: Math.round(pick.servingCalories * m),
        servingProtein: Math.round(pick.servingProtein * m),
        servingFat: Math.round(pick.servingFat * m),
        servingCarbs: Math.round(pick.servingCarbs * m),
        servingFiber: Math.round(pick.servingFiber * m),
        // GL 不按份量线性缩放，使用近似比例
        servingGL: Math.round(pick.servingGL * m),
      };
      currentDeviation = bestPortion.newDeviation;
    }

    swapCount++;
  }

  return {
    meals: mealSlots,
    deviationBefore,
    deviationAfter: currentDeviation,
    swapCount,
  };
}

// ─── 食物替换搜索 ───

/** 替换候选描述 */
interface SwapCandidate {
  mealIndex: number;
  pickIndex: number;
  replacement: ScoredFood;
  newDeviation: number;
}

/**
 * 在所有餐次的所有 pick 位上，搜索使全天偏差最小的单步替换
 */
function findBestSwap(
  meals: MealSlot[],
  dailyTarget: MealTarget,
  minScoreRatio: number,
): SwapCandidate | null {
  let best: SwapCandidate | null = null;

  for (let mi = 0; mi < meals.length; mi++) {
    const slot = meals[mi];

    for (let pi = 0; pi < slot.picks.length; pi++) {
      const currentPick = slot.picks[pi];
      const currentPickIds = new Set(slot.picks.map((p) => p.food.id));

      for (const candidate of slot.candidates) {
        // 跳过已选中的和同一食物
        if (currentPickIds.has(candidate.food.id)) continue;

        // 评分下降检查
        if (candidate.score < currentPick.score * minScoreRatio) continue;

        // 多样性快速检查：不允许和同餐其他 pick 同品类超过 2 个
        const otherCategories = slot.picks
          .filter((_, idx) => idx !== pi)
          .map((p) => p.food.category);
        const catCount = otherCategories.filter(
          (c) => c === candidate.food.category,
        ).length;
        if (catCount >= 2) continue;

        // 模拟替换，计算新偏差
        const originalPick = slot.picks[pi];
        slot.picks[pi] = candidate;
        const newDeviation = calcDailyDeviation(meals, dailyTarget);
        slot.picks[pi] = originalPick; // 恢复

        if (!best || newDeviation < best.newDeviation) {
          best = {
            mealIndex: mi,
            pickIndex: pi,
            replacement: candidate,
            newDeviation,
          };
        }
      }
    }
  }

  return best;
}

// ─── V5: 份量调整搜索 ───

/** 份量调整候选描述 */
interface PortionCandidate {
  mealIndex: number;
  pickIndex: number;
  multiplier: number;
  newDeviation: number;
}

/**
 * 搜索最佳份量调整动作
 * 对每个 pick 尝试 ±10%/±20% 的份量缩放，选择全天偏差最小的
 */
function findBestPortionAdjust(
  meals: MealSlot[],
  dailyTarget: MealTarget,
): PortionCandidate | null {
  let best: PortionCandidate | null = null;

  for (let mi = 0; mi < meals.length; mi++) {
    const slot = meals[mi];

    for (let pi = 0; pi < slot.picks.length; pi++) {
      const originalPick = slot.picks[pi];

      for (const multiplier of PORTION_MULTIPLIERS) {
        // 模拟份量调整
        slot.picks[pi] = {
          ...originalPick,
          servingCalories: Math.round(
            originalPick.servingCalories * multiplier,
          ),
          servingProtein: Math.round(originalPick.servingProtein * multiplier),
          servingFat: Math.round(originalPick.servingFat * multiplier),
          servingCarbs: Math.round(originalPick.servingCarbs * multiplier),
          servingFiber: Math.round(originalPick.servingFiber * multiplier),
          servingGL: Math.round(originalPick.servingGL * multiplier),
        };

        const newDeviation = calcDailyDeviation(meals, dailyTarget);
        slot.picks[pi] = originalPick; // 恢复

        if (!best || newDeviation < best.newDeviation) {
          best = {
            mealIndex: mi,
            pickIndex: pi,
            multiplier,
            newDeviation,
          };
        }
      }
    }
  }

  return best;
}

// ─── 偏差计算 ───

/**
 * 计算全天营养偏差率（V5: 6 维加权）
 *
 * 维度（权重以 DEVIATION_WEIGHTS 常量为准）:
 * 1. 热量 (calories: 0.22)
 * 2. 蛋白质 (protein: 0.22)
 * 3. 脂肪 (fat: 0.20)
 * 4. 碳水 (carbs: 0.20)
 * 5. 膳食纤维 (fiber: 0.10)
 * 6. 血糖负荷 (glycemicLoad: 0.06)
 *
 * 值域 [0, +∞)，0 表示完美匹配
 */
function calcDailyDeviation(
  meals: MealSlot[],
  dailyTarget: MealTarget,
): number {
  let totalCal = 0;
  let totalProtein = 0;
  let totalFat = 0;
  let totalCarbs = 0;
  let totalFiber = 0;
  let totalGL = 0;

  for (const slot of meals) {
    for (const pick of slot.picks) {
      totalCal += pick.servingCalories;
      totalProtein += pick.servingProtein;
      totalFat += pick.servingFat;
      totalCarbs += pick.servingCarbs;
      totalFiber += pick.servingFiber;
      totalGL += pick.servingGL;
    }
  }

  const calDev =
    dailyTarget.calories > 0
      ? Math.abs(totalCal - dailyTarget.calories) / dailyTarget.calories
      : 0;
  const proteinDev =
    dailyTarget.protein > 0
      ? Math.abs(totalProtein - dailyTarget.protein) / dailyTarget.protein
      : 0;
  const fatDev =
    dailyTarget.fat > 0
      ? Math.abs(totalFat - dailyTarget.fat) / dailyTarget.fat
      : 0;
  const carbsDev =
    dailyTarget.carbs > 0
      ? Math.abs(totalCarbs - dailyTarget.carbs) / dailyTarget.carbs
      : 0;

  // fiber 偏差：目标值可选，无目标时不计入
  const fiberTarget = dailyTarget.fiber || 0;
  const fiberDev =
    fiberTarget > 0 ? Math.abs(totalFiber - fiberTarget) / fiberTarget : 0;

  // GL 偏差：以上限为目标，超过上限才有偏差（低于上限视为达标）
  const glTarget = dailyTarget.glycemicLoad || 0;
  const glDev = glTarget > 0 ? Math.max(0, totalGL - glTarget) / glTarget : 0;

  return (
    calDev * DEVIATION_WEIGHTS.calories +
    proteinDev * DEVIATION_WEIGHTS.protein +
    fatDev * DEVIATION_WEIGHTS.fat +
    carbsDev * DEVIATION_WEIGHTS.carbs +
    fiberDev * DEVIATION_WEIGHTS.fiber +
    glDev * DEVIATION_WEIGHTS.glycemicLoad
  );
}

/**
 * 计算全天实际营养总量
 */
export function calcDailyActual(meals: MealSlot[]): MealTarget {
  let totalCal = 0;
  let totalProtein = 0;
  let totalFat = 0;
  let totalCarbs = 0;
  let totalFiber = 0;
  let totalGL = 0;

  for (const slot of meals) {
    for (const pick of slot.picks) {
      totalCal += pick.servingCalories;
      totalProtein += pick.servingProtein;
      totalFat += pick.servingFat;
      totalCarbs += pick.servingCarbs;
      totalFiber += pick.servingFiber;
      totalGL += pick.servingGL;
    }
  }

  return {
    calories: Math.round(totalCal),
    protein: Math.round(totalProtein),
    fat: Math.round(totalFat),
    carbs: Math.round(totalCarbs),
    fiber: Math.round(totalFiber),
    glycemicLoad: Math.round(totalGL),
  };
}
