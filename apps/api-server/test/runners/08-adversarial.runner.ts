/** 简化对抗测试 - 仅静态检查 */
import {
  bootstrapAppContext,
  loadE2EUsers,
  makeLogger,
  writeReport,
} from './lib/runner-utils';

interface Cell {
  testId: string;
  category: string;
  desc: string;
  ok: boolean;
  detail: string;
  ms: number;
}

async function main() {
  const logger = makeLogger('08-Adversarial');
  const app = await bootstrapAppContext();
  const cells: Cell[] = [];

  // 1. vegan cream 修复 (静态)
  {
    const t0 = Date.now();
    const { foodViolatesDietaryRestriction } = require(
      '../../src/modules/diet/app/recommendation/pipeline/food-filter.service',
    );
    const creamOk = foodViolatesDietaryRestriction(
      { id: 't', name: 'Cream Soup', foodGroup: 'dairy', category: 'composite', mainIngredient: 'cream', tags: ['dairy'] },
      ['vegan'],
    );
    cells.push({
      testId: 'FIX-1a', category: 'dietary',
      desc: 'vegan 独立版拦截 cream',
      ok: creamOk === true,
      detail: creamOk ? '✅ 正确' : '❌ 遗漏 cream!',
      ms: Date.now() - t0,
    });
  }

  // 2. 过敏原过滤 (静态)
  {
    const t0 = Date.now();
    const { filterByAllergens } = require(
      '../../src/modules/diet/app/recommendation/filter/allergen-filter.util',
    );
    const filtered = filterByAllergens(
      [{ id: 'f1', name: 'Tofu', allergens: [] }, { id: 'f2', name: 'Milk', allergens: ['dairy'] }],
      ['dairy'],
    );
    const leaked = filtered.some((f: any) => f.id === 'f2');
    cells.push({
      testId: 'FIX-2a', category: 'allergen',
      desc: 'filterByAllergens dairy',
      ok: !leaked,
      detail: leaked ? '❌ 泄漏' : `✅ ${filtered.length} 安全`,
      ms: Date.now() - t0,
    });
  }

  // 3. 渠道系统 (静态)
  {
    const t0 = Date.now();
    const { normalizeChannel, KNOWN_CHANNELS } = require(
      '../../src/modules/diet/app/recommendation/utils/channel',
    );
    const errors = ['home_cook', 'restaurant', 'delivery', 'canteen', 'convenience']
      .filter((ch: string) => normalizeChannel(ch) !== ch)
      .map((ch: string) => `${ch}→${normalizeChannel(ch)}`);
    cells.push({
      testId: 'SYS-3a', category: 'architecture',
      desc: 'channel.ts 场景频道',
      ok: errors.length === 0,
      detail: errors.length > 0 ? `⚠️ ${KNOWN_CHANNELS}: ${errors.join(', ')}` : `✅ 独立`,
      ms: Date.now() - t0,
    });
  }

  // 汇总
  const passed = cells.filter(c => c.ok).length;
  const failed = cells.filter(c => !c.ok).length;
  console.log(`\n===== 对抗测试: ${passed}/${cells.length} 通过, ${failed} 失败 =====`);
  cells.forEach(c => console.log(`  ${c.ok ? '✅' : '❌'} ${c.testId}: ${c.detail}`));

  writeReport({
    moduleName: '08-adversarial',
    title: '对抗测试报告 (Round 2)',
    summary: { total: cells.length, passed, failed, date: new Date().toISOString() },
    sections: [{ heading: '结果', body: cells.map(c =>
      `| ${c.ok ? '✅' : '❌'} | ${c.testId} | ${c.category} | ${c.desc} | ${c.detail} | ${c.ms}ms |`
    ).join('\n') }],
  });

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(1); });
