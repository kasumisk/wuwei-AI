/**
 * M1 用户画像 skeleton — `recommendation/profile/`
 *
 * 用例编号对齐 docs/recommendation-test-matrix.md M1-XXX。
 * 已实现回归：M1-002/003 → test/preference-profile-uuid-join.regression.spec.ts
 *
 * 填实方法：把 `it.todo(...)` 改为 `it(..., async () => { ... })`。
 */

describe('[M1] 用户画像 (profile/)', () => {
  describe('declared profile 透出', () => {
    it.todo('M1-001 P0: enrichedProfile.declared 含完整字段');
  });

  describe('feedback 聚合 (BUG-006 已修)', () => {
    it.todo('M1-002 P0: $queryRawUnsafe 含 sanitize 子查询 (已实现 ✅)');
    it.todo('M1-003 P0: feedback < 3 条 → 空 profile (已实现 ✅)');
    it.todo('M1-004 P1: accept rate 0/0.5/1 → 0.3/0.8/1.3 边界值');
  });

  describe('regionalBoostMap', () => {
    it.todo('M1-005 P1: regionMap ⊕ cuisineMap (max 合并)');
    it.todo('M1-006 P1: cuisinePreferenceRegions 排除本国');
    it.todo('M1-007 P1: american 归并 western 大类 (5 国)');
  });

  describe('cuisine normalize', () => {
    it.todo('M1-008 P2: 大小写/中文别名归一化');
  });

  describe('regionCode 兜底', () => {
    it.todo('M1-009 P2: locale=zh-CN → regionCode=CN');
    it.todo('M1-010 P2: 无 locale 无 regionCode → DEFAULT_REGION_CODE=US');
  });

  describe('缓存 (P3)', () => {
    it.todo('M1-011 P3: profile cache TTL 5min');
    it.todo('M1-012 P3: redis 不可用降级直查');
  });
});
