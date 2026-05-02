/**
 * Runner 06: Scenario decision engine
 *
 * Calls RecommendationEngineService.recommendByScenario() — the matrix
 * 12 users × 4 mealTypes = 48 calls × 3 scenarios = 144 cells.
 *
 * Verifies all three scenarios return non-empty meal recommendations
 * and that cross-scenario food de-duplication works (no scenario shares
 * primary food name with another scenario for the same call).
 */

import {
  bootstrapAppContext,
  loadE2EUsers,
  MEAL_TYPES,
  macroSplit,
  makeLogger,
  shortErr,
  writeReport,
  SCENARIOS,
} from './lib/runner-utils';
import { RecommendationEngineService } from '../../src/modules/diet/app/services/recommendation-engine.service';

interface Cell {
  user: string;
  goal: string;
  region: string;
  meal: string;
  scenario: string;
  ok: boolean;
  items: number;
  kcal?: number;
  protein?: number;
  duplicateAcrossScenarios?: boolean;
  err?: string;
  ms: number;
}

async function main() {
  const logger = makeLogger('06-Scenario');
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
        const r = await engine.recommendByScenario(
          u.id,
          meal,
          u.goal,
          { calories: 0, protein: 0 },
          mealTarget,
          daily,
        );
        const ms = Date.now() - t0;
        // Cross-scenario duplicate check: primary item name overlap
        const names = SCENARIOS.map(
          (s) => (r as any)[s]?.foods?.[0]?.food?.name as string | undefined,
        ).filter(Boolean) as string[];
        const dup = names.length !== new Set(names).size;
        for (const s of SCENARIOS) {
          const rec = (r as any)[s];
          cells.push({
            user: u.email,
            goal: u.goal,
            region: u.region,
            meal,
            scenario: s,
            ok: !!rec && Array.isArray(rec.foods) && rec.foods.length > 0,
            items: rec?.foods?.length ?? 0,
            kcal: rec?.totalCalories,
            protein: rec?.totalProtein,
            duplicateAcrossScenarios: dup,
            ms,
          });
        }
      } catch (err) {
        for (const s of SCENARIOS) {
          cells.push({
            user: u.email,
            goal: u.goal,
            region: u.region,
            meal,
            scenario: s,
            ok: false,
            items: 0,
            err: shortErr(err),
            ms: Date.now() - t0,
          });
        }
      }
    }
  }

  const ok = cells.filter((c) => c.ok).length;
  const fail = cells.length - ok;

  const failures = cells.filter((c) => !c.ok);
  const errGroups = new Map<string, number>();
  for (const f of failures) {
    const k = (f.err || 'empty-foods').slice(0, 200);
    errGroups.set(k, (errGroups.get(k) || 0) + 1);
  }
  const errBody =
    failures.length === 0
      ? '_None._'
      : [...errGroups.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `- **${n}×** \`${k}\``)
          .join('\n');

  const sampleBody =
    '| user | meal | scenario | items | kcal | prot | dup | ms |\n|---|---|---|---|---|---|---|---|\n' +
    cells
      .slice(0, 36)
      .map(
        (c) =>
          `| ${c.user} | ${c.meal} | ${c.scenario} | ${c.items} | ${c.kcal ?? '-'} | ${c.protein ?? '-'} | ${c.duplicateAcrossScenarios ?? '-'} | ${c.ms} |`,
      )
      .join('\n');

  const file = writeReport({
    moduleName: '06-scenario-engine',
    title: 'Scenario Engine Runner',
    summary: { cells: cells.length, ok, fail },
    sections: [
      { heading: 'Error groups', body: errBody },
      { heading: 'Sample (first 36 cells)', body: sampleBody },
    ],
  });

  logger.log(`cells=${cells.length} ok=${ok} fail=${fail}  report=${file}`);
  await app.close();
  process.exit(fail > 0 ? 2 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Runner 06 crashed:', err);
  process.exit(1);
});
