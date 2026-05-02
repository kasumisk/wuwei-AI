/**
 * M3 召回 skeleton — `recall/` + `pipeline/food-pool-cache.service.ts`
 *
 * 用例编号对齐 docs/recommendation-test-matrix.md M3-XXX。
 * runner 覆盖：03-recall (12 cells, poolSize=5161)
 * 已实现：M3-009 → test/pipeline-builder-recall.service.spec.ts
 */

describe('[M3] 召回 (recall/ + food-pool-cache)', () => {
  describe('池子规模与基础过滤', () => {
    it.todo('M3-001 P0: poolSize === foods 全量 active+verified (=5161)');
    it.todo('M3-002 P0: is_verified=false 食物被过滤 (BUG-007 锁定)');
    it.todo('M3-003 P0: status≠active 食物被过滤');
  });

  describe('维度过滤', () => {
    it.todo('M3-004 P1: mealType 过滤');
    it.todo('M3-005 P1: excludeTags 过滤');
    it.todo('M3-006 P1: usedNames 去重');
    it.todo('M3-007 P1: 过敏原过滤');
    it.todo('M3-008 P1: 短期画像 rejected 过滤');
    it.todo('M3-010 P1: cookingSkillLevel 过滤');
  });

  describe('兜底', () => {
    it.todo('M3-009 P1: ensureMinCandidates (已实现 ✅)');
  });

  describe('缓存', () => {
    it.todo('M3-011 P1: 同 category 二次召回命中 redis');
    it.todo('M3-012 P2: 缓存 key 含 category 维度');
  });

  describe('性能与扩展', () => {
    it.todo('M3-013 P3: 召回耗时 P95 < 200ms');
    it.todo('M3-014 P3: semantic recall 异步合并不缩小结果集');
  });
});
