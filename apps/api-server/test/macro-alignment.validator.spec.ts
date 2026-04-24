import {
  validateMacroAlignment,
  MACRO_ZONE_THRESHOLDS,
} from '../src/modules/diet/app/recommendation/validators/macro-alignment.validator';

describe('validateMacroAlignment', () => {
  // 分析文档案例：1500 kcal / 144g protein / 37g fat / 148g carbs，fat_loss
  const DAILY_TARGET = {
    calories: 1500,
    protein: 144,
    fat: 37,
    carbs: 148,
  };

  describe('green zone (±5%)', () => {
    it('四维度完美贴合应判 green，无 violations', () => {
      const r = validateMacroAlignment(DAILY_TARGET, DAILY_TARGET);
      expect(r.zone).toBe('green');
      expect(r.violations).toHaveLength(0);
      expect(r.dimensions.every((d) => d.zone === 'green')).toBe(true);
      expect(r.summary).toMatch(/OK/);
    });

    it('±5% 边界内应判 green', () => {
      const r = validateMacroAlignment(
        {
          calories: 1500 * 1.05,
          protein: 144 * 0.95,
          fat: 37,
          carbs: 148,
        },
        DAILY_TARGET,
      );
      expect(r.zone).toBe('green');
    });
  });

  describe('yellow zone (5-15%)', () => {
    it('单维度 10% 偏差应判 yellow', () => {
      const r = validateMacroAlignment(
        { ...DAILY_TARGET, fat: 37 * 1.1 },
        DAILY_TARGET,
      );
      expect(r.zone).toBe('yellow');
      expect(r.violations).toHaveLength(1);
      expect(r.violations[0].dimension).toBe('fat');
      expect(r.violations[0].zone).toBe('yellow');
      expect(r.summary).toMatch(/YELLOW/);
    });

    it('+15% 边界内应判 yellow', () => {
      const r = validateMacroAlignment(
        { ...DAILY_TARGET, carbs: 148 * 1.15 },
        DAILY_TARGET,
      );
      expect(r.zone).toBe('yellow');
      expect(r.dimensions.find((d) => d.dimension === 'carbs')?.zone).toBe(
        'yellow',
      );
    });
  });

  describe('red zone (>15%)', () => {
    it('分析文档报告的 fat +73% / protein −37% 场景必须命中 red', () => {
      const r = validateMacroAlignment(
        {
          calories: 1500,
          protein: 144 * 0.63, // −37%
          fat: 37 * 1.73, // +73%
          carbs: 148,
        },
        DAILY_TARGET,
      );
      expect(r.zone).toBe('red');
      const redDims = r.dimensions.filter((d) => d.zone === 'red');
      expect(redDims.map((d) => d.dimension).sort()).toEqual([
        'fat',
        'protein',
      ]);
      expect(r.violations).toHaveLength(2);
      expect(r.summary).toMatch(/RED/);
      expect(r.summary).toMatch(/fat/);
      expect(r.summary).toMatch(/protein/);
    });

    it('整体 zone 取所有维度最差（red > yellow > green）', () => {
      const r = validateMacroAlignment(
        {
          calories: 1500, // green
          protein: 144 * 1.1, // yellow
          fat: 37 * 2, // red
          carbs: 148, // green
        },
        DAILY_TARGET,
      );
      expect(r.zone).toBe('red');
      expect(r.violations.map((v) => v.dimension).sort()).toEqual([
        'fat',
        'protein',
      ]);
    });
  });

  describe('偏差方向与数值正确性', () => {
    it('actual > target 时 deviation 为正', () => {
      const r = validateMacroAlignment(
        { ...DAILY_TARGET, fat: 37 * 1.73 },
        DAILY_TARGET,
      );
      const fatDim = r.dimensions.find((d) => d.dimension === 'fat')!;
      expect(fatDim.deviation).toBeGreaterThan(0);
      expect(fatDim.deviation).toBeCloseTo(0.73, 2);
      expect(fatDim.absDeviation).toBeCloseTo(0.73, 2);
    });

    it('actual < target 时 deviation 为负，absDeviation 仍为正', () => {
      const r = validateMacroAlignment(
        { ...DAILY_TARGET, protein: 144 * 0.63 },
        DAILY_TARGET,
      );
      const pDim = r.dimensions.find((d) => d.dimension === 'protein')!;
      expect(pDim.deviation).toBeLessThan(0);
      expect(pDim.deviation).toBeCloseTo(-0.37, 2);
      expect(pDim.absDeviation).toBeCloseTo(0.37, 2);
    });
  });

  describe('边界与降级', () => {
    it('target=0 的维度降级为 green（避免 Infinity）', () => {
      const r = validateMacroAlignment(
        { calories: 1500, protein: 144, fat: 37, carbs: 148 },
        { calories: 1500, protein: 144, fat: 37, carbs: 0 },
      );
      const carbsDim = r.dimensions.find((d) => d.dimension === 'carbs')!;
      expect(carbsDim.zone).toBe('green');
      expect(Number.isFinite(carbsDim.deviation)).toBe(true);
    });

    it('所有 dimension 都输出，顺序为 calories/protein/fat/carbs', () => {
      const r = validateMacroAlignment(DAILY_TARGET, DAILY_TARGET);
      expect(r.dimensions.map((d) => d.dimension)).toEqual([
        'calories',
        'protein',
        'fat',
        'carbs',
      ]);
    });

    it('阈值常量导出值正确', () => {
      expect(MACRO_ZONE_THRESHOLDS.green).toBe(0.05);
      expect(MACRO_ZONE_THRESHOLDS.yellow).toBe(0.15);
    });
  });
});
