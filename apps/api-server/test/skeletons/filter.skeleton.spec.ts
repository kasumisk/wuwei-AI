/**
 * M5 过滤 skeleton — `filter/` (RealisticFilter / LifestyleAdapter)
 *
 * 用例编号对齐 docs/recommendation-test-matrix.md M5-XXX。
 * runner 间接覆盖：04 + 07
 * 现有 spec：test/food-filter.service.spec.ts
 */

describe('[M5] 过滤 (filter/)', () => {
  describe('RealisticFilter (BUG-009 已闭环)', () => {
    it.todo('M5-001 P0: 池 5161 时 "too aggressive" warn = 0');
    it.todo('M5-002 P1: commonalityThreshold 过滤生效');
    it.todo('M5-003 P1: MIN_CANDIDATES=5 兜底');
  });

  describe('场景适配', () => {
    it.todo('M5-004 P1: adjustForScene homeCook → 倾向家庭烹饪');
    it.todo('M5-005 P1: adjustForScene quick → 倾向简易/外卖');
    it.todo('M5-006 P1: adjustForScene social → 倾向餐厅');
  });

  describe('解耦', () => {
    it.todo('M5-007 P2: scoreFood 与 filter 解耦');
    it.todo('M5-008 P2: LifestyleAdapter null 时 filter 不抛错');
  });
});
