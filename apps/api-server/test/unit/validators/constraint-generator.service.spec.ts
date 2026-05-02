import { ConstraintGeneratorService } from '../../../src/modules/diet/app/recommendation/pipeline/constraint-generator.service';
import {
  MealTarget,
  UserProfileConstraints,
} from '../../../src/modules/diet/app/recommendation/types/recommendation.types';
import { createMockScoringConfigService } from '../../helpers/mock-factories';

describe('ConstraintGeneratorService', () => {
  let service: ConstraintGeneratorService;

  // ---- helpers ----
  const defaultTarget: MealTarget = {
    calories: 600,
    protein: 30,
    fat: 20,
    carbs: 60,
  };

  const defaultConsumed = { calories: 800, protein: 40 };
  const defaultDailyTarget = { calories: 2000, protein: 100, fat: 65, carbs: 250 };

  beforeEach(() => {
    service = new ConstraintGeneratorService(
      createMockScoringConfigService() as any,
    );
  });

  // ==================== 1. Basic return shape ====================

  describe('return shape', () => {
    it('should return an object with includeTags, excludeTags, maxCalories, minProtein', () => {
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result).toHaveProperty('includeTags');
      expect(result).toHaveProperty('excludeTags');
      expect(result).toHaveProperty('maxCalories');
      expect(result).toHaveProperty('minProtein');
      expect(Array.isArray(result.includeTags)).toBe(true);
      expect(Array.isArray(result.excludeTags)).toBe(true);
    });
  });

  // ==================== 2. maxCalories & minProtein ====================

  describe('maxCalories and minProtein', () => {
    it('should compute maxCalories = target.calories * 1.15', () => {
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result.maxCalories).toBeCloseTo(600 * 1.15);
    });

    it('should compute minProtein = target.protein * 0.5', () => {
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result.minProtein).toBeCloseTo(30 * 0.5);
    });

    it('should scale with different target values', () => {
      const target: MealTarget = {
        calories: 1000,
        protein: 80,
        fat: 30,
        carbs: 100,
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        target,
        defaultDailyTarget,
      );
      expect(result.maxCalories).toBeCloseTo(1000 * 1.15);
      expect(result.minProtein).toBeCloseTo(80 * 0.5);
    });
  });

  // ==================== 3. Goal-driven tags ====================

  describe('goal-driven tags', () => {
    it('should include high_protein for fat_loss', () => {
      const result = service.generateConstraints(
        'fat_loss',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result.includeTags).toContain('high_protein');
    });

    it('should include high_protein for muscle_gain', () => {
      const result = service.generateConstraints(
        'muscle_gain',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result.includeTags).toContain('high_protein');
    });

    it('should NOT include goal-driven high_protein for health', () => {
      // Use consumed values that do NOT trigger the state-driven protein gap
      const consumed = { calories: 800, protein: 80 };
      const result = service.generateConstraints(
        'health',
        consumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result.includeTags).not.toContain('high_protein');
    });
  });

  // ==================== 4. State-driven tags ====================

  describe('state-driven tags (protein gap & calorie gap)', () => {
    it('should include high_protein when proteinGap > 30', () => {
      // dailyTarget.protein=100, consumed.protein=60 → gap=40 > 30
      const consumed = { calories: 800, protein: 60 };
      const result = service.generateConstraints(
        'health',
        consumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result.includeTags).toContain('high_protein');
    });

    it('should NOT include state-driven high_protein when proteinGap <= 30', () => {
      // dailyTarget.protein=100, consumed.protein=80 → gap=20 <= 30
      const consumed = { calories: 800, protein: 80 };
      const result = service.generateConstraints(
        'health',
        consumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result.includeTags).not.toContain('high_protein');
    });

    it('should include low_calorie when calorieGap < 300', () => {
      // dailyTarget.calories=2000, consumed.calories=1800 → gap=200 < 300
      const consumed = { calories: 1800, protein: 80 };
      const result = service.generateConstraints(
        'health',
        consumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result.includeTags).toContain('low_calorie');
    });

    it('should NOT include low_calorie when calorieGap >= 300', () => {
      // dailyTarget.calories=2000, consumed.calories=800 → gap=1200 >= 300
      const consumed = { calories: 800, protein: 80 };
      const result = service.generateConstraints(
        'health',
        consumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result.includeTags).not.toContain('low_calorie');
    });

    it('should include ultra_low_calorie and exclude high_fat when calorieGap < 0', () => {
      // dailyTarget.calories=2000, consumed.calories=2100 → gap=-100 < 0
      const consumed = { calories: 2100, protein: 80 };
      const result = service.generateConstraints(
        'health',
        consumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result.includeTags).toContain('ultra_low_calorie');
      expect(result.includeTags).toContain('low_calorie'); // gap<0 also < 300
      expect(result.excludeTags).toContain('high_fat');
    });

    it('should include both low_calorie and ultra_low_calorie when calorieGap < 0 (both conditions met)', () => {
      const consumed = { calories: 2500, protein: 80 };
      const result = service.generateConstraints(
        'health',
        consumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result.includeTags).toContain('low_calorie');
      expect(result.includeTags).toContain('ultra_low_calorie');
    });
  });

  // ==================== 5. Meal preferences ====================

  describe('meal preferences (MEAL_PREFERENCES map)', () => {
    it('should apply breakfast preferences', () => {
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        'breakfast',
      );
      expect(result.includeTags).toContain('breakfast');
      expect(result.includeTags).toContain('high_carb');
      expect(result.includeTags).toContain('easy_digest');
      expect(result.excludeTags).toContain('fried');
      expect(result.excludeTags).toContain('heavy_flavor');
    });

    it('should apply lunch preferences', () => {
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        'lunch',
      );
      expect(result.includeTags).toContain('balanced');
    });

    it('should apply dinner preferences', () => {
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        'dinner',
      );
      expect(result.includeTags).toContain('low_carb');
      expect(result.includeTags).toContain('high_protein');
      expect(result.includeTags).toContain('light');
      expect(result.excludeTags).toContain('high_carb');
      expect(result.excludeTags).toContain('dessert');
    });

    it('should apply snack preferences', () => {
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        'snack',
      );
      expect(result.includeTags).toContain('low_calorie');
      expect(result.includeTags).toContain('snack');
      expect(result.includeTags).toContain('fruit');
      expect(result.excludeTags).toContain('fried');
      expect(result.excludeTags).toContain('high_fat');
    });

    it('should not crash for unknown mealType', () => {
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        'brunch',
      );
      expect(result).toBeDefined();
    });

    it('should not add meal tags when mealType is undefined', () => {
      const result = service.generateConstraints(
        'health',
        { calories: 800, protein: 80 },
        defaultTarget,
        defaultDailyTarget,
        undefined,
      );
      expect(result.includeTags).not.toContain('breakfast');
      expect(result.includeTags).not.toContain('balanced');
      expect(result.includeTags).not.toContain('low_carb');
    });
  });

  // ==================== 6. Allergens ====================

  describe('allergens', () => {
    it('should add allergen_{name} to excludeTags for each allergen', () => {
      const profile: UserProfileConstraints = {
        allergens: ['peanut', 'milk', 'shrimp'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('allergen_peanut');
      expect(result.excludeTags).toContain('allergen_milk');
      expect(result.excludeTags).toContain('allergen_shrimp');
    });

    it('should handle empty allergens array', () => {
      const profile: UserProfileConstraints = { allergens: [] };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(
        result.excludeTags.filter((t) => t.startsWith('allergen_')),
      ).toHaveLength(0);
    });

    it('should handle undefined allergens', () => {
      const profile: UserProfileConstraints = {};
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(
        result.excludeTags.filter((t) => t.startsWith('allergen_')),
      ).toHaveLength(0);
    });
  });

  // ==================== 7. Health conditions (V4 normalized) ====================

  describe('health conditions', () => {
    it('should handle diabetes_type2 (canonical name)', () => {
      const profile: UserProfileConstraints = {
        healthConditions: ['diabetes_type2'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('high_sugar');
      expect(result.excludeTags).toContain('high_gi');
      expect(result.includeTags).toContain('low_gi');
    });

    it('should handle diabetes alias (old naming)', () => {
      const profile: UserProfileConstraints = {
        healthConditions: ['diabetes'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('high_sugar');
      expect(result.excludeTags).toContain('high_gi');
      expect(result.includeTags).toContain('low_gi');
    });

    it('should handle hypertension', () => {
      const profile: UserProfileConstraints = {
        healthConditions: ['hypertension'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('high_sodium');
      expect(result.includeTags).toContain('low_sodium');
    });

    it('should handle hyperlipidemia (canonical name)', () => {
      const profile: UserProfileConstraints = {
        healthConditions: ['hyperlipidemia'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('high_cholesterol');
    });

    it('should handle high_cholesterol alias for hyperlipidemia', () => {
      const profile: UserProfileConstraints = {
        healthConditions: ['high_cholesterol'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('high_cholesterol');
    });

    it('should handle gout', () => {
      const profile: UserProfileConstraints = {
        healthConditions: ['gout'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('high_purine');
    });

    it('should handle kidney_disease', () => {
      const profile: UserProfileConstraints = {
        healthConditions: ['kidney_disease'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('high_potassium');
      expect(result.excludeTags).toContain('high_phosphorus');
    });

    it('should handle fatty_liver', () => {
      const profile: UserProfileConstraints = {
        healthConditions: ['fatty_liver'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('high_fat');
      expect(result.excludeTags).toContain('high_sugar');
    });

    it('should handle multiple health conditions combined', () => {
      const profile: UserProfileConstraints = {
        healthConditions: ['diabetes', 'hypertension', 'gout'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      // diabetes
      expect(result.excludeTags).toContain('high_sugar');
      expect(result.excludeTags).toContain('high_gi');
      expect(result.includeTags).toContain('low_gi');
      // hypertension
      expect(result.excludeTags).toContain('high_sodium');
      expect(result.includeTags).toContain('low_sodium');
      // gout
      expect(result.excludeTags).toContain('high_purine');
    });

    it('should handle unknown health condition gracefully (no crash, raw value used as-is by normalizeHealthCondition returning null)', () => {
      const profile: UserProfileConstraints = {
        healthConditions: ['unknown_condition'],
      };
      // normalizeHealthCondition returns null, condition falls through to raw value
      // which doesn't match any HealthCondition enum → no tags added, no crash
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result).toBeDefined();
    });
  });

  // ==================== 8. Dietary restrictions ====================

  describe('dietary restrictions', () => {
    it('should add meat to excludeTags for vegetarian', () => {
      const profile: UserProfileConstraints = {
        dietaryRestrictions: ['vegetarian'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('meat');
    });

    it('should add heavy_flavor to excludeTags for no_spicy', () => {
      const profile: UserProfileConstraints = {
        dietaryRestrictions: ['no_spicy'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('heavy_flavor');
    });

    it('should add fried to excludeTags for no_fried', () => {
      const profile: UserProfileConstraints = {
        dietaryRestrictions: ['no_fried'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('fried');
    });

    it('should add high_sodium to excludeTags for low_sodium', () => {
      const profile: UserProfileConstraints = {
        dietaryRestrictions: ['low_sodium'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('high_sodium');
    });

    it('should add unrecognized restriction as-is to excludeTags', () => {
      const profile: UserProfileConstraints = {
        dietaryRestrictions: ['halal'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('halal');
    });

    it('should handle multiple dietary restrictions', () => {
      const profile: UserProfileConstraints = {
        dietaryRestrictions: ['vegetarian', 'no_spicy', 'no_fried'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('meat');
      expect(result.excludeTags).toContain('heavy_flavor');
      expect(result.excludeTags).toContain('fried');
    });
  });

  // ==================== 9. Discipline ====================

  describe('discipline', () => {
    it('should exclude processed when discipline=high and goalType=fat_loss', () => {
      const profile: UserProfileConstraints = { discipline: 'high' };
      const result = service.generateConstraints(
        'fat_loss',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).toContain('processed');
    });

    it('should NOT exclude processed when discipline=high but goalType != fat_loss', () => {
      const profile: UserProfileConstraints = { discipline: 'high' };
      const result = service.generateConstraints(
        'muscle_gain',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).not.toContain('processed');
    });

    it('should NOT add extra constraints when discipline=low', () => {
      const profile: UserProfileConstraints = { discipline: 'low' };
      const result = service.generateConstraints(
        'fat_loss',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result.excludeTags).not.toContain('processed');
    });
  });

  // ==================== 10. Tag deduplication ====================

  describe('tag deduplication', () => {
    it('should deduplicate includeTags when multiple sources add the same tag', () => {
      // fat_loss adds high_protein, proteinGap>30 also adds high_protein
      // dailyTarget.protein=100, consumed.protein=60 → gap=40 > 30
      const consumed = { calories: 800, protein: 60 };
      const result = service.generateConstraints(
        'fat_loss',
        consumed,
        defaultTarget,
        defaultDailyTarget,
      );
      const highProteinCount = result.includeTags.filter(
        (t) => t === 'high_protein',
      ).length;
      expect(highProteinCount).toBe(1);
    });

    it('should deduplicate excludeTags from overlapping sources', () => {
      // calorieGap<0 adds high_fat, fatty_liver also adds high_fat
      const consumed = { calories: 2100, protein: 80 };
      const profile: UserProfileConstraints = {
        healthConditions: ['fatty_liver'],
      };
      const result = service.generateConstraints(
        'health',
        consumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      const highFatCount = result.excludeTags.filter(
        (t) => t === 'high_fat',
      ).length;
      expect(highFatCount).toBe(1);
    });

    it('should deduplicate breakfast fried + no_fried restriction', () => {
      // breakfast excludes fried, no_fried also excludes fried
      const profile: UserProfileConstraints = {
        dietaryRestrictions: ['no_fried'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        'breakfast',
        profile,
      );
      const friedCount = result.excludeTags.filter((t) => t === 'fried').length;
      expect(friedCount).toBe(1);
    });
  });

  // ==================== 11. Weak time slots ====================

  describe('weak time slots', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should add weak-slot constraints when current hour falls in afternoon slot (14-17)', () => {
      // Set UTC to 6:00, Asia/Shanghai (UTC+8) → local hour = 14 (afternoon)
      jest.setSystemTime(new Date('2025-01-15T06:00:00Z'));
      const profile: UserProfileConstraints = {
        weakTimeSlots: ['afternoon'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
        'Asia/Shanghai',
      );
      expect(result.excludeTags).toContain('high_fat');
      expect(result.excludeTags).toContain('high_carb');
      expect(result.excludeTags).toContain('dessert');
      expect(result.includeTags).toContain('low_calorie');
    });

    it('should add weak-slot constraints when current hour falls in evening slot (18-21)', () => {
      // Set UTC to 10:00, Asia/Shanghai (UTC+8) → local hour = 18 (evening)
      jest.setSystemTime(new Date('2025-01-15T10:00:00Z'));
      const profile: UserProfileConstraints = {
        weakTimeSlots: ['evening'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
        'Asia/Shanghai',
      );
      expect(result.excludeTags).toContain('high_fat');
      expect(result.excludeTags).toContain('high_carb');
      expect(result.excludeTags).toContain('dessert');
      expect(result.includeTags).toContain('low_calorie');
    });

    it('should add weak-slot constraints when current hour falls in midnight slot (>=21)', () => {
      // Set UTC to 14:00, Asia/Shanghai (UTC+8) → local hour = 22 (midnight)
      jest.setSystemTime(new Date('2025-01-15T14:00:00Z'));
      const profile: UserProfileConstraints = {
        weakTimeSlots: ['midnight'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
        'Asia/Shanghai',
      );
      expect(result.excludeTags).toContain('high_fat');
      expect(result.excludeTags).toContain('high_carb');
      expect(result.excludeTags).toContain('dessert');
      expect(result.includeTags).toContain('low_calorie');
    });

    it('should add weak-slot constraints when current hour falls in midnight slot (<5)', () => {
      // Set UTC to 20:00, Asia/Shanghai (UTC+8) → local hour = (20+8)%24 = 4 (midnight)
      jest.setSystemTime(new Date('2025-01-15T20:00:00Z'));
      const profile: UserProfileConstraints = {
        weakTimeSlots: ['midnight'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
        'Asia/Shanghai',
      );
      expect(result.excludeTags).toContain('high_fat');
      expect(result.excludeTags).toContain('high_carb');
      expect(result.excludeTags).toContain('dessert');
      expect(result.includeTags).toContain('low_calorie');
    });

    it('should NOT add weak-slot constraints when current hour does not match any slot', () => {
      // Set UTC to 2:00, Asia/Shanghai (UTC+8) → local hour = 10 (morning, not in any weak slot)
      jest.setSystemTime(new Date('2025-01-15T02:00:00Z'));
      const profile: UserProfileConstraints = {
        weakTimeSlots: ['afternoon', 'evening', 'midnight'],
      };
      const result = service.generateConstraints(
        'health',
        { calories: 800, protein: 80 },
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
        'Asia/Shanghai',
      );
      // None of the weak-slot-specific tags should be present from weak-slot logic
      // (other sources might still add them, so use consumed values that avoid state-driven triggers)
      expect(result.excludeTags).not.toContain('dessert');
    });

    it('should not crash with weakTimeSlots but no timezone (falls back to default timezone)', () => {
      const profile: UserProfileConstraints = {
        weakTimeSlots: ['afternoon'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
      );
      expect(result).toBeDefined();
    });
  });

  // ==================== 12. timezone (V5 IANA timezone) ====================

  describe('timezone', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should compute correct local hour with positive timezone offset', () => {
      // UTC 06:00, Asia/Shanghai (UTC+8) → local 14:00 (afternoon)
      jest.setSystemTime(new Date('2025-01-15T06:00:00Z'));
      const profile: UserProfileConstraints = {
        weakTimeSlots: ['afternoon'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
        'Asia/Shanghai',
      );
      expect(result.excludeTags).toContain('dessert');
    });

    it('should compute correct local hour with negative timezone offset', () => {
      // UTC 20:00, America/New_York (UTC-5) → local 15:00 (afternoon)
      jest.setSystemTime(new Date('2025-01-15T20:00:00Z'));
      const profile: UserProfileConstraints = {
        weakTimeSlots: ['afternoon'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
        'America/New_York',
      );
      expect(result.excludeTags).toContain('dessert');
    });

    it('should compute correct local hour with UTC timezone', () => {
      // UTC 19:00, UTC → local 19:00 (evening)
      jest.setSystemTime(new Date('2025-01-15T19:00:00Z'));
      const profile: UserProfileConstraints = {
        weakTimeSlots: ['evening'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
        'UTC',
      );
      expect(result.excludeTags).toContain('dessert');
    });

    it('should handle timezone that wraps past midnight (negative result)', () => {
      // UTC 02:00, America/New_York (UTC-5) → local 21:00 (midnight slot)
      jest.setSystemTime(new Date('2025-01-15T02:00:00Z'));
      const profile: UserProfileConstraints = {
        weakTimeSlots: ['midnight'],
      };
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
        'America/New_York',
      );
      expect(result.excludeTags).toContain('dessert');
    });

    it('should handle timezone that wraps past 24 (positive result)', () => {
      // UTC 22:00, Asia/Shanghai (UTC+8) → local 06:00 (morning, no weak slot)
      jest.setSystemTime(new Date('2025-01-15T22:00:00Z'));
      const profile: UserProfileConstraints = {
        weakTimeSlots: ['afternoon', 'evening', 'midnight'],
      };
      const result = service.generateConstraints(
        'health',
        { calories: 800, protein: 80 },
        defaultTarget,
        defaultDailyTarget,
        undefined,
        profile,
        'Asia/Shanghai',
      );
      expect(result.excludeTags).not.toContain('dessert');
    });
  });

  // ==================== 13. Combined / integration scenarios ====================

  describe('combined scenarios', () => {
    it('should combine goal, state, meal, allergens, health, diet, and discipline constraints', () => {
      const consumed = { calories: 1800, protein: 60 };
      // proteinGap = 100-60 = 40 > 30 → high_protein
      // calorieGap = 2000-1800 = 200 < 300 → low_calorie
      const profile: UserProfileConstraints = {
        allergens: ['egg'],
        healthConditions: ['hypertension'],
        dietaryRestrictions: ['vegetarian'],
        discipline: 'high',
      };
      const result = service.generateConstraints(
        'fat_loss',
        consumed,
        defaultTarget,
        defaultDailyTarget,
        'dinner',
        profile,
      );

      // Goal: fat_loss → high_protein
      expect(result.includeTags).toContain('high_protein');
      // State: proteinGap>30 → high_protein (deduplicated)
      // State: calorieGap<300 → low_calorie
      expect(result.includeTags).toContain('low_calorie');
      // Meal: dinner → low_carb, high_protein, light
      expect(result.includeTags).toContain('low_carb');
      expect(result.includeTags).toContain('light');
      // Meal: dinner → excludes high_carb, dessert
      expect(result.excludeTags).toContain('high_carb');
      expect(result.excludeTags).toContain('dessert');
      // Allergen
      expect(result.excludeTags).toContain('allergen_egg');
      // Health: hypertension → exclude high_sodium, include low_sodium
      expect(result.excludeTags).toContain('high_sodium');
      expect(result.includeTags).toContain('low_sodium');
      // Diet: vegetarian → exclude meat
      expect(result.excludeTags).toContain('meat');
      // Discipline: high + fat_loss → exclude processed
      expect(result.excludeTags).toContain('processed');

      // maxCalories and minProtein
      expect(result.maxCalories).toBeCloseTo(600 * 1.15);
      expect(result.minProtein).toBeCloseTo(30 * 0.5);

      // Deduplication check: high_protein appears only once
      expect(
        result.includeTags.filter((t) => t === 'high_protein').length,
      ).toBe(1);
    });

    it('should handle no userProfile at all', () => {
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
      );
      expect(result).toBeDefined();
      expect(result.includeTags).toBeDefined();
      expect(result.excludeTags).toBeDefined();
    });

    it('should handle empty userProfile', () => {
      const result = service.generateConstraints(
        'health',
        defaultConsumed,
        defaultTarget,
        defaultDailyTarget,
        undefined,
        {},
      );
      expect(result).toBeDefined();
    });

    it('should handle all zeroes in consumed and targets', () => {
      const consumed = { calories: 0, protein: 0 };
      const target: MealTarget = {
        calories: 0,
        protein: 0,
        fat: 0,
        carbs: 0,
      };
      const dailyTarget = { calories: 0, protein: 0, fat: 0, carbs: 0 };
      const result = service.generateConstraints(
        'health',
        consumed,
        target,
        dailyTarget,
      );
      expect(result.maxCalories).toBe(0);
      expect(result.minProtein).toBe(0);
      // calorieGap=0 < 300 → low_calorie; not < 0 so no ultra_low_calorie
      expect(result.includeTags).toContain('low_calorie');
      expect(result.includeTags).not.toContain('ultra_low_calorie');
    });
  });
});
