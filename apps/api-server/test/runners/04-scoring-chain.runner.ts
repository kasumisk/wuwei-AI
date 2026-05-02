/**
 * Runner 04: Scoring chain
 *
 * For each e2e user × mealType, samples 100 foods from the pool and calls
 * FoodScorerService.scoreFood(). Verifies:
 *   - Score is a number in [0, 1.5]
 *   - Score distribution is non-degenerate (>10 distinct rounded values)
 */

import {
  bootstrapAppContext,
  loadE2EUsers,
  MEAL_TYPES,
  macroSplit,
  makeLogger,
  shortErr,
  writeReport,
} from './lib/runner-utils';
import { FoodPoolCacheService } from '../../src/modules/diet/app/recommendation/pipeline/food-pool-cache.service';
import { FoodScorerService } from '../../src/modules/diet/app/recommendation/pipeline/food-scorer.service';

interface Cell {
  user: string;
  goal: string;
  meal: string;
  ok: boolean;
  scored: number;
  invalid: number;
  distinct: number;
  min: number;
  max: number;
  mean: number;
  err?: string;
  ms: number;
}

async function main() {
  const logger = makeLogger('04-Scoring');
  const app = await bootstrapAppContext();
  const pool = app.get(FoodPoolCacheService);
  const scorer = app.get(FoodScorerService);
  const users = await loadE2EUsers(app);

  const allFoods = await pool.getVerifiedFoods();
  scorer.setCategoryMicroDefaults(pool.getCategoryMicroAverages());
  // Stable sample: take first 100 by id
  const sample = allFoods.slice(0, 100);
  logger.log(`Pool=${allFoods.length} sample=${sample.length}`);

  const month = new Date().getMonth() + 1;

  const cells: Cell[] = [];
  for (const u of users) {
    for (const meal of MEAL_TYPES) {
      const start = Date.now();
      const { meal: mealTarget } = macroSplit(u.dailyCal, meal, u.goal, u.weightKg);
      let invalid = 0;
      const scores: number[] = [];
      try {
        for (const f of sample) {
          const s = scorer.scoreFood(
            f,
            u.goal,
            month,
            mealTarget,
            undefined,
            meal,
          );
          if (typeof s !== 'number' || Number.isNaN(s) || s < 0 || s > 1.5) {
            invalid++;
          } else {
            scores.push(s);
          }
        }
        const distinct = new Set(scores.map((s) => Math.round(s * 1000))).size;
        const min = scores.length ? Math.min(...scores) : 0;
        const max = scores.length ? Math.max(...scores) : 0;
        const mean = scores.length
          ? scores.reduce((a, b) => a + b, 0) / scores.length
          : 0;
        cells.push({
          user: u.email,
          goal: u.goal,
          meal,
          ok: invalid === 0 && distinct > 10,
          scored: scores.length,
          invalid,
          distinct,
          min: +min.toFixed(3),
          max: +max.toFixed(3),
          mean: +mean.toFixed(3),
          ms: Date.now() - start,
        });
      } catch (err) {
        cells.push({
          user: u.email,
          goal: u.goal,
          meal,
          ok: false,
          scored: scores.length,
          invalid,
          distinct: 0,
          min: 0,
          max: 0,
          mean: 0,
          err: shortErr(err),
          ms: Date.now() - start,
        });
      }
    }
  }

  const ok = cells.filter((c) => c.ok).length;
  const fail = cells.length - ok;

  const body =
    '| user | goal | meal | scored | invalid | distinct | min | max | mean | ms |\n|---|---|---|---|---|---|---|---|---|---|\n' +
    cells
      .map(
        (c) =>
          `| ${c.user} | ${c.goal} | ${c.meal} | ${c.scored} | ${c.invalid} | ${c.distinct} | ${c.min} | ${c.max} | ${c.mean} | ${c.ms} |`,
      )
      .join('\n');

  const failBody =
    cells.filter((c) => c.err).length === 0
      ? '_None._'
      : cells
          .filter((c) => c.err)
          .map((c) => `- ${c.user}|${c.meal}: ${(c.err || '').slice(0, 200)}`)
          .join('\n');

  const file = writeReport({
    moduleName: '04-scoring-chain',
    title: 'Scoring Chain Runner',
    summary: { cells: cells.length, ok, fail, sample: sample.length },
    sections: [
      { heading: 'Failures', body: failBody },
      { heading: 'Per-cell distribution', body },
    ],
  });

  logger.log(`cells=${cells.length} ok=${ok} fail=${fail}  report=${file}`);
  await app.close();
  process.exit(fail > 0 ? 2 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Runner 04 crashed:', err);
  process.exit(1);
});
