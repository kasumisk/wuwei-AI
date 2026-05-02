import { RecommendationEngineService } from '../../src/modules/diet/app/services/recommendation-engine.service';
import { DailyPlanService } from '../../src/modules/diet/app/services/daily-plan.service';
import { RecommendationFeedbackService } from '../../src/modules/diet/app/recommendation/feedback/feedback.service';
import { FactorLearnerService } from '../../src/modules/diet/app/recommendation/optimization/factor-learner.service';
import { WeightLearnerService } from '../../src/modules/diet/app/recommendation/optimization/weight-learner.service';
import { StrategyAutoTuner } from '../../src/modules/strategy/app/strategy-auto-tuner.service';
import { SeasonalityService } from '../../src/modules/diet/app/recommendation/utils/seasonality.service';
import { HealthModifierEngineService } from '../../src/modules/diet/app/recommendation/modifier/health-modifier-engine.service';
import { ProfileAggregatorService } from '../../src/modules/diet/app/recommendation/profile/profile-aggregator.service';
import { MetricsService } from '../../src/core/metrics/metrics.service';
import { PrismaService } from '../../src/core/prisma/prisma.service';
import { RedisCacheService } from '../../src/core/redis/redis-cache.service';
import { SCORE_WEIGHTS } from '../../src/modules/diet/app/recommendation/types/recommendation.types';
import type { MealRecommendation } from '../../src/modules/diet/app/recommendation/types/recommendation.types';
import type { MealTarget } from '../../src/modules/diet/app/recommendation/types/meal.types';
import type { ScoringAdjustment } from '../../src/modules/diet/app/recommendation/scoring-chain/scoring-factor.interface';
import {
  bootstrapAppContext,
  loadE2EUsers,
  macroSplit,
  makeLogger,
  type E2EUser,
} from './lib/runner-utils';
import * as fs from 'fs';
import * as path from 'path';

type GoalType = keyof typeof SCORE_WEIGHTS;

interface TimedResult<T> {
  ok: boolean;
  value?: T;
  latencyMs: number;
  error?: string;
}

interface RecommendationFingerprint {
  signature: string;
  explanation: string;
  duplicates: string[];
  abnormalFoods: string[];
}

interface PlanFingerprint {
  signature: string;
  explanation: string;
  duplicates: string[];
}

interface StabilitySummary {
  total: number;
  success: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  consistency: number;
  diversity: number;
  explanationConsistency: number;
  driftRate: number;
  duplicateHitRate: number;
  abnormalHitRate: number;
  topSignatures: Array<{ signature: string; count: number }>;
}

interface ConcurrentSummary {
  concurrency: number;
  total: number;
  success: number;
  errorRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  fallbackRate: number;
  duplicateHitRate: number;
  abnormalHitRate: number;
  scenarioErrorRate: number;
  crossUserDriftRate: number;
}

interface RedisPrefixStats {
  prefix: string;
  count: number;
  sampleKeys: string[];
}

interface LearningSummary {
  weightLearner: {
    beforeWeights: number[] | null;
    afterWeights: number[] | null;
    beforeSignature: string;
    afterSignature: string;
    changed: boolean;
    deltaL1: number;
    convergedOnSecondRun: boolean;
    concentrationBefore: number;
    concentrationAfter: number;
  };
  factorLearner: {
    passiveFeedbackCountBefore: number;
    passiveFeedbackCountAfter: number;
    passiveActivated: boolean;
    manualAdjustments: Record<string, number>;
    maxAdjustment: number;
    minAdjustment: number;
    fallbackConsistent: boolean;
  };
  strategyAutoTuner: {
    explorationGrid: Array<{
      interactions: number;
      convergence: number;
      rate: number;
    }>;
    minRate: number;
    maxRate: number;
    persistedAfterRestart: boolean;
  };
}

interface ExtremeCaseResult {
  name: string;
  ok: boolean;
  fallbackOk: boolean;
  latencyMs: number;
  signature?: string;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1),
  );
  return sorted[index];
}

function round(value: number, digits = 3): number {
  const base = 10 ** digits;
  return Math.round(value * base) / base;
}

function ratio(num: number, den: number): number {
  if (den <= 0) return 0;
  return num / den;
}

function shortErr(err: unknown): string {
  const raw = (err as Error)?.stack || (err as Error)?.message || String(err);
  return raw.split('\n').slice(0, 3).join(' | ');
}

function countDuplicates(items: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const item of items) {
    if (seen.has(item)) duplicates.add(item);
    seen.add(item);
  }
  return Array.from(duplicates).sort();
}

function fingerprintRecommendation(rec: MealRecommendation): RecommendationFingerprint {
  const foods = (rec.foods || []).map((item) => item.food.name);
  const explanation = [
    rec.displayText || '',
    rec.tip || '',
    rec.goalProgressTip || '',
    rec.phaseTransitionHint || '',
    (rec.dishExplanations || []).map((x) => x.narrative).join('|'),
  ].join(' || ');
  const abnormalFoods = foods.filter(
    (name) => !name || /^undefined|null$/i.test(name),
  );
  return {
    signature: [foods.join(' > '), rec.totalCalories, rec.totalProtein]
      .join(' || ')
      .trim(),
    explanation,
    duplicates: countDuplicates(foods),
    abnormalFoods,
  };
}

function fingerprintPlan(plan: any): PlanFingerprint {
  const mealKeys = ['morningPlan', 'lunchPlan', 'dinnerPlan', 'snackPlan'];
  const sections = mealKeys.map((key) => {
    const items = ((plan?.[key]?.foodItems || []) as Array<{ name: string }>).map(
      (item) => item.name,
    );
    return `${key}:${items.join(' > ')}`;
  });
  const allItems = mealKeys.flatMap((key) =>
    ((plan?.[key]?.foodItems || []) as Array<{ name: string }>).map(
      (item) => item.name,
    ),
  );
  return {
    signature: sections.join(' || '),
    explanation: JSON.stringify(plan?.strategy || null),
    duplicates: countDuplicates(allItems),
  };
}

