/**
 * M4 评分链 skeleton — `scoring-chain/`
 *
 * 用例编号对齐 docs/recommendation-test-matrix.md M4-XXX。
 * runner 覆盖：04-scoring-chain (48 cells, mean 0.24–0.78, distinct~85)
 * 已实现：M4-002/003/004 → test/price-fit-factor-region-code.regression.spec.ts
 */

describe('[M4] 评分链 (scoring-chain/)', () => {
  describe('分数分布健康', () => {
    it.todo('M4-001 P0: 48 cells 分布 mean 0.24–0.78 / distinct ≥ 60');
  });

  describe('PriceFitFactor (BUG-008 已修)', () => {
    it.todo('M4-002 P0: 透传 regionCode (已实现 ✅)');
    it.todo('M4-003 P0: regionCode 缺失透传 null (已实现 ✅)');
    it.todo('M4-004 P0: 跨 region 不污染 (已实现 ✅)');
    it.todo('M4-005 P1: 路径 A 命中精确预算 → multiplier > 1');
    it.todo('M4-006 P1: currency mismatch 跳过 → multiplier=1.0');
    it.todo('M4-007 P1: priceUnit≠per_serving 回退路径 B');
    it.todo('M4-008 P1: 路径 B 超支 1/2/3 级 → 0.85/0.70/0.60');
  });

  describe('其他 factor', () => {
    it.todo('M4-009 P1: RegionalBoostFactor 命中 boostMap');
    it.todo('M4-010 P1: MacroFit 覆盖蛋白/脂肪/碳水');
    it.todo('M4-011 P1: HealthModifier veto → finalMultiplier=0');
  });

  describe('调度契约', () => {
    it.todo('M4-012 P2: factor.order 决定执行顺序');
    it.todo('M4-013 P2: factor.isApplicable=false 时跳过 computeAdjustment');
  });

  describe('性能基线', () => {
    it.todo('M4-014 P3: mean 评分耗时 < 30ms/food');
  });
});
