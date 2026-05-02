/**
 * M9 解释与追踪 skeleton — `explanation/` + `tracing/`
 *
 * 用例编号对齐 docs/recommendation-test-matrix.md M9-XXX。
 * runner 内嵌：07-end-to-end (trace 字段)
 * 现有 spec：test/comparison-explanation.service.spec.ts
 */

describe('[M9] 解释与追踪 (explanation/ + tracing/)', () => {
  describe('trace 完整性', () => {
    it.todo('M9-001 P1: trace 包含 cuisinePreferenceRegions');
    it.todo('M9-002 P1: trace.factors[] 含每个 factor 的 name + multiplier');
  });

  describe('解释生成', () => {
    it.todo('M9-003 P1: meal-explanation 输出 ≥ 1 条 reason');
    it.todo('M9-004 P1: comparison-explanation 列出关键差异 (已实现 ✅)');
  });

  describe('异常隔离', () => {
    it.todo('M9-005 P2: trace service throw 时主链路不阻塞');
  });
});
