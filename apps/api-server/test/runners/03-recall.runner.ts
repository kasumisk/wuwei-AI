/**
 * Runner 03: Recall (food pool retrieval)
 *
 * Verifies the verified-food pool is correctly loaded and that
 * dietary restriction / allergen filters yield non-empty pools per user.
 */

import {
  bootstrapAppContext,
  loadE2EUsers,
  makeLogger,
  shortErr,
  writeReport,
} from './lib/runner-utils';
import { FoodPoolCacheService } from '../../src/modules/diet/app/recommendation/pipeline/food-pool-cache.service';

interface Cell {
  user: string;
  goal: string;
  region: string;
  ok: boolean;
  totalActive: number;
  filteredCount: number;
  err?: string;
  ms: number;
}

async function main() {
  const logger = makeLogger('03-Recall');
  const app = await bootstrapAppContext();
  const pool = app.get(FoodPoolCacheService);
  const users = await loadE2EUsers(app);

  const t0 = Date.now();
  const allFoods = await pool.getVerifiedFoods();
  logger.log(`Loaded ${allFoods.length} verified foods in ${Date.now() - t0}ms`);

  const cells: Cell[] = [];
  for (const u of users) {
    const start = Date.now();
    try {
      const restrictions =
        ((u.profile.dietaryRestrictions as string[]) || []).map((s) =>
          s.toLowerCase(),
        );
      const allergens = ((u.profile.allergens as string[]) || []).map((s) =>
        s.toLowerCase(),
      );

      const filtered = allFoods.filter((f) => {
        const aliasArr = Array.isArray(f.aliases)
          ? (f.aliases as unknown[]).map((x) => String(x))
          : typeof f.aliases === 'string'
            ? [f.aliases]
            : [];
        const hay = `${f.name} ${aliasArr.join(' ')} ${f.mainIngredient || ''} ${(f.ingredientList || []).join(' ')}`.toLowerCase();
        for (const a of allergens) if (a && hay.includes(a)) return false;
        for (const r of restrictions) if (r && hay.includes(r)) return false;
        return true;
      });
      cells.push({
        user: u.email,
        goal: u.goal,
        region: u.region,
        ok: filtered.length > 50,
        totalActive: allFoods.length,
        filteredCount: filtered.length,
        ms: Date.now() - start,
      });
    } catch (err) {
      cells.push({
        user: u.email,
        goal: u.goal,
        region: u.region,
        ok: false,
        totalActive: allFoods.length,
        filteredCount: 0,
        err: shortErr(err),
        ms: Date.now() - start,
      });
    }
  }

  const ok = cells.filter((c) => c.ok).length;
  const fail = cells.length - ok;

  const body =
    '| user | goal | region | total | afterFilter | ms |\n|---|---|---|---|---|---|\n' +
    cells
      .map(
        (c) =>
          `| ${c.user} | ${c.goal} | ${c.region} | ${c.totalActive} | ${c.filteredCount} | ${c.ms} |`,
      )
      .join('\n');

  const file = writeReport({
    moduleName: '03-recall',
    title: 'Recall (food pool) Runner',
    summary: {
      cells: cells.length,
      ok,
      fail,
      poolSize: allFoods.length,
    },
    sections: [{ heading: 'Per-user pool size', body }],
  });

  logger.log(`cells=${cells.length} ok=${ok} fail=${fail}  report=${file}`);
  await app.close();
  process.exit(fail > 0 ? 2 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Runner 03 crashed:', err);
  process.exit(1);
});
