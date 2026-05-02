/**
 * M8 反馈与学习 skeleton — `feedback/` (ExecutionTrackerService / SubstitutionPattern)
 *
 * 用例编号对齐 docs/recommendation-test-matrix.md M8-XXX。
 * 已闭环：M8-007 (= BUG-006 sanitize)
 */

describe('[M8] 反馈与学习 (feedback/)', () => {
  describe('反馈生效闭环', () => {
    it.todo('M8-001 P0: accepted feedback 5min 内画像生效（category 权重↑）');
    it.todo('M8-002 P1: rejected feedback 抑制召回');
  });

  describe('替换学习', () => {
    it.todo('M8-003 P1: A 替 B 多次 → A 出现率↑ B↓');
    it.todo('M8-005 P1: SubstitutionPattern 累计正确');
  });

  describe('窗口与抗噪', () => {
    it.todo('M8-004 P1: feedback createdAt > 60d 不计入');
    it.todo('M8-006 P2: 同 food accepted+rejected 互抵消，权重 ≈ 中性');
  });

  describe('数据健壮性', () => {
    it.todo('M8-007 P2: 非 uuid food_id 不污染 (BUG-006 已闭环 ✅)');
  });
});
