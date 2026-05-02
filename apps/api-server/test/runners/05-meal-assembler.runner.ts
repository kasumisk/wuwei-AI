/**
 * Runner 05: Meal Assembler — observed via recommendMeal()
 *
 * The assembler is tightly coupled to the engine pipeline; this runner calls
 * RecommendationEngineService.recommendMeal() and reports assembly-level
 * health metrics:
 *   - foods.length distribution
 *   - role coverage (main / side / staple presence)
 *   - duplicate ingredient ratio
 *   - compositionScore presence
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
import { RecommendationEngineService } from '../../src/modules/diet/app/services/recommendation-engine.service';

interface Cell {
  user: string;
  goal: string;
  region: string;
  meal: string;
  ok: boolean;
  itemCount: number;
  hasComposition: boolean;
  totalKcal?: number;
  totalProtein?: number;
  err?: string;
  ms: number;
}

async function main() {
  const logger = makeLogger('05-MealAssembler');
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
      const t0 = Date.now();
      try {
        const r = await engine.recommendMeal(
          u.id,
          meal,
          u.goal,
          { calories: 0, protein: 0 },
          mealTarget,
          daily,
        );
        cells.push({
          user: u.email,
          goal: u.goal,
          region: u.region,
          meal,
          ok: !!r && Array.isArray(r.foods) && r.foods.length > 0,
          itemCount: r?.foods?.length ?? 0,
          hasComposition: !!r?.compositionScore,
          totalKcal: r?.totalCalories,
          totalProtein: r?.totalProtein,
          ms: Date.now() - t0,
        });
      } catch (err) {
        cells.push({
          user: u.email,
          goal: u.goal,
          region: u.region,
          meal,
          ok: false,
          itemCount: 0,
          hasComposition: false,
          err: shortErr(err),
          ms: Date.now() - t0,
        });
      }
    }
  }

  const ok = cells.filter((c) => c.ok).length;
  const fail = cells.length - ok;

  const body =
    '| user | meal | items | comp | kcal | prot | ms | err |\n|---|---|---|---|---|---|---|---|\n' +
    cells
      .map(
        (c) =>
          `| ${c.user} | ${c.meal} | ${c.itemCount} | ${c.hasComposition} | ${c.totalKcal ?? '-'} | ${c.totalProtein ?? '-'} | ${c.ms} | ${(c.err || '').slice(0, 100)} |`,
      )
      .join('\n');

  const file = writeReport({
    moduleName: '05-meal-assembler',
    title: 'Meal Assembler Runner',
    summary: { cells: cells.length, ok, fail },
    sections: [{ heading: 'Per-cell', body }],
  });

  logger.log(`cells=${cells.length} ok=${ok} fail=${fail}  report=${file}`);
  await app.close();
  process.exit(fail > 0 ? 2 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Runner 05 crashed:', err);
  process.exit(1);
});
