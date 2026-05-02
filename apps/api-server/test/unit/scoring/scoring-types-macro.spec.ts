import {
  buildMealRoles,
  deriveMacroRangesFromTarget,
  getProteinPerKg,
  PROTEIN_PER_KG_BY_GOAL,
  ROLE_CATEGORIES,
} from '../../../src/modules/diet/app/recommendation/types/scoring.types';

describe('scoring.types — P0-3/P1-2 新增导出', () => {
  describe('deriveMacroRangesFromTarget', () => {
    it('分析文档案例 fat_loss(1500/37/148) 派生区间应以实际比为中心 ±5pp', () => {
      // fatRatio  = 37*9/1500  = 0.222
      // carbRatio = 148*4/1500 = 0.3947
      const r = deriveMacroRangesFromTarget({
        calories: 1500,
        fat: 37,
        carbs: 148,
      });
      expect(r).not.toBeNull();
      expect(r!.fat[0]).toBeCloseTo(0.222 - 0.05, 3);
      expect(r!.fat[1]).toBeCloseTo(0.222 + 0.05, 3);
      expect(r!.carb[0]).toBeCloseTo(0.3947 - 0.05, 3);
      expect(r!.carb[1]).toBeCloseTo(0.3947 + 0.05, 3);
    });

    it('派生后的 fat 上限应严格小于旧 MACRO_RANGES.fat_loss.fat 上限(0.35)，防止再次奖励高脂食物', () => {
      const r = deriveMacroRangesFromTarget({
        calories: 1500,
        fat: 37,
        carbs: 148,
      });
      expect(r!.fat[1]).toBeLessThan(0.35);
    });

    it('calories<=0 应返回 null 以让调用方回退默认', () => {
      expect(
        deriveMacroRangesFromTarget({ calories: 0, fat: 37, carbs: 148 }),
      ).toBeNull();
    });

    it('派生区间下界会被 clamp 到 [0,1]', () => {
      const r = deriveMacroRangesFromTarget({
        calories: 2000,
        fat: 0, // 极端边界：fatRatio=0 → 下界 -0.05 需 clamp 到 0
        carbs: 200,
      });
      expect(r!.fat[0]).toBeGreaterThanOrEqual(0);
      expect(r!.fat[0]).toBeLessThanOrEqual(1);
    });
  });

  describe('getProteinPerKg / PROTEIN_PER_KG_BY_GOAL（P1-2 统一蛋白质公式）', () => {
    // P-ε 矩阵 D1_lowBMI 调参后的当前真值（fat_loss=2.1 / muscle_gain=2.4 / health=1.6 / habit=2.0）
    // 历史轨迹：旧 0.8/1.2/1.6 → P1-2 升 2.0/2.2/1.3/1.1 → P-ε 调参 2.1/2.4/1.6/2.0
    it('四个目标的系数应为 fat_loss=2.1 / muscle_gain=2.4 / health=1.6 / habit=2.0', () => {
      expect(PROTEIN_PER_KG_BY_GOAL.fat_loss).toBe(2.1);
      expect(PROTEIN_PER_KG_BY_GOAL.muscle_gain).toBe(2.4);
      expect(PROTEIN_PER_KG_BY_GOAL.health).toBe(1.6);
      expect(PROTEIN_PER_KG_BY_GOAL.habit).toBe(2.0);
    });

    it('getProteinPerKg 对未知 goal 应回退到 health (1.6)', () => {
      expect(getProteinPerKg('unknown_goal')).toBe(1.6);
      expect(getProteinPerKg(null)).toBe(1.6);
      expect(getProteinPerKg(undefined)).toBe(1.6);
    });

    it('分析文档案例体重 72kg × fat_loss 应得到 151g 蛋白质（72 × 2.1）', () => {
      expect(Math.round(72 * getProteinPerKg('fat_loss'))).toBe(151);
    });
  });

  // ═════════════════════════════════════════════════════════
  // P0-A 根因#3 修复 · buildMealRoles 动态 slot 派生
  // 破除原硬编码 MEAL_ROLES 导致的日蛋白天花板 ~105g
  // ═════════════════════════════════════════════════════════
  describe('buildMealRoles — 按目标蛋白动态派生 role 数组', () => {
    it('维持 25g/餐 → 1 protein slot（保持默认行为）', () => {
      const roles = buildMealRoles('lunch', 25);
      const proteinCount = roles.filter((r) => r.startsWith('protein')).length;
      expect(proteinCount).toBe(1);
    });

    it('减脂场景 38g/餐 → 2 protein slot（破除 105g 天花板）', () => {
      const roles = buildMealRoles('lunch', 38);
      const proteinCount = roles.filter((r) => r.startsWith('protein')).length;
      expect(proteinCount).toBe(2);
      expect(roles).toContain('protein');
      expect(roles).toContain('protein2');
    });

    it('高蛋白 76g/餐 → clamp 到 3 protein slot（上限）', () => {
      const roles = buildMealRoles('dinner', 76);
      const proteinCount = roles.filter((r) => r.startsWith('protein')).length;
      expect(proteinCount).toBe(3);
      expect(roles).toEqual(
        expect.arrayContaining(['protein', 'protein2', 'protein3']),
      );
    });

    it('极端超目标 200g/餐 仍 clamp 到 3 slot（不越界）', () => {
      const roles = buildMealRoles('dinner', 200);
      const proteinCount = roles.filter((r) => r.startsWith('protein')).length;
      expect(proteinCount).toBe(3);
    });

    it('零/负蛋白目标 → fallback 到 1 slot（防御式）', () => {
      expect(
        buildMealRoles('lunch', 0).filter((r) => r.startsWith('protein')),
      ).toHaveLength(1);
      expect(
        buildMealRoles('lunch', -10).filter((r) => r.startsWith('protein')),
      ).toHaveLength(1);
    });

    it('breakfast 返回 carb + protein 组合（含 carb 基础槽）', () => {
      const roles = buildMealRoles('breakfast', 30);
      expect(roles[0]).toBe('carb');
      expect(roles).toContain('protein');
    });

    it('lunch 返回 carb + veggie + protein 组合', () => {
      const roles = buildMealRoles('lunch', 30);
      expect(roles).toContain('carb');
      expect(roles).toContain('veggie');
      expect(roles).toContain('protein');
    });

    it('dinner 返回 veggie + side + protein 组合（无 carb）', () => {
      const roles = buildMealRoles('dinner', 30);
      expect(roles).toContain('veggie');
      expect(roles).toContain('side');
      expect(roles).toContain('protein');
      expect(roles).not.toContain('carb');
    });

    it('snack 有蛋白需求走 snack_protein 优先（非 snack1）', () => {
      const roles = buildMealRoles('snack', 15);
      expect(roles).toContain('snack_protein');
      expect(roles).not.toContain('snack1');
    });

    it('未知 mealType 回退到 carb+veggie base', () => {
      const roles = buildMealRoles('midnight', 30);
      expect(roles).toContain('carb');
      expect(roles).toContain('veggie');
      expect(roles).toContain('protein');
    });

    it('ROLE_CATEGORIES 必须包含 protein3 映射（防止动态 slot 派生后无类目可召回）', () => {
      expect(ROLE_CATEGORIES.protein3).toBeDefined();
      expect(ROLE_CATEGORIES.protein3).toEqual(
        expect.arrayContaining(['protein']),
      );
    });

    it('减脂日蛋白天花板数学验证：152g÷4餐=38g/餐→2 slot→日8 slot→天花板≈280g（足够）', () => {
      const targetDaily = 152;
      const mealsPerDay = 4; // breakfast, lunch, dinner, snack
      const perMeal = targetDaily / mealsPerDay;
      const slotsPerMeal = buildMealRoles('lunch', perMeal).filter((r) =>
        r.startsWith('protein'),
      ).length;
      const dailySlots = slotsPerMeal * mealsPerDay;
      const avgProteinPerSlot = 35; // 单份蛋白食物实际蛋白
      const ceiling = dailySlots * avgProteinPerSlot;
      expect(ceiling).toBeGreaterThanOrEqual(152); // 必须超过目标才能命中
    });
  });
});
