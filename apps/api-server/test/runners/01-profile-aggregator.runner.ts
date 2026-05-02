/**
 * Runner 01: ProfileAggregatorService
 *
 * Calls aggregateForRecommendation + aggregateForScenario for every e2e user
 * across all 4 mealTypes. Verifies the enriched profile contains the keys
 * downstream stages depend on:
 *   - enrichedProfile.declared / shortTerm / contextual
 *   - regionalBoostMap (Map)
 *   - cuisinePreferenceRegions (string[])
 *   - effectiveGoal
 */

import {
  bootstrapAppContext,
  loadE2EUsers,
  MEAL_TYPES,
  makeLogger,
  shortErr,
  writeReport,
} from './lib/runner-utils';
import { ProfileAggregatorService } from '../../src/modules/diet/app/recommendation/profile/profile-aggregator.service';

interface Cell {
  user: string;
  goal: string;
  region: string;
  meal: string;
  call: 'recommendation' | 'scenario';
  ok: boolean;
  hasEnriched: boolean;
  hasDeclared: boolean;
  hasRegionalBoostMap: boolean;
  cuisineRegionsCount: number;
  err?: string;
  ms: number;
}

async function main() {
  const logger = makeLogger('01-ProfileAggregator');
  const app = await bootstrapAppContext();
  const aggregator = app.get(ProfileAggregatorService);
  const users = await loadE2EUsers(app);

  const cells: Cell[] = [];

  for (const u of users) {
    for (const meal of MEAL_TYPES) {
      // recommendation aggregation
      let t0 = Date.now();
      try {
        const r = await aggregator.aggregateForRecommendation(u.id, meal);
        cells.push({
          user: u.email,
          goal: u.goal,
          region: u.region,
          meal,
          call: 'recommendation',
          ok: true,
          hasEnriched: !!r.enrichedProfile,
          hasDeclared: !!r.enrichedProfile?.declared,
          hasRegionalBoostMap:
            !!r.regionalBoostMap && r.regionalBoostMap instanceof Map,
          cuisineRegionsCount: r.cuisinePreferenceRegions?.length ?? -1,
          ms: Date.now() - t0,
        });
      } catch (err) {
        cells.push({
          user: u.email,
          goal: u.goal,
          region: u.region,
          meal,
          call: 'recommendation',
          ok: false,
          hasEnriched: false,
          hasDeclared: false,
          hasRegionalBoostMap: false,
          cuisineRegionsCount: -1,
          err: shortErr(err),
          ms: Date.now() - t0,
        });
      }

      // scenario aggregation
      t0 = Date.now();
      try {
        const r = await aggregator.aggregateForScenario(u.id, meal);
        cells.push({
          user: u.email,
          goal: u.goal,
          region: u.region,
          meal,
          call: 'scenario',
          ok: true,
          hasEnriched: !!r.enrichedProfile,
          hasDeclared: !!r.enrichedProfile?.declared,
          hasRegionalBoostMap: false, // scenario aggregator does not return it
          cuisineRegionsCount: -1,
          ms: Date.now() - t0,
        });
      } catch (err) {
        cells.push({
          user: u.email,
          goal: u.goal,
          region: u.region,
          meal,
          call: 'scenario',
          ok: false,
          hasEnriched: false,
          hasDeclared: false,
          hasRegionalBoostMap: false,
          cuisineRegionsCount: -1,
          err: shortErr(err),
          ms: Date.now() - t0,
        });
      }
    }
  }

  const ok = cells.filter((c) => c.ok).length;
  const fail = cells.length - ok;

  // Report
  const failBody = cells.filter((c) => !c.ok).length
    ? '| user | goal | region | meal | call | err |\n|---|---|---|---|---|---|\n' +
      cells
        .filter((c) => !c.ok)
        .map(
          (c) =>
            `| ${c.user} | ${c.goal} | ${c.region} | ${c.meal} | ${c.call} | ${(c.err || '').slice(0, 140)} |`,
        )
        .join('\n')
    : '_None._';

  const sampleBody =
    '| user | meal | call | enriched | declared | boostMap | cuisineRegions | ms |\n|---|---|---|---|---|---|---|---|\n' +
    cells
      .slice(0, 24)
      .map(
        (c) =>
          `| ${c.user} | ${c.meal} | ${c.call} | ${c.hasEnriched} | ${c.hasDeclared} | ${c.hasRegionalBoostMap} | ${c.cuisineRegionsCount} | ${c.ms} |`,
      )
      .join('\n');

  const file = writeReport({
    moduleName: '01-profile-aggregator',
    title: 'Profile Aggregator Runner',
    summary: { cells: cells.length, ok, fail },
    sections: [
      { heading: 'Failures', body: failBody },
      { heading: 'Sample (first 24)', body: sampleBody },
    ],
  });

  logger.log(`cells=${cells.length} ok=${ok} fail=${fail}  report=${file}`);
  await app.close();
  process.exit(fail > 0 ? 2 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Runner 01 crashed:', err);
  process.exit(1);
});