function buildStabilitySummary(
  latencies: number[],
  fingerprints: RecommendationFingerprint[],
  errors: string[],
): StabilitySummary {
  const total = latencies.length + errors.length;
  const success = fingerprints.length;
  const signatureCount = new Map<string, number>();
  const explanationCount = new Map<string, number>();

  for (const fp of fingerprints) {
    signatureCount.set(fp.signature, (signatureCount.get(fp.signature) || 0) + 1);
    explanationCount.set(
      fp.explanation,
      (explanationCount.get(fp.explanation) || 0) + 1,
    );
  }

  const topSignatures = Array.from(signatureCount.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([signature, count]) => ({ signature, count }));

  let driftCount = 0;
  for (let i = 1; i < fingerprints.length; i++) {
    if (fingerprints[i].signature !== fingerprints[i - 1].signature) {
      driftCount++;
    }
  }

  const duplicateEvents = fingerprints.filter((fp) => fp.duplicates.length > 0).length;
  const abnormalEvents = fingerprints.filter((fp) => fp.abnormalFoods.length > 0).length;
  const topSignatureCount = topSignatures[0]?.count || 0;
  const topExplanationCount = Math.max(0, ...Array.from(explanationCount.values()));

  return {
    total,
    success,
    errorRate: round(ratio(errors.length, total)),
    avgLatencyMs: round(mean(latencies), 2),
    p95LatencyMs: round(percentile(latencies, 95), 2),
    p99LatencyMs: round(percentile(latencies, 99), 2),
    consistency: round(ratio(topSignatureCount, success)),
    diversity: round(ratio(signatureCount.size, success)),
    explanationConsistency: round(ratio(topExplanationCount, success)),
    driftRate: round(ratio(driftCount, Math.max(1, fingerprints.length - 1))),
    duplicateHitRate: round(ratio(duplicateEvents, success)),
    abnormalHitRate: round(ratio(abnormalEvents, success)),
    topSignatures,
  };
}

function buildPlanStabilitySummary(
  latencies: number[],
  fingerprints: PlanFingerprint[],
  errors: string[],
): StabilitySummary {
  const mapped = fingerprints.map<RecommendationFingerprint>((fp) => ({
    signature: fp.signature,
    explanation: fp.explanation,
    duplicates: fp.duplicates,
    abnormalFoods: [],
  }));
  return buildStabilitySummary(latencies, mapped, errors);
}

function macroTarget(user: E2EUser, mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack') {
  return macroSplit(user.dailyCal, mealType, user.goal, user.weightKg);
}

async function timed<T>(fn: () => Promise<T>): Promise<TimedResult<T>> {
  const started = Date.now();
  try {
    const value = await fn();
    return { ok: true, value, latencyMs: Date.now() - started };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      error: shortErr(err),
    };
  }
}

async function getCounterSnapshot(counter: any): Promise<Map<string, number>> {
  const snapshot = new Map<string, number>();
  const metric = await counter.get();
  for (const value of metric.values || []) {
    const key = JSON.stringify(value.labels || {});
    snapshot.set(key, Number(value.value) || 0);
  }
  return snapshot;
}

function diffCounter(
  before: Map<string, number>,
  after: Map<string, number>,
): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, afterValue] of after.entries()) {
    result[key] = afterValue - (before.get(key) || 0);
  }
  return result;
}

async function scanPrefix(
  redis: RedisCacheService,
  prefix: string,
  limit = 5,
): Promise<RedisPrefixStats> {
  const client = redis.getClient();
  let cursor = '0';
  let count = 0;
  const sampleKeys: string[] = [];

  do {
    const [nextCursor, keys] = await client.scan(
      cursor,
      'MATCH',
      `${prefix}*`,
      'COUNT',
      200,
    );
    cursor = nextCursor;
    count += keys.length;
    for (const key of keys) {
      if (sampleKeys.length < limit) sampleKeys.push(key);
    }
  } while (cursor !== '0');

  return { prefix, count, sampleKeys };
}

