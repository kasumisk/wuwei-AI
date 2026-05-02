/**
 * Runner 07: End-to-end aggregate
 *
 * Sequentially runs recommendMeal + recommendByScenario for every cell and
 * captures aggregate latency / error-rate baselines for the debug report.
 */

import {
  bootstrapAppContext,
  loadE2EUsers,
  MEAL_TYPES,
  SCENARIOS,
  macroSplit,
  makeLogger,
  shortErr,
  writeReport,
} from './lib/runner-utils';
import { RecommendationEngineService } from '../../src/modules/diet/app/services/recommendation-engine.service';

interface Cell {
  user: string;
  goal: string;
  region: string;
  meal: string;
  recommendMealOk: boolean;
  recommendMealMs: number;
  scenarioOk: boolean;
  scenarioMs: number;
  err?: string;
}

async function main() {
  const logger = makeLogger('07-EndToEnd');
  const app = await bootstrapAppContext();
  const engine = app.get(RecommendationEngineService);
  const users = await loadE2EUsers(app);

  const cells: Cell[] = [];
  for (const u of users) {
    for (const meal of MEAL_TYPES) {
      const { meal: mealTarget, daily } = macroSplit(
        u.dailyCal,
        meal,
        u.goal,
        u.weightKg,
      );

      // recommendMeal
      let mOk = false;
      let mMs = 0;
      let err: string | undefined;
      const t1 = Date.now();
      try {
        const r = await engine.recommendMeal(
          u.id,
          meal,
          u.goal,
          { calories: 0, protein: 0 },
          mealTarget,
          daily,
        );
        mOk = !!r && r.foods?.length > 0;
      } catch (e) {
        err = shortErr(e);
      }
      mMs = Date.now() - t1;

      // recommendByScenario
      let sOk = false;
      let sMs = 0;
      const t2 = Date.now();
      try {
        const r = await engine.recommendByScenario(
          u.id,
          meal,
          u.goal,
          { calories: 0, protein: 0 },
          mealTarget,
          daily,
        );
        sOk = SCENARIOS.every(
          (s) => !!(r as any)[s] && (r as any)[s].foods?.length > 0,
        );
      } catch (e) {
        err = err || shortErr(e);
      }
      sMs = Date.now() - t2;

      cells.push({
        user: u.email,
        goal: u.goal,
        region: u.region,
        meal,
        recommendMealOk: mOk,
        recommendMealMs: mMs,
        scenarioOk: sOk,
        scenarioMs: sMs,
        err,
      });
    }
  }

  const totalMeal = cells.length;
  const okMeal = cells.filter((c) => c.recommendMealOk).length;
  const okScn = cells.filter((c) => c.scenarioOk).length;
  const meanMealMs = Math.round(
    cells.reduce((a, c) => a + c.recommendMealMs, 0) / totalMeal,
  );
  const meanScnMs = Math.round(
    cells.reduce((a, c) => a + c.scenarioMs, 0) / totalMeal,
  );

  const body =
    '| user | meal | mealOk | mealMs | scenarioOk | scenarioMs | err |\n|---|---|---|---|---|---|---|\n' +
    cells
      .map(
        (c) =>
          `| ${c.user} | ${c.meal} | ${c.recommendMealOk} | ${c.recommendMealMs} | ${c.scenarioOk} | ${c.scenarioMs} | ${(c.err || '').slice(0, 100)} |`,
      )
      .join('\n');

  const file = writeReport({
    moduleName: '07-end-to-end',
    title: 'End-to-End Runner',
    summary: {
      cells: totalMeal,
      mealOk: okMeal,
      scenarioOk: okScn,
      meanMealMs,
      meanScenarioMs: meanScnMs,
    },
    sections: [{ heading: 'Per-cell', body }],
  });

  logger.log(
    `cells=${totalMeal} mealOk=${okMeal} scnOk=${okScn} meanMeal=${meanMealMs}ms meanScn=${meanScnMs}ms  report=${file}`,
  );
  await app.close();
  process.exit(okMeal === totalMeal && okScn === totalMeal ? 0 : 2);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Runner 07 crashed:', err);
  process.exit(1);
});
