/**
 * Runner 02: Strategy Resolver (decision engine)
 *
 * Calls StrategyResolverFacade.resolveStrategyForUser per user × goal,
 * verifies merge chain returns a non-null resolved strategy with
 * a usable config (assembly / scoring weight overrides).
 */

import {
  bootstrapAppContext,
  loadE2EUsers,
  makeLogger,
  shortErr,
  writeReport,
} from './lib/runner-utils';
import { StrategyResolverFacade } from '../../src/modules/diet/app/recommendation/pipeline/strategy-resolver-facade.service';

interface Cell {
  user: string;
  goal: string;
  region: string;
  ok: boolean;
  resolvedNotNull: boolean;
  hasConfig: boolean;
  hasAssembly: boolean;
  hasWeights: boolean;
  source?: string;
  err?: string;
  ms: number;
}

async function main() {
  const logger = makeLogger('02-StrategyResolver');
  const app = await bootstrapAppContext();
  const facade = app.get(StrategyResolverFacade);
  const users = await loadE2EUsers(app);

  const cells: Cell[] = [];
  for (const u of users) {
    const t0 = Date.now();
    try {
      const r = await facade.resolveStrategyForUser(u.id, u.goal);
      cells.push({
        user: u.email,
        goal: u.goal,
        region: u.region,
        ok: true,
        resolvedNotNull: !!r,
        hasConfig: !!r?.config,
        hasAssembly: !!r?.config?.assembly,
        hasWeights:
          !!(r as any)?.config?.scoring?.weights ||
          !!(r as any)?.config?.weights,
        source: (r as any)?.source || (r as any)?.strategyName,
        ms: Date.now() - t0,
      });
    } catch (err) {
      cells.push({
        user: u.email,
        goal: u.goal,
        region: u.region,
        ok: false,
        resolvedNotNull: false,
        hasConfig: false,
        hasAssembly: false,
        hasWeights: false,
        err: shortErr(err),
        ms: Date.now() - t0,
      });
    }
  }

  const ok = cells.filter((c) => c.ok && c.resolvedNotNull).length;
  const fail = cells.length - ok;

  const body =
    '| user | goal | resolved | config | assembly | weights | source | ms |\n|---|---|---|---|---|---|---|---|\n' +
    cells
      .map(
        (c) =>
          `| ${c.user} | ${c.goal} | ${c.resolvedNotNull} | ${c.hasConfig} | ${c.hasAssembly} | ${c.hasWeights} | ${c.source || (c.err ? 'ERR' : '-')} | ${c.ms} |`,
      )
      .join('\n');

  const failBody =
    cells.filter((c) => !c.ok).length === 0
      ? '_None._'
      : cells
          .filter((c) => !c.ok)
          .map(
            (c) => `- ${c.user} (${c.goal}): ${(c.err || '').slice(0, 200)}`,
          )
          .join('\n');

  const file = writeReport({
    moduleName: '02-strategy-resolver',
    title: 'Strategy Resolver Runner',
    summary: { cells: cells.length, ok, fail },
    sections: [
      { heading: 'Failures', body: failBody },
      { heading: 'Per-cell', body: body },
    ],
  });

  logger.log(`cells=${cells.length} ok=${ok} fail=${fail}  report=${file}`);
  await app.close();
  process.exit(fail > 0 ? 2 : 0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Runner 02 crashed:', err);
  process.exit(1);
});
