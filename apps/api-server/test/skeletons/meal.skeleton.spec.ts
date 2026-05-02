/**
 * M6 餐次组装 skeleton — `meal/`
 *
 * 用例编号对齐 docs/recommendation-test-matrix.md M6-XXX。
 * runner 覆盖：05-meal-assembler (48 cells)
 */

describe('[M6] 餐次组装 (meal/)', () => {
  describe('基础组装', () => {
    it.todo('M6-001 P0: 12 用户 × 4 mealType 全组装成功');
  });

  describe('餐次结构', () => {
    it.todo('M6-002 P1: breakfast 含碳水+蛋白至少各 1');
    it.todo('M6-003 P1: lunch/dinner 含主食+蛋白+蔬菜');
    it.todo('M6-004 P1: snack items.length ≤ 2');
  });

  describe('个体差异', () => {
    it.todo('M6-005 P1: familySize=4 时总量按比例缩放');
    it.todo('M6-006 P1: 总热量 ∈ target ± 15%');
  });

  describe('多样性', () => {
    it.todo('M6-007 P2: 同餐 mainIngredient 不重复');
    it.todo('M6-008 P2: usedNames 跨餐去重');
  });

  describe('性能基线', () => {
    it.todo('M6-009 P3: mean 组装耗时 < 100ms');
  });
});