async function runStableMealCalls(
  engine: RecommendationEngineService,
  user: E2EUser,
  iterations: number,
): Promise<StabilitySummary> {
  const latencies: number[] = [];
  const fingerprints: RecommendationFingerprint[] = [];
  const errors: string[] = [];

  for (let i = 0; i < iterations; i++) {
    const { meal, daily } = macroTarget(user, 'lunch');
    const result = await timed(() =>
      engine.recommendMeal(
        user.id,
        'lunch',
        user.goal,
        { calories: 0, protein: 0 },
        meal,
        daily,
        {
          regionCode: user.region,
          timezone: user.profile.timezone ?? 'UTC',
          locale: user.locale,
          budgetLevel: user.profile.budgetLevel ?? 'medium',
        },
      ),
    );

    latencies.push(result.latencyMs);
    if (result.ok && result.value) {
      fingerprints.push(fingerprintRecommendation(result.value));
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  return buildStabilitySummary(latencies, fingerprints, errors);
}

async function runStableDailyPlanCalls(
  dailyPlanService: DailyPlanService,
  user: E2EUser,
  iterations: number,
): Promise<StabilitySummary> {
  const latencies: number[] = [];
  const fingerprints: PlanFingerprint[] = [];
  const errors: string[] = [];

  for (let i = 0; i < iterations; i++) {
    const result = await timed(() => dailyPlanService.regeneratePlan(user.id));
    latencies.push(result.latencyMs);
    if (result.ok && result.value) {
      fingerprints.push(fingerprintPlan(result.value));
    } else if (result.error) {
      errors.push(result.error);
    }
  }

  return buildPlanStabilitySummary(latencies, fingerprints, errors);
}

async function runConcurrentLoad(
  engine: RecommendationEngineService,
  users: E2EUser[],
  concurrency: number,
): Promise<ConcurrentSummary> {
  const latencies: number[] = [];
  const fingerprints: RecommendationFingerprint[] = [];
  const errors: string[] = [];
  let fallbackCount = 0;
  let scenarioErrors = 0;

  const regions = ['CN', 'US', 'AU', 'JP', 'GB'];
  const timezones = [
    'Asia/Shanghai',
    'America/Los_Angeles',
    'Australia/Sydney',
    'Asia/Tokyo',
    'Europe/London',
  ];
  const goals: GoalType[] = ['fat_loss', 'muscle_gain', 'health', 'habit'];

  const tasks = Array.from({ length: concurrency }, (_, index) => async () => {
    const user = users[index % users.length];
    const mealType = (['breakfast', 'lunch', 'dinner', 'snack'] as const)[
      index % 4
    ];
    const goal = goals[index % goals.length];
    const regionCode = regions[index % regions.length];
    const timezone = timezones[index % timezones.length];
    const { meal, daily } = macroSplit(user.dailyCal, mealType, goal, user.weightKg);
    const profileOverride = {
      regionCode,
      timezone,
      locale: user.locale,
      budgetPerMeal: index % 3 === 0 ? 0 : index % 3 === 1 ? 25 : 999,
      budgetLevel: index % 3 === 0 ? 'low' : index % 3 === 1 ? 'medium' : 'high',
    };
    const runScenario = index % 2 === 1;

    if (runScenario) {
      const result = await timed(() =>
        engine.recommendByScenario(
          user.id,
          mealType,
          goal,
          { calories: 0, protein: 0 },
          meal,
          daily,
          profileOverride,
        ),
      );
      latencies.push(result.latencyMs);
      if (!result.ok || !result.value) {
        scenarioErrors++;
        if (result.error) errors.push(result.error);
        return;
      }
      for (const rec of Object.values(result.value)) {
        const fp = fingerprintRecommendation(rec);
        fingerprints.push(fp);
        if ((rec.degradations || []).length > 0) fallbackCount++;
      }
      return;
    }

    const result = await timed(() =>
      engine.recommendMeal(
        user.id,
        mealType,
        goal,
        { calories: 0, protein: 0 },
        meal,
        daily,
        profileOverride,
      ),
    );
    latencies.push(result.latencyMs);
    if (!result.ok || !result.value) {
      if (result.error) errors.push(result.error);
      return;
    }
    const fp = fingerprintRecommendation(result.value);
    fingerprints.push(fp);
    if ((result.value.degradations || []).length > 0) fallbackCount++;
  });

  await Promise.all(tasks.map((task) => task()));

  const signatures = new Set(fingerprints.map((fp) => fp.signature));
  const duplicateEvents = fingerprints.filter((fp) => fp.duplicates.length > 0).length;
  const abnormalEvents = fingerprints.filter((fp) => fp.abnormalFoods.length > 0).length;

  return {
    concurrency,
    total: concurrency,
    success: concurrency - errors.length,
    errorRate: round(ratio(errors.length, concurrency)),
    avgLatencyMs: round(mean(latencies), 2),
    p95LatencyMs: round(percentile(latencies, 95), 2),
    p99LatencyMs: round(percentile(latencies, 99), 2),
    fallbackRate: round(ratio(fallbackCount, Math.max(1, fingerprints.length))),
    duplicateHitRate: round(ratio(duplicateEvents, Math.max(1, fingerprints.length))),
    abnormalHitRate: round(ratio(abnormalEvents, Math.max(1, fingerprints.length))),
    scenarioErrorRate: round(ratio(scenarioErrors, Math.ceil(concurrency / 2))),
    crossUserDriftRate: round(ratio(signatures.size, Math.max(1, fingerprints.length))),
  };
}

async function getRecommendationSignature(
  engine: RecommendationEngineService,
  user: E2EUser,
  goalType: GoalType,
  mealType: 'breakfast' | 'lunch' | 'dinner' | 'snack',
): Promise<string> {
  const { meal, daily } = macroSplit(user.dailyCal, mealType, goalType, user.weightKg);
  const rec = await engine.recommendMeal(
    user.id,
    mealType,
    goalType,
    { calories: 0, protein: 0 },
    meal,
    daily,
    {
      regionCode: user.region,
      timezone: user.profile.timezone ?? 'UTC',
      locale: user.locale,
    },
  );
  return fingerprintRecommendation(rec).signature;
}

async function runWeightLearnerValidation(
  engine: RecommendationEngineService,
  feedbackService: RecommendationFeedbackService,
  weightLearner: WeightLearnerService,
  user: E2EUser,
): Promise<LearningSummary['weightLearner']> {
  const mealType = 'lunch';
  const goalType = (user.goal in SCORE_WEIGHTS ? user.goal : 'health') as GoalType;
  const base = SCORE_WEIGHTS[goalType];
  const beforeWeights = await weightLearner.getUserMealWeights(
    user.id,
    goalType,
    mealType,
    base,
    user.region,
  );
  const beforeSignature = await getRecommendationSignature(
    engine,
    user,
    goalType,
    mealType,
  );

  const beforeBatch = await Promise.all(
    Array.from({ length: 12 }, async () =>
      getRecommendationSignature(engine, user, goalType, mealType),
    ),
  );
  const beforeConcentration = Math.max(
    ...Array.from(
      beforeBatch.reduce((map, sig) => {
        map.set(sig, (map.get(sig) || 0) + 1);
        return map;
      }, new Map<string, number>()).values(),
    ),
  ) / Math.max(1, beforeBatch.length);

  for (let i = 0; i < 12; i++) {
    const { meal, daily } = macroSplit(user.dailyCal, mealType, goalType, user.weightKg);
    const rec = await engine.recommendMeal(
      user.id,
      mealType,
      goalType,
      { calories: 0, protein: 0 },
      meal,
      daily,
      {
        regionCode: user.region,
        timezone: user.profile.timezone ?? 'UTC',
        locale: user.locale,
      },
    );
    const first = rec.foods?.[0];
    if (!first) continue;
    await sleep(50);
    await feedbackService.submitFeedback({
      userId: user.id,
      mealType,
      foodName: first.food.name,
      foodId: first.food.id,
      action: 'accepted',
      recommendationScore: first.score,
      goalType,
    });
  }

  await sleep(200);
  const firstLearn = await weightLearner.learn();
  const secondLearn = await weightLearner.learn();
  const afterWeights = await weightLearner.getUserMealWeights(
    user.id,
    goalType,
    mealType,
    base,
    user.region,
  );
  const afterSignature = await getRecommendationSignature(
    engine,
    user,
    goalType,
    mealType,
  );
  const afterBatch = await Promise.all(
    Array.from({ length: 12 }, async () =>
      getRecommendationSignature(engine, user, goalType, mealType),
    ),
  );
  const afterConcentration = Math.max(
    ...Array.from(
      afterBatch.reduce((map, sig) => {
        map.set(sig, (map.get(sig) || 0) + 1);
        return map;
      }, new Map<string, number>()).values(),
    ),
  ) / Math.max(1, afterBatch.length);

  const deltaL1 = afterWeights && beforeWeights
    ? afterWeights.reduce(
        (sum, weight, index) => sum + Math.abs(weight - (beforeWeights[index] || 0)),
        0,
      )
    : afterWeights
      ? afterWeights.reduce((sum, weight, index) => sum + Math.abs(weight - base[index]), 0)
      : 0;

  return {
    beforeWeights,
    afterWeights,
    beforeSignature,
    afterSignature,
    changed: deltaL1 > 0.0001 || beforeSignature !== afterSignature,
    deltaL1: round(deltaL1, 6),
    convergedOnSecondRun:
      JSON.stringify(firstLearn) === JSON.stringify(secondLearn),
    concentrationBefore: round(beforeConcentration),
    concentrationAfter: round(afterConcentration),
  };
}

async function runFactorLearnerValidation(
  factorLearner: FactorLearnerService,
  feedbackService: RecommendationFeedbackService,
  user: E2EUser,
): Promise<LearningSummary['factorLearner']> {
  const goalType = (user.goal in SCORE_WEIGHTS ? user.goal : 'health') as GoalType;
  const passiveFeedbackCountBefore = await factorLearner.getFeedbackCount(
    user.id,
    goalType,
  );

  for (let i = 0; i < 6; i++) {
    await feedbackService.submitFeedback({
      userId: user.id,
      mealType: 'dinner',
      foodName: `stability-factor-passive-${i}`,
      action: 'accepted',
      goalType,
    });
  }

  await sleep(100);
  const passiveFeedbackCountAfter = await factorLearner.getFeedbackCount(
    user.id,
    goalType,
  );

  const adjustments: ScoringAdjustment[] = [
    {
      factorName: 'price-fit',
      multiplier: 1.4,
      additive: 0,
      explanationKey: null,
      reason: 'stability-test',
    },
    {
      factorName: 'regional-boost',
      multiplier: 1.2,
      additive: 0,
      explanationKey: null,
      reason: 'stability-test',
    },
    {
      factorName: 'preference-signal',
      multiplier: 1.3,
      additive: 0,
      explanationKey: null,
      reason: 'stability-test',
    },
  ];

  for (let i = 0; i < 18; i++) {
    const attributions = factorLearner.attributeFeedback(
      adjustments,
      i < 12 ? 'accept' : 'reject',
    );
    await factorLearner.updateFactorWeights(user.id, goalType, attributions);
  }

  const redisBacked = await factorLearner.getUserFactorAdjustments(user.id, goalType);
  const originalHGetAll = (factorLearner as any).redis.hGetAll.bind((factorLearner as any).redis);
  (factorLearner as any).redis.hGetAll = async () => {
    throw new Error('forced redis read failure');
  };
  const fallbackRead = await factorLearner.getUserFactorAdjustments(user.id, goalType);
  (factorLearner as any).redis.hGetAll = originalHGetAll;

  const manualAdjustments = Object.fromEntries(
    Array.from(redisBacked.entries()).sort(([a], [b]) => a.localeCompare(b)),
  );
  const values = Array.from(redisBacked.values());

  return {
    passiveFeedbackCountBefore,
    passiveFeedbackCountAfter,
    passiveActivated: passiveFeedbackCountAfter > passiveFeedbackCountBefore,
    manualAdjustments,
    maxAdjustment: round(values.length ? Math.max(...values) : 0, 6),
    minAdjustment: round(values.length ? Math.min(...values) : 0, 6),
    fallbackConsistent:
      JSON.stringify(Array.from(redisBacked.entries())) ===
      JSON.stringify(Array.from(fallbackRead.entries())),
  };
}

async function runStrategyAutoTunerValidation(
  strategyAutoTuner: StrategyAutoTuner,
): Promise<LearningSummary['strategyAutoTuner']> {
  const points = [
    { interactions: 0, convergence: 0 },
    { interactions: 10, convergence: 0.2 },
    { interactions: 50, convergence: 0.5 },
    { interactions: 100, convergence: 0.8 },
    { interactions: 300, convergence: 1 },
  ];
  const explorationGrid = points.map((point) => ({
    ...point,
    rate: round(
      strategyAutoTuner.calcAdaptiveExplorationRate(
        point.interactions,
        point.convergence,
      ),
      6,
    ),
  }));

  const rates = explorationGrid.map((item) => item.rate);
  const segment = 'stability_test_segment';
  await strategyAutoTuner.setMapping(segment, 'precision');

  // 在同一进程内清空本地缓存并降版本，强制从 Redis 重载，近似验证重启后的持久化行为。
  (strategyAutoTuner as any).localCache.clear();
  (strategyAutoTuner as any).localVersion = -1;
  const persistedAfterRestart =
    (await strategyAutoTuner.getCurrentMappingAsync(segment)) === 'precision';

  return {
    explorationGrid,
    minRate: round(Math.min(...rates), 6),
    maxRate: round(Math.max(...rates), 6),
    persistedAfterRestart,
  };
}

async function runLearningValidation(
  engine: RecommendationEngineService,
  feedbackService: RecommendationFeedbackService,
  factorLearner: FactorLearnerService,
  weightLearner: WeightLearnerService,
  strategyAutoTuner: StrategyAutoTuner,
  user: E2EUser,
): Promise<LearningSummary> {
  return {
    weightLearner: await runWeightLearnerValidation(
      engine,
      feedbackService,
      weightLearner,
      user,
    ),
    factorLearner: await runFactorLearnerValidation(
      factorLearner,
      feedbackService,
      user,
    ),
    strategyAutoTuner: await runStrategyAutoTunerValidation(strategyAutoTuner),
  };
}

async function runLongRunningLoad(
  engine: RecommendationEngineService,
  users: E2EUser[],
): Promise<{
  total: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  fallbackRate: number;
  first100Consistency: number;
  last100Consistency: number;
  heapStartMb: number;
  heapEndMb: number;
  heapDeltaMb: number;
  rssStartMb: number;
  rssEndMb: number;
  rssDeltaMb: number;
}> {
  const total = 1000;
  const batchSize = 20;
  const latencies: number[] = [];
  const signatures: string[] = [];
  let errors = 0;
  let fallbackCount = 0;

  const memStart = process.memoryUsage();

  for (let offset = 0; offset < total; offset += batchSize) {
    const batch = Array.from({ length: batchSize }, (_, index) => {
      const requestIndex = offset + index;
      const user = users[requestIndex % users.length];
      const mealType = (['breakfast', 'lunch', 'dinner', 'snack'] as const)[
        requestIndex % 4
      ];
      const goalType = (['fat_loss', 'muscle_gain', 'health', 'habit'] as GoalType[])[
        requestIndex % 4
      ];
      const { meal, daily } = macroSplit(
        user.dailyCal,
        mealType,
        goalType,
        user.weightKg,
      );
      return timed(() =>
        engine.recommendMeal(
          user.id,
          mealType,
          goalType,
          { calories: 0, protein: 0 },
          meal,
          daily,
          {
            regionCode: user.region,
            timezone: user.profile.timezone ?? 'UTC',
            locale: user.locale,
          },
        ),
      );
    });

    const results = await Promise.all(batch);
    for (const result of results) {
      latencies.push(result.latencyMs);
      if (!result.ok || !result.value) {
        errors++;
        continue;
      }
      signatures.push(fingerprintRecommendation(result.value).signature);
      if ((result.value.degradations || []).length > 0) fallbackCount++;
    }
  }

  const memEnd = process.memoryUsage();
  const first100 = signatures.slice(0, 100);
  const last100 = signatures.slice(-100);
  const maxShare = (items: string[]) => {
    const counts = items.reduce((map, item) => {
      map.set(item, (map.get(item) || 0) + 1);
      return map;
    }, new Map<string, number>());
    return ratio(Math.max(0, ...Array.from(counts.values())), Math.max(1, items.length));
  };

  return {
    total,
    avgLatencyMs: round(mean(latencies), 2),
    p95LatencyMs: round(percentile(latencies, 95), 2),
    p99LatencyMs: round(percentile(latencies, 99), 2),
    errorRate: round(ratio(errors, total)),
    fallbackRate: round(ratio(fallbackCount, Math.max(1, signatures.length))),
    first100Consistency: round(maxShare(first100)),
    last100Consistency: round(maxShare(last100)),
    heapStartMb: round(memStart.heapUsed / 1024 / 1024, 2),
    heapEndMb: round(memEnd.heapUsed / 1024 / 1024, 2),
    heapDeltaMb: round((memEnd.heapUsed - memStart.heapUsed) / 1024 / 1024, 2),
    rssStartMb: round(memStart.rss / 1024 / 1024, 2),
    rssEndMb: round(memEnd.rss / 1024 / 1024, 2),
    rssDeltaMb: round((memEnd.rss - memStart.rss) / 1024 / 1024, 2),
  };
}

async function runExtremeCases(
  engine: RecommendationEngineService,
  profileAggregator: ProfileAggregatorService,
  user: E2EUser,
): Promise<ExtremeCaseResult[]> {
  const baseMealType = 'lunch';
  const goalType = (user.goal in SCORE_WEIGHTS ? user.goal : 'health') as GoalType;
  const { meal, daily } = macroSplit(user.dailyCal, baseMealType, goalType, user.weightKg);

  const cases: Array<{ name: string; run: () => Promise<MealRecommendation> }> = [
    {
      name: 'empty-profile',
      run: () =>
        engine.recommendMeal(
          user.id,
          baseMealType,
          goalType,
          { calories: 0, protein: 0 },
          meal,
          daily,
          {},
        ),
    },
    {
      name: 'budget-zero',
      run: () =>
        engine.recommendMeal(
          user.id,
          baseMealType,
          goalType,
          { calories: 0, protein: 0 },
          meal,
          daily,
          { budgetPerMeal: 0, budgetLevel: 'low', regionCode: user.region },
        ),
    },
    {
      name: 'budget-huge',
      run: () =>
        engine.recommendMeal(
          user.id,
          baseMealType,
          goalType,
          { calories: 0, protein: 0 },
          meal,
          daily,
          { budgetPerMeal: 999999, budgetLevel: 'high', regionCode: user.region },
        ),
    },
    {
      name: 'region-missing',
      run: () =>
        engine.recommendMeal(
          user.id,
          baseMealType,
          goalType,
          { calories: 0, protein: 0 },
          meal,
          daily,
          { timezone: user.profile.timezone ?? 'UTC' },
        ),
    },
    {
      name: 'timezone-invalid',
      run: () =>
        engine.recommendMeal(
          user.id,
          baseMealType,
          goalType,
          { calories: 0, protein: 0 },
          meal,
          daily,
          {
            regionCode: user.region,
            timezone: 'Mars/Phobos',
          },
        ),
    },
    {
      name: 'channel-invalid',
      run: async () => {
        const profile = await profileAggregator.aggregateForRecommendation(
          user.id,
          baseMealType,
        );
        const allFoods = await engine.getAllFoods();
        return engine.recommendMealFromPool({
          allFoods,
          mealType: baseMealType,
          goalType,
          consumed: { calories: 0, protein: 0 },
          target: meal,
          dailyTarget: daily,
          excludeNames: [],
          userId: user.id,
          userProfile: {
            ...profile.enrichedProfile,
            regionCode: user.region,
            timezone: user.profile.timezone ?? 'UTC',
          },
          feedbackStats: profile.feedbackStats,
          preferenceProfile: profile.preferenceProfile,
          regionalBoostMap: profile.regionalBoostMap,
          channel: 'illegal-channel' as any,
        });
      },
    },
  ];

  const results: ExtremeCaseResult[] = [];
  for (const item of cases) {
    const result = await timed(item.run);
    results.push({
      name: item.name,
      ok: result.ok,
      fallbackOk:
        !!result.value && Array.isArray(result.value.foods) && result.value.foods.length > 0,
      latencyMs: result.latencyMs,
      signature: result.value ? fingerprintRecommendation(result.value).signature : undefined,
      error: result.error,
    });
  }
  return results;
}

function identifyRisks(params: {
  stableMeal: StabilitySummary;
  stablePlan: StabilitySummary;
  concurrent: ConcurrentSummary[];
  learning: LearningSummary;
  longRun: Awaited<ReturnType<typeof runLongRunningLoad>>;
  extremes: ExtremeCaseResult[];
  redisAfter: RedisPrefixStats[];
  logSummary: { warns: number; errors: number; seasonalityMissingRegionWarns: number };
}): Array<{ level: 'P0' | 'P1' | 'P2'; issue: string; evidence: string }> {
  const risks: Array<{ level: 'P0' | 'P1' | 'P2'; issue: string; evidence: string }> = [];

  if (params.learning.factorLearner.passiveActivated === false) {
    risks.push({
      level: 'P0',
      issue: 'FactorLearner 未接入真实反馈链路',
      evidence:
        `提交真实反馈后 feedbackCount 仍为 ${params.learning.factorLearner.passiveFeedbackCountAfter}，` +
        '说明线上反馈不会驱动 factorAdjustments。',
    });
  }

  if (params.logSummary.seasonalityMissingRegionWarns > 0) {
    risks.push({
      level: 'P1',
      issue: 'Seasonality caller 仍存在 regionCode 缺失告警',
      evidence: `捕获到 ${params.logSummary.seasonalityMissingRegionWarns} 条相关告警。`,
    });
  }

  if (params.longRun.heapDeltaMb > 80 || params.longRun.rssDeltaMb > 150) {
    risks.push({
      level: 'P1',
      issue: '长时间运行存在明显内存增长',
      evidence:
        `heap +${params.longRun.heapDeltaMb}MB, rss +${params.longRun.rssDeltaMb}MB after ${params.longRun.total} calls.`,
    });
  }

  if (
    params.stableMeal.driftRate > 0.35 ||
    params.stableMeal.consistency < 0.6 ||
    params.stablePlan.driftRate > 0.35
  ) {
    risks.push({
      level: 'P1',
      issue: '同输入推荐存在明显漂移',
      evidence:
        `meal consistency=${params.stableMeal.consistency}, meal drift=${params.stableMeal.driftRate}, ` +
        `plan drift=${params.stablePlan.driftRate}.`,
    });
  }

  if (params.concurrent.some((item) => item.errorRate > 0.02 || item.p99LatencyMs > 3000)) {
    risks.push({
      level: 'P1',
      issue: '高并发下存在稳定性或性能瓶颈',
      evidence: params.concurrent
        .map(
          (item) =>
            `${item.concurrency}并发 err=${item.errorRate}, p99=${item.p99LatencyMs}ms`,
        )
        .join('; '),
    });
  }

  if (params.extremes.some((item) => !item.ok)) {
    risks.push({
      level: 'P2',
      issue: '极端输入未全部平稳降级',
      evidence: params.extremes
        .filter((item) => !item.ok)
        .map((item) => `${item.name}: ${item.error}`)
        .join('; '),
    });
  }

  if (
    params.redisAfter.find((item) => item.prefix === 'seasonality:region:undefined') ||
    params.redisAfter.find((item) => item.prefix === 'seasonality:region:null')
  ) {
    risks.push({
      level: 'P2',
      issue: 'Seasonality Redis key 存在异常前缀',
      evidence: '扫描到 undefined/null 前缀 key。',
    });
  }

  return risks;
}

function markdownTable(headers: string[], rows: string[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.join(' | ')} |`).join('\n');
  return [head, sep, body].filter(Boolean).join('\n');
}

async function main() {
  const logger = makeLogger('09-Stability');
  const logBuffer = { warns: [] as string[], errors: [] as string[] };
  const originalWarn = console.warn.bind(console);
  const originalError = console.error.bind(console);

  console.warn = (...args: unknown[]) => {
    logBuffer.warns.push(args.map((arg) => String(arg)).join(' '));
    originalWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    logBuffer.errors.push(args.map((arg) => String(arg)).join(' '));
    originalError(...args);
  };

  const app = await bootstrapAppContext();

  try {
    const engine = app.get(RecommendationEngineService);
    const dailyPlanService = app.get(DailyPlanService);
    const feedbackService = app.get(RecommendationFeedbackService);
    const factorLearner = app.get(FactorLearnerService);
    const weightLearner = app.get(WeightLearnerService);
    const strategyAutoTuner = app.get(StrategyAutoTuner);
    const seasonalityService = app.get(SeasonalityService);
    const healthModifier = app.get(HealthModifierEngineService);
    const profileAggregator = app.get(ProfileAggregatorService);
    const metrics = app.get(MetricsService);
    const prisma = app.get(PrismaService);
    const redis = app.get(RedisCacheService);
    const users = await loadE2EUsers(app);

    if (users.length === 0) {
      throw new Error('No seeded e2e users found');
    }

    const primaryUser = users[0];
    const cacheBefore = await Promise.all([
      scanPrefix(redis, 'seasonality:region:'),
      scanPrefix(redis, 'health_mod:'),
      scanPrefix(redis, 'factor_learner:'),
      scanPrefix(redis, 'weight_learner:'),
      scanPrefix(redis, 'strategy:segment_map'),
    ]);
    const cacheCounterBefore = await getCounterSnapshot(metrics.cacheOperations);

    await seasonalityService.preloadRegion('CN');
    await seasonalityService.preloadRegion('US');

    const stableMeal = await runStableMealCalls(engine, primaryUser, 60);
    const stablePlan = await runStableDailyPlanCalls(dailyPlanService, primaryUser, 50);
    const concurrent = [] as ConcurrentSummary[];
    for (const level of [20, 50, 100]) {
      concurrent.push(await runConcurrentLoad(engine, users, level));
    }

    const learning = await runLearningValidation(
      engine,
      feedbackService,
      factorLearner,
      weightLearner,
      strategyAutoTuner,
      primaryUser,
    );

    const longRun = await runLongRunningLoad(engine, users);
    const extremes = await runExtremeCases(engine, profileAggregator, primaryUser);

    const cacheCounterAfter = await getCounterSnapshot(metrics.cacheOperations);
    const cacheAfter = await Promise.all([
      scanPrefix(redis, 'seasonality:region:'),
      scanPrefix(redis, 'health_mod:'),
      scanPrefix(redis, 'factor_learner:'),
      scanPrefix(redis, 'weight_learner:'),
      scanPrefix(redis, 'strategy:segment_map'),
    ]);
    const cacheDelta = diffCounter(cacheCounterBefore, cacheCounterAfter);

    const seasonalRegionsInMemory = Array.from(
      ((seasonalityService as any).regionalCacheByRegion as Map<string, Map<string, unknown>>).keys(),
    );
    const preloadInflight = ((seasonalityService as any).preloadInProgress as Map<string, Promise<void>>).size;
    const feedbackStatsCacheSize = ((feedbackService as any).feedbackStatsCache as Map<string, unknown>).size;
    const factorRedisKey = `factor_learner:${primaryUser.id}:${primaryUser.goal}`;
    const factorRedisPayload = await redis.hGetAll(factorRedisKey);
    const healthContextA = healthModifier.hashContext({
      allergens: ['dairy'],
      goalType: 'fat_loss',
      healthConditions: [],
    });
    const healthContextB = healthModifier.hashContext({
      allergens: ['peanut'],
      goalType: 'fat_loss',
      healthConditions: [],
    });
    const sampleTraceCount = await prisma.recommendationTraces.count({
      where: { userId: primaryUser.id },
    });

    const logSummary = {
      warns: logBuffer.warns.length,
      errors: logBuffer.errors.length,
      seasonalityMissingRegionWarns: logBuffer.warns.filter((line) =>
        line.includes('without regionCode'),
      ).length,
    };

    const risks = identifyRisks({
      stableMeal,
      stablePlan,
      concurrent,
      learning,
      longRun,
      extremes,
      redisAfter: cacheAfter,
      logSummary,
    });

    const overallLatencies = [
      stableMeal.avgLatencyMs,
      stablePlan.avgLatencyMs,
      ...concurrent.map((item) => item.avgLatencyMs),
      longRun.avgLatencyMs,
    ];

    const cacheHit = Object.entries(cacheDelta)
      .filter(([key]) => key.includes('"result":"hit"'))
      .reduce((sum, [, value]) => sum + value, 0);
    const cacheMiss = Object.entries(cacheDelta)
      .filter(([key]) => key.includes('"result":"miss"'))
      .reduce((sum, [, value]) => sum + value, 0);

    const report = [
      '# Recommendation System Stability Report',
      '',
      `Generated: ${new Date().toISOString()}`,
      '',
      '## 压测配置',
      '',
      '- 连续稳定性: `recommendMeal` 60 次，同一用户；`daily plan regenerate` 50 次，同一用户。',
      '- 并发压测: 20 / 50 / 100 并发，请求混合 `recommendMeal` 与 `recommendByScenario`。',
      '- 长时间运行: 1000 次推荐调用，20 并发批处理。',
      '- 学习系统: WeightLearner 实际反馈+重训；FactorLearner 被动链路 + 手工更新 + Redis fallback；StrategyAutoTuner 探索率与重启持久化。',
      '- 极端输入: 空画像、预算 0、超大预算、缺失 region、非法 timezone、非法 channel。',
      '',
      '## 并发情况',
      '',
      markdownTable(
        ['concurrency', 'success', 'errorRate', 'avgMs', 'p95Ms', 'p99Ms', 'fallbackRate', 'scenarioErrorRate'],
        concurrent.map((item) => [
          String(item.concurrency),
          `${item.success}/${item.total}`,
          String(item.errorRate),
          String(item.avgLatencyMs),
          String(item.p95LatencyMs),
          String(item.p99LatencyMs),
          String(item.fallbackRate),
          String(item.scenarioErrorRate),
        ]),
      ),
      '',
      '## 指标数据',
      '',
      markdownTable(
        ['metric', 'value'],
        [
          ['推荐一致性 same-input meal', String(stableMeal.consistency)],
          ['推荐一致性 same-input daily-plan', String(stablePlan.consistency)],
          ['推荐多样性 meal', String(stableMeal.diversity)],
          ['推荐多样性 daily-plan', String(stablePlan.diversity)],
          ['cache 命中率', String(round(ratio(cacheHit, cacheHit + cacheMiss)))],
          ['平均响应时间', String(round(mean(overallLatencies), 2))],
          ['P95 延迟', String(Math.max(stableMeal.p95LatencyMs, stablePlan.p95LatencyMs, ...concurrent.map((c) => c.p95LatencyMs), longRun.p95LatencyMs))],
          ['P99 延迟', String(Math.max(stableMeal.p99LatencyMs, stablePlan.p99LatencyMs, ...concurrent.map((c) => c.p99LatencyMs), longRun.p99LatencyMs))],
          ['错误率', String(round(mean([stableMeal.errorRate, stablePlan.errorRate, ...concurrent.map((c) => c.errorRate), longRun.errorRate])))],
          ['fallback 触发率', String(round(mean([stableMeal.driftRate, ...concurrent.map((c) => c.fallbackRate), longRun.fallbackRate])))],
          ['learning 变化趋势 Weight deltaL1', String(learning.weightLearner.deltaL1)],
        ],
      ),
      '',
      '## 连续调用稳定性',
      '',
      markdownTable(
        ['case', 'consistency', 'diversity', 'explanationConsistency', 'driftRate', 'duplicateHitRate', 'abnormalHitRate', 'avgMs'],
        [
          [
            'recommendMeal x60',
            String(stableMeal.consistency),
            String(stableMeal.diversity),
            String(stableMeal.explanationConsistency),
            String(stableMeal.driftRate),
            String(stableMeal.duplicateHitRate),
            String(stableMeal.abnormalHitRate),
            String(stableMeal.avgLatencyMs),
          ],
          [
            'daily-plan regenerate x50',
            String(stablePlan.consistency),
            String(stablePlan.diversity),
            String(stablePlan.explanationConsistency),
            String(stablePlan.driftRate),
            String(stablePlan.duplicateHitRate),
            String(stablePlan.abnormalHitRate),
            String(stablePlan.avgLatencyMs),
          ],
        ],
      ),
      '',
      'Top stable meal signatures:',
      ...stableMeal.topSignatures.map(
        (item) => `- ${item.count}x ${item.signature.slice(0, 180)}`,
      ),
      '',
      '## Cache 行为验证',
      '',
      markdownTable(
        ['prefix', 'before', 'after', 'sample'],
        cacheAfter.map((item, index) => [
          item.prefix,
          String(cacheBefore[index]?.count ?? 0),
          String(item.count),
          item.sampleKeys.join('<br/>') || '-',
        ]),
      ),
      '',
      '- SeasonalityService memory regions: ' + seasonalRegionsInMemory.join(', '),
      `- Seasonality inflight preload count after tests: ${preloadInflight}`,
      `- HealthModifier context hash isolation sample: dairy=${healthContextA}, peanut=${healthContextB}`,
      `- FactorLearner redis key sample: ${factorRedisKey}`,
      `- FactorLearner redis fields: ${JSON.stringify(factorRedisPayload || {})}`,
      `- ProfileAggregator related cache observation: feedbackStatsCache.size=${feedbackStatsCacheSize}`,
      `- cache counter delta: ${JSON.stringify(cacheDelta)}`,
      '',
      '## 学习系统验证',
      '',
      '### WeightLearner',
      '',
      markdownTable(
        ['beforeSignature', 'afterSignature', 'changed', 'deltaL1', 'convergedSecondRun', 'concentrationBefore', 'concentrationAfter'],
        [[
          learning.weightLearner.beforeSignature.slice(0, 80),
          learning.weightLearner.afterSignature.slice(0, 80),
          String(learning.weightLearner.changed),
          String(learning.weightLearner.deltaL1),
          String(learning.weightLearner.convergedOnSecondRun),
          String(learning.weightLearner.concentrationBefore),
          String(learning.weightLearner.concentrationAfter),
        ]],
      ),
      '',
      '### FactorLearner',
      '',
      markdownTable(
        ['passiveFeedbackBefore', 'passiveFeedbackAfter', 'passiveActivated', 'minAdjustment', 'maxAdjustment', 'fallbackConsistent'],
        [[
          String(learning.factorLearner.passiveFeedbackCountBefore),
          String(learning.factorLearner.passiveFeedbackCountAfter),
          String(learning.factorLearner.passiveActivated),
          String(learning.factorLearner.minAdjustment),
          String(learning.factorLearner.maxAdjustment),
          String(learning.factorLearner.fallbackConsistent),
        ]],
      ),
      '',
      `- manual factorAdjustments: ${JSON.stringify(learning.factorLearner.manualAdjustments)}`,
      '',
      '### StrategyAutoTuner',
      '',
      markdownTable(
        ['interactions', 'convergence', 'rate'],
        learning.strategyAutoTuner.explorationGrid.map((item) => [
          String(item.interactions),
          String(item.convergence),
          String(item.rate),
        ]),
      ),
      '',
      `- exploration min/max: ${learning.strategyAutoTuner.minRate} / ${learning.strategyAutoTuner.maxRate}`,
      `- persisted after restart: ${learning.strategyAutoTuner.persistedAfterRestart}`,
      '',
      '## 长时间运行测试',
      '',
      markdownTable(
        ['totalCalls', 'avgMs', 'p95Ms', 'p99Ms', 'errorRate', 'fallbackRate', 'first100Consistency', 'last100Consistency'],
        [[
          String(longRun.total),
          String(longRun.avgLatencyMs),
          String(longRun.p95LatencyMs),
          String(longRun.p99LatencyMs),
          String(longRun.errorRate),
          String(longRun.fallbackRate),
          String(longRun.first100Consistency),
          String(longRun.last100Consistency),
        ]],
      ),
      '',
      markdownTable(
        ['memory', 'startMb', 'endMb', 'deltaMb'],
        [
          ['heapUsed', String(longRun.heapStartMb), String(longRun.heapEndMb), String(longRun.heapDeltaMb)],
          ['rss', String(longRun.rssStartMb), String(longRun.rssEndMb), String(longRun.rssDeltaMb)],
        ],
      ),
      '',
      '## 极端输入稳定性',
      '',
      markdownTable(
        ['case', 'ok', 'fallbackOk', 'latencyMs', 'error'],
        extremes.map((item) => [
          item.name,
          String(item.ok),
          String(item.fallbackOk),
          String(item.latencyMs),
          item.error || '-',
        ]),
      ),
      '',
      '## 发现问题',
      '',
      ...(risks.length > 0
        ? risks.map((risk) => `- [${risk.level}] ${risk.issue}: ${risk.evidence}`)
        : ['- 未发现达到 P0/P1 门槛的新问题。']),
      '',
      '## 风险评估 (P0/P1/P2)',
      '',
      ...(risks.length > 0
        ? risks.map((risk) => `- ${risk.level}: ${risk.issue}`)
        : ['- P2: 无新增显著风险。']),
      '',
      '## 其他观测',
      '',
      `- recommendation_traces for primary user: ${sampleTraceCount}`,
      `- log warns/errors captured: ${logSummary.warns}/${logSummary.errors}`,
      `- seasonality missing-region warns: ${logSummary.seasonalityMissingRegionWarns}`,
      '',
      '## 是否适合上线',
      '',
      risks.some((risk) => risk.level === 'P0')
        ? 'No - 存在 P0 风险，当前不适合上线。'
        : risks.some((risk) => risk.level === 'P1')
          ? 'No - 仍有 P1 风险未清零，建议先修复再上线。'
          : 'Yes - 本轮未发现阻塞上线的问题。',
      '',
    ].join('\n');

    const outPath = path.resolve(
      __dirname,
      '../../../../docs/recommendation-system-stability-report.md',
    );
    fs.writeFileSync(outPath, report, 'utf8');
    logger.log(`report=${outPath}`);
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
    await app.close();
  }
}

main().catch((err) => {
  console.error('Runner 09 crashed:', err);
  process.exit(1);
});
