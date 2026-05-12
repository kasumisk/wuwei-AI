/**
 * Nutrition calculation golden-case tests
 *
 * Verifies that calculateBMR / calculateTDEE / calculateRecommendedCalories /
 * calculateMacroTargets produce the exact values documented in
 * docs/nutrition-calculation-contract.md.
 *
 * All cases use currentYear = 2026 (mocked via jest.spyOn on Date).
 * Private methods accessed via (svc as any) — intentional in unit tests.
 */

import {
  ActivityLevel,
  GoalSpeed,
  GoalType,
} from '../../../src/modules/user/user.types';

// ─── Minimal stub — only what the constructor needs ───────────────────────────

class StubPrisma {}
class StubCache {}
class StubEventEmitter {}
class StubI18n {}
class StubChangeLog {}
class StubRequestContext {}

// Lazy import to avoid NestJS DI bootstrap
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  UserProfileService,
} = require('../../../src/modules/user/app/services/profile/user-profile.service');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSvc() {
  return new UserProfileService(
    new StubPrisma(),
    new StubCache(),
    new StubEventEmitter(),
    new StubI18n(),
    new StubChangeLog(),
    new StubRequestContext(),
  ) as any;
}

// ─── Fix year to 2026 ────────────────────────────────────────────────────────

beforeAll(() => {
  jest.spyOn(Date.prototype, 'getFullYear').mockReturnValue(2026);
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('NutritionCalculation — golden cases', () => {
  let svc: any;

  beforeEach(() => {
    svc = makeSvc();
  });

  // ── Case 1: Male, moderate, fat_loss, steady (Harris-Benedict) ─────────────
  describe('Case 1 — Male 30 yo, 170 cm, 70 kg, moderate, fat_loss, steady', () => {
    const profile = {
      gender: 'male',
      birthYear: 1996, // age 30
      heightCm: 170,
      weightKg: 70,
      bodyFatPercent: null,
    };

    it('BMR ≈ 1671.67 (Harris-Benedict male)', () => {
      const bmr: number = svc.calculateBMR(profile);
      expect(bmr).toBeCloseTo(1671.67, 1);
    });

    it('TDEE ≈ 2591.09 (moderate × 1.55)', () => {
      const bmr: number = svc.calculateBMR(profile);
      const tdee: number = svc.calculateTDEE(bmr, ActivityLevel.MODERATE);
      expect(tdee).toBeCloseTo(2591.09, 1);
    });

    it('recommendedCalories = 2073 (fat_loss 0.80, steady 0.00)', () => {
      const bmr: number = svc.calculateBMR(profile);
      const tdee: number = svc.calculateTDEE(bmr, ActivityLevel.MODERATE);
      const cal: number = svc.calculateRecommendedCalories(
        tdee,
        GoalType.FAT_LOSS,
        GoalSpeed.STEADY,
        'male',
      );
      expect(cal).toBe(2073);
    });

    it('macros: protein=181g carb=207g fat=58g (fat_loss ratios)', () => {
      const macros = svc.calculateMacroTargets(2073, GoalType.FAT_LOSS);
      expect(macros.proteinG).toBe(181);
      expect(macros.carbG).toBe(207);
      expect(macros.fatG).toBe(58);
    });
  });

  // ── Case 2: Female, light, muscle_gain, aggressive (Harris-Benedict) ───────
  describe('Case 2 — Female 25 yo, 160 cm, 55 kg, light, muscle_gain, aggressive', () => {
    const profile = {
      gender: 'female',
      birthYear: 2001, // age 25
      heightCm: 160,
      weightKg: 55,
      bodyFatPercent: null,
    };

    it('BMR ≈ 1343.61 (Harris-Benedict female)', () => {
      const bmr: number = svc.calculateBMR(profile);
      expect(bmr).toBeCloseTo(1343.61, 1);
    });

    it('TDEE ≈ 1847.46 (light × 1.375)', () => {
      const bmr: number = svc.calculateBMR(profile);
      const tdee: number = svc.calculateTDEE(bmr, ActivityLevel.LIGHT);
      expect(tdee).toBeCloseTo(1847.46, 1);
    });

    it('recommendedCalories = 1940 (muscle_gain 1.10, aggressive −0.05)', () => {
      const bmr: number = svc.calculateBMR(profile);
      const tdee: number = svc.calculateTDEE(bmr, ActivityLevel.LIGHT);
      const cal: number = svc.calculateRecommendedCalories(
        tdee,
        GoalType.MUSCLE_GAIN,
        GoalSpeed.AGGRESSIVE,
        'female',
      );
      expect(cal).toBe(1940);
    });

    it('macros: protein=194g carb=194g fat=43g (muscle_gain ratios)', () => {
      const macros = svc.calculateMacroTargets(1940, GoalType.MUSCLE_GAIN);
      expect(macros.proteinG).toBe(194);
      expect(macros.carbG).toBe(194);
      expect(macros.fatG).toBe(43);
    });
  });

  // ── Case 3: Male, sedentary, fat_loss, aggressive (Katch-McArdle) ──────────
  describe('Case 3 — Male 35 yo, 90 kg, 25% body fat, sedentary, fat_loss, aggressive', () => {
    const profile = {
      gender: 'male',
      birthYear: 1991, // age 35
      heightCm: 180, // irrelevant — Katch-McArdle ignores height
      weightKg: 90,
      bodyFatPercent: 25,
    };

    it('BMR = 1828 (Katch-McArdle)', () => {
      const bmr: number = svc.calculateBMR(profile);
      expect(bmr).toBe(1828);
    });

    it('TDEE = 2193.6 (sedentary × 1.2)', () => {
      const bmr: number = svc.calculateBMR(profile);
      const tdee: number = svc.calculateTDEE(bmr, ActivityLevel.SEDENTARY);
      expect(tdee).toBeCloseTo(2193.6, 1);
    });

    it('recommendedCalories = 1645 (fat_loss 0.80, aggressive −0.05)', () => {
      const bmr: number = svc.calculateBMR(profile);
      const tdee: number = svc.calculateTDEE(bmr, ActivityLevel.SEDENTARY);
      const cal: number = svc.calculateRecommendedCalories(
        tdee,
        GoalType.FAT_LOSS,
        GoalSpeed.AGGRESSIVE,
        'male',
      );
      expect(cal).toBe(1645);
    });

    it('macros: protein=144g carb=165g fat=46g (fat_loss ratios)', () => {
      const macros = svc.calculateMacroTargets(1645, GoalType.FAT_LOSS);
      expect(macros.proteinG).toBe(144);
      expect(macros.carbG).toBe(165);
      expect(macros.fatG).toBe(46);
    });
  });

  // ── Safety floor ───────────────────────────────────────────────────────────
  describe('Safety floor', () => {
    it('male floor = 1500 kcal even when TDEE is tiny', () => {
      const cal: number = svc.calculateRecommendedCalories(
        1000,
        GoalType.FAT_LOSS,
        GoalSpeed.AGGRESSIVE,
        'male',
      );
      expect(cal).toBe(1500);
    });

    it('female floor = 1200 kcal even when TDEE is tiny', () => {
      const cal: number = svc.calculateRecommendedCalories(
        800,
        GoalType.FAT_LOSS,
        GoalSpeed.AGGRESSIVE,
        'female',
      );
      expect(cal).toBe(1200);
    });
  });
});
